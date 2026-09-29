import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { db } from '../src/db.js';
import { app } from '../src/server.js';

let olena = '';
let ivan = '';
const patchTestTitles = ['PATCH move own', 'PATCH move blocker'];

function futureStart(days: number, hour: number) {
  const result = new Date();
  result.setUTCDate(result.getUTCDate() + days);
  result.setUTCHours(hour, 0, 0, 0);
  return result;
}

beforeAll(async () => {
  db.prepare("DELETE FROM bookings WHERE title IN ('API smoke test', 'API recurring test', 'Alert current', 'Alert next', 'Alert starts soon', 'Alert both types', 'Alert following booking', 'PATCH move own', 'PATCH move blocker')").run();
  olena = (await request(app).post('/api/auth/login').send({ email: 'olena@roomflow.dev', password: 'password123' })).body.token;
  ivan = (await request(app).post('/api/auth/login').send({ email: 'ivan@roomflow.dev', password: 'password123' })).body.token;
});

describe('booking API', () => {
  it('keeps password hashes out of session tokens', () => {
    const payload = JSON.parse(Buffer.from(olena.split('.')[1], 'base64url').toString('utf8'));
    expect(payload.purpose).toBe('session');
    expect(payload).not.toHaveProperty('password');
    expect(payload).not.toHaveProperty('email_verified');
  });

  it('serves English by default and Ukrainian when requested', async () => {
    const english = await request(app).get('/api/my-bookings');
    expect(english.status).toBe(401);
    expect(english.body.error).toBe('Please sign in');
    const ukrainian = await request(app).get('/api/my-bookings').set('Accept-Language', 'uk');
    expect(ukrainian.body.error).toBe('Увійдіть до акаунта');
    expect(ukrainian.headers['content-language']).toBe('uk');
  });

  it('rejects verification tokens as sessions and localizes the verification page', async () => {
    const email = `locale-test-${Date.now()}@example.invalid`;
    try {
      const response = await request(app).post('/api/auth/register').set('Accept-Language', 'uk').send({
        name: 'Locale test', email, password: 'test-password-123',
      });
      expect(response.status).toBe(201);
      const url = new URL(response.body.verificationUrl);
      expect(url.searchParams.get('lang')).toBe('uk');
      const rejected = await request(app).get('/api/my-bookings').set('Authorization', `Bearer ${url.searchParams.get('token')}`);
      expect(rejected.status).toBe(401);
      const verified = await request(app).get(url.pathname + url.search);
      expect(verified.status).toBe(200);
      expect(verified.text).toContain('Email підтверджено');
    } finally {
      db.prepare('DELETE FROM users WHERE email = ?').run(email);
    }
  });

  it('creates one reservation, rejects a conflict and protects ownership', async () => {
    const start = futureStart(3, 10);
    const payload = { roomId: 6, title: 'API smoke test', startsAt: start.toISOString(), endsAt: new Date(+start + 1_800_000).toISOString() };
    const created = await request(app).post('/api/bookings').set('Authorization', `Bearer ${olena}`).send(payload);
    expect(created.status).toBe(201);

    const duplicate = await request(app).post('/api/bookings').set('Authorization', `Bearer ${ivan}`).send(payload);
    expect(duplicate.status).toBe(409);

    const forbidden = await request(app).delete(`/api/bookings/${created.body.id}`).set('Authorization', `Bearer ${ivan}`);
    expect(forbidden.status).toBe(403);

    const cancelled = await request(app).delete(`/api/bookings/${created.body.id}`).set('Authorization', `Bearer ${olena}`);
    expect(cancelled.status).toBe(204);
  });

  it('atomically resolves simultaneous requests for the same room and slot', async () => {
    const start = futureStart(20, 15);
    const end = new Date(+start + 1_800_000);
    const firstTitle = 'Race-safe booking A';
    const secondTitle = 'Race-safe booking B';

    try {
      const attempts = await Promise.all([
        request(app).post('/api/bookings').set('Authorization', `Bearer ${olena}`).send({
          roomId: 5, title: firstTitle, startsAt: start.toISOString(), endsAt: end.toISOString(),
        }),
        request(app).post('/api/bookings').set('Authorization', `Bearer ${ivan}`).send({
          roomId: 5, title: secondTitle, startsAt: start.toISOString(), endsAt: end.toISOString(),
        }),
      ]);

      expect(attempts.map((response) => response.status).sort()).toEqual([201, 409]);
      const stored = db.prepare(`
        SELECT count(*) AS count FROM bookings
        WHERE room_id = ? AND starts_at = ? AND ends_at = ?
      `).get(5, start.toISOString(), end.toISOString()) as { count: number };
      expect(stored.count).toBe(1);
    } finally {
      db.prepare("DELETE FROM bookings WHERE title IN ('Race-safe booking A', 'Race-safe booking B')").run();
    }
  });

  it('rejects malformed booking timestamps', async () => {
    const response = await request(app).post('/api/bookings').set('Authorization', `Bearer ${olena}`).send({
      roomId: 1, title: 'Broken time', startsAt: 'not-a-date', endsAt: 'also-not-a-date',
    });
    expect(response.status).toBe(400);
  });

  it('moves an owner’s future booking and rejects foreign or conflicting moves', async () => {
    const initialStart = futureStart(12, 10);
    const movedStart = new Date(+initialStart + 3_600_000);
    const conflictStart = new Date(+initialStart + 7_200_000);
    const duration = 1_800_000;

    try {
      const created = await request(app).post('/api/bookings').set('Authorization', `Bearer ${olena}`).send({
        roomId: 4,
        title: patchTestTitles[0],
        startsAt: initialStart.toISOString(),
        endsAt: new Date(+initialStart + duration).toISOString(),
      });
      expect(created.status).toBe(201);

      const foreignMove = await request(app).patch(`/api/bookings/${created.body.id}`).set('Authorization', `Bearer ${ivan}`).send({
        roomId: 4,
        startsAt: movedStart.toISOString(),
        endsAt: new Date(+movedStart + duration).toISOString(),
      });
      expect(foreignMove.status).toBe(403);

      const moved = await request(app).patch(`/api/bookings/${created.body.id}`).set('Authorization', `Bearer ${olena}`).send({
        roomId: 4,
        startsAt: movedStart.toISOString(),
        endsAt: new Date(+movedStart + duration).toISOString(),
      });
      expect(moved.status).toBe(200);
      expect(moved.body).toMatchObject({ id: created.body.id, roomId: 4, startsAt: movedStart.toISOString() });

      const blocker = await request(app).post('/api/bookings').set('Authorization', `Bearer ${ivan}`).send({
        roomId: 4,
        title: patchTestTitles[1],
        startsAt: conflictStart.toISOString(),
        endsAt: new Date(+conflictStart + duration).toISOString(),
      });
      expect(blocker.status).toBe(201);

      const conflict = await request(app).patch(`/api/bookings/${created.body.id}`).set('Authorization', `Bearer ${olena}`).send({
        roomId: 4,
        startsAt: conflictStart.toISOString(),
        endsAt: new Date(+conflictStart + duration).toISOString(),
      });
      expect(conflict.status).toBe(409);
    } finally {
      db.prepare(`DELETE FROM bookings WHERE title IN (${patchTestTitles.map(() => '?').join(', ')})`).run(...patchTestTitles);
    }
  });
});

