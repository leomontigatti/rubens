// The office's zone is America/Argentina/Buenos_Aires, UTC-3 all year, so a fixed
// offset is enough for the prototype; rubens derives it with @date-fns/tz.
export const officeOffset = "-03:00";
const dayMs = 86_400_000;

export function mondayOf(date: string | undefined): string {
  const base = date
    ? new Date(`${date}T12:00:00${officeOffset}`)
    : new Date(Date.now() - 3 * 3_600_000);
  const day = (base.getUTCDay() + 6) % 7;
  return new Date(base.getTime() - day * dayMs).toISOString().slice(0, 10);
}

export function weekBounds(monday: string) {
  const from = Date.parse(`${monday}T00:00:00${officeOffset}`);
  return { from, to: from + 7 * dayMs };
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * dayMs).toISOString().slice(0, 10);
}

/** Local `YYYY-MM-DD` and `HH:MM` of an instant in the office's zone. */
export function local(instant: number) {
  const shifted = new Date(instant - 3 * 3_600_000).toISOString();
  return { day: shifted.slice(0, 10), time: shifted.slice(11, 16) };
}

export function instant(day: string, time: string): number {
  return Date.parse(`${day}T${time}:00${officeOffset}`);
}
