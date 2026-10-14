import type { IPty } from 'node-pty';

export interface AgentConfig {
  host: string;
  port: number;
  maxSessions: number;
  shellPath?: string;
  shellArgs?: string[];
  devMode?: boolean;
  pairingTimeoutMs?: number;
}

export interface SessionInfo {
  id: string;
  cols: number;
  rows: number;
  cwd: string;
  createdAt: Date;
}

export interface InternalSession extends SessionInfo {
  pty: IPty;
}

export interface CreateSessionOptions {
  cols?: number;
  rows?: number;
  cwd?: string;
}
