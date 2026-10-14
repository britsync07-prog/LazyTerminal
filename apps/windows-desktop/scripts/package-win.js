const path = require('path');
const fs = require('fs');
const packager = require('electron-packager');

const desktopRoot = path.resolve(__dirname, '..');
const outDir = path.join(desktopRoot, 'dist', 'package');

async function buildPackage() {
  console.log('====================================================');
  console.log(' Packaging LazyTerminal Windows Desktop Application');
  console.log('====================================================');

  const options = {
    dir: desktopRoot,
    name: 'LazyTerminal',
    platform: 'win32',
    arch: 'x64',
    electronVersion: '32.3.3',
    out: outDir,
    overwrite: true,
    asar: false,
    prune: false,
    ignore: [
      /^\/src/,
      /^\/scripts/,
      /^\/tsconfig\.json/,
      /\.ts$/,
    ],
  };

  try {
    const appPaths = await packager(options);
    console.log(`[Package Success] Built Windows app at: ${appPaths.join(', ')}`);

    const appDir = appPaths[0];
    const exePath = path.join(appDir, 'LazyTerminal.exe');
    const repoRoot = path.resolve(desktopRoot, '..', '..');

    // 1. Bundle Windows Agent and dependencies into resources/agent
    console.log('[Packaging] Bundling agent runtime into resources/agent...');
    const targetAgentDir = path.join(appDir, 'resources', 'agent');
    const agentDist = path.join(repoRoot, 'apps', 'windows-agent', 'dist');
    const agentPkg = path.join(repoRoot, 'apps', 'windows-agent', 'package.json');
    const agentNodeModules = path.join(repoRoot, 'apps', 'windows-agent', 'node_modules');

    fs.mkdirSync(path.join(targetAgentDir, 'dist'), { recursive: true });
    if (fs.existsSync(agentDist)) {
      fs.cpSync(agentDist, path.join(targetAgentDir, 'dist'), { recursive: true });
    }
    if (fs.existsSync(agentPkg)) {
      fs.copyFileSync(agentPkg, path.join(targetAgentDir, 'package.json'));
    }
    if (fs.existsSync(agentNodeModules)) {
      fs.cpSync(agentNodeModules, path.join(targetAgentDir, 'node_modules'), {
        recursive: true,
        dereference: true,
      });
    }

    // 2. Bundle portable node.exe into resources/bin
    console.log('[Packaging] Bundling standalone node.exe into resources/bin...');
    const targetBinDir = path.join(appDir, 'resources', 'bin');
    fs.mkdirSync(targetBinDir, { recursive: true });

    let nodeSource = '';
    const candidates = [
      process.execPath.endsWith('node.exe') ? process.execPath : '',
      'C:\\Program Files\\nodejs\\node.exe',
      'C:\\Program Files (x86)\\nodejs\\node.exe',
    ];
    for (const c of candidates) {
      if (c && fs.existsSync(c)) {
        nodeSource = c;
        break;
      }
    }
    if (!nodeSource) {
      try {
        const out = require('child_process').execSync('where.exe node', { encoding: 'utf-8' });
        const firstLine = out.trim().split(/\r?\n/)[0];
        if (firstLine && fs.existsSync(firstLine)) {
          nodeSource = firstLine;
        }
      } catch {
        // ignore
      }
    }

    if (nodeSource) {
      fs.copyFileSync(nodeSource, path.join(targetBinDir, 'node.exe'));
      console.log(`[Packaging] Bundled node.exe from: ${nodeSource}`);
    } else {
      console.warn('[Packaging Warn] node.exe could not be located; application will rely on PATH.');
    }

    // Create installer / shortcut creation script for Windows
    const installScript = `
# LazyTerminal Windows Installer / Shortcut Creator
$ErrorActionPreference = 'Stop'

$appDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$targetExe = Join-Path $appDir 'LazyTerminal.exe'

if (-not (Test-Path $targetExe)) {
    Write-Error "Could not locate LazyTerminal.exe at $targetExe"
    exit 1
}

$WshShell = New-Object -ComObject WScript.Shell

# 1. Desktop Shortcut
$desktopPath = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Desktop)
$desktopShortcut = $WshShell.CreateShortcut((Join-Path $desktopPath 'LazyTerminal.lnk'))
$desktopShortcut.TargetPath = $targetExe
$desktopShortcut.WorkingDirectory = $appDir
$desktopShortcut.Description = 'LazyTerminal — Remote Windows Terminal Manager'
$desktopShortcut.Save()

# 2. Start Menu Shortcut
$programsPath = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Programs)
$startMenuShortcut = $WshShell.CreateShortcut((Join-Path $programsPath 'LazyTerminal.lnk'))
$startMenuShortcut.TargetPath = $targetExe
$startMenuShortcut.WorkingDirectory = $appDir
$startMenuShortcut.Description = 'LazyTerminal — Remote Windows Terminal Manager'
$startMenuShortcut.Save()

Write-Host "==========================================================" -ForegroundColor Green
Write-Host " LazyTerminal shortcuts installed successfully!" -ForegroundColor Green
Write-Host " Desktop:    $desktopPath\\LazyTerminal.lnk" -ForegroundColor White
Write-Host " Start Menu: $programsPath\\LazyTerminal.lnk" -ForegroundColor White
Write-Host " Target Exe: $targetExe" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Green
`;

    const uninstallScript = `
# LazyTerminal Uninstaller / Shortcut Cleaner
$desktopPath = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Desktop)
$programsPath = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Programs)

$shortcuts = @(
    (Join-Path $desktopPath 'LazyTerminal.lnk'),
    (Join-Path $programsPath 'LazyTerminal.lnk')
)

foreach ($sc in $shortcuts) {
    if (Test-Path $sc) {
        Remove-Item -Path $sc -Force -ErrorAction SilentlyContinue
        Write-Host "Removed shortcut: $sc" -ForegroundColor Yellow
    }
}

Write-Host "LazyTerminal shortcuts removed." -ForegroundColor Green
`;

    fs.writeFileSync(path.join(appDir, 'install-shortcuts.ps1'), installScript.trim(), 'utf-8');
    fs.writeFileSync(path.join(appDir, 'uninstall.ps1'), uninstallScript.trim(), 'utf-8');

    // Create a batch launcher for quick 1-click execution
    const batchLauncher = `@echo off\r\nstart "" "%~dp0LazyTerminal.exe"\r\n`;
    fs.writeFileSync(path.join(appDir, 'Start-LazyTerminal.cmd'), batchLauncher, 'utf-8');

    console.log('[Packaging] Created install-shortcuts.ps1, uninstall.ps1, and Start-LazyTerminal.cmd');
    console.log(`[Deliverable Binary] ${exePath}`);

    // 3. Create distributable ZIP archive
    const zipPath = path.join(outDir, 'LazyTerminal-Windows.zip');
    console.log(`[Packaging] Generating distributable archive: ${zipPath}...`);
    try {
      if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath);
      }
      try {
        require('child_process').execSync(`tar.exe -a -c -f "${zipPath}" -C "${appDir}" .`, { stdio: 'inherit' });
      } catch {
        const zipCmd = `powershell -NoProfile -Command "Compress-Archive -Path '${appDir}\\*' -DestinationPath '${zipPath}' -Force"`;
        require('child_process').execSync(zipCmd, { stdio: 'inherit' });
      }
      const stat = fs.statSync(zipPath);
      console.log(`[Deliverable Archive] ${zipPath} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
    } catch (zipErr) {
      console.warn('[Packaging Warn] Failed to create ZIP archive:', zipErr.message);
    }
  } catch (err) {
    console.error('[Package Error]', err);
    process.exit(1);
  }
}

buildPackage();
