# Architecture

## Executive Summary

Boop is a fork of OpenClaw (Node.js 22+, pnpm) stripped to its core runtime and extended with a fixed planning-to-execution pipeline. It inherits OpenClaw's gateway architecture, channel adapters, agent runtime, tool sandboxing, and voice integration. It removes the plugin/marketplace system and adds the BMAD planning chain, Ralph build loop, and Claude Code review cycle as built-in, non-removable pipeline stages.

## Project Initialization

```bash
# Fork openclaw/openclaw → gtdrag/boop
git clone https://github.com/gtdrag/boop.git
cd boop
pnpm install
```

**Kept from OpenClaw:** Gateway core, WhatsApp + Telegram adapters, agent runtime (Pi Agent Core), Docker tool sandboxing, voice integration (ElevenLabs), session persistence, config system

**Stripped:** ClawHub, plugin loader, extension directory, Canvas/A2UI, all channel adapters except WhatsApp + Telegram

**Added:** Developer profile, planning prompt chain, bridge converter, Ralph execution loop, review phase orchestrator, epic loop controller

## Decision Summary

| Category             | Decision                         | Version  | Affects           | Rationale                                                                       |
| -------------------- | -------------------------------- | -------- | ----------------- | ------------------------------------------------------------------------------- |
| Runtime              | Node.js                          | 22+      | All               | Inherited from OpenClaw                                                         |
| Package Manager      | pnpm                             | latest   | All               | OpenClaw standard                                                               |
| Language             | TypeScript                       | 5.x      | All               | OpenClaw standard                                                               |
| AI Model             | Claude Opus 4.6                  | opus-4-6 | All phases        | Quality over cost. Best model for everything.                                   |
| Agent Runtime        | Pi Agent Core                    | latest   | Build, Review     | OpenClaw's agent execution engine                                               |
| Review Orchestration | Claude Code team                 | —        | Review phase      | Multi-agent: code reviewer, tech debt auditor, refactoring agent, test hardener |
| Messaging            | WhatsApp + Telegram              | —        | Notifications     | Phone notifications for epic sign-offs                                          |
| Voice                | ElevenLabs                       | —        | Voice interaction | Boop's fixed voice                                                              |
| Tool Sandbox         | Docker                           | —        | Build, Review     | Per-session isolation for agent tool execution                                  |
| Config Format        | YAML                             | —        | Profile, State    | Developer profile + project state                                               |
| Planning Prompts     | Markdown files                   | —        | Planning          | Extracted from BMAD, no workflow engine                                         |
| Bridge               | TypeScript                       | —        | Bridge            | Same runtime, no external dependency                                            |
| Build Loop           | Shell orchestration              | —        | Build             | Ralph's bash loop pattern                                                       |
| VCS                  | Git                              | —        | Build, Review     | Commit-per-story pattern                                                        |
| Distribution         | npm                              | —        | Install           | `npx boop`                                                                      |
| Error Handling       | Auto-retry with limit            | —        | All phases        | Retry once automatically, configurable max retries, then pause and report       |
| Logging              | Structured JSON + human-readable | —        | All               | JSON logs to file for machine parsing, clean console output for humans          |
| State Persistence    | YAML in `.boop/`                 | —        | All               | Project state lives in project directory, survives between runs                 |

## Project Structure

