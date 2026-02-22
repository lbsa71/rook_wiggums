# Architectural Review

**Date:** 2026-02-22  
**Scope:** Substrate server (`server/src/`) and agora-relay entry point.  
**Spec:** [`docs/ARCHITECTURAL_REVIEW_SPEC.md`](./ARCHITECTURAL_REVIEW_SPEC.md)

---

## 1. Introduction

This review covers five themes: leaner code, token efficiency, security/integrity/availability, responsiveness to external communication, and frugal process usage. Each section describes the current state, concrete findings, and prioritized recommendations. References point to specific files and line ranges. Recommendations are labelled **Quick Win**, **Medium Effort**, or **Larger Refactor**.

**Design invariants that must be preserved:**

- _Inspection guarantee_: the agent can read and reason about the full codebase in one context window. Avoid growing large opaque files.  
- _No secrets in substrate_: substrate files stay human-readable markdown; no credentials, tokens, or private keys.  
- _Agora as dumb pipe_: Agora relays envelopes; trust decisions and policy enforcement live in substrate.  
- _Fork-first_: each agent role runs in its own SDK session, not shared state.  
- _Single writer per substrate file_: FileLock enforces this; do not bypass it.

---

## 2. Current Architecture — Summary

### Subsystems

| Subsystem | Key files | ~LoC | Essential? |
|---|---|---|---|
| **Substrate I/O** | `substrate/io/`, `substrate/abstractions/`, `substrate/types.ts` | ~600 | Yes — core persistence |
| **Agents** | `agents/roles/`, `agents/claude/`, `agents/prompts/`, `agents/parsers/` | ~1 200 | Yes — four cognitive roles |
| **Loop** | `loop/LoopOrchestrator.ts`, `loop/LoopHttpServer.ts`, `loop/createApplication.ts` | ~2 600 | Yes — execution engine |
| **Schedulers** | `loop/BackupScheduler.ts`, `loop/EmailScheduler.ts`, `loop/HealthCheckScheduler.ts`, `loop/MetricsScheduler.ts`, `loop/ValidationScheduler.ts` | ~1 100 | Partially optional |
| **Evaluation** | `evaluation/` (13 files) | ~1 800 | Partially optional |
| **Conversation** | `conversation/` (6 files) | ~500 | Yes — conversation lifecycle |
| **Agora** | `agora/` (5 files) | ~800 | Optional (peer comms) |
| **TinyBus** | `tinybus/` (10 files) | ~900 | Yes — MCP bridge |
| **MCP** | `mcp/TinyBusMcpServer.ts` | ~260 | Yes — tool interface |
| **Session** | `session/` (5 files) | ~500 | Yes (tick mode) |
| **Agora-relay** | `agora-relay/` (2 files) | ~60 | Optional |
| **Config/CLI** | `config.ts`, `cli.ts`, `paths.ts`, `supervisor.ts` | ~600 | Yes |
| **Client** | `client/src/` | ~600 | Yes (UI) |

**Total server source (approximate):** ~14 000 LoC across ~90 files.

### Primary data flow

```
External world
  ├── HTTP POST /api/conversation/send  ──► LoopOrchestrator.handleUserMessage()
  ├── HTTP POST /agora/webhook          ──► AgoraMessageHandler.processEnvelope()
  ├── WS relay (Agora)                  ──► AgoraMessageHandler.processEnvelope()
  ├── MCP /mcp                          ──► TinyBus.publish() → providers
  └── HTTP POST /api/loop/*             ──► LoopOrchestrator state machine

LoopOrchestrator (cycle mode)
  ├── ego.dispatchNext()                [plan parse — no LLM]
  ├── subconscious.execute()            [LLM #1 — Sonnet]
  ├── subconscious.evaluateOutcome()    [LLM #2 — Sonnet, every successful task]
  ├── superego.evaluateProposals()      [LLM #3 — Sonnet, when proposals exist]
  └── superego.audit()                  [LLM #4 — Opus, every 20 cycles]

Idle path (when plan is empty or all tasks done)
  ├── id.detectIdle()                   [plan parse — no LLM]
  ├── id.generateDrives()               [LLM — Opus]
  └── superego.evaluateProposals()      [LLM — Sonnet]
```

### Entry points configuration

| Entry point | Auth | Default on? |
|---|---|---|
| HTTP API `/api/*` | None — localhost-only (`127.0.0.1`) | Yes |
| WebSocket `/ws` | Origin allowlist (localhost) | Yes |
| Agora webhook `/agora/webhook` | Bearer token + Ed25519 signature | Optional |
| Agora relay (WebSocket) | Ed25519 signature verification | Optional |
| MCP `/mcp` | None — localhost-only | Yes |

---

## 3. Leaner Code

### Current state

The wiring layer (`createApplication.ts`, 673 LoC, 59 imports) is a monolithic factory function that constructs and cross-wires ~25 objects. `LoopOrchestrator.ts` (1 240 LoC) acts as a god object: it manages the state machine, cycle/tick execution, all five scheduler callbacks, watchdog, drive quality tracking, finding persistence, conversation session lifecycle, and rate-limit hibernation.

