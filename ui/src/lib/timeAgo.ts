import { screenText } from "../i18n/value-labels";

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;

export function timeAgo(date: Date | string): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const seconds = Math.round((now - then) / 1000);

  if (seconds < MINUTE) return screenText("time.justNow");
  if (seconds < HOUR) {
    const m = Math.floor(seconds / MINUTE);
    return screenText("time.minutes", { count: m });
  }
  if (seconds < DAY) {
    const h = Math.floor(seconds / HOUR);
    return screenText("time.hours", { count: h });
  }
  if (seconds < WEEK) {
    const d = Math.floor(seconds / DAY);
    return screenText("time.days", { count: d });
  }
  if (seconds < MONTH) {
    const w = Math.floor(seconds / WEEK);
    return screenText("time.weeks", { count: w });
  }
  const mo = Math.floor(seconds / MONTH);
  return screenText("time.months", { count: mo });
}
