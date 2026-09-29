import 'dotenv/config';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { NextFunction, Request, Response } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';

import { db } from './db.js';
import { logError, logInfo, requestLogger } from './logger.js';
import { officeWeek, validateInterval } from './rules.js';
import { translateMessage, type Language } from './translations.js';
import './seed.js';

type SessionUser = { id: number; name: string; email: string };
type AuthRequest = Request & { user: SessionUser };
type BookingRow = { id: number; user_id: number; title: string; room: string };

function resolveJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET must be set in production');
  const secretPath = path.resolve('data/.dev-jwt-secret');
  if (fs.existsSync(secretPath)) return fs.readFileSync(secretPath, 'utf8').trim();
  const generated = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(secretPath), { recursive: true });
  fs.writeFileSync(secretPath, generated, { encoding: 'utf8', mode: 0o600 });
  return generated;
}

const secret = resolveJwtSecret();
const notifyBeforeMinutes = Number(process.env.NOTIFY_BEFORE_MINUTES || 10);
const port = Number(process.env.PORT || 3000);

export const app = express();
function requestLanguage(req: Request): Language {
  if (req.query.lang === 'uk' || req.query.lang === 'en') return req.query.lang;
  return req.acceptsLanguages('en', 'uk') === 'uk' ? 'uk' : 'en';
}
app.use((req, res, next) => {
  const language = requestLanguage(req);
  res.setHeader('Content-Language', language);
  res.vary('Accept-Language');
  const json = res.json.bind(res);
  res.json = (body: unknown) => {
    const localize = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(localize);
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
          ['error', 'notice', 'message'].includes(key) && typeof item === 'string'
            ? translateMessage(item, language) : item,
        ]));
      }
      return value;
    };
    return json(localize(body));
  };
  next();
});
app.use(express.json());
if (process.env.NODE_ENV !== 'test') app.use(requestLogger);

function createSession(user: SessionUser) {
  return jwt.sign({ id: user.id, name: user.name, email: user.email, purpose: 'session' }, secret, { expiresIn: '7d' });
}

function auth(req: Request, res: Response, next: NextFunction) {
  try {
    const rawToken = req.headers.authorization?.replace('Bearer ', '') || '';
    const decoded = jwt.verify(rawToken, secret) as JwtPayload & SessionUser;
    if (decoded.purpose !== 'session' || !Number.isInteger(decoded.id)) throw new Error('Invalid session');
    (req as AuthRequest).user = { id: decoded.id, name: decoded.name, email: decoded.email };
    next();
  } catch {
    res.status(401).json({ error: 'Увійдіть до акаунта' });
  }
}