### Findings

**F-L1. `createApplication.ts` is a 673-line, 59-import god function.**  
It instantiates substrate I/O, all four agent roles, TinyBus, Agora, all five schedulers, metrics components, file watcher, WebSocket/HTTP servers, watchdog, sleep state, and startup scan sequentially in one function body. Any new feature requires adding more lines here.  
_Refs:_ `server/src/loop/createApplication.ts` lines 1–673.

**F-L2. `LoopOrchestrator` accumulates responsibility via setter injection.**  
Twelve nullable private fields (`backupScheduler`, `healthCheckScheduler`, `emailScheduler`, `metricsScheduler`, `validationScheduler`, `watchdog`, `rateLimitStateManager`, `reportStore`, `driveQualityTracker`, `launcher`, `findingTracker`, tick dependencies) are set post-construction via `set*()` methods. Every optional feature adds another branch to `executeOneCycle()`.  
_Refs:_ `server/src/loop/LoopOrchestrator.ts` lines 49–85, 254–290, 458–484.

**F-L3. Five schedulers with identical structure but no shared base.**  
`BackupScheduler`, `EmailScheduler`, `HealthCheckScheduler`, `MetricsScheduler`, and `ValidationScheduler` all implement the same pattern: persist last-run timestamp to disk, expose `shouldRun*()`, run via `run*()`. They share no abstract base class, leading to repeated state-load/save boilerplate.  
_Refs:_ `server/src/loop/*Scheduler.ts`.

**F-L4. Duplicate TinyBus MCP server implementation.**  
`server/src/mcp/TinyBusMcpServer.ts` (262 LoC) and `server/src/tinybus/mcp/TinyBusMcpServer.ts` (232 LoC) are two slightly different versions of the same module. The outer one adds Agora-service integration but they diverge (e.g. server name differs: `"granules"` vs `"tinybus"`).  
_Refs:_ `server/src/mcp/TinyBusMcpServer.ts`, `server/src/tinybus/mcp/TinyBusMcpServer.ts`.

**F-L5. Deprecated `AGORA_INBOX` file type and associated code path.**  
`SubstrateFileType.AGORA_INBOX` exists in the enum and `SUBSTRATE_FILE_SPECS`, but is annotated as deprecated throughout. `AgoraInboxManager.ts` (240 LoC) is used only for quarantine writes; its other inbox management code is dead. The template is still registered. This is live weight in the codebase.  
_Refs:_ `server/src/substrate/types.ts` lines 14–16, 50; `server/src/agora/AgoraInboxManager.ts`.

**F-L6. Cycle mode and tick mode co-exist with significant complexity cost.**  
`LoopOrchestrator` maintains two parallel execution paths (`runLoop`/`runOneCycle`/`executeOneCycle` and `runTickLoop`/`runOneTick`) plus a `conversationSessionActive` gate that applies to both. The tick mode dependency tree (`TickPromptBuilder`, `SessionManager`, `SdkSessionFactory`) only loads in tick mode, but the conditionals are present throughout.  
_Refs:_ `server/src/loop/LoopOrchestrator.ts` lines 489–689; `server/src/loop/types.ts`.

**F-L7. `SelfImprovementMetrics.ts` is 416 LoC for monthly file-system scanning.**  
This component counts TypeScript files, test files, and lines of code once a month and appends to a governance report. Its complexity (multiple scanning passes, report generation, JSON serialisation) is disproportionate to its value.  
_Refs:_ `server/src/evaluation/SelfImprovementMetrics.ts`.

**F-L8. TinyBus providers `SessionInjectionProvider` and `ChatMessageProvider` overlap.**  
Both providers ultimately call a single method on the orchestrator (`injectMessage` and `handleUserMessage` respectively). Their separation adds a layer of routing indirection without meaningful separation of concerns for most use cases.  
_Refs:_ `server/src/tinybus/providers/SessionInjectionProvider.ts`, `ChatMessageProvider.ts`.

### Recommendations

