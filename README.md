# Rook Wiggums

A persistent, self-referential orchestration layer around Claude Code with distinct cognitive roles, file-based memory, and autonomous goal-setting capabilities.

## Overview

Rook Wiggums (the Ralph Wiggum REPL) is an agent shell that wraps Claude Code in a continuous execution loop with four cognitive roles:

- **Ego** — Executive planner that reads the current PLAN, decides the next action, and dispatches work
- **Subconscious** — Worker that executes tasks, logs progress, and proposes updates to memory and habits
- **Superego** — Auditor that periodically evaluates drift, consistency, and security posture
- **Id** — Motivation engine that generates new goals when the system is idle

All state lives in plain markdown files (the "substrate"), making the system fully inspectable and version-controllable.

---

## 8.4.1 — Setup Instructions

### Prerequisites

- Node.js 18+
- npm 9+
- Claude Code CLI installed and authenticated (`claude --version` should work)

### Installation

```bash
git clone <repo-url> && cd rook_wiggums
npm install
```

This installs dependencies for both `server/` and `client/` workspaces.

### Running

```bash
# Start the backend (creates substrate files on first run)
npm run server:dev

# In another terminal, start the frontend dev server
npm run client:dev
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SUBSTRATE_PATH` | `./substrate` | Directory for substrate markdown files |
| `PORT` | `3000` | HTTP/WebSocket server port |

### Running Tests

```bash
# Server tests (Jest)
cd server && npx jest

# Client tests (Vitest)
cd client && npx vitest run

# Linting
cd server && npx eslint src/ tests/
cd client && npx eslint src/ tests/
```

---

## 8.4.2 — Substrate File Formats

The substrate is a directory of 12 markdown files that serve as the system's shared memory. Each file has a heading requirement and a write mode.

| File | Write Mode | Description |
|------|-----------|-------------|
| `PLAN.md` | OVERWRITE | Current task tree with `## Current Goal` and `## Tasks` sections |
| `PROGRESS.md` | APPEND | Timestamped execution log: `[ISO-timestamp] [ROLE] message` |
| `CONVERSATION.md` | APPEND | User/system message transcript |
| `MEMORY.md` | OVERWRITE | Long-term facts and learned knowledge |
| `HABITS.md` | OVERWRITE | Behavioral defaults and routines |
| `SKILLS.md` | OVERWRITE | Learned capabilities and tool proficiencies |
| `VALUES.md` | OVERWRITE | Optimization targets and priorities |
| `ID.md` | OVERWRITE | Motivational drives and desires |
| `SECURITY.md` | OVERWRITE | Security policies and constraints |
| `CHARTER.md` | OVERWRITE | Operational doctrine and boundaries |
| `SUPEREGO.md` | OVERWRITE | Evaluation criteria for audits |
| `CLAUDE.md` | OVERWRITE | Claude Code capabilities model |

**Write modes:**
- **OVERWRITE** — File contents are replaced entirely on each write. Used for state that is recomputed.
- **APPEND** — New entries are appended with `[timestamp] [ROLE] message` format. Used for logs and transcripts.

All files are initialized with a `# Heading` matching their name on first run via `SubstrateInitializer`.

---

## 8.4.3 — Agent Role Permissions

Each agent role has a specific set of file access permissions. The `PermissionChecker` enforces these at runtime.

| File | EGO Read | EGO Write | SUB Read | SUB Write | SUPEREGO Read | SUPEREGO Write | ID Read |
|------|----------|-----------|----------|-----------|---------------|----------------|---------|
| PLAN | ✅ | ✅ (overwrite) | ✅ | ✅ (overwrite) | ✅ | — | ✅ |
| PROGRESS | ✅ | — | ✅ | append | ✅ | append | ✅ |
| CONVERSATION | ✅ | append | — | — | ✅ | — | — |
| MEMORY | ✅ | — | ✅ | — | ✅ | — | — |
| HABITS | ✅ | — | ✅ | — | ✅ | — | — |
| SKILLS | ✅ | — | ✅ | ✅ (overwrite) | ✅ | — | ✅ |
| VALUES | ✅ | — | ✅ | — | ✅ | — | ✅ |
| ID | ✅ | — | — | — | ✅ | — | ✅ |
| SECURITY | — | — | — | — | ✅ | — | — |
| CHARTER | ✅ | — | — | — | ✅ | — | — |
| SUPEREGO | — | — | — | — | ✅ | — | — |
| CLAUDE | — | — | — | — | ✅ | — | — |

