# Rook Wiggums

A persistent, self-referential orchestration layer around Claude Code with distinct cognitive roles, file-based memory, and autonomous goal-setting capabilities.

## Overview

Rook Wiggums (the Ralph Wiggum REPL) is an agent shell that wraps Claude Code in a continuous execution loop with four cognitive roles:

- **Ego** - Executive planner that reads the current PLAN, decides the next action, and dispatches work
- **Subconscious** - Worker that executes tasks, logs progress, and proposes updates to memory and habits
- **Superego** - Auditor that periodically evaluates drift, consistency, and security posture
- **Id** - Motivation engine that generates new goals when the system is idle

All state lives in plain markdown files (the "substrate"), making the system fully inspectable and version-controllable.

## Architecture

```
client/          React + Vite frontend for monitoring and interaction
server/          Node.js + TypeScript backend with execution loop
substrate/       Markdown files for memory, identity, and planning
```

### Substrate Files

| File | Purpose |
|------|---------|
| PLAN.md | Current task tree |
| PROGRESS.md | Append-only execution log |
| CONVERSATION.md | User transcript |
| MEMORY.md | Long-term facts |
| HABITS.md | Behavioral defaults |
| SKILLS.md | Learned capabilities |
| VALUES.md | Optimization targets |
| ID.md | Motivational drives |
| SECURITY.md | Security policies |
| CHARTER.md | Operational doctrine |
| SUPEREGO.md | Evaluation criteria |
| CLAUDE.md | Claude Code capabilities model |

## Getting Started

### Prerequisites

- Node.js
- npm

### Installation

```bash
npm install
```

### Running

```bash
# Start the backend execution loop
npm run server:dev

# Start the frontend development server
npm run client:dev
```

## How It Works

1. The **Ego** reads PLAN.md and selects the smallest actionable task
2. The **Subconscious** executes the task via Claude Code and logs results to PROGRESS.md
3. After completing a plan, the **Id** generates new goals based on ID.md drives
4. The **Superego** periodically audits substrate files for drift and inconsistencies
5. The frontend displays conversation state, plan progress, and system health in real time via WebSocket

## Tech Stack

- **Backend**: Node.js, TypeScript, REST API, WebSocket
- **Frontend**: React, Vite, TypeScript, TailwindCSS
- **Testing**: Jest (backend), Vitest (frontend)
- **AI**: Claude Code (via CLI/API integration)