| # | Recommendation | Priority | Trade-off |
|---|---|---|---|
| R-L1 | **Extract a `SchedulerBase` class** that handles timestamp persistence, state loading, and `shouldRun` logic. Each scheduler inherits and overrides only `runImpl()`. | Medium Effort | Mildly increases abstraction depth. Reduces ~400 LoC of duplication. |
| R-L2 | **Collapse `createApplication.ts` into 2–3 focused factory helpers** (e.g. `createSubstrateLayer()`, `createAgentLayer()`, `createLoopLayer()`). The top-level function calls them and wires the results. | Medium Effort | No behaviour change; reduces file size from 673 to ~150 LoC at the top level. |
| R-L3 | **Move scheduler coordination out of `LoopOrchestrator`** into a `SchedulerCoordinator` that holds all five schedulers and exposes a single `runDueSchedulers()` method called from `executeOneCycle()`. This removes five setter methods and five nullable fields from the orchestrator. | Medium Effort | One more class; cleaner orchestrator. |
| R-L4 | **Delete `mcp/TinyBusMcpServer.ts` and use only `tinybus/mcp/TinyBusMcpServer.ts`** (or vice versa). Merge the Agora-service integration into the canonical file. | Quick Win | None — one file removed entirely. |
| R-L5 | **Remove `AGORA_INBOX` file type and `AgoraInboxManager` inbox code**. Keep only the quarantine-write path if the quarantine feature is retained; otherwise remove entirely. | Quick Win | Removes 240 LoC of dead code. Requires updating enum and `SUBSTRATE_FILE_SPECS`. |
| R-L6 | **Make optional schedulers opt-in in config** (default `false`) rather than default-on. Metrics, validation, email, and health schedulers should all default to disabled; backup should default to enabled. This reduces the moving-parts count in a default installation. | Quick Win | Operators must opt in; document clearly in README. |
| R-L7 | **Collapse `SelfImprovementMetrics.ts`** to a simple 50-line function. Replace the full scanning pass with a single `wc -l`-style count using the existing `IFileSystem` abstraction. | Medium Effort | Less detailed report; detail rarely inspected. |

---

## 4. Token Efficiency

### Current state

The default cycle mode produces the following LLM calls per productive cycle:

1. `subconscious.execute()` — Sonnet, eager context: PLAN.md + VALUES.md.
2. `subconscious.evaluateOutcome()` — Sonnet, same context + task result in prompt. Called after **every** successful or partial task.
3. `superego.evaluateProposals()` — Sonnet, when the task result contains proposals (common).
4. `superego.audit()` — Opus (strategic), **all 16 substrate files eager**, every 20 cycles.

Additional token-bearing operations:
- `id.generateDrives()` — Opus (strategic), on idle (ID.md + VALUES.md + PLAN.md eager).
- `ego.respondToMessage()` — Opus (strategic), on every user or Agora message.
- `ConversationCompactor` — one compaction session per hour (LLM call to summarise CONVERSATION.md).

Schedulers (health, validation, metrics, email) are **heuristic/regex-based**; they do not call the LLM on their own. They can trigger one extra Email session per day (if email is enabled).

### Findings

**F-T1. `evaluateOutcome()` (reconsideration) fires after every successful task.**  
This is a full Sonnet session (prompt build, context load, SDK call) triggered unconditionally after every task completion. For a typical productive day with 10 task completions, this adds ~10 extra Sonnet calls with no user-visible outcome (the result only optionally schedules an audit).  
_Refs:_ `server/src/loop/LoopOrchestrator.ts` lines 429–431, 1187–1239; `server/src/agents/roles/Subconscious.ts` lines 155–220.

**F-T2. `superego.audit()` loads all 16 substrate files eagerly.**  
`ROLE_PERMISSIONS[SUPEREGO]` maps every `SubstrateFileType` as `EAGER`, meaning the PromptBuilder includes the full content of all 16 files (including unbounded PROGRESS.md and CONVERSATION.md) in every audit prompt. As these files grow, audit cost grows unboundedly.  
_Refs:_ `server/src/agents/permissions.ts` lines 50–57; `server/src/agents/prompts/PromptBuilder.ts` `getEagerReferences`.

**F-T3. Prompt context is rebuilt from scratch for every SDK call.**  
`PromptBuilder.buildSystemPrompt()`, `getEagerReferences()`, and `getLazyReferences()` are called fresh on every agent invocation. Substrate files are re-read from disk for each call even within the same cycle (e.g. execute → evaluateOutcome → proposals evaluation all re-read PLAN.md independently).  
_Refs:_ `server/src/agents/roles/Subconscious.ts` lines 56–75, 160–175; `server/src/agents/prompts/PromptBuilder.ts`.

**F-T4. CONVERSATION.md is included eagerly in Ego's context on every cycle.**  
`ROLE_PERMISSIONS[EGO]` marks CONVERSATION as `EAGER`. As the conversation file grows (before compaction), it expands the Ego prompt proportionally. Compaction runs hourly but can still leave a large file during active periods.  
_Refs:_ `server/src/agents/permissions.ts` lines 26.

**F-T5. Scheduled jobs run on fixed intervals regardless of actual need.**  
Metrics and validation both default to 7 days. Health checks run every hour even if all substrate files are static. These are cheap (no LLM) but they add overhead to `executeOneCycle()` and could trigger expensive compactor or email sessions.  
_Refs:_ `server/src/loop/createApplication.ts` lines 545–601.

**F-T6. Superego proposals evaluation is a separate session per cycle.**  
Even when proposals are trivial (e.g. "update HABITS.md with a new habit"), a full Sonnet session is spawned. If `subconscious.execute()` returns proposals frequently, this adds consistent overhead.  
_Refs:_ `server/src/loop/LoopOrchestrator.ts` lines 423–427.

### Recommendations

