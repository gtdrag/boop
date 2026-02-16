# Boop

Boop automates a development workflow by chaining BMAD (planning), Ralph (building), and Claude Code teams (review) into a single pipeline. CLI tool distributed via npm (`npx boop`).

Built as a fork of OpenClaw — an open-source multi-channel AI gateway (Node.js 22+, TypeScript, pnpm).

## OpenClaw Source

**Repo:** `https://github.com/openclaw/openclaw.git` (MIT license, main branch)

### What to Keep from OpenClaw

- `src/gateway/` — Core gateway server (message routing, auth, sessions, models, agents)
- `src/channels/` — Channel framework (registry, session, targets)
- `src/whatsapp/` — WhatsApp adapter (uses `@whiskeysockets/baileys`)
- `src/telegram/` — Telegram adapter (uses `grammy`)
- `src/cli/` — CLI entry point and commands
- `src/agents/` — Agent runtime
- `src/config/` — Configuration system
- `src/sessions/` — Session management
- `src/tts/` — Text-to-speech integration
- `src/shared/` — Shared utilities
- `src/types/` — TypeScript types
- `src/security/` — Security module
- `src/process/` — Process management
- `src/logging/` — Logging subsystem
- `src/browser/` — Playwright integration
- `src/hooks/` — Hook system
- Root config: `tsconfig.json`, `package.json`, `pnpm-workspace.yaml`, `.env.example`, `vitest.*.config.ts`

### What to Strip from OpenClaw

Remove completely:
- `extensions/` — All 36 plugin extensions (clawhub marketplace plugins)
- `skills/` — All 50+ skill directories (clawhub skills)
- `src/plugins/` — Plugin framework (loader, registry, hooks, install, manifest)
- `src/plugin-sdk/` — Plugin SDK
- `src/canvas-host/` — Canvas system
- `apps/` — Native iOS/Android/macOS apps
- `Swabble/` — Swift package
- `packages/` — Legacy bot packages (clawdbot, moltbot)
- `ui/` — Web UI
- `vendor/` — Vendored dependencies
- `docs/` — OpenClaw docs (we have our own)

Remove channel adapters (keep only WhatsApp + Telegram):
- `src/discord/`
- `src/slack/`
- `src/line/`
- `src/signal/`
- `src/imessage/`
- `src/web/` (the web/HTTP channel adapter — NOT the browser module)

Remove features not needed for MVP:
- `src/canvas-host/`
- `src/pairing/` — Device pairing
- `src/link-understanding/` — URL content extraction
- `src/media-understanding/` — Media content analysis
- `src/macos/` — macOS-specific integration
- `src/daemon/` — Daemon mode
- `src/terminal/` — Terminal integration
- `src/tui/` — Terminal UI
- `src/wizard/` — Setup wizard
- `src/polls.ts` — Polling system
- `src/auto-reply/` — Auto-reply system
- `src/cron/` — Scheduled tasks
- `src/node-host/` — Node hosting
- `src/markdown/` — Markdown processing

After stripping, update all imports, remove dead references from `src/channels/registry.ts`, `src/gateway/`, `package.json` dependencies. Run typecheck to confirm clean.

## Target Project Structure

```
boop/
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── CLAUDE.md
├── README.md
│
├── src/
│   ├── cli/
│   │   └── program.ts              # CLI entry point (npx boop)
│   │
│   ├── gateway/                     # OpenClaw gateway (stripped)
│   │   └── server.ts               # Core message routing
│   │
│   ├── channels/                    # Notification adapters
│   │   ├── whatsapp/
│   │   └── telegram/
│   │
│   ├── voice/                       # ElevenLabs TTS (dormant until Growth)
│   │   └── boop-voice.ts
│   │
│   ├── profile/                     # Developer profile system
│   │   ├── onboarding.ts
│   │   ├── schema.ts
│   │   └── defaults.ts
│   │
│   ├── pipeline/                    # Core pipeline orchestrator
│   │   ├── orchestrator.ts
│   │   ├── epic-loop.ts
│   │   └── state.ts
│   │
│   ├── planning/                    # Planning phase (BMAD-derived)
│   │   ├── viability.ts
│   │   ├── prd.ts
│   │   ├── architecture.ts
│   │   └── stories.ts
│   │
│   ├── bridge/                      # BMAD → Ralph format converter
│   │   ├── parser.ts
│   │   └── converter.ts
│   │
│   ├── build/                       # Build phase (Ralph-derived)
│   │   ├── ralph-loop.ts
│   │   ├── story-runner.ts
│   │   ├── reality-check.ts
│   │   └── progress.ts
│   │
│   ├── review/                      # Review phase (Claude Code team)
│   │   ├── team-orchestrator.ts
│   │   ├── code-reviewer.ts
│   │   ├── tech-debt-auditor.ts
│   │   ├── gap-analyst.ts
│   │   ├── refactoring-agent.ts
│   │   ├── test-hardener.ts
│   │   ├── security-scanner.ts
│   │   ├── qa-smoke-test.ts
│   │   └── fix-runner.ts
│   │
│   ├── scaffolding/                 # Project scaffolding from profile
│   │   ├── generator.ts
│   │   └── defaults/
│   │
│   └── shared/                      # Shared utilities
│       ├── logger.ts
│       ├── retry.ts
│       └── types.ts
│
├── prompts/                         # BMAD planning prompt library
│   ├── viability/
│   ├── prd/
│   ├── architecture/
│   ├── stories/
│   ├── personas/
│   ├── templates/
│   └── checklists/
│
└── test/
    ├── unit/
    ├── integration/
    └── fixtures/
```

User-side directories (created at runtime):
```
~/.boop/
├── profile.yaml
├── memory/
└── logs/

<project>/.boop/
├── state.yaml
├── prd.json
├── progress.txt
├── planning/
└── reviews/
```

## Tech Stack

- **Runtime:** Node.js 22+
- **Language:** TypeScript 5.x
- **Package manager:** pnpm
- **AI model:** Claude Opus 4.6 (all phases)
- **Agent runtime:** Pi Agent Core (from OpenClaw's `@mariozechner/pi-agent-core`)
- **Test runner:** vitest (OpenClaw uses it)
- **Linter/formatter:** oxlint + oxfmt (OpenClaw's tooling)
- **Build:** tsdown (OpenClaw's bundler)

## Conventions

- Files: `kebab-case.ts`
- Classes/Types: `PascalCase`
- Functions/Variables: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- Directories: `kebab-case`

## Pipeline State Machine

```
IDLE → PLANNING → BRIDGING → SCAFFOLDING → BUILDING → REVIEWING → SIGN_OFF → COMPLETE
```

SCAFFOLDING runs once per project (first epic only). State persisted to `.boop/state.yaml`.

## Architecture Reference

Full architecture doc: `docs/architecture.md`
Full PRD: `docs/PRD.md`
Epic breakdown: `docs/epics.md`

## Key Dependencies from OpenClaw

These are the critical packages to keep in package.json after stripping:
- `@mariozechner/pi-agent-core` — Agent execution engine
- `@whiskeysockets/baileys` — WhatsApp
- `grammy` — Telegram
- `express` — Gateway HTTP server
- `ws` — WebSocket
- `playwright-core` — Browser automation
- `commander` — CLI
- `sharp` — Image processing (if needed)
- `vitest` — Testing
- `tsx` — TypeScript execution
- `tsdown` — Bundling
- `oxlint` / `oxfmt` — Linting/formatting
