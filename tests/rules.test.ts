import { describe, expect, it } from 'vitest';
import { overlaps, validateInterval } from '../src/rules.js';

const date = (value: string) => new Date(value);

describe('interval overlap', () => {
  it('allows adjacent intervals', () => {
    expect(overlaps(date('2027-01-01T10:00Z'), date('2027-01-01T11:00Z'), date('2027-01-01T11:00Z'), date('2027-01-01T12:00Z'))).toBe(false);
  });

  it('detects partial overlap', () => {
    expect(overlaps(date('2027-01-01T10:00Z'), date('2027-01-01T11:00Z'), date('2027-01-01T10:30Z'), date('2027-01-01T11:30Z'))).toBe(true);
  });

  it('detects an exact match', () => {
    expect(overlaps(date('2027-01-01T10:00Z'), date('2027-01-01T11:00Z'), date('2027-01-01T10:00Z'), date('2027-01-01T11:00Z'))).toBe(true);
  });

  it('does not overlap neighbouring days', () => {
    expect(overlaps(date('2027-01-01T10:00Z'), date('2027-01-01T11:00Z'), date('2027-01-02T10:00Z'), date('2027-01-02T11:00Z'))).toBe(false);
  });
});

describe('booking interval validation', () => {
  it('rejects seconds even when duration is thirty minutes', () => {
    const start = new Date();
    start.setUTCDate(start.getUTCDate() + 3);
    start.setUTCHours(10, 0, 15, 0);
    expect(validateInterval(start, new Date(+start + 30 * 60_000))).toBe('Час має бути кратний 30 хвилинам');
  });
});
