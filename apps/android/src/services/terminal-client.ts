import {
  parseServerMessage,
  serializeMessage,
  ClientMessage,
  ServerMessage,
  DEFAULT_COLS,
  DEFAULT_ROWS,
} from '@lazyterminal/protocol';
import type { ConnectionState, TerminalTab, ConnectionConfig, PairingPrompt } from '../types';

export type StateListener = (state: ConnectionState, error?: string) => void;
export type OutputListener = (sessionId: string, data: string) => void;
export type SessionCreatedListener = (tab: TerminalTab) => void;
export type SessionClosedListener = (sessionId: string) => void;
export type PairPromptListener = (prompt: PairingPrompt) => void;

export class TerminalClient {
  private ws: WebSocket | null = null;
  private state: ConnectionState = 'disconnected';
  private config: ConnectionConfig | null = null;
  private tabs: TerminalTab[] = [];
  private activeTabId: string | null = null;
  private authToken: string | null = null;
  private sessionOutputHistory = new Map<string, string>();
  private pendingCreateRequests = new Map<
    string,
    { resolve: (sessionId: string) => void; reject: (err: Error) => void }
  >();

  // Event listeners
  private stateListeners = new Set<StateListener>();
  private outputListeners = new Set<OutputListener>();
  private sessionCreatedListeners = new Set<SessionCreatedListener>();
  private sessionClosedListeners = new Set<SessionClosedListener>();
  private pairPromptListeners = new Set<PairPromptListener>();

  constructor() {}

  public getState(): ConnectionState {
    return this.state;
  }

  public getTabs(): TerminalTab[] {
    return [...this.tabs];
  }

  public getActiveTab(): TerminalTab | undefined {
    return this.tabs.find((t) => t.id === this.activeTabId);
  }

  public getActiveTabId(): string | null {
    return this.activeTabId;
  }

  public setActiveTabId(id: string): void {
    if (this.tabs.some((t) => t.id === id)) {
      this.activeTabId = id;
    }
  }

  public getSessionHistory(sessionId: string): string {
    return this.sessionOutputHistory.get(sessionId) || '';
  }

  public refreshSessionList(): void {
    this.sendMessage({ type: 'session:list' });
  }

  public onStateChange(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  public onOutput(listener: OutputListener): () => void {
    this.outputListeners.add(listener);
    return () => this.outputListeners.delete(listener);
  }

  public onSessionCreated(listener: SessionCreatedListener): () => void {
    this.sessionCreatedListeners.add(listener);
    return () => this.sessionCreatedListeners.delete(listener);
  }

  public onSessionClosed(listener: SessionClosedListener): () => void {
    this.sessionClosedListeners.add(listener);
    return () => this.sessionClosedListeners.delete(listener);
  }

  public onPairPrompt(listener: PairPromptListener): () => void {
    this.pairPromptListeners.add(listener);
    return () => this.pairPromptListeners.delete(listener);
  }

  private setState(state: ConnectionState, error?: string): void {
    this.state = state;
    for (const listener of this.stateListeners) {
      listener(state, error);
    }
  }

  public connect(config: ConnectionConfig): void {
    this.disconnect();
    this.config = config;
    if (config.token) {
      this.authToken = config.token;
    }

    this.setState('connecting');

    try {
      const url = `ws://${config.host}:${config.port}`;
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        // If we have an existing token, attempt auth:connect
        if (this.authToken) {
          this.setState('authenticating');
          this.sendMessage({
            type: 'auth:connect',
            token: this.authToken,
          });
        } else {
          // Send pair request to discover if server requires pairing
          this.sendMessage({
            type: 'auth:pair_request',
            clientName: config.clientName || 'Android Mobile',
          });
        }
      };

      ws.onmessage = (event) => {
        const raw = typeof event.data === 'string' ? event.data : '';
        this.handleServerMessage(raw);
      };

      ws.onerror = (err) => {
        this.setState('error', 'Unable to connect to Windows Agent. Check IP and port.');
      };

      ws.onclose = () => {
        this.setState('disconnected');
      };
    } catch (err) {
      this.setState('error', (err as Error).message);
    }
  }

