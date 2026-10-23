import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AppRole, Institution, Profile } from "@/lib/types";

export interface SessionUser extends Profile {
  institution: Pick<Institution, "id" | "name" | "aicte_id" | "region"> | null;
}

/** Current user's profile, deduplicated per request. Null when signed out. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return null;
  const { data } = await supabase
    .from("profiles")
    .select("*, institution:institutions(id, name, aicte_id, region)")
    .eq("id", userId)
    .maybeSingle();
  return (data as SessionUser | null) ?? null;
});

/** Signed-in user with an active role, or redirect. */
export async function requireUser(): Promise<SessionUser & { role: AppRole }> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!user.role || !user.is_active) redirect("/pending");
  return user as SessionUser & { role: AppRole };
}

export async function requireRole(...roles: AppRole[]) {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/dashboard");
  return user;
}

export function isOfficial(role: AppRole | null | undefined) {
  return role === "regional_officer" || role === "aicte_verifier" || role === "admin";
}
