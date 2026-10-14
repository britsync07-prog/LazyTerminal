import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import child_process from 'node:child_process';
import { WebSocket } from 'ws';
import {
  serializeMessage,
  parseServerMessage,
  type SessionSummary,
  type ExternalProcessSummary,
  type ServerMessage,
  type ClientMessage,
} from '@lazyterminal/protocol';
import type { DesktopAgentStatus } from './types.js';

let mainWindow: BrowserWindow | null = null;
let agentChildProcess: child_process.ChildProcess | null = null;
let agentClientWs: WebSocket | null = null;
let attachedSessionId: string | null = null;
let latestSessions: SessionSummary[] = [];
let latestExternalProcesses: ExternalProcessSummary[] = [];
let cachedAuthToken: string | undefined;

function getStoredDesktopToken(): string | undefined {
  try {
    const tokenFile = path.join(os.homedir(), '.lazyterminal', 'agent-token');
    if (fs.existsSync(tokenFile)) {
      const token = fs.readFileSync(tokenFile, 'utf-8').trim();
      if (token && token.length >= 16) return token;
    }
  } catch {
    // ignore
  }
  return undefined;
}

function findNodeExecutable(): string {
  const candidates = [
    process.env.LAZYTERMINAL_NODE_BIN,
    path.join(process.resourcesPath || '', 'bin', 'node.exe'),
    path.join(path.dirname(process.execPath), 'bin', 'node.exe'),
    path.join(path.dirname(process.execPath), 'node.exe'),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return 'node';
}

function findAgentScriptPath(): string | null {
  const candidates = [
    process.env.LAZYTERMINAL_AGENT_PATH,
    path.resolve(__dirname, '..', '..', 'windows-agent', 'dist', 'index.js'),
    path.resolve(__dirname, '..', 'windows-agent', 'dist', 'index.js'),
    path.join(process.resourcesPath || '', 'agent', 'dist', 'index.js'),
    path.join(path.dirname(process.execPath), 'agent', 'dist', 'index.js'),
    path.resolve(process.cwd(), 'apps', 'windows-agent', 'dist', 'index.js'),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

function getAgentStatus(): DesktopAgentStatus {
  const storedToken = getStoredDesktopToken();
  const isWsConnected = agentClientWs && agentClientWs.readyState === WebSocket.OPEN;

  return {
    isRunning: Boolean(isWsConnected || agentChildProcess),
    isManagedByApp: Boolean(agentChildProcess),
    host: '127.0.0.1',
    port: 4488,
    securityMode: 'lan-secure',
    requireAuth: true,
    authToken: storedToken || cachedAuthToken,
    tokenFilePath: path.join(os.homedir(), '.lazyterminal', 'agent-token'),
    activeSessionsCount: latestSessions.length,
  };
}

function notifyAgentStatus(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('agent:status-changed', getAgentStatus());
  }
}

function connectToAgent(token?: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (agentClientWs && agentClientWs.readyState === WebSocket.OPEN) {
      resolve(true);
      return;
    }

    const host = '127.0.0.1';
    const port = 4488;
    const effectiveToken = token || cachedAuthToken || getStoredDesktopToken();

    try {
      const ws = new WebSocket(`ws://${host}:${port}`);
      agentClientWs = ws;

      ws.on('open', () => {
        if (effectiveToken) {
          ws.send(serializeMessage({ type: 'auth:connect', token: effectiveToken }));
        } else {
          ws.send(serializeMessage({ type: 'session:list' }));
        }
      });

      ws.on('message', (data: Buffer | string) => {
        const str = typeof data === 'string' ? data : data.toString('utf-8');
        const parsed = parseServerMessage(str);
        if (!parsed.success) return;

        handleAgentMessage(parsed.data);
      });

      ws.on('error', () => {
        resolve(false);
      });

      ws.on('close', () => {
        agentClientWs = null;
        notifyAgentStatus();
        resolve(false);
      });

      setTimeout(() => {
        resolve(ws.readyState === WebSocket.OPEN);
      }, 800);
    } catch {
      resolve(false);
    }
  });
}

