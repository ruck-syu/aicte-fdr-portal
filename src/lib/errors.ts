/** Turns a Supabase/Postgres error into a message safe to show users. */
export function friendlyError(error: { message?: string; code?: string } | null | undefined): string {
  if (!error) return "Something went wrong.";
  const msg = error.message ?? "";
  if (error.code === "42501" || /row-level security/i.test(msg)) {
    return "You don't have permission to do that.";
  }
  if (error.code === "23505") return "A record with these details already exists.";
  if (error.code === "23514" && /profile_scope/.test(msg)) {
    return "Institute users need an institution and regional officers need a region.";
  }
  if (error.code === "P0001" || error.code === undefined || /^[A-Z]/.test(msg)) return msg;
  return msg || "Something went wrong.";
}
