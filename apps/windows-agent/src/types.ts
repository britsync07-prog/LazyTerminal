import type { IPty } from 'node-pty';

export type SecurityMode = 'loopback-dev' | 'lan-secure';

export interface AgentConfig {
  host: string;
  port: number;
  maxSessions: number;
  shellPath?: string;
  shellArgs?: string[];
  requireAuth?: boolean;
  pairingTimeoutMs?: number;
}

export interface AgentServerInfo {
  host: string;
  port: number;
  securityMode: SecurityMode;
  requireAuth: boolean;
  isLoopbackOnly: boolean;
  maxSessions: number;
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