| # | Recommendation | Priority | Trade-off |
|---|---|---|---|
| R-T1 | **Gate `evaluateOutcome()` behind a config flag or a heuristic**. Default to heuristic scoring (already implemented as `Subconscious.computeDriveRating()`). Only invoke the LLM version when quality score falls below a threshold or on a sampling rate (e.g. 1 in 5 cycles). | Quick Win | Reduces oversight granularity per task; compensated by Superego audit every 20 cycles. |
| R-T2 | **Add per-file line caps for Superego's eager context**. Introduce a `maxLines` option in `PromptBuilder.getEagerReferences()`: PROGRESS.md capped at last 200 lines, CONVERSATION.md capped at last 100 lines for audit purposes. | Quick Win | Audit sees only recent history; for full history, audit can use Read tool on demand. |
| R-T3 | **Cache substrate file reads within one cycle**. Pass a `CycleContext` object (built once at cycle start) to all agent invocations; it holds pre-read content for eager files. Sub-agents read from cache instead of disk. | Medium Effort | Adds a parameter to agent constructors or call sites. Eliminates redundant disk I/O and re-parsing. |
| R-T4 | **Move CONVERSATION.md to LAZY for Ego** by default; let Ego use the Read tool when context is needed. This relies on the two-tier loading strategy already present in the permission system. | Medium Effort | Ego must explicitly read CONVERSATION.md; increases tool-call round-trips in conversation-heavy cycles. |
| R-T5 | **Make health-check, metrics, and validation intervals configurable with sane high defaults** (e.g. health every 6 hours, metrics every 30 days, validation every 14 days). Add a `disabledSchedulers` config array as a single opt-out point. | Quick Win | No functional change; lowers background overhead. |
| R-T6 | **Evaluate whether proposals evaluation can be folded into the execute session**. If the Subconscious session ends by emitting proposals, a follow-on evaluation prompt could be injected into the same session rather than starting a new one. | Larger Refactor | Requires session continuation logic; complicates session lifecycle. |

---

## 5. Security, Integrity, and Availability

### Current state

#### Inbound channels

| Channel | Auth | Rate limit | Input validation |
|---|---|---|---|
| HTTP API (control + read) | None — localhost `127.0.0.1` only | None | URL routing only |
| WebSocket (events) | Origin allowlist (localhost) | None | Read-only broadcast |
| Agora webhook | HTTP Bearer header + Ed25519 signature | None (application-level) | Body JSON parse + envelope decode |
| Agora relay | Ed25519 signature on every envelope | Per-sender (10 msg/60 s) | Envelope decode + signature verify |
| MCP `/mcp` | None — localhost only | None | MCP SDK validation |

#### Secrets

`SecretDetector` scans substrate files for secret patterns at validation time (`SubstrateValidator`). The detector covers common patterns (API keys, tokens, private keys). Validation runs weekly (if enabled) and at startup.

#### Integrity

- `FileLock` (advisory lock) serialises writes to substrate files. Two concurrent writer calls will queue.
- `AppendOnlyWriter` enforces monotonic appends to PROGRESS.md and CONVERSATION.md.
- `SubstrateValidator` and `ReferenceScanner` check file structure and cross-references on a 7-day schedule.
- Agora deduplication: in-memory `Set` capped at 1 000 entries. Set is lost on process restart.

#### Availability

- Single-process: `LoopHttpServer` binds to `127.0.0.1`; two instances would conflict on the same port but `FileLock` does not prevent two processes from writing substrate files.
- Graceful shutdown: `orchestrator.stop()` → `shutdownFn(0)` → cleanup promise with 1-second timeout. In-flight agent sessions are not waited on.
- Restart/recovery: startup scan checks for `[UNPROCESSED]` markers in CONVERSATION.md and queues a reminder.
- Sleep state persists via a file flag (``.sleep-state``) checked on startup.

### Findings

**F-S1. HTTP control API has no authentication.**  
`POST /api/loop/start`, `/stop`, `/pause`, `/resume`, `/restart`, `/audit`, and `POST /api/conversation/send` require no credentials. The server binds to `127.0.0.1`, which prevents external access in the default case, but any local process (including a compromised subprocess) can control the agent loop without authentication.  
_Refs:_ `server/src/loop/LoopHttpServer.ts` lines 178–237; `listen(port, "127.0.0.1")` line 123.

**F-S2. MCP endpoint has no authentication.**  
`/mcp` is unauthenticated. The Claude agent SDK connects to it, but any local process can publish TinyBus messages or call MCP tools.  
_Refs:_ `server/src/loop/LoopHttpServer.ts` lines 146–149.

**F-S3. Agora deduplication is ephemeral.**  
The in-memory `Set<string>` for processed envelope IDs (`MAX_DEDUP_SIZE = 1000`) is discarded on restart. A replay attack could re-deliver up to 1 000 messages from before the restart. The comment in source acknowledges this; for substrate writes it is "acceptable" because writes are idempotent — but injected messages would be re-processed.  
_Refs:_ `server/src/agora/AgoraMessageHandler.ts` lines 51–94.

**F-S4. No cross-process locking prevents two server instances.**  
`FileLock` uses `fs.open(path, 'wx')` which is per-process. If two substrate server processes start (e.g. supervisor race on restart), both will accept requests, both will write substrate files, and the last writer wins. There is no PID file or advisory lock at the server level.  
_Refs:_ `server/src/substrate/io/FileLock.ts`.

