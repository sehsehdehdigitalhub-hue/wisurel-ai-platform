// supabase/functions/_shared/dedupe.ts
// Same fuzzy-matching rules as the client-side dedup in app.html
// (findDuplicateTransaction / wordOverlap) — kept in sync deliberately so a
// receipt processed live in the browser and one processed by the background
// queue get judged as duplicates the same way.

export function crudeStem(w: string): string {
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (w.endsWith("es") && w.length > 4) return w.slice(0, -2);
  if (w.endsWith("ing") && w.length > 5) return w.slice(0, -3);
  if (w.endsWith("ed") && w.length > 4) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) return w.slice(0, -1);
  return w;
}

export function wordOverlap(a: string, b: string): number {
  const wa = new Set((a || "").toLowerCase().split(/\W+/).filter((w) => w.length > 2).map(crudeStem));
  const wb = new Set((b || "").toLowerCase().split(/\W+/).filter((w) => w.length > 2).map(crudeStem));
  if (!wa.size || !wb.size) return 0;
  let hit = 0;
  wa.forEach((w) => { if (wb.has(w)) hit++; });
  return hit / Math.min(wa.size, wb.size);
}

function parseFlexibleDate(s: string): Date | null {
  const m = String(s ?? "").match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!m) return null;
  let [, d, mo, y] = m;
  if (y.length === 2) y = "20" + y;
  return new Date(+y, +mo - 1, +d);
}

// `existing` is a list of `workflow_rows` records (each with a `.data` object)
// or plain row objects — either shape works.
export function isDuplicateRow(row: any, existing: any[]): boolean {
  const rDate = parseFlexibleDate(row.date);
  const rAmt = parseFloat(row.amount) || 0;
  return existing.some((t) => {
    const data = t.data ?? t;
    const tAmt = parseFloat(data.amount) || 0;
    if (Math.abs(tAmt - rAmt) > 1) return false;
    const tDate = parseFlexibleDate(data.date);
    const dayDiff = rDate && tDate ? Math.abs((rDate.getTime() - tDate.getTime()) / 86400000) : 99;
    if (dayDiff > 1) return false; // same day or adjacent (timezone edge cases)
    const sim = wordOverlap(row.description ?? row.sender ?? "", data.description ?? data.sender ?? "");
    return sim >= 0.5;
  });
}
