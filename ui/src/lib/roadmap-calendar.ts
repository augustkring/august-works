export type RoadmapZoom = "day" | "week" | "month" | "quarter";
export const UTC_DAY_MS = 86_400_000;
export function utcDay(date: Date) { return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())); }
export function shiftCalendar(date: Date, zoom: RoadmapZoom, amount: number) {
  const next = utcDay(date);
  if (zoom === "day" || zoom === "week") next.setUTCDate(next.getUTCDate() + amount * (zoom === "week" ? 7 : 1));
  else { const day = next.getUTCDate(); next.setUTCDate(1); next.setUTCMonth(next.getUTCMonth() + amount * (zoom === "quarter" ? 3 : 1)); const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate(); next.setUTCDate(Math.min(day, last)); }
  return next;
}
export function roadmapCalendar(anchor: Date, zoom: RoadmapZoom) {
  let start = utcDay(anchor);
  if (zoom === "week") start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  if (zoom === "month" || zoom === "quarter") { start.setUTCDate(1); if (zoom === "quarter") start.setUTCMonth(Math.floor(start.getUTCMonth() / 3) * 3); }
  const count = zoom === "day" ? 42 : zoom === "week" ? 12 : zoom === "month" ? 12 : 8;
  const cells = Array.from({ length: count }, (_, i) => {
    const from = shiftCalendar(start, zoom, i), to = shiftCalendar(start, zoom, i + 1);
    const label = zoom === "quarter" ? `Q${Math.floor(from.getUTCMonth() / 3) + 1} ${from.getUTCFullYear()}` : from.toLocaleDateString(undefined, { timeZone: "UTC", ...(zoom === "day" || zoom === "week" ? { day: "numeric" as const } : {}), month: "short", ...(zoom === "month" ? { year: "numeric" as const } : {}) });
    return { from, to, label, key: from.toISOString() };
  });
  return { start, end: cells[cells.length - 1]!.to, cells };
}
export function roadmapSpan(cells: ReturnType<typeof roadmapCalendar>["cells"], start: string | null, end: string | null) {
  if (!start || !end || !cells.length) return null;
  const from = Date.parse(start), to = Date.parse(end);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || to < cells[0]!.from.getTime() || from >= cells[cells.length - 1]!.to.getTime()) return null;
  const first = Math.max(0, cells.findIndex((c) => from < c.to.getTime()));
  let last = cells.findIndex((c) => to < c.to.getTime()); if (last < 0) last = cells.length - 1;
  return { gridColumn: `${first + 1} / ${last + 2}`, clipped: from < cells[0]!.from.getTime() || to >= cells[cells.length - 1]!.to.getTime() };
}
export function shiftInstant(value: string, days: number) { return new Date(Date.parse(value) + days * UTC_DAY_MS).toISOString(); }
export function scheduleVarianceDays(planned: string | null, actual: string | null) { return planned && actual ? Math.round((Date.parse(actual) - Date.parse(planned)) / UTC_DAY_MS * 10) / 10 : null; }
