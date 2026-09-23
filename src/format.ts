/** Dates as a person reads them, in one place so every screen agrees. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n: number) => String(n).padStart(2, '0');

/** "Today 14:30", "12 Mar", "12 Mar 2024" — as short as it can be and still be unambiguous. */
export function fmtWhen(ms?: number | null): string {
  if (!ms) return '';
  const d = new Date(ms);
  const now = new Date();
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const sameDay =
    d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  if (sameDay) return `Today ${time}`;
  const stem = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  if (d.getFullYear() !== now.getFullYear()) return `${stem} ${d.getFullYear()}`;
  return `${stem} · ${time}`;
}
