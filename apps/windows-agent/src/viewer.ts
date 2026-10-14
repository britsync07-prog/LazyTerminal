import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import readline from 'node:readline';
import {
  serializeMessage,
  parseServerMessage,
  type SessionSummary,
  type ExternalProcessSummary,
  type ServerMessage,
  type ClientMessage,
} from '@lazyterminal/protocol';

export function getCliArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

export function resolveViewerTargetHost(cliArgs: string[] = process.argv.slice(2)): string {
  const cliHost = getCliArg(cliArgs, '--host');
  if (cliHost) return cliHost;

  const envHost = process.env.LAZYTERMINAL_VIEWER_HOST || process.env.LAZYTERMINAL_HOST;
  // If LAZYTERMINAL_HOST is set to 0.0.0.0 (common for agent server binding), the client must connect to 127.0.0.1
  if (envHost && envHost !== '0.0.0.0') {
    return envHost;
  }

  return '127.0.0.1';
}

export function resolveAuthToken(cliArgs: string[] = process.argv.slice(2)): string | undefined {
  // 1. Explicit CLI argument: --token <token>
  const cliToken = getCliArg(cliArgs, '--token');
  if (cliToken && cliToken.length >= 16) return cliToken;

  // 2. Environment variable: LAZYTERMINAL_TOKEN
  const envToken = process.env.LAZYTERMINAL_TOKEN;
  if (envToken && envToken.length >= 16) return envToken;

  // 3. Stored agent token file (created by AgentServer on this machine)
  try {
    const agentTokenPath = path.join(os.homedir(), '.lazyterminal', 'agent-token');
    if (fs.existsSync(agentTokenPath)) {
      const content = fs.readFileSync(agentTokenPath, 'utf-8').trim();
      if (content && content.length >= 16) return content;
    }
  } catch {
    // ignore filesystem read errors
  }

  // 4. Stored viewer token file (from prior interactive pairing)
  try {
    const viewerTokenPath = path.join(os.homedir(), '.lazyterminal', 'viewer-token.json');
    if (fs.existsSync(viewerTokenPath)) {
      const parsed = JSON.parse(fs.readFileSync(viewerTokenPath, 'utf-8'));
      if (parsed?.token && typeof parsed.token === 'string' && parsed.token.length >= 16) {
        return parsed.token;
      }
    }
  } catch {
    // ignore filesystem read errors
  }

  return undefined;
}

export function saveViewerToken(token: string): void {
  try {
    const dir = path.join(os.homedir(), '.lazyterminal');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    const filePath = path.join(dir, 'viewer-token.json');
    fs.writeFileSync(filePath, JSON.stringify({ token, savedAt: Date.now() }), { mode: 0o600 });
  } catch {
    // ignore filesystem write errors
  }
}

export function clearSavedViewerToken(): void {
  try {
    const filePath = path.join(os.homedir(), '.lazyterminal', 'viewer-token.json');
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // ignore filesystem unlink errors
  }
}

export interface ViewerOptions {
  host?: string;
  port?: number | string;
  token?: string;
  autoAttachId?: string;
  forcePair?: boolean;
  cliArgs?: string[];
}

export class PcViewer {
  public ws: WebSocket | null = null;
  public isAuthenticated = false;
  public token?: string;
  public readonly host: string;
  public readonly port: number;
  public readonly autoAttachId?: string;
  public readonly forcePair: boolean;

  private attachedSessionId: string | null = null;
  private managedSessions: SessionSummary[] = [];
  private externalProcesses: ExternalProcessSummary[] = [];
  private isRawMode = false;
  private rl: readline.Interface | null = null;
  private resizeListener: (() => void) | null = null;
  private stdinListener: ((chunk: Buffer) => void) | null = null;

  constructor(options?: ViewerOptions) {
    const cliArgs = options?.cliArgs ?? process.argv.slice(2);
    this.host = options?.host ?? resolveViewerTargetHost(cliArgs);
    const portStr = options?.port ?? getCliArg(cliArgs, '--port') ?? process.env.LAZYTERMINAL_PORT ?? '4488';
    this.port = typeof portStr === 'number' ? portStr : parseInt(portStr, 10);
    this.token = options?.token ?? resolveAuthToken(cliArgs);
    this.autoAttachId = options?.autoAttachId ?? getCliArg(cliArgs, '--attach');
    this.forcePair = options?.forcePair ?? cliArgs.includes('--pair');
  }

  public getWsUrl(): string {
    return `ws://${this.host}:${this.port}`;
  }

