# Boop - Epic Breakdown

**Author:** George
**Date:** 2026-02-15
**Source:** [PRD](./PRD.md) | [Architecture](./architecture.md)

---

## Overview

8 epics, 46 stories. Covers all PRD functional requirements (FR-1 through FR-9). Stories sequenced for incremental value with no forward dependencies. Each story sized for a single dev agent session (~200k context).

| Epic                                      | Stories | FR Coverage                    |
| ----------------------------------------- | ------- | ------------------------------ |
| 1: Foundation & OpenClaw Fork             | 6       | FR-8 (partial), infrastructure |
| 2: Developer Profile                      | 4       | FR-1                           |
| 3: Planning Pipeline                      | 6       | FR-2                           |
| 4: Bridge & Build                         | 5       | FR-3, FR-4                     |
| 5: Review & Epic Loop                     | 9       | FR-5, FR-6                     |
| 6: Scaffolding, Defaults & Security       | 6       | FR-7, FR-8, FR-9               |
| 7: Adversarial Review Loop                | 6       | FR-5 (hardening)               |
| 8: Context Rotation & Structured Handoffs | 4       | FR-4 (hardening), reliability  |
| **Total**                                 | **46**  | **All FRs covered**            |

---

## Epic 1: Foundation & OpenClaw Fork

Establish the stripped-down runtime. Boop exists, runs, and has the basic skeleton for everything else.

### Story 1.1: Fork and strip OpenClaw

As a developer,
I want a clean fork of OpenClaw with marketplace/plugin/extension code removed,
So that Boop has a secure, minimal runtime foundation.

**Acceptance Criteria:**

- **Given** the OpenClaw repo is forked to gtdrag/boop
- **When** the stripping is complete
- **Then** ClawHub, plugin loader, extension directory, Canvas/A2UI, and all channel adapters except WhatsApp + Telegram are removed
- **And** the project builds and runs cleanly with `pnpm dev`
- **And** no references to removed modules remain in the codebase

**Prerequisites:** None
**Technical Notes:** Start from latest OpenClaw main. Remove `src/plugins/`, Canvas system, unused channel adapters. Update imports and configs.

---

### Story 1.2: CLI entry point and command structure

As a user,
I want to run `npx boop` with subcommands,
So that I have a clean interface to interact with Boop.

**Acceptance Criteria:**

- **Given** Boop is installed or run via npx
- **When** I run `npx boop --help`
- **Then** I see available commands: default (idea input), `--profile`, `--status`, `--review`, `--resume`, `--autonomous`
- **And** running `npx boop` with no args enters interactive mode
- **And** running `npx boop "an idea"` passes the idea string to the pipeline

**Prerequisites:** 1.1
**Technical Notes:** Modify `src/cli/program.ts`. Use OpenClaw's existing CLI framework.

---

### Story 1.3: Shared utilities — logger, retry, types

As a developer,
I want structured logging and retry utilities available across all modules,
So that error handling and observability are consistent from day one.

**Acceptance Criteria:**

- **Given** any module imports the logger
- **When** it logs a message
- **Then** JSON is written to `~/.boop/logs/` and human-readable output goes to console
- **And** retry utility supports configurable max retries with backoff
- **And** shared TypeScript types for pipeline state, developer profile, and story format are defined

**Prerequisites:** 1.1
**Technical Notes:** `src/shared/logger.ts`, `src/shared/retry.ts`, `src/shared/types.ts`

---

### Story 1.4: Pipeline state machine skeleton

As a developer,
I want the pipeline state machine defined and persisting to `.boop/state.yaml`,
So that Boop can track progress and resume after interruption.

**Acceptance Criteria:**

- **Given** a project directory with `.boop/`
- **When** the pipeline transitions between states
- **Then** state is written atomically to `.boop/state.yaml` before and after each transition
- **And** states follow the sequence: IDLE → PLANNING → BRIDGING → SCAFFOLDING → BUILDING → REVIEWING → SIGN_OFF → COMPLETE
- **And** SCAFFOLDING runs once per project (first epic only) — subsequent epics skip to BUILDING
- **And** `npx boop --status` reads and displays the current state
- **And** `npx boop --resume` displays: current phase, epic number, story in progress, last completed step, and asks the user to confirm before continuing

**Prerequisites:** 1.2, 1.3
**Technical Notes:** `src/pipeline/orchestrator.ts`, `src/pipeline/state.ts`. Resume reads last committed state from `.boop/state.yaml` and presents context before continuing.

---

### Story 1.5: Configuration system (`~/.boop/`)

As a user,
I want Boop's global config directory created on first run,
So that profile, logs, and credentials have a home.

**Acceptance Criteria:**

- **Given** `~/.boop/` doesn't exist
- **When** Boop runs for the first time
- **Then** `~/.boop/` is created with subdirectories: `logs/`, `credentials/`
- **And** credentials directory has 0600 permissions
- **And** if `~/.boop/profile.yaml` doesn't exist, the onboarding flow is triggered

**Prerequisites:** 1.2
**Technical Notes:** Check for existing config on startup. Create directory structure. Trigger onboarding if no profile.

---

### Story 1.6: Test infrastructure setup

As a developer,
I want the test framework, runner config, and fixture directory established,
So that quality gates can run tests from the very first story that needs them.

**Acceptance Criteria:**

- **Given** the stripped OpenClaw fork is set up
- **When** the test infrastructure is configured
- **Then** a test runner (vitest or jest) is installed and configured in `package.json`
- **And** `test/unit/`, `test/integration/`, and `test/fixtures/` directories exist
- **And** a smoke test exists that imports from `src/` and passes
- **And** `pnpm test` runs the test suite and reports results
- **And** TypeScript path aliases work in test files

