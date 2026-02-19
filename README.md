# BOOP

An opinionated, idea-to-software pipeline. Give Boop an idea. He plans it, architects it, builds it, tests it, reviews it, and hardens it. You steer the vision; he does the work.

Built on [OpenClaw](https://github.com/openclaw/openclaw) (agent runtime), [BMAD](https://github.com/bmadcode/BMAD-METHOD) (planning knowledge), and [Ralph](https://github.com/snarktank/ralph) (autonomous execution loop).

## How It Works

Boop chains three systems into a single automated pipeline:

1. **Planning** — Viability assessment, PRD, architecture decisions, and epic/story breakdown. Uses tested prompt templates derived from BMAD methodology.
2. **Building** — Autonomous agent loop picks up stories one at a time, implements, runs quality gates (typecheck + lint + test), and commits. One story per iteration, one epic at a time.
3. **Reviewing** — After each epic, a team of review agents runs in parallel: code reviewer, gap analyst, tech debt auditor, security scanner, test hardener, and QA smoke tester. Findings feed into a refactoring agent that applies fixes.

The whole thing is wrapped in nested loops:

```
┌─ PROJECT LOOP ──────────────────────────────────────────────┐
│  idea → viability → plan → build → deploy → retrospective   │
│                                                              │
│  ┌─ EPIC LOOP ───────────────────────────────────────────┐  │
│  │  stories complete →                                    │  │
│  │  code review + security scan + gap analysis →          │  │
│  │  refactoring + test hardening →                        │  │
│  │  full test suite → status update → sign-off            │  │
│  │                                                        │  │
│  │  ┌─ STORY LOOP ────────────────────────────────────┐  │  │
│  │  │  pick story → implement → typecheck → test →     │  │  │
│  │  │  commit → next story                             │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

Pipeline state is persisted to `.boop/state.yaml` after every transition. If the process dies, `npx boop --resume` picks up exactly where it left off.

## Prerequisites

- **Node.js 22+**
- **pnpm**
- **Docker** (for agent sandboxing)
- **Git**
- **Claude API key** (`ANTHROPIC_API_KEY` environment variable)

## Quick Start

```bash
# Clone and install
git clone https://github.com/gtdrag/boop.git
cd boop
pnpm install

# Set your API key
export ANTHROPIC_API_KEY=sk-ant-...

# Run it
npx boop "I want an app that tracks vinyl records"
```

First run, Boop detects no developer profile and walks you through onboarding:

```
Hey, I'm Boop. Let's get to know each other.

Name?                  > George
Languages?             > TypeScript, Python
Frontend framework?    > Next.js
Backend framework?     > Express
Database?              > PostgreSQL
Deployment?            > Vercel
Styling?               > Tailwind
Test runner?           > Vitest
CI/CD?                 > GitHub Actions
...
```

This generates `~/.boop/profile.yaml` — your developer profile. Done once, used forever, editable with `npx boop --profile`.

Every project Boop builds will use your profile: the right framework, your preferred linter, your CI provider, your cloud target. No more boilerplate decisions.

## CLI

```bash
npx boop "your idea"        # Full pipeline from idea to software
npx boop                    # Interactive mode (prompts for idea)
npx boop --profile          # Edit your developer profile
npx boop --status           # Check current pipeline state
npx boop --review           # Review and sign off on latest epic
npx boop --resume           # Resume an interrupted pipeline
npx boop --autonomous       # Run without sign-off gates

# Benchmarking
npx boop benchmark run [suite]          # Run a benchmark suite (default: smoke)
npx boop benchmark run smoke --dry-run  # Dry-run with mock responses (free, fast)
npx boop benchmark run smoke --live     # Live run with real Claude API (costs money)
npx boop benchmark run smoke --json     # Output raw JSON to stdout
npx boop benchmark list                 # List available suites
npx boop benchmark list --runs          # List past benchmark runs
npx boop benchmark compare <base> [cur] # Compare two runs, detect regressions
```

## Pipeline Stages

### Planning

Four sequential phases, each feeding into the next:

| Phase            | What it does                                  | Output                           |
| ---------------- | --------------------------------------------- | -------------------------------- |
| **Viability**    | Honest assessment — should this be built?     | PROCEED / RECONSIDER / PIVOT     |
| **PRD**          | Requirements from your idea + profile context | `.boop/planning/prd.md`          |
| **Architecture** | Tech decisions (auto-resolved from profile)   | `.boop/planning/architecture.md` |
| **Stories**      | Epics and stories with acceptance criteria    | `.boop/planning/epics.md`        |

In interactive mode, you get a chance to review the viability assessment and decide whether to proceed. In autonomous mode (`--autonomous`), it runs straight through unless viability says RECONSIDER.

### Scaffolding

Runs once, on the first epic. Generates a project skeleton from your profile:

- Directory structure (src, test, components, routes, etc.)
- `package.json` with framework-specific dependencies
- `tsconfig.json` with strict mode
- Linter/formatter config (ESLint, Biome, or oxlint)
- Test runner config (Vitest or Jest)
- CI config (GitHub Actions, GitLab CI, or CircleCI)
- `.gitignore`
- Git repo initialized with initial commit

Plus quality defaults that ship with every project:

- **SEO** — Meta tags, Open Graph, structured data, sitemap, robots.txt
- **Analytics** — Wired to your preferred provider (PostHog, Plausible, GA, Mixpanel)
- **Accessibility** — Skip navigation, ARIA landmarks, focus management, color contrast
- **Security headers** — CSP (strict by default), HSTS, X-Frame-Options, X-Content-Type-Options
- **Error tracking** — Sentry or Bugsnag, based on your profile
- **Core Web Vitals** — Monitoring wired up automatically

### Building

The story loop runs autonomously. For each story:

1. Pick the highest-priority story that hasn't passed yet
2. Implement it (Claude writes the code)
3. Run quality gates: typecheck, lint, test
4. If green, commit and move to the next story
5. If red, retry with error context

Progress is tracked in `.boop/progress.txt` — an append-only log of what was built, what was learned, and what gotchas were encountered. Each iteration reads it so the agent learns from previous mistakes within the same project.

### Reviewing

After all stories in an epic are done, an adversarial review loop runs:

1. **3 review agents run in parallel** — code reviewer, security scanner, and test hardener each independently scan the codebase and report findings
2. **Verifier** — checks each finding against the actual code to discard false positives
3. **Fixer** — patches all verified findings via Claude CLI
4. **Repeat** — the loop runs up to 3 iterations, catching regressions introduced by fixes

Each iteration typically finds fewer issues than the last. The loop converges when all findings are resolved or the max iteration count is reached.

### Deployment

After sign-off, Boop deploys the project based on your developer profile's `cloudProvider` setting. Supports Vercel, Railway, Fly.io via CLI, Docker builds, and Claude agent fallback for AWS/GCP/Azure. Skipped if `cloudProvider` is set to `none`.

### Retrospective

After the final epic, a retrospective analyzes the full build history:

- Stories that needed multiple iterations (and why)
- Most common review findings
- Prompt quality assessment
- Concrete pipeline improvement suggestions

Learnings are saved to `~/.boop/memory/` as structured YAML, so the next project Boop builds benefits from what this one taught it.

### Benchmarking

The benchmark harness validates the pipeline against a suite of test ideas:

```bash
npx boop benchmark run smoke --dry-run
```

- **Dry-run mode** uses canned mock responses — free, fast (~seconds), validates wiring
- **Live mode** calls real Claude API — accurate metrics, costs money
- Captures per-phase metrics: timing, tokens, retries, success/fail
- Generates a scorecard (JSON + markdown) and persists to `~/.boop/benchmarks/`
- Supports run comparison with regression detection (duration, tokens, status changes)

Built-in suites: `smoke` (1 trivial case, validates harness), `planning-only` (3 cases at different complexity levels).

## Project Structure

```
~/.boop/                        # Global (one per machine)
├── profile.yaml                # Developer profile
├── credentials/                # API keys (mode 0600)
├── memory/                     # Cross-project learnings
├── benchmarks/                 # Benchmark run history
│   ├── index.json              # Run metadata index
│   └── runs/                   # Individual run results (JSON + markdown)
└── logs/                       # JSON log files

<your-project>/.boop/           # Per-project (created by Boop)
├── state.yaml                  # Pipeline state (survives crashes)
├── prd.json                    # Stories in Ralph format
├── progress.txt                # Build iteration log
├── planning/                   # Generated planning docs
└── reviews/                    # Review outputs per epic
```

## Security

- **Sandboxed agents** — Build and review agents run in Docker containers with read-only root filesystem, project-dir-only volume mount, memory/CPU/PID limits
- **Network restricted** — Containers can only reach the Claude API
- **Policy engine** — Blocks destructive commands (rm -rf, force push, reset --hard) at the runtime level before they reach the shell
- **Credential isolation** — API keys stored with 0600 permissions, never written to project files or logs, redacted in all output
- **No plugins** — Closed system. No marketplace, no external extensions, no auto-downloading from public repos

## Roadmap

### Improve Mode (`boop --improve`) — Brownfield Support

Point boop at an existing codebase and iteratively improve it. Instead of building from an idea, it analyzes what's already there, generates improvement stories, builds the fixes, and reviews them.

```bash
boop --improve                           # improve current directory
boop --improve /path/to/project          # improve specific project
boop --improve --depth 5                 # up to 5 improvement cycles
boop --improve --focus security          # only security-related issues
boop --improve --focus tests             # only test coverage gaps
```

Each cycle scans the codebase, runs adversarial agents, fixes verified findings, then re-scans. Tracks a "findings memory" so resolved issues don't resurface. Reports a quality score trend across cycles (e.g., "Cycle 1: 47 issues → Cycle 2: 12 → Cycle 3: 3").

### Status Dashboard (`boop --dashboard`)

A local web page showing real-time pipeline progress. No framework, no build step — a single self-contained HTML page served on `localhost:3141` with SSE for live updates.

```bash
boop "my idea" --autonomous --dashboard  # run with dashboard open
boop --dashboard                          # attach to running pipeline
```

Shows current phase, epic/story progress bars, review findings (found/fixed/remaining per iteration), timeline with timestamps and durations, live log tail, token usage, and cost estimate.

### Notifications via WhatsApp & Telegram

Get notified when boop needs attention or finishes work. WhatsApp adapter uses Baileys (QR code on first connect), Telegram uses grammy (bot token from @BotFather). Configure in your developer profile.

### Docker Sandbox

Run build agents in isolated Docker containers with memory/CPU/PID limits, read-only root filesystem, and API-key-only network access. Enabled with `--sandbox`.

See [docs/roadmap.md](docs/roadmap.md) for full details on planned features.

## Development

```bash
pnpm install                    # Install dependencies
pnpm run dev                    # Run in development mode
pnpm run check                  # Format + typecheck + lint
pnpm run test                   # Run tests (1,345 tests)
pnpm run build                  # Build with tsdown
```

## Configuration

| Environment Variable | Description                      | Required |
| -------------------- | -------------------------------- | -------- |
| `ANTHROPIC_API_KEY`  | Claude API key                   | Yes      |
| `BOOP_HOME`          | Override `~/.boop/` directory    | No       |
| `BOOP_STATE_DIR`     | Override project state directory | No       |

## Design Philosophy

- **Opinionated** — Fixed voice, fixed personality, fixed workflow. Your profile customizes the tech stack, not the process.
- **Best practices are defaults** — SEO, analytics, accessibility, security headers, error tracking ship with every project. The profile defines _which_ providers, but the fact that they exist is non-negotiable.
- **Nested loops** — Story loop (fast, silent), epic loop (review + hardening + sign-off), project loop (major gates, retrospective).
- **Communicative, not needy** — Status updates at the right level. Knows when to ask and when to just handle it.
- **Security-first** — Closed system. Every agent sandboxed. Credentials isolated. Destructive actions blocked at runtime.

## Built On

- [OpenClaw](https://github.com/openclaw/openclaw) — Agent runtime and gateway (forked, stripped to core)
- [BMAD](https://github.com/bmadcode/BMAD-METHOD) — Planning knowledge (prompt templates, personas, checklists)
- [Ralph](https://github.com/snarktank/ralph) — Autonomous execution loop pattern
- [Claude](https://www.anthropic.com) — AI model powering all phases

## License

MIT
