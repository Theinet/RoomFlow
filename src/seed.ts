import bcrypt from 'bcryptjs';
import { db } from './db.js';

const rooms = [
  ['Акваріум', 4, 12], ['Марс', 4, 8], ['Гагарін', 5, 6],
  ['Орбіта', 5, 10], ['Дніпро', 6, 4], ['Січ', 6, 16],
] as const;

const demoUsers = [
  ['Олена Коваль', 'olena@roomflow.dev'],
  ['Іван Петренко', 'ivan@roomflow.dev'],
] as const;

const demoBookings = [
  { roomId: 1, userIndex: 0, dayOffset: 0, hour: 10, minutes: 90, title: 'Демо · Планування спринту' },
  { roomId: 1, userIndex: 1, dayOffset: 1, hour: 13, minutes: 60, title: 'Демо · Product sync' },
  { roomId: 1, userIndex: 0, dayOffset: 3, hour: 15.5, minutes: 60, title: 'Демо · Ретро команди' },
  { roomId: 2, userIndex: 1, dayOffset: 1, hour: 11, minutes: 60, title: 'Демо · Дизайн-ревʼю' },
  { roomId: 3, userIndex: 0, dayOffset: 2, hour: 14, minutes: 90, title: 'Демо · Інтерв’ю' },
  { roomId: 4, userIndex: 1, dayOffset: 4, hour: 10, minutes: 120, title: 'Демо · Стратегія' },
] as const;

function startOfWeek() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date;
}

function nextWorkingWeek() {
  const date = startOfWeek();
  const weekday = new Date().getDay();
  if (weekday === 0 || weekday === 6) date.setDate(date.getDate() + 7);
  return date;
}

async function seed() {
  const roomCount = db.prepare('SELECT count(*) AS count FROM rooms').get() as { count: number };
  if (!roomCount.count) {
    const insertRoom = db.prepare('INSERT INTO rooms(name, floor, capacity) VALUES (?, ?, ?)');
    for (const room of rooms) insertRoom.run(...room);
  }

  const findUser = db.prepare('SELECT id FROM users WHERE email = ?');
  const insertUser = db.prepare(`
    INSERT INTO users(name, email, password, email_verified) VALUES (?, ?, ?, 1)
  `);
  for (const [name, email] of demoUsers) {
    if (!findUser.get(email)) insertUser.run(name, email, await bcrypt.hash('password123', 10));
  }
  db.prepare(`
    UPDATE users SET email_verified = 1
    WHERE email IN ('olena@roomflow.dev', 'ivan@roomflow.dev')
  `).run();

  const userIds = demoUsers.map(([, email]) => (findUser.get(email) as { id: number }).id);
  const bookingExists = db.prepare('SELECT id FROM bookings WHERE title = ? AND ends_at > ?');
  const insertBooking = db.prepare(`
    INSERT INTO bookings(room_id, user_id, title, starts_at, ends_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const monday = nextWorkingWeek();
  const now = new Date().toISOString();
  for (const booking of demoBookings) {
    if (bookingExists.get(booking.title, now)) continue;
    const startsAt = new Date(monday);
    startsAt.setDate(startsAt.getDate() + booking.dayOffset);
    startsAt.setHours(Math.floor(booking.hour), booking.hour % 1 ? 30 : 0, 0, 0);
    const endsAt = new Date(+startsAt + booking.minutes * 60_000);
    try {
      insertBooking.run(booking.roomId, userIds[booking.userIndex], booking.title, startsAt.toISOString(), endsAt.toISOString());
    } catch (error) {
      if (!String(error).includes('booking_conflict')) throw error;
    }
  }
}

await seed();
