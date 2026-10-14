import type {
  SessionSummary,
  ExternalProcessSummary,
} from '@lazyterminal/protocol';

export interface DesktopAgentStatus {
  isRunning: boolean;
  isManagedByApp: boolean;
  host: string;
  port: number;
  securityMode: 'loopback-dev' | 'lan-secure';
  requireAuth: boolean;
  authToken?: string;
  tokenFilePath?: string;
  activeSessionsCount: number;
  error?: string;
}

export interface ElectronApi {
  getAgentStatus: () => Promise<DesktopAgentStatus>;
  startAgent: (lanMode?: boolean) => Promise<DesktopAgentStatus>;
  stopAgent: () => Promise<DesktopAgentStatus>;
  refreshSessions: () => Promise<{ sessions: SessionSummary[]; externalProcesses: ExternalProcessSummary[] }>;
  createSession: (cols?: number, rows?: number, cwd?: string) => Promise<string>;
  closeSession: (sessionId: string) => Promise<void>;
  attachSession: (sessionId: string) => Promise<void>;
  detachSession: () => Promise<void>;
  sendTerminalInput: (data: string) => Promise<void>;
  sendTerminalResize: (cols: number, rows: number) => Promise<void>;
  spawnManagedFromExternal: (pid: number) => Promise<string>;
  onAgentStatusChange: (callback: (status: DesktopAgentStatus) => void) => () => void;
  onSessionListUpdate: (callback: (data: { sessions: SessionSummary[]; externalProcesses: ExternalProcessSummary[] }) => void) => () => void;
  onTerminalOutput: (callback: (data: string) => void) => () => void;
  onSessionClosed: (callback: (sessionId: string) => void) => () => void;
}
