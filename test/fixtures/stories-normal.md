# Epic & Story Breakdown

## Epic 1: Project Setup & Foundation
**Goal:** Set up the project structure, tooling, and base configuration.
**Scope:** Scaffolding, database, CI/CD

### Story 1.1: Project scaffolding
**As a** developer, **I want** a working project skeleton, **so that** I can start building features.

**Acceptance Criteria:**
- Given a fresh checkout, when I run pnpm install && pnpm build, then it succeeds
- Given the project, when I run pnpm test, then tests pass
- Typecheck passes
- All tests pass

**Prerequisites:** None

**Technical Notes:**
- Initialize Next.js with TypeScript
- Set up Express backend
- Configure Tailwind CSS

---

### Story 1.2: Database setup
**As a** developer, **I want** a PostgreSQL database configured with Prisma ORM, **so that** I can persist data.

**Acceptance Criteria:**
- Given the project, when I run prisma migrate, then the database schema is applied
- Given valid connection config, when the app starts, then it connects to PostgreSQL
- Typecheck passes
- All tests pass

**Prerequisites:** 1.1

**Technical Notes:**
- Create src/db/schema.prisma
- Add Prisma client setup
- Configure connection pooling

---

## Epic 2: Authentication
**Goal:** Implement user authentication with JWT.
**Scope:** Registration, login, token management

### Story 2.1: User registration
**As a** user, **I want** to register an account, **so that** I can access the system.

**Acceptance Criteria:**
- Given valid credentials, when I POST /auth/register, then a user is created
- Given duplicate email, when I POST /auth/register, then I get a 409 error
- Typecheck passes
- All tests pass

**Prerequisites:** 1.1, 1.2

**Technical Notes:**
- Create src/auth/register.ts
- Add Prisma User model
- Hash passwords with bcrypt
