// supabase/functions/weekly-digest/index.ts
// Scheduled version of the digest — computes it and pushes to every
// registered recipient automatically, every Monday, with no one needing to
// open the app. For the on-demand version (operator taps a button, or the
// boss just asks for it), see send-report/ and the boss-trigger logic in
// whatsapp-webhook/.
//
// Deploy: supabase functions deploy weekly-digest
// Schedule (Supabase SQL editor), e.g. every Monday 7am:
//   select cron.schedule('wisurel-weekly-digest', '0 7 * * 1', $$
//     select net.http_post(
//       url := 'https://YOUR_PROJECT.functions.supabase.co/weekly-digest',
//       headers := '{"Content-Type":"application/json"}'::jsonb
//     );
//   $$);
// Sends to every row in `report_recipients` where auto_weekly = true —
// manage that list from the app's Settings page, not via secrets, so
// adding/removing a recipient doesn't need a redeploy.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computeDigest, digestToWhatsAppText, digestToEmailHtml } from "../_shared/digest.ts";
import { sendWhatsAppText, sendEmail } from "../_shared/notify.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ORG_ID = Deno.env.get("WISUREL_ORG_ID")!;
const BIZ_NAME = Deno.env.get("BIZ_NAME") ?? "Wisurel Ogbomosho Farm";

serve(async (_req) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const digest = await computeDigest(supabase, ORG_ID, weekAgo);
  const waText = digestToWhatsAppText(digest, BIZ_NAME, "Weekly Digest");
  const emailHtml = digestToEmailHtml(digest, BIZ_NAME, "Weekly Digest");

  const { data: recipients } = await supabase
    .from("report_recipients")
    .select("*")
    .eq("org_id", ORG_ID)
    .eq("auto_weekly", true);

  const results: { recipient: string; channel: string; ok: boolean; error?: string }[] = [];
  for (const r of recipients ?? []) {
    const result = r.channel === "email"
      ? await sendEmail(r.contact, `${BIZ_NAME} — Weekly Digest`, emailHtml)
      : await sendWhatsAppText(r.contact, waText);
    results.push({ recipient: r.contact, channel: r.channel, ...result });
  }

  return new Response(JSON.stringify({ sent: results, total: digest.total, txCount: digest.txCount }), {
    headers: { "content-type": "application/json" },
  });
});
