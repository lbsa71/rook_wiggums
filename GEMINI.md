# Substrate Foundational Mandates

This repository is **Substrate** - a self-referential AI agent orchestration shell. It wraps AI execution in a continuous loop with four cognitive roles (Ego, Subconscious, Superego, Id), persistent file-based memory ("substrate"), and autonomous goal-setting capabilities.

## Way of Working
* **Smallest Valuable Increment:** Always decompose tasks into the smallest possible valuable increments.
* **Simplicity & Legibility:** Prioritize simple, readable code. If a clean solution requires refactoring existing code first, perform the refactor before implementing the change.
* **Test-Driven Development (TDD):** Strictly follow the red-green-refactor cycle. No implementation code should be written without a corresponding failing test.
* **Boy Scout Rule:** Always leave the codebase in a better state than you found it.
* **Environmental Abstraction:** All environment resources (environment settings, file system, time) MUST be abstracted (e.g., `IFileSystem`, `IClock`) and injected into modules for testability.
* **Mock Everything in Tests:** Use in-memory implementations (`InMemoryFileSystem`, `FixedClock`) for tests.
* **Timestamp Injection:** NEVER use `new Date()` or `Date.now()` directly in logic. Always inject timestamps via `IClock.now()`.

## Coding Conventions
### Naming
- **Classes**: PascalCase (e.g., `LoopOrchestrator`)
- **Files**: Match class names (e.g., `Ego.ts`); utilities are camelCase.
- **Interfaces**: PascalCase with `I` prefix (e.g., `IFileSystem`).
- **Functions/Variables**: camelCase.
- **Constants**: UPPER_SNAKE_CASE.

### Dependency Injection
**Always use constructor injection**. All I/O and external dependencies must be passed as interfaces.

### Error Handling
- Use explicit checks (e.g., `assertCanRead()`) before operations.
- Include context in error messages (e.g., "Decision failed: {message}").
- Wrap async operations in try-catch and return safe defaults or typed result objects.

## Repository Structure & Commands
- **Backend**: `server/` (Node.js + TypeScript)
- **Frontend**: `client/` (React + Vite + TypeScript)

### Essential Commands
- `npm install`: Install all workspace dependencies.
- `cd server && npm run init`: Initialize substrate files (first time).
- `npm run server:dev`: Start backend with watching.
- `npm run client:dev`: Start frontend dev server.
- `npm test`: Run all workspace tests.
- `cd server && npm test`: Run server tests (Jest).
- `cd client && npm test`: Run client tests (Vitest).
- `npm run build`: Build both workspaces.

## Substrate Architecture
The system's memory consists of 12 markdown files (the "substrate"). Each must start with a `# Heading`.

| File | Write Mode | Purpose |
|------|-----------|---------|
| PLAN.md | OVERWRITE | Current task tree |
| PROGRESS.md | APPEND | Timestamped execution log |
| CONVERSATION.md | APPEND | Message transcript (compacts hourly) |
| MEMORY.md | OVERWRITE | Long-term knowledge index |
| ... | ... | ... |

**Permissions**: Always use `PermissionChecker` before read/write operations on substrate files. Each role (Ego, Subconscious, Superego, Id) has specific access rights.

## Versioning & Releases
* **Version Updates:** Update `package.json` in the relevant workspace (`server/` or `client/`) for every significant update (at least patch level) before committing.
* **Build Verification:** Ensure the project builds successfully (`npm run build`) and all tests pass before finishing a task.

## Supervisor Pattern
The server uses a supervisor (`server/src/supervisor.ts`).
- **Exit code 75**: Triggers rebuild and restart.
- **Idle watchdog**: Kills process after 2 minutes of no output.
- **Hard ceiling**: 30 minutes absolute maximum execution time.
