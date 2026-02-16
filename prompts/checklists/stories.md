# Story Breakdown Validation Checklist

Use this checklist to validate that an epic/story breakdown is complete, properly ordered, and implementable.

## Epic Structure

- [ ] Epic 1 is project setup and foundation
- [ ] Last epic is integration testing and polish
- [ ] Each epic delivers a coherent, testable slice of functionality
- [ ] 3-7 epics total (appropriate for project size)
- [ ] 3-6 stories per epic
- [ ] Each epic has a clear goal and scope statement

## Story Format

- [ ] Each story has a user story: "As a [role], I want [capability], so that [benefit]"
- [ ] Each story has BDD acceptance criteria in Given/When/Then format
- [ ] Each story has 3-7 acceptance criteria
- [ ] Every story includes "Typecheck passes" and "All tests pass" criteria
- [ ] Each story has prerequisites listed (or "None")
- [ ] Each story has technical notes with implementation hints

## Story Sizing

- [ ] Each story is completable in a single dev agent session
- [ ] Each story touches at most 5-8 files
- [ ] Large features are split across multiple stories
- [ ] Database schema, API, and UI are in separate stories
- [ ] Infrastructure setup is its own story

## Ordering and Dependencies

- [ ] Stories within an epic are numbered sequentially (1.1, 1.2, ...)
- [ ] Cross-epic numbering is consistent (1.x, 2.x, 3.x, ...)
- [ ] No forward dependencies — story N never depends on story N+1 or later
- [ ] Prerequisites reference only lower-numbered stories
- [ ] First story in each epic is foundation/setup
- [ ] Last story in an epic can be integration/wiring

## PRD Coverage

- [ ] Every functional requirement from the PRD maps to at least one story
- [ ] MVP scope items are all covered
- [ ] Out-of-scope items are NOT included as stories
- [ ] Non-functional requirements are addressed (performance, security stories if needed)

## Technical Notes Quality

- [ ] Reference specific files from the architecture (e.g., "Create src/auth/login.ts")
- [ ] Mention relevant packages from the architecture
- [ ] Data model changes are noted where needed
- [ ] Testing approach is suggested (unit, integration, mock strategies)
- [ ] Developer's preferred tools are referenced

## Acceptance Criteria Quality

- [ ] Given/When/Then format is consistent
- [ ] Criteria are specific (not "it should work correctly")
- [ ] Negative cases included where relevant (error handling, validation)
- [ ] Criteria are testable — a developer can write a test for each one
- [ ] No duplicate criteria across stories

## Overall Quality

- [ ] A developer agent can pick up any story and implement it without guessing
- [ ] Stories build on each other logically
- [ ] No gaps — the full product can be built by completing all stories in order
- [ ] Architecture document is referenced in technical notes
