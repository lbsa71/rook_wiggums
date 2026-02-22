# Architectural Review — Substrate v0.2.2

**Date:** 2026-02-22  
**Reviewer:** Copilot (Architect)  
**Scope:** Server-side codebase — `server/src/` (118 files, ~14 000 LoC)  
**Based on:** `docs/ARCHITECTURAL_REVIEW_SPEC.md`

---

## 1. Introduction

This document reviews Substrate against five themes: leaner code, token efficiency, security/integrity/availability, responsiveness, and frugal process usage. Each section describes the current state, concrete findings, and prioritised recommendations with trade-offs.

Reading guide: **CR-L** = leaner code, **CR-T** = token efficiency, **CR-S** = security/integrity/availability, **CR-R** = responsiveness, **CR-P** = process usage. "Quick win" means days, "medium effort" means 1–2 weeks, "larger refactor" means weeks with care.

---

## 2. Current Architecture — Summary

### Subsystems

| Subsystem | Key files | ~LoC | Deps in | Core or optional |
|---|---|---|---|---|
| **Substrate I/O** | `substrate/io/`, `substrate/types.ts`, `substrate/config.ts` | ~400 | 1–2 | Core |
| **Agents** | `agents/roles/`, `agents/prompts/`, `agents/claude/` | ~1 100 | 4–9 each | Core |
| **Loop / Orchestrator** | `loop/LoopOrchestrator.ts`, `loop/createApplication.ts`, `loop/types.ts` | ~2 000 | 25+ | Core |
| **HTTP / WS** | `loop/LoopHttpServer.ts`, `loop/LoopWebSocketServer.ts` | ~900 | 10+ | Core |
| **Conversation** | `conversation/` (4 classes) | ~600 | 4–6 | Core |
| **Agora** | `agora/` (4 classes) | ~700 | 5–7 | Optional |
| **TinyBus** | `tinybus/` (core + 4 providers + MCP) | ~700 | 3–5 | Core |
| **Evaluation** | `evaluation/` (13 classes) | ~1 600 | 2–4 each | Optional (all heuristic) |
| **Schedulers** | `loop/*Scheduler.ts` (5 classes) | ~900 | 3–4 each | Optional |
| **MCP** | `mcp/TinyBusMcpServer.ts` + `tinybus/mcp/` | ~500 | 3 | Optional |
| **Session** | `session/` (SessionManager, TickPromptBuilder, etc.) | ~500 | 3–5 | Optional (tick mode) |
| **Backup** | `backup.ts`, `BackupScheduler.ts` | ~400 | 3 | Optional |
| **Client** | `client/` | ~2 500 | — | Optional |

### Main entry points for the outside world

1. **HTTP/REST** — `LoopHttpServer` (port 3000): loop control, substrate reads, health, reports, backups, MCP, Agora webhook.
2. **WebSocket** — `LoopWebSocketServer` (same port): events to the frontend.
3. **Agora relay** — `AgoraService.connectRelay()`: incoming agent-to-agent messages over WebSocket relay.
4. **TinyBus / MCP** — `TinyBusMcpServer` at `/mcp`: Claude Code tools for messaging.
5. **File watcher** — `FileWatcher`: emits `file_changed` events when substrate files change on disk.

### Core data flow (cycle mode)

```
[external event / timer]
        │
LoopOrchestrator.runLoop()
  ├─ Ego.dispatchNext()           ← reads PLAN.md (heuristic, no LLM)
  │   └─ if task found →
  │       Ego.decide()            ← Claude call (opus): PLAN+VALUES+CONVERSATION eager
  │       Subconscious.execute()  ← Claude call (sonnet): PLAN+VALUES eager
  │
  ├─ [every N cycles] Superego.audit() ← Claude call (opus): ALL files eager
  │
  ├─ [on idle threshold] IdleHandler
  │   ├─ Id.detectIdle()          ← Claude call (sonnet, lightweight)
  │   ├─ Id.generateDrives()      ← Claude call (opus)
  │   └─ Superego.evaluateProposals() ← Claude call (sonnet)
  │
  └─ [per interval] schedulers: Backup, HealthCheck, Email, Metrics, Validation
                                  (all heuristic — no LLM calls)
```

---

## 3. Leaner Code

### 3.1 Current state

**createApplication.ts** is 673 LoC with 59 imports. It wires the entire application. Every subsystem's instantiation, optional wiring, and startup logic lives here. It is the de-facto integration test harness for the whole system.