  public async start(): Promise<void> {
    const wsUrl = this.getWsUrl();
    console.log(`Connecting to LazyTerminal Agent at ${wsUrl}...`);
    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      console.log('Connected to agent.');

      if (this.forcePair) {
        console.log('Force pairing requested (--pair). Initiating pairing flow...');
        this.requestPairing();
      } else if (this.token) {
        console.log('Authenticating with token...');
        this.send({ type: 'auth:connect', token: this.token });
      } else {
        // In loopback-dev mode, session:list succeeds without auth.
        // In LAN-secure mode, server returns UNAUTHORIZED, which triggers the pairing flow.
        this.refreshList();
      }
    });

    this.ws.on('message', (raw: Buffer | string) => {
      const rawStr = typeof raw === 'string' ? raw : raw.toString('utf-8');
      const parseResult = parseServerMessage(rawStr);
      if (!parseResult.success) return;
      this.handleServerMessage(parseResult.data);
    });

    this.ws.on('error', (err) => {
      console.error(`[Viewer Error] ${err.message}`);
    });

    this.ws.on('close', () => {
      this.cleanupTerminal();
      console.log('\n[Viewer] Disconnected from LazyTerminal Agent.');
      process.exit(0);
    });
  }

  public send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(serializeMessage(msg));
    }
  }

  public handleServerMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'auth:success': {
        this.isAuthenticated = true;
        console.log('[Auth] Authenticated successfully.');
        if (this.token) {
          saveViewerToken(this.token);
        }
        this.refreshList();
        break;
      }

      case 'auth:pair_prompt': {
        this.handlePairPrompt(msg.challenge);
        break;
      }

      case 'auth:pair_success': {
        this.isAuthenticated = true;
        this.token = msg.token;
        saveViewerToken(msg.token);
        console.log('\n================================================================');
        console.log(' [Pairing Successful] Authenticated with LazyTerminal Agent.');
        console.log(' Token saved to ~/.lazyterminal/viewer-token.json for future runs.');
        console.log('================================================================\n');
        this.refreshList();
        break;
      }

      case 'session:list_response': {
        this.isAuthenticated = true;
        this.managedSessions = msg.sessions;
        this.externalProcesses = msg.externalProcesses;

        if (this.autoAttachId && !this.attachedSessionId) {
          const target = this.managedSessions.find((s) => s.sessionId === this.autoAttachId);
          if (target) {
            this.attach(target.sessionId);
            return;
          }
        }

        if (!this.attachedSessionId) {
          this.renderDashboard();
        }
        break;
      }

      case 'session:created': {
        if (!this.managedSessions.some((s) => s.sessionId === msg.session.sessionId)) {
          this.managedSessions.push(msg.session);
        }
        if (!this.attachedSessionId && this.isAuthenticated) {
          this.renderDashboard();
        }
        break;
      }

      case 'session:closed': {
        this.managedSessions = this.managedSessions.filter((s) => s.sessionId !== msg.sessionId);
        if (this.attachedSessionId === msg.sessionId) {
          this.cleanupTerminal();
          console.log(`\n[Session ${msg.sessionId} closed by process or agent.]`);
          this.attachedSessionId = null;
          if (this.isAuthenticated) {
            this.renderDashboard();
          }
        } else if (!this.attachedSessionId && this.isAuthenticated) {
          this.renderDashboard();
        }
        break;
      }

      case 'session:attached': {
        this.attachedSessionId = msg.sessionId;
        this.enterRawMode();
        if (msg.recentOutput) {
          process.stdout.write(msg.recentOutput);
        }
        break;
      }

      case 'session:detached': {
        if (this.attachedSessionId === msg.sessionId) {
          this.cleanupTerminal();
          this.attachedSessionId = null;
          this.renderDashboard();
        }
        break;
      }

      case 'terminal:output': {
        if (this.attachedSessionId === msg.sessionId) {
          process.stdout.write(msg.data);
        }
        break;
      }

      case 'terminal:exit': {
        if (this.attachedSessionId === msg.sessionId) {
          this.cleanupTerminal();
          console.log(`\n[Process exited with code ${msg.exitCode}]`);
          this.attachedSessionId = null;
          this.refreshList();
        }
        break;
      }

      case 'terminal:created': {
        this.attach(msg.sessionId);
        break;
      }

      case 'terminal:error': {
        if (msg.code === 'UNAUTHORIZED') {
          this.isAuthenticated = false;
          console.log('\n[Agent Error: UNAUTHORIZED] Authentication required.');
          if (this.token) {
            console.log('Stored token was rejected. Clearing cached token.');
            clearSavedViewerToken();
            this.token = undefined;
          }
          this.requestPairing();
          return;
        }

        if (msg.code === 'AUTH_FAILED') {
          this.isAuthenticated = false;
          console.log(`\n[Authentication Failed] ${msg.message}`);
          if (this.token) {
            clearSavedViewerToken();
            this.token = undefined;
          }
          this.promptForAuthAction();
          return;
        }

        if (!this.attachedSessionId) {
          console.error(`\n[Agent Error: ${msg.code}] ${msg.message}`);
          this.promptDashboard();
        }
        break;
      }
    }
  }

  public requestPairing(): void {
    console.log('Sending pairing request to agent...');
    this.send({
      type: 'auth:pair_request',
      clientName: 'LazyTerminal PC Viewer',
    });
  }

  private handlePairPrompt(challenge: string): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }

    console.log('\n================================================================');
    console.log(' [PAIRING REQUIRED]');
    console.log(` ${challenge}`);
    console.log(' >>> Check the Windows Agent console on this PC for the 6-digit code. <<<');
    console.log('================================================================\n');

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    this.rl.question('Enter 6-digit pairing code (or "q" to cancel): ', (input) => {
      const trimmed = input.trim();
      if (!trimmed || trimmed.toLowerCase() === 'q') {
        this.renderDashboard();
        return;
      }

      console.log(`Submitting pairing code "${trimmed}"...`);
      this.send({
        type: 'auth:pair_verify',
        code: trimmed,
      });
    });
  }

  private promptForAuthAction(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log('\nAuthentication Options:');
    console.log('  [p] Pair with Agent (enter 6-digit code shown on Agent console)');
    console.log('  [t] Supply Auth Token manually');
    console.log('  [q] Quit viewer');

    this.rl.question('\nAuth> ', (input) => {
      const choice = input.trim().toLowerCase();
      if (choice === 'p') {
        this.requestPairing();
      } else if (choice === 't') {
        this.promptForManualToken();
      } else if (choice === 'q') {
        process.exit(0);
      } else {
        this.promptForAuthAction();
      }
    });
  }

  private promptForManualToken(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    this.rl.question('Enter 256-bit token (or "q" to cancel): ', (input) => {
      const token = input.trim();
      if (token.toLowerCase() === 'q' || !token) {
        this.renderDashboard();
        return;
      }
      this.token = token;
      console.log('Connecting with provided token...');
      this.send({ type: 'auth:connect', token });
    });
  }

  public refreshList(): void {
    this.send({ type: 'session:list' });
  }

  public attach(sessionId: string): void {
    if (!this.isAuthenticated) {
      console.log('Cannot attach: viewer is not authenticated.');
      this.requestPairing();
      return;
    }

    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;
    this.send({
      type: 'session:attach',
      sessionId,
      cols,
      rows,
    });
  }

  public detach(): void {
    if (this.attachedSessionId) {
      const sessId = this.attachedSessionId;
      this.send({
        type: 'session:detach',
        sessionId: sessId,
      });
      this.cleanupTerminal();
      this.attachedSessionId = null;
      this.refreshList();
    }
  }

  public createSession(): void {
    if (!this.isAuthenticated) {
      console.log('Cannot create session: viewer is not authenticated.');
      this.requestPairing();
      return;
    }

    const requestId = `req-viewer-${Date.now()}`;
    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;
    this.send({
      type: 'terminal:create',
      requestId,
      cols,
      rows,
    });
  }

  public closeSession(sessionId: string): void {
    if (!this.isAuthenticated) {
      console.log('Cannot close session: viewer is not authenticated.');
      return;
    }

    this.send({
      type: 'terminal:close',
      sessionId,
    });
  }

  private enterRawMode(): void {
    if (this.isRawMode) return;
    this.isRawMode = true;

    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }

    process.stdout.write(`\r\n=== Attached to session [${this.attachedSessionId}]. Press Ctrl+] to detach ===\r\n\n`);

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
    }

    this.stdinListener = (chunk: Buffer) => {
      // Check for Ctrl+] (0x1D) to detach
      if (chunk.length === 1 && chunk[0] === 0x1d) {
        this.detach();
        return;
      }

      if (this.attachedSessionId) {
        this.send({
          type: 'terminal:input',
          sessionId: this.attachedSessionId,
          data: chunk.toString('utf-8'),
        });
      }
    };

    process.stdin.on('data', this.stdinListener);

    this.resizeListener = () => {
      if (this.attachedSessionId) {
        this.send({
          type: 'terminal:resize',
          sessionId: this.attachedSessionId,
          cols: process.stdout.columns || 80,
          rows: process.stdout.rows || 24,
        });
      }
    };

    process.stdout.on('resize', this.resizeListener);
  }

  private cleanupTerminal(): void {
    if (!this.isRawMode) return;
    this.isRawMode = false;

    if (this.stdinListener) {
      process.stdin.removeListener('data', this.stdinListener);
      this.stdinListener = null;
    }

    if (this.resizeListener) {
      process.stdout.removeListener('resize', this.resizeListener);
      this.resizeListener = null;
    }

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
  }

  private renderDashboard(): void {
    if (this.isRawMode) return;
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }

    console.clear();
    console.log('====================================================================');
    console.log(' LazyTerminal — PC Terminal Mirror & Session Dashboard');
    console.log('====================================================================');
    console.log(` Target Agent: ws://${this.host}:${this.port}`);
    console.log(` Auth Status:  ${this.isAuthenticated ? 'AUTHENTICATED' : 'UNAUTHENTICATED (Pairing Required)'}`);

    if (!this.isAuthenticated) {
      console.log('\n[Notice: Authentication Required]');
      console.log('  The agent requires a valid token or pairing confirmation.');
      console.log('\nActions:');
      console.log('  [p] Start pairing flow (enter 6-digit code shown on Agent console)');
      console.log('  [t] Supply auth token manually');
      console.log('  [q] Quit viewer');
      console.log('--------------------------------------------------------------------');
      this.promptDashboard();
      return;
    }

    console.log('\n[Managed Sessions]');
    if (this.managedSessions.length === 0) {
      console.log('  (No active managed sessions. Press [n] to create one.)');
    } else {
      this.managedSessions.forEach((s, idx) => {
        const dateStr = new Date(s.createdAt).toLocaleTimeString();
        console.log(
          `  [${idx + 1}] ID: ${s.sessionId.substring(0, 8)}... | Shell: ${s.shell} | Size: ${s.cols}x${s.rows} | Clients: ${s.attachedClients} | Created: ${dateStr}`,
        );
      });
    }

    console.log('\n[External Windows Console Processes]');
    if (this.externalProcesses.length === 0) {
      console.log('  (No external console processes detected)');
    } else {
      this.externalProcesses.forEach((p) => {
        const titleStr = p.windowTitle ? ` | Title: "${p.windowTitle}"` : '';
        console.log(
          `  - PID: ${p.pid} | ${p.name}${titleStr} [Unmanaged: ConPTY handle is private]`,
        );
      });
      console.log('  (Note: Windows security boundaries prevent attaching to external ConPTY handles)');
    }

    console.log('\nActions:');
    console.log('  [<num>] Attach to session #');
    console.log('  [n]     Open new managed PowerShell session');
    console.log('  [k <num>] Kill/Close session #');
    console.log('  [r]     Refresh session list');
    console.log('  [p]     Re-pair with agent');
    console.log('  [q]     Quit viewer');
    console.log('--------------------------------------------------------------------');

    this.promptDashboard();
  }

  private promptDashboard(): void {
    if (this.rl) {
      this.rl.close();
    }

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    this.rl.question('Viewer> ', (input) => {
      const trimmed = input.trim();
      if (!trimmed) {
        this.renderDashboard();
        return;
      }

      if (trimmed === 'q') {
        this.cleanupTerminal();
        console.log('Exiting PC viewer.');
        process.exit(0);
      }

      // If not authenticated, only allow auth-related commands
      if (!this.isAuthenticated) {
        if (trimmed === 'p') {
          this.requestPairing();
        } else if (trimmed === 't') {
          this.promptForManualToken();
        } else {
          console.log('Authentication required. Use [p] to pair, [t] to enter token, or [q] to quit.');
          this.promptDashboard();
        }
        return;
      }

      if (trimmed === 'r') {
        this.refreshList();
      } else if (trimmed === 'p') {
        this.requestPairing();
      } else if (trimmed === 'n') {
        console.log('Creating new managed PowerShell session...');
        this.createSession();
      } else if (trimmed.startsWith('k ')) {
        const num = parseInt(trimmed.substring(2).trim(), 10);
        if (num > 0 && num <= this.managedSessions.length) {
          const target = this.managedSessions[num - 1];
          console.log(`Closing session ${target.sessionId}...`);
          this.closeSession(target.sessionId);
        } else {
          console.log('Invalid session number.');
          this.promptDashboard();
        }
      } else {
        const num = parseInt(trimmed, 10);
        if (num > 0 && num <= this.managedSessions.length) {
          const target = this.managedSessions[num - 1];
          console.log(`Attaching to session ${target.sessionId}...`);
          this.attach(target.sessionId);
        } else {
          console.log('Unknown command. Use [<num>], [n], [k <num>], [r], [p], or [q].');
          this.promptDashboard();
        }
      }
    });
  }
}

// Auto-run if executed directly
const isMain = process.argv[1]?.includes('viewer');
if (isMain) {
  const viewer = new PcViewer();
  viewer.start().catch((err) => {
    console.error('Failed to start PC viewer:', err);
    process.exit(1);
  });
}
