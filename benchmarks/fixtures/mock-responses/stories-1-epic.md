# Epics & Stories

## Epic 1: Core Task API

### Story 1.1: Project Setup & Database Schema

**Description:** Set up the project structure, install dependencies, configure TypeScript, and create the database schema with migrations.

**Acceptance Criteria:**
- Project initialised with Express + TypeScript
- PostgreSQL connection configured
- Database migrations for users and tasks tables
- Health check endpoint at GET /health
- Vitest configured with test database

**Priority:** 1
**Estimate:** Small

---

### Story 1.2: Authentication

**Description:** Implement JWT-based authentication with login and registration endpoints.

**Acceptance Criteria:**
- POST /auth/register creates a new user
- POST /auth/login returns a JWT token
- Auth middleware validates JWT on protected routes
- Passwords hashed with bcrypt
- Invalid credentials return 401

**Priority:** 2
**Estimate:** Small

---

### Story 1.3: Task CRUD Operations

**Description:** Implement full CRUD operations for tasks with validation and auth.

**Acceptance Criteria:**
- POST /tasks creates a task (authenticated)
- GET /tasks lists user's tasks with pagination
- GET /tasks/:id returns a single task
- PATCH /tasks/:id updates a task
- DELETE /tasks/:id soft-deletes a task
- All inputs validated with Zod schemas
- Tests cover happy path and error cases

**Priority:** 3
**Estimate:** Medium

---

### Story 1.4: Filtering & Search

**Description:** Add query parameter filtering to the task list endpoint.

**Acceptance Criteria:**
- GET /tasks?status=todo filters by status
- GET /tasks?search=keyword searches title and description
- GET /tasks?sort=created_at&order=desc supports sorting
- Pagination via ?page=1&limit=20

**Priority:** 4
**Estimate:** Small