**LoopOrchestrator.ts** is 1 240 LoC. It serves as the state machine, cycle runner, tick runner, conversation session gate, idle handler trigger, scheduler host, watchdog holder, report store, drive quality tracker, rate limit manager, and finder tracker. At least 10 optional dependencies are injected via individual setter methods (`setBackupScheduler`, `setHealthCheckScheduler`, `setEmailScheduler`, `setMetricsScheduler`, `setValidationScheduler`, `setWatchdog`, `setRateLimitStateManager`, `setReportStore`, `setDriveQualityTracker`, `setLauncher`).

**Five schedulers** (`BackupScheduler`, `HealthCheckScheduler`, `EmailScheduler`, `MetricsScheduler`, `ValidationScheduler`) are structurally identical: they hold a `lastRunTime`, implement `shouldRun(): boolean` and `run(): Promise<Result>`, persist state to a file, and are each wired into the orchestrator via a separate setter. There is no shared abstraction.

**Conversation subsystem** has four classes: `ConversationManager`, `ConversationCompactor`, `ConversationArchiver`, `ConversationProvider`. Additionally, `AgoraMessageHandler` bypasses the TinyBus and calls `conversationManager.append()` directly. There are three different write paths into `CONVERSATION.md`.

**TinyBus providers** register four separate providers: `session-injection` (inject into Claude session), `chat-handler` (call `handleUserMessage`), `conversation` (write to CONVERSATION.md when paused), and `agora-outbound` (send Agora message). The first two achieve similar results through different paths — both inject a message into the agent.

**Deprecated code:** `SubstrateFileType.AGORA_INBOX` is marked deprecated in comments but remains in `types.ts`, `SUBSTRATE_FILE_SPECS`, and the templates, contributing dead surface that Superego permissions still reference.

**Two TinyBusMcpServer implementations**: `server/src/mcp/TinyBusMcpServer.ts` (690 LoC) and `server/src/tinybus/mcp/TinyBusMcpServer.ts` (232 LoC). The `LoopHttpServer` uses the one in `mcp/` via `createTinyBusMcpServer`, but both exist in the tree.

**Evaluation subsystem**: 13 classes in `evaluation/`, all heuristic (no LLM calls), but they are always instantiated even when only the `HealthCheck` API endpoint is used. `GovernanceReportStore`, `MetricsStore`, `TaskClassificationMetrics`, `SubstrateSizeTracker`, `DelegationTracker`, `DriveQualityTracker`, `SuperegoFindingTracker`, `SelfImprovementMetricsCollector` — most are always wired regardless of whether reporting is enabled.

### 3.2 Findings

| ID | Finding |
|---|---|
| F-L1 | `createApplication.ts` violates single responsibility; it is both the DI container and the startup sequencer. |
| F-L2 | `LoopOrchestrator.ts` is a god class; optional features are bolted on via setters, making the class boundary unclear. |
| F-L3 | Five schedulers share an identical shouldRun/run/persistState pattern with no shared abstraction, causing code duplication. |
| F-L4 | Conversation has three separate write paths into `CONVERSATION.md`: `ConversationManager.append()`, direct from `AgoraMessageHandler`, and from `ConversationProvider`. |
| F-L5 | `AGORA_INBOX` file type and associated code is deprecated but not removed, adding dead surface that must be maintained. |
| F-L6 | Two `TinyBusMcpServer` files exist. |
| F-L7 | `session-injection` and `chat-handler` TinyBus providers achieve the same result (`injectMessage`) through slightly different APIs; one may be redundant. |

### 3.3 Recommendations

**CR-L1 — Introduce a `Scheduler<T>` interface.** (Quick win)  
Extract the common `shouldRun(): Promise<boolean>` / `run(): Promise<T>` / `persistState()` pattern into a single interface or base class. The orchestrator holds `Scheduler[]` and calls them in a loop, removing five separate setters and five separate `runScheduled*()` methods in `LoopOrchestrator.ts`.  
_Trade-off: Generics make the type slightly less explicit._

**CR-L2 — Extract `SchedulerHost` from `LoopOrchestrator`.** (Medium effort)  
Move all scheduler invocations, backup, health check, metrics, validation, and email into a `SchedulerHost` that runs at the end of each cycle. The orchestrator delegates to it. This shrinks `LoopOrchestrator.ts` by ~400 LoC and removes 5 setters.  
_Trade-off: One more class; orchestrator and scheduler host must share the event sink._

**CR-L3 — Delete `AGORA_INBOX` file type.** (Quick win)  
Remove `AGORA_INBOX` from `SubstrateFileType`, `SUBSTRATE_FILE_SPECS`, templates, and permission references. The associated quarantine path in `AgoraInboxManager` can remain if needed, but the file type enum entry adds dead surface.

