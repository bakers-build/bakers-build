const DAY = 86_400_000;

export function civilDate(value: string): number {
  const time = Date.parse(`${value}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(time) ||
    new Date(time).toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`Invalid civil date: ${value}`);
  }
  return time;
}

export function shiftDate(date: string, days: number): string {
  return new Date(civilDate(date) + days * DAY).toISOString().slice(0, 10);
}

export function selectedDates(from: string, to: string): string[] {
  const count = (civilDate(to) - civilDate(from)) / DAY + 1;
  if (count < 1 || count > 366)
    throw new Error('Select between 1 and 366 civil dates.');
  return Array.from({ length: count }, (_, i) => shiftDate(from, i));
}

export function calendar(timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const dateAt = (time: number) => {
    const parts = formatter.formatToParts(time);
    return ['year', 'month', 'day']
      .map((type) => parts.find((part) => part.type === type)?.value)
      .join('-');
  };
  const cache = new Map<string, number>();
  const boundary = (date: string): number => {
    const cached = cache.get(date);
    if (cached !== undefined) return cached;
    // Find the first local instant, including zones whose clocks skip midnight.
    const utc = civilDate(date);
    let low = utc - 2 * DAY;
    let high = utc + 2 * DAY;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (dateAt(middle) < date) low = middle;
      else high = middle;
    }
    if (dateAt(high) !== date)
      throw new Error(`Civil date ${date} does not exist in ${timezone}.`);
    cache.set(date, high);
    return high;
  };
  return { dateAt, boundary };
}
