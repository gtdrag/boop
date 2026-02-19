# Product Ideas (Brainstorm — No Decisions Made)

Captured 2026-02-19. All of this is speculative until we validate that the pipeline actually works.

## Core Thesis

Boop is the product, not the apps it builds. Sell the machine, not the output.

## Target User

Junior developer or technical team lead. Someone who knows what Next.js and PostgreSQL are, can read code, can steer decisions at approval gates — but spends most of their time on boilerplate implementation.

Positioning: "The tool that makes your junior dev a 10x contributor."

## Competitive Landscape

- **Base44** — Hosted "vibe coding" platform. $0-50/mo. Generates toy apps locked into their infrastructure. Struggles with complex business logic. No code ownership, no review, no learning.
- **Boop's differentiator** — Real codebase you own, full git history, adversarial review loop, production-quality output, learns from every project.

## Distribution Models

### BYOK (Bring Your Own Keys) — Lightest Touch
- Customer installs Boop, plugs in their own Anthropic API key
- Everything runs on their machine
- License key unlocks evolved prompts/heuristics synced from us
- Distribution: `npx boop --activate <license>`
- We maintain nothing. Fastest path to revenue.

### BYOI (Bring Your Own Infrastructure) — Enterprise
- Same as BYOK but for teams
- Docker image or Helm chart, runs in their VPC
- Code never leaves their network (air-gapped story)
- Multi-seat licensing, shared heuristic pool per org

### Managed (Premium) — Full Service
- Hosted pipeline, GitHub integration, dashboard
- Customer provides: just their idea
- We run dedicated container per customer (Railway/Fly)
- Highest price, highest margin, most infrastructure burden

## Pricing Sketch (Very Rough)

| Tier | What they get | They provide | Range |
|------|--------------|-------------|-------|
| Solo | License, prompt sync, CLI updates | Machine, API key | $30-50/mo |
| Team | Multi-seat, shared heuristics, Docker image | Infrastructure, API keys | $200-500/mo |
| Managed | Hosted pipeline, dashboard, zero setup | Just their idea | $500-1000/mo |

## The Moat

Evolved prompt library and heuristic store. A fresh Boop install is decent. An instance running for 6 months with curated heuristics is significantly better. The license syncs this down.

The gauntlet validates each heuristic release before shipping to customers: "Every prompt update passes a 6-tier gauntlet before it ships."

## What Needs to Happen First

**Validate that Boop can actually build something.** None of this matters until the pipeline produces real, working software end-to-end. Run the gauntlet. See the output. Then decide.

## Open Questions

- Open source or closed?
- Pool learnings across customers or keep isolated per org?
- Web dashboard as primary UI vs CLI-first?
- How to handle API cost pass-through vs bundling?
- Should customers be able to bring their own prompts/heuristics?