**CR-L4 — Unify TinyBusMcpServer.** (Quick win)  
Delete the duplicate in `tinybus/mcp/` (or the one in `mcp/`) and use one.

**CR-L5 — Make schedulers and evaluation opt-in by default.** (Medium effort)  
`metrics`, `validation`, `healthChecks`, and `email` are all "default enabled" in `createApplication.ts` despite being optional. Flip the defaults so that a minimal installation (`enableBackups: false`, `enableHealthChecks: false`, `metrics: { enabled: false }`, `validation: { enabled: false }`) requires zero scheduler setup. This reduces the object graph for integrations and tests.  
_Trade-off: Existing deployments that rely on default-enabled behaviour need explicit opt-in in `config.json`._

**CR-L6 — Consolidate message intake paths.** (Larger refactor)  
There are effectively three ways a string reaches `CONVERSATION.md` or the agent session: (a) `AgoraMessageHandler`, (b) `ConversationProvider` (TinyBus), (c) `ConversationManager.append()` called by roles. Consider routing Agora through TinyBus like chat messages do, making `AgoraOutboundProvider` the only Agora-specific TinyBus provider and eliminating the bypass.  
_Trade-off: Agora-specific logic (dedup, sender policy, inject-first) complicates generic routing._

---

## 4. Token Efficiency

### 4.1 Token-bearing operations

| Operation | Role | Model | Eager files | Approx. frequency |
|---|---|---|---|---|
| `Ego.decide()` | Ego | opus | PLAN, VALUES, CONVERSATION | Every cycle |
| `Subconscious.execute()` | Subconscious | sonnet | PLAN, VALUES | Every non-idle cycle |
| `Superego.audit()` | Superego | opus | ALL (16 files) | Every 20 cycles (configurable) |
| `Superego.evaluateProposals()` | Superego | sonnet | — (proposals in prompt) | Per-task if proposals |
| `Id.detectIdle()` | Id | sonnet | ID, VALUES, PLAN eager | On idle threshold |
| `Id.generateDrives()` | Id | opus | ID, VALUES, PLAN eager | On idle threshold |
| `ConversationCompactor` | — | sonnet | CONVERSATION.md content | Hourly |
| `Ego.respondToMessage()` | Ego | opus | PLAN, VALUES, CONVERSATION eager | Per user/Agora message |

**Not LLM-backed:** HealthCheck, DriftAnalyzer, ConsistencyChecker, SecurityAnalyzer, PlanQualityEvaluator, ReasoningValidator, MetricsScheduler, ValidationScheduler, BackupScheduler, EmailScheduler, SelfImprovementMetrics. All are heuristic.

### 4.2 Waste

**F-T1 — CONVERSATION.md is eagerly loaded on every Ego and Subconscious call.**  
`CONVERSATION.md` is `EAGER` for Ego (decide, respondToMessage) and loaded via `getEagerReferences`. In an active system CONVERSATION.md can be hundreds of lines. There is no size cap before compaction — compaction runs on a 1-hour timer, not on a size threshold. So between compactions, Ego may include thousands of tokens of history in every cycle.

**F-T2 — Token cost per cycle is lower than it appears.**  
`dispatchNext()` is a heuristic (parses PLAN.md for the next unchecked task) and returns a `taskId` without an LLM call. `Ego.decide()` is not called in the main dispatch path of `executeOneCycle` — the orchestrator calls `subconscious.execute()` directly after `dispatchNext()`. `Ego`'s Claude call occurs only in `respondToMessage()` (conversation sessions). **The main per-cycle cost is therefore Subconscious (sonnet) + periodic Superego (opus).** This is efficient, but it is worth confirming via CR-T2 since the call graph is non-obvious.

**F-T3 — Superego.audit() loads all 16 files eagerly.**  
At every 20th cycle (or on demand), Superego reads all substrate files including PROGRESS.md and CONVERSATION.md which may be large. This is justified by the audit's need for full context, but the interval can be extended and the files trimmed before the call.

**F-T4 — No caching of static substrate files within a cycle.**  
PLAN.md and VALUES.md are re-read from disk by both Ego (dispatchNext) and Subconscious (execute) in the same cycle. If they are unchanged (which they usually are), the reads are redundant I/O (though cheap).

**F-T5 — ConversationCompactor runs on a hard 1-hour timer regardless of size.**  
A CONVERSATION.md that grows rapidly (many Agora messages, user chat) will not compact until an hour has passed. This allows the file to balloon between compactions and increases token cost.

