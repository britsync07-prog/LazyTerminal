import http from 'node:http';
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
import type { AgentConfig } from './types.js';

export class AgentServer {
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  public readonly sessionRegistry: SessionRegistry;
  public readonly pairingManager: PairingManager;
  private readonly config: AgentConfig;
  private readonly connectedClients = new Set<WebSocket>();
  private readonly authenticatedClients = new WeakSet<WebSocket>();

  constructor(config?: Partial<AgentConfig>) {
    const host = config?.host ?? '127.0.0.1';
    const isLoopback = host === '127.0.0.1' || host === 'localhost';

    this.config = {
      host,
      port: config?.port ?? 4488,
      maxSessions: config?.maxSessions ?? 10,
      shellPath: config?.shellPath,
      shellArgs: config?.shellArgs,
      devMode: config?.devMode ?? isLoopback,
      pairingTimeoutMs: config?.pairingTimeoutMs,
    };

    this.sessionRegistry = new SessionRegistry({
      maxSessions: this.config.maxSessions,
      shellPath: this.config.shellPath,
      shellArgs: this.config.shellArgs,
    });

    this.pairingManager = new PairingManager({
      pairingTimeoutMs: this.config.pairingTimeoutMs,
    });

    this.setupRegistryEvents();
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
      this.broadcast({
        type: 'terminal:exit',
        sessionId,
        exitCode,
      });
    });
  }

  private isClientAuthenticated(ws: WebSocket, req: http.IncomingMessage): boolean {
    // In devMode on loopback, client is automatically authenticated
    const remoteAddress = req.socket.remoteAddress;
    const isLoopback =
      remoteAddress === '127.0.0.1' ||
      remoteAddress === '::1' ||
      remoteAddress === '::ffff:127.0.0.1';

    if (this.config.devMode && isLoopback) {
      return true;
    }

    return this.authenticatedClients.has(ws);
  }

  public async start(): Promise<{ host: string; port: number }> {
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

        // If server is strictly bound to loopback and client is not loopback, reject
        if ((this.config.host === '127.0.0.1' || this.config.host === 'localhost') && !isLoopback) {
          ws.close(1008, 'Forbidden: remote connections not permitted in loopback mode');
          return;
        }

        this.connectedClients.add(ws);

        ws.on('message', async (raw: Buffer | string) => {
          await this.handleClientMessage(ws, req, raw);
        });

        ws.on('error', (err) => {
          console.error('[AgentServer] Client socket error:', err.message);
        });

        ws.on('close', () => {
          this.connectedClients.delete(ws);
        });
      });

      wss.on('error', (err) => {
        reject(err);
      });

      server.listen(this.config.port, this.config.host, () => {
        this.httpServer = server;
        this.wss = wss;
        const address = server.address();
        const actualPort = typeof address === 'object' && address ? address.port : this.config.port;
        resolve({ host: this.config.host, port: actualPort });
      });

      server.on('error', (err) => {
        reject(err);
      });
    });
  }

  private async handleClientMessage(
    ws: WebSocket,
    req: http.IncomingMessage,
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
      const pairResult = this.pairingManager.requestPairing(msg.clientName, this.config.devMode);
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
    if (!this.isClientAuthenticated(ws, req)) {
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

        this.sendToClient(ws, {
          type: 'terminal:created',
          requestId: msg.requestId,
          sessionId: session.id,
          cols: session.cols,
          rows: session.rows,
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
      if (client.readyState === WebSocket.OPEN) {
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

    this.wss = null;
    this.httpServer = null;
  }
}
