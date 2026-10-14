import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAgentStatus, ElectronApi } from './types.js';
import type { SessionSummary, ExternalProcessSummary } from '@lazyterminal/protocol';

const api: ElectronApi = {
  getAgentStatus: () => ipcRenderer.invoke('agent:status'),
  startAgent: (lanMode = false) => ipcRenderer.invoke('agent:start', lanMode),
  stopAgent: () => ipcRenderer.invoke('agent:stop'),
  refreshSessions: () => ipcRenderer.invoke('session:refresh'),
  createSession: (cols = 80, rows = 24, cwd?: string) =>
    ipcRenderer.invoke('session:create', cols, rows, cwd),
  closeSession: (sessionId: string) => ipcRenderer.invoke('session:close', sessionId),
  attachSession: (sessionId: string) => ipcRenderer.invoke('session:attach', sessionId),
  detachSession: () => ipcRenderer.invoke('session:detach'),
  sendTerminalInput: (data: string) => ipcRenderer.invoke('terminal:input', data),
  sendTerminalResize: (cols: number, rows: number) =>
    ipcRenderer.invoke('terminal:resize', cols, rows),
  spawnManagedFromExternal: (pid: number) =>
    ipcRenderer.invoke('session:spawn-from-external', pid),

  onAgentStatusChange: (callback: (status: DesktopAgentStatus) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: DesktopAgentStatus) => callback(status);
    ipcRenderer.on('agent:status-changed', handler);
    return () => ipcRenderer.removeListener('agent:status-changed', handler);
  },

  onSessionListUpdate: (
    callback: (data: { sessions: SessionSummary[]; externalProcesses: ExternalProcessSummary[] }) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { sessions: SessionSummary[]; externalProcesses: ExternalProcessSummary[] },
    ) => callback(data);
    ipcRenderer.on('session:list-updated', handler);
    return () => ipcRenderer.removeListener('session:list-updated', handler);
  },

  onTerminalOutput: (callback: (data: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: string) => callback(data);
    ipcRenderer.on('terminal:output', handler);
    return () => ipcRenderer.removeListener('terminal:output', handler);
  },

  onSessionClosed: (callback: (sessionId: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, sessionId: string) => callback(sessionId);
    ipcRenderer.on('session:closed', handler);
    return () => ipcRenderer.removeListener('session:closed', handler);
  },
};

contextBridge.exposeInMainWorld('api', api);