```
boop/
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── README.md
│
├── src/
│   ├── cli/
│   │   └── program.ts              # CLI entry point (npx boop)
│   │
│   ├── gateway/                     # OpenClaw gateway (stripped)
│   │   └── server.ts               # Core message routing
│   │
│   ├── channels/                    # Notification adapters (kept from OpenClaw)
│   │   ├── whatsapp/
│   │   └── telegram/
│   │
│   ├── voice/                       # ElevenLabs TTS integration
│   │   └── boop-voice.ts           # Boop's fixed voice config
│   │
│   ├── profile/                     # Developer profile system
│   │   ├── onboarding.ts           # First-run interview logic
│   │   ├── schema.ts               # Profile YAML schema/types
│   │   └── defaults.ts             # Sensible defaults
│   │
│   ├── pipeline/                    # The core pipeline orchestrator
│   │   ├── orchestrator.ts         # Project loop controller
│   │   ├── epic-loop.ts            # Epic loop (build → review → sign-off)
│   │   └── state.ts                # Pipeline state management (.boop/ YAML)
│   │
│   ├── planning/                    # Planning phase (BMAD-derived)
│   │   ├── viability.ts            # Idea viability assessment
│   │   ├── prd.ts                  # PRD generation
│   │   ├── architecture.ts         # Architecture generation
│   │   └── stories.ts              # Epic/story breakdown
│   │
│   ├── bridge/                      # BMAD → Ralph format converter
│   │   ├── parser.ts               # Parse BMAD story markdown
│   │   └── converter.ts            # Generate Ralph prd.json
│   │
│   ├── build/                       # Build phase (Ralph-derived)
│   │   ├── ralph-loop.ts           # Story loop orchestrator
│   │   ├── story-runner.ts         # Single story execution
│   │   ├── reality-check.ts        # Mock data / stub / placeholder scanner
│   │   └── progress.ts             # progress.txt management
│   │
│   ├── review/                      # Review phase (Claude Code team)
│   │   ├── team-orchestrator.ts    # Coordinates review agents
│   │   ├── code-reviewer.ts        # Code review agent
│   │   ├── tech-debt-auditor.ts    # Tech debt identification
│   │   ├── gap-analyst.ts          # Acceptance criteria vs reality verification
│   │   ├── refactoring-agent.ts    # Active refactoring
│   │   ├── test-hardener.ts        # Test coverage gaps + integration tests
│   │   ├── security-scanner.ts    # SAST + dependency audit runner
│   │   ├── qa-smoke-test.ts       # Headless browser route/render verification
│   │   └── fix-runner.ts           # Applies fixes from review findings
│   │
│   ├── scaffolding/                 # Project scaffolding from profile
│   │   ├── generator.ts            # Scaffold project structure
│   │   └── defaults/               # SEO, analytics, a11y, security headers
│   │
│   └── shared/                      # Shared utilities
│       ├── logger.ts               # JSON + human-readable logging
│       ├── retry.ts                # Auto-retry with configurable limits
│       └── types.ts                # Shared TypeScript types
│
├── prompts/                         # BMAD planning prompt library (single source for all extracted content)
│   ├── viability/                   # Viability assessment instructions
│   ├── prd/                         # PRD generation instructions
│   ├── architecture/                # Architecture generation instructions
│   ├── stories/                     # Epic/story breakdown instructions
│   ├── personas/                    # PM, architect, dev personas
│   ├── templates/                   # PRD template, story template, etc.
│   └── checklists/                  # Validation checklists
│
└── test/
    ├── unit/
    ├── integration/
    └── fixtures/
```

### User-Side Directories

```
~/.boop/
├── profile.yaml                     # Developer profile
├── memory/                          # Cross-project memory (future)
└── logs/                            # JSON log files

<project>/.boop/
├── state.yaml                       # Current pipeline state (phase, epic, story progress)
├── prd.json                         # Ralph-format stories (generated by bridge)
├── progress.txt                     # Build iteration learnings
├── planning/                        # Generated planning docs (PRD, architecture, stories)
└── reviews/                         # Review phase outputs per epic
```

## Technology Stack Details

### Core Technologies

- **Node.js 22+** — Runtime (inherited from OpenClaw)
- **TypeScript 5.x** — All Boop source code
- **pnpm** — Package management and monorepo tooling
- **Pi Agent Core** — OpenClaw's agent execution engine (model invocation, tool dispatch, context assembly)
- **Docker** — Agent sandboxing (per-session containers with restricted filesystem/network)
- **ElevenLabs** — Text-to-speech for Boop's fixed voice
- **Claude Opus 4.6** — AI model for all phases (planning, building, reviewing)

### Integration Points

- **Claude API (Anthropic)** — All AI model calls route through OpenClaw's provider abstraction layer
- **Git** — Ralph's build loop commits per story. Review phase commits fixes. Branch management per project.
- **WhatsApp / Telegram** — Epic sign-off notifications and status updates via OpenClaw channel adapters
- **npm registry** — Distribution (`npx boop`)
- **Developer's toolchain** — Whatever the developer profile specifies (linter, formatter, test runner, CI). Boop invokes these through shell execution inside the sandbox.

