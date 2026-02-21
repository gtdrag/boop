# Architecture Validation Checklist

Use this checklist to validate that architecture decisions are complete, justified, and aligned with the developer profile and PRD.

## Tech Stack

- [ ] Languages specified and justified for the project
- [ ] Frontend framework matches developer profile
- [ ] Backend framework matches developer profile
- [ ] Database matches developer profile
- [ ] ORM/query builder recommended (not left open)
- [ ] Infrastructure/cloud matches developer profile
- [ ] CI/CD approach specified
- [ ] Every technology choice names a specific package/tool (not categories)

## Architecture Decisions

- [ ] Authentication strategy defined with rationale tied to PRD requirements
- [ ] API design pattern chosen (REST/GraphQL/tRPC) with justification
- [ ] Data model key entities listed with relationships
- [ ] Caching strategy defined if NFRs require it
- [ ] Error handling approach specified
- [ ] Testing strategy covers unit, integration, and E2E (if applicable)

## Profile Alignment

- [ ] All choices that can be derived from profile ARE derived from profile
- [ ] No technologies introduced that the developer hasn't expressed familiarity with (unless required and flagged)
- [ ] Developer's preferred tools are used even if alternatives exist
- [ ] Rationale connects each decision to profile or PRD (not "best practice")

## Escalated Decisions

- [ ] Only genuinely novel conflicts are escalated
- [ ] Auto-resolvable choices are NOT escalated
- [ ] Each escalation explains the conflict clearly
- [ ] Options are presented with trade-offs (not just "pick one")
- [ ] If no escalations, explicitly stated: "No escalated decisions"

## Project Structure

- [ ] Directory structure follows chosen framework conventions
- [ ] Structure accommodates all features from the PRD
- [ ] File naming conventions specified
- [ ] Clear separation of concerns

## Deployment

- [ ] Environment strategy defined (dev/staging/prod)
- [ ] Deployment method matches infrastructure choices
- [ ] Domain/URL strategy noted if applicable

## Security

- [ ] Authentication security measures listed
- [ ] Data protection approach defined
- [ ] Input validation strategy specified
- [ ] Security measures match PRD security requirements

## Logging & Observability

- [ ] Structured logger used (`src/lib/logger.ts` — auto-scaffolded)
- [ ] Log levels defined (debug, info, warn, error)
- [ ] File output for backend projects (`logs/app.jsonl`)
- [ ] Sensitive data excluded from logs

## Overall Quality

- [ ] Pragmatic for MVP (not over-engineered)
- [ ] Every decision traces to profile preference or PRD requirement
- [ ] No orphan decisions (technologies chosen but never used)
- [ ] Coherent stack — tools work well together
