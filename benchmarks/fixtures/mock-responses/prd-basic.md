# Product Requirements Document

## Project: Task Management API

### Overview

A RESTful API for managing tasks with full CRUD operations, authentication, and filtering.

### User Stories

1. As a developer, I want to create tasks via POST /tasks so that I can track work items.
2. As a developer, I want to list tasks via GET /tasks so that I can see all work items.
3. As a developer, I want to update tasks via PATCH /tasks/:id so that I can modify work items.
4. As a developer, I want to delete tasks via DELETE /tasks/:id so that I can remove work items.
5. As a developer, I want to filter tasks by status so that I can focus on relevant items.

### Technical Requirements

- **Runtime:** Node.js 22+
- **Framework:** Express
- **Database:** PostgreSQL with connection pooling
- **Auth:** JWT-based authentication
- **Validation:** Zod schema validation on all inputs
- **Testing:** Vitest with >80% coverage

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /tasks | Create a task |
| GET | /tasks | List tasks (with filters) |
| GET | /tasks/:id | Get a single task |
| PATCH | /tasks/:id | Update a task |
| DELETE | /tasks/:id | Delete a task |
| POST | /auth/login | Authenticate |

### Non-Functional Requirements

- Response time < 200ms for all CRUD operations
- Rate limiting: 100 requests/minute per user
- Input sanitization for all user-provided strings