describe('room availability', () => {
  it('returns capacity-matched rooms that are truly free for the requested interval', async () => {
    const start = futureStart(15, 10);
    const end = new Date(+start + 1_800_000);
    db.prepare('INSERT INTO bookings(room_id, user_id, title, starts_at, ends_at) VALUES (1, 1, ?, ?, ?)')
      .run('Availability blocker', start.toISOString(), end.toISOString());

    try {
      const response = await request(app)
        .get(`/api/rooms/availability?startsAt=${encodeURIComponent(start.toISOString())}&endsAt=${encodeURIComponent(end.toISOString())}&capacity=10`)
        .set('Authorization', `Bearer ${olena}`);
      expect(response.status).toBe(200);
      expect(response.body.some((room: { id: number }) => room.id === 1)).toBe(false);
      expect(response.body.every((room: { capacity: number }) => room.capacity >= 10)).toBe(true);
      expect(response.body[0]).toMatchObject({ id: 4, score: 0 });
    } finally {
      db.prepare("DELETE FROM bookings WHERE title = 'Availability blocker'").run();
    }
  });
});

describe('recurring bookings', () => {
  it('creates and cancels an entire weekly series', async () => {
    const start = futureStart(5, 11);
    const created = await request(app).post('/api/bookings').set('Authorization', `Bearer ${olena}`).send({
      roomId: 5, title: 'API recurring test', startsAt: start.toISOString(), endsAt: new Date(+start + 1_800_000).toISOString(), repeatWeeks: 3,
    });
    expect(created.status).toBe(201);
    expect(created.body.count).toBe(3);

    const cancelled = await request(app).delete(`/api/bookings/${created.body.id}?scope=series`).set('Authorization', `Bearer ${olena}`);
    expect(cancelled.status).toBe(204);
    expect((db.prepare("SELECT count(*) AS count FROM bookings WHERE title = 'API recurring test'").get() as { count: number }).count).toBe(0);
  });
});