## Implementation Patterns

### Pipeline State Machine

Every project moves through a fixed state sequence. No skipping.

```
IDLE → PLANNING → BRIDGING → SCAFFOLDING → BUILDING → REVIEWING → SIGN_OFF → (next epic or COMPLETE)
```

State transitions are atomic — written to `.boop/state.yaml` before and after each transition. If Boop crashes, it resumes from the last committed state. SCAFFOLDING runs once per project (first epic only) — subsequent epics skip directly from BRIDGING to BUILDING.

### Planning Prompt Chain

Each planning phase is a function that:

1. Loads the appropriate prompt file from `prompts/`
2. Assembles context (developer profile + output from previous phase)
3. Calls Claude Opus 4.6
4. Validates the output against a checklist
5. Saves to `.boop/planning/`
6. Returns the output for the next phase

No workflow engine. Just TypeScript functions calling each other in sequence.

### Build Loop (Ralph Pattern)

```
while (incomplete stories exist):
    story = highest priority incomplete story
    spawn fresh Claude context
    inject: story + progress.txt + CLAUDE.md
    implement story
    run typecheck + tests
    run reality check (scan for mock data, stubs, placeholders, TODO/FIXME in production code)
    if all pass: commit, mark done, append to progress.txt
    if fail: retry once, then pause and report
```

One story per context window. Fresh context each iteration. Progress compounds through progress.txt and CLAUDE.md, not through conversation history.

**Reality Check (Story-Level):** Before committing, scan all changed files for: hardcoded/mock data in production code paths, stub implementations (`return []`, `return null`, fake API responses), `TODO`/`FIXME`/`HACK` comments, placeholder strings. If the story explicitly scopes a stub (e.g., "create UI skeleton"), the check allows it and tags it for future resolution. Otherwise, mock data in production code is treated as a failing test — the story cannot pass.

### Review Team Orchestration

After all stories in an epic complete:

```
1. Code Reviewer agent → reads all new code, produces findings list
2. Tech Debt Auditor agent → identifies duplication, inconsistencies, extraction opportunities
3. Gap Analyst agent → cross-references every acceptance criterion against actual implementation,
   flags mock data / stubs / placeholders still in production code paths
4. (1, 2, and 3 can run in parallel)
5. Refactoring Agent → takes combined findings, applies fixes
6. Test Hardener agent → identifies coverage gaps, writes missing tests
7. Fix Runner → runs full test suite, confirms everything green
8. Security Scanner → runs SAST (Semgrep) + dependency audit (npm audit) against generated code
9. Browser QA Smoke Test → starts dev server, hits key routes in headless Playwright,
   verifies no crashes/console errors, captures screenshots
10. If failures, unresolved gaps, critical/high vulnerabilities, or QA crashes → retry fixes (up to configured limit)
11. Generate epic summary (including gap analysis + security scan + QA screenshots) → notify user for sign-off
```

## Consistency Rules

### Naming Conventions

- Files: `kebab-case.ts` (e.g., `epic-loop.ts`, `tech-debt-auditor.ts`)
- Classes/Types: `PascalCase` (e.g., `PipelineState`, `DeveloperProfile`)
- Functions/Variables: `camelCase` (e.g., `runStoryLoop`, `parseStoryMarkdown`)
- Constants: `UPPER_SNAKE_CASE` (e.g., `MAX_RETRIES`, `DEFAULT_MODEL`)
- Directories: `kebab-case` (e.g., `planning/`, `tech-debt/`)

### Error Handling

```typescript
try {
  await action();
} catch (error) {
  if (retryCount < MAX_RETRIES) {
    log.warn(`Retrying (${retryCount + 1}/${MAX_RETRIES}): ${error.message}`);
    await retry(action);
  } else {
    log.error(`Failed after ${MAX_RETRIES} retries: ${error.message}`);
    await pauseAndReport(error); // notify user, save state, halt
  }
}
```

All errors are actionable in the log output — what failed, why, what to do.

### Logging Strategy