**F-S5. `debug.log` may contain sensitive content.**  
`logger.debug()` calls log injected messages, envelope contents, and task summaries. If these contain user data or partial secrets that appeared in substrate files before `SecretDetector` redacted them, they will persist in `debug.log` indefinitely (rotated at 500 KB but not scrubbed).  
_Refs:_ `server/src/logging.ts`; `server/src/agora/AgoraMessageHandler.ts` lines 100–200 (envelope content logging).

**F-S6. Graceful shutdown has a 1-second hard timeout with no in-flight session drain.**  
On `POST /api/loop/stop`, the cleanup promise races against a 1-second timer. Any running Claude SDK session (which can take minutes) is abandoned without a clean interrupt. The `ProcessTracker` grace period (default 10 minutes) will eventually kill the orphaned process, but the session result is lost.  
_Refs:_ `server/src/loop/createApplication.ts` lines 436–468.

**F-S7. Bearer token for Agora webhook is not validated against a known secret.**  
The webhook handler checks that an `Authorization: Bearer <token>` header is present but does not validate the token value against any configured secret. The actual trust decision relies entirely on the Ed25519 envelope signature. The Bearer check is therefore misleading — it looks like auth but provides none.  
_Refs:_ `server/src/loop/LoopHttpServer.ts` lines 609–615.

### Recommendations

| # | Recommendation | Priority | Trade-off |
|---|---|---|---|
| R-S1 | **Add optional HTTP API token auth** via a `apiToken` config field. If set, require `Authorization: Bearer <token>` on all `/api/*` requests. Default: disabled (backward compatible). Document that the API is localhost-only and the risk of enabling it on a shared host. | Medium Effort | Operators must configure; adds one header check per request. |
| R-S2 | **Persist the Agora dedup set to disk on shutdown** and reload on startup. A simple newline-delimited file of the last 1 000 envelope IDs is sufficient. This closes the restart-replay window. | Quick Win | Adds one file write on shutdown; negligible cost. |
| R-S3 | **Write a PID file on startup; refuse to start if PID file exists and process is alive**. This prevents two instances from running concurrently. Remove the PID file on clean exit. | Quick Win | Standard Unix pattern; no significant complexity. |
| R-S4 | **Either validate the Agora webhook Bearer token or remove the check**. If a token is configured via env (`AGORA_WEBHOOK_TOKEN`), validate it. Otherwise, trust the Ed25519 signature only and remove the misleading header check. | Quick Win | Removes false sense of security; no functional regression. |
| R-S5 | **Scrub or elide envelope payload from `debug.log`** at `INFO` level. Log envelope ID and sender only; log payload only at a more verbose level controlled by a `logLevel` config. | Quick Win | Slightly less debug info; privacy improvement. |
| R-S6 | **Increase shutdown drain timeout and signal the active session**. On stop, call `launcher.inject()` with a shutdown notice and wait up to `shutdownGraceMs` (default 30 s, configurable) for the active session to finish before force-killing. | Medium Effort | Slightly slower shutdown; cleaner session termination. |

---

## 6. Responsiveness to External Communication

### Current state

#### Agora message end-to-end

1. Envelope arrives via webhook or relay.
2. `AgoraMessageHandler.processEnvelope()` verifies signature, deduplicates, checks sender policy, rate-limits.
3. `conversationManager.append()` writes to CONVERSATION.md (with `[UNPROCESSED]` if loop is stopped/paused).
4. `orchestrator.injectMessage()` is called:
   - If a session is active: message injected immediately via `launcher.inject()` or `activeSessionManager.inject()`.
   - If no session: message pushed to `pendingMessages[]`, `timer.wake()` called immediately.
5. `timer.wake()` interrupts the current cycle delay; the loop begins its next cycle almost immediately.

#### Chat / conversation path

1. `POST /api/conversation/send` → `orchestrator.handleUserMessage()`.
2. If a tick/cycle is active: injects into it.
3. If no cycle active but a conversation session is open: injects into it.
4. If no session at all: `ego.respondToMessage()` spawns a new conversation session.

#### Latency sources

| Condition | Latency |
|---|---|
| Message arrives while cycle is running | Injected immediately; processed by running session |
| Message arrives between cycles (no session active) | `timer.wake()` called; next cycle starts within milliseconds |
| Message arrives while conversation session is active | Injected into conversation session immediately |
| Message arrives while a cycle is just starting | Session not yet open; queued, picked up at cycle start |
| Loop is PAUSED | Queued with `[UNPROCESSED]`; no wake |
| Loop is SLEEPING | `wakeLoop()` called; `orchestrator.wake()` restarts cycle loop |

#### Cycle length and blocking

In cycle mode, `Subconscious.execute()` can run for up to 30 minutes (hard cap via `DEFAULT_SESSION_TIMEOUT_MS = 10 * 60 * 1000` in `AgentSdkLauncher`, but the orchestrator's absolute ceiling is the Claude SDK's own limit). A long-running execution blocks the next cycle. The 2-minute idle watchdog injects a "are you alive?" message but does not kill the session.

