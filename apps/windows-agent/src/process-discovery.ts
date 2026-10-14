import { execFile } from 'node:child_process';
import os from 'node:os';
import type { ExternalProcessSummary } from '@lazyterminal/protocol';

/**
 * Discovers running Windows terminal processes (powershell, pwsh, cmd, WindowsTerminal).
 *
 * ARCHITECTURAL NOTICE ON WINDOWS CONSOLE ATTACHMENT:
 * Windows ConPTY and conhost pseudo-consoles use private anonymous pipes and kernel
 * handles created within the owning terminal process. Operating system security boundaries
 * intentionally prevent other processes from hijacking or attaching to these private handles
 * without invasive, unsafe process injection (e.g. CreateRemoteThread / DLL injection), which
 * triggers antivirus heuristics and risks process instability.
 *
 * Therefore, discovered external processes are returned with `managed: false, attachable: false`.
 * LazyTerminal can spawn managed PowerShell sessions alongside them rather than corrupting external sessions.
 */
export async function discoverExternalProcesses(
  excludedPids: number[] = [],
): Promise<ExternalProcessSummary[]> {
  if (os.platform() !== 'win32') {
    return [];
  }

  return new Promise((resolve) => {
    const script =
      `$ErrorActionPreference = 'SilentlyContinue'; ` +
      `$procs = Get-Process -Name powershell,pwsh,cmd,WindowsTerminal -ErrorAction SilentlyContinue | ` +
      `Select-Object Id, ProcessName, MainWindowTitle; ` +
      `if ($procs) { $procs | ConvertTo-Json -Compress } else { '[]' }; exit 0`;

    execFile(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 3000 },
      (err, stdout) => {
        if (err || !stdout || !stdout.trim()) {
          resolve([]);
          return;
        }

        try {
          const parsed = JSON.parse(stdout.trim());
          const list = Array.isArray(parsed) ? parsed : [parsed];
          const excludedSet = new Set([...excludedPids, process.pid]);

          const results: ExternalProcessSummary[] = list
            .filter((item) => item && typeof item.Id === 'number' && !excludedSet.has(item.Id))
            .map((item) => ({
              pid: item.Id,
              name: `${item.ProcessName}.exe`,
              managed: false as const,
              attachable: false as const,
              windowTitle: item.MainWindowTitle || undefined,
              description:
                'External Windows console process (managed: false, attachable: false; ConPTY handle is private)',
            }));

          resolve(results);
        } catch {
          resolve([]);
        }
      },
    );
  });
}
