import EventEmitter from 'node:events';
import crypto from 'node:crypto';
import os from 'node:os';
import * as pty from 'node-pty';
import {
  DEFAULT_COLS,
  DEFAULT_ROWS,
  ERROR_CODES,
} from '@lazyterminal/protocol';
import type { InternalSession, CreateSessionOptions, SessionInfo } from './types.js';

export class SessionRegistryError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SessionRegistryError';
  }
}

export interface SessionRegistryEvents {
  data: (sessionId: string, data: string) => void;
  exit: (sessionId: string, exitCode: number) => void;
  error: (sessionId: string, error: Error) => void;
}

export class SessionRegistry extends EventEmitter {
  private readonly sessions = new Map<string, InternalSession>();
  private readonly maxSessions: number;
  private readonly defaultShell: string;
  private readonly defaultShellArgs: string[];

  constructor(options?: {
    maxSessions?: number;
    shellPath?: string;
    shellArgs?: string[];
  }) {
    super();
    this.maxSessions = options?.maxSessions ?? 10;
    this.defaultShell =
      options?.shellPath ??
      (os.platform() === 'win32'
        ? (process.env.COMSPEC?.toLowerCase().includes('powershell')
            ? process.env.COMSPEC
            : 'powershell.exe')
        : (process.env.SHELL ?? '/bin/sh'));
    this.defaultShellArgs = options?.shellArgs ?? (os.platform() === 'win32' ? ['-NoLogo', '-NoProfile'] : []);
  }

  public getActiveSessionsCount(): number {
    return this.sessions.size;
  }

  public getSession(sessionId: string): SessionInfo | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    return {
      id: session.id,
      cols: session.cols,
      rows: session.rows,
      cwd: session.cwd,
      createdAt: session.createdAt,
      pid: session.pty.pid,
      shell: session.shell,
      title: session.title,
    };
  }

  public getAllSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      cols: s.cols,
      rows: s.rows,
      cwd: s.cwd,
      createdAt: s.createdAt,
      pid: s.pty.pid,
      shell: s.shell,
      title: s.title,
    }));
  }

  public getManagedPids(): number[] {
    return Array.from(this.sessions.values())
      .map((s) => s.pty.pid)
      .filter((pid): pid is number => typeof pid === 'number');
  }

  public getRecentOutput(sessionId: string): string | undefined {
    const session = this.sessions.get(sessionId);
    return session?.outputBuffer;
  }

  public async createSession(options?: CreateSessionOptions): Promise<SessionInfo> {
    if (this.sessions.size >= this.maxSessions) {
      throw new SessionRegistryError(
        ERROR_CODES.SESSION_LIMIT_REACHED,
        `Maximum session limit of ${this.maxSessions} reached`,
      );
    }

    const sessionId = crypto.randomUUID();
    const cols = options?.cols ?? DEFAULT_COLS;
    const rows = options?.rows ?? DEFAULT_ROWS;
    const cwd = options?.cwd || process.env.USERPROFILE || process.cwd();

    let ptyProcess: pty.IPty;
    try {
      ptyProcess = pty.spawn(this.defaultShell, this.defaultShellArgs, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: process.env as { [key: string]: string },
        useConpty: os.platform() === 'win32',
      });
    } catch (err) {
      throw new SessionRegistryError(
        ERROR_CODES.PTY_SPAWN_ERROR,
        `Failed to spawn PTY process (${this.defaultShell}): ${(err as Error).message}`,
      );
    }

    const session: InternalSession = {
      id: sessionId,
      cols,
      rows,
      cwd,
      createdAt: new Date(),
      pty: ptyProcess,
      pid: ptyProcess.pid,
      shell: this.defaultShell,
      title: 'PowerShell',
      outputBuffer: '',
    };

    this.sessions.set(sessionId, session);

    ptyProcess.onData((data: string) => {
      session.outputBuffer = (session.outputBuffer + data).slice(-65536);
      this.emit('data', sessionId, data);
    });

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      this.sessions.delete(sessionId);
      this.emit('exit', sessionId, exitCode ?? 0);
      this.emit('closed', sessionId, exitCode ?? 0);
    });

    const sessionInfo: SessionInfo = {
      id: session.id,
      cols: session.cols,
      rows: session.rows,
      cwd: session.cwd,
      createdAt: session.createdAt,
      pid: session.pid,
      shell: session.shell,
      title: session.title,
    };

    this.emit('created', sessionInfo);

    return sessionInfo;
  }

  public write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new SessionRegistryError(
        ERROR_CODES.SESSION_NOT_FOUND,
        `Session with ID "${sessionId}" not found`,
      );
    }

    session.pty.write(data);
  }

  public resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new SessionRegistryError(
        ERROR_CODES.SESSION_NOT_FOUND,
        `Session with ID "${sessionId}" not found`,
      );
    }

    try {
      session.pty.resize(cols, rows);
      session.cols = cols;
      session.rows = rows;
    } catch (err) {
      throw new SessionRegistryError(
        ERROR_CODES.INTERNAL_ERROR,
        `Failed to resize PTY: ${(err as Error).message}`,
      );
    }
  }

  public interrupt(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new SessionRegistryError(
        ERROR_CODES.SESSION_NOT_FOUND,
        `Session with ID "${sessionId}" not found`,
      );
    }

    // Send Ctrl+C (ASCII 0x03) to the interactive terminal
    session.pty.write('\x03');
  }

  public closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new SessionRegistryError(
        ERROR_CODES.SESSION_NOT_FOUND,
        `Session with ID "${sessionId}" not found`,
      );
    }

    try {
      session.pty.kill();
    } catch {
      // Ignore if process already died
    } finally {
      this.sessions.delete(sessionId);
    }
  }

  public closeAll(): void {
    for (const [id, session] of this.sessions.entries()) {
      try {
        session.pty.kill();
      } catch {
        // Ignore kill errors on teardown
      }
    }
    this.sessions.clear();
  }
}
