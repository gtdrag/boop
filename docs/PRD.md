# Boop - Product Requirements Document

**Author:** George
**Date:** 2026-02-15
**Version:** 1.0

---

## Executive Summary

Boop automates the development workflow I already use. It chains together BMAD (planning), Ralph (building), and Claude Code agent teams (review and hardening) so I don't have to manually orchestrate between them. One command, give it an idea, it runs the process.

Built as a fork of OpenClaw. Personalized through a developer profile that knows my tech stack and preferences. Open source if anyone else wants it.

### What Makes This Special

Nothing revolutionary — it just removes the friction of manually running each phase, converting formats between tools, and coordinating agent teams. The workflow already works. Boop just automates it.

---

## Project Classification

**Technical Type:** Developer Tool / CLI
**Domain:** General (software development automation)
**Complexity:** Medium

Boop is a Node.js CLI tool distributed via npm (`npx boop`). It's a fork of OpenClaw — an existing agent runtime built on Node.js that bridges AI models with system tools. Boop strips OpenClaw to its core runtime, removes the external plugin/marketplace system, and bakes in the planning-to-execution pipeline.

Not a web app. Not a mobile app. Not a SaaS. It's a local tool that runs on your machine, talks to Claude, and manages your project files.

---

## Success Criteria

- I can go from idea to a running, tested, reviewed codebase without manually invoking each tool or converting formats between them
- The developer profile means I never re-explain my tech stack, cloud preferences, or patterns to the system
- Each epic goes through the full review cycle (code review, tech debt audit, refactoring, bug fixes) before the next epic starts — automatically
- The system knows when to ask me and when to just handle it. I'm not babysitting, but I'm not out of the loop either
- Quality defaults (SEO, analytics, accessibility, security headers) are present in every project without me thinking about them
- It works on my machine, with my setup, reliably. No flaky external dependencies, no marketplace plugins, no supply chain risk
- Permission/approval gates are configurable — start with sign-offs at epic boundaries, with the option to remove them entirely once I trust the system and let it run fully autonomous

---

## Product Scope

### MVP - Minimum Viable Product

The minimum for Boop to be useful — replacing the manual orchestration I do today:

1. **Developer profile onboarding** — First-run interview that generates `~/.boop/profile.yaml` with tech stack, cloud, styling, and pattern preferences
2. **Planning phase** — Takes an idea (text input), runs it through stripped-down BMAD prompt chain: viability assessment → PRD → architecture → epics → stories. No workflow engine — just a sequence of prompts feeding into each other
3. **Bridge** — Converts BMAD story markdown files to Ralph's `prd.json` format automatically
4. **Build phase** — Ralph's execution loop: pick story → implement → typecheck → test → commit → next story
5. **Review phase** — After each epic: code review, tech debt audit, refactoring pass, bug/gap identification, then fix everything before advancing
6. **Epic sign-off gate** — Notification + pause for approval (configurable, can be disabled)

### Growth Features (Post-MVP)