**Prerequisites:** 1.1
**Technical Notes:** Choose vitest (faster, native ESM/TS support) or jest (OpenClaw may already use it). Configure in `vitest.config.ts` or `jest.config.ts`. Smoke test proves the pipeline works before real tests are written.

---

## Epic 2: Developer Profile

First-run onboarding with opinionated recommendations produces a profile that informs all downstream decisions.

### Story 2.1: Profile schema and defaults

As a developer,
I want the developer profile schema defined with sensible, opinionated defaults for every category,
So that the onboarding can lead with recommendations.

**Acceptance Criteria:**

- **Given** the profile schema is defined
- **When** no overrides are provided
- **Then** every field has a recommended default (e.g., PostgreSQL for database, Tailwind for styling, Zustand for state)
- **And** the schema covers: frontend framework, backend framework, database, cloud/deployment, styling, state management, analytics, CI/CD, language preferences, project structure preference (monorepo vs single)
- **And** schema is validated with TypeScript types

**Prerequisites:** 1.3
**Technical Notes:** `src/profile/schema.ts`, `src/profile/defaults.ts`. Defaults should reflect George's actual stack.

---

### Story 2.2: Onboarding interview with opinionated suggestions

As a new user,
I want Boop to walk me through a setup interview where it recommends a tech choice for each category and I can accept or override,
So that my profile is generated quickly with good defaults.

**Acceptance Criteria:**

- **Given** no `~/.boop/profile.yaml` exists
- **When** Boop runs for the first time
- **Then** it presents each category with a recommended choice (e.g., "Database? PostgreSQL (recommended) — or type your preference:")
- **And** pressing enter accepts the recommendation
- **And** typing a different answer overrides it
- **And** the interview completes in under 3 minutes for users accepting all defaults
- **And** `~/.boop/profile.yaml` is generated and saved

**Prerequisites:** 2.1, 1.5
**Technical Notes:** `src/profile/onboarding.ts`. Interactive CLI prompts. Lead with opinion, allow override.

---

### Story 2.3: Profile editing

As a user,
I want to edit my developer profile after initial setup,
So that I can update preferences as my stack evolves.

**Acceptance Criteria:**

- **Given** `~/.boop/profile.yaml` exists
- **When** I run `npx boop --profile`
- **Then** the onboarding interview re-runs with current values shown as defaults
- **And** I can accept current values or change them
- **And** the updated profile is saved

**Prerequisites:** 2.2
**Technical Notes:** Re-use onboarding flow, pre-populate with current profile values.

---

### Story 2.4: Profile integration with pipeline

As a developer,
I want the pipeline to load and use the developer profile when making decisions,
So that planning and scaffolding reflect my preferences automatically.

**Acceptance Criteria:**

- **Given** a profile exists at `~/.boop/profile.yaml`
- **When** the pipeline starts
- **Then** the profile is loaded and available to all pipeline phases
- **And** planning prompts receive profile context (tech stack, patterns, preferences)
- **And** if no profile exists, Boop refuses to start and triggers onboarding

**Prerequisites:** 2.2, 1.4
**Technical Notes:** Profile loaded in `src/pipeline/orchestrator.ts` and passed to all phase functions.

---

## Epic 3: Planning Pipeline

Idea goes in, stories come out. Viability → PRD → Architecture → Stories, all chained automatically.

### Story 3.1: Viability assessment

As a user,
I want Boop to honestly evaluate my idea before investing effort,
So that I get honest feedback and can pivot early if needed.

**Acceptance Criteria:**

- **Given** I provide an idea via `npx boop "my idea"`
- **When** the viability phase runs
- **Then** Claude assesses the idea for feasibility, market fit, and technical complexity
- **And** the assessment is presented to me with a recommendation (proceed / concerns / reconsider)
- **And** I can confirm to proceed or provide a revised idea
- **And** the viability summary is saved to `.boop/planning/viability.md`

**Prerequisites:** 2.4
**Technical Notes:** `src/planning/viability.ts`. Load prompt from `prompts/viability/`. Include developer profile context.

---

### Story 3.2: PRD generation

As a user,
I want Boop to generate a PRD from my idea and viability assessment,
So that requirements are documented before architecture and stories.

**Acceptance Criteria:**

- **Given** the viability phase passed
- **When** the PRD phase runs
- **Then** Claude generates a PRD using the extracted BMAD PRD prompt template
- **And** the PRD includes: executive summary, functional requirements, NFRs, MVP scope, success criteria
- **And** developer profile informs tech-specific requirements
- **And** the PRD is saved to `.boop/planning/prd.md`

**Prerequisites:** 3.1
**Technical Notes:** `src/planning/prd.ts`. Prompt from `prompts/prd/`. Chain viability output as input context.

---

### Story 3.3: Architecture generation

As a user,
I want Boop to generate architecture decisions automatically from my profile and PRD,
So that tech stack choices are made without me having to specify them again.

**Acceptance Criteria:**

- **Given** a PRD exists
- **When** the architecture phase runs
- **Then** Claude generates architecture decisions using the developer profile as primary input
- **And** most decisions are made automatically (database, framework, styling, etc. from profile)
- **And** only genuinely novel choices are escalated to the user
- **And** architecture is saved to `.boop/planning/architecture.md`

**Prerequisites:** 3.2
**Technical Notes:** `src/planning/architecture.ts`. Prompt from `prompts/architecture/`. Profile replaces most interactive decisions.

---

### Story 3.4: Epic and story breakdown

As a user,
I want Boop to decompose the PRD into epics and stories with acceptance criteria,
So that the build phase has clear, implementable units of work.

**Acceptance Criteria:**

