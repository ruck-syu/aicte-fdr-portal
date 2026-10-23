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

export function daysLabel(days: number) {
  if (days === 0) return "today";
  if (days > 0) return `in ${days} day${days === 1 ? "" : "s"}`;
  return `${-days} day${days === -1 ? "" : "s"} ago`;
}

export function displayName(p: { full_name?: string | null; email?: string | null } | null | undefined) {
  if (!p) return "System";
  return p.full_name || p.email || "Unknown";
}