**F-T6 — IdleHandler spawns three LLM calls in sequence.**  
On idle threshold: `Id.detectIdle()` (sonnet), `Id.generateDrives()` (opus), `Superego.evaluateProposals()` (sonnet). If the agent is chronically idle these fire frequently. The system already guards via `idleSleepConfig` but idle calls can still accumulate before sleep triggers.

### 4.3 Recommendations

**CR-T1 — Add a size-based compaction trigger in addition to the timer.** (Quick win)  
In `ConversationManager.append()`, check the line count (or byte count) after each append; if over a threshold (e.g. 500 lines), trigger compaction immediately rather than waiting for the hourly timer. This bounds token cost from CONVERSATION.md.  
_Trade-off: More frequent compaction calls — compactor runs on sonnet so cost is low._

**CR-T2 — Change CONVERSATION load strategy for Ego.decide() to LAZY when a task is in progress.** (Medium effort)  
When `dispatchNext()` has a task, the cycle is task-execution mode, not conversation mode. Ego's `decide()` path is not actually reached in the normal dispatch flow (see F-T2 correction above). However, `respondToMessage()` (conversation) loads CONVERSATION eagerly and this is the right behaviour there. Confirm that `Ego.decide()` is only called from `respondToMessage`; if `decide()` is ever called in the cycle path, make CONVERSATION lazy for that call.

**CR-T3 — Lengthen Superego audit interval or make it change-driven.** (Quick win)  
Default is every 20 cycles. At 30s/cycle that's ~10 minutes. For a slow-moving agent, every 50–100 cycles (25–50 minutes) is sufficient. Expose `superegoAuditInterval` as a recommended config value and document the token cost (all files × opus). Alternatively, trigger audit only when PLAN or SECURITY changes on disk.  
_Trade-off: Longer interval means slower detection of drift; change-driven requires a file-change hook._

**CR-T4 — Cache substrate reads within a cycle.** (Medium effort)  
Pass a per-cycle `Map<SubstrateFileType, string>` from the orchestrator to Ego and Subconscious so duplicate reads of PLAN.md and VALUES.md within the same cycle are served from memory. The file watcher already detects changes; the cache can be invalidated on `file_changed` events.  
_Trade-off: Cache invalidation complexity; files are small so the disk I/O saving is modest._

**CR-T5 — Feature-flag idle handler.** (Quick win)  
Make `IdleHandler` and the three LLM calls it triggers disabled by default when `idleSleepConfig.enabled = false`. Currently the idle threshold still invokes the full IdleHandler pipeline. If the agent is configured to just stop on idle (not sleep), skip `Id.detectIdle()` and go straight to stop/sleep.  
_Trade-off: None significant — `Id.detectIdle()` currently just returns true when PLAN has no active tasks._

---

## 5. Security, Integrity, and Availability

### 5.1 Inbound security

| Entry point | Auth | Rate limit | Input validation |
|---|---|---|---|
| HTTP API (`/api/*`) | **None** | None | URL routing only |
| WebSocket (`/ws`) | **None** | None | Message type check |
| Agora webhook (`/api/agora/webhook`) | Ed25519 signature | Per-sender (sliding window) | Envelope schema |
| Agora relay | Ed25519 signature | Per-sender (sliding window) | Envelope schema |
| TinyBus MCP (`/mcp`) | **None** | None | JSON schema via MCP SDK |

**F-S1 — HTTP and WebSocket endpoints are unauthenticated.**  
Any process that can reach port 3000 can start/stop the loop, read substrate files, trigger backups, send Agora messages, or use the TinyBus MCP tools. This is acceptable for a local deployment but is a significant risk if the port is exposed (e.g. via reverse proxy, Docker port binding, or cloud deployment).

**F-S2 — TinyBus MCP endpoint is unauthenticated.**  
`/mcp` accepts arbitrary tool calls from any HTTP client, including `agora.send`. If an attacker can reach port 3000, they can send messages to Agora peers, inject messages into the agent session, and read/write substrate files (indirectly via the agent).

### 5.2 Secrets

**F-S3 — `SecretDetector` exists but is used only in scheduled validation (weekly).**  
`SecretDetector` (`substrate/validation/SecretDetector.ts`) scans for API keys, tokens, and private keys. It is invoked by `ValidationScheduler` at 7-day intervals. Between validations, a secret accidentally written to a substrate file (e.g. by the agent copying from code) persists undetected for up to a week.

**F-S4 — PROGRESS.md and CONVERSATION.md may contain secrets.**  
Both files are append-only with no output validation. Secrets written during a session (e.g. in a summary or Agora message payload) persist until the next validation pass.

### 5.3 Integrity

