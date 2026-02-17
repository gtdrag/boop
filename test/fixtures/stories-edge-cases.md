# Epic & Story Breakdown

## Epic 1: Foundation

**Goal:** Core setup
**Scope:** Everything

### Story 1.1: Minimal story

**As a** dev, **I want** setup, **so that** things work.

**Acceptance Criteria:**

- Typecheck passes
- All tests pass

**Prerequisites:** None

---

### Story 1.2: Bold acceptance criteria

**As a** developer, **I want** error handling, **so that** the app is robust.

**Acceptance Criteria:**

- **Given** a malformed request, **when** the server receives it, **then** a 400 error is returned
- **Given** the database is unreachable, **when** a query is attempted, **then** a retry is performed
- Typecheck passes
- All tests pass

**Prerequisites:** 1.1
**Technical Notes:**

- Use exponential backoff

---

### Story 1.3: No technical notes

**As a** user, **I want** a landing page, **so that** I can learn about the product.

**Acceptance Criteria:**

- Given I visit /, when the page loads, then I see the homepage
- Typecheck passes
- All tests pass

**Prerequisites:** 1.1

---

### Story 1.4: Multi-line user story

**As a** developer,
**I want** structured logging and retry utilities available across all modules,
**so that** error handling and observability are consistent from day one.

**Acceptance Criteria:**

- Given any module imports the logger, when it logs a message, then JSON is written to ~/.boop/logs/
- Given a transient error occurs, when retry is invoked, then it retries with backoff
- Typecheck passes
- All tests pass

**Prerequisites:** 1.1, 1.2, 1.3

**Technical Notes:**

- Create src/shared/logger.ts
- Create src/shared/retry.ts
- Use pino for JSON logging
