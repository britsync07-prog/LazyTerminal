import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TerminalClient } from '../src/services/terminal-client';
import { serializeMessage, ServerMessage } from '@lazyterminal/protocol';

// Mock browser/React Native WebSocket
class MockWebSocket {
  public static readonly CONNECTING = 0;
  public static readonly OPEN = 1;
  public static readonly CLOSING = 2;
  public static readonly CLOSED = 3;

  public static instances: MockWebSocket[] = [];
  public readyState: number = MockWebSocket.CONNECTING;
  public url: string;
  public onopen: (() => void) | null = null;
  public onmessage: ((event: { data: string }) => void) | null = null;
  public onerror: ((error: any) => void) | null = null;
  public onclose: (() => void) | null = null;
  public sentMessages: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    // Auto-open on next tick
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      if (this.onopen) this.onopen();
    }, 5);
  }

  public send(data: string) {
    this.sentMessages.push(data);
  }

  public close() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose();
  }

  public emitServerMessage(msg: ServerMessage) {
    if (this.onmessage) {
      this.onmessage({ data: serializeMessage(msg) });
    }
  }
}

describe('TerminalClient (Mobile Protocol Service)', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  it('initializes in disconnected state with empty tabs', () => {
    const client = new TerminalClient();
    expect(client.getState()).toBe('disconnected');
    expect(client.getTabs()).toEqual([]);
    expect(client.getActiveTabId()).toBeNull();
  });

  it('connects to agent and transitions through connecting state', async () => {
    const client = new TerminalClient();
    const states: string[] = [];
    client.onStateChange((state) => states.push(state));

    client.connect({ host: '192.168.1.50', port: 4488 });
    expect(client.getState()).toBe('connecting');

    // Wait for mock websocket to open
    await new Promise((r) => setTimeout(r, 20));

    const ws = MockWebSocket.instances[0];
    expect(ws).toBeDefined();
    expect(ws.url).toBe('ws://192.168.1.50:4488');

    // It should have sent auth:pair_request
    expect(ws.sentMessages.length).toBeGreaterThan(0);
    const sent = JSON.parse(ws.sentMessages[0]);
    expect(sent.type).toBe('auth:pair_request');
  });

  it('handles auth:pair_prompt by emitting pairing required and challenge prompt', async () => {
    const client = new TerminalClient();
    let promptReceived: any = null;
    client.onPairPrompt((p) => {
      promptReceived = p;
    });

    client.connect({ host: '127.0.0.1', port: 4488 });
    await new Promise((r) => setTimeout(r, 20));

    const ws = MockWebSocket.instances[0];
    ws.emitServerMessage({
      type: 'auth:pair_prompt',
      challenge: 'Enter code shown on PC',
      expiresAt: 123456789,
    });

    expect(client.getState()).toBe('pairing_required');
    expect(promptReceived).toEqual({
      challenge: 'Enter code shown on PC',
      expiresAt: 123456789,
    });
  });

  it('submits pairing code and transitions to connected on auth:pair_success', async () => {
    const client = new TerminalClient();
    client.connect({ host: '127.0.0.1', port: 4488 });
    await new Promise((r) => setTimeout(r, 20));

    const ws = MockWebSocket.instances[0];
    client.submitPairingCode('482915');

    expect(ws.sentMessages.length).toBeGreaterThan(0);
    const sent = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
    expect(sent.type).toBe('auth:pair_verify');
    expect(sent.code).toBe('482915');

    ws.emitServerMessage({
      type: 'auth:pair_success',
      token: 'secure-token-123',
    });

    expect(client.getState()).toBe('connected');
  });

  it('creates terminal sessions and tracks tabs', async () => {
    const client = new TerminalClient();
    client.connect({ host: '127.0.0.1', port: 4488 });
    await new Promise((r) => setTimeout(r, 20));

    const ws = MockWebSocket.instances[0];
    ws.emitServerMessage({ type: 'auth:success' });

    const createPromise = client.createTerminal(100, 30);

    expect(ws.sentMessages.length).toBeGreaterThan(0);
    const sent = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
    expect(sent.type).toBe('terminal:create');
    expect(sent.cols).toBe(100);
    expect(sent.rows).toBe(30);

    // Server acknowledges
    ws.emitServerMessage({
      type: 'terminal:created',
      requestId: sent.requestId,
      sessionId: 'sess-uuid-1',
      cols: 100,
      rows: 30,
    });

    const sessionId = await createPromise;
    expect(sessionId).toBe('sess-uuid-1');
    expect(client.getTabs().length).toBe(1);
    expect(client.getActiveTabId()).toBe('sess-uuid-1');
  });

  it('routes terminal output to registered listeners', async () => {
    const client = new TerminalClient();
    client.connect({ host: '127.0.0.1', port: 4488 });
    await new Promise((r) => setTimeout(r, 20));

    const ws = MockWebSocket.instances[0];
    ws.emitServerMessage({ type: 'auth:success' });

    const outputs: { id: string; data: string }[] = [];
    client.onOutput((id, data) => outputs.push({ id, data }));

    ws.emitServerMessage({
      type: 'terminal:output',
      sessionId: 'sess-uuid-1',
      data: 'PS C:\\> ',
    });

    expect(outputs).toEqual([{ id: 'sess-uuid-1', data: 'PS C:\\> ' }]);
  });

  it('removes tab on terminal:exit or closeTerminal', async () => {
    const client = new TerminalClient();
    client.connect({ host: '127.0.0.1', port: 4488 });
    await new Promise((r) => setTimeout(r, 20));

    const ws = MockWebSocket.instances[0];
    ws.emitServerMessage({ type: 'auth:success' });

    const p = client.createTerminal();
    const sent = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
    ws.emitServerMessage({
      type: 'terminal:created',
      requestId: sent.requestId,
      sessionId: 'sess-to-close',
      cols: 80,
      rows: 24,
    });
    await p;

    expect(client.getTabs().length).toBe(1);

    client.closeTerminal('sess-to-close');
    expect(client.getTabs().length).toBe(0);
    expect(client.getActiveTabId()).toBeNull();

    const closeSent = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
    expect(closeSent.type).toBe('terminal:close');
    expect(closeSent.sessionId).toBe('sess-to-close');
  });

  it('mirrors externally created sessions and maintains output history', async () => {
    const client = new TerminalClient();
    client.connect({ host: '127.0.0.1', port: 4488 });
    await new Promise((r) => setTimeout(r, 20));

    const ws = MockWebSocket.instances[0];
    ws.emitServerMessage({ type: 'auth:success' });

    // Simulate session created from PC viewer or another client
    ws.emitServerMessage({
      type: 'session:created',
      session: {
        sessionId: 'sess-pc-1',
        shell: 'powershell.exe',
        cols: 120,
        rows: 30,
        createdAt: Date.now(),
        attachedClients: 1,
        status: 'active',
        title: 'PowerShell',
      },
    });

    expect(client.getTabs().length).toBe(1);
    expect(client.getActiveTabId()).toBe('sess-pc-1');

    // Output arrives for this session
    ws.emitServerMessage({
      type: 'terminal:output',
      sessionId: 'sess-pc-1',
      data: 'Hello from PC\r\n',
    });

    expect(client.getSessionHistory('sess-pc-1')).toBe('Hello from PC\r\n');

    // Closed from PC
    ws.emitServerMessage({
      type: 'session:closed',
      sessionId: 'sess-pc-1',
      exitCode: 0,
    });

    expect(client.getTabs().length).toBe(0);
    expect(client.getActiveTabId()).toBeNull();
  });
});
