# Boop Roadmap

## Completed (v0.1)

### Core Pipeline
- Planning chain: viability → PRD → architecture → stories
- Bridge: BMAD markdown → Ralph-format prd.json
- Scaffolding: project structure + config defaults (SEO, analytics, a11y, security headers, deployment)
- Build loop: autonomous story-by-story implementation via Claude CLI
- Adversarial review: 3 parallel agents → verifier → fixer → convergence loop (3 iterations)
- Epic sign-off: auto-approve (autonomous) or interactive prompt
- Deployment: Vercel/Railway/Fly CLI, Docker build, Claude agent fallback for AWS/GCP/Azure
- Retrospective: project analysis, report generation, memory persistence
- State machine: IDLE → PLANNING → BRIDGING → SCAFFOLDING → BUILDING → REVIEWING → SIGN_OFF → DEPLOYING → RETROSPECTIVE → COMPLETE

### Infrastructure
- Developer profile onboarding with opinionated defaults
- Credential store (API key in `~/.boop/credentials/` with 0600 permissions)
- WhatsApp (Baileys) and Telegram (grammy) notification adapters
- Docker sandbox for isolated build agents
- Context rotation with structured handoffs between iterations
- Structural invariant tests (architecture rules, naming, test co-location, state machine)
- Integration test suite (full pipeline flow with mocked externals)

---

## Planned Features

### Feature: Improve Mode (`boop --improve`)

**What:** Point boop at an existing codebase and iteratively improve it — brownfield instead of greenfield.

**Why:** The adversarial review loop already works on any codebase. The missing piece is an analysis-first planning phase that generates improvement stories from existing code rather than building from an idea.

**How it works:**

```
boop --improve /path/to/existing-project
```

1. **ANALYZE** (new phase, replaces PLANNING for improve mode)
   - Scan the codebase: file tree, language breakdown, dependency graph, test coverage
   - Run the adversarial review agents to produce an initial findings report
   - Use Claude to categorize findings into themes: security, testing, performance, architecture, code quality
   - Generate an improvement PRD with prioritized stories (highest-impact first)

2. **BRIDGING** — same as greenfield, converts improvement stories to prd.json

3. **SCAFFOLDING** — skipped (project already exists)

4. **BUILDING** — same loop, but stories are improvements rather than new features:
   - "Add error handling to all API endpoints"
   - "Increase test coverage for auth module from 40% to 80%"
   - "Replace raw SQL queries with parameterized statements"
   - "Extract duplicated validation logic into shared utilities"

5. **REVIEWING** — adversarial loop runs as normal, may find new issues introduced by the fixes

6. **SIGN_OFF** → **RETROSPECTIVE** — same as greenfield

**Convergence control:**
- Track a "findings memory" — issues that were reviewed and intentionally kept as-is don't get re-raised
- Set a max improvement depth (e.g., `--depth 3` for 3 full cycles)
- Each cycle should produce fewer findings than the last; stop when delta < threshold
- Report a quality score trend: "Cycle 1: 47 issues → Cycle 2: 12 issues → Cycle 3: 3 issues"

**CLI interface:**
```bash
boop --improve                    # improve current directory
boop --improve /path/to/project   # improve specific project
boop --improve --depth 5          # run up to 5 improvement cycles
boop --improve --focus security   # only improve security-related issues
boop --improve --focus tests      # only improve test coverage
boop --improve --autonomous       # no prompts, full auto
```

**New files needed:**
- `src/improve/analyzer.ts` — codebase scanner (file tree, deps, coverage)
- `src/improve/planner.ts` — generates improvement stories from analysis + review findings
- `src/improve/convergence.ts` — tracks findings memory, calculates quality score, decides when to stop
- `src/cli/improve.ts` — CLI handler for `--improve` flag
- Prompts: `prompts/improve/system.md`, `prompts/improve/analysis.md`

---

### Feature: Status Dashboard (`boop --dashboard`)

**What:** A simple local web page that shows real-time pipeline status. Opens in the browser, auto-updates via WebSocket/SSE.

**Why:** When boop runs autonomously for 30+ minutes across multiple epics, you want to glance at a browser tab to see where it is — not scroll through terminal output. Especially useful when running in the background or on a remote machine.

**How it works:**

```
boop "my idea" --autonomous --dashboard
# or attach to a running pipeline:
boop --dashboard
```

1. **Server** — lightweight Express/Hono server on `localhost:3141` (or next available port)
2. **SSE stream** — the `onProgress` callback pushes events to connected browsers
3. **Single HTML page** — no React, no build step. One self-contained HTML file with inline CSS/JS served from the dist bundle.

**Dashboard shows:**
- **Pipeline phase** — big status indicator (PLANNING, BUILDING, REVIEWING, etc.) with color coding
- **Epic progress** — "Epic 2 of 4" with a progress bar
- **Story progress** — current story being built, stories completed vs total
- **Review status** — adversarial iteration count, findings found/fixed/remaining
- **Timeline** — vertical list of completed phases with timestamps and durations
- **Live log** — scrolling tail of the last ~50 log lines
- **Token usage** — running total of API tokens consumed (input + output)
- **Cost estimate** — approximate $ spent based on token counts and model pricing

**Architecture:**
```
src/dashboard/
  server.ts      — Express/Hono server, SSE endpoint, static file serving
  events.ts      — Event emitter bridge between pipeline onProgress and SSE
  page.html      — Self-contained dashboard page (inline CSS + vanilla JS)
```

**Key decisions:**
- **No framework** — single HTML file with vanilla JS. Zero build complexity. The entire page is a string literal in the bundle.
- **SSE over WebSocket** — simpler, one-directional (server → browser), no ws dependency needed
- **Auto-open** — `--dashboard` flag opens the browser automatically via `open` (macOS) / `xdg-open` (Linux)
- **Attach mode** — `boop --dashboard` (no idea) reads `.boop/state.yaml` and tails the log file, so you can open the dashboard after the pipeline is already running

**Stretch goals:**
- Dark mode toggle
- Sound notification when pipeline completes or errors
- Mobile-responsive (check status from phone)
- Shareable URL via ngrok/cloudflare tunnel for remote monitoring