**F-S5 — `FileLock` is advisory and not process-safe.**  
`FileLock` uses a JS mutex that prevents concurrent writes within a single Node process. If two substrate processes are started (e.g. during a restart before the old process exits), both can write simultaneously. The file lock provides no cross-process exclusion.

**F-S6 — Agora deduplication set and per-sender rate-limit windows are in-memory only.**  
Both are lost on restart. An attacker who can time a restart can replay an envelope or flood within the same window after restart. For the threat model of a personal AI agent this is low risk; for a multi-agent network it matters.

**F-S7 — Shutdown cleanup timeout is 1 second.**  
The shutdown callback in `createApplication.ts` races a 1-second timeout against cleanup (stop orchestrator, close WebSocket, close HTTP server). Incomplete cleanup can leave locked files or in-progress writes that corrupt substrate files.

### 5.4 Availability

**F-S8 — Sleep state is persisted via a simple flag file.**  
This is a correct design: lightweight and resilient. No issues found.

**F-S9 — Startup scan for `[UNPROCESSED]` messages is correct but fragile.**  
The scan searches `CONVERSATION.md` for the literal string `[UNPROCESSED]`. If the format changes (e.g. different markdown rendering), messages could be silently missed.

**F-S10 — Rate limit state is not persisted across restarts.**  
If the process restarts during a rate-limit backoff, the rate limit is forgotten and the agent may immediately hit the API again and get rate-limited again, causing a restart loop. The `RateLimitStateManager` exists but only saves state before hibernation, not on shutdown.

### 5.5 Recommendations

**CR-S1 — Add optional bearer-token auth to HTTP and WebSocket.** (Medium effort)  
Add a `httpSecret` config field. When set, all HTTP requests must include `Authorization: Bearer <secret>` and WebSocket connections must include it in the initial handshake. This protects against local network exposure.  
_Trade-off: Clients (frontend, scripts) must include the token._

**CR-S2 — Validate `[UNPROCESSED]` marker with a regex.** (Quick win)  
Use a regex (`/\[UNPROCESSED\]/`) so the scan is format-stable; also search for it in the startup scan after a more structured parse.

**CR-S3 — Persist rate-limit state on clean shutdown.** (Quick win)  
Save the `rateLimitUntil` timestamp to disk in the shutdown callback (before the 1-second timeout fires). On startup, load it and restore the rate-limit state if it is still in the future.

**CR-S4 — Increase shutdown cleanup timeout to 5 seconds.** (Quick win)  
Replace the 1-second race with 5 seconds to allow file writes and WebSocket close handshakes to complete.  
_Trade-off: Slightly longer shutdown on hard kill._

**CR-S5 — Run `SecretDetector` on every substrate write.** (Medium effort)  
Add a lightweight check in `AppendOnlyWriter` and `SubstrateFileWriter` that calls `SecretDetector` on the content being written. If a secret is detected, log a warning and optionally refuse the write. Weekly validation remains as a belt-and-suspenders sweep.  
_Trade-off: Adds latency to every substrate write; `SecretDetector` regex load must be fast._

**CR-S6 — Document multi-instance risk.** (Quick win)  
Add a note to `README.md` and systemd unit documentation: only one substrate process should be active per substrate directory at a time. The file lock does not prevent cross-process corruption.

---

## 6. Responsiveness to External Communication

### 6.1 Current flow

**Agora message:**
1. `AgoraMessageHandler.processEnvelope()` called from relay handler or HTTP webhook.
2. Dedup check (in-memory), sender policy check (allowlist), rate-limit check.
3. `messageInjector.injectMessage(agentPrompt)` — if an active Claude session exists, message delivered immediately; otherwise pushed to `pendingMessages` and `timer.wake()` called.
4. Message written to `CONVERSATION.md`.
5. WebSocket event emitted.

If no active session: `timer.wake()` interrupts the inter-cycle delay, so the next cycle starts immediately. However, the next cycle must still run `ego.dispatchNext()` (heuristic, fast) and then `subconscious.execute()` (new Claude process, seconds to start). The agent does not read the Agora message from the queue — it reads it from `CONVERSATION.md` via the eager load of that file.

**Chat message (UI):**
1. POST `/api/conversation/send` → `orchestrator.handleUserMessage(message)`.
2. If tick/cycle active: `injectMessage()` — immediate.
3. If conversation session active: `launcher.inject()` — immediate.
4. Else: start new `Ego.respondToMessage()` session — spawns a Claude process.