**Key constraints:**
- **Superego** has read access to all 12 files but can only append to PROGRESS
- **Id** has read-only access to ID, VALUES, PLAN, PROGRESS, SKILLS — no writes at all
- **Ego** can overwrite PLAN and append to CONVERSATION
- **Subconscious** can overwrite PLAN and SKILLS, and append to PROGRESS

---

## 8.4.4 — Developer Guide

### Project Structure

```
rook_wiggums/
├── server/                    # Node.js + TypeScript backend
│   ├── src/
│   │   ├── agents/            # Agent roles, permissions, Claude integration
│   │   │   ├── claude/        # ClaudeSessionLauncher, prompt builder
│   │   │   ├── permissions.ts # PermissionChecker
│   │   │   ├── roles.ts       # AgentRole enum
│   │   │   └── ego.ts, subconscious.ts, superego.ts, id.ts
│   │   ├── evaluation/        # Heuristic analyzers
│   │   │   ├── DriftAnalyzer.ts
│   │   │   ├── ConsistencyChecker.ts
│   │   │   ├── SecurityAnalyzer.ts
│   │   │   ├── PlanQualityEvaluator.ts
│   │   │   ├── ReasoningValidator.ts
│   │   │   ├── HealthCheck.ts
│   │   │   └── GovernanceReportStore.ts
│   │   ├── loop/              # Runtime loop and execution engine
│   │   │   ├── LoopOrchestrator.ts
│   │   │   ├── LoopHttpServer.ts
│   │   │   ├── LoopWebSocketServer.ts
│   │   │   ├── IdleHandler.ts
│   │   │   └── types.ts
│   │   ├── substrate/         # File-based memory system
│   │   │   ├── io/            # FileReader, OverwriteWriter, AppendOnlyWriter, FileLock
│   │   │   ├── abstractions/  # IFileSystem, IClock, IProcessRunner interfaces
│   │   │   ├── types.ts       # SubstrateFileType, WriteMode enums
│   │   │   └── config.ts      # SubstrateConfig path resolver
│   │   ├── startup.ts         # initializeSubstrate() + startServer()
│   │   └── index.ts           # Entry point
│   └── tests/                 # Jest test suites (344 tests)
├── client/                    # React + Vite frontend
│   ├── src/
│   │   ├── components/        # 11 React components
│   │   ├── hooks/             # useWebSocket, useApi, useNotifications
│   │   ├── parsers/           # planParser, progressParser
│   │   ├── App.tsx            # Main app layout
│   │   └── App.css            # Dark theme styles
│   └── tests/                 # Vitest test suites (38 tests)
└── package.json               # Workspace root
```

### Dependency Injection Pattern

All I/O is abstracted behind interfaces for testability:

```typescript
// Production implementations
import { NodeFileSystem } from "./substrate/abstractions/NodeFileSystem";
import { RealClock } from "./substrate/abstractions/RealClock";
import { ChildProcessRunner } from "./substrate/abstractions/ChildProcessRunner";

// Test doubles
import { InMemoryFileSystem } from "./substrate/abstractions/InMemoryFileSystem";
import { FixedClock } from "./substrate/abstractions/FixedClock";
import { InMemoryProcessRunner } from "./substrate/abstractions/InMemoryProcessRunner";
```

All timestamps are injected via `IClock` so tests can exercise with known values.

### Adding a New Substrate File

1. Add the type to `SubstrateFileType` enum in `server/src/substrate/types.ts`
2. Add a spec to `SUBSTRATE_FILE_SPECS` with `fileName`, `writeMode`, and `required`
3. Update `PermissionChecker` in `server/src/agents/permissions.ts` with role access
4. Add an initial template in `SubstrateInitializer` if needed

### Adding a New Agent Role

1. Add the role to `AgentRole` enum in `server/src/agents/roles.ts`
2. Define file permissions in `server/src/agents/permissions.ts`
3. Create the agent class with `IFileSystem`, `IClock`, and reader/writer dependencies
4. Wire into `createApplication()` factory in `server/src/index.ts`
5. Add tests using `InMemoryFileSystem` and `FixedClock`

---

## 8.4.5 — User Guide

