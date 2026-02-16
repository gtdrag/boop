# PRD Validation Checklist

Use this checklist to validate that a PRD is complete, specific, and actionable enough for architecture decisions and story breakdown.

## Executive Summary

- [ ] Product purpose is clear in 2-3 paragraphs
- [ ] Target audience is identified
- [ ] Value proposition is stated (why this matters)

## Problem Statement

- [ ] Problem is described from the user's perspective
- [ ] Problem is distinct from the solution
- [ ] Target audience is specific (not "everyone")

## Functional Requirements

- [ ] Core MVP features are listed with sub-requirements
- [ ] Each requirement is specific enough to implement (not "user management")
- [ ] Future features are separated from MVP scope
- [ ] No requirement contradicts another
- [ ] All features from the original idea are covered or explicitly deferred

## Non-Functional Requirements

- [ ] Performance targets are concrete numbers, not "should be fast"
- [ ] Security requirements match the project's risk level
- [ ] Scalability expectations are stated (expected load)
- [ ] Reliability targets are defined (uptime, error handling)
- [ ] Accessibility requirements stated if applicable

## MVP Scope

- [ ] In-scope items are specific deliverables
- [ ] Out-of-scope items are explicitly listed (prevents scope creep)
- [ ] Scope is achievable — not an entire platform as "MVP"
- [ ] Viability assessment risks are addressed in scope decisions

## User Flows

- [ ] Primary user flow covers the main use case end-to-end
- [ ] Steps are concrete actions (not "user interacts with the system")
- [ ] Edge cases are noted where relevant
- [ ] Flows reference specific features from the requirements

## Success Criteria

- [ ] Each criterion is measurable (can write a test or metric for it)
- [ ] Criteria cover the most important features
- [ ] At least 3 concrete success criteria defined
- [ ] Criteria are achievable for an MVP

## Technical Constraints

- [ ] Derived from developer profile (not invented)
- [ ] Infrastructure constraints noted
- [ ] Third-party dependency constraints listed
- [ ] No conflicting constraints

## Risks and Mitigations

- [ ] Carries forward risks from viability assessment
- [ ] Each risk has impact and likelihood ratings
- [ ] Each risk has a concrete mitigation strategy
- [ ] New risks from PRD scope are identified

## Overall Quality

- [ ] Specific enough for an architect to make technology decisions
- [ ] Specific enough for a developer to break into stories
- [ ] Builds on viability assessment (doesn't ignore it)
- [ ] Developer profile informs technical constraints
