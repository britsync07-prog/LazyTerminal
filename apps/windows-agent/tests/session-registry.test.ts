import { describe, it, expect, afterEach } from 'vitest';
import { SessionRegistry } from '../src/session-registry.js';
import { ERROR_CODES } from '@lazyterminal/protocol';

describe('SessionRegistry', () => {
  let registry: SessionRegistry;

  afterEach(() => {
    if (registry) {
      registry.closeAll();
    }
  });

  it('generates unique session IDs and creates sessions', async () => {
    registry = new SessionRegistry({ maxSessions: 5 });

    const session1 = await registry.createSession();
    const session2 = await registry.createSession();

    expect(session1.id).toBeDefined();
    expect(session2.id).toBeDefined();
    expect(session1.id).not.toBe(session2.id);
    expect(registry.getActiveSessionsCount()).toBe(2);

    expect(registry.getSession(session1.id)?.id).toBe(session1.id);
    expect(registry.getSession(session2.id)?.id).toBe(session2.id);
  });

  it('enforces maximum concurrent session limit', async () => {
    registry = new SessionRegistry({ maxSessions: 2 });

    await registry.createSession();
    await registry.createSession();

    await expect(registry.createSession()).rejects.toThrowError(
      /Maximum session limit of 2 reached/,
    );
  });

  it('throws SESSION_NOT_FOUND when operating on unknown session', () => {
    registry = new SessionRegistry();

    expect(() => registry.write('unknown-id', 'test')).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.SESSION_NOT_FOUND }),
    );

    expect(() => registry.resize('unknown-id', 100, 30)).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.SESSION_NOT_FOUND }),
    );

    expect(() => registry.interrupt('unknown-id')).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.SESSION_NOT_FOUND }),
    );

    expect(() => registry.closeSession('unknown-id')).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.SESSION_NOT_FOUND }),
    );
  });

  it('cleans up session when explicitly closed', async () => {
    registry = new SessionRegistry();

    const session = await registry.createSession();
    expect(registry.getActiveSessionsCount()).toBe(1);

    registry.closeSession(session.id);
    expect(registry.getActiveSessionsCount()).toBe(0);
    expect(registry.getSession(session.id)).toBeUndefined();
  });

  it('cleans up all sessions on closeAll()', async () => {
    registry = new SessionRegistry();

    await registry.createSession();
    await registry.createSession();
    expect(registry.getActiveSessionsCount()).toBe(2);

    registry.closeAll();
    expect(registry.getActiveSessionsCount()).toBe(0);
  });

  it('receives terminal output from real PowerShell session on Windows', async () => {
    registry = new SessionRegistry();
    const session = await registry.createSession();

    const outputPromise = new Promise<string>((resolve) => {
      let accumulated = '';
      const onData = (sessionId: string, data: string) => {
        if (sessionId === session.id) {
          accumulated += data;
          if (accumulated.includes('POWERSHELL_TEST_OK')) {
            registry.off('data', onData);
            resolve(accumulated);
          }
        }
      };
      registry.on('data', onData);
    });

    // Wait a brief tick for the shell to finish initial setup
    await new Promise((r) => setTimeout(r, 600));
    registry.write(session.id, 'Write-Host "POWERSHELL_TEST_OK"\r\n');

    const result = await Promise.race([
      outputPromise,
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout waiting for PowerShell output')), 12000),
      ),
    ]);

    expect(result).toContain('POWERSHELL_TEST_OK');
  }, 15000);
});