function queueDueNotifications() {
  const now = new Date().toISOString();
  const until = new Date(Date.now() + notifyBeforeMinutes * 60_000).toISOString();
  const upcomingBookings = db.prepare(`
    SELECT b.id, b.user_id, b.title, r.name AS room
    FROM bookings b
    JOIN rooms r ON r.id = b.room_id
    WHERE b.starts_at > ? AND b.starts_at <= ?
  `).all(now, until) as BookingRow[];
  const dueBookings = db.prepare(`
    SELECT b.id, b.user_id, b.title, r.name AS room
    FROM bookings b
    JOIN rooms r ON r.id = b.room_id
    WHERE b.ends_at > ?
      AND b.ends_at <= ?
      AND EXISTS (
        SELECT 1 FROM bookings next_booking
        WHERE next_booking.room_id = b.room_id
          AND next_booking.starts_at = b.ends_at
      )
  `).all(now, until) as BookingRow[];

  const insert = db.prepare(`
    INSERT OR IGNORE INTO notifications(booking_id, user_id, kind, message)
    VALUES (?, ?, ?, ?)
  `);

  for (const booking of upcomingBookings) {
    insert.run(
      booking.id,
      booking.user_id,
      'start',
      `Зустріч «${booking.title}» у кімнаті ${booking.room} почнеться менш ніж за ${notifyBeforeMinutes} хв.`,
    );
  }

  for (const booking of dueBookings) {
    insert.run(
      booking.id,
      booking.user_id,
      'handoff',
      `Зустріч «${booking.title}» у кімнаті ${booking.room} скоро завершиться — наступний слот уже зайнятий.`,
    );
  }
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/api/auth/register', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (!name) return res.status(400).json({ error: 'Вкажіть ім’я' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Вкажіть коректний email' });
  if (password.length < 8 || password.length > 72) {
    return res.status(400).json({ error: 'Пароль: від 8 до 72 символів' });
  }

  try {
    const result = db.prepare('INSERT INTO users(name, email, password) VALUES (?, ?, ?)')
      .run(name, email, await bcrypt.hash(password, 10));
    const user = { id: Number(result.lastInsertRowid), name, email };
    const verificationToken = jwt.sign({ purpose: 'email-verify', id: user.id }, secret, { expiresIn: '24h' });
    const applicationUrl = process.env.APP_URL?.replace(/\/$/, '') || `${req.protocol}://${req.get('host')}`;
    const verificationUrl = `${applicationUrl}/api/auth/verify?token=${verificationToken}&lang=${requestLanguage(req)}`;

    logInfo('auth.verification_link_created', { userId: user.id });
    res.status(201).json({
      token: createSession(user),
      user,
      notice: 'Підтвердіть email, щоб активувати бронювання.',
      verificationUrl,
    });
  } catch {
    res.status(409).json({ error: 'Цей email уже зареєстрований' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as (SessionUser & { password: string }) | undefined;

  if (!user || !(await bcrypt.compare(password, user.password))) {
    return res.status(401).json({ error: 'Невірний email або пароль' });
  }

  res.json({ token: createSession(user), user: { id: user.id, name: user.name, email: user.email } });
});

app.get('/api/auth/verify', (req, res) => {
  try {
    const data = jwt.verify(String(req.query.token || ''), secret) as JwtPayload & { purpose: string; id: number };
    if (data.purpose !== 'email-verify') throw new Error('Unexpected token type');
    db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(data.id);
    res.type('html').send(verificationPage(requestLanguage(req), true));
  } catch {
    res.status(400).type('html').send(verificationPage(requestLanguage(req), false));
  }
});

function verificationPage(language: Language, success: boolean) {
  const message = success
    ? '<h2>Email підтверджено ✓</h2><p>Можна повернутися до RoomFlow і бронювати переговорні.</p>'
    : '<h2>Посилання недійсне або прострочене.</h2>';
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>RoomFlow</title></head><body style="font-family:system-ui;max-width:600px;margin:12vh auto;padding:24px;color:#162237">${translateMessage(message, language)}<a href="/">${language === 'en' ? 'Back to RoomFlow' : 'Повернутися до RoomFlow'}</a></body></html>`;
}

app.get('/api/rooms', (_req, res) => {
  res.json(db.prepare('SELECT * FROM rooms ORDER BY floor, name').all());
});

app.get('/api/rooms/availability', auth, (req, res) => {
  const startsAt = new Date(String(req.query.startsAt || ''));
  const endsAt = new Date(String(req.query.endsAt || ''));
  const capacity = Number(req.query.capacity || 0);
  const validationError = validateInterval(startsAt, endsAt);
  if (validationError) return res.status(400).json({ error: validationError });
  if (!Number.isInteger(capacity) || capacity < 0) {
    return res.status(400).json({ error: 'Вкажіть коректну місткість' });
  }

  const rooms = db.prepare(`
    SELECT r.*, r.capacity - ? AS score
    FROM rooms r
    WHERE r.capacity >= ?
      AND NOT EXISTS (
        SELECT 1 FROM bookings b
        WHERE b.room_id = r.id
          AND b.starts_at < ?
          AND b.ends_at > ?
      )
    ORDER BY score, r.floor, r.name
  `).all(capacity, capacity, endsAt.toISOString(), startsAt.toISOString());
  res.json(rooms);
});

app.get('/api/bookings', (req, res) => {
  const from = String(req.query.from || '');
  const to = String(req.query.to || '');
  if (Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)) || from >= to) {
    return res.status(400).json({ error: 'Вкажіть коректний інтервал розкладу' });
  }
  const bookings = db.prepare(`
    SELECT b.*, u.name AS author, r.name AS room
    FROM bookings b
    JOIN users u ON u.id = b.user_id
    JOIN rooms r ON r.id = b.room_id
    WHERE b.starts_at < ? AND b.ends_at > ?
    ORDER BY b.starts_at
  `).all(to, from);
  res.json(bookings);
});

app.get('/api/my-bookings', auth, (req, res) => {
  const user = (req as AuthRequest).user;
  const bookings = db.prepare(`
    SELECT b.*, u.name AS author, r.name AS room
    FROM bookings b
    JOIN users u ON u.id = b.user_id
    JOIN rooms r ON r.id = b.room_id
    WHERE b.user_id = ?
    ORDER BY b.starts_at
  `).all(user.id);
  res.json(bookings);
});

app.get('/api/notifications', auth, (req, res) => {
  const user = (req as AuthRequest).user;
  queueDueNotifications();
  const notifications = db.prepare(`
    SELECT id, message FROM notifications
    WHERE user_id = ? AND read_at IS NULL
    ORDER BY id
  `).all(user.id) as { id: number; message: string }[];

  if (notifications.length) {
    const placeholders = notifications.map(() => '?').join(',');
    db.prepare(`UPDATE notifications SET read_at = ? WHERE id IN (${placeholders})`)
      .run(new Date().toISOString(), ...notifications.map((notification) => notification.id));
  }
  res.json(notifications);
});

app.post('/api/bookings', auth, (req, res) => {
  const user = (req as AuthRequest).user;
  const roomId = Number(req.body.roomId);
  const title = String(req.body.title || '').trim();
  const start = new Date(req.body.startsAt);
  const end = new Date(req.body.endsAt);
  const repeatWeeks = Number(req.body.repeatWeeks || 1);

  if (!roomId || title.length < 1 || title.length > 100) {
    return res.status(400).json({ error: 'Назва має містити від 1 до 100 символів' });
  }
  if (!Number.isInteger(repeatWeeks) || repeatWeeks < 1 || repeatWeeks > 8) {
    return res.status(400).json({ error: 'Кількість повторень: від 1 до 8' });
  }
  const initialValidationError = validateInterval(start, end);
  if (initialValidationError) return res.status(400).json({ error: initialValidationError });

  const account = db.prepare('SELECT email_verified FROM users WHERE id = ?').get(user.id) as { email_verified: number } | undefined;
  if (!account?.email_verified) return res.status(403).json({ error: 'Підтвердіть email, щоб бронювати кімнати' });
  if (!db.prepare('SELECT id FROM rooms WHERE id = ?').get(roomId)) {
    return res.status(404).json({ error: 'Кімнату не знайдено' });
  }

  const duration = +end - +start;
  const dates = Array.from({ length: repeatWeeks }, (_, index) => {
    const seriesStart = officeWeek(start, index);
    return { start: seriesStart, end: new Date(+seriesStart + duration) };
  });
  for (const date of dates) {
    const validationError = validateInterval(date.start, date.end);
    if (validationError) return res.status(400).json({ error: validationError });
  }

  const seriesId = repeatWeeks > 1 ? crypto.randomUUID() : null;
  try {
    const insert = db.prepare(`
      INSERT INTO bookings(room_id, user_id, title, starts_at, ends_at, series_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const results = db.transaction(() => dates.map((date) => insert.run(
      roomId, user.id, title, date.start.toISOString(), date.end.toISOString(), seriesId,
    )))();
    res.status(201).json({ id: results[0].lastInsertRowid, count: results.length, seriesId });
  } catch (error) {
    if (String(error).includes('booking_conflict')) {
      return res.status(409).json({ error: 'Один зі слотів серії вже зайнятий — нічого не створено' });
    }
    throw error;
  }
});

