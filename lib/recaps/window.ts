export interface DateWindow {
  start: Date;
  end: Date;
}

export function yearWindow(year: number): DateWindow {
  return {
    start: new Date(Date.UTC(year, 0, 1)),
    end: new Date(Date.UTC(year + 1, 0, 1)),
  };
}

export function monthWindow(year: number, monthIndex: number): DateWindow {
  // monthIndex is 1-12 (human-readable). new Date.UTC takes 0-11 (JS).
  if (monthIndex < 1 || monthIndex > 12) {
    throw new RangeError(`monthIndex must be 1-12, got ${monthIndex}`);
  }
  const jsMonthZero = monthIndex - 1;
  return {
    start: new Date(Date.UTC(year, jsMonthZero, 1)),
    end: new Date(Date.UTC(year, jsMonthZero + 1, 1)),
  };
}