  public submitPairingCode(code: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to agent');
    }
    this.sendMessage({
      type: 'auth:pair_verify',
      code: code.trim(),
    });
  }

  public async createTerminal(cols = DEFAULT_COLS, rows = DEFAULT_ROWS, cwd?: string): Promise<string> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to terminal agent');
    }

    const requestId = `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    return new Promise<string>((resolve, reject) => {
      this.pendingCreateRequests.set(requestId, { resolve, reject });

      this.sendMessage({
        type: 'terminal:create',
        requestId,
        cols,
        rows,
        cwd,
      });

      // Timeout after 15s
      setTimeout(() => {
        if (this.pendingCreateRequests.has(requestId)) {
          this.pendingCreateRequests.delete(requestId);
          reject(new Error('Timeout waiting for terminal session creation'));
        }
      }, 15000);
    });
  }

  public sendInput(sessionId: string, data: string): void {
    this.sendMessage({
      type: 'terminal:input',
      sessionId,
      data,
    });
  }

  public resizeTerminal(sessionId: string, cols: number, rows: number): void {
    const tab = this.tabs.find((t) => t.id === sessionId);
    if (tab) {
      tab.cols = cols;
      tab.rows = rows;
    }
    this.sendMessage({
      type: 'terminal:resize',
      sessionId,
      cols,
      rows,
    });
  }

  public sendInterrupt(sessionId: string): void {
    this.sendMessage({
      type: 'terminal:interrupt',
      sessionId,
    });
  }

  public closeTerminal(sessionId: string): void {
    this.sendMessage({
      type: 'terminal:close',
      sessionId,
    });
    this.removeTab(sessionId);
  }

  private removeTab(sessionId: string): void {
    const index = this.tabs.findIndex((t) => t.id === sessionId);
    if (index !== -1) {
      this.tabs.splice(index, 1);
      if (this.activeTabId === sessionId) {
        this.activeTabId = this.tabs.length > 0 ? this.tabs[Math.max(0, index - 1)].id : null;
      }
      for (const listener of this.sessionClosedListeners) {
        listener(sessionId);
      }
    }
  }

  private handleServerMessage(rawString: string): void {
    const parseResult = parseServerMessage(rawString);
    if (!parseResult.success) {
      return;
    }

    const msg = parseResult.data;

    switch (msg.type) {
      case 'auth:pair_prompt': {
        this.setState('pairing_required');
        for (const listener of this.pairPromptListeners) {
          listener({
            challenge: msg.challenge,
            expiresAt: msg.expiresAt,
          });
        }
        break;
      }

      case 'auth:pair_success': {
        this.authToken = msg.token;
        this.setState('connected');
        this.refreshSessionList();
        break;
      }

      case 'auth:success': {
        this.setState('connected');
        this.refreshSessionList();
        break;
      }

      case 'session:list_response': {
        for (const sess of msg.sessions) {
          if (!this.tabs.some((t) => t.id === sess.sessionId)) {
            const newTab: TerminalTab = {
              id: sess.sessionId,
              title: `Terminal ${this.tabs.length + 1}`,
              cols: sess.cols,
              rows: sess.rows,
              createdAt: sess.createdAt,
            };
            this.tabs.push(newTab);
            for (const listener of this.sessionCreatedListeners) {
              listener(newTab);
            }
          }
        }
        if (!this.activeTabId && this.tabs.length > 0) {
          this.activeTabId = this.tabs[0].id;
        }
        break;
      }

      case 'session:created': {
        if (!this.tabs.some((t) => t.id === msg.session.sessionId)) {
          const newTab: TerminalTab = {
            id: msg.session.sessionId,
            title: `Terminal ${this.tabs.length + 1}`,
            cols: msg.session.cols,
            rows: msg.session.rows,
            createdAt: msg.session.createdAt,
          };
          this.tabs.push(newTab);
          if (!this.activeTabId) {
            this.activeTabId = newTab.id;
          }
          for (const listener of this.sessionCreatedListeners) {
            listener(newTab);
          }
        }
        break;
      }

      case 'session:closed': {
        this.removeTab(msg.sessionId);
        break;
      }

      case 'session:attached': {
        if (msg.recentOutput) {
          this.sessionOutputHistory.set(msg.sessionId, msg.recentOutput.slice(-65536));
          for (const listener of this.outputListeners) {
            listener(msg.sessionId, msg.recentOutput);
          }
        }
        break;
      }

      case 'terminal:created': {
        const pending = this.pendingCreateRequests.get(msg.requestId);
        if (pending) {
          this.pendingCreateRequests.delete(msg.requestId);

          if (!this.tabs.some((t) => t.id === msg.sessionId)) {
            const newTab: TerminalTab = {
              id: msg.sessionId,
              title: `Terminal ${this.tabs.length + 1}`,
              cols: msg.cols,
              rows: msg.rows,
              createdAt: Date.now(),
            };

            this.tabs.push(newTab);
            this.activeTabId = newTab.id;

            for (const listener of this.sessionCreatedListeners) {
              listener(newTab);
            }
          }

          pending.resolve(msg.sessionId);
        }
        break;
      }

      case 'terminal:output': {
        const prev = this.sessionOutputHistory.get(msg.sessionId) || '';
        this.sessionOutputHistory.set(msg.sessionId, (prev + msg.data).slice(-65536));
        for (const listener of this.outputListeners) {
          listener(msg.sessionId, msg.data);
        }
        break;
      }

      case 'terminal:exit': {
        this.removeTab(msg.sessionId);
        break;
      }

      case 'terminal:error': {
        if (msg.requestId && this.pendingCreateRequests.has(msg.requestId)) {
          const pending = this.pendingCreateRequests.get(msg.requestId)!;
          this.pendingCreateRequests.delete(msg.requestId);
          pending.reject(new Error(msg.message));
        }

        if (msg.code === 'UNAUTHORIZED' || msg.code === 'AUTH_FAILED') {
          this.setState('pairing_required', msg.message);
        } else {
          for (const listener of this.stateListeners) {
            listener(this.state, msg.message);
          }
        }
        break;
      }
    }
  }

  private sendMessage(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(serializeMessage(msg));
    }
  }

  public disconnect(): void {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.setState('disconnected');
    this.tabs = [];
    this.activeTabId = null;
  }
}
