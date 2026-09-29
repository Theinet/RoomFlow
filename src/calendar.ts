/** Add calendar days rather than 24-hour blocks, preserving local time across DST. */
export function plusDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}