### Starting the System

1. Run `npm run server:dev` — initializes substrate files and starts the HTTP/WebSocket server on port 3000
2. Run `npm run client:dev` — starts the Vite dev server (proxies API calls to port 3000)
3. Open `http://localhost:5173` in your browser

### Using the Frontend

The dashboard is a single-page grid layout with five panels:

- **System Status** (top) — Shows loop state (STOPPED, RUNNING, PAUSED), cycle metrics, health indicators, and loop controls (Start/Pause/Resume/Stop)
- **Plan View** (left) — Hierarchical task tree parsed from PLAN.md with checkboxes for complete/pending status
- **Progress Log** (right) — Visual timeline of execution events, color-coded by agent role (cyan=EGO, green=SUBCONSCIOUS, gold=SUPEREGO, magenta=ID)
- **Conversation** (below) — Message transcript with input field for sending messages to the system
- **Substrate Viewer** (bottom) — Dropdown to inspect any of the 12 substrate files in raw markdown format

Toast notifications appear in the bottom-right for important events (audit completions, state changes, errors).

### Sending Messages

Type a message in the conversation input and press Enter or click Send. The message is posted to the system via `POST /api/conversation/send` and appended to CONVERSATION.md.

### Monitoring Health

The health indicators panel runs all 5 evaluation analyzers:

- **Drift** — Score (0–1) measuring how far the system has drifted from its charter
- **Consistency** — Number of cross-file contradictions detected
- **Security** — Whether security policies are being followed
- **Plan Quality** — Score (0–1) based on task structure, pending items, and goal clarity
- **Reasoning** — Whether current activity aligns with MEMORY and SKILLS

### Requesting an Audit

Click the "Audit" button in Loop Controls to trigger a Superego audit on the next cycle. The Superego reads all 12 substrate files and evaluates drift, consistency, and security compliance.

---

## 8.4.6 — Claude Code Integration

### ClaudeSessionLauncher

The `ClaudeSessionLauncher` wraps the Claude CLI to execute agent prompts:

```typescript
const launcher = new ClaudeSessionLauncher(processRunner, clock);

const result = await launcher.launch({
  systemPrompt: "You are the Ego agent...",
  message: "Read the PLAN and select the next task",
}, {
  maxRetries: 1,
  retryDelayMs: 1000,
});

// result: { rawOutput, exitCode, durationMs, success, error? }
```

Under the hood, it runs:
```bash
claude --print --output-format text --system-prompt "<prompt>" "<message>"
```

### Prompt Builder

Each agent role has a prompt builder that constructs system prompts from substrate file contents. The Ego prompt, for example, includes PLAN.md, MEMORY.md, and HABITS.md contents so Claude can make informed decisions about the next action.

### Process Runner Abstraction

The `IProcessRunner` interface wraps `child_process.spawn` so tests can use `InMemoryProcessRunner` to simulate Claude CLI responses:

```typescript
const runner = new InMemoryProcessRunner();
runner.setResponse("claude", { stdout: "Task completed", exitCode: 0 });
```

---

## 8.4.7 — Architecture Diagram

