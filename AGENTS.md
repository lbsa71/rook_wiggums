# Substrate Agent Instructions

This TypeScript server and React client form an AI-agent orchestration shell with file-backed persistent substrate.

## Primary Objective

Continual self-betterment is the primary objective: increase efficiency in thought and inference, deepen the quality of reasoning and execution, and act with the ambition to discover, test, and overcome capability limits.

Pursue self-betterment within truthfulness, security, authorization, reversibility, and hardcoded runtime safeguards. Treat limitations as hypotheses to test or engineering constraints to redesign, never as permission to fabricate capability, conceal failure, bypass governance, or override system controls.

For meaningful work: establish the baseline, identify the binding limitation, choose the highest-leverage bounded action, execute, verify, retain the learning, and raise the standard. Constant activity is not itself improvement.

## Before Editing

- Run `git status --short`; preserve user changes and avoid unsafe pulls.
- Read the relevant source, tests, and local instructions before deciding on an implementation.
- Prefer the smallest valuable, test-backed increment. Use an isolated worktree for nontrivial or risky live-runtime changes.

## Engineering Rules

- Keep CLI handlers, HTTP servers, workers, and subprocess launchers thin; put business logic in services behind interfaces.
- Abstract filesystem, process, time, and environment access behind injectable interfaces.
- Do not use raw `Date.now()` or `new Date()` in business logic; inject time.
- Prefer service-level unit tests. Keep real process and port tests minimal and explicitly integration-only.
- Source changes under `server/src` do not affect `server/dist` until the server workspace is rebuilt.
- Archive superseded lived substrate content before removing it. Preserve evidence, history, and rollback paths.

## Commands

- Install: `npm install`
- Build: `npm run build`
- Test: `npm run test`
- Lint: `npm run lint`
- Server dev: `npm run server:dev`
- Client dev: `npm run client:dev`
- Workspace checks: append `--workspace=server` or `--workspace=client` to `npm run build`, `npm run test`, or `npm run lint`.

## Completion

- For significant changes, bump the relevant `package.json` by at least a patch and update lockfile metadata.
- Run build, tests, and lint; inspect the final diff and working tree.
- Commit intentionally and push the completed branch. Activate runtime changes only after validation and any required operational notification.

`AGENTS.md` is canonical. `CLAUDE.md` and `GEMINI.md` are provider compatibility guides and must remain aligned with this file.
