import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import {
  parseClientMessage,
  serializeMessage,
  ERROR_CODES,
  MAX_RAW_MESSAGE_BYTES,
  ServerMessage,
  ParsedClientMessage,
} from '@lazyterminal/protocol';
import { SessionRegistry, SessionRegistryError } from './session-registry.js';
import { PairingManager } from './pairing-manager.js';
import { discoverExternalProcesses } from './process-discovery.js';
import type { AgentConfig, AgentServerInfo, SecurityMode } from './types.js';

export class AgentServer {
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  public readonly sessionRegistry: SessionRegistry;
  public readonly pairingManager: PairingManager;
  private readonly config: AgentConfig;
  public readonly isLoopbackOnly: boolean;
  public readonly securityMode: SecurityMode;
  private effectivePort: number;
  private readonly connectedClients = new Set<WebSocket>();
  private readonly authenticatedClients = new WeakSet<WebSocket>();
  private readonly clientReqMap = new WeakMap<WebSocket, http.IncomingMessage>();
  private readonly sessionAttachedClients = new Map<string, Set<WebSocket>>();
  public readonly primaryAuthToken?: string;
  public tokenFilePath?: string;

  constructor(config?: Partial<AgentConfig>) {
    const host = config?.host ?? '127.0.0.1';
    this.isLoopbackOnly = host === '127.0.0.1' || host === 'localhost';

    // Binding to 0.0.0.0 or non-loopback MUST always enforce authentication.
    // In loopback mode, requireAuth defaults to false unless explicitly set to true.
    const requireAuth = !this.isLoopbackOnly || (config?.requireAuth ?? false);

    this.securityMode = !this.isLoopbackOnly || requireAuth ? 'lan-secure' : 'loopback-dev';
    this.effectivePort = config?.port ?? 4488;

    this.config = {
      host,
      port: this.effectivePort,
      maxSessions: config?.maxSessions ?? 10,
      shellPath: config?.shellPath,
      shellArgs: config?.shellArgs,
      requireAuth,
      pairingTimeoutMs: config?.pairingTimeoutMs,
      authToken: config?.authToken,
      initialTokens: config?.initialTokens,
      saveTokenToFile: config?.saveTokenToFile,
    };

    this.sessionRegistry = new SessionRegistry({
      maxSessions: this.config.maxSessions,
      shellPath: this.config.shellPath,
      shellArgs: this.config.shellArgs,
    });

    const initialTokens: string[] = [];
    if (this.config.authToken) {
      initialTokens.push(this.config.authToken);
    }
    if (this.config.initialTokens) {
      initialTokens.push(...this.config.initialTokens);
    }
    const envToken = process.env.LAZYTERMINAL_TOKEN;
    if (envToken && envToken.length >= 16 && !initialTokens.includes(envToken)) {
      initialTokens.push(envToken);
    }

    this.pairingManager = new PairingManager({
      pairingTimeoutMs: this.config.pairingTimeoutMs,
      initialTokens,
    });

    // If authentication is required and no token was supplied, generate a secure 256-bit token
    let primaryToken = initialTokens[0];
    if (requireAuth && !primaryToken) {
      primaryToken = crypto.randomBytes(32).toString('hex');
      this.pairingManager.registerToken(primaryToken);
    }
    this.primaryAuthToken = primaryToken;

    // Securely write desktop token to local user profile for seamless local viewer pairing
    if (requireAuth && this.primaryAuthToken && config?.saveTokenToFile !== false) {
      try {
        const tokenDir = path.join(os.homedir(), '.lazyterminal');
        if (!fs.existsSync(tokenDir)) {
          fs.mkdirSync(tokenDir, { recursive: true, mode: 0o700 });
        }
        const filePath = path.join(tokenDir, 'agent-token');
        fs.writeFileSync(filePath, this.primaryAuthToken, { mode: 0o600 });
        this.tokenFilePath = filePath;
      } catch (err) {
        console.warn('[AgentServer] Unable to write agent token file:', (err as Error).message);
      }
    }

    this.setupRegistryEvents();
  }