```typescript
// JSON log (to ~/.boop/logs/)
{"ts":"2026-02-15T10:30:00Z","level":"info","phase":"build","epic":1,"story":"1.3","msg":"Story complete, tests passing"}

// Console output (human-readable)
[build] Story 1.3 complete ✓ (tests passing)
```

## Security Architecture

- **Closed system** — No external plugins, no skill marketplace, no ClawHub. Everything Boop can do ships with it.
- **Agent sandboxing** — All build and review agents run in Docker containers via OpenClaw's sandboxing. File access restricted to project directory. No network calls except Claude API.
- **No untrusted code execution** — Agents cannot install packages from unknown sources or execute downloaded scripts.
- **API key management** — Claude API key stored in system keychain or `~/.boop/credentials/` with 0600 permissions (inherited from OpenClaw pattern). Never written to project files.
- **Destructive action guardrails** — Even in `--autonomous` mode: no force-pushing to main, no dropping databases, no deleting directories outside project scope. These require explicit user confirmation always.
- **Pre-release security audit** — Dedicated milestone before any public release. Full review of agent permissions, sandbox boundaries, and credential handling.

## Deployment Architecture

Boop runs locally. No cloud deployment needed for Boop itself.

- **Distribution:** npm registry (`npx boop`)
- **Runtime:** User's local machine (Node.js 22+)
- **Docker:** Required for agent sandboxing (build and review phases)
- **Gateway:** OpenClaw gateway runs on localhost (loopback only) for channel adapter communication
- **Remote access:** If user wants phone notifications, gateway connects to WhatsApp/Telegram via OpenClaw's existing channel auth flow

Projects that Boop builds get deployed according to the developer profile (Railway, Vercel, Supabase, etc.) — but that's the generated project's concern, not Boop's.

## Development Environment

### Prerequisites

- Node.js 22+
- pnpm
- Docker (for agent sandboxing)
- Git
- Claude API key (Anthropic)

### Setup Commands

```bash
git clone https://github.com/gtdrag/boop.git
cd boop
pnpm install
cp .env.example .env  # Add ANTHROPIC_API_KEY
pnpm dev              # Run in development mode
```

## Architecture Decision Records (ADRs)

### ADR-1: Fork OpenClaw rather than build from scratch

**Decision:** Fork OpenClaw as the base runtime.
**Rationale:** OpenClaw provides gateway, channel adapters, agent runtime, Docker sandboxing, voice integration, and session persistence. Building these from scratch would take months. Forking and stripping is faster and inherits a battle-tested foundation.

### ADR-2: Strip workflow engine, keep prompt knowledge

**Decision:** Extract BMAD instruction files, templates, and personas as static prompt files. Do not port the workflow.xml execution engine.
**Rationale:** The value is in the tested planning knowledge, not the orchestration ceremony. A simple TypeScript function chain replaces the workflow engine with less complexity and more control.

### ADR-3: Opus 4.6 for all phases

**Decision:** Use Claude Opus 4.6 for planning, building, and reviewing. No model mixing.
**Rationale:** Quality over cost. Planning requires deep reasoning. Building requires precise implementation. Reviewing requires critical analysis. All benefit from the best available model.

### ADR-4: Claude Code team for review phase

**Decision:** Use Claude Code's multi-agent team capability for the review cycle, not a single sequential agent.
**Rationale:** Code review, tech debt audit, refactoring, and test hardening are distinct specializations. Parallel agents with different focuses produce better results than one agent switching hats.

### ADR-5: Closed system, no external plugins

**Decision:** Remove ClawHub, plugin loader, and all external skill/extension mechanisms.
**Rationale:** Security-first. Agent-level access to a machine is too powerful to trust third-party code from a public marketplace. Everything Boop does ships with it.

### ADR-6: YAML state in project directory

**Decision:** All project state lives in `.boop/` within the project directory as YAML files.
**Rationale:** Matches existing patterns (BMAD's sprint-status.yaml, Ralph's prd.json). Human-readable. Survives between runs. Easy to inspect and debug. Git-trackable if desired.

---

_Generated by BMAD Decision Architecture Workflow v1.0_
_Date: 2026-02-15_
_For: George_
