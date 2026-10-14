import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { AgentServer } from '@lazyterminal/windows-agent';
import {
  ClientMessage,
  ServerMessage,
  parseServerMessage,
  serializeMessage,
  ERROR_CODES,
} from '@lazyterminal/protocol';

interface TestClient {
  ws: WebSocket;
  messages: ServerMessage[];
  send: (msg: ClientMessage) => void;
  waitFor: <T extends ServerMessage>(
    predicate: (msg: ServerMessage) => msg is T,
    timeoutMs?: number,
  ) => Promise<T>;
  waitForOutput: (sessionId: string, substring: string, timeoutMs?: number) => Promise<string>;
  close: () => Promise<void>;
}

function createClient(port: number): Promise<TestClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const messages: ServerMessage[] = [];
    const listeners: ((msg: ServerMessage) => void)[] = [];

    ws.on('open', () => {
      const client: TestClient = {
        ws,
        messages,
        send: (msg: ClientMessage) => {
          ws.send(serializeMessage(msg));
        },
        waitFor: <T extends ServerMessage>(
          predicate: (msg: ServerMessage) => msg is T,
          timeoutMs = 12000,
        ): Promise<T> => {
          // Check already received messages
          const existing = messages.find(predicate);
          if (existing) return Promise.resolve(existing);

          return new Promise<T>((res, rej) => {
            const timer = setTimeout(() => {
              const idx = listeners.indexOf(listener);
              if (idx !== -1) listeners.splice(idx, 1);
              rej(new Error(`Timeout waiting for message after ${timeoutMs}ms`));
            }, timeoutMs);

            const listener = (msg: ServerMessage) => {
              if (predicate(msg)) {
                clearTimeout(timer);
                const idx = listeners.indexOf(listener);
                if (idx !== -1) listeners.splice(idx, 1);
                res(msg);
              }
            };

            listeners.push(listener);
          });
        },
        waitForOutput: (sessionId: string, substring: string, timeoutMs = 15000): Promise<string> => {
          let accumulated = '';
          return new Promise<string>((res, rej) => {
            const timer = setTimeout(() => {
              const idx = listeners.indexOf(listener);
              if (idx !== -1) listeners.splice(idx, 1);
              rej(
                new Error(
                  `Timeout waiting for output containing "${substring}" in session "${sessionId}". Accumulated: "${accumulated}"`,
                ),
              );
            }, timeoutMs);

            const listener = (msg: ServerMessage) => {
              if (msg.type === 'terminal:output' && msg.sessionId === sessionId) {
                accumulated += msg.data;
                if (accumulated.includes(substring)) {
                  clearTimeout(timer);
                  const idx = listeners.indexOf(listener);
                  if (idx !== -1) listeners.splice(idx, 1);
                  res(accumulated);
                }
              }
            };

            listeners.push(listener);
          });
        },
        close: () => {
          return new Promise<void>((res) => {
            if (ws.readyState === WebSocket.CLOSED) {
              res();
            } else {
              ws.once('close', () => res());
              ws.close();
            }
          });
        },
      };

      resolve(client);
    });

    ws.on('message', (raw: Buffer | string) => {
      const parsed = parseServerMessage(typeof raw === 'string' ? raw : raw.toString('utf-8'));
      if (parsed.success) {
        messages.push(parsed.data);
        for (const listener of [...listeners]) {
          listener(parsed.data);
        }
      }
    });

    ws.on('error', (err) => {
      reject(err);
    });
  });
}