- **Given** PRD and architecture exist
- **When** the story breakdown phase runs
- **Then** Claude generates epics with stories, each containing: user story, BDD acceptance criteria, prerequisites, technical notes
- **And** stories are sized for single dev agent sessions
- **And** stories are sequentially ordered with no forward dependencies
- **And** output is saved to `.boop/planning/epics.md`

**Prerequisites:** 3.3
**Technical Notes:** `src/planning/stories.ts`. Prompt from `prompts/stories/`.

---

### Story 3.5: Planning prompt chain orchestration

As a developer,
I want the planning phases to chain automatically with each feeding into the next,
So that the pipeline runs without manual intervention between phases.

**Acceptance Criteria:**

- **Given** a user provides an idea
- **When** the planning phase runs
- **Then** viability → PRD → architecture → stories execute in sequence
- **And** each phase receives the output of the previous phase as context
- **And** pipeline state updates after each phase completes
- **And** if any phase fails, Boop retries once then pauses and reports

**Prerequisites:** 3.1–3.4
**Technical Notes:** `src/planning/` orchestration in `src/pipeline/orchestrator.ts`. Each phase is a function, chained.

---

### Story 3.6: BMAD prompt library extraction

As a developer,
I want the tested BMAD instruction files, templates, and personas extracted and organized in the prompts directory,
So that planning phases use proven, refined prompts.

**Acceptance Criteria:**

- **Given** the BMAD installation at `.bmad/`
- **When** prompts are extracted
- **Then** `prompts/viability/`, `prompts/prd/`, `prompts/architecture/`, `prompts/stories/` each contain the relevant instruction files and templates
- **And** persona definitions (PM, architect, dev) are in `prompts/personas/`
- **And** validation checklists are in `prompts/checklists/`
- **And** no workflow engine code is included — only the knowledge files

**Prerequisites:** 1.1
**Technical Notes:** Manual extraction from BMAD. Strip workflow.xml references. Keep instruction content intact.

---

## Epic 4: Bridge & Build

Stories convert to Ralph format. Ralph's loop builds them autonomously.

### Story 4.1: BMAD story markdown parser

As a developer,
I want a parser that reads BMAD story markdown files and extracts structured data,
So that stories can be converted to Ralph's format.

**Acceptance Criteria:**

- **Given** a BMAD story markdown file
- **When** the parser runs
- **Then** it extracts: story ID, title, user story text, acceptance criteria (as array), tasks/subtasks, dev notes
- **And** handles variations in markdown formatting
- **And** returns a typed TypeScript object

**Prerequisites:** 1.3
**Technical Notes:** `src/bridge/parser.ts`. Parse the story markdown format documented in brainstorming session.

---

### Story 4.2: Ralph prd.json converter

As a developer,
I want the parsed stories converted to Ralph's prd.json format,
So that the build loop can consume them.

**Acceptance Criteria:**

- **Given** parsed story data from the BMAD parser
- **When** the converter runs
- **Then** it generates a valid prd.json with: project, branchName, description, userStories[]
- **And** each story has: id, title, description, acceptanceCriteria[] (including "Typecheck passes" and "All tests pass"), priority (from epic ordering), passes (false), notes
- **And** the prd.json is saved to `.boop/prd.json`

**Prerequisites:** 4.1
**Technical Notes:** `src/bridge/converter.ts`. Follow mapping from brainstorming doc.

---

### Story 4.3: Ralph story execution loop

As a developer,
I want Ralph's story loop integrated into Boop,
So that stories are built autonomously one at a time.

**Acceptance Criteria:**

- **Given** a valid `.boop/prd.json` exists
- **When** the build phase runs
- **Then** the loop picks the highest-priority incomplete story
- **And** spawns a fresh Claude context with: story details + progress.txt + CLAUDE.md
- **And** the agent implements the story, runs typecheck and tests
- **And** reality check scans for mock/placeholder data, stub implementations, and TODO/FIXME markers in production code paths
- **And** on all pass: commits, marks story done in prd.json, appends to progress.txt
- **And** on fail (including reality check failures): retries once, then pauses and reports
- **And** mock data in production code is treated as a failing test — not a warning

**Prerequisites:** 4.2, 1.4
**Technical Notes:** `src/build/ralph-loop.ts`, `src/build/story-runner.ts`, `src/build/reality-check.ts`. Adapts ralph.sh logic to TypeScript. Reality check runs after typecheck + tests pass but before commit.

---

### Story 4.4: Progress and pattern tracking

As a developer,
I want progress.txt and CLAUDE.md maintained across story iterations,
So that knowledge compounds between stories.

**Acceptance Criteria:**

- **Given** a story completes
- **When** progress is recorded
- **Then** `progress.txt` is appended with: iteration number, story ID, files changed, learnings
- **And** `CLAUDE.md` is updated with discovered codebase patterns
- **And** both files are injected into the next story's context

**Prerequisites:** 4.3
**Technical Notes:** `src/build/progress.ts`. Follow Ralph's existing format.

---

### Story 4.5: Git branch management

As a developer,
I want Boop to manage git branches for each project,
So that work is isolated and organized.

**Acceptance Criteria:**

- **Given** prd.json has a branchName
- **When** the build phase starts
- **Then** the branch is created or checked out
- **And** each story commit uses format: `feat: [Story ID] - [Story Title]`
- **And** review phase commits use format: `refactor: Epic N review - [description]`

**Prerequisites:** 4.3
**Technical Notes:** Git operations in build loop. Follow Ralph's branch management pattern.

---

## Epic 5: Review & Epic Loop

Claude Code team reviews each epic. Fix everything before moving on.

### Story 5.1: Review team orchestrator

As a developer,
I want the review phase to coordinate multiple specialized agents,
So that code review, tech debt, refactoring, and test hardening happen systematically.

**Acceptance Criteria:**

