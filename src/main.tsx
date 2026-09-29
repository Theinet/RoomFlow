import { t, feedback, verificationLink, getLanguage, useLanguage, LanguageSwitcher } from './i18n.js';
import { plusDays } from './calendar.js';
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
type Room = {
  id: number;
  name: string;
  floor: number;
  capacity: number;
};
type AvailableRoom = Room & {
  score: number;
};
type Booking = {
  id: number;
  room_id: number;
  user_id: number;
  title: string;
  starts_at: string;
  ends_at: string;
  series_id: string | null;
  author: string;
  room: string;
};
type User = {
  id: number;
  name: string;
  email: string;
};
type LoadState = 'loading' | 'ready' | 'error';
const officeZone = 'Europe/Kyiv';
async function api<T>(path: string, options: RequestInit = {}, authToken = localStorage.token): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Accept-Language': getLanguage(),
      ...(authToken ? {
        Authorization: `Bearer ${authToken}`
      } : {}),
      ...options.headers
    }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || t("Помилка сервера"));
  }
  return response.status === 204 ? null as T : response.json() as Promise<T>;
}
function decodeSession(token: string): User {
  const encodedPayload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  const payload = encodedPayload.padEnd(encodedPayload.length + (4 - encodedPayload.length % 4) % 4, '=');
  const binary = window.atob(payload);
  const json = new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0)));
  const {
    id,
    name,
    email
  } = JSON.parse(json) as User;
  return {
    id,
    name,
    email
  };
}
function monday(date = new Date()) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  result.setDate(result.getDate() - (result.getDay() + 6) % 7);
  return result;
}
function firstCalendarWeek() {
  const currentWeek = monday();
  const weekday = new Date().getDay();
  return weekday === 0 || weekday === 6 ? plusDays(currentWeek, 7) : currentWeek;
}
function suggestedBookingStart(week: Date, initialStart: Date | null = null) {
  const suggested = initialStart || officeUtc(plusDays(week, 1), 10);
  if (suggested > new Date()) return suggested;
  return new Date(Math.ceil((Date.now() + 3_600_000) / 1_800_000) * 1_800_000);
}
function format(date: Date, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(getLanguage() === 'en' ? 'en-GB' : 'uk-UA', options).format(date);
}
function time(iso: string) {
  return format(new Date(iso), {
    hour: '2-digit',
    minute: '2-digit'
  });
}
function pad(value: number) {
  return String(value).padStart(2, '0');
}
function toInputValue(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function zoneParts(date: Date, zone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const number = (type: string) => Number(parts.find(part => part.type === type)?.value);
  return {
    year: number('year'),
    month: number('month'),
    day: number('day'),
    hour: number('hour'),
    minute: number('minute')
  };
}

/** Converts an office-wall-clock date/time to an exact UTC instant, including DST. */
function officeUtc(day: Date, hours: number) {
  const target = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(hours), hours % 1 ? 30 : 0);
  let result = new Date(target);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const shown = zoneParts(result, officeZone);
    result = new Date(+result + (target - Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute)));
  }
  return result;
}
let audioContext: AudioContext | null = null;
async function playNotificationSound() {
  const legacyWindow = window as typeof window & {
    webkitAudioContext?: typeof AudioContext;
  };
  const AudioContextClass = window.AudioContext || legacyWindow.webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    audioContext ||= new AudioContextClass();
    await audioContext.resume();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
    oscillator.frequency.setValueAtTime(1175, audioContext.currentTime + 0.13);
    gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, audioContext.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.35);
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.36);
  } catch {
    // Sound is optional: browser autoplay restrictions must never interrupt booking work.
  }
}
function Auth({
  onLogin
}: {
  onLogin: (user: User) => void;
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({
    name: '',
    email: 'olena@roomflow.dev',
    password: 'password123'
  });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [verificationUrl, setVerificationUrl] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api<{
        token: string;
        user: User;
        notice?: string;
        verificationUrl?: string;
      }>(`/auth/${mode}`, {
        method: 'POST',
        body: JSON.stringify(form)
      }, '');
      if (mode === 'register') {
        setNotice(result.notice || t("Підтвердіть email, щоб активувати бронювання."));
        setVerificationUrl(result.verificationUrl || '');
        return;
      }
      localStorage.token = result.token;
      onLogin(result.user);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function openDemo() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api<{
        token: string;
        user: User;
      }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: 'olena@roomflow.dev',
          password: 'password123'
        })
      }, '');
      localStorage.token = result.token;
      onLogin(result.user);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function switchMode() {
    setMode(mode === 'login' ? 'register' : 'login');
    setError('');
    setNotice('');
    setVerificationUrl('');
  }
  return <main className="auth">
    <div className="auth-language"><LanguageSwitcher /></div>
    <section>
      <div className="brand">ROOM<span>FLOW</span></div>
      <p className="eyebrow">WORKSPACE RESERVATIONS</p>
      <h1>{t("Кімната для")}<br />{t("вашої ідеї.")}</h1>
      <p className="muted">{t("Швидке бронювання переговорних — без накладок і зайвих листів.")}</p>
      <div className="feature">{t("● 6 кімнат · live розклад · часові пояси")}</div>
    </section>
    <form onSubmit={submit}>
      <h2>{mode === 'login' ? t("З поверненням") : t("Створити акаунт")}</h2>
      <p className="muted">{mode === 'login' ? t("Увійдіть, щоб забронювати простір.") : t("Почніть планувати зустрічі вже зараз.")}</p>
      {mode === 'register' && <label>{t("Ім’я")}<input required value={form.name} onChange={event => setForm({
          ...form,
          name: event.target.value
        })} /></label>}
      <label>Email<input type="email" required value={form.email} onChange={event => setForm({
          ...form,
          email: event.target.value
        })} /></label>
      <label>{t("Пароль")}<input type="password" required minLength={8} value={form.password} onChange={event => setForm({
          ...form,
          password: event.target.value
        })} /></label>
      {error && <p className="error">{feedback(error)}</p>}
      {notice && <p className="demo-explanation">{t("Демо-режим: посилання підтвердження показується тут замість надсилання листа.")}</p>}
      {notice && <p className="notice">{feedback(notice)}{verificationUrl && <> <a className="verify" href={verificationLink(verificationUrl)}>{t("Підтвердити зараз")}</a></>}</p>}
      <button disabled={busy}>{busy ? t("Зачекайте…") : mode === 'login' ? t("Увійти") : t("Зареєструватися")}</button>
      {mode === 'login' && <button type="button" className="demo-login" onClick={openDemo} disabled={busy}>{t("✨ Відкрити інтерактивне демо")}</button>}
      <p className="switch">{mode === 'login' ? t("Ще немає акаунта?") : t("Вже є акаунт?")} <a onClick={switchMode}>{mode === 'login' ? t("Зареєструватися") : t("Увійти")}</a></p>
      <p className="demo-label">{t("Демонстраційний простір")}</p><small>{t("Демо: olena@roomflow.dev / password123")}</small>
    </form>
  </main>;
}
function App() {
  const language = useLanguage();
  const [user, setUser] = useState<User | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomsState, setRoomsState] = useState<LoadState>('loading');
  const [week, setWeek] = useState(firstCalendarWeek);
  const [selectedRoomId, setSelectedRoomId] = useState(1);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [scheduleState, setScheduleState] = useState<LoadState>('loading');
  const [minCapacity, setMinCapacity] = useState(0);
  const [page, setPage] = useState<'schedule' | 'mine'>('schedule');
  const [bookingDialog, setBookingDialog] = useState(false);
  const [draftStart, setDraftStart] = useState<Date | null>(null);
  const [draftEnd, setDraftEnd] = useState<Date | null>(null);
  const [finderDialog, setFinderDialog] = useState(false);
  const [movingBooking, setMovingBooking] = useState<Booking | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem('roomflow-sound') === 'on');
  const [toast, setToast] = useState('');
  async function loadRooms() {
    setRoomsState('loading');
    try {
      setRooms(await api<Room[]>('/rooms'));
      setRoomsState('ready');
    } catch {
      setRoomsState('error');
    }
  }
  async function loadSchedule() {
    setScheduleState('loading');
    try {
      const from = plusDays(week, -1).toISOString();
      const to = plusDays(week, 8).toISOString();
      setBookings(await api<Booking[]>(`/bookings?from=${from}&to=${to}`));
      setScheduleState('ready');
    } catch {
      setScheduleState('error');
    }
  }
  useEffect(() => {
    if (localStorage.token) {
      try {
        setUser(decodeSession(localStorage.token));
      } catch {
        localStorage.removeItem('token');
      }
    }
    loadRooms();
  }, []);
  useEffect(() => {
    loadSchedule();
  }, [week, bookingDialog]);
  useEffect(() => {
    if (!user) return undefined;
    let active = true;
    const poll = () => api<{
      message: string;
    }[]>('/notifications').then(items => {
      if (!active || !items.length) return;
      const message = items.map(item => item.message).join('\n\n');
      setToast(message);
      if (soundEnabled) {
        void playNotificationSound();
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('RoomFlow', {
            body: items[0].message
          });
        }
      }
    }).catch(() => undefined);
    poll();
    const interval = window.setInterval(poll, 15_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [user, soundEnabled, language]);
  const selectedRoom = rooms.find(room => room.id === selectedRoomId);
  const visibleRooms = rooms.filter(room => room.capacity >= minCapacity);
  const roomBookings = bookings.filter(booking => booking.room_id === selectedRoomId);
  function openBooking(start: Date | null = null, end: Date | null = null) {
    if (start && start <= new Date()) {
      setToast(t("Для бронювання оберіть майбутній слот."));
      return;
    }
    setDraftStart(start);
    setDraftEnd(end);
    setBookingDialog(true);
  }
  function changeCapacity(capacity: number) {
    setMinCapacity(capacity);
    const currentRoom = rooms.find(room => room.id === selectedRoomId);
    const replacement = rooms.find(room => room.capacity >= capacity);
    if (currentRoom && currentRoom.capacity < capacity && replacement) setSelectedRoomId(replacement.id);
  }
  async function moveBooking(booking: Booking, startsAt: Date, roomId = booking.room_id, endsAt = new Date(+startsAt + (+new Date(booking.ends_at) - +new Date(booking.starts_at))), throwOnError = false) {
    if (startsAt <= new Date()) {
      const reason = new Error(t("Перенести можна лише у майбутній слот."));
      setToast(reason.message);
      if (throwOnError) throw reason;
      return;
    }
    try {
      await api(`/bookings/${booking.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          roomId,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString()
        })
      });
      setBookings(current => current.map(item => item.id === booking.id ? {
        ...item,
        room_id: roomId,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString()
      } : item));
      setToast(t("Бронювання перенесено."));
    } catch (reason) {
      setToast((reason as Error).message);
      loadSchedule();
      if (throwOnError) throw reason;
    }
  }
  async function toggleSound() {
    const next = !soundEnabled;
    setSoundEnabled(next);
    localStorage.setItem('roomflow-sound', next ? 'on' : 'off');
    if (!next) return;
    await playNotificationSound();
    if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
    setToast(t("Звук і сповіщення увімкнено."));
  }
  function logout() {
    localStorage.removeItem('token');
    setUser(null);
  }
  if (!user) return <Auth onLogin={setUser} />;
  return <div>
    <header>
      <div className="brand">ROOM<span>FLOW</span></div>
      <nav>
        <a className={page === 'schedule' ? 'active' : ''} onClick={() => setPage('schedule')}>{t("Розклад")}</a>
        <a className={page === 'mine' ? 'active' : ''} onClick={() => setPage('mine')}>{t("Мої бронювання")}</a>
      </nav>
      <div className="profile"><LanguageSwitcher /><button className={`sound-toggle ${soundEnabled ? 'enabled' : ''}`} onClick={toggleSound} title={t("Увімкнути звук та системні сповіщення")} aria-label={t("Увімкнути звук та системні сповіщення")} aria-pressed={soundEnabled}>{soundEnabled ? t("🔔 Звук") : t("🔕 Звук")}</button><b>{t(user.name)}</b><button className="ghost" onClick={logout} title={t("Вийти")} aria-label={t("Вийти")}>{t("Вийти")}</button></div>
    </header>

    {page === 'mine' ? <MyBookings user={user} onChanged={loadSchedule} onOpen={booking => {
      setSelectedRoomId(booking.room_id);
      setWeek(monday(new Date(booking.starts_at)));
      setPage('schedule');
    }} /> : <main className="workspace">
      <aside>
        <p className="eyebrow">{t("ПЕРЕГОВОРНІ")}</p><h2>{t("Оберіть простір")}</h2>
        <label className="capacity">{t("Місткість")}<select value={minCapacity} onChange={event => changeCapacity(Number(event.target.value))}>
          <option value="0">{t("Будь-яка")}</option><option value="6">{t("Від 6 осіб")}</option><option value="10">{t("Від 10 осіб")}</option><option value="15">{t("Від 15 осіб")}</option>
        </select></label>
        {roomsState === 'loading' && <RoomSkeleton />}
        {roomsState === 'error' && <EmptyState compact text={t("Не вдалося завантажити кімнати.")} action={t("Спробувати ще")} onAction={loadRooms} />}
        {roomsState === 'ready' && visibleRooms.map(room => <button className={`room ${room.id === selectedRoomId ? 'selected' : ''}`} onClick={() => setSelectedRoomId(room.id)} key={room.id}>
          <b>{t(room.name)}</b><span>{t("Поверх {0} · до {1} осіб", room.floor, room.capacity)}</span>
        </button>)}
        {roomsState === 'ready' && !visibleRooms.length && <EmptyState compact text={t("Немає кімнат із такою місткістю.")} />}
        <div className="tip"><b>{t("Часовий пояс")}</b><br />{t("Ваш час: ")}{Intl.DateTimeFormat().resolvedOptions().timeZone}<br /><small>{t("Офіс: ")}{officeZone}</small></div>
      </aside>
      <section className="calendar">
        <div className="calhead"><div><p className="eyebrow">{t("ПОВЕРХ {0} · ДО {1} ОСІБ", selectedRoom?.floor, selectedRoom?.capacity)}</p><h1>{t(selectedRoom?.name ?? "") || t("Завантаження…")}</h1></div>
          <div className="actions"><button className="icon" aria-label={t("Попередній тиждень")} onClick={() => setWeek(plusDays(week, -7))}>←</button><button className="today" onClick={() => setWeek(firstCalendarWeek())}>{t("Сьогодні")}</button><button className="icon" aria-label={t("Наступний тиждень")} onClick={() => setWeek(plusDays(week, 7))}>→</button><button className="finder-trigger" onClick={() => setFinderDialog(true)}>{t("✦ Підібрати")}</button><button className="primary" onClick={() => openBooking()}>{t("+ Забронювати")}</button></div>
        </div>
        <p className="period">{format(week, {
            day: 'numeric',
            month: 'long'
          })} — {format(plusDays(week, 6), {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
          })}</p>
        <div className="calendar-meta"><span>{t("Ваш час: ")}<b>{Intl.DateTimeFormat().resolvedOptions().timeZone}</b></span><span>{t("Офіс: ")}<b>{officeZone}</b></span><span className="legend own">{t("Мої")}</span><span className="legend other">{t("Інші · 🔒")}</span><span className="drag-hint">{t("↕ Перетягніть свою майбутню подію")}</span></div>
        {scheduleState === 'loading' && <CalendarSkeleton />}
        {scheduleState === 'error' && <EmptyState text={t("Не вдалося завантажити розклад.")} action={t("Повторити")} onAction={loadSchedule} />}
        {scheduleState === 'ready' && <>
          {!roomBookings.length && <p className="schedule-empty">{t("Цього тижня в кімнаті ще немає бронювань. Натисніть на вільний слот, щоб створити першу.")}</p>}
          <CalendarGrid bookings={roomBookings} week={week} user={user} onSlotClick={openBooking} onMove={(booking, startsAt) => {
            void moveBooking(booking, startsAt);
          }} onEdit={setMovingBooking} />
          <MobileAgenda bookings={roomBookings} week={week} user={user} onSlotClick={openBooking} onEdit={setMovingBooking} />
        </>}
      </section>
    </main>}

    {finderDialog && <SmartFinder week={week} onClose={() => setFinderDialog(false)} onPick={(room, startsAt, endsAt) => {
      setSelectedRoomId(room.id);
      setFinderDialog(false);
      openBooking(startsAt, endsAt);
    }} />}
    {bookingDialog && <BookingForm rooms={rooms} currentRoomId={selectedRoomId} week={week} initialStart={draftStart} initialEnd={draftEnd} onClose={() => setBookingDialog(false)} onDone={message => {
      setBookingDialog(false);
      setToast(message);
    }} />}
    {movingBooking && <MoveBookingForm booking={movingBooking} rooms={rooms} onClose={() => setMovingBooking(null)} onDone={async (startsAt, roomId, endsAt) => {
      await moveBooking(movingBooking, startsAt, roomId, endsAt, true);
      setMovingBooking(null);
    }} />}
    {toast && <div className="toast" role="status" aria-live="polite" onClick={() => setToast('')}>{feedback(toast)}</div>}
  </div>;
}
function CalendarGrid({
  bookings,
  week,
  user,
  onSlotClick,
  onMove,
  onEdit
}: {
  bookings: Booking[];
  week: Date;
  user: User;
  onSlotClick: (start: Date) => void;
  onMove: (booking: Booking, startsAt: Date) => void;
  onEdit: (booking: Booking) => void;
}) {
  const slots = Array.from({
    length: 20
  }, (_, index) => 9 + index * 0.5);
  const days = Array.from({
    length: 7
  }, (_, index) => plusDays(week, index));
  const dayStarts = days.map(day => officeUtc(day, 9));
  const now = new Date();
  return <div className="grid improved">
    <div className="corner" />
    {days.map((day, index) => {
      const shown = dayStarts[index];
      return <div className={`day ${shown.toDateString() === now.toDateString() ? 'now' : ''}`} key={day.toISOString()}><b>{format(shown, {
            weekday: 'short'
          })}</b><span>{format(shown, {
            day: 'numeric'
          })}</span></div>;
    })}
    <div className="times">{slots.map(slot => <div className="hour" key={slot}>{time(officeUtc(week, slot).toISOString())}</div>)}</div>
    {days.map((day, dayIndex) => {
      const dayStart = dayStarts[dayIndex];
      const events = bookings.filter(booking => {
        const start = new Date(booking.starts_at);
        return start >= dayStart && start < new Date(+dayStart + 36_000_000);
      });
      const nowTop = (+now - +dayStart) / 1_800_000 * 39;
      return <div className="daycol" key={day.toISOString()}>
        {slots.map((slot, slotIndex) => {
          const slotStart = new Date(+dayStart + slotIndex * 1_800_000);
          return <button className="slot" aria-label={t("Забронювати {0} {1}", format(dayStart, {
            weekday: 'long'
          }), time(slotStart.toISOString()))} onClick={() => onSlotClick(slotStart)} onDragOver={event => event.preventDefault()} onDrop={event => {
            event.preventDefault();
            const id = Number(event.dataTransfer.getData('text/plain'));
            const booking = bookings.find(item => item.id === id);
            if (booking && booking.user_id === user.id) onMove(booking, slotStart);
          }} key={slot} />;
        })}
        {nowTop >= 0 && nowTop < 780 && <div className="now-line" style={{
          top: nowTop
        }} />}
        {events.map(booking => {
          const top = (+new Date(booking.starts_at) - +dayStart) / 1_800_000 * 39 + 2;
          const height = (+new Date(booking.ends_at) - +new Date(booking.starts_at)) / 1_800_000 * 39 - 4;
          const isOwn = booking.user_id === user.id;
          const isOwnFuture = isOwn && new Date(booking.starts_at) > now;
          const moveLabel = t("{0}. {1}–{2}. Натисніть або натисніть Enter, щоб перенести.", t(booking.title), time(booking.starts_at), time(booking.ends_at));
          const eventMeta = isOwn ? isOwnFuture ? t("Ваша · ↕ перенести") : t("Ваша зустріч") : `🔒 ${t(booking.author)}`;
          return <div className={`event ${isOwn ? 'own' : ''} ${isOwnFuture ? 'movable' : ''}`} style={{
            top,
            height
          }} title={isOwnFuture ? t("{0} · перетягніть або натисніть для перенесення", t(booking.title)) : `${t(booking.title)} · ${isOwn ? t("ваша зустріч") : t("зайнято: {0}", t(booking.author))}`} draggable={isOwnFuture} role={isOwnFuture ? 'button' : undefined} tabIndex={isOwnFuture ? 0 : undefined} aria-label={isOwnFuture ? moveLabel : undefined} onDragStart={event => {
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', String(booking.id));
          }} onKeyDown={event => {
            if (isOwnFuture && (event.key === 'Enter' || event.key === ' ')) {
              event.preventDefault();
              onEdit(booking);
            }
          }} onClick={() => {
            if (isOwnFuture) onEdit(booking);
          }} key={booking.id}><b>{t(booking.title)}</b><small>{time(booking.starts_at)}–{time(booking.ends_at)} · {eventMeta}</small></div>;
        })}
      </div>;
    })}
  </div>;
}
function MobileAgenda({
  bookings,
  week,
  user,
  onSlotClick,
  onEdit
}: {
  bookings: Booking[];
  week: Date;
  user: User;
  onSlotClick: (start: Date) => void;
  onEdit: (booking: Booking) => void;
}) {
  const days = Array.from({
    length: 7
  }, (_, index) => plusDays(week, index));
  const starts = days.map(day => officeUtc(day, 9));
  const todayIndex = starts.findIndex(start => start.toDateString() === new Date().toDateString());
  const [activeIndex, setActiveIndex] = useState(todayIndex >= 0 ? todayIndex : 0);
  useEffect(() => {
    setActiveIndex(todayIndex >= 0 ? todayIndex : 0);
  }, [week.toISOString()]);
  const dayStart = starts[activeIndex];
  const slots = Array.from({
    length: 20
  }, (_, index) => new Date(+dayStart + index * 1_800_000));
  const dayBookings = bookings.filter(booking => {
    const start = new Date(booking.starts_at);
    return start >= dayStart && start < new Date(+dayStart + 36_000_000);
  });
  return <section className="mobile-agenda" aria-label={t("Денний розклад")}>
    <div className="mobile-days">{starts.map((start, index) => <button className={index === activeIndex ? 'active' : ''} onClick={() => setActiveIndex(index)} key={start.toISOString()}><b>{format(start, {
            weekday: 'short'
          })}</b><span>{format(start, {
            day: 'numeric'
          })}</span></button>)}</div>
    <div className="mobile-agenda-title"><div><b>{format(dayStart, {
            weekday: 'long',
            day: 'numeric',
            month: 'long'
          })}</b><small>{t("Натисніть вільний час, щоб забронювати, або свою картку — щоб перенести")}</small></div></div>
    <div className="mobile-slots">{slots.map(slot => {
        const booking = dayBookings.find(item => new Date(item.starts_at) <= slot && new Date(item.ends_at) > slot);
        const startsHere = booking && +new Date(booking.starts_at) === +slot;
        if (booking && startsHere) {
          const ownFuture = booking.user_id === user.id && new Date(booking.starts_at) > new Date();
          return <button className={`mobile-event ${booking.user_id === user.id ? 'own' : ''}`} onClick={() => ownFuture && onEdit(booking)} key={slot.toISOString()}><span>{time(booking.starts_at)}–{time(booking.ends_at)}</span><b>{t(booking.title)}</b><small>{ownFuture ? t("Натисніть, щоб перенести") : booking.user_id === user.id ? t("Ваша зустріч") : `🔒 ${t(booking.author)}`}</small></button>;
        }
        if (booking) return <div className="mobile-busy" key={slot.toISOString()}><span>{time(slot.toISOString())}</span><small>{t("Зайнято")}</small></div>;
        const past = slot <= new Date();
        return <button className="mobile-free" disabled={past} onClick={() => onSlotClick(slot)} key={slot.toISOString()}><span>{time(slot.toISOString())}</span><b>{past ? t("Минулий час") : t("+ Вільний слот")}</b></button>;
      })}</div>
  </section>;
}
function MoveBookingForm({
  booking,
  rooms,
  onClose,
  onDone
}: {
  booking: Booking;
  rooms: Room[];
  onClose: () => void;
  onDone: (startsAt: Date, roomId: number, endsAt: Date) => Promise<void>;
}) {
  const [form, setForm] = useState({
    roomId: booking.room_id,
    start: toInputValue(new Date(booking.starts_at)),
    end: toInputValue(new Date(booking.ends_at))
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const startsAt = new Date(form.start);
    const endsAt = new Date(form.end);
    if (endsAt <= startsAt) {
      setError(t("Кінець має бути пізніше за початок"));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onDone(startsAt, form.roomId, endsAt);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return <div className="modal"><form onSubmit={submit} className="booking move-form"><button type="button" className="close" aria-label={t("Закрити")} onClick={onClose}>×</button>
    <p className="eyebrow">{t("ПЕРЕНЕСЕННЯ ЗУСТРІЧІ")}</p><h2>{t(booking.title)}</h2><p className="muted">{t("На комп’ютері цю картку також можна перетягнути у вільний слот.")}</p>
    <label>{t("Кімната")}<select value={form.roomId} onChange={event => setForm({
          ...form,
          roomId: Number(event.target.value)
        })}>{rooms.map(room => <option value={room.id} key={room.id}>{t(room.name)}{t(" · до ")}{room.capacity}</option>)}</select></label>
    <div className="twocol"><label>{t("Початок")}<input type="datetime-local" step="1800" value={form.start} onChange={event => setForm({
            ...form,
            start: event.target.value
          })} /></label><label>{t("Кінець")}<input type="datetime-local" step="1800" value={form.end} onChange={event => setForm({
            ...form,
            end: event.target.value
          })} /></label></div>
    {error && <p className="error">{feedback(error)}</p>}<button disabled={busy}>{busy ? t("Переносимо…") : t("Підтвердити перенесення")}</button>
  </form></div>;
}
function SmartFinder({
  week,
  onClose,
  onPick
}: {
  week: Date;
  onClose: () => void;
  onPick: (room: Room, startsAt: Date, endsAt: Date) => void;
}) {
  const suggestedStart = suggestedBookingStart(week);
  const [form, setForm] = useState({
    start: toInputValue(suggestedStart),
    duration: 60,
    capacity: 0
  });
  const [state, setState] = useState<LoadState | 'idle'>('idle');
  const [results, setResults] = useState<AvailableRoom[]>([]);
  const [error, setError] = useState('');
  async function search(event: React.FormEvent) {
    event.preventDefault();
    const startsAt = new Date(form.start);
    if (Number.isNaN(+startsAt)) {
      setError(t("Оберіть коректний час"));
      return;
    }
    const endsAt = new Date(+startsAt + form.duration * 60_000);
    setState('loading');
    setError('');
    try {
      const query = new URLSearchParams({
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        capacity: String(form.capacity)
      });
      setResults(await api<AvailableRoom[]>(`/rooms/availability?${query}`));
      setState('ready');
    } catch (reason) {
      setError((reason as Error).message);
      setState('error');
    }
  }
  const selectedStart = new Date(form.start);
  const selectedEnd = new Date(+selectedStart + form.duration * 60_000);
  const hasSelectedTime = !Number.isNaN(+selectedStart);
  return <div className="modal"><section className="booking finder"><button type="button" className="close" aria-label={t("Закрити")} onClick={onClose}>×</button>
    <p className="eyebrow">SMART ROOM MATCH</p><h2>{t("Знайти вільну кімнату")}</h2><p className="muted">{t("Вкажіть час і кількість людей — RoomFlow перевірить конфлікти та запропонує найкращий варіант.")}</p>
    <form onSubmit={search}><label>{t("Початок")}<input type="datetime-local" step="1800" value={form.start} onChange={event => setForm({
            ...form,
            start: event.target.value
          })} /></label>
    <div className="twocol"><label>{t("Тривалість")}<select value={form.duration} onChange={event => setForm({
              ...form,
              duration: Number(event.target.value)
            })}>{[30, 60, 90, 120, 180, 240].map(minutes => <option value={minutes} key={minutes}>{minutes < 60 ? t("30 хв") : `${minutes / 60} ${minutes === 60 ? t("година") : t("години")}`}</option>)}</select></label><label>{t("Учасники")}<select value={form.capacity} onChange={event => setForm({
              ...form,
              capacity: Number(event.target.value)
            })}><option value="0">{t("Будь-яка")}</option><option value="4">{t("Від 4 осіб")}</option><option value="6">{t("Від 6 осіб")}</option><option value="10">{t("Від 10 осіб")}</option><option value="15">{t("Від 15 осіб")}</option></select></label></div>
    <small>{hasSelectedTime ? t("Шукаємо на {0}–{1} у вашому часовому поясі.", time(selectedStart.toISOString()), time(selectedEnd.toISOString())) : t("Оберіть коректний час для пошуку.")}</small>{error && <p className="error">{feedback(error)}</p>}<button disabled={state === 'loading'}>{state === 'loading' ? t("Перевіряємо доступність…") : t("Знайти вільні кімнати")}</button></form>
    {state === 'ready' && <div className="finder-results" aria-live="polite">{results.length ? <><p><b>{results.length}</b> {results.length === 1 ? t("варіант знайдено") : t("варіанти знайдено")}</p>{results.map((room, index) => <article className={index === 0 ? 'best-match' : ''} key={room.id}>{index === 0 && <span className="match-label">{t("НАЙКРАЩИЙ ВАРІАНТ")}</span>}<div><b>{t(room.name)}</b><small>{t("Поверх {0} · до {1} осіб", room.floor, room.capacity)}</small></div><button type="button" onClick={() => onPick(room, selectedStart, selectedEnd)}>{t("Обрати")}</button></article>)}</> : <EmptyState compact text={t("На цей час вільних кімнат немає. Спробуйте інший час або меншу місткість.")} />}</div>}
  </section></div>;
}
function BookingForm({
  rooms,
  currentRoomId,
  week,
  initialStart,
  initialEnd,
  onClose,
  onDone
}: {
  rooms: Room[];
  currentRoomId: number;
  week: Date;
  initialStart: Date | null;
  initialEnd: Date | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const suggestedStart = suggestedBookingStart(week, initialStart);
  const suggestedEnd = initialEnd && initialEnd > suggestedStart ? initialEnd : new Date(+suggestedStart + 3_600_000);
  const [form, setForm] = useState({
    roomId: currentRoomId,
    title: '',
    start: toInputValue(suggestedStart),
    end: toInputValue(suggestedEnd),
    repeatWeeks: 1
  });
  const [errors, setErrors] = useState<{
    title?: string;
    time?: string;
  }>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const nextErrors: {
      title?: string;
      time?: string;
    } = {};
    if (!form.title.trim()) nextErrors.title = t("Введіть назву зустрічі");
    if (new Date(form.end) <= new Date(form.start)) nextErrors.time = t("Кінець має бути пізніше за початок");
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{
        count: number;
      }>('/bookings', {
        method: 'POST',
        body: JSON.stringify({
          roomId: form.roomId,
          title: form.title,
          startsAt: new Date(form.start).toISOString(),
          endsAt: new Date(form.end).toISOString(),
          repeatWeeks: form.repeatWeeks
        })
      });
      onDone(result.count > 1 ? t("Створено серію з {0} бронювань.", result.count) : t("Бронювання створено."));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return <div className="modal"><form onSubmit={submit} className="booking"><button type="button" className="close" aria-label={t("Закрити")} onClick={onClose}>×</button>
    <p className="eyebrow">{t("НОВЕ БРОНЮВАННЯ")}</p><h2>{t("Забронювати кімнату")}</h2>
    <label>{t("Кімната")}<select value={form.roomId} onChange={event => setForm({
          ...form,
          roomId: Number(event.target.value)
        })}>{rooms.map(room => <option value={room.id} key={room.id}>{t(room.name)}{t(" · до ")}{room.capacity}</option>)}</select></label>
    <label>{t("Назва зустрічі")}<input required maxLength={100} value={form.title} placeholder={t("Наприклад, Планування релізу")} onChange={event => {
          setForm({
            ...form,
            title: event.target.value
          });
          setErrors({
            ...errors,
            title: undefined
          });
        }} />{errors.title && <span className="field-error">{feedback(errors.title)}</span>}</label>
    <div className="twocol"><label>{t("Початок")}<input type="datetime-local" step="1800" value={form.start} onChange={event => {
            setForm({
              ...form,
              start: event.target.value
            });
            setErrors({
              ...errors,
              time: undefined
            });
          }} /></label><label>{t("Кінець")}<input type="datetime-local" step="1800" value={form.end} onChange={event => {
            setForm({
              ...form,
              end: event.target.value
            });
            setErrors({
              ...errors,
              time: undefined
            });
          }} /></label></div>
    {errors.time && <span className="field-error">{feedback(errors.time)}</span>}
    <label>{t("Повторення")}<select value={form.repeatWeeks} onChange={event => setForm({
          ...form,
          repeatWeeks: Number(event.target.value)
        })}>{Array.from({
            length: 8
          }, (_, index) => <option value={index + 1} key={index}>{index ? t("Щотижня · {0} разів", index + 1) : t("Не повторювати")}</option>)}</select></label>
    <small>{t("Робочі години офісу: 09:00–19:00 Europe/Kyiv")}</small>{error && <p className="error">{feedback(error)}</p>}<button disabled={busy}>{busy ? t("Перевіряємо…") : t("Підтвердити бронювання")}</button>
  </form></div>;
}
function MyBookings({
  user,
  onOpen,
  onChanged
}: {
  user: User;
  onOpen: (booking: Booking) => void;
  onChanged: () => void;
}) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [pastLimit, setPastLimit] = useState(5);
  async function load() {
    setState('loading');
    try {
      setBookings(await api<Booking[]>('/my-bookings'));
      setState('ready');
    } catch {
      setState('error');
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function cancel(booking: Booking, series = false) {
    if (!confirm(series ? t("Скасувати всю серію «{0}»?", t(booking.title)) : t("Скасувати «{0}»?", t(booking.title)))) return;
    try {
      await api(`/bookings/${booking.id}${series ? '?scope=series' : ''}`, {
        method: 'DELETE'
      });
      setBookings(series ? bookings.filter(item => item.series_id !== booking.series_id) : bookings.filter(item => item.id !== booking.id));
      onChanged();
    } catch (reason) {
      alert((reason as Error).message);
    }
  }
  const future = bookings.filter(booking => new Date(booking.ends_at) > new Date());
  const past = bookings.filter(booking => new Date(booking.ends_at) <= new Date()).reverse();
  return <main className="my"><p className="eyebrow">{t("ОСОБИСТИЙ РОЗКЛАД")}</p><h1>{t("Мої бронювання")}</h1>
    {state === 'loading' && <CalendarSkeleton />}
    {state === 'error' && <EmptyState text={t("Не вдалося завантажити ваші бронювання.")} action={t("Повторити")} onAction={load} />}
    {state === 'ready' && <><h3>{t("Майбутні · ")}{future.length}</h3>{future.length ? future.map(booking => <BookingCard booking={booking} onOpen={onOpen} onCancel={cancel} key={booking.id} />) : <p className="empty">{t("Наступних бронювань немає. Саме час щось запланувати.")}</p>}
      <h3>{t("Минулі · ")}{past.length}</h3>{past.slice(0, pastLimit).map(booking => <BookingCard booking={booking} onOpen={onOpen} past key={booking.id} />)}{past.length > pastLimit && <button className="more" onClick={() => setPastLimit(pastLimit + 5)}>{t("Показати ще")}</button>}</>}
  </main>;
}
function BookingCard({
  booking,
  onOpen,
  onCancel,
  past = false
}: {
  booking: Booking;
  onOpen: (booking: Booking) => void;
  onCancel?: (booking: Booking, series?: boolean) => void;
  past?: boolean;
}) {
  return <article className={past ? 'past' : ''} onClick={() => onOpen(booking)}><div className="date">{format(new Date(booking.starts_at), {
        day: '2-digit',
        month: 'short'
      })}<small>{time(booking.starts_at)}</small></div><div><b>{t(booking.title)}</b><p>{t(booking.room)} · {past ? `${time(booking.starts_at)}–${time(booking.ends_at)}` : t("до зустрічі {0}", time(booking.ends_at))}{booking.series_id && t(" · щотижня")}</p></div>{onCancel && <><button onClick={event => {
        event.stopPropagation();
        onCancel(booking);
      }}>{t("Скасувати")}</button>{booking.series_id && <button className="series" onClick={event => {
        event.stopPropagation();
        onCancel(booking, true);
      }}>{t("Всю серію")}</button>}</>}</article>;
}
function EmptyState({
  text,
  action,
  onAction,
  compact = false
}: {
  text: string;
  action?: string;
  onAction?: () => void;
  compact?: boolean;
}) {
  return <div className={`empty-state ${compact ? 'compact' : ''}`}><p>{text}</p>{action && <button onClick={onAction}>{action}</button>}</div>;
}
function RoomSkeleton() {
  return <div className="room-skeleton">{Array.from({
      length: 5
    }, (_, index) => <span key={index} />)}</div>;
}
function CalendarSkeleton() {
  return <div className="calendar-skeleton"><span /><span /><span /><span /><span /><span /></div>;
}
createRoot(document.getElementById('root')!).render(<App />);