describe('LazyTerminal Agent Windows Integration Tests', () => {
  let server: AgentServer;
  let serverPort: number;

  beforeAll(async () => {
    // Pick port 0 for dynamic ephemeral port allocation to avoid collision
    server = new AgentServer({ host: '127.0.0.1', port: 0, maxSessions: 5 });
    const address = await server.start();
    serverPort = address.port;
  });

  afterAll(async () => {
    await server.stop();
  });

  afterEach(() => {
    server.sessionRegistry.closeAll();
  });

  it('1 & 2: opens a terminal successfully and runs a PowerShell command with output', async () => {
    const client = await createClient(serverPort);

    try {
      client.send({
        type: 'terminal:create',
        requestId: 'test-req-1',
        cols: 80,
        rows: 24,
      });

      const created = await client.waitFor(
        (m): m is Extract<ServerMessage, { type: 'terminal:created' }> =>
          m.type === 'terminal:created' && m.requestId === 'test-req-1',
      );

      expect(created.sessionId).toBeDefined();
      expect(created.cols).toBe(80);
      expect(created.rows).toBe(24);

      // Give PowerShell a short moment to initialize prompt
      await new Promise((r) => setTimeout(r, 600));

      const outputPromise = client.waitForOutput(created.sessionId, 'INTEGRATION_TEST_HELLO_WORLD');
      client.send({
        type: 'terminal:input',
        sessionId: created.sessionId,
        data: 'Write-Host "INTEGRATION_TEST_HELLO_WORLD"\r\n',
      });

      const output = await outputPromise;
      expect(output).toContain('INTEGRATION_TEST_HELLO_WORLD');
    } finally {
      await client.close();
    }
  }, 20000);

  it('3 & 4: supports multiple independent sessions with isolated variables and delivers input correctly', async () => {
    const client = await createClient(serverPort);

    try {
      // Create session A
      client.send({
        type: 'terminal:create',
        requestId: 'create-session-A',
      });
      const createdA = await client.waitFor(
        (m): m is Extract<ServerMessage, { type: 'terminal:created' }> =>
          m.type === 'terminal:created' && m.requestId === 'create-session-A',
      );

      // Create session B
      client.send({
        type: 'terminal:create',
        requestId: 'create-session-B',
      });
      const createdB = await client.waitFor(
        (m): m is Extract<ServerMessage, { type: 'terminal:created' }> =>
          m.type === 'terminal:created' && m.requestId === 'create-session-B',
      );

      expect(createdA.sessionId).not.toBe(createdB.sessionId);
      expect(server.sessionRegistry.getActiveSessionsCount()).toBe(2);

      await new Promise((r) => setTimeout(r, 600));

      // In Session A: set $env:SESSION_MARKER = 'MARKER_AAA'
      client.send({
        type: 'terminal:input',
        sessionId: createdA.sessionId,
        data: '$varSession = "MARKER_AAA"\r\n',
      });

      // In Session B: set $env:SESSION_MARKER = 'MARKER_BBB'
      client.send({
        type: 'terminal:input',
        sessionId: createdB.sessionId,
        data: '$varSession = "MARKER_BBB"\r\n',
      });

      await new Promise((r) => setTimeout(r, 600));

      // Now query Session A
      const outputPromiseA = client.waitForOutput(createdA.sessionId, 'RESULT_A:MARKER_AAA');
      client.send({
        type: 'terminal:input',
        sessionId: createdA.sessionId,
        data: 'Write-Host "RESULT_A:$varSession"\r\n',
      });
      const outputA = await outputPromiseA;
      expect(outputA).toContain('RESULT_A:MARKER_AAA');
      expect(outputA).not.toContain('MARKER_BBB');

      // Now query Session B
      const outputPromiseB = client.waitForOutput(createdB.sessionId, 'RESULT_B:MARKER_BBB');
      client.send({
        type: 'terminal:input',
        sessionId: createdB.sessionId,
        data: 'Write-Host "RESULT_B:$varSession"\r\n',
      });
      const outputB = await outputPromiseB;
      expect(outputB).toContain('RESULT_B:MARKER_BBB');
      expect(outputB).not.toContain('MARKER_AAA');
    } finally {
      await client.close();
    }
  }, 25000);

  it('5: interrupts a running command using Ctrl+C (terminal:interrupt)', async () => {
    const client = await createClient(serverPort);

    try {
      client.send({
        type: 'terminal:create',
        requestId: 'req-interrupt',
      });
      const created = await client.waitFor(
        (m): m is Extract<ServerMessage, { type: 'terminal:created' }> =>
          m.type === 'terminal:created' && m.requestId === 'req-interrupt',
      );

      await new Promise((r) => setTimeout(r, 600));

      // Run sleep 15s then write SLEEP_FINISHED
      client.send({
        type: 'terminal:input',
        sessionId: created.sessionId,
        data: 'Start-Sleep -Seconds 15; Write-Host "SLEEP_NOT_INTERRUPTED"\r\n',
      });

      // Wait 500ms so Start-Sleep is actively running
      await new Promise((r) => setTimeout(r, 500));

      // Send interrupt
      client.send({
        type: 'terminal:interrupt',
        sessionId: created.sessionId,
      });

      // Send immediate subsequent command to verify terminal returned to prompt
      await new Promise((r) => setTimeout(r, 400));
      const promptPromise = client.waitForOutput(created.sessionId, 'INTERRUPT_CONFIRMED');
      client.send({
        type: 'terminal:input',
        sessionId: created.sessionId,
        data: 'Write-Host "INTERRUPT_CONFIRMED"\r\n',
      });

      const result = await promptPromise;
      expect(result).toContain('INTERRUPT_CONFIRMED');
      expect(result).not.toContain('SLEEP_NOT_INTERRUPTED');
    } finally {
      await client.close();
    }
  }, 20000);

  it('6: resizing updates PTY dimensions in session registry and environment', async () => {
    const client = await createClient(serverPort);

    try {
      client.send({
        type: 'terminal:create',
        requestId: 'req-resize',
        cols: 80,
        rows: 24,
      });
      const created = await client.waitFor(
        (m): m is Extract<ServerMessage, { type: 'terminal:created' }> =>
          m.type === 'terminal:created' && m.requestId === 'req-resize',
      );

      // Resize session
      client.send({
        type: 'terminal:resize',
        sessionId: created.sessionId,
        cols: 120,
        rows: 40,
      });

      // Allow WebSocket event loop to receive and process resize
      await new Promise((r) => setTimeout(r, 250));

      // Check session in registry
      const session = server.sessionRegistry.getSession(created.sessionId);
      expect(session).toBeDefined();
      expect(session?.cols).toBe(120);
      expect(session?.rows).toBe(40);
    } finally {
      await client.close();
    }
  }, 15000);

  it('7: closing a session cleans up the process and registry', async () => {
    const client = await createClient(serverPort);

    try {
      client.send({
        type: 'terminal:create',
        requestId: 'req-close',
      });
      const created = await client.waitFor(
        (m): m is Extract<ServerMessage, { type: 'terminal:created' }> =>
          m.type === 'terminal:created' && m.requestId === 'req-close',
      );

      expect(server.sessionRegistry.getActiveSessionsCount()).toBe(1);

      // Close session
      client.send({
        type: 'terminal:close',
        sessionId: created.sessionId,
      });

      // Wait brief moment for process kill
      await new Promise((r) => setTimeout(r, 400));

      expect(server.sessionRegistry.getActiveSessionsCount()).toBe(0);
      expect(server.sessionRegistry.getSession(created.sessionId)).toBeUndefined();
    } finally {
      await client.close();
    }
  }, 15000);

  it('8: disconnecting a WebSocket client leaves unrelated sessions intact and does not crash server', async () => {
    const client1 = await createClient(serverPort);

    client1.send({
      type: 'terminal:create',
      requestId: 'req-client-1',
    });
    const created1 = await client1.waitFor(
      (m): m is Extract<ServerMessage, { type: 'terminal:created' }> =>
        m.type === 'terminal:created' && m.requestId === 'req-client-1',
    );

    expect(server.sessionRegistry.getActiveSessionsCount()).toBe(1);

    // Now disconnect client 1
    await client1.close();

    // Verify session 1 is still preserved in registry
    expect(server.sessionRegistry.getActiveSessionsCount()).toBe(1);
    expect(server.sessionRegistry.getSession(created1.sessionId)).toBeDefined();

    // Connect Client 2 and verify server is fully operational
    const client2 = await createClient(serverPort);
    try {
      client2.send({
        type: 'terminal:create',
        requestId: 'req-client-2',
      });
      const created2 = await client2.waitFor(
        (m): m is Extract<ServerMessage, { type: 'terminal:created' }> =>
          m.type === 'terminal:created' && m.requestId === 'req-client-2',
      );

      expect(server.sessionRegistry.getActiveSessionsCount()).toBe(2);
      expect(created2.sessionId).not.toBe(created1.sessionId);
    } finally {
      await client2.close();
    }
  }, 15000);

  it('9: gracefully rejects malformed or invalid messages with terminal:error without crashing', async () => {
    const client = await createClient(serverPort);

    try {
      // Send malformed JSON
      client.ws.send('{ invalid-json-payload');

      const errorMsg = await client.waitFor(
        (m): m is Extract<ServerMessage, { type: 'terminal:error' }> =>
          m.type === 'terminal:error' && m.code === ERROR_CODES.INVALID_MESSAGE,
      );

      expect(errorMsg.code).toBe(ERROR_CODES.INVALID_MESSAGE);
      expect(errorMsg.message).toContain('Invalid JSON');

      // Send unknown message type
      client.ws.send(JSON.stringify({ type: 'unknown:type', foo: 'bar' }));
      const errorMsg2 = await client.waitFor(
        (m): m is Extract<ServerMessage, { type: 'terminal:error' }> =>
          m.type === 'terminal:error' && m.code === ERROR_CODES.INVALID_MESSAGE,
      );
      expect(errorMsg2.code).toBe(ERROR_CODES.INVALID_MESSAGE);

      // Server should still respond to ping
      client.send({ type: 'ping', timestamp: 42 });
      const pong = await client.waitFor(
        (m): m is Extract<ServerMessage, { type: 'pong' }> => m.type === 'pong',
      );
      expect(pong.timestamp).toBe(42);
    } finally {
      await client.close();
    }
  }, 15000);

  it('10: enforces authentication when devMode is false, and allows access via pairing flow', async () => {
    // Start an agent with devMode: false to simulate LAN security
    const secureServer = new AgentServer({
      host: '127.0.0.1',
      port: 0,
      devMode: false,
      maxSessions: 3,
    });
    const addr = await secureServer.start();

    const client = await createClient(addr.port);

    try {
      // 1. Unauthenticated client tries to create a terminal -> rejected with UNAUTHORIZED
      client.send({
        type: 'terminal:create',
        requestId: 'unauth-req',
      });

      const unauthErr = await client.waitFor(
        (m): m is Extract<ServerMessage, { type: 'terminal:error' }> =>
          m.type === 'terminal:error' && m.code === ERROR_CODES.UNAUTHORIZED,
      );
      expect(unauthErr.code).toBe(ERROR_CODES.UNAUTHORIZED);

      // 2. Request pairing
      client.send({
        type: 'auth:pair_request',
        clientName: 'Android Device Integration Test',
      });

      const prompt = await client.waitFor(
        (m): m is Extract<ServerMessage, { type: 'auth:pair_prompt' }> =>
          m.type === 'auth:pair_prompt',
      );
      expect(prompt.challenge).toBeDefined();

      const activeReq = secureServer.pairingManager.getActiveRequest();
      expect(activeReq).toBeDefined();
      const code = activeReq!.code;

      // 3. Verify pairing code with wrong code -> returns error
      client.send({
        type: 'auth:pair_verify',
        code: '999999',
      });

      const wrongCodeErr = await client.waitFor(
        (m): m is Extract<ServerMessage, { type: 'terminal:error' }> =>
          m.type === 'terminal:error' && m.code === ERROR_CODES.AUTH_FAILED,
      );
      expect(wrongCodeErr.code).toBe(ERROR_CODES.AUTH_FAILED);

      // 4. Verify pairing code with correct code -> returns token
      client.send({
        type: 'auth:pair_verify',
        code,
      });

      const pairSuccess = await client.waitFor(
        (m): m is Extract<ServerMessage, { type: 'auth:pair_success' }> =>
          m.type === 'auth:pair_success',
      );
      expect(pairSuccess.token).toBeDefined();
      const token = pairSuccess.token;

      // 5. Now client is authenticated! Creating terminal succeeds
      client.send({
        type: 'terminal:create',
        requestId: 'auth-create-req',
      });

      const created = await client.waitFor(
        (m): m is Extract<ServerMessage, { type: 'terminal:created' }> =>
          m.type === 'terminal:created' && m.requestId === 'auth-create-req',
      );
      expect(created.sessionId).toBeDefined();

      // 6. Connect a NEW client using auth:connect with the paired token
      const client2 = await createClient(addr.port);
      try {
        client2.send({
          type: 'auth:connect',
          token,
        });

        const authOk = await client2.waitFor(
          (m): m is Extract<ServerMessage, { type: 'auth:success' }> =>
            m.type === 'auth:success',
        );
        expect(authOk.type).toBe('auth:success');

        // Can now create terminal from client2
        client2.send({
          type: 'terminal:create',
          requestId: 'client2-create',
        });

        const created2 = await client2.waitFor(
          (m): m is Extract<ServerMessage, { type: 'terminal:created' }> =>
            m.type === 'terminal:created' && m.requestId === 'client2-create',
        );
        expect(created2.sessionId).toBeDefined();
      } finally {
        await client2.close();
      }
    } finally {
      await client.close();
      await secureServer.stop();
    }
  }, 20000);
});