app.patch('/api/bookings/:id', auth, (req, res) => {
  const user = (req as AuthRequest).user;
  const booking = db.prepare(`
    SELECT id, room_id, user_id, title, starts_at, ends_at
    FROM bookings WHERE id = ? AND user_id = ?
  `).get(req.params.id, user.id) as { id: number; room_id: number; title: string; starts_at: string; ends_at: string } | undefined;
  if (!booking) return res.status(403).json({ error: 'Можна змінювати лише власне бронювання' });

  const roomId = Number(req.body.roomId || booking.room_id);
  const startsAt = new Date(req.body.startsAt || booking.starts_at);
  const endsAt = new Date(req.body.endsAt || booking.ends_at);
  const validationError = validateInterval(startsAt, endsAt);
  if (validationError) return res.status(400).json({ error: validationError });
  if (!db.prepare('SELECT id FROM rooms WHERE id = ?').get(roomId)) {
    return res.status(404).json({ error: 'Кімнату не знайдено' });
  }

  try {
    db.transaction(() => {
      // A previous handoff alert is no longer accurate after this booking moves.
      db.prepare(`
        DELETE FROM notifications
        WHERE booking_id = ? OR (
          kind = 'handoff' AND booking_id IN (
            SELECT id FROM bookings WHERE room_id = ? AND ends_at = ?
          )
        )
      `).run(booking.id, booking.room_id, booking.starts_at);
      db.prepare(`
        UPDATE bookings SET room_id = ?, starts_at = ?, ends_at = ?
        WHERE id = ? AND user_id = ?
      `).run(roomId, startsAt.toISOString(), endsAt.toISOString(), booking.id, user.id);
    })();
    res.json({ id: booking.id, roomId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() });
  } catch (error) {
    if (String(error).includes('booking_conflict')) {
      return res.status(409).json({ error: 'Цей слот уже зайнятий' });
    }
    throw error;
  }
});