- **Given** all stories in an epic are complete
- **When** the review phase triggers
- **Then** the orchestrator launches review agents in the defined sequence
- **And** code reviewer, tech debt auditor, and gap analyst run in parallel
- **And** refactoring agent runs after all three complete
- **And** test hardener runs after refactoring
- **And** full test suite runs after all fixes
- **And** security scanner (SAST + dependency audit) runs after tests are green
- **And** browser QA smoke test runs after security scan (starts dev server, hits routes, captures screenshots)
- **And** unresolved gaps, critical/high vulnerabilities, or QA crashes block epic advancement

**Prerequisites:** 4.3, 1.4
**Technical Notes:** `src/review/team-orchestrator.ts`. Use Claude Code team capabilities.

---

### Story 5.2: Code review agent

As a developer,
I want an automated code review of all new code in the completed epic,
So that issues, antipatterns, and inconsistencies are identified.

**Acceptance Criteria:**

- **Given** an epic's worth of committed code
- **When** the code review agent runs
- **Then** it produces a findings list covering: bugs, antipatterns, inconsistencies, security concerns, missing error handling
- **And** findings are saved to `.boop/reviews/epic-N/code-review.md`

**Prerequisites:** 5.1
**Technical Notes:** `src/review/code-reviewer.ts`. Agent reads all files changed in the epic's commits.

---

### Story 5.3: Gap analysis agent

As a user,
I want every acceptance criterion cross-referenced against the actual implementation after each epic,
So that nothing ships with mock data, stubs, or incomplete wiring pretending to be done.

**Acceptance Criteria:**

- **Given** all stories in an epic are complete
- **When** the gap analyst runs
- **Then** it reads every acceptance criterion from every story in the epic
- **And** verifies each criterion is met with real data, real API calls, real database queries — not mocks or placeholders
- **And** scans all production code paths for: hardcoded mock data, placeholder strings, stub implementations, fake API responses, seed data displayed as real data
- **And** produces a gap report listing: criterion, status (verified / gap found), evidence
- **And** any gap found is a blocking issue — the epic cannot advance until resolved or explicitly deferred with documented justification
- **And** the gap report is saved to `.boop/reviews/epic-N/gap-analysis.md`

**Prerequisites:** 5.1
**Technical Notes:** `src/review/gap-analyst.ts`. Runs in parallel with code reviewer and tech debt auditor. Cross-references story acceptance criteria from `.boop/prd.json` against actual code. Scans for patterns: `mock`, `fake`, `placeholder`, `TODO`, `FIXME`, `HACK`, `dummy`, `sample`, hardcoded arrays/objects that look like seed data.

---

### Story 5.4: Tech debt auditor and refactoring agent

As a developer,
I want tech debt identified and actively fixed after each epic,
So that the codebase stays clean as it grows.

**Acceptance Criteria:**

- **Given** code review findings and the full codebase
- **When** the tech debt auditor runs
- **Then** it identifies: duplication, naming inconsistencies, extraction opportunities, unused code
- **And** the refactoring agent takes combined findings and applies fixes
- **And** all changes pass typecheck and tests after refactoring
- **And** refactoring commits use the review commit format

**Prerequisites:** 5.2, 5.3
**Technical Notes:** `src/review/tech-debt-auditor.ts`, `src/review/refactoring-agent.ts`. Refactoring agent uses combined findings from code reviewer (5.2), gap analyst (5.3), and tech debt auditor. Run sequentially: audit then fix.

---

### Story 5.5: Test hardening agent

As a developer,
I want test coverage gaps filled and integration tests added after each epic,
So that the test suite is comprehensive before moving on.

**Acceptance Criteria:**

- **Given** refactoring is complete
- **When** the test hardener runs
- **Then** it identifies coverage gaps and missing edge case tests
- **And** writes new unit tests and integration tests spanning the epic's stories
- **And** full test suite passes after new tests are added

**Prerequisites:** 5.4
**Technical Notes:** `src/review/test-hardener.ts`. Runs after refactoring is complete. Analyzes coverage, writes tests, validates.

---

### Story 5.6: Automated security scanning

As a developer,
I want SAST and dependency audits run against the generated project code after each epic,
So that security vulnerabilities are caught before sign-off.

**Acceptance Criteria:**

- **Given** all fixes are applied and the test suite is green
- **When** the security scanner runs
- **Then** a SAST tool (Semgrep or equivalent) scans all source code for vulnerability patterns (injection, XSS, insecure crypto, hardcoded secrets, path traversal)
- **And** `npm audit` (or equivalent) checks all dependencies for known vulnerabilities
- **And** results are categorized by severity: critical, high, medium, low
- **And** critical and high vulnerabilities are blocking — the epic cannot advance until they are resolved
- **And** medium and low findings are included in the epic summary for awareness
- **And** the security report is saved to `.boop/reviews/epic-N/security-scan.md`

**Prerequisites:** 5.5
**Technical Notes:** `src/review/security-scanner.ts`. Runs after test hardener confirms tests green. Uses Semgrep (open source, no account needed) for SAST and npm audit for dependencies. If critical/high findings exist, route back to refactoring agent for fixes, then re-scan.

---

### Story 5.7: Browser QA smoke test

As a developer,
I want the generated project verified in a real browser after each epic,
So that the app actually starts, renders, and doesn't crash — not just passes tests.

**Acceptance Criteria:**

- **Given** security scan is complete and tests are green
- **When** the QA smoke test runs
- **Then** the generated project's dev server is started automatically
- **And** a headless Playwright browser visits every route defined in the project (detected from router config or sitemap)
- **And** each route is checked for: HTTP 200 response, no JavaScript console errors, page renders without crash
- **And** a screenshot is captured at each route
- **And** if any route crashes, throws console errors, or returns non-200, it's flagged as a blocking failure
- **And** screenshots and results are saved to `.boop/reviews/epic-N/qa-smoke-test/`

