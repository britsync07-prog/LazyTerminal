import { AgentServer } from './server.js';
export * from './types.js';
export * from './session-registry.js';
export * from './pairing-manager.js';
export * from './server.js';

async function main() {
  const host = process.env.LAZYTERMINAL_HOST || '127.0.0.1';
  const port = parseInt(process.env.LAZYTERMINAL_PORT || '4488', 10);
  const maxSessions = parseInt(process.env.LAZYTERMINAL_MAX_SESSIONS || '10', 10);

  const server = new AgentServer({
    host,
    port,
    maxSessions,
  });

  try {
    const address = await server.start();
    console.log('================================================================');
    console.log(' LazyTerminal Windows Agent — Milestone 001');
    console.log('================================================================');
    console.log(` Status: Listening on ws://${address.host}:${address.port}`);
    console.log(` Max concurrent sessions: ${maxSessions}`);
    console.log(' [SECURITY NOTICE] Development mode. Bound strictly to 127.0.0.1.');
    console.log(' Arbitrary commands will execute with the current user\'s rights.');
    console.log(' Press Ctrl+C to terminate the agent.');
    console.log('================================================================');

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