- State-of-the-art voice integration (Boop's fixed voice for status updates and conversational interaction)
- Phone notifications via OpenClaw messaging (WhatsApp/Telegram)
- Test hardening agent (fills coverage gaps, adds integration tests after each epic)
- Deployment automation (Railway, Vercel, Supabase — based on developer profile)
- Cross-project memory (wisdom that persists and improves across builds)
- Course correction (absorb requirement changes mid-flight without restarting)

### Vision (Future)

- Fully autonomous mode — remove all permission gates, Boop runs unsupervised from idea to deployed app
- Voice-first interaction — dictate ideas from your phone, Boop handles the rest
- Reverse engineering — point at an existing app or screenshot, Boop generates a build plan
- Self-improving prompts — the planning prompt library gets better based on outcomes across projects

---

## CLI Specific Requirements

**Installation:**
- `npx boop` — single command, no global install required
- Node.js runtime (inherited from OpenClaw)
- First run triggers developer profile onboarding

**Command Structure:**
```
npx boop "your idea"        # Full pipeline from idea
npx boop --profile          # Edit developer profile
npx boop --status           # Check current project progress
npx boop --review           # Review and sign off on latest epic
npx boop --resume           # Resume a paused project
npx boop --autonomous       # Run without sign-off gates
```

**Configuration:**
- `~/.boop/profile.yaml` — Developer profile (tech stack, cloud, patterns, quality defaults)
- `~/.boop/prompts/` — Planning prompt library (BMAD-extracted instruction files, templates, personas)
- `.boop/` in project root — Project-specific state (progress, current phase, story status)

**Dependencies:**
- OpenClaw core runtime (forked, stripped)
- Claude API access (via OpenClaw's model integration)
- Git (for Ralph's commit loop)
- Node.js package manager

**Output:**
- A git repository with implemented code, passing tests, reviewed and refactored
- Commit history organized by story (one commit per story, cleanup commits after review phase)
- Project scaffolded according to developer profile (framework, structure, styling, defaults)

---

## User Experience Principles

- **Quiet by default** — Boop doesn't narrate everything it's doing. It works silently and surfaces information when it matters.
- **Don't ask what you already know** — The developer profile exists so Boop never asks about tech stack, framework choice, or patterns. Only ask when the situation genuinely requires input.
- **Status, not noise** — Progress updates are concise: "Story 3/7 done. Epic 1 review starting." Not paragraphs of explanation.
- **Respect the interrupt** — When Boop needs sign-off, it pauses cleanly and waits. No timeout, no nagging.
- **Errors are actionable** — If something fails, say what failed and what to do about it. No stack traces unless asked.

### Key Interactions

1. **First run (onboarding):** Conversational interview — plain questions, sensible defaults, done in a few minutes. Generates profile.
2. **Starting a project:** `npx boop "idea"` → Boop confirms what it understood, asks clarifying questions if needed, then runs.
3. **During a build:** Mostly silent. Story-level work happens without notification. Epic boundaries trigger a status update.
4. **Epic sign-off:** Boop presents a summary of what was built, reviewed, and fixed. User approves or flags issues.
5. **Checking in:** `npx boop --status` gives a one-screen summary of where things stand.

---

## Functional Requirements

### FR-1: Developer Profile System

- FR-1.1: First-run onboarding interview covering: frontend framework, backend framework, database, cloud/deployment, styling, state management, analytics provider, CI/CD, language preferences
- FR-1.2: Generates `~/.boop/profile.yaml` from interview responses
- FR-1.3: Profile is editable via `npx boop --profile` or direct file editing
- FR-1.4: Profile informs all downstream decisions — architecture, scaffolding, quality defaults
- FR-1.5: Sensible defaults for any unanswered questions (don't force answers for everything)

### FR-2: Planning Phase (BMAD-derived)

- FR-2.1: Accept idea as text input (CLI argument or interactive prompt)
- FR-2.2: Viability assessment — honest evaluation of the idea, push back if warranted, suggest pivots if applicable
- FR-2.3: PRD generation — requirements document produced from idea + developer profile context
- FR-2.4: Architecture generation — tech decisions made automatically from developer profile, only escalate genuinely novel choices
- FR-2.5: Epic and story breakdown — decompose PRD into implementable stories with acceptance criteria
- FR-2.6: Each phase feeds its output directly to the next — no manual file passing or format conversion
- FR-2.7: Planning prompts sourced from extracted BMAD instruction files, templates, and personas (no workflow engine)

### FR-3: Bridge (Format Conversion)

- FR-3.1: Parse BMAD story markdown files and extract: story ID, title, description, acceptance criteria, tasks, dev notes
- FR-3.2: Generate Ralph-compatible `prd.json` with: id, title, description, acceptanceCriteria[], priority, passes, notes
- FR-3.3: Map story priority from epic ordering (epic 1 stories = priority 1, etc.)
- FR-3.4: Include "Typecheck passes" and "All tests pass" in every story's acceptanceCriteria
- FR-3.5: Populate notes field with task summary and relevant dev notes for agent context

### FR-4: Build Phase (Ralph-derived)

- FR-4.1: Story loop — pick highest-priority incomplete story, implement, typecheck, test, commit, mark done, next
- FR-4.2: One story per agent context window — fresh context each iteration
- FR-4.3: Git branch management — create/checkout branch per project from prd.json branchName
- FR-4.4: Progress tracking via `progress.txt` (append-only learnings between iterations)
- FR-4.5: Pattern documentation via `CLAUDE.md` / `AGENTS.md` (discovered codebase conventions)
- FR-4.6: Quality gates — never commit failing code. Typecheck and tests must pass before commit.
- FR-4.7: Reality check before commit — scan for mock/placeholder data, hardcoded values that should come from APIs/DB, stub implementations (`return []`, fake responses), and `TODO`/`FIXME`/`HACK` markers. If found in production code paths and not explicitly scoped to the story, block the commit and fix before proceeding. Mock data in production code is treated as a failing test — not a warning.

### FR-5: Review Phase (Claude Code Team)

- FR-5.1: Triggered automatically when all stories in an epic are complete
- FR-5.2: Full code review — identify issues, antipatterns, inconsistencies across the epic's stories
- FR-5.3: Tech debt audit — spot duplication, naming inconsistencies, opportunities to extract shared utilities
- FR-5.4: Refactoring pass — actively fix what the audit finds (not just report it)
- FR-5.5: Bug and gap identification — find edge cases, missing error handling, incomplete implementations
- FR-5.6: Gap analysis — for every acceptance criterion in every story in this epic, verify it's actually working with real data. Cross-reference PRD/stories vs what's actually wired up. Flag any mock data, seed data, placeholder values, or stub implementations still present in production code paths. This is a blocking check — epic cannot advance until all gaps are resolved or explicitly deferred with documented justification.
- FR-5.7: Fix all identified issues before advancing
- FR-5.8: Run full test suite after all fixes — everything must be green
- FR-5.9: Automated security scan — run SAST tools (Semgrep or equivalent) and dependency audit (npm audit) against the generated project code. Flag vulnerabilities by severity. Critical and high vulnerabilities are blocking — epic cannot advance until resolved. Medium/low are included in the epic summary for awareness.
- FR-5.10: Generate epic summary: what was built, what was reviewed, what was fixed, gap analysis results, security scan results, test status

### FR-6: Epic Sign-off Gate

- FR-6.1: After review phase completes, pause and present epic summary to user
- FR-6.2: Wait for user approval before advancing to next epic
- FR-6.3: Configurable — can be disabled via `--autonomous` flag or profile setting
- FR-6.4: If issues flagged by user, route back to review phase for additional fixes

### FR-7: Project Scaffolding

- FR-7.1: Generate project structure based on developer profile (monorepo vs single app, framework boilerplate, etc.)
- FR-7.2: Include SEO defaults: meta tags, Open Graph, structured data, sitemap, robots.txt, semantic HTML
- FR-7.3: Include analytics wiring based on profile preference
- FR-7.4: Include accessibility defaults
- FR-7.5: Include security headers
- FR-7.6: Include error tracking setup
- FR-7.7: Initialize git repo, CI/CD config stubs, linting/formatting config from profile

### FR-8: Security and Sandboxing

- FR-8.1: No external plugin/skill loading — closed system
- FR-8.2: No downloads from public registries other than explicit npm dependencies
- FR-8.3: Agent sandboxing — agents cannot access files outside the project directory
- FR-8.4: No network calls except to Claude API and explicitly allowed services
- FR-8.5: No irreversible destructive actions without confirmation (even in autonomous mode: no dropping databases, no force-pushing to main)

---

## Non-Functional Requirements

### Security

- All agent execution sandboxed — file access restricted to project directory and `~/.boop/`
- No external code execution from untrusted sources
- API keys stored securely (system keychain or encrypted config, never plaintext in project files)
- Agent outputs validated before committing — no injection of malicious code patterns
- Security audit as a dedicated milestone before any public release

### Performance

- Planning phase (idea → stories) should complete within a single session — minutes, not hours
- Story loop iteration should be bounded by Claude's context window, not by Boop's overhead
- Boop adds minimal overhead on top of the underlying tools — it's orchestration, not computation
- Resume cleanly after interruption (machine sleep, network drop, process kill)

### Integration

- Claude API via OpenClaw's model integration layer
- Git for all version control operations (Ralph's commit pattern)
- npm for distribution (`npx boop`)
- Developer's existing toolchain: whatever linter, formatter, test runner, and CI their profile specifies
- No hard dependencies on specific cloud providers — those come from the developer profile

---

## Implementation Planning

### Epic Breakdown Required

Requirements must be decomposed into epics and bite-sized stories (200k context limit).

**Next Step:** Run `workflow epics-stories` to create the implementation breakdown.

---

## References

- Brainstorming Session: docs/brainstorming-session-2026-02-15.md

---

## Next Steps

1. **Epic & Story Breakdown** - Run: `workflow epics-stories`
2. **Architecture** - Run: `workflow create-architecture`

---

_This PRD captures Boop — automating a workflow that already works, so I don't have to._

_Created through collaborative discovery between George and AI facilitator._
