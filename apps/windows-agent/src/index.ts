import { AgentServer } from './server.js';
import type { AgentConfig, AgentServerInfo } from './types.js';

export * from './types.js';
export * from './session-registry.js';
export * from './pairing-manager.js';
export * from './server.js';

export function loadConfigFromEnv(): Partial<AgentConfig> {
  const host = process.env.LAZYTERMINAL_HOST || '127.0.0.1';
  const port = parseInt(process.env.LAZYTERMINAL_PORT || '4488', 10);
  const maxSessions = parseInt(process.env.LAZYTERMINAL_MAX_SESSIONS || '10', 10);
  const isLoopback = host === '127.0.0.1' || host === 'localhost';

  // Security mandate: binding to 0.0.0.0 or non-loopback ALWAYS requires authentication.
  // For loopback, requireAuth defaults to false unless explicitly set to true.
  const requireAuthEnv = process.env.LAZYTERMINAL_REQUIRE_AUTH;
  const requireAuth = !isLoopback || requireAuthEnv === 'true' || requireAuthEnv === '1';
  const authToken = process.env.LAZYTERMINAL_TOKEN;

  return {
    host,
    port,
    maxSessions,
    requireAuth,
    authToken,
  };
}

export function formatStartupBanner(info: AgentServerInfo): string {
  const isLan = !info.isLoopbackOnly;
  const securityDesc = isLan
    ? 'LAN Secure Mode (Protected by Cryptographic Pairing)'
    : 'Loopback Development Mode (Localhost Only)';

  const authDesc = info.requireAuth
    ? 'ENFORCED (6-digit pairing code & 256-bit token required)'
    : 'Disabled (Unauthenticated, bound strictly to 127.0.0.1)';

  const accessDesc = isLan
    ? 'ENABLED for local Wi-Fi / LAN (Requires physical PC pairing confirmation)'
    : 'BLOCKED (All non-loopback connections rejected)';

  const lines = [
    '================================================================',
    ' LazyTerminal Windows Agent — Milestone 001/002',
    '================================================================',
    ` Status: Listening on ws://${info.host}:${info.port}`,
    ` Bind Host: ${info.host} (${isLan ? 'All Interfaces / Local Network' : 'Loopback Interface Only'})`,
    ` Effective Port: ${info.port}`,
    ` Security Mode: ${securityDesc}`,
    ` Authentication: ${authDesc}`,
    ` Remote Network Access: ${accessDesc}`,
    ` Max Concurrent Sessions: ${info.maxSessions}`,
  ];

  if (info.requireAuth && info.authToken) {
    lines.push(
      ` Desktop Auth Token: ${info.authToken}`,
      ` Connect PC Viewer: pnpm dev:viewer --token ${info.authToken}`,
    );
    if (info.tokenFilePath) {
      lines.push(` Stored Token File: ${info.tokenFilePath}`);
    }
  }

  lines.push(
    ' Notice: Commands execute with the active Windows user\'s privileges.',
    ' Press Ctrl+C to terminate the agent.',
    '================================================================',
  );

  return lines.join('\n');
}

async function main() {
  const config = loadConfigFromEnv();
  const server = new AgentServer(config);

  try {
    const info = await server.start();
    console.log(formatStartupBanner(info));

    const shutdown = async () => {
      console.log('\n[AgentServer] Shutting down agent and closing active PTY sessions...');
      await server.stop();
      console.log('[AgentServer] Shutdown complete.');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    console.error('[AgentServer] Failed to start server:', (err as Error).message);
    process.exit(1);
  }
}

// Run main if this is executed directly
const isMain = process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js');
if (isMain) {
  main();
}
