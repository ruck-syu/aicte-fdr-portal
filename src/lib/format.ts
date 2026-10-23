const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const inrCompact = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });
const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const dateTimeFmt = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

export function formatINR(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  return inr.format(Number(value));
}

export function formatINRCompact(value: number | string | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `₹${inrCompact.format(Number(value))}`;
}

/** Accepts 'YYYY-MM-DD' (treated as a calendar date) or ISO timestamps. */
export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const d = value.length === 10 ? new Date(`${value}T00:00:00+05:30`) : new Date(value);
  return dateFmt.format(d);
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return dateTimeFmt.format(new Date(value));
}

export function formatBytes(bytes: number | null | undefined) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Whole days between an ISO timestamp and now; null when there is no timestamp. */
export function daysSince(value: string | null | undefined) {
  if (!value) return null;
  const ms = Date.now() - new Date(value).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/** Whole days a due date is in the past (0 when it is today or still ahead). */
export function daysOverdue(due: string | null | undefined) {
  if (!due) return null;
  const end = due.length === 10 ? new Date(`${due}T00:00:00+05:30`) : new Date(due);
  const ms = Date.now() - end.getTime();
  return ms > 0 ? Math.floor(ms / 86_400_000) : 0;
}

export function daysLabel(days: number) {
  if (days === 0) return "today";
  if (days > 0) return `in ${days} day${days === 1 ? "" : "s"}`;
  return `${-days} day${days === -1 ? "" : "s"} ago`;
}

export function displayName(p: { full_name?: string | null; email?: string | null } | null | undefined) {
  if (!p) return "System";
  return p.full_name || p.email || "Unknown";
}
