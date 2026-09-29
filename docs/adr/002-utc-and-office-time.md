# ADR-002: UTC storage and Kyiv office time

**English** · [Українська](002-utc-and-office-time.uk.md)

**Status:** accepted

## Context

People can open the calendar in different time zones, while office hours belong to a fixed office location. Storing browser-local time would make interpretation and recurring events ambiguous across DST.

## Decision

- Store starts_at and ends_at as ISO UTC instants.
- Validate office hours and the 30-minute grid in Europe/Kyiv.
- Convert office wall-clock time to UTC, then display it in the browser's time zone.
- Calculate weekly series in Kyiv wall-clock time, not fixed millisecond increments.
- Navigate client weeks using calendar-day arithmetic, preserving local midnight across DST.

## Consequences

Every meeting has one precise stored instant. Office rules remain consistent across summer and winter time. Regression tests cover client week navigation at both DST transitions; server time rules live in src/rules.ts.