app.delete('/api/bookings/:id', auth, (req, res) => {
  const user = (req as AuthRequest).user;
  const booking = db.prepare(`
    SELECT room_id, starts_at, series_id FROM bookings
    WHERE id = ? AND user_id = ?
  `).get(req.params.id, user.id) as { room_id: number; starts_at: string; series_id: string | null } | undefined;
  if (!booking) return res.status(403).json({ error: 'Можна скасувати лише власне бронювання' });

  if (req.query.scope === 'series' && booking.series_id) {
    db.transaction(() => {
      db.prepare(`
        DELETE FROM notifications WHERE kind = 'handoff' AND booking_id IN (
          SELECT previous.id
          FROM bookings previous
          JOIN bookings cancelled ON cancelled.room_id = previous.room_id AND cancelled.starts_at = previous.ends_at
          WHERE cancelled.series_id = ? AND cancelled.user_id = ?
        )
      `).run(booking.series_id, user.id);
      db.prepare('DELETE FROM bookings WHERE series_id = ? AND user_id = ?').run(booking.series_id, user.id);
    })();
  } else {
    db.transaction(() => {
      db.prepare(`
        DELETE FROM notifications WHERE kind = 'handoff' AND booking_id IN (
          SELECT id FROM bookings WHERE room_id = ? AND ends_at = ?
        )
      `).run(booking.room_id, booking.starts_at);
      db.prepare('DELETE FROM bookings WHERE id = ? AND user_id = ?').run(req.params.id, user.id);
    })();
  }
  res.status(204).end();
});

app.use(express.static('dist/client'));
app.get('/{*splat}', (_req, res) => res.sendFile(path.resolve('dist/client/index.html')));

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  logError('http.unhandled_error', error, { requestId: String(res.getHeader('X-Request-ID') || 'unknown') });
  res.status(500).json({ error: 'Внутрішня помилка сервера' });
});

if (process.env.NODE_ENV !== 'test') {
  setInterval(queueDueNotifications, 30_000);
  app.listen(port, () => logInfo('server.started', { port }));
}