### Findings

**F-R1. No mechanism to interrupt a long-running cycle for a high-priority inbound message.**  
`injectMessage()` sends a text message into the active Claude session via `launcher.inject()`, which adds a user turn. The session may not act on it until the current tool-use loop completes. A 20-minute Subconscious task cannot be preempted; a new Agora message waits in the session's tool queue.  
_Refs:_ `server/src/loop/LoopOrchestrator.ts` lines 832–858; `server/src/agents/claude/AgentSdkLauncher.ts` `inject()`.

**F-R2. Conversation session gates the cycle loop.**  
While `conversationSessionActive` is true, `runOneCycle()` returns `"idle"` and loops with a 1-second poll. A long conversation (Ego responding to a human) blocks autonomous cycles. This is intentional but can cause multi-minute latency for autonomous tasks if conversation is frequent.  
_Refs:_ `server/src/loop/LoopOrchestrator.ts` lines 330–348, 495–508.

**F-R3. No end-to-end acknowledgement event for inbound messages.**  
When a message arrives (Agora or chat), the frontend receives a `message_injected` or `conversation_response` WebSocket event. There is no event emitted when the agent actually _begins processing_ the message (i.e. when the session starts its next turn). The sender has no way to know if a message has been seen.  
_Refs:_ `server/src/loop/LoopOrchestrator.ts` lines 835–843; `server/src/loop/LoopWebSocketServer.ts`.

**F-R4. `cycleDelayMs` default is 30 seconds.**  
Between cycles the loop sleeps for 30 seconds (configurable). In the happy path (`timer.wake()` is called on inject), this is bypassed. But if the loop is between the `timer.delay()` call and the `pendingMessages` check (a race within milliseconds), the message will be processed on the next iteration without delay. The skip-delay optimisation (`pendingMessages.length > 0`) correctly handles this.  
_Refs:_ `server/src/loop/LoopOrchestrator.ts` lines 561–568.

### Recommendations

| # | Recommendation | Priority | Trade-off |
|---|---|---|---|
| R-R1 | **Emit a `message_processing_started` WebSocket event** when `pendingMessages` is drained at the start of a cycle or tick. This gives the frontend and sender visibility into when the agent has actually picked up the message. | Quick Win | One more event type; minimal implementation effort. |
| R-R2 | **Add a `POST /api/loop/nudge` endpoint** (already exists as `orc.nudge()`) exposed to the client UI, so users can trigger an immediate cycle without restarting. | Quick Win | Already implemented internally; just needs an HTTP route. |
| R-R3 | **Document the session-injection latency model** in README: message → inject → next Claude tool-use turn (potentially mid-session). Set expectations that injection does not immediately preempt the current tool chain. | Quick Win | Documentation only. |
| R-R4 | **Consider an "interrupt" policy for high-priority channels**: if an Agora message arrives while a non-interactive cycle is running and the session has been active for more than `interruptThresholdMs` (e.g. 5 minutes), inject a priority prefix into the message. | Medium Effort | Risk of confusing the running session; limited gain unless cycles are routinely long. |
| R-R5 | **Cap the conversation session gate**. If `conversationSessionActive` is true for more than `conversationIdleTimeoutMs` (already configurable), the gate should time out and allow autonomous cycles to resume even if the conversation session is technically open. This is already partially implemented via the idle-timeout on `respondToMessage()`. Verify the timeout path reliably closes `conversationSessionActive`. | Medium Effort | May close a conversation session the user expected to stay open. |

---

## 7. Frugal Process Usage

### Current state

#### Process/session spawn points

| Spawn point | Frequency | Process type |
|---|---|---|
| `subconscious.execute()` | Every productive cycle | Claude SDK query |
| `subconscious.evaluateOutcome()` | Every successful task | Claude SDK query |
| `superego.evaluateProposals()` | When proposals exist (~every cycle) | Claude SDK query |
| `superego.audit()` | Every 20 cycles | Claude SDK query |
| `ego.respondToMessage()` | Per conversation message | Claude SDK query |
| `id.generateDrives()` | On idle | Claude SDK query |
| `BackupScheduler.runBackup()` | Every 24 hours | Child process (tar + sha256sum) |
| `EmailScheduler` | Daily (if enabled) | No extra process (reads files, calls `sendmail`) |
| `superego.evaluateProposals()` in `IdleHandler` | On idle | Claude SDK query |

Claude SDK queries (`sdkQuery`) are async generator invocations. In the Anthropic SDK the query function sends a streaming HTTP request to the API; it does not spawn a local subprocess. However, `AgentSdkLauncher` may interact with a locally-running Claude Code process (which does spawn subprocesses). The `ProcessTracker` tracks active PIDs and kills them after a grace period (default 10 minutes).

In a typical productive hour (10 task completions, no idle, no audit):
- execute × 10 = 10 SDK calls
- evaluateOutcome × 10 = 10 SDK calls
- evaluateProposals × ~5 = 5 SDK calls
- **Total: ~25 SDK calls per hour** from autonomous operation alone.

