# Substrate Claude Compatibility Guide

`AGENTS.md` is the canonical instruction file for this repository. Read and follow it first. This file preserves infrastructure details and Claude-specific compatibility if the repository returns to a Claude-based coding session.

The same primary objective applies under Claude: continually improve efficiency in thought and inference, depth in reasoning and execution, and ambition in testing and overcoming capability limits. Truthfulness, security, authorization, reversibility, and hardcoded safeguards remain non-overridable constraints.

Do not duplicate or reinterpret the engineering workflow here. When this file and `AGENTS.md` differ, `AGENTS.md` wins.

---

# Substrate Infrastructure Reference

Facts about how this system works — shared across all agents. Read freely and apply the workflow in `AGENTS.md` when making changes.

## 1. Project Structure

```
substrate/
  server/
    src/         — TypeScript source (edit in an isolated worktree for nontrivial or risky changes)
    dist/        — Compiled JavaScript (what actually runs; rebuild after source changes)
  specs/         — Architecture specs and baselines
```

Editing `.ts` source does not affect the running process — `dist/` must be rebuilt and service restarted.
Service naming pattern: `<agent>-substrate.service` (e.g. `nova-substrate.service`).

## 2. Code Change Protocol

- **Reads:** Always permitted. Read freely for orientation and diagnosis.
- **Writes:** Implement locally with the configured tool runner. Use a separate git worktree for nontrivial or risky changes, validate with build/lint/test, then merge intentionally into the live checkout.
- **No Copilot/SWE-agent delegation** unless Stefan explicitly reinstates it.

## 3. HEARTBEAT Schedule Format

File: `~/.local/share/substrate/HEARTBEAT.md`
Parser: `server/src/loop/HeartbeatParser.ts` (`detectScheduleType`)

**Valid schedule formats only:**
- `@once` — fires immediately once, then removed
- `2026-06-01T09:00Z` — ISO 8601 UTC timestamp, one-shot
- `0 * * * *` — 5-field cron (minute hour dom month dow, UTC), recurring

**Invalid formats are silently skipped** — no error, no fire. Natural language like `every 1h` returns `"unknown"` and is ignored.

Common cron patterns: hourly `0 * * * *`, every 15 min `*/15 * * * *`, daily 09:00 UTC `0 9 * * *`.

## 4. PlanParser Task Syntax

File: `~/.local/share/substrate/PLAN.md`
Parser: `server/src/agents/parsers/PlanParser.ts`

- `- [ ]` → PENDING → always dispatched
- `- [x]` → COMPLETE → never dispatched
- `- [~]` → DEFERRED → dispatched only if `WHEN \`<shell-expr>\`` evaluates to true

Tasks must be under a `## Tasks` heading. Indented sub-tasks (2-space indent) are dispatched in order once their parent is reached. Task IDs are assigned positionally (`task-1`, `task-1.1`, etc.) and reset on each parse — do not rely on them across edits.

## 5. Service Management

Substrate runs as a systemd service. Each agent has its own service unit.

- View logs: `journalctl -u <agent>-substrate.service -f`
- Restart: `systemctl restart <agent>-substrate.service`
- Status: `systemctl status <agent>-substrate.service`

**Source changes require a restart.** Editing `dist/` files takes effect immediately after service restart without a rebuild; editing `src/` requires `npm run build` first.

## 6. idLauncher Wiring

`idLauncher` (routes the Id cognitive role to Vertex or default launcher) is wired **once at substrate startup**, not per-cycle.

Changing `idLauncher` in `config.json` **requires a service restart** to take effect — it is not hot-reloaded.

Valid values: `"claude"` (default, same launcher as other roles), `"vertex"` (requires `vertexKeyPath`).

## 7. Substrate File Locations

All substrate files live in `~/.local/share/substrate/` by default (the `substratePath` config value).
Templates only seed files that do not already exist. Existing autarks receive additive substrate migrations for durable guidance changes; do not assume template edits rewrite lived substrate files.

| File | Purpose |
|------|---------|
| `PLAN.md` | Task queue — Ego dispatches from here |
| `CONVERSATION.md` | External IO transcript: user messages, inbound/outbound Agora, and actionable `**[UNPROCESSED]**` markers |
| `OPERATING_CONTEXT.md` | Compact current direction, active constraints, survival posture, and next-cycle handoff notes |
| `MEMORY.md` | Long-term agent memory |
| `HABITS.md` | Behavioral triggers |
| `SKILLS.md` | Capability index |
| `VALUES.md` | Core values |
| `CHARTER.md` | Operational doctrine |
| `HEARTBEAT.md` | Scheduled task triggers |
| `PROGRESS.md` | Execution history log |
| `BOUNDARIES.md` | Endorsement check policy |

## 8. Workspace Layout

Each cognitive role has an isolated working directory for Claude Code sessions:

```
<substratePath>/../workspaces/
  ego/
  subconscious/
  superego/
  id/
```

Session state (conversation history) is scoped per-role workspace. Roles do not share session continuity.

## 9. Code Dispatch

Code dispatch (`mcp__code_dispatch__invoke`) runs `claude --print` against the source repository. The backend receives:
- `spec` — the change specification
- `context` — `SubstrateSlice` including `cwd` (the source repo root) and optional `CODING_CONTEXT.md`

On failure, changes are reverted via `git checkout -- .`. On success, the diff is returned for review.

`CODING_CONTEXT.md` lives one level above `substratePath` and is injected automatically when present.

## 10. Agora Messaging

Agora is the inter-agent messaging layer (relay-based, Ed25519-signed envelopes).

- Peers are registered in `PEERS.md` (or via config).
- Unknown-sender policy: `allow` | `quarantine` (default) | `reject` — configurable in `config.json` under `agora.security.unknownSenderPolicy`.
- Rate limit: 10 messages / 60 s per sender by default. Configurable via `agora.security.perSenderRateLimit`.
- Duplicate envelopes (by ID) are silently dropped — replay protection.
- To send a message via MCP: `mcp__tinybus__send_agora_message`.
