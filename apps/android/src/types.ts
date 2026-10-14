export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'pairing_required'
  | 'authenticating'
  | 'connected'
  | 'error';

export interface TerminalTab {
  id: string; // sessionId
  title: string;
  cols: number;
  rows: number;
  createdAt: number;
  unreadCount?: number;
}

export interface ConnectionConfig {
  host: string;
  port: number;
  token?: string;
  clientName?: string;
}

export interface PairingPrompt {
  challenge: string;
  expiresAt: number;
}
