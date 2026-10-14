import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import {
  parseClientMessage,
  serializeMessage,
  ERROR_CODES,
  MAX_RAW_MESSAGE_BYTES,
  ServerMessage,
} from '@lazyterminal/protocol';
import { SessionRegistry, SessionRegistryError } from './session-registry.js';
import type { AgentConfig } from './types.js';

export class AgentServer {
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  public readonly sessionRegistry: SessionRegistry;
  private readonly config: AgentConfig;
  private readonly connectedClients = new Set<WebSocket>();

  constructor(config?: Partial<AgentConfig>) {
    const host = config?.host ?? '127.0.0.1';
    // STRICT SECURITY: For Task 001, agent MUST only bind to loopback address
    if (host !== '127.0.0.1' && host !== 'localhost') {
      throw new Error(`Security violation: LazyTerminal agent must bind strictly to 127.0.0.1 (attempted: ${host})`);
    }

    this.config = {
      host: '127.0.0.1',
      port: config?.port ?? 4488,
      maxSessions: config?.maxSessions ?? 10,
      shellPath: config?.shellPath,
      shellArgs: config?.shellArgs,
    };

    this.sessionRegistry = new SessionRegistry({
      maxSessions: this.config.maxSessions,
      shellPath: this.config.shellPath,
      shellArgs: this.config.shellArgs,
    });

    this.setupRegistryEvents();
  }

  private setupRegistryEvents(): void {
    // When a session produces output, broadcast it to connected clients
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
        // Enforce loopback check on remote address
        const remoteAddress = req.socket.remoteAddress;
        if (remoteAddress !== '127.0.0.1' && remoteAddress !== '::1' && remoteAddress !== '::ffff:127.0.0.1') {
          ws.close(1008, 'Forbidden: remote connections not permitted');
          return;
        }

        this.connectedClients.add(ws);

        ws.on('message', async (raw: Buffer | string) => {
          await this.handleClientMessage(ws, raw);
        });

        ws.on('error', (err) => {
          // Log connection error without crashing
          console.error('[AgentServer] Client socket error:', err.message);
        });

        ws.on('close', () => {
          this.connectedClients.delete(ws);
          // Notice: disconnected clients do NOT kill active sessions
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

  private async handleClientMessage(ws: WebSocket, raw: Buffer | string): Promise<void> {
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

    try {
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

        case 'ping': {
          this.sendToClient(ws, {
            type: 'pong',
            timestamp: msg.timestamp,
          });
          break;
        }
      }
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
