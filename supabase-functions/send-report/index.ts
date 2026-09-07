// supabase/functions/send-report/index.ts
// The operator taps "Send to Boss" in the app — this is what that button
// calls. Unlike weekly-digest (scheduled, sends to everyone auto-subscribed),
// this sends ONE report to ONE recipient, right now, on request. Used for
// "the CEO just asked for it" moments that don't fit a weekly schedule.
//
// Deploy: supabase functions deploy send-report
// No extra secrets beyond what ai-proxy/weekly-digest already use
// (WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, RESEND_API_KEY).
//
// POST body: { org_id, period: "today"|"week", channel: "whatsapp"|"email", recipient }
// `recipient` overrides the stored contact if provided — lets an operator
// send to someone one-off without adding them to report_recipients.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computeDigest, digestToWhatsAppText, digestToEmailHtml } from "../_shared/digest.ts";
import { sendWhatsAppText, sendEmail } from "../_shared/notify.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BIZ_NAME = Deno.env.get("BIZ_NAME") ?? "Wisurel Ogbomosho Farm";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const { org_id, period = "week", channel, recipient } = body;
    if (!org_id || !channel || !recipient) {
      return new Response(JSON.stringify({ error: "org_id, channel, and recipient are required" }), {
        status: 400,
        headers: { ...CORS, "content-type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
    const sinceISO = new Date(Date.now() - (period === "today" ? 1 : 7) * 86400000).toISOString();
    const periodLabel = period === "today" ? "Today's Report" : "Weekly Digest";

    const digest = await computeDigest(supabase, org_id, sinceISO);

    const result = channel === "email"
      ? await sendEmail(recipient, `${BIZ_NAME} — ${periodLabel}`, digestToEmailHtml(digest, BIZ_NAME, periodLabel))
      : await sendWhatsAppText(recipient, digestToWhatsAppText(digest, BIZ_NAME, periodLabel));

    if (!result.ok) {
      return new Response(JSON.stringify({ error: result.error }), {
        status: 502,
        headers: { ...CORS, "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ sent: true, channel, recipient, total: digest.total, txCount: digest.txCount }), {
      headers: { ...CORS, "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...CORS, "content-type": "application/json" },
    });
  }
});
