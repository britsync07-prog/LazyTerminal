# LazyTerminal

> Control multiple interactive Windows PowerShell terminals from your Android phone — fast, minimal, and secure.

---

> [!WARNING]
> **DEVELOPMENT SECURITY NOTICE (Milestone 001)**
> LazyTerminal provides interactive access to a real Windows shell. In this initial proof-of-concept milestone, the Windows Agent binds **strictly to loopback (`127.0.0.1`)** with **no authentication**.
>
> - **DO NOT** bind this server to `0.0.0.0` or expose it to the local area network (LAN) or internet.
> - **DO NOT** run the agent as an elevated Administrator.
> - Arbitrary PowerShell commands executed through the agent run with the full privileges of the current Windows user.
> - Secure device pairing, mutual authentication, and encrypted remote transports are scheduled for subsequent milestones.

---

## 1. Overview

**LazyTerminal** is an open-source remote terminal suite. It enables controlling interactive PowerShell sessions running on a Windows 10/11 workstation from an Android mobile device, without requiring a self-hosted VPS or central relay server.

### Key Capabilities (Target Architecture)
- **Multiple Independent Sessions**: Manage parallel PowerShell sessions simultaneously with separate state, environment, and working directories.
- **True Interactive PTY**: Powered by `node-pty` with native Windows ConPTY for proper ANSI escape codes, terminal resizing, and Ctrl+C interrupt signals.
- **Local & Direct Remote Connectivity**: Fast local Wi-Fi connection and direct remote P2P connectivity without hosting server infrastructure.
- **Zero Cloud Relay Dependency**: Retain complete ownership of your terminal traffic.

---

## 2. Milestone 001 & 002 Status

| Component | Status | Details |
|---|---|---|
| **Monorepo** | Verified | `pnpm` workspace linking protocol, agent, tests, and mobile application |
| **Shared Protocol** | Verified | TypeScript types, constants, pairing/auth schemas, and Zod runtime validation (`@lazyterminal/protocol`) |
| **Windows PTY Agent** | Verified | Multi-session ConPTY PowerShell manager with loopback & secure LAN pairing support (`@lazyterminal/windows-agent`) |
| **Android Mobile App** | Verified | React Native + Expo app with connection screen, xterm.js WebView, multi-tabs, and touch control toolbar (`@lazyterminal/android`) |
| **Pairing & Security** | Verified | 6-digit cryptographic pairing flow with PC confirmation, rate limiting, and 256-bit token authentication |
| **Automated Tests** | Verified | 40 automated Vitest tests (protocol unit, agent unit, Windows PTY integration, and mobile client tests) |
| **CI Automation** | Verified | GitHub Actions workflow on Windows runner |

---

## 3. Project Structure

```text
LazyTerminal/
├── apps/
│   ├── android/             # React Native + Expo mobile application scaffold
│   └── windows-agent/       # Node.js + ConPTY PowerShell WebSocket agent
├── packages/
│   └── protocol/            # Shared TypeScript types and Zod runtime validation
├── tests/
│   └── integration/         # Vitest end-to-end Windows WebSocket PTY integration tests
├── docs/
│   └── architecture.md      # Detailed system architecture and sequence diagrams
├── .github/
│   └── workflows/
│       └── ci.yml           # Automated Windows CI workflow
├── .env.example             # Configuration defaults
├── .gitignore               # Secrets, build artifacts, and dependency exclusions
├── LICENSE                  # MIT License
├── README.md                # Project documentation
├── package.json             # Root monorepo configuration
├── pnpm-workspace.yaml      # pnpm workspace definition
└── tsconfig.base.json       # Monorepo TypeScript configuration
```

---

## 4. Prerequisites (Windows Development)

- **Operating System**: Windows 10 (version 1809+) or Windows 11.
- **Node.js**: `v20.0.0` or higher (`v24.x` recommended).
- **Package Manager**: `pnpm` `v9.0.0` or higher (`v11.x` recommended).
- **C++ Build Tools**: Visual Studio 2022 Build Tools (with "Desktop development with C++" workload) or Visual Studio Community.
- **Python**: Python 3.10+ (for node-gyp native builds).

---

## 5. Installation

Clone the repository and install all dependencies:

```powershell
# Clone the repository
git clone https://github.com/your-username/LazyTerminal.git
cd LazyTerminal

# Approve native build scripts for pnpm (node-pty, esbuild)
pnpm approve-builds --all

# Install workspace dependencies
pnpm install
```

### Troubleshooting Native `node-pty` Installation

If `node-pty` fails during installation:
1. Ensure Visual Studio Build Tools are installed:
   ```powershell
   & "C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe" -latest
   ```
