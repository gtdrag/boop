# Architecture Document

## Project: Task Management API

### System Architecture

```
Client → Express Router → Controllers → Services → PostgreSQL
                ↓
          Middleware (Auth, Validation, Rate Limit)
```

### Directory Structure

```
src/
├── routes/
│   ├── tasks.ts
│   └── auth.ts
├── controllers/
│   ├── tasks.ts
│   └── auth.ts
├── services/
│   ├── tasks.ts
│   └── auth.ts
├── middleware/
│   ├── auth.ts
│   ├── validate.ts
│   └── rate-limit.ts
├── db/
│   ├── client.ts
│   ├── migrations/
│   └── schema.ts
├── types/
│   └── index.ts
└── index.ts
```

### Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Framework | Express | Developer preference, mature ecosystem |
| Database | PostgreSQL | ACID compliance, JSON support |
| ORM | Raw SQL with postgres.js | Lightweight, type-safe |
| Auth | JWT | Stateless, standard |
| Validation | Zod | Type inference, composable |

### Database Schema

```sql
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(20) DEFAULT 'todo',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  user_id UUID REFERENCES users(id)
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Security Considerations

- Passwords hashed with bcrypt (cost factor 12)
- JWT tokens expire after 1 hour
- SQL injection prevented via parameterized queries
- Input validation on all endpoints via Zod
