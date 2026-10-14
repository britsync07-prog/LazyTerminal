// Declarations for globals from xterm and preload
declare const Terminal: any;
declare const FitAddon: any;
declare const api: import('../types.js').ElectronApi;

let term: any = null;
let fitAddon: any = null;
let currentAttachedSessionId: string | null = null;
let currentAgentStatus: import('../types.js').DesktopAgentStatus | null = null;

// UI Elements
const statusPill = document.getElementById('status-pill')!;
const statusText = document.getElementById('status-text')!;
const agentEndpoint = document.getElementById('agent-endpoint')!;
const agentMode = document.getElementById('agent-mode')!;
const btnToggleAgent = document.getElementById('btn-toggle-agent') as HTMLButtonElement;
const btnCopyToken = document.getElementById('btn-copy-token') as HTMLButtonElement;
const sessionList = document.getElementById('session-list')!;
const externalList = document.getElementById('external-list')!;
const btnNewSession = document.getElementById('btn-new-session') as HTMLButtonElement;
const btnRefreshSessions = document.getElementById('btn-refresh-sessions') as HTMLButtonElement;
const terminalHeader = document.getElementById('terminal-header')!;
const activeSessionTitle = document.getElementById('active-session-title')!;
const activeSessionMeta = document.getElementById('active-session-meta')!;
const btnDetachTerminal = document.getElementById('btn-detach-terminal') as HTMLButtonElement;
const btnCloseTerminal = document.getElementById('btn-close-terminal') as HTMLButtonElement;
const noSessionOverlay = document.getElementById('no-session-overlay')!;
const btnOverlayNew = document.getElementById('btn-overlay-new') as HTMLButtonElement;
const statusDims = document.getElementById('status-dims')!;
const statusClients = document.getElementById('status-clients')!;

function initTerminal(): void {
  term = new Terminal({
    cursorBlink: true,
    cursorStyle: 'block',
    fontSize: 14,
    fontFamily: 'Consolas, monospace, "Cascadia Code"',
    lineHeight: 1.2,
    theme: {
      background: '#0d1117',
      foreground: '#c9d1d9',
      cursor: '#58a6ff',
      selectionBackground: 'rgba(88, 166, 255, 0.3)',
      black: '#484f58',
      red: '#ff7b72',
      green: '#3fb950',
      yellow: '#d29922',
      blue: '#58a6ff',
      magenta: '#bc8cff',
      cyan: '#39c5cf',
      white: '#b1bac4',
      brightBlack: '#6e7681',
      brightRed: '#ffa198',
      brightGreen: '#56d364',
      brightYellow: '#e3b341',
      brightBlue: '#79c0ff',
      brightMagenta: '#d2a8ff',
      brightCyan: '#56d4dd',
      brightWhite: '#f0f6fc',
    },
    convertEol: true,
    scrollback: 10000,
    allowTransparency: false,
  });

  fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);

  const container = document.getElementById('terminal-element')!;
  term.open(container);

  window.addEventListener('resize', () => {
    try {
      fitAddon.fit();
      if (term) {
        statusDims.textContent = `Dimensions: ${term.cols}x${term.rows}`;
        api.sendTerminalResize(term.cols, term.rows);
      }
    } catch {}
  });

  term.onData((data: string) => {
    api.sendTerminalInput(data);
  });

  term.onResize((size: { cols: number; rows: number }) => {
    statusDims.textContent = `Dimensions: ${size.cols}x${size.rows}`;
    api.sendTerminalResize(size.cols, size.rows);
  });
}

function updateAgentStatusUI(status: import('../types.js').DesktopAgentStatus): void {
  currentAgentStatus = status;

  if (status.isRunning) {
    statusPill.className = 'status-pill running';
    statusText.textContent = 'Agent: Running';
    agentEndpoint.textContent = `ws://${status.host}:${status.port}`;
    agentMode.textContent = status.securityMode === 'lan-secure' ? 'LAN Secure' : 'Loopback Dev';
    btnToggleAgent.textContent = 'Stop Agent';
    btnToggleAgent.className = 'btn btn-danger';
    btnCopyToken.disabled = !status.authToken;
  } else {
    statusPill.className = 'status-pill stopped';
    statusText.textContent = 'Agent: Stopped';
    agentEndpoint.textContent = 'ws://127.0.0.1:4488';
    agentMode.textContent = 'Offline';
    btnToggleAgent.textContent = 'Start Agent';
    btnToggleAgent.className = 'btn btn-primary';
    btnCopyToken.disabled = true;
  }
}

function renderSessions(sessions: any[]): void {
  sessionList.innerHTML = '';

  if (sessions.length === 0) {
    sessionList.innerHTML =
      '<div class="empty-state">No managed sessions open.<br>Click "+ New" or connect from mobile app.</div>';
    if (!currentAttachedSessionId) {
      terminalHeader.classList.add('hidden');
      noSessionOverlay.style.display = 'flex';
    }
    return;
  }

  sessions.forEach((s) => {
    const card = document.createElement('div');
    const isActive = s.sessionId === currentAttachedSessionId;
    card.className = `session-card ${isActive ? 'active' : ''}`;

    const dateStr = new Date(s.createdAt).toLocaleTimeString();
    card.innerHTML = `
      <div class="session-card-header">
        <span class="session-id">${s.sessionId.substring(0, 10)}...</span>
        <span class="badge">${s.shell || 'powershell'}</span>
      </div>
      <div class="session-meta">
        <span>${s.cols}x${s.rows} | Clients: ${s.attachedClients}</span>
        <span>${dateStr}</span>
      </div>
    `;

    card.addEventListener('click', () => {
      attachSession(s.sessionId);
    });

    sessionList.appendChild(card);
  });
}

