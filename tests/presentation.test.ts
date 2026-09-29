import { afterEach, describe, expect, it, vi } from 'vitest';
import { plusDays } from '../src/calendar.js';
import { translate, translateMessage, translateFeedback } from '../src/translations.js';

afterEach(() => vi.unstubAllEnvs());

describe('calendar navigation across Kyiv daylight saving changes', () => {
  it('keeps Monday at midnight when moving into winter time', () => {
    vi.stubEnv('TZ', 'Europe/Kyiv');
    const start = new Date(2026, 9, 19);
    const next = plusDays(start, 7);
    expect(next.getDate()).toBe(26);
    expect(next.getDay()).toBe(1);
    expect(next.getHours()).toBe(0);
    expect(next.getTimezoneOffset()).not.toBe(start.getTimezoneOffset());
    expect(plusDays(next, -7).getTime()).toBe(start.getTime());
  });
  it('keeps Monday at midnight when moving into summer time', () => {
    vi.stubEnv('TZ', 'Europe/Kyiv');
    const next = plusDays(new Date(2026, 2, 23), 7);
    expect(next.getDate()).toBe(30);
    expect(next.getDay()).toBe(1);
    expect(next.getHours()).toBe(0);
  });
});

describe('English and Ukrainian presentation', () => {
  it('re-localizes displayed errors, notices and interpolated feedback', () => {
    expect(translateFeedback('Невірний email або пароль', 'en')).toBe('Incorrect email or password');
    expect(translateFeedback('Incorrect email or password', 'uk')).toBe('Невірний email або пароль');
    expect(translateFeedback('Створено серію з 3 бронювань.', 'en')).toBe('Created a series of 3 bookings.');
    expect(translateFeedback('Created a series of 3 bookings.', 'uk')).toBe('Створено серію з 3 бронювань.');
    expect(translateFeedback('Підтвердіть email, щоб активувати бронювання.', 'en')).toBe('Verify your email to start booking.');
  });
  it('translates interface strings and preserves Ukrainian', () => {
    expect(translate('Мої бронювання', 'en')).toBe('My bookings');
    expect(translate('Мої бронювання', 'uk')).toBe('Мої бронювання');
    expect(translate('Щотижня · {0} разів', 'en', 3)).toBe('Weekly · 3 meetings');
  });
  it('localizes persisted reminders and sample content', () => {
    expect(translateMessage('Зустріч «Демо · Стратегія» у кімнаті Орбіта почнеться менш ніж за 10 хв.', 'en'))
      .toBe('“Demo · Strategy” in Orbit starts in less than 10 min.');
  });
  it('preserves custom meeting titles', () => {
    expect(translate('Наша зустріч про майбутнє', 'en')).toBe('Наша зустріч про майбутнє');
  });
});
