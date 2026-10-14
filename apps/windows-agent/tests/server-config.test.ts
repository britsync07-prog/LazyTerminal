import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentServer } from '../src/server.js';
import { loadConfigFromEnv, formatStartupBanner } from '../src/index.js';
import type { AgentServerInfo } from '../src/types.js';

describe('Server Configuration & Security Mode (Regression Tests)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.LAZYTERMINAL_HOST;
    delete process.env.LAZYTERMINAL_PORT;
    delete process.env.LAZYTERMINAL_MAX_SESSIONS;
    delete process.env.LAZYTERMINAL_REQUIRE_AUTH;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('loadConfigFromEnv', () => {
    it('defaults to loopback mode without mandatory auth', () => {
      const config = loadConfigFromEnv();
      expect(config.host).toBe('127.0.0.1');
      expect(config.port).toBe(4488);
      expect(config.maxSessions).toBe(10);
      expect(config.requireAuth).toBe(false);
    });

    it('enforces requireAuth when host is 0.0.0.0 (LAN mode)', () => {
      process.env.LAZYTERMINAL_HOST = '0.0.0.0';
      const config = loadConfigFromEnv();
      expect(config.host).toBe('0.0.0.0');
      expect(config.requireAuth).toBe(true);
    });

    it('enforces requireAuth for any specific non-loopback IP', () => {
      process.env.LAZYTERMINAL_HOST = '192.168.1.50';
      const config = loadConfigFromEnv();
      expect(config.host).toBe('192.168.1.50');
      expect(config.requireAuth).toBe(true);
    });

    it('allows enabling auth explicitly on loopback', () => {
      process.env.LAZYTERMINAL_HOST = '127.0.0.1';
      process.env.LAZYTERMINAL_REQUIRE_AUTH = 'true';
      const config = loadConfigFromEnv();
      expect(config.requireAuth).toBe(true);
    });
  });

  describe('formatStartupBanner', () => {
    it('formats accurate banner for default loopback mode', () => {
      const info: AgentServerInfo = {
        host: '127.0.0.1',
        port: 4488,
        securityMode: 'loopback-dev',
        requireAuth: false,
        isLoopbackOnly: true,
        maxSessions: 10,
      };

      const banner = formatStartupBanner(info);
      expect(banner).toContain('ws://127.0.0.1:4488');
      expect(banner).toContain('Loopback Interface Only');
      expect(banner).toContain('Security Mode: Loopback Development Mode');
      expect(banner).toContain('Authentication: Disabled (Unauthenticated, bound strictly to 127.0.0.1)');
      expect(banner).toContain('Remote Network Access: BLOCKED');
      expect(banner).not.toContain('All Interfaces / Local Network');
    });

    it('formats accurate banner for LAN mode on 0.0.0.0 and never claims loopback only', () => {
      const info: AgentServerInfo = {
        host: '0.0.0.0',
        port: 4488,
        securityMode: 'lan-secure',
        requireAuth: true,
        isLoopbackOnly: false,
        maxSessions: 10,
      };

      const banner = formatStartupBanner(info);
      expect(banner).toContain('ws://0.0.0.0:4488');
      expect(banner).toContain('Bind Host: 0.0.0.0 (All Interfaces / Local Network)');
      expect(banner).toContain('Security Mode: LAN Secure Mode');
      expect(banner).toContain('Authentication: ENFORCED (6-digit pairing code & 256-bit token required)');
      expect(banner).toContain('Remote Network Access: ENABLED for local Wi-Fi / LAN');
      // Crucial regression check: NEVER print a false loopback warning
      expect(banner).not.toContain('Bound strictly to 127.0.0.1');
      expect(banner).not.toContain('Loopback Interface Only');
    });
  });

  describe('AgentServer Security Mode Separation', () => {
    it('sets loopback-dev mode for default host 127.0.0.1', () => {
      const server = new AgentServer();
      const info = server.getServerInfo();
      expect(info.host).toBe('127.0.0.1');
      expect(info.securityMode).toBe('loopback-dev');
      expect(info.isLoopbackOnly).toBe(true);
      expect(info.requireAuth).toBe(false);
    });

    it('strictly enforces requireAuth in LAN mode even if caller passes requireAuth: false', () => {
      const server = new AgentServer({
        host: '0.0.0.0',
        requireAuth: false, // Attempt to disable auth on LAN
      });
      const info = server.getServerInfo();
      expect(info.host).toBe('0.0.0.0');
      expect(info.isLoopbackOnly).toBe(false);
      expect(info.securityMode).toBe('lan-secure');
      // Security mandate: binding to 0.0.0.0 MUST NEVER disable authentication
      expect(info.requireAuth).toBe(true);
    });
  });
});
