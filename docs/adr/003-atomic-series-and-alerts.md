# ADR-003: Atomic recurring bookings and deduplicated reminders

**English** · [Українська](003-atomic-series-and-alerts.uk.md)

**Status:** accepted

## Context

A partially created recurring series is misleading. Repeated polling should not deliver the same reminder over and over.

## Decision

- Calculate and validate every occurrence before inserting the series in one SQLite transaction.
- Roll back the entire series if any occurrence conflicts; return 409 without new bookings.
- Store reminders with UNIQUE(booking_id, kind).
- Use separate start and handoff kinds so both can exist for one meeting.
- Remove obsolete handoff reminders in the same transaction as a move or cancellation.

## Consequences

A series is either fully created or absent. Start and handoff reminders are independently deduplicated. Marking reminders read during polling is best-effort delivery: a lost response can lose a reminder. Reliable delivery would require client acknowledgement. Tests cover series creation/cancellation and the two reminder kinds; broader failure and rollback coverage remains useful.