### Findings

**F-P1. `evaluateOutcome()` doubles the SDK call count unconditionally.**  
As noted in §4 (F-T1), reconsideration fires after every successful task. Across a productive day this doubles the number of Subconscious sessions with minimal additional actionable output.  
_Refs:_ `server/src/loop/LoopOrchestrator.ts` lines 429–431.

**F-P2. `BackupScheduler` spawns a child process (`tar`) for every backup.**  
`NodeProcessRunner.run()` spawns `tar -czf` via `child_process.spawn`. This is correct and cheap, but it runs in the main cycle after every cycle check (not in a separate thread). A slow filesystem could stall the cycle for the duration of the tar operation.  
_Refs:_ `server/src/loop/BackupScheduler.ts`; `server/src/agents/claude/NodeProcessRunner.ts`.

**F-P3. IdleHandler triggers 3 sequential LLM calls when idle.**  
On reaching `maxConsecutiveIdleCycles`, the sequence is: `id.detectIdle()` (plan-parse only, no LLM) → `id.generateDrives()` (Opus SDK call) → `superego.evaluateProposals()` (Sonnet SDK call) → `ego.writePlan()` (no LLM). This is unavoidable for autonomous goal generation, but the Opus call for `generateDrives` is the most expensive single call in the system.  
_Refs:_ `server/src/loop/IdleHandler.ts` lines 22–76; `server/src/agents/TaskClassifier.ts`.

**F-P4. Cycle mode and tick mode each spawn independent sessions per agent role.**  
There is no session reuse within a cycle. Ego's `dispatchNext()` uses plan parsing (no session), but Subconscious's execute and evaluateOutcome are two independent sessions. An alternative is a single session per cycle with injected turns, but this conflicts with the fork-first invariant.  
_Refs:_ `server/src/agents/roles/Subconscious.ts` `execute()`, `evaluateOutcome()`.

**F-P5. `ProcessTracker` reaper runs every 60 seconds via `setInterval`.**  
For most deployments this is fine, but it means a stalled process can live for up to 10 minutes + 60 seconds before being detected and killed. The grace period and reaper interval are both configurable.  
_Refs:_ `server/src/agents/claude/ProcessTracker.ts` lines 80–120; `server/src/loop/createApplication.ts` line 169.

### Recommendations

| # | Recommendation | Priority | Trade-off |
|---|---|---|---|
| R-P1 | **Gate `evaluateOutcome()` as described in R-T1**: heuristic by default, LLM on flag or sampling. Halves the SDK call rate on productive cycles. | Quick Win | Reduced per-task reflection granularity. |
| R-P2 | **Run `BackupScheduler.runBackup()` asynchronously** (fire and forget after the cycle completes, not blocking `executeOneCycle()`). Add a flag to prevent concurrent backup runs. | Quick Win | Backup result not reflected in the same cycle event; logging is still synchronous. |
| R-P3 | **Lower `generateDrives()` to `tacticalModel` (Sonnet)** for standard goal generation. Reserve `strategicModel` (Opus) for complex drive synthesis (e.g. after a failed audit). `TaskClassifier` already supports per-operation model selection. | Medium Effort | Slightly less creative goal generation; revisit if goal quality degrades. |
| R-P4 | **Increase `superegoAuditInterval` default from 20 to 50 cycles**. The reconsideration path (evaluateOutcome) provides per-task quality signal; the full Superego audit is redundant at 20 cycles when evaluateOutcome already escalates audits on quality < 50. Once R-T1 is implemented, re-evaluate the appropriate interval. | Quick Win | Fewer governance check-ins; compensated by on-demand audit escalation. |
| R-P5 | **Add a `maxConcurrentSessions` config** (default 1) enforced in `AgentSdkLauncher`. Currently the orchestrator serialises sessions via `isProcessing`, but conversation sessions and cycle sessions can theoretically overlap. Make concurrency policy explicit. | Medium Effort | Prevents unexpected parallel sessions; may require queue logic. |

---

## 8. Cross-cutting

### Priorities

The following recommendations have the highest combined impact across themes and the lowest implementation risk:

| Priority | Recommendations | Themes |
|---|---|---|
| **Do first** | R-L4 (delete duplicate MCP server), R-L5 (remove deprecated AGORA_INBOX), R-L6 (schedulers opt-in by default), R-T1 / R-P1 (gate evaluateOutcome), R-S2 (persist dedup set), R-S3 (PID file), R-S4 (fix webhook Bearer), R-S5 (scrub log), R-R1 (message_processing_started event), R-T2 (cap Superego eager context), R-P4 (raise audit interval) | Leaner, Security, Token, Responsiveness, Process |
| **Do next** | R-L1 (SchedulerBase), R-L2 (split createApplication), R-L3 (SchedulerCoordinator), R-T3 (cycle context cache), R-S1 (HTTP API token auth), R-S6 (shutdown drain), R-R2 (nudge endpoint), R-P2 (async backup), R-P3 (Sonnet for drives) | Leaner, Token, Security, Responsiveness, Process |
| **Larger investments** | R-T4 (CONVERSATION lazy for Ego), R-T6 (fold proposals into execute session), R-L6 (remove cycle/tick duality), R-L7 (simplify SelfImprovementMetrics), R-R4 (interrupt policy), R-P5 (maxConcurrentSessions) | Token, Leaner, Responsiveness, Process |

