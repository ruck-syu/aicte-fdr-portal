import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { smsProvider } from "@/lib/sms";

export const maxDuration = 60;

type Pending = {
  id: string;
  institution_id: string | null;
  deposit_id: string | null;
  audience: "all" | "institution" | "officials";
  severity: string;
  title: string;
  body: string | null;
};

type SmsRow = {
  notification_id: string;
  institution_id: string;
  phone: string;
  title: string;
  body: string | null;
  severity: string;
};

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Keeps the number usable as evidence without storing a full mobile number. */
function maskPhone(phone: string) {
  return phone.replace(/\d(?=(?:\D*\d){4})/g, "•");
}

/**
 * Daily job (Vercel Cron): generates maturity / lapse / escalation / overdue
 * alerts in the database, then delivers them — email when Resend is set up,
 * SMS to institutions that opted in. The two channels are independent: a
 * missing email key never stops the texts, and a failed text is retried by the
 * next run (the delivery log only suppresses notices already sent).
 */
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: created, error } = await admin.rpc("run_alerts");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Reconcile the escalation desk with the register: open a case for every
  // instrument that stayed lapsed, close the ones that were renewed or released.
  const { data: escalations, error: escalationError } = await admin.rpc("sync_escalations");
  if (escalationError) return NextResponse.json({ error: escalationError.message }, { status: 500 });

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.ALERT_FROM_EMAIL;
  let emailed = 0;
  let pending = 0;

  if (apiKey && from) {
    const since = new Date(Date.now() - 3 * 86400_000).toISOString();
    const { data } = await admin
      .from("notifications")
      .select("id, institution_id, deposit_id, audience, severity, title, body")
      .is("emailed_at", null)
      .gte("created_at", since)
      .not("institution_id", "is", null)
      .order("created_at")
      .limit(200);

    const items = (data ?? []) as Pending[];
    if (items.length > 0) {
      // Recipients: the institution's accounts officers, plus regional officers
      // for that region on warning / critical alerts (escalation path).
      const institutionIds = [...new Set(items.map((n) => n.institution_id!))];
      const [{ data: insts }, { data: users }] = await Promise.all([
        admin.from("institutions").select("id, region, contact_email").in("id", institutionIds),
        admin
          .from("profiles")
          .select("email, role, institution_id, region")
          .eq("is_active", true)
          .in("role", ["institute_user", "regional_officer"]),
      ]);
      const regionOf = new Map((insts ?? []).map((i) => [i.id as string, i.region as string]));
      const contactOf = new Map((insts ?? []).map((i) => [i.id as string, i.contact_email as string | null]));
      const appUrl =
        process.env.APP_URL ??
        (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");

      const sent: string[] = [];
      for (const n of items) {
        const to = new Set<string>();
        if (n.audience !== "officials") {
          for (const u of users ?? [])
            if (u.role === "institute_user" && u.institution_id === n.institution_id) to.add(u.email);
          const contact = contactOf.get(n.institution_id!);
          if (contact) to.add(contact);
        }
        if (n.audience !== "institution" && n.severity !== "info") {
          const region = regionOf.get(n.institution_id!);
          for (const u of users ?? []) if (u.role === "regional_officer" && u.region === region) to.add(u.email);
        }
        if (to.size === 0) {
          sent.push(n.id);
          continue;
        }
        const link = appUrl && n.deposit_id ? `${appUrl}/deposits/${n.deposit_id}` : appUrl ? `${appUrl}/notifications` : "";
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from,
            to: [...to],
            subject: `[AICTE FDR Portal] ${n.title}`,
            text: `${n.title}\n\n${n.body ?? ""}${link ? `\n\nOpen in portal: ${link}` : ""}`,
            html: `<p><strong>${escapeHtml(n.title)}</strong></p>${n.body ? `<p>${escapeHtml(n.body)}</p>` : ""}${
              link ? `<p><a href="${escapeHtml(link)}">Open in the AICTE FDR Portal</a></p>` : ""
            }`,
          }),
        });
        if (res.ok) {
          emailed++;
          sent.push(n.id);
        }
      }
      if (sent.length) {
        await admin.from("notifications").update({ emailed_at: new Date().toISOString() }).in("id", sent);
      }
      pending = items.length - sent.length;
    }
  }

  // SMS pass: independent of the email configuration above.
  const provider = smsProvider();
  let texted = 0;
  let smsFailed = 0;
  const since = new Date(Date.now() - 3 * 86400_000).toISOString();
  const { data: queue } = await admin.rpc("sms_queue", { p_since: since });
  for (const row of (queue ?? []) as SmsRow[]) {
    const outcome = await provider.send({
      to: row.phone,
      body: `${row.title}${row.body ? ` — ${row.body}` : ""} (AICTE FDR Portal)`,
    });
    // One row per (notice, channel, number): a retry updates the previous
    // attempt instead of appending another.
    await admin.from("notification_deliveries").upsert(
      {
        notification_id: row.notification_id,
        institution_id: row.institution_id,
        channel: "sms",
        destination: maskPhone(row.phone),
        provider: provider.name,
        status: outcome.status,
        provider_ref: outcome.reference ?? null,
        error: outcome.error ?? null,
        created_at: new Date().toISOString(),
      },
      { onConflict: "notification_id,channel,destination" },
    );
    if (outcome.status === "sent") texted++;
    else if (outcome.status === "failed") smsFailed++;
  }

  return NextResponse.json({
    created,
    escalations,
    emailed,
    pending,
    email: apiKey && from ? "enabled" : "disabled",
    sms: provider.name,
    texted,
    smsFailed,
  });
}
