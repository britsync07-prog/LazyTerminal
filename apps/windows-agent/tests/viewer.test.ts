import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getCliArg,
  resolveViewerTargetHost,
  resolveAuthToken,
  saveViewerToken,
  clearSavedViewerToken,
  PcViewer,
} from '../src/viewer.js';
import { ERROR_CODES } from '@lazyterminal/protocol';

describe('PC Viewer Host & Token Resolution', () => {
  const originalEnv = { ...process.env };
  const originalArgv = [...process.argv];

  beforeEach(() => {
    delete process.env.LAZYTERMINAL_HOST;
    delete process.env.LAZYTERMINAL_VIEWER_HOST;
    delete process.env.LAZYTERMINAL_TOKEN;
    process.argv = ['node', 'viewer.js'];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    process.argv = [...originalArgv];
    vi.restoreAllMocks();
  });

  describe('getCliArg', () => {
    it('extracts arguments with flag', () => {
      expect(getCliArg(['--host', '192.168.1.10'], '--host')).toBe('192.168.1.10');
      expect(getCliArg(['--other'], '--host')).toBeUndefined();
      expect(getCliArg(['--host'], '--host')).toBeUndefined();
    });
  });

  describe('resolveViewerTargetHost', () => {
    it('defaults to 127.0.0.1 when no args or env are set', () => {
      expect(resolveViewerTargetHost([])).toBe('127.0.0.1');
    });

    it('falls back to 127.0.0.1 when LAZYTERMINAL_HOST is 0.0.0.0 (agent bind address)', () => {
      process.env.LAZYTERMINAL_HOST = '0.0.0.0';
      // Crucial fix: 0.0.0.0 is an INADDR_ANY server bind target, not a valid client destination
      expect(resolveViewerTargetHost([])).toBe('127.0.0.1');
    });

    it('prefers CLI --host argument over environment variables', () => {
      process.env.LAZYTERMINAL_HOST = '10.0.0.5';
      expect(resolveViewerTargetHost(['--host', '192.168.0.50'])).toBe('192.168.0.50');
    });

    it('uses LAZYTERMINAL_VIEWER_HOST when specified', () => {
      process.env.LAZYTERMINAL_VIEWER_HOST = '192.168.1.200';
      process.env.LAZYTERMINAL_HOST = '0.0.0.0';
      expect(resolveViewerTargetHost([])).toBe('192.168.1.200');
    });

    it('uses LAZYTERMINAL_HOST when it is a concrete IP other than 0.0.0.0', () => {
      process.env.LAZYTERMINAL_HOST = '192.168.1.150';
      expect(resolveViewerTargetHost([])).toBe('192.168.1.150');
    });
  });

  describe('resolveAuthToken', () => {
    const testDir = path.join(os.tmpdir(), `lazyterminal-test-${Date.now()}`);
    const agentTokenFile = path.join(testDir, 'agent-token');
    const viewerTokenFile = path.join(testDir, 'viewer-token.json');

    let homedirSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      fs.mkdirSync(testDir, { recursive: true });
      homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(testDir);
      delete process.env.LAZYTERMINAL_TOKEN;
    });

    afterEach(() => {
      homedirSpy?.mockRestore();
      delete process.env.LAZYTERMINAL_TOKEN;
      try {
        fs.rmSync(testDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    });

    it('resolves token passed via CLI argument --token', () => {
      const validToken = 'a'.repeat(32);
      expect(resolveAuthToken(['--token', validToken])).toBe(validToken);
    });

    it('ignores CLI token shorter than 16 characters', () => {
      expect(resolveAuthToken(['--token', 'short'])).toBeUndefined();
    });

    it('resolves token from LAZYTERMINAL_TOKEN environment variable', () => {
      const envToken = 'b'.repeat(32);
      process.env.LAZYTERMINAL_TOKEN = envToken;
      expect(resolveAuthToken([])).toBe(envToken);
    });

    it('resolves token from ~/.lazyterminal/agent-token file', () => {
      const fileToken = 'c'.repeat(32);
      const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(testDir);
      fs.mkdirSync(path.join(testDir, '.lazyterminal'), { recursive: true });
      fs.writeFileSync(path.join(testDir, '.lazyterminal', 'agent-token'), fileToken);

      expect(resolveAuthToken([])).toBe(fileToken);
      homedirSpy.mockRestore();
    });

    it('resolves token from ~/.lazyterminal/viewer-token.json file', () => {
      const viewerToken = 'd'.repeat(32);
      const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(testDir);
      fs.mkdirSync(path.join(testDir, '.lazyterminal'), { recursive: true });
      fs.writeFileSync(
        path.join(testDir, '.lazyterminal', 'viewer-token.json'),
        JSON.stringify({ token: viewerToken, savedAt: Date.now() }),
      );

      expect(resolveAuthToken([])).toBe(viewerToken);
      homedirSpy.mockRestore();
    });

    it('returns undefined if no token sources are available', () => {
      const emptyDir = path.join(os.tmpdir(), `empty-home-${Date.now()}`);
      fs.mkdirSync(emptyDir, { recursive: true });
      const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(emptyDir);

      expect(resolveAuthToken([])).toBeUndefined();

      homedirSpy.mockRestore();
      fs.rmSync(emptyDir, { recursive: true, force: true });
    });
  });

  describe('saveViewerToken and clearSavedViewerToken', () => {
    it('saves and clears viewer token cleanly', () => {
      const testDir = path.join(os.tmpdir(), `save-token-test-${Date.now()}`);
      fs.mkdirSync(testDir, { recursive: true });
      const homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(testDir);

      const token = 'x'.repeat(64);
      saveViewerToken(token);

      const savedFile = path.join(testDir, '.lazyterminal', 'viewer-token.json');
      expect(fs.existsSync(savedFile)).toBe(true);
      const content = JSON.parse(fs.readFileSync(savedFile, 'utf-8'));
      expect(content.token).toBe(token);

      clearSavedViewerToken();
      expect(fs.existsSync(savedFile)).toBe(false);

      homedirSpy.mockRestore();
      fs.rmSync(testDir, { recursive: true, force: true });
    });
  });

  describe('PcViewer State & Authentication Handling', () => {
    it('initializes with unauthenticated status when no token is supplied', () => {
      const viewer = new PcViewer({ host: '127.0.0.1', port: 4488, cliArgs: [] });
      expect(viewer.isAuthenticated).toBe(false);
      expect(viewer.host).toBe('127.0.0.1');
      expect(viewer.port).toBe(4488);
    });

    it('updates isAuthenticated on auth:success message', () => {
      const viewer = new PcViewer({ host: '127.0.0.1', port: 4488, cliArgs: [] });
      expect(viewer.isAuthenticated).toBe(false);

      viewer.handleServerMessage({ type: 'auth:success' });
      expect(viewer.isAuthenticated).toBe(true);
    });

    it('updates isAuthenticated and saves token on auth:pair_success message', () => {
      const viewer = new PcViewer({ host: '127.0.0.1', port: 4488, cliArgs: [] });
      const pairedToken = 'p'.repeat(64);

      viewer.handleServerMessage({ type: 'auth:pair_success', token: pairedToken });
      expect(viewer.isAuthenticated).toBe(true);
      expect(viewer.token).toBe(pairedToken);
    });

    it('handles UNAUTHORIZED by marking unauthenticated and requesting pairing', () => {
      const viewer = new PcViewer({ host: '127.0.0.1', port: 4488, cliArgs: [] });
      viewer.isAuthenticated = true;
      viewer.token = 'rejected-token-123456';

      const requestPairingSpy = vi.spyOn(viewer, 'requestPairing').mockImplementation(() => {});

      viewer.handleServerMessage({
        type: 'terminal:error',
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'Authentication required',
      });

      expect(viewer.isAuthenticated).toBe(false);
      expect(viewer.token).toBeUndefined();
      expect(requestPairingSpy).toHaveBeenCalled();
    });

    it('prevents creating sessions when unauthenticated', () => {
      const viewer = new PcViewer({ host: '127.0.0.1', port: 4488, cliArgs: [] });
      const requestPairingSpy = vi.spyOn(viewer, 'requestPairing').mockImplementation(() => {});
      const sendSpy = vi.spyOn(viewer, 'send').mockImplementation(() => {});

      viewer.createSession();

      expect(sendSpy).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'terminal:create' }));
      expect(requestPairingSpy).toHaveBeenCalled();
    });
  });
});