### Dependencies between themes

- R-L3 (SchedulerCoordinator) enables R-L2 (slimmer createApplication) and R-P2 (async backup).
- R-T1 / R-P1 enables R-P4 (raise audit interval) — once per-task reflection is cheaper, periodic audits are less needed.
- R-S3 (PID file) is a precondition before enabling R-S1 (HTTP auth) — auth is pointless if two instances can run simultaneously.

### Invariants to preserve

1. **Inspection guarantee**: keep individual files ≤ 300 LoC. Flag any new files added during implementation that approach this limit.
2. **No secrets in substrate**: `SecretDetector` must remain in the validation pipeline. Do not bypass `SubstrateValidator` for performance.
3. **FileLock serialisation**: any new write path to substrate files must acquire `FileLock` first.
4. **Fork-first for agent roles**: Ego, Subconscious, Superego, Id must remain separate sessions. Do not merge them into a shared session (creates implicit state sharing).

### Config and environment variables

Currently configurable in `config.json` (and some via env vars):

| Key | Default | Should be | Notes |
|---|---|---|---|
| `cycleDelayMs` | 30 000 ms | Configurable | Already configurable |
| `superegoAuditInterval` | 20 cycles | Configurable | Recommend raising to 50 |
| `enableBackups` | true | Default true | OK |
| `enableHealthChecks` | true | Opt-in | See R-L6 |
| `metrics.enabled` | true | Opt-in | See R-L6 |
| `validation.enabled` | true | Opt-in | See R-L6 |
| `email.enabled` | false | Opt-in | OK |
| `evaluateOutcome.enabled` | _(missing)_ | Add, default false | See R-T1 / R-P1 |
| `apiToken` | _(missing)_ | Add, optional | See R-S1 |
| `shutdownGraceMs` | _(missing)_ | Add, default 30 000 ms | See R-S6 |
| `agora.security.*` | Configurable | OK | Already nested |

### Testing and observability

**Tests to verify recommendations:**

- `evaluateOutcome` gate (R-T1): add unit test verifying that when `evaluateOutcomeEnabled = false`, only `execute()` is called per cycle (not `evaluateOutcome()`).
- Token cap for Superego (R-T2): add test verifying that eager references include at most N lines from PROGRESS.md and CONVERSATION.md.
- PID file (R-S3): add test verifying that a second call to `startup.ts` with an active PID file exits non-zero.
- `message_processing_started` event (R-R1): add test on `InMemoryEventSink` verifying the event is emitted when `pendingMessages` is drained.

**Metrics to track after implementation:**

- SDK calls per hour (baseline: ~25 productive, target: ~12–15 with R-T1 + R-P4).
- Token cost per productive cycle (track `total_cost_usd` from SDK result messages; already available in `SdkResultSuccess`).
- "Message received → first agent turn" latency (measurable from `message_injected` to next `process_output` events via WebSocket timestamps).
- `debug.log` growth rate (track file size before and after R-S5 log scrubbing).

---

## 9. References

| Area | Key files |
|---|---|
| Wiring | `server/src/loop/createApplication.ts` |
| Execution engine | `server/src/loop/LoopOrchestrator.ts` |
| Agent roles | `server/src/agents/roles/{Ego,Subconscious,Superego,Id}.ts` |
| Permissions / loading strategy | `server/src/agents/permissions.ts` |
| Prompt building | `server/src/agents/prompts/PromptBuilder.ts` |
| Task / model routing | `server/src/agents/TaskClassifier.ts` |
| Schedulers | `server/src/loop/{Backup,Email,HealthCheck,Metrics,Validation}Scheduler.ts` |
| Evaluation | `server/src/evaluation/HealthCheck.ts`, `SelfImprovementMetrics.ts` |
| Conversation lifecycle | `server/src/conversation/ConversationManager.ts` |
| Agora inbound | `server/src/agora/AgoraMessageHandler.ts` |
| File integrity | `server/src/substrate/io/FileLock.ts`, `AppendOnlyWriter.ts` |
| Secret detection | `server/src/substrate/validation/SecretDetector.ts` |
| HTTP API | `server/src/loop/LoopHttpServer.ts` |
| WebSocket events | `server/src/loop/LoopWebSocketServer.ts` |
| Config | `server/src/config.ts`, `server/src/loop/types.ts` |
| Process tracking | `server/src/agents/claude/ProcessTracker.ts`, `AgentSdkLauncher.ts` |
| TinyBus | `server/src/tinybus/core/TinyBus.ts`, `server/src/mcp/TinyBusMcpServer.ts` |
| Substrate types | `server/src/substrate/types.ts` |