**Latency sources:**
- Agora messages between cycles: `timer.wake()` reduces worst-case delay from 30 s to near-zero, but a Claude process still needs to start.
- Agora messages during a long cycle (Subconscious running): the message is queued in `pendingMessages`; it will not be seen by the current cycle; it waits for the next cycle, which starts immediately (no inter-cycle delay when `pendingMessages.length > 0`).
- Chat messages when loop is stopped/paused: `handleUserMessage()` starts a conversation session immediately — good responsiveness.

### 6.2 Latency sources

| Scenario | Delay |
|---|---|
| Agora/chat arrives during active session | ~0 ms (injected via stdin) |
| Agora arrives between cycles (timer sleeping) | ~0–30 ms (`timer.wake()` fires; then Claude process startup ~1–3 s) |
| Agora arrives at start of a long cycle | Up to cycle duration (minutes) + 0 ms inter-cycle wait |
| Chat to stopped loop | ~1–3 s (new conversation session) |
| Chat during Superego audit (long) | Queued until audit completes |

**F-R1 — Long-running audits (Superego.audit) block all external message processing.**  
Superego audit is called at the end of `executeOneCycle`, after which the next cycle begins. During audit (which can take minutes on opus with all files), any injected messages sit in `pendingMessages` and are not seen by the active session (audit does not accept injections). This creates a latency spike every 20 cycles.

**F-R2 — No explicit "message pending" acceleration of audit/scheduled job start.**  
After an external message arrives and `timer.wake()` fires, the orchestrator must complete any in-flight cycle before starting the next one. There is no mechanism to abort or interrupt a running cycle.

**F-R3 — Tick mode defers cycles when a conversation session is active.**  
In tick mode, if a conversation session is open and a cycle-triggering event arrives, it sets `tickRequested = true` and waits for the session to close. This is correct but means a long conversation blocks all autonomous cycles.

### 6.3 Recommendations

**CR-R1 — Run Superego audit asynchronously (fire-and-forget).** (Medium effort)  
Instead of `await this.runAudit()` at the end of the cycle, start the audit in the background with `this.runAudit().catch(...)` so the next cycle and any injections can proceed immediately. The audit writes only to PROGRESS.md (append) and does not block any other write path.  
_Trade-off: Two Claude sessions may run concurrently (audit + next cycle); monitor token cost._

**CR-R2 — Add a `pendingMessages` count to the loop status API.** (Quick win)  
Expose `pendingMessages.length` in `/api/loop/status` so operators and the frontend can see when messages are queued. This provides visibility without adding complexity.

**CR-R3 — Prioritise pending-message cycles over idle handler.** (Quick win)  
When `pendingMessages.length > 0`, skip the idle threshold check and run a cycle immediately. Currently `consecutiveIdleCycles` increments even when messages are pending but injected to an active session; verify that idle count is not incremented when a message was delivered.

---

## 7. Frugal Process Usage

### 7.1 Spawn points

| Spawn | Class | When | How long |
|---|---|---|---|
| Ego decide / respond | `AgentSdkLauncher` | Every message or respondToMessage | Until output complete (seconds to minutes) |
| Subconscious execute | `AgentSdkLauncher` | Every non-idle cycle | Until task output complete |
| Superego audit | `AgentSdkLauncher` | Every N cycles + on demand | 1–5 minutes (all files, opus) |
| Superego evaluateProposals | `AgentSdkLauncher` | Per task if proposals; per idle cycle | Seconds |
| Id detectIdle | `AgentSdkLauncher` | On idle threshold | Seconds (lightweight) |
| Id generateDrives | `AgentSdkLauncher` | On idle threshold (after detectIdle) | 1–2 minutes (opus) |
| Backup (tar) | `NodeProcessRunner` | Per `backupIntervalMs` (default 24 h) | Seconds |

**Typical minimum per cycle (non-idle, no audit):** 1–2 processes (Subconscious only, since Ego.decide is not called in the main dispatch path — `dispatchNext()` is heuristic).

**Per idle cycle (with IdleHandler):** up to 3 extra processes: detectIdle (sonnet), generateDrives (opus), evaluateProposals (sonnet).

**ProcessTracker** reaps abandoned processes after 10-minute grace with a 1-minute reaper interval. This is a correct safety net.

### 7.2 Findings

**F-P1 — `Id.detectIdle()` spawns a Claude process to check if the plan is empty.**  
`Id.detectIdle()` launches a Claude session to determine whether the agent is idle. This is almost always deterministic: if `dispatchNext()` returns null (no tasks in PLAN), the agent is idle. A heuristic check is sufficient — no LLM call needed.

