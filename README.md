# Boop

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
```

## Pipeline Stages

### Planning

Four sequential phases, each feeding into the next:

| Phase | What it does | Output |
|-------|-------------|--------|
| **Viability** | Honest assessment — should this be built? | PROCEED / RECONSIDER / PIVOT |
| **PRD** | Requirements from your idea + profile context | `.boop/planning/prd.md` |
| **Architecture** | Tech decisions (auto-resolved from profile) | `.boop/planning/architecture.md` |
| **Stories** | Epics and stories with acceptance criteria | `.boop/planning/epics.md` |

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

After all stories in an epic are done, a review team runs in parallel:

| Agent | What it does |
|-------|-------------|
| **Code Reviewer** | Bugs, antipatterns, security issues |
| **Gap Analyst** | Acceptance criteria verification |
| **Tech Debt Auditor** | Duplication, extraction opportunities |
| **Security Scanner** | Vulnerability scan |
| **Test Hardener** | Coverage gaps, edge cases |
| **QA Smoke Tester** | End-to-end sanity checks |

Findings are collected and passed to a **Refactoring Agent** that applies fixes. Critical/high findings block sign-off.

### Sign-Off and Retrospective

After the final epic, a retrospective analyzes the full build history:

- Stories that needed multiple iterations (and why)
- Most common review findings
- Prompt quality assessment
- Concrete pipeline improvement suggestions

Learnings are saved to `~/.boop/memory/` as structured YAML, so the next project Boop builds benefits from what this one taught it.

## Project Structure

```
~/.boop/                        # Global (one per machine)
├── profile.yaml                # Developer profile
├── credentials/                # API keys (mode 0600)
├── memory/                     # Cross-project learnings
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

## Development

```bash
pnpm install                    # Install dependencies
pnpm run dev                    # Run in development mode
pnpm run check                  # Format + typecheck + lint
pnpm run test                   # Run tests (1,055 tests)
pnpm run build                  # Build with tsdown
```

## Configuration

| Environment Variable | Description | Required |
|---------------------|-------------|----------|
| `ANTHROPIC_API_KEY` | Claude API key | Yes |
| `BOOP_HOME` | Override `~/.boop/` directory | No |
| `BOOP_STATE_DIR` | Override project state directory | No |

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