function handleAgentMessage(msg: ServerMessage): void {
  switch (msg.type) {
    case 'auth:success': {
      if (agentClientWs && agentClientWs.readyState === WebSocket.OPEN) {
        agentClientWs.send(serializeMessage({ type: 'session:list' }));
      }
      notifyAgentStatus();
      break;
    }

    case 'session:list_response': {
      latestSessions = msg.sessions;
      latestExternalProcesses = msg.externalProcesses;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('session:list-updated', {
          sessions: latestSessions,
          externalProcesses: latestExternalProcesses,
        });
      }
      notifyAgentStatus();
      break;
    }

    case 'session:created': {
      if (!latestSessions.some((s) => s.sessionId === msg.session.sessionId)) {
        latestSessions.push(msg.session);
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('session:list-updated', {
          sessions: latestSessions,
          externalProcesses: latestExternalProcesses,
        });
      }
      break;
    }

    case 'session:closed': {
      latestSessions = latestSessions.filter((s) => s.sessionId !== msg.sessionId);
      if (attachedSessionId === msg.sessionId) {
        attachedSessionId = null;
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('session:closed', msg.sessionId);
        mainWindow.webContents.send('session:list-updated', {
          sessions: latestSessions,
          externalProcesses: latestExternalProcesses,
        });
      }
      break;
    }

    case 'session:attached': {
      attachedSessionId = msg.sessionId;
      if (msg.recentOutput && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:output', msg.recentOutput);
      }
      break;
    }

    case 'terminal:output': {
      if (attachedSessionId === msg.sessionId && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:output', msg.data);
      }
      break;
    }

    case 'terminal:exit': {
      if (attachedSessionId === msg.sessionId && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(
          'terminal:output',
          `\r\n\x1b[33m[Process exited with code ${msg.exitCode}]\x1b[0m\r\n`,
        );
        attachedSessionId = null;
      }
      break;
    }
  }
}