  public getServerInfo(): AgentServerInfo {
    return {
      host: this.config.host,
      port: this.effectivePort,
      securityMode: this.securityMode,
      requireAuth: this.config.requireAuth!,
      isLoopbackOnly: this.isLoopbackOnly,
      maxSessions: this.config.maxSessions,
      authToken: this.primaryAuthToken,
      tokenFilePath: this.tokenFilePath,
    };
  }

  private setupRegistryEvents(): void {
    // When a session produces output, broadcast it to connected and authenticated clients
    this.sessionRegistry.on('data', (sessionId: string, data: string) => {
      this.broadcast({
        type: 'terminal:output',
        sessionId,
        data,
      });
    });

    // When a session exits
    this.sessionRegistry.on('exit', (sessionId: string, exitCode: number) => {
      this.sessionAttachedClients.delete(sessionId);
      this.broadcast({
        type: 'terminal:exit',
        sessionId,
        exitCode,
      });
      this.broadcast({
        type: 'session:closed',
        sessionId,
        exitCode,
      });
    });
  }

  private isClientAuthenticated(ws: WebSocket): boolean {
    // If authentication is disabled (only permitted when bound strictly to loopback)
    if (!this.config.requireAuth) {
      const req = this.clientReqMap.get(ws);
      const remoteAddress = req?.socket.remoteAddress;
      const isLoopbackSocket =
        remoteAddress === '127.0.0.1' ||
        remoteAddress === '::1' ||
        remoteAddress === '::ffff:127.0.0.1';

      if (this.isLoopbackOnly && isLoopbackSocket) {
        return true;
      }
    }

    // In all other cases (including all LAN connections), client MUST be in authenticated set
    return this.authenticatedClients.has(ws);
  }