describe('notifications', () => {
  it('keeps distinct start and handoff alerts for the same booking', async () => {
    const start = new Date(Date.now() + 60_000);
    const end = new Date(+start + 5 * 60_000);
    const nextEnd = new Date(+end + 1_800_000);
    const add = db.prepare('INSERT INTO bookings(room_id, user_id, title, starts_at, ends_at) VALUES (6, 1, ?, ?, ?)');
    const current = add.run('Alert both types', start.toISOString(), end.toISOString());
    add.run('Alert following booking', end.toISOString(), nextEnd.toISOString());

    try {
      const response = await request(app).get('/api/notifications').set('Authorization', `Bearer ${olena}`);
      const alertsForCurrentBooking = response.body.filter((notification: { message: string }) => notification.message.includes('Alert both types'));
      expect(alertsForCurrentBooking).toHaveLength(2);

      const kinds = db.prepare('SELECT kind FROM notifications WHERE booking_id = ? ORDER BY kind')
        .all(current.lastInsertRowid) as { kind: string }[];
      expect(kinds.map((notification) => notification.kind)).toEqual(['handoff', 'start']);
    } finally {
      db.prepare("DELETE FROM bookings WHERE title IN ('Alert both types', 'Alert following booking')").run();
    }
  });

  it('delivers a start reminder exactly once while the tab is polling', async () => {
    const start = new Date(Date.now() + 60_000);
    const end = new Date(+start + 1_800_000);
    const booking = db.prepare('INSERT INTO bookings(room_id, user_id, title, starts_at, ends_at) VALUES (3, 1, ?, ?, ?)')
      .run('Alert starts soon', start.toISOString(), end.toISOString());

    try {
      const first = await request(app).get('/api/notifications').set('Authorization', `Bearer ${olena}`);
      expect(first.body.some((notification: { message: string }) => notification.message.includes('Alert starts soon'))).toBe(true);

      const second = await request(app).get('/api/notifications').set('Authorization', `Bearer ${olena}`);
      expect(second.body.some((notification: { message: string }) => notification.message.includes('Alert starts soon'))).toBe(false);
    } finally {
      db.prepare('DELETE FROM bookings WHERE id = ?').run(booking.lastInsertRowid);
    }
  });

  it('delivers a due end-of-meeting alert exactly once', async () => {
    const end = new Date(Date.now() + 60_000);
    const start = new Date(+end - 1_800_000);
    const nextEnd = new Date(+end + 1_800_000);
    const add = db.prepare('INSERT INTO bookings(room_id, user_id, title, starts_at, ends_at) VALUES (1, 1, ?, ?, ?)');
    add.run('Alert current', start.toISOString(), end.toISOString());
    add.run('Alert next', end.toISOString(), nextEnd.toISOString());

    const first = await request(app).get('/api/notifications').set('Authorization', `Bearer ${olena}`);
    expect(first.body.some((notification: { message: string }) => notification.message.includes('Alert current'))).toBe(true);

    const second = await request(app).get('/api/notifications').set('Authorization', `Bearer ${olena}`);
    expect(second.body.some((notification: { message: string }) => notification.message.includes('Alert current'))).toBe(false);
    db.prepare("DELETE FROM bookings WHERE title IN ('Alert current', 'Alert next')").run();
  });

  it('removes a queued alert when the following booking is cancelled', async () => {
    const end = new Date(Date.now() + 60_000);
    const start = new Date(+end - 1_800_000);
    const nextEnd = new Date(+end + 1_800_000);
    const add = db.prepare('INSERT INTO bookings(room_id, user_id, title, starts_at, ends_at) VALUES (2, 1, ?, ?, ?)');
    const current = add.run('Alert cancelled current', start.toISOString(), end.toISOString());
    const next = add.run('Alert cancelled next', end.toISOString(), nextEnd.toISOString());

    await request(app).get('/api/notifications').set('Authorization', `Bearer ${olena}`);
    expect((db.prepare('SELECT count(*) AS count FROM notifications WHERE booking_id = ?').get(current.lastInsertRowid) as { count: number }).count).toBe(1);

    const cancelled = await request(app).delete(`/api/bookings/${next.lastInsertRowid}`).set('Authorization', `Bearer ${olena}`);
    expect(cancelled.status).toBe(204);
    expect((db.prepare('SELECT count(*) AS count FROM notifications WHERE booking_id = ?').get(current.lastInsertRowid) as { count: number }).count).toBe(0);
    db.prepare("DELETE FROM bookings WHERE title = 'Alert cancelled current'").run();
  });
});
