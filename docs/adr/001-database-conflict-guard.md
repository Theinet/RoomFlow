# ADR-001: Database-level booking conflict protection

**English** · [Українська](001-database-conflict-guard.uk.md)

**Status:** accepted

## Context

Checking availability only in React or Express is insufficient: concurrent requests can both observe the same free slot.

## Decision

SQLite triggers on INSERT and UPDATE enforce the final invariant. An overlap exists when:

```text
new.start < existing.end AND new.end > existing.start
```

Adjacent intervals are allowed. A trigger aborts a conflicting write with booking_conflict; the API returns HTTP 409.

## Consequences

- Clients cannot create overlapping bookings by bypassing the UI.
- An integration test verifies two concurrent requests produce 201 + 409 and one stored booking.
- Migrating away from SQLite requires an equivalent transactional constraint or trigger.