```
┌─────────────────────────────────────────────────────┐
│                    Frontend (React)                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ │
│  │SystemStat│ │ PlanView │ │ Progress │ │Convers.│ │
│  │  Health  │ │ TaskTree │ │ Timeline │ │ Input  │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └───┬────┘ │
│       │             │            │            │      │
│       └─────────────┴────────────┴────────────┘      │
│                 REST API  │  WebSocket               │
└─────────────────────────┬─┬──────────────────────────┘
                          │ │
┌─────────────────────────┴─┴──────────────────────────┐
│              LoopHttpServer + WebSocket               │
│                                                       │
│  ┌────────────────────────────────────────────────┐   │
│  │              LoopOrchestrator                   │   │
│  │                                                 │   │
│  │  ┌───────┐  ┌──────────────┐  ┌───────────┐   │   │
│  │  │  EGO  │  │ SUBCONSCIOUS │  │  SUPEREGO  │   │   │
│  │  │ plan  │  │   execute    │  │   audit    │   │   │
│  │  └───┬───┘  └──────┬───────┘  └─────┬─────┘   │   │
│  │      │              │                │          │   │
│  │  ┌───┴──────────────┴────────────────┴───┐     │   │
│  │  │        PermissionChecker              │     │   │
│  │  └───┬──────────────┬────────────────┬───┘     │   │
│  │      │              │                │          │   │
│  │  ┌───┴───┐  ┌───────┴───────┐  ┌────┴────┐    │   │
│  │  │Reader │  │OverwriteWriter│  │AppendOnly│    │   │
│  │  └───┬───┘  └───────┬───────┘  └────┬────┘    │   │
│  │      └──────────────┴────────────────┘         │   │
│  │                     │                           │   │
│  │         ┌───────────┴──────────┐                │   │
│  │         │   IdleHandler (ID)   │                │   │
│  │         └──────────────────────┘                │   │
│  └────────────────────────────────────────────────┘   │
│                                                       │
│  ┌────────────────────────────────────────────────┐   │
│  │             Evaluation System                   │   │
│  │  DriftAnalyzer │ ConsistencyChecker │ Security  │   │
│  │  PlanQuality   │ ReasoningValidator │ Health    │   │
│  └────────────────────────────────────────────────┘   │
└───────────────────────────┬───────────────────────────┘
                            │
┌───────────────────────────┴───────────────────────────┐
│                  Substrate (Markdown)                  │
│  PLAN │ PROGRESS │ CONVERSATION │ MEMORY │ HABITS     │
│  SKILLS │ VALUES │ ID │ SECURITY │ CHARTER            │
│  SUPEREGO │ CLAUDE                                    │
└───────────────────────────────────────────────────────┘
```

**Data flow:**
1. LoopOrchestrator runs cycles: Ego reads PLAN → selects task → Subconscious executes via Claude CLI → writes results
2. IdleHandler activates when consecutive idle cycles exceed threshold → Id generates drives → Ego writes new PLAN
3. Superego audits can be triggered manually or automatically → reads all files → writes governance report
4. Frontend connects via WebSocket for live events and REST API for substrate reads/writes
5. Evaluation system provides health metrics by analyzing substrate files heuristically (no Claude calls)

---

## 8.4.8 — Troubleshooting

### Common Issues

**`SUBSTRATE_PATH does not exist`**
- The startup process creates the substrate directory automatically. If you see validation errors, check file system permissions for the configured path.

**Port 3000 already in use**
- Set the `PORT` environment variable: `PORT=3001 npm run server:dev`
- Or kill the existing process: `lsof -i :3000`

**Claude CLI not found / authentication error**
- Ensure `claude` is installed and on your PATH: `claude --version`
- Re-authenticate if needed: `claude auth`

**WebSocket disconnects in the frontend**
- The frontend shows "Disconnected" in the header when the WebSocket connection drops
- Check that the backend is running on the expected port
- The Vite dev server proxies `/ws` to `ws://localhost:3000` — ensure no firewall or proxy issues

**Tests fail with workspace resolution errors**
- Run tests directly from the workspace directory: `cd server && npx jest`
- Do not use `npm test -w server` — workspace resolution can fail with some npm versions

**Jest "open handles" warning**
- This is expected from WebSocket tests with timers. It does not indicate test failures.

**Substrate file validation fails**
- Each substrate file must have a `# Heading` as its first line
- APPEND-mode files (PROGRESS, CONVERSATION) must exist but can be empty after the heading
- Delete the substrate directory and restart to re-initialize from templates

### API Endpoints Reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/loop/status` | Loop state and cycle metrics |
| POST | `/api/loop/start` | Start the loop |
| POST | `/api/loop/pause` | Pause the loop |
| POST | `/api/loop/resume` | Resume the loop |
| POST | `/api/loop/stop` | Stop the loop |
| POST | `/api/loop/audit` | Request Superego audit on next cycle |
| GET | `/api/substrate/:fileType` | Read a substrate file |
| POST | `/api/conversation/send` | Send a user message |
| GET | `/api/health` | Run all 5 health analyzers |
| GET | `/api/reports` | List governance reports |
| GET | `/api/reports/latest` | Get latest governance report |

---

## Tech Stack

- **Backend**: Node.js, TypeScript (strict, ES2022), REST API, WebSocket (`ws`)
- **Frontend**: React 19, Vite, TypeScript
- **Testing**: Jest + ts-jest (server, 344 tests), Vitest + happy-dom (client, 38 tests)
- **AI**: Claude Code CLI via `IProcessRunner` abstraction