**Prerequisites:** 5.6
**Technical Notes:** `src/review/qa-smoke-test.ts`. Uses Playwright (headless Chromium). Discovers routes from the project's router config (React Router, Next.js pages, Express routes, etc.) or falls back to crawling from `/`. Dev server started via the project's `dev` script. Screenshots provide visual proof for the epic summary. Growth version will add form filling, user flow walking, and end-to-end functional verification.

---

### Story 5.8: Epic summary and sign-off gate

As a user,
I want a summary of what was built, reviewed, and fixed after each epic,
So that I can sign off before the next epic starts.

**Acceptance Criteria:**

- **Given** review phase is complete
- **When** the sign-off gate triggers
- **Then** an epic summary is generated: stories built, review findings, gap analysis results, security scan results, QA smoke test results with screenshots, fixes applied, test status
- **And** the summary is saved to `.boop/reviews/epic-N/summary.md`
- **And** Boop pauses and waits for user approval via `npx boop --review`
- **And** if `--autonomous` is active, sign-off is skipped and next epic starts
- **And** if user flags issues during sign-off, feedback is routed to the refactoring agent → fixes applied → test suite re-run → summary regenerated → user re-prompted for approval
- **And** the rejection/fix cycle repeats until the user approves or explicitly defers issues

**Prerequisites:** 5.7
**Technical Notes:** `src/pipeline/epic-loop.ts`. Summary generation + pause logic. Include gap analysis, security scan, and QA smoke test results (with screenshots) in summary. Rejection flow re-enters the review pipeline at the refactoring step with user feedback as additional context.

---

### Story 5.9: Bidirectional messaging integration

As a user,
I want Boop to notify me via phone AND ask me questions when it needs input,
So that I can steer things from my phone without sitting at a terminal.

**Acceptance Criteria:**