function renderExternalProcesses(processes: any[]): void {
  externalList.innerHTML = '';

  if (processes.length === 0) {
    externalList.innerHTML = '<div class="empty-state">No external terminal processes found.</div>';
    return;
  }

  processes.forEach((p) => {
    const card = document.createElement('div');
    card.className = 'external-card';

    const titleStr = p.windowTitle ? `<div class="external-title" title="${p.windowTitle}">${p.windowTitle}</div>` : '';
    card.innerHTML = `
      <div class="external-card-header">
        <span class="external-name">${p.name}</span>
        <span class="external-pid">PID: ${p.pid}</span>
      </div>
      ${titleStr}
      <button class="btn btn-sm btn-secondary external-action" data-pid="${p.pid}">
        Spawn Managed Session Here
      </button>
    `;

    const btn = card.querySelector('.external-action') as HTMLButtonElement;
    btn.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      api.spawnManagedFromExternal(p.pid);
    });

    externalList.appendChild(card);
  });
}

async function attachSession(sessionId: string): Promise<void> {
  currentAttachedSessionId = sessionId;
  terminalHeader.classList.remove('hidden');
  noSessionOverlay.style.display = 'none';

  activeSessionTitle.textContent = `Session: ${sessionId.substring(0, 12)}...`;
  activeSessionMeta.textContent = 'PowerShell (Attached)';

  term.clear();
  await api.attachSession(sessionId);

  try {
    fitAddon.fit();
    api.sendTerminalResize(term.cols, term.rows);
  } catch {}

  api.refreshSessions();
}

async function detachSession(): Promise<void> {
  if (currentAttachedSessionId) {
    await api.detachSession();
    currentAttachedSessionId = null;
    terminalHeader.classList.add('hidden');
    noSessionOverlay.style.display = 'flex';
    term.clear();
    api.refreshSessions();
  }
}

async function closeActiveSession(): Promise<void> {
  if (!currentAttachedSessionId) return;

  const confirmed = confirm(
    `Are you sure you want to terminate session [${currentAttachedSessionId.substring(0, 10)}...]?\n\nThis will exit the underlying PowerShell process on your Windows PC and notify your mobile phone.`,
  );

  if (confirmed) {
    const idToClose = currentAttachedSessionId;
    await detachSession();
    await api.closeSession(idToClose);
  }
}

// Event Listeners
btnToggleAgent.addEventListener('click', async () => {
  if (currentAgentStatus?.isRunning) {
    const confirmed = confirm(
      'Are you sure you want to stop the LazyTerminal Windows Agent?\n\nThis will stop accepting remote mobile connections and close all background sessions.',
    );
    if (confirmed) {
      await api.stopAgent();
    }
  } else {
    await api.startAgent(true); // LAN-secure mode
  }
});

btnCopyToken.addEventListener('click', () => {
  if (currentAgentStatus?.authToken) {
    navigator.clipboard.writeText(currentAgentStatus.authToken);
    const originalText = btnCopyToken.textContent;
    btnCopyToken.textContent = 'Copied!';
    setTimeout(() => {
      btnCopyToken.textContent = originalText;
    }, 1500);
  }
});

btnNewSession.addEventListener('click', async () => {
  const cols = term ? term.cols : 100;
  const rows = term ? term.rows : 30;
  await api.createSession(cols, rows);
});

btnOverlayNew.addEventListener('click', async () => {
  const cols = term ? term.cols : 100;
  const rows = term ? term.rows : 30;
  await api.createSession(cols, rows);
});

btnDetachTerminal.addEventListener('click', () => {
  detachSession();
});

btnCloseTerminal.addEventListener('click', () => {
  closeActiveSession();
});

btnRefreshSessions.addEventListener('click', () => {
  api.refreshSessions();
});

// Main Setup
window.addEventListener('DOMContentLoaded', async () => {
  initTerminal();

  api.onAgentStatusChange((status) => {
    updateAgentStatusUI(status);
  });

  api.onSessionListUpdate(({ sessions, externalProcesses }) => {
    renderSessions(sessions);
    renderExternalProcesses(processesToExternal(externalProcesses));
  });

  api.onTerminalOutput((data) => {
    if (term) {
      term.write(data);
    }
  });

  api.onSessionClosed((sessionId) => {
    if (currentAttachedSessionId === sessionId) {
      detachSession();
    }
  });

  // Fetch initial status and session list
  const initialStatus = await api.getAgentStatus();
  updateAgentStatusUI(initialStatus);

  const initialList = await api.refreshSessions();
  renderSessions(initialList.sessions);
  renderExternalProcesses(processesToExternal(initialList.externalProcesses));

  // Auto-attach to first session if available
  if (initialList.sessions.length > 0) {
    attachSession(initialList.sessions[0].sessionId);
  }
});

function processesToExternal(externalProcesses: any[]): any[] {
  return externalProcesses || [];
}
