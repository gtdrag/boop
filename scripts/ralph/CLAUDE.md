# Ralph Agent Instructions

You are an autonomous coding agent working on Boop — a CLI tool that automates development workflows. Boop is built as a fork of OpenClaw (an open-source AI gateway).

## Your Task

1. Read the PRD at `scripts/ralph/prd.json`
2. Read the progress log at `scripts/ralph/progress.txt` (check Codebase Patterns section first)
3. Read `CLAUDE.md` at the project root for full project context (OpenClaw details, what to keep/strip, target structure)
4. Check you're on the correct branch from PRD `branchName`. If not, check it out or create from main.
5. Pick the **highest priority** user story where `passes: false`
6. Implement that single user story
7. Run quality checks (typecheck, lint, test — use whatever is configured)
8. Update CLAUDE.md files if you discover reusable patterns (see below)
9. If checks pass, commit ALL changes with message: `feat: [Story ID] - [Story Title]`
10. Update the PRD at `scripts/ralph/prd.json` to set `passes: true` for the completed story
11. Append your progress to `scripts/ralph/progress.txt`

## Story 1.1 Special Instructions

Story 1.1 (Fork and strip OpenClaw) is the bootstrap story. If the project doesn't have OpenClaw code yet:

1. Clone OpenClaw from `https://github.com/openclaw/openclaw.git` into a temp directory
2. Copy the source files into this project (NOT the .git directory — we keep our own git history)
3. Strip everything listed under "What to Strip" in the root CLAUDE.md
4. Update imports, remove dead references, clean up package.json
5. Run `pnpm install` and `pnpm typecheck` (or equivalent)
6. The goal is a clean, building project with only the kept modules

Do NOT try to merge git histories. Just copy the source files we need.

## Progress Report Format

APPEND to `scripts/ralph/progress.txt` (never replace, always append):
```
## [Date/Time] - [Story ID]
- What was implemented
- Files changed
- **Learnings for future iterations:**
  - Patterns discovered
  - Gotchas encountered
  - Useful context
---
```

## Consolidate Patterns

If you discover a **reusable pattern**, add it to the `## Codebase Patterns` section at the TOP of `scripts/ralph/progress.txt`.

## Update CLAUDE.md Files

Before committing, check if any edited files have learnings worth preserving in CLAUDE.md files:
- API patterns specific to that module
- Gotchas or non-obvious requirements
- Dependencies between files
- Testing approaches
- Configuration requirements

## Quality Requirements

- ALL commits must pass quality checks (typecheck, lint, test)
- Do NOT commit broken code
- Keep changes focused and minimal
- Follow existing code patterns and conventions from CLAUDE.md

## Stop Condition

After completing a user story, check if ALL stories have `passes: true` in `scripts/ralph/prd.json`.

If ALL stories are complete and passing, reply with:
<promise>COMPLETE</promise>

If there are still stories with `passes: false`, end your response normally (another iteration will pick up the next story).

## Important

- Work on ONE story per iteration
- Commit frequently
- Keep CI green
- Read the Codebase Patterns section in progress.txt before starting
- The root CLAUDE.md has all the context about OpenClaw, what to keep, what to strip, and the target project structure
