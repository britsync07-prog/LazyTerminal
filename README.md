# LazyTerminal

> Control multiple interactive Windows PowerShell terminals from your Android phone — fast, minimal, and secure.

---

## 1. Overview

**LazyTerminal** is an open-source remote terminal suite. It enables controlling interactive PowerShell sessions running on a Windows 10/11 workstation from an Android mobile device, without requiring a self-hosted VPS or central relay server.

### Key Capabilities
- **Multiple Independent Sessions**: Manage parallel PowerShell sessions simultaneously with separate state, environment, and working directories.
- **True Interactive PTY**: Powered by native Windows ConPTY for proper ANSI escape codes, full VT100/xterm sequences, dynamic terminal resizing, and `Ctrl+C` interrupt signals.
- **Bi-Directional Mirroring**: View and interact with the same PowerShell session simultaneously from your Windows desktop GUI and your Android phone.
- **Cryptographic LAN Security**: Mandatory 6-digit pairing and 256-bit token authentication for all non-loopback connections.
- **Self-Contained Standalone Deliverables**: Standalone Windows executable package and standalone Android APK.

---

## 2. Quick Start: Download & Installation

### Windows Desktop Application

1. **Download**: Grab `LazyTerminal-Windows.zip` from the latest [GitHub Release](https://github.com/your-username/LazyTerminal/releases) or the `LazyTerminal-Windows` artifact in [GitHub Actions](https://github.com/your-username/LazyTerminal/actions).
2. **Extract**: Unpack the ZIP file to any folder (e.g., `C:\Tools\LazyTerminal` or your user directory).
3. **Run**:
   - Double-click `LazyTerminal.exe` to launch immediately.
   - Alternatively, right-click and run `install-shortcuts.ps1` with PowerShell to automatically create shortcuts on your Desktop and Start Menu.
4. **Standalone Runtime**: The application bundles its own agent runtime, native ConPTY modules, and portable Node engine. **No installation of Node.js, pnpm, or developer tools is required.**

### Android Mobile Application

1. **Download**: Grab `LazyTerminal.apk` from the latest [GitHub Release](https://github.com/your-username/LazyTerminal/releases) or the `LazyTerminal-Android-APK` artifact in [GitHub Actions](https://github.com/your-username/LazyTerminal/actions).
2. **Install**: Sideload and install the `.apk` on your Android phone (enable "Install unknown apps" in Android Settings if prompted).
3. **Standalone App**: The APK is completely independent and does **not** require Expo Go, Metro, or a developer server.

---

## 3. Connecting Phone to PC (Wi-Fi LAN)

```
+------------------------------------+             +------------------------------------+
|            Windows PC              |             |           Android Phone            |
|  LazyTerminal.exe (192.168.1.150)  |  Local LAN  |       LazyTerminal Mobile App      |
|     ConPTY Agent on Port 4488      |<===========>| Connects to: ws://192.168.1.150:4488|
|       Shows 6-digit PIN: [123456]  |             | Enters PIN -> Receives Auth Token  |
+------------------------------------+             +------------------------------------+
```

1. **Connect to Same Wi-Fi**: Ensure your Android phone and Windows PC are connected to the same local Wi-Fi or LAN network.
2. **Find Your PC's LAN IP Address**:
   - Open PowerShell or Command Prompt on your PC.
   - Run `ipconfig` and note your **IPv4 Address** (typically `192.168.x.x` or `10.0.x.x`).
3. **Enter IP in Android App**:
   > [!IMPORTANT]
   > `127.0.0.1` and `localhost` refer strictly to the device itself.
   > **Do not** type `127.0.0.1` into the phone. Enter your PC's actual LAN IPv4 address (e.g., `192.168.1.150`), with port `4488`.
4. **Cryptographic Pairing**:
   - Tap **Connect & Pair**.
   - Your Windows desktop app / agent will display a one-time **6-digit pairing code** (valid for 60 seconds).
   - Enter this PIN on your phone.
   - Once paired, your phone receives a cryptographic auth token that is saved securely for all future sessions.

---

## 4. Mobile Terminal UX & Gestures

- **Vertical Touch Scrolling**: Swipe up/down on the terminal screen with kinetic inertia physics to review past output.
- **10,000 Line Scrollback**: History buffer preserves lengthy command outputs.
- **Return to Bottom Badge**: A floating `▼ Return to live output (N lines up)` button appears when you scroll up; tap it to snap back to the cursor.
- **Font Scaling**: Tap `A-` and `A+` in the touch toolbar to scale terminal text size on the fly (9px to 22px).
- **Virtual Touch Toolbar**: Quick buttons for `Ctrl+C`, `Tab`, `Esc`, `PgUp`, `PgDn`, arrow keys, and quick bottom jump (`▼ End`).
- **Tab Switching**: Seamlessly manage multiple PowerShell tabs. WebViews stay mounted so scrollback history is preserved when switching tabs.

---

## 5. Architectural Boundaries & Existing Terminals

### ConPTY Isolation
Windows kernel security strictly isolates console handles (`CreatePseudoConsole`) to the process that launched them. Windows does not permit external processes to hijack another process's console pipes without invasive DLL thread injection (which triggers antivirus heuristic blocks and crashes shells).

### Safe Working Directory Migration
LazyTerminal detects running external terminals (`powershell.exe`, `pwsh.exe`, `cmd.exe`, `WindowsTerminal.exe`) and lists them in the Desktop and Mobile discovery views. 

Instead of unsafe hijacking, LazyTerminal provides a 1-click **"Spawn Managed Session in Directory"** action. This creates a fully managed, isolated LazyTerminal ConPTY session starting in that working directory, instantly mirroring to both PC and phone.

---

## 6. GitHub Actions CI/CD & Automated Releases

The repository contains an automated release workflow in `.github/workflows/release.yml`:

```
+-------------------------------------------------------------------------+
|                         GitHub Actions Pipeline                         |
|                                                                         |
|  [Job A: Validate] (Ubuntu)                                             |
|   └── pnpm install -> pnpm build -> pnpm typecheck -> lint -> test      |
|            │                                                            |
|            ├───► [Job B: Build Windows EXE] (windows-latest)            |
|            │      └── Builds & packages LazyTerminal-win32-x64          |
|            │          Creates distributable LazyTerminal-Windows.zip    |
|            │          Artifact: LazyTerminal-Windows                    |
|            │                                                            |
|            └───► [Job C: Build Android APK] (ubuntu-latest)             |
|                   └── Expo prebuild -> Gradle assembleDebug             |
|                       Artifact: LazyTerminal-Android-APK                |
|                                                                         |
|  [Job D: Publish Release] (Triggered by tag: v*)                        |
|   └── Attaches LazyTerminal-Windows.zip & LazyTerminal.apk to Release  |
+-------------------------------------------------------------------------+
```

### Triggering an Automated Release
Pushing a Git tag matching `v*` automatically triggers the build and creates a GitHub Release:

```powershell
git tag v0.1.0
git push origin v0.1.0
```

When triggered, the pipeline:
1. Runs full validation and automated tests.
2. Builds and packages the standalone Windows application directory and ZIP (`LazyTerminal-Windows.zip`).
3. Builds the standalone Android APK (`LazyTerminal.apk`).
4. Creates a new GitHub Release and attaches both downloadable deliverables.

---

## 7. Developer & Contributor Guide

### Monorepo Structure

```text
LazyTerminal/
├── apps/
│   ├── android/             # React Native + Expo mobile application (SDK 57)
│   ├── windows-agent/       # Node.js + ConPTY PowerShell WebSocket agent
│   └── windows-desktop/     # Electron GUI desktop manager and terminal viewer
├── packages/
│   └── protocol/            # Shared TypeScript types and Zod runtime schemas
├── tests/
│   └── integration/         # Vitest end-to-end Windows WebSocket ConPTY tests
├── docs/
│   └── architecture.md      # Detailed system architecture specification
└── .github/
    └── workflows/
        └── release.yml      # CI/CD validation, packaging, and release workflow
```

### Development Setup

```powershell
# 1. Clone repository
git clone https://github.com/your-username/LazyTerminal.git
cd LazyTerminal

# 2. Approve native build scripts for pnpm (node-pty, electron, esbuild)
pnpm approve-builds --all

# 3. Install dependencies
pnpm install

# 4. Build all packages
pnpm build

# 5. Run tests
pnpm test
```

### Local Development Scripts

| Command | Action |
|---|---|
| `pnpm build` | Compiles TypeScript across all workspace packages |
| `pnpm typecheck` | Runs `tsc --noEmit` across all workspace projects |
| `pnpm lint` | Runs TypeScript static analysis and linting |
| `pnpm test` | Runs the full Vitest suite (protocol, agent, integration) |
| `pnpm dev:agent` | Runs Windows Agent in development mode (`tsx src/index.ts`) |
| `pnpm dev:desktop` | Launches the Electron desktop app in development mode |
| `pnpm package:desktop`| Packages `LazyTerminal.exe` and `LazyTerminal-Windows.zip` |
| `pnpm build:apk` | Generates standalone Android APK using native Gradle |
| `pnpm dev:android` | Starts Expo development server for Android |

## Contact

- 📧 Email: [saimon@ascentraconsulting.co.uk](mailto:saimon@ascentraconsulting.co.uk)
- 💼 LinkedIn: [Musfiqur Rahman Saimon](https://www.linkedin.com/in/musfiqur-rahman-saimon-a5994b3aa)
- 🐙 GitHub: [@britsync07-prog](https://github.com/britsync07-prog)
- 🌐 Portfolio: [brit-os.pages.dev](https://brit-os.pages.dev/)

---

## 8. License

LazyTerminal is open-source software licensed under the [MIT License](LICENSE).