async function startAgent(lanMode = false): Promise<DesktopAgentStatus> {
  if (agentClientWs && agentClientWs.readyState === WebSocket.OPEN) {
    return getAgentStatus();
  }

  const agentScript = findAgentScriptPath();
  if (agentScript) {
    const host = lanMode ? '0.0.0.0' : '127.0.0.1';
    const nodeBin = findNodeExecutable();
    try {
      const child = child_process.spawn(nodeBin, [agentScript], {
        env: {
          ...process.env,
          LAZYTERMINAL_HOST: host,
          LAZYTERMINAL_PORT: '4488',
          LAZYTERMINAL_REQUIRE_AUTH: lanMode ? 'true' : 'false',
        },
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      agentChildProcess = child;

      // Allow agent server time to bind socket and persist auth token
      await new Promise((resolve) => setTimeout(resolve, 1500));
    } catch {
      // ignore
    }
  }

  const connected = await connectToAgent();
  if (!connected) {
    // Retry once
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await connectToAgent();
  }

  notifyAgentStatus();
  return getAgentStatus();
}

async function stopAgent(): Promise<DesktopAgentStatus> {
  if (agentChildProcess) {
    try {
      agentChildProcess.kill('SIGTERM');
    } catch {
      // ignore
    }
    agentChildProcess = null;
  }
  if (agentClientWs) {
    agentClientWs.close();
    agentClientWs = null;
  }
  latestSessions = [];
  latestExternalProcesses = [];
  attachedSessionId = null;

  notifyAgentStatus();
  return getAgentStatus();
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'LazyTerminal — Remote Windows Terminal Manager',
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  const rendererHtml = path.join(__dirname, 'renderer', 'index.html');
  mainWindow.loadFile(rendererHtml);

  // Requirement: Closing the desktop UI must NOT kill sessions unexpectedly
  mainWindow.on('close', (e) => {
    // If sessions are active, prompt or keep running
    if (latestSessions.length > 0) {
      const choice = dialog.showMessageBoxSync(mainWindow!, {
        type: 'question',
        buttons: ['Keep Agent Running in Background', 'Stop Agent & Exit', 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        title: 'LazyTerminal Sessions Active',
        message: `${latestSessions.length} active terminal session(s) are currently running.`,
        detail:
          'If you keep the agent running in the background, your connected phone app can continue to use them without interruption.',
      });

      if (choice === 2) {
        e.preventDefault();
        return;
      }

      if (choice === 1) {
        // User explicitly chose to stop agent and kill sessions
        stopAgent();
      }
      // If choice === 0, window closes normally, agent remains running in background
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function setupIpc(): void {
  ipcMain.handle('agent:status', async () => getAgentStatus());

  ipcMain.handle('agent:start', async (_event, lanMode: boolean) => {
    return startAgent(lanMode);
  });

  ipcMain.handle('agent:stop', async () => {
    return stopAgent();
  });

  ipcMain.handle('session:refresh', async () => {
    if (agentClientWs && agentClientWs.readyState === WebSocket.OPEN) {
      agentClientWs.send(serializeMessage({ type: 'session:list' }));
    }
    return { sessions: latestSessions, externalProcesses: latestExternalProcesses };
  });

  ipcMain.handle(
    'session:create',
    async (_event, cols: number, rows: number, cwd?: string) => {
      if (!agentClientWs || agentClientWs.readyState !== WebSocket.OPEN) {
        throw new Error('Not connected to terminal agent');
      }

      const requestId = `req-gui-${Date.now()}`;
      agentClientWs.send(
        serializeMessage({
          type: 'terminal:create',
          requestId,
          cols,
          rows,
          cwd,
        }),
      );
      return requestId;
    },
  );

  ipcMain.handle('session:attach', async (_event, sessionId: string) => {
    if (!agentClientWs || agentClientWs.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to terminal agent');
    }

    if (attachedSessionId && attachedSessionId !== sessionId) {
      agentClientWs.send(
        serializeMessage({
          type: 'session:detach',
          sessionId: attachedSessionId,
        }),
      );
    }

    attachedSessionId = sessionId;
    agentClientWs.send(
      serializeMessage({
        type: 'session:attach',
        sessionId,
      }),
    );
  });

  ipcMain.handle('session:detach', async () => {
    if (agentClientWs && agentClientWs.readyState === WebSocket.OPEN && attachedSessionId) {
      agentClientWs.send(
        serializeMessage({
          type: 'session:detach',
          sessionId: attachedSessionId,
        }),
      );
      attachedSessionId = null;
    }
  });

  ipcMain.handle('session:close', async (_event, sessionId: string) => {
    if (!agentClientWs || agentClientWs.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to terminal agent');
    }

    agentClientWs.send(
      serializeMessage({
        type: 'terminal:close',
        sessionId,
      }),
    );
  });

  ipcMain.handle('terminal:input', async (_event, data: string) => {
    if (agentClientWs && agentClientWs.readyState === WebSocket.OPEN && attachedSessionId) {
      agentClientWs.send(
        serializeMessage({
          type: 'terminal:input',
          sessionId: attachedSessionId,
          data,
        }),
      );
    }
  });

  ipcMain.handle('terminal:resize', async (_event, cols: number, rows: number) => {
    if (agentClientWs && agentClientWs.readyState === WebSocket.OPEN && attachedSessionId) {
      agentClientWs.send(
        serializeMessage({
          type: 'terminal:resize',
          sessionId: attachedSessionId,
          cols,
          rows,
        }),
      );
    }
  });

  ipcMain.handle('session:spawn-from-external', async (_event, pid: number) => {
    // Look up external process working directory or home
    let targetCwd: string | undefined;
    try {
      const ext = latestExternalProcesses.find((p) => p.pid === pid);
      if (ext) {
        targetCwd = os.homedir();
      }
    } catch {
      targetCwd = os.homedir();
    }

    if (!agentClientWs || agentClientWs.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to terminal agent');
    }

    const requestId = `req-spawn-ext-${Date.now()}`;
    agentClientWs.send(
      serializeMessage({
        type: 'terminal:create',
        requestId,
        cols: 100,
        rows: 30,
        cwd: targetCwd,
      }),
    );
    return requestId;
  });
}

app.whenReady().then(async () => {
  setupIpc();
  createWindow();

  // Automatically start the agent in LAN mode or connect to existing
  try {
    const isAlreadyRunning = await connectToAgent();
    if (!isAlreadyRunning) {
      await startAgent(true); // LAN-secure mode by default for remote phone access
    }
  } catch (err) {
    console.warn('[DesktopApp] Initial agent startup notice:', (err as Error).message);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // If agent was launched in background detached, it remains running for mobile connections
  app.quit();
});
