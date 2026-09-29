export const overlaps = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => aStart < bEnd && aEnd > bStart;

function partsInKyiv(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const number = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: number('year'), month: number('month'), day: number('day'),
    hour: number('hour'), minute: number('minute'), second: number('second'),
  };
}

/** Returns the same office-wall-clock time after a number of weekly repetitions. */
export function officeWeek(start: Date, weeks: number) {
  const source = partsInKyiv(start);
  const target = Date.UTC(source.year, source.month - 1, source.day + weeks * 7, source.hour, source.minute, source.second);
  let result = new Date(target);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const shown = partsInKyiv(result);
    result = new Date(+result + (target - Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute, shown.second)));
  }
  return result;
}

export function validateInterval(start: Date, end: Date) {
  if (Number.isNaN(+start) || Number.isNaN(+end) || end <= start) return 'Некоректний інтервал часу';
  if (start.getUTCSeconds() || end.getUTCSeconds() || start.getUTCMilliseconds() || end.getUTCMilliseconds()) {
    return 'Час має бути кратний 30 хвилинам';
  }

  const durationMinutes = (+end - +start) / 60_000;
  if (durationMinutes < 30 || durationMinutes > 240 || durationMinutes % 30) {
    return 'Тривалість має бути від 30 хвилин до 4 годин';
  }
  if (start <= new Date()) return 'Можна бронювати лише майбутній час';

  const starts = partsInKyiv(start);
  const ends = partsInKyiv(end);
  const startsOutsideHours = starts.minute % 30 || starts.hour < 9 || starts.hour >= 19;
  const endsOutsideHours = ends.minute % 30 || ends.hour > 19 || (ends.hour === 19 && ends.minute > 0);
  if (startsOutsideHours || endsOutsideHours) {
    return 'Бронювання можливе лише у робочі години 09:00-19:00 (Київ)';
  }
  return null;
}