**F-P2 — IdleHandler runs three sequential processes on every idle cycle.**  
If the idle handler fires repeatedly (plan keeps having no tasks), it spawns `detectIdle` + `generateDrives` + `evaluateProposals` each time. After `idleSleepConfig.idleCyclesBeforeSleep` cycles these stop, but the first N idle cycles burn 3 processes each.

**F-P3 — Conversation sessions live for up to 60 seconds after last message.**  
The conversation idle timeout is 60 s by default. This keeps a Claude process alive for up to a minute after the last user message. On a resource-constrained machine this is significant.

**F-P4 — NodeProcessRunner spawns a child process for every backup.**  
`BackupScheduler` calls `createBackup()` which uses `NodeProcessRunner` to run `tar`. This is a short-lived process (seconds) and is unavoidable, but it runs even when there is nothing to archive (small substrates). Verification adds a second pass.

### 7.3 Recommendations

**CR-P1 — Replace `Id.detectIdle()` with a heuristic.** (Quick win)  
Check `dispatchNext() === null` (already computed at cycle start) as the idle signal. Remove the Claude call. `Id.generateDrives()` still runs (it is the creative step), but the detection step becomes free.  
_Trade-off: `Id.detectIdle()` may check more context (VALUES, drives) than just the plan. Review if the richer check is necessary._

