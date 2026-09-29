import Database from 'better-sqlite3';
import fs from 'node:fs';

fs.mkdirSync('data', { recursive: true });

export const db = new Database('data/roomflow.db');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users(
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password TEXT NOT NULL,
    email_verified INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS rooms(
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    floor INTEGER NOT NULL,
    capacity INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS bookings(
    id INTEGER PRIMARY KEY,
    room_id INTEGER NOT NULL REFERENCES rooms(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    series_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS notifications(
    id INTEGER PRIMARY KEY,
    booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    kind TEXT NOT NULL DEFAULT 'start',
    message TEXT NOT NULL,
    read_at TEXT
  );
`);

type TableColumn = { name: string };
type Index = { name: string; unique: number };

function hasColumn(table: string, column: string) {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as TableColumn[])
    .some((item) => item.name === column);
}

function hasLegacyNotificationUniqueConstraint() {
  const indexes = db.prepare('PRAGMA index_list(notifications)').all() as Index[];
  return indexes.some((index) => {
    if (!index.unique) return false;
    const columns = db.prepare(`PRAGMA index_info(${index.name})`).all() as TableColumn[];
    return columns.length === 1 && columns[0].name === 'booking_id';
  });
}

// Old installations allowed only one notification per booking. Rebuild just this
// child table atomically so existing alert history is retained as a `start` alert.
function migrateNotificationsIfNeeded() {
  const hasKind = hasColumn('notifications', 'kind');
  if (hasKind && !hasLegacyNotificationUniqueConstraint()) return;

  const kindValue = hasKind ? "COALESCE(kind, 'start')" : "'start'";
  db.transaction(() => {
    db.exec('ALTER TABLE notifications RENAME TO notifications_legacy');
    db.exec(`
      CREATE TABLE notifications(
        id INTEGER PRIMARY KEY,
        booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        kind TEXT NOT NULL DEFAULT 'start',
        message TEXT NOT NULL,
        read_at TEXT
      );
      INSERT INTO notifications(id, booking_id, user_id, kind, message, read_at)
      SELECT id, booking_id, user_id, ${kindValue}, message, read_at
      FROM notifications_legacy;
      DROP TABLE notifications_legacy;
    `);
  })();
}

migrateNotificationsIfNeeded();
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS notifications_booking_kind ON notifications(booking_id, kind)');

if (!hasColumn('users', 'email_verified')) {
  db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0');
}
if (!hasColumn('bookings', 'series_id')) {
  db.exec('ALTER TABLE bookings ADD COLUMN series_id TEXT');
}

// The database itself protects against double booking, including concurrent API requests.
db.exec(`
  CREATE TRIGGER IF NOT EXISTS prevent_booking_overlap BEFORE INSERT ON bookings
  WHEN EXISTS(
    SELECT 1 FROM bookings
    WHERE room_id = NEW.room_id
      AND starts_at < NEW.ends_at
      AND ends_at > NEW.starts_at
  )
  BEGIN SELECT RAISE(ABORT, 'booking_conflict'); END;
`);
db.exec(`
  CREATE TRIGGER IF NOT EXISTS prevent_booking_update_overlap BEFORE UPDATE OF room_id, starts_at, ends_at ON bookings
  WHEN EXISTS(
    SELECT 1 FROM bookings
    WHERE id != NEW.id
      AND room_id = NEW.room_id
      AND starts_at < NEW.ends_at
      AND ends_at > NEW.starts_at
  )
  BEGIN SELECT RAISE(ABORT, 'booking_conflict'); END;
`);

export type Booking = {
  id: number;
  room_id: number;
  user_id: number;
  title: string;
  starts_at: string;
  ends_at: string;
  author: string;
  room: string;
};