- **Given** WhatsApp or Telegram is configured in Boop
- **When** an epic sign-off is ready
- **Then** a notification is sent via the configured channel with the epic summary
- **And** status updates are also sent for: planning complete, build started, build complete, review complete
- **And** when Boop needs user input during autonomous execution (design decisions, ambiguous requirements, errors it can't resolve), it sends a question via the configured channel and waits for a reply
- **And** the user's reply is parsed and routed back to the pipeline to continue
- **And** credential requests are never sent as plaintext over messaging — Boop instructs the user to provide credentials via a secure local method (e.g., `npx boop --credential <name>` or environment variable)
- **And** if no reply is received within a configurable timeout, Boop pauses and saves state for later resume

**Prerequisites:** 5.8, 1.1 (channel adapters kept from OpenClaw)
**Technical Notes:** Use OpenClaw's existing WhatsApp/Telegram adapter code. Configure in `~/.boop/profile.yaml`. Bidirectional messaging uses OpenClaw's gateway for both inbound and outbound. Credential handling must be secure — never transmit secrets over messaging channels.

---

## Epic 6: Scaffolding, Defaults & Security

Projects ship with quality baked in. Agents are sandboxed. Credentials are secure.

### Story 6.1: Project scaffolding from profile

As a user,
I want Boop to generate a project skeleton based on my developer profile,
So that every project starts with my preferred structure and tooling.

**Acceptance Criteria:**

- **Given** a developer profile exists
- **When** the scaffolding phase runs (after planning, before build)
- **Then** project structure is generated: directories, configs, boilerplate
- **And** framework, linting, formatting, test runner, and CI config match the profile
- **And** git repo is initialized with initial commit

**Prerequisites:** 2.4, 3.5
**Technical Notes:** `src/scaffolding/generator.ts`. Profile-driven template generation.

---

### Story 6.2: SEO and analytics defaults

As a user,
I want every web project to ship with SEO optimization and analytics wiring,
So that I never have to remember to add these manually.

**Acceptance Criteria:**

- **Given** the project is a web or mobile-web project (detected from profile/PRD)
- **When** scaffolding runs
- **Then** SEO defaults are included: meta tags, Open Graph, structured data template, sitemap config, robots.txt, semantic HTML patterns
- **And** analytics is wired to the provider specified in the profile
- **And** Core Web Vitals monitoring is configured

**Prerequisites:** 6.1
**Technical Notes:** `src/scaffolding/defaults/`. Only applies to web-type projects.

---

### Story 6.3: Accessibility and security header defaults

As a user,
I want every project to include accessibility defaults and security headers,
So that these are always present without thinking about them.

**Acceptance Criteria:**

- **Given** scaffolding runs
- **Then** accessibility defaults are included: ARIA landmarks, skip navigation, focus management patterns, semantic HTML
- **And** security headers are configured: CSP, HSTS, X-Frame-Options, X-Content-Type-Options
- **And** error tracking setup is included based on profile preference

**Prerequisites:** 6.1
**Technical Notes:** `src/scaffolding/defaults/`. Applies to all web projects.

---

### Story 6.4: Agent sandboxing enforcement

As a developer,
I want all build and review agents running in Docker sandboxes with restricted access,
So that no agent can affect anything outside the project scope.

**Acceptance Criteria:**

- **Given** a build or review agent is spawned
- **When** it executes
- **Then** it runs in a Docker container with filesystem access limited to the project directory
- **And** network access is limited to Claude API only
- **And** it cannot install packages from untrusted sources
- **And** destructive actions (force push, rm -rf outside project) are blocked at the runtime level

**Prerequisites:** 1.1 (OpenClaw sandbox), 4.3
**Technical Notes:** Configure OpenClaw's Docker sandboxing. Tighten policies for Boop's use case.

---

### Story 6.5: Credential management and security audit

As a developer,
I want API keys stored securely and a security checklist validated before release,
So that Boop is safe to distribute.

**Acceptance Criteria:**

- **Given** Boop requires a Claude API key
- **When** the key is configured
- **Then** it's stored in `~/.boop/credentials/` with 0600 permissions or system keychain
- **And** the key is never written to project files or logs
- **And** a security audit checklist covers: sandbox boundaries, credential handling, destructive action guardrails, network access restrictions

**Prerequisites:** 6.4
**Technical Notes:** Inherit OpenClaw's credential pattern. Security checklist as a pre-release gate.

---

### Story 6.6: Project retrospective and self-improvement analysis

As a user,
I want Boop to analyze the full build history after the final epic and generate improvement suggestions,
So that each project makes Boop smarter for the next one.

**Acceptance Criteria:**

- **Given** the final epic's sign-off is approved
- **When** the retrospective phase runs
- **Then** it walks the full build history: progress.txt, review findings per epic, git log, iteration counts per story, reality check failures, gap analysis results, security scan findings
- **And** identifies patterns: stories that needed multiple iterations (and why), most common review findings, where mock data slipped through, recurring vulnerability patterns
- **And** generates `retrospective.md` with: build statistics, failure pattern analysis, prompt quality assessment, and concrete pipeline improvement suggestions
- **And** saves actionable cross-project learnings to `~/.boop/memory/` (e.g., "stories involving auth consistently need explicit session handling criteria", "React projects need reality checks for hardcoded API URLs")
- **And** presents the retrospective summary to the user as the final project output
- **And** the pipeline transitions to COMPLETE after the retrospective is presented

**Prerequisites:** 6.5, 5.8
**Technical Notes:** `src/retrospective/analyzer.ts`, `src/retrospective/reporter.ts`. Runs once per project after the final epic. Reads `.boop/reviews/` for all epic review data, `scripts/ralph/progress.txt` for build learnings, git log for iteration counts. Memory saved to `~/.boop/memory/` as structured YAML — keyed by pattern type for easy retrieval in future projects.

---

## Epic 7: Adversarial Review Loop

Replace the single-pass review phase with an iterative adversarial review cycle. Multiple specialized agents review in parallel, a verifier confirms findings against real code, an auto-fixer resolves confirmed issues, and the cycle repeats until clean — or until a max iteration cap. Accuracy over speed. The goal is a self-correcting pipeline that catches its own mistakes.

### Story 7.0: Structural invariant tests and agent-legible documentation

As a pipeline,
I want mechanical enforcement of architectural patterns via structural tests, plus agent-oriented codebase documentation,
So that invariants are enforced before review (not just caught after the fact) and every agent session has a machine-readable map of the codebase.

**Acceptance Criteria:**

- **Given** the boop codebase
- **When** `pnpm test` runs
- **Then** structural tests verify architectural invariants:
  - Every file in `src/review/` exports a `create*` factory function
  - All deployment providers are covered in `providers.test.ts`
  - No direct `fs.writeFileSync` calls outside `src/scaffolding/` and `src/pipeline/`
  - All prompt templates in `prompts/` are valid (parseable, no broken references)
  - Every new module has a corresponding test file
- **And** a `CODEBASE_MAP.md` exists at the repo root with: module boundaries, dependency graph (text-based), naming conventions, file location guide, and pattern descriptions
- **And** a `CONVENTIONS.md` exists documenting: review agent factory pattern, `GeneratedFile` return type, scaffolding defaults location, snapshot schema, commit message format
- **And** both docs are structured with headings and bullet points optimized for LLM parsing (not prose paragraphs)
- **And** structural tests are fast (<5 seconds total) since they're just file/AST checks

**Prerequisites:** 1.6 (test infrastructure)
**Technical Notes:** `test/structural/` directory. Structural tests use `fs` + `glob` + simple AST parsing (TypeScript compiler API or regex) to verify patterns. Inspired by OpenAI's "harness engineering" approach: mechanical enforcement catches drift before the adversarial loop even runs. `CODEBASE_MAP.md` and `CONVENTIONS.md` are for agent consumption — written for machines first, humans second.

---

### Story 7.1: Parallel adversarial review agents

As a pipeline,
I want to spawn three specialized review agents in parallel — code quality, test coverage, and security — each with a distinct lens and scoped to the current epic's changed files,
So that the review phase catches a wider range of issues than any single reviewer could.

**Acceptance Criteria:**

- **Given** the REVIEWING phase begins for an epic
- **When** the adversarial review step runs
- **Then** three agents are spawned concurrently:
  - Code quality agent: antipatterns, duplication, naming, error handling, edge cases
  - Test coverage agent: untested paths, missing assertions, boundary conditions, integration gaps
  - Security agent: injection vectors, credential leaks, dependency vulnerabilities, sandbox escapes
- **And** each agent receives only the files changed in the current epic (scoped via git diff against the pre-epic branch point)
- **And** each agent returns structured findings with severity (CRITICAL / HIGH / MEDIUM / LOW), file path, line range, and description
- **And** all three agents complete before proceeding (parallel execution, joined at completion)
- **And** combined wall-clock time for the parallel review is under 5 minutes for a typical epic

**Prerequisites:** 5.1 (review infrastructure exists)
**Technical Notes:** `src/review/adversarial/runner.ts`. Spawn via Claude CLI `--print` with system prompts per agent type (stored in `prompts/review/`). Use the same spawn pattern as `story-runner.ts`. Scope files with `git diff --name-only <base>..HEAD`. Output as JSON for structured parsing.

---

### Story 7.2: Finding verifier agent

As a pipeline,
I want a verification step that confirms every finding from the adversarial agents against the actual codebase before acting on it,
So that hallucinated findings (fabricated file paths, phantom code references) are filtered out and only real issues proceed to auto-fix.

**Acceptance Criteria:**

- **Given** the three adversarial agents return their combined findings
- **When** the verifier step runs
- **Then** for each finding, the verifier checks:
  - The file path exists (Glob)
  - The referenced line range contains code matching the finding's description (Read + pattern match)
  - The severity is plausible given the actual code
- **And** findings that reference non-existent files are discarded with a log entry
- **And** findings where the referenced code doesn't match the description are downgraded to LOW or discarded
- **And** the verifier outputs a `verified-findings.json` with only confirmed issues
- **And** at least 90% of verified findings are real issues (measured by spot-check sampling in tests)
- **And** the verification step itself takes under 60 seconds

**Prerequisites:** 7.1
**Technical Notes:** `src/review/adversarial/verifier.ts`. This is NOT an LLM call — it's deterministic file/code validation. Use Glob to check paths, Read to check line content, regex to match described patterns. The 50% hallucination rate we observed in audit agents makes this step non-negotiable. Log discarded findings to `.boop/reviews/epic-N/discarded-findings.json` for retrospective analysis.

---

### Story 7.3: Auto-fix with regression guard

As a pipeline,
I want confirmed CRITICAL and HIGH findings to be automatically fixed by a dedicated fix agent, with the full test suite run after each fix batch,
So that issues are resolved without human intervention and fixes don't introduce regressions.

**Acceptance Criteria:**

- **Given** the verifier has produced a list of confirmed findings at any severity
- **When** the auto-fix step runs
- **Then** a fix agent receives the verified findings and applies corrections
- **And** after all fixes are applied, the full test suite runs
- **And** if tests pass, the fixes are committed with a structured commit message referencing the finding IDs
- **And** if tests fail, the fix agent receives the test failures and attempts a correction (up to 3 attempts per finding)
- **And** if a fix cannot be applied without breaking tests after 3 attempts, the finding is escalated to the review summary as "unable to auto-fix" with the error context
- **And** all severity levels are auto-fixed — the goal is zero findings
- **And** each fix is a separate commit so individual fixes can be reverted if needed

**Prerequisites:** 7.2
**Technical Notes:** `src/review/adversarial/fixer.ts`. Reuse the existing `fix-runner.ts` pattern. The fix agent gets the verified finding + surrounding code context (50 lines). Run tests via the same test runner used in the build phase. Separate commits per finding enable surgical reverts. The "3 attempts" limit prevents infinite loops on genuinely hard problems.

---

### Story 7.4: Iterative review loop with convergence

As a pipeline,
I want the adversarial review cycle (review → verify → fix → test) to repeat until no CRITICAL or HIGH findings remain, up to a configurable maximum number of iterations,
So that the pipeline self-corrects and each iteration catches issues introduced by the previous round's fixes.

**Acceptance Criteria:**

- **Given** an auto-fix round completes
- **When** the iteration check runs
- **Then** if zero findings at any severity were found in this iteration, the loop exits and proceeds to SIGN_OFF
- **And** if any findings remain and iterations < max (default: 3), the full cycle repeats: adversarial agents → verifier → auto-fix → test
- **And** if max iterations reached with issues remaining, the loop exits with all unresolved findings included in the review summary (clearly marked as "unresolved after N iterations")
- **And** each iteration's findings are saved to `.boop/reviews/epic-N/iteration-{i}.json` for retrospective analysis
- **And** the iteration count and convergence status are reported in the epic summary
- **And** diminishing returns detection: if two consecutive iterations find the same findings, the loop exits early (the fix agent is stuck)
- **And** the max iterations setting is configurable via developer profile (`reviewMaxIterations`, default: 3)

**Prerequisites:** 7.3
**Technical Notes:** `src/review/adversarial/loop.ts`. The outer loop wraps stories 7.1–7.3. Track finding IDs across iterations to detect "stuck" patterns (same finding reappearing = the fixer couldn't resolve it). Save per-iteration artifacts for the retrospective (Story 6.6) to analyze convergence patterns across projects. Default of 3 iterations balances thoroughness with time cost.

---

### Story 7.5: Review summary consolidation and sign-off integration

As a user,
I want the adversarial review results consolidated into a single, clear summary that feeds into the existing sign-off flow,
So that I can see exactly what was found, what was fixed, what remains, and make an informed approve/reject decision.

**Acceptance Criteria:**

- **Given** the adversarial review loop has completed (converged or max iterations reached)
- **When** the review summary is generated
- **Then** the summary includes:
  - Total findings by severity across all iterations
  - Findings auto-fixed (with commit references)
  - Findings unable to auto-fix (with error context and the code in question)
  - Findings discarded by verifier (count only, details in log)
  - Iteration count and convergence status
  - Test suite status (all green / failures remaining)
- **And** the summary is formatted as markdown, suitable for both terminal display and messaging notification
- **And** the summary replaces the existing review summary in the SIGN_OFF phase (not additive — this IS the review)
- **And** if messaging is enabled, the summary is sent via the configured channel with a sign-off prompt
- **And** the summary is saved to `.boop/reviews/epic-N/adversarial-summary.md`

**Prerequisites:** 7.4, 5.8 (sign-off flow)
**Technical Notes:** `src/review/adversarial/summary.ts`. Integrates with the existing `sendSummary()` and `createSignOffPrompt()` in the messaging dispatcher. This story effectively replaces the single-pass review with the adversarial loop — the old review agents (code-reviewer, tech-debt-auditor, etc.) are subsumed by the adversarial agents which cover the same ground with iteration and verification.

---

## Epic 8: Context Rotation & Structured Handoffs

Replace lossy, ad-hoc context management with structured state snapshots that let agent sessions rotate cleanly. Each Claude session starts fresh but has perfect machine-readable memory of everything that came before. No drift, no prose summaries, no lost context.

### Story 8.1: Context snapshot schema and utilities

As a developer,
I want a structured snapshot format that captures all meaningful state from an agent session — files touched, decisions made, test results, blockers resolved — in machine-readable JSON,
So that the next session can reconstruct the full picture without relying on lossy prose summaries.

**Acceptance Criteria:**

- **Given** a session has completed work
- **When** a snapshot is generated
- **Then** the snapshot is a JSON object with: session ID, timestamp, phase (BUILDING/REVIEWING/etc.), epic number, story ID (if applicable), files created/modified (paths only), test results (pass/fail counts + failing test names), decisions made (key-value pairs), blockers hit and resolutions, current code architecture understanding (module map), and a freeform `notes` string for anything that doesn't fit structured fields
- **And** the schema is defined as a TypeScript interface with JSDoc
- **And** read/write utilities handle serialization to `.boop/snapshots/`
- **And** snapshots are append-only — each session writes a new file (`snapshot-{sessionId}.json`), never overwrites previous snapshots
- **And** a `readLatestSnapshot()` utility returns the most recent snapshot for a given phase/epic

**Prerequisites:** 1.3 (shared types)
**Technical Notes:** `src/shared/context-snapshot.ts`. The snapshot replaces `progress.txt` as the primary handoff mechanism. Keep `progress.txt` for backward compatibility with vanilla Ralph, but snapshots are the authoritative source. Schema should be strict enough to parse programmatically but flexible enough to capture unexpected learnings via the `notes` field.

---

### Story 8.2: Build loop context rotation

As a pipeline,
I want each Ralph build iteration to write a structured snapshot on exit and inject the previous snapshot on start,
So that knowledge compounds across story iterations without context window pressure.

**Acceptance Criteria:**

- **Given** a story iteration completes (pass or fail)
- **When** the iteration exits
- **Then** a snapshot is written with: story ID, files changed, test results, decisions made during implementation, any patterns discovered (e.g., "this project uses barrel exports"), and blockers hit
- **And** the next iteration's prompt includes the previous snapshot as structured context (JSON block in the system prompt, not pasted prose)
- **And** `progress.txt` continues to be appended for backward compatibility, but the snapshot is the primary handoff
- **And** if no previous snapshot exists (first iteration), the prompt includes only `prd.json` and `CLAUDE.md` as before
- **And** snapshot injection adds no more than ~2000 tokens to the prompt (snapshots are concise, not verbose)

**Prerequisites:** 8.1, 4.3 (Ralph loop)
**Technical Notes:** Modify `src/build/ralph-loop.ts` and `src/build/story-runner.ts`. The snapshot is injected as a `<context-snapshot>` XML block in the system prompt — structured so the agent can parse it, not just read it. Token budget: the snapshot should be concise. Strip file contents, keep only paths. Strip full test output, keep only counts + failing names.

---

### Story 8.3: Review pipeline context rotation

As a pipeline,
I want the adversarial review loop to write snapshots between fix/review cycles,
So that each review iteration knows exactly what was fixed, what was attempted, and what's still open — without re-reading the entire codebase.

**Acceptance Criteria:**

- **Given** an adversarial review iteration completes (review → verify → fix → test)
- **When** the iteration exits
- **Then** a snapshot is written with: iteration number, findings by severity, findings fixed (with commit SHAs), findings unable to fix (with error context), findings discarded by verifier, test suite status, and files modified during fixes
- **And** the next iteration's review agents receive the previous snapshot, so they know what was already fixed and can focus on new/remaining issues
- **And** the fix agent receives the snapshot so it doesn't re-attempt fixes that already failed
- **And** stuck detection uses snapshot comparison: if two consecutive snapshots have identical unresolved finding IDs, the loop exits early

**Prerequisites:** 8.1, 7.4 (adversarial loop)
**Technical Notes:** Modify `src/review/adversarial/loop.ts`. The snapshot replaces the current ad-hoc tracking of "what was found last iteration." Stuck detection becomes trivial: `JSON.stringify(prev.unresolvedIds) === JSON.stringify(curr.unresolvedIds)`.

---

### Story 8.4: Proactive context budget tracking

As a pipeline,
I want each agent session to estimate its context usage and trigger a snapshot rotation before hitting the limit,
So that sessions never silently degrade from context overflow — they rotate cleanly instead.

**Acceptance Criteria:**

- **Given** an agent session is running (build or review)
- **When** the estimated token count exceeds 70% of the context window
- **Then** a snapshot is written immediately with current progress
- **And** the current session is terminated gracefully
- **And** a new session is spawned with the snapshot injected
- **And** the new session resumes from where the previous one left off (same story, same phase)
- **And** the rotation is logged: "Context rotation triggered at ~{N}k tokens. Resuming in fresh session."
- **And** the rotation is invisible to the pipeline orchestrator — it sees one continuous build/review step, not two sessions
- **And** token estimation uses a simple heuristic: count characters in the prompt + accumulated output, divide by 4 (rough char-to-token ratio). Precision isn't critical — 70% threshold gives plenty of margin.

**Prerequisites:** 8.2, 8.3
**Technical Notes:** `src/shared/context-budget.ts`. The 70% threshold is conservative — Claude's context window is 200k tokens, so rotation triggers around 140k. The heuristic doesn't need to be exact; it just needs to prevent the cliff. The pipeline orchestrator doesn't need to know about rotation — the build/review functions handle it internally. This is the hardest story in the epic because it requires the session to cleanly pause, snapshot, and resume without losing work.

---

_Generated by BMAD Epic & Story Workflow v1.0_
_Date: 2026-02-15_
_Updated: 2026-02-17 — Added Epic 7 (Adversarial Review Loop), Epic 8 (Context Rotation & Structured Handoffs)_
_For: George_
