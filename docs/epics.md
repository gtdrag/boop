# Boop - Epic Breakdown

**Author:** George
**Date:** 2026-02-15
**Source:** [PRD](./PRD.md) | [Architecture](./architecture.md)

---

## Overview

6 epics, 31 stories. Covers all PRD functional requirements (FR-1 through FR-8). Stories sequenced for incremental value with no forward dependencies. Each story sized for a single dev agent session (~200k context).

| Epic | Stories | FR Coverage |
|------|---------|-------------|
| 1: Foundation & OpenClaw Fork | 5 | FR-8 (partial), infrastructure |
| 2: Developer Profile | 4 | FR-1 |
| 3: Planning Pipeline | 6 | FR-2 |
| 4: Bridge & Build | 5 | FR-3, FR-4 |
| 5: Review & Epic Loop | 6 | FR-5, FR-6 |
| 6: Scaffolding, Defaults & Security | 5 | FR-7, FR-8 |
| **Total** | **31** | **All FRs covered** |

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
- **And** states follow the sequence: IDLE → PLANNING → BRIDGING → BUILDING → REVIEWING → SIGN_OFF → COMPLETE
- **And** `npx boop --status` reads and displays the current state

**Prerequisites:** 1.2, 1.3
**Technical Notes:** `src/pipeline/orchestrator.ts`, `src/pipeline/state.ts`

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
- **And** on pass: commits, marks story done in prd.json, appends to progress.txt
- **And** on fail: retries once, then pauses and reports

**Prerequisites:** 4.2, 1.4
**Technical Notes:** `src/build/ralph-loop.ts`, `src/build/story-runner.ts`. Adapts ralph.sh logic to TypeScript.

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
- **And** code reviewer and tech debt auditor run in parallel
- **And** refactoring agent runs after both complete
- **And** test hardener runs after refactoring
- **And** full test suite runs after all fixes

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

### Story 5.3: Tech debt auditor and refactoring agent

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

**Prerequisites:** 5.2
**Technical Notes:** `src/review/tech-debt-auditor.ts`, `src/review/refactoring-agent.ts`. Run sequentially: audit then fix.

---

### Story 5.4: Test hardening agent

As a developer,
I want test coverage gaps filled and integration tests added after each epic,
So that the test suite is comprehensive before moving on.

**Acceptance Criteria:**
- **Given** refactoring is complete
- **When** the test hardener runs
- **Then** it identifies coverage gaps and missing edge case tests
- **And** writes new unit tests and integration tests spanning the epic's stories
- **And** full test suite passes after new tests are added

**Prerequisites:** 5.3
**Technical Notes:** `src/review/test-hardener.ts`. Analyzes coverage, writes tests, validates.

---

### Story 5.5: Epic summary and sign-off gate

As a user,
I want a summary of what was built, reviewed, and fixed after each epic,
So that I can sign off before the next epic starts.

**Acceptance Criteria:**
- **Given** review phase is complete
- **When** the sign-off gate triggers
- **Then** an epic summary is generated: stories built, review findings, fixes applied, test status
- **And** the summary is saved to `.boop/reviews/epic-N/summary.md`
- **And** Boop pauses and waits for user approval via `npx boop --review`
- **And** if `--autonomous` is active, sign-off is skipped and next epic starts

**Prerequisites:** 5.4
**Technical Notes:** `src/pipeline/epic-loop.ts`. Summary generation + pause logic.

---

### Story 5.6: Notification integration

As a user,
I want to receive phone notifications when an epic is ready for sign-off,
So that I don't have to keep checking the terminal.

**Acceptance Criteria:**
- **Given** WhatsApp or Telegram is configured in Boop
- **When** an epic sign-off is ready
- **Then** a notification is sent via the configured channel with the epic summary
- **And** status updates are also sent for: planning complete, build started, build complete, review complete

**Prerequisites:** 5.5, 1.1 (channel adapters kept from OpenClaw)
**Technical Notes:** Use OpenClaw's existing WhatsApp/Telegram adapter code. Configure in `~/.boop/profile.yaml`.

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

_Generated by BMAD Epic & Story Workflow v1.0_
_Date: 2026-02-15_
_For: George_