**CR-P2 — Gate `Id.generateDrives()` behind consecutive-idle count.** (Quick win)  
Only call `generateDrives` after at least 2–3 consecutive idle cycles, not on the first one. This avoids expensive opus calls for transient idleness (e.g. a task just completed and a new one hasn't been planned yet).  
_Trade-off: Slightly slower response to genuine idleness._

**CR-P3 — Make conversation idle timeout configurable with a shorter default.** (Quick win)  
Lower the default from 60 s to 15–20 s. For UI chat this is perceptible but acceptable; for Agora (which uses `injectMessage`, not conversation sessions), there is no impact.  
_Trade-off: Users typing slowly may lose context._

**CR-P4 — Coalesce scheduled tasks into one post-cycle window.** (Medium effort)  
Currently each scheduler is checked independently at the end of `executeOneCycle`. This is already correct (no new processes — schedulers are heuristic). No additional process coalescing is needed for schedulers. The only process-spawning scheduler is `BackupScheduler` (via `NodeProcessRunner`). That is already bounded to 24-hour intervals. No action required here beyond documenting this.

---

## 8. Cross-Cutting

### 8.1 Priorities

| ID | Recommendation | Theme | Effort | Impact |
|---|---|---|---|---|
| CR-P1 | Replace `Id.detectIdle()` with heuristic | P, T | Quick win | High — removes 1 Claude call per idle cycle |
| CR-T1 | Size-based compaction trigger | T | Quick win | High — bounds CONVERSATION.md token cost |
| CR-L1 | `Scheduler<T>` interface | L | Quick win | Medium — DRY, removes 5 setters |
| CR-L3 | Delete `AGORA_INBOX` file type | L | Quick win | Low cost, clear debt |
| CR-L4 | Unify TinyBusMcpServer | L | Quick win | Low cost, clear confusion |
| CR-S4 | Increase shutdown timeout to 5 s | S | Quick win | Low risk, small gain |
| CR-S3 | Persist rate-limit state on shutdown | S | Quick win | Medium — avoids restart loops |
| CR-R2 | Expose pendingMessages in status API | R | Quick win | Low cost, good observability |
| CR-T3 | Lengthen Superego audit interval | T | Quick win | Medium — easy config change |
| CR-P2 | Gate generateDrives behind consecutive idle | P | Quick win | Medium — avoids opus calls on transient idle |
| CR-S1 | Bearer-token HTTP auth | S | Medium | High for non-local deployments |
| CR-L2 | Extract SchedulerHost from Orchestrator | L | Medium | High — shrinks god class |
| CR-R1 | Run Superego audit asynchronously | R | Medium | High — removes audit-induced latency |
| CR-T2 | Confirm Ego.decide() call site | T | Medium | Clarify token cost per cycle |
| CR-S5 | SecretDetector on every write | S | Medium | Medium — continuous detection |
| CR-L5 | Default-off for optional subsystems | L | Medium | Medium — simpler minimal install |
| CR-L6 | Consolidate message intake paths | L | Larger | High long-term — simpler data flow |

**Dependencies between recommendations:**
- CR-L1 (Scheduler interface) enables CR-L2 (extract SchedulerHost) — do L1 first.
- CR-R1 (async audit) depends on verifying that audit writes are safe to interleave with cycle writes — check FileLock coverage.
- CR-S1 (auth) should precede any cloud or LAN deployment.

### 8.2 Invariants to preserve

- **Inspection guarantee:** Agent must be able to read its own codebase. Do not add indirection that makes the agent's self-model stale.
- **Fork-first:** Each Claude session spawns a new process. Do not attempt to reuse processes across different role calls (process state from one role must not leak to another).
- **Agora as dumb pipe:** Agora is transport only; semantic routing is done by substrate/conversation, not by the relay.
- **No secrets in substrate:** SecretDetector is the enforcement mechanism; tighten its call frequency (CR-S5) rather than relaxing validation.
- **File lock within process:** FileLock prevents intra-process concurrent writes; document (CR-S6) that cross-process safety requires OS-level mutual exclusion (e.g. systemd `ExecStartPre` lockfile check).

### 8.3 Configuration and environment

| Feature | Config key | Default | Recommendation |
|---|---|---|---|
| Cycle delay | `cycleDelayMs` | 30 000 ms | Document; lower to 10 000 ms for reactive agents |
| Superego interval | `superegoAuditInterval` | 20 cycles | Raise to 50 for slow-moving agents; expose in docs |
| Idle sleep | `idleSleepConfig.enabled` | false | Document as the recommended default for production |
| Health checks | `enableHealthChecks` | true | Flip to false as default (CR-L5) |
| Metrics | `metrics.enabled` | true | Flip to false as default (CR-L5) |
| Validation | `validation.enabled` | true | Flip to false as default (CR-L5) |
| Conv. archive | `conversationArchive.enabled` | false | Good — stays opt-in |
| Email | `email.enabled` | false | Good — stays opt-in |
| HTTP auth | `httpSecret` | absent | Add field; document |
| Conv. idle timeout | `conversationIdleTimeoutMs` | 60 000 ms | Lower default to 20 000 ms (CR-P3) |

### 8.4 Testing and observability

To verify the goals of this review, the following metrics and tests are useful:

- **Token cost per cycle:** Add a counter in `AgentSdkLauncher` that accumulates `total_cost_usd` from SDK results and exposes it via `/api/loop/status`. Track as `tokenCostPerCycleUsd`.
- **Process count per hour:** The orchestrator can maintain a `spawnCount` counter incremented on each `launcher.launch()` call. Expose in `/api/loop/status`.
- **Pending message latency:** Timestamp each entry in `pendingMessages` on arrival; record how long it waited before being delivered. Log as part of `cycle_complete` event.
- **CONVERSATION.md size:** `SubstrateSizeTracker` already tracks this. Add an alert in `HealthCheck` if `CONVERSATION.md` exceeds a configurable line threshold (e.g. 300 lines) without having been compacted.
- **Unit tests for CR-P1:** `IdleHandler` should have a test where `dispatchNext()` returns null and `detectIdle` is not called; verify no Claude call is made.
- **Integration test for CR-R1:** Confirm that a message injected during a Superego audit reaches the next cycle within one inter-cycle delay.

---

## 9. References

| Path | Relevance |
|---|---|
| `server/src/loop/createApplication.ts` | Main wiring factory (CR-L1, CR-L2, CR-L5, CR-L6) |
| `server/src/loop/LoopOrchestrator.ts` | God class, scheduler host, message queue (CR-L2, CR-R1, CR-R3) |
| `server/src/loop/*Scheduler.ts` (5 files) | Scheduler duplication (CR-L1) |
| `server/src/agents/roles/` | Role implementations, model calls (CR-T2, CR-T3, CR-P1, CR-P2) |
| `server/src/agents/prompts/PromptBuilder.ts` | Eager/lazy file loading (CR-T1, CR-T2) |
| `server/src/conversation/ConversationManager.ts` | Compaction trigger (CR-T1) |
| `server/src/agora/AgoraMessageHandler.ts` | Message intake, dedup (CR-S6, CR-R1) |
| `server/src/substrate/types.ts` | AGORA_INBOX debt (CR-L3) |
| `server/src/substrate/validation/SecretDetector.ts` | Secret scanning (CR-S5) |
| `server/src/substrate/io/FileLock.ts` | Advisory lock, cross-process risk (CR-S6) |
| `server/src/loop/LoopHttpServer.ts` | No auth (CR-S1) |
| `server/src/loop/IdleHandler.ts` | detectIdle spawn (CR-P1, CR-P2) |
| `server/src/agents/claude/ProcessTracker.ts` | Process lifecycle |
| `server/src/config.ts` | Config defaults (CR-L5, CR-S1) |
| `server/src/mcp/TinyBusMcpServer.ts` | Duplicate MCP server (CR-L4) |
| `server/src/tinybus/mcp/TinyBusMcpServer.ts` | Duplicate MCP server (CR-L4) |