  public async start(): Promise<AgentServerInfo> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        // Simple healthcheck on HTTP GET /
        if (req.method === 'GET' && req.url === '/') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              name: 'LazyTerminal Agent',
              status: 'running',
              host: this.config.host,
              securityMode: this.securityMode,
              requireAuth: this.config.requireAuth,
              activeSessions: this.sessionRegistry.getActiveSessionsCount(),
            }),
          );
          return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      });

      const wss = new WebSocketServer({
        server,
        maxPayload: MAX_RAW_MESSAGE_BYTES,
      });

      wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
        const remoteAddress = req.socket.remoteAddress;
        const isLoopback =
          remoteAddress === '127.0.0.1' ||
          remoteAddress === '::1' ||
          remoteAddress === '::ffff:127.0.0.1';

        // If server is strictly bound to loopback and client is not loopback, reject immediately
        if (this.isLoopbackOnly && !isLoopback) {
          ws.close(1008, 'Forbidden: remote connections not permitted in loopback mode');
          return;
        }

        this.connectedClients.add(ws);
        this.clientReqMap.set(ws, req);

        ws.on('message', async (raw: Buffer | string) => {
          await this.handleClientMessage(ws, raw);
        });

        ws.on('error', (err) => {
          console.error('[AgentServer] Client socket error:', err.message);
        });

        ws.on('close', () => {
          this.connectedClients.delete(ws);
          this.clientReqMap.delete(ws);
          for (const clients of this.sessionAttachedClients.values()) {
            clients.delete(ws);
          }
        });
      });

      wss.on('error', (err) => {
        reject(err);
      });

      server.listen(this.config.port, this.config.host, () => {
        this.httpServer = server;
        this.wss = wss;
        const address = server.address();
        if (typeof address === 'object' && address) {
          this.effectivePort = address.port;
        }
        resolve(this.getServerInfo());
      });

      server.on('error', (err) => {
        reject(err);
      });
    });
  }

  private async handleClientMessage(
    ws: WebSocket,
    raw: Buffer | string,
  ): Promise<void> {
    const rawString = typeof raw === 'string' ? raw : raw.toString('utf-8');
    const parseResult = parseClientMessage(rawString);

    if (!parseResult.success) {
      this.sendToClient(ws, {
        type: 'terminal:error',
        code: ERROR_CODES.INVALID_MESSAGE,
        message: parseResult.error,
      });
      return;
    }

    const msg = parseResult.data;

    // Handle authentication / pairing messages without requiring pre-authentication
    if (msg.type === 'auth:pair_request') {
      const pairResult = this.pairingManager.requestPairing(msg.clientName);
      this.sendToClient(ws, {
        type: 'auth:pair_prompt',
        challenge: pairResult.challenge,
        expiresAt: pairResult.expiresAt,
      });
      return;
    }

    if (msg.type === 'auth:pair_verify') {
      const verifyResult = this.pairingManager.verifyPairingCode(msg.code);
      if (verifyResult.success && verifyResult.token) {
        this.authenticatedClients.add(ws);
        this.sendToClient(ws, {
          type: 'auth:pair_success',
          token: verifyResult.token,
        });
      } else {
        this.sendToClient(ws, {
          type: 'terminal:error',
          code: verifyResult.code || ERROR_CODES.AUTH_FAILED,
          message: verifyResult.error || 'Pairing verification failed',
        });
      }
      return;
    }

    if (msg.type === 'auth:connect') {
      if (this.pairingManager.validateToken(msg.token)) {
        this.authenticatedClients.add(ws);
        this.sendToClient(ws, {
          type: 'auth:success',
        });
      } else {
        this.sendToClient(ws, {
          type: 'terminal:error',
          code: ERROR_CODES.AUTH_FAILED,
          message: 'Invalid or expired authentication token',
        });
      }
      return;
    }

    if (msg.type === 'ping') {
      this.sendToClient(ws, {
        type: 'pong',
        timestamp: msg.timestamp,
      });
      return;
    }

    // Guard: Enforce authentication for all terminal operations
    if (!this.isClientAuthenticated(ws)) {
      this.sendToClient(ws, {
        type: 'terminal:error',
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Authentication required. Please complete pairing or provide a valid token.',
      });
      return;
    }

    // Process authenticated terminal operations
    try {
      await this.handleTerminalMessage(ws, msg);
    } catch (err) {
      const code =
        err instanceof SessionRegistryError
          ? err.code
          : ERROR_CODES.INTERNAL_ERROR;

      this.sendToClient(ws, {
        type: 'terminal:error',
        sessionId: 'sessionId' in msg ? (msg.sessionId as string) : undefined,
        requestId: 'requestId' in msg ? (msg.requestId as string) : undefined,
        code,
        message: (err as Error).message,
      });
    }
  }

  private async handleTerminalMessage(ws: WebSocket, msg: ParsedClientMessage): Promise<void> {
    switch (msg.type) {
      case 'terminal:create': {
        const session = await this.sessionRegistry.createSession({
          cols: msg.cols,
          rows: msg.rows,
          cwd: msg.cwd,
        });

        let clients = this.sessionAttachedClients.get(session.id);
        if (!clients) {
          clients = new Set();
          this.sessionAttachedClients.set(session.id, clients);
        }
        clients.add(ws);

        this.sendToClient(ws, {
          type: 'terminal:created',
          requestId: msg.requestId,
          sessionId: session.id,
          cols: session.cols,
          rows: session.rows,
        });

        // Broadcast session:created to all authenticated clients
        this.broadcast({
          type: 'session:created',
          session: {
            sessionId: session.id,
            shell: session.shell ?? this.config.shellPath ?? 'powershell.exe',
            cols: session.cols,
            rows: session.rows,
            createdAt: session.createdAt.getTime(),
            attachedClients: clients.size,
            status: 'active',
            title: session.title ?? 'PowerShell',
          },
        });
        break;
      }

      case 'session:list': {
        const sessions = this.sessionRegistry.getAllSessions().map((s) => ({
          sessionId: s.id,
          shell: s.shell ?? this.config.shellPath ?? 'powershell.exe',
          cols: s.cols,
          rows: s.rows,
          createdAt: s.createdAt.getTime(),
          attachedClients: this.sessionAttachedClients.get(s.id)?.size ?? 0,
          status: 'active' as const,
          title: s.title ?? 'PowerShell',
        }));

        const externalProcesses = await discoverExternalProcesses(
          this.sessionRegistry.getManagedPids(),
        );

        this.sendToClient(ws, {
          type: 'session:list_response',
          requestId: msg.requestId,
          sessions,
          externalProcesses,
        });
        break;
      }

      case 'session:attach': {
        const session = this.sessionRegistry.getSession(msg.sessionId);
        if (!session) {
          this.sendToClient(ws, {
            type: 'terminal:error',
            sessionId: msg.sessionId,
            code: ERROR_CODES.SESSION_NOT_FOUND,
            message: `Session with ID "${msg.sessionId}" not found`,
          });
          break;
        }

        let clients = this.sessionAttachedClients.get(session.id);
        if (!clients) {
          clients = new Set();
          this.sessionAttachedClients.set(session.id, clients);
        }
        clients.add(ws);

        if (msg.cols && msg.rows) {
          this.sessionRegistry.resize(session.id, msg.cols, msg.rows);
        }

        const recentOutput = this.sessionRegistry.getRecentOutput(session.id);

        this.sendToClient(ws, {
          type: 'session:attached',
          sessionId: session.id,
          cols: session.cols,
          rows: session.rows,
          recentOutput,
        });
        break;
      }

      case 'session:detach': {
        const clients = this.sessionAttachedClients.get(msg.sessionId);
        if (clients) {
          clients.delete(ws);
        }
        this.sendToClient(ws, {
          type: 'session:detached',
          sessionId: msg.sessionId,
        });
        break;
      }

      case 'terminal:input': {
        this.sessionRegistry.write(msg.sessionId, msg.data);
        break;
      }

      case 'terminal:resize': {
        this.sessionRegistry.resize(msg.sessionId, msg.cols, msg.rows);
        break;
      }

      case 'terminal:interrupt': {
        this.sessionRegistry.interrupt(msg.sessionId);
        break;
      }

      case 'terminal:close': {
        this.sessionRegistry.closeSession(msg.sessionId);
        this.sessionAttachedClients.delete(msg.sessionId);
        this.broadcast({
          type: 'session:closed',
          sessionId: msg.sessionId,
        });
        break;
      }
    }
  }

  public sendToClient(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(serializeMessage(message));
    }
  }

  public broadcast(message: ServerMessage): void {
    const serialized = serializeMessage(message);
    for (const client of this.connectedClients) {
      if (client.readyState === WebSocket.OPEN && this.isClientAuthenticated(client)) {
        client.send(serialized);
      }
    }
  }

  public async stop(): Promise<void> {
    this.sessionRegistry.closeAll();

    for (const client of this.connectedClients) {
      try {
        client.terminate();
      } catch {
        // ignore
      }
    }
    this.connectedClients.clear();

    await new Promise<void>((resolve) => {
      if (this.wss) {
        this.wss.close(() => resolve());
      } else {
        resolve();
      }
    });

    await new Promise<void>((resolve) => {
      if (this.httpServer) {
        this.httpServer.close(() => resolve());
      } else {
        resolve();
      }
    });

    if (this.tokenFilePath) {
      try {
        if (fs.existsSync(this.tokenFilePath)) {
          fs.unlinkSync(this.tokenFilePath);
        }
      } catch {
        // ignore
      }
      this.tokenFilePath = undefined;
    }

    this.wss = null;
    this.httpServer = null;
  }
}