2. Verify Python is available:
   ```powershell
   python --version
   ```
3. In `pnpm` v11+, build scripts for native modules are ignored by default until approved. Always run `pnpm approve-builds --all` before `pnpm install`.
4. If native rebuild is needed:
   ```powershell
   pnpm --filter "@lazyterminal/windows-agent" rebuild
   ```

---

## 6. Available Commands

All standard operations are available via root scripts:

| Command | Action |
|---|---|
| `pnpm build` | Compiles TypeScript packages across the monorepo |
| `pnpm typecheck` | Runs `tsc --noEmit` across all workspace projects |
| `pnpm lint` | Runs linting and static analysis checks |
| `pnpm test` | Runs the full test suite (protocol unit tests, agent unit tests, integration tests) |
| `pnpm test:unit` | Runs unit tests for `@lazyterminal/protocol` |
| `pnpm test:integration` | Runs Windows integration tests with real PowerShell PTY |
| `pnpm dev:agent` | Starts the Windows Agent in development mode (`tsx src/index.ts`) |
| `pnpm dev:android` | Starts the Expo mobile development bundler |

---

## 7. Running the Windows Agent

To start the agent on your Windows workstation:

```powershell
pnpm dev:agent
```

Expected output:
```text
================================================================
 LazyTerminal Windows Agent — Milestone 001
================================================================
 Status: Listening on ws://127.0.0.1:4488
 Max concurrent sessions: 10
 [SECURITY NOTICE] Development mode. Bound strictly to 127.0.0.1.
 Arbitrary commands will execute with the current user's rights.
 Press Ctrl+C to terminate the agent.
================================================================
```

### Testing Manually with PowerShell WebSocket Client

You can test the agent locally using PowerShell or a browser dev console:

1. Open a new PowerShell terminal.
2. Run the integration test suite to see automated sessions in action:
   ```powershell
   pnpm test:integration
   ```

---

## 8. Automated Tests

The test suite validates both isolated schemas and actual Windows ConPTY terminal processes:

- **Protocol Validation** (`packages/protocol/tests/protocol.test.ts`):
  - Message schema compliance (`terminal:create`, `terminal:input`, `terminal:resize`, `terminal:interrupt`, `terminal:close`, `ping`).
  - Strict rejection of oversized payloads (>128 KB JSON, >64,000 characters input).
  - Out-of-bounds column/row validation (rejects cols < 10 or > 500, rows < 2 or > 200).
  - Malformed JSON handling without crashing.

- **Session Registry** (`apps/windows-agent/tests/session-registry.test.ts`):
  - Session ID uniqueness (`crypto.randomUUID`).
  - Max concurrent session limits enforcement.
  - Safe error handling on unknown session IDs.
  - Clean process teardown on session close and server shutdown.
  - Live output streaming from real PowerShell.

- **Windows Integration Suite** (`tests/integration/src/agent-integration.test.ts`):
  - Interactive PowerShell startup and command execution (`Write-Host`).
  - Multiple simultaneous sessions maintaining independent variable scope and working directories.
  - PTY interrupt signal (`Ctrl+C` / `0x03`) halting long-running commands (`Start-Sleep`).
  - PTY resize event propagation.
  - Explicit session closure and process cleanup.
  - WebSocket client disconnect resilience (unrelated sessions remain running).
  - Rejection of unknown and malformed messages with `terminal:error`.

---

## 9. Next Milestones

- **Milestone 002 (Mobile UI)**:
  - React Native + Expo application with dark-mode terminal layout.
  - xterm.js embedded inside WebView for hardware-accelerated rendering.
  - Multi-session tab bar and virtual keyboard toolbar (Ctrl, Alt, Tab, Esc, Arrows).
  - Local Wi-Fi discovery and connection manager.
- **Milestone 003 (Security & Reconnection)**:
  - Cryptographic key exchange and QR code pairing.
  - Authenticated sessions with mTLS / Noise protocol.
  - Seamless session reattachment after network drops.
- **Milestone 004 (Remote Connectivity)**:
  - Direct P2P NAT traversal via WebRTC DataChannels.
  - Zero-VPS remote access when away from home.

---

## 10. Contributing

Contributions are welcome! Please ensure:
1. All changes pass `pnpm typecheck`, `pnpm lint`, and `pnpm test`.
2. Any new protocol messages include Zod runtime validation and unit tests.
3. Code changes preserve platform safety and do not log sensitive terminal I/O.

---

## 11. License

LazyTerminal is open-source software licensed under the [MIT License](LICENSE).
