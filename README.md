# Boop

An opinionated, idea-to-software pipeline. Fork of OpenClaw with BMAD planning knowledge and Ralph's autonomous execution loop baked in.

Give Boop an idea. He plans it, architects it, specs it out, builds it, tests it, and deploys it. You steer the vision; he does the work.

## What Is This

Boop is a personalized development pipeline that turns ideas into deployed software through an automated workflow:

1. **Viability Gate** — Honestly assesses whether the idea is worth building
2. **Planning** — PRD, architecture, epics, and stories generated from tested prompt templates
3. **Building** — Autonomous agent loop implements stories one by one with quality gates
4. **Hardening** — Tech debt cleanup, refactoring, and test coverage hardening after each epic
5. **Deployment** — Ships to production

## Design Philosophy

- **Opinionated** — George's choices. Fixed voice, fixed personality, fixed workflow. Take it or fork it.
- **Developer Profile** — First-run onboarding interview generates a config encoding your tech stack, patterns, cloud preferences, and design sensibilities. Boop builds software _your way_.
- **Keep the brains, ditch the ceremony** — Planning knowledge from BMAD (instruction files, templates, personas) without the workflow engine overhead.
- **Nested loops** — Story loop (fast, silent), epic loop (notifies, includes code review + hardening), project loop (major gates, sign-off).
- **Security-first** — Closed system. No external plugins, no marketplace, no auto-downloading from public repos. Every agent sandboxed at the runtime level.
- **Best practices are defaults** — SEO, analytics, accessibility, security headers, error tracking. Every project ships with these automatically. The developer profile defines _which_ providers, but the fact that they exist is non-negotiable.
- **Communicative, not needy** — Status updates at the right level. Knows when to ask and when to just handle it.

## Architecture

```
┌─ PROJECT LOOP ──────────────────────────────────────────────┐
│  idea → viability → plan → build → deploy → retro           │
│                                                              │
│  ┌─ EPIC LOOP ───────────────────────────────────────────┐  │
│  │  stories complete →                                    │  │
│  │  code review →                                         │  │
│  │  tech debt + refactoring →                             │  │
│  │  test hardening →                                      │  │
│  │  full test suite →                                     │  │
│  │  status update → sign-off → next epic                  │  │
│  │                                                        │  │
│  │  ┌─ STORY LOOP ────────────────────────────────────┐  │  │
│  │  │  pick story → code → typecheck → test →          │  │  │
│  │  │  commit → next story                             │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

## Installation

```bash
npx boop
```

First run, Boop detects no developer profile and runs the onboarding interview:

```
Hey, I'm Boop. Let's get to know each other.

Frontend framework?     > React Native / Next.js / Vue / ...
Backend framework?      > FastAPI / Express / Django / ...
Database?               > PostgreSQL / Supabase / MongoDB / ...
Deployment?             > Railway / Vercel / AWS / ...
Styling?                > Tailwind / NativeWind / StyleSheet / ...
State management?       > Zustand / Redux / Context / ...
Analytics provider?     > Plausible / PostHog / Google Analytics / ...
CI/CD?                  > GitHub Actions / CircleCI / ...
```

Generates `~/.boop/profile.yaml` — your developer profile. Done once, used forever, editable anytime.

## Usage

Give Boop an idea:

```bash
npx boop "I want an app that tracks vinyl records"
```

Boop takes it from there — viability check, PRD, architecture, stories, build, test, deploy. You get status updates and sign-off requests at epic boundaries.

Or run interactively for more control:

```bash
npx boop
```

### Commands

```bash
npx boop "your idea"        # Full pipeline from idea to deployed software
npx boop --profile          # Edit your developer profile
npx boop --status           # Check progress on the current project
npx boop --review           # Review and sign off on the latest epic
```

### Development

```bash
git clone https://github.com/gtdrag/boop.git
cd boop
npm install
npm start
```

## Status

Early ideation. See [docs/brainstorming-session-2026-02-15.md](docs/brainstorming-session-2026-02-15.md) for the full brainstorming session.

## Built On

- [OpenClaw](https://github.com/openclaw/openclaw) — Agent runtime and orchestration (forked)
- [BMAD](https://github.com/bmadcode/BMAD-METHOD) — Planning knowledge (instruction files, templates, personas)
- [Ralph](https://github.com/snarktank/ralph) — Autonomous execution loop pattern
