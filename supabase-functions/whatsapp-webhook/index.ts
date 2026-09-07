// supabase/functions/whatsapp-webhook/index.ts
// Receives inbound WhatsApp messages (Meta WhatsApp Cloud API).
//
// Two behaviors, routed by who's messaging:
// 1. STAFF sending a daily report → summarized with AI, stored, appears on
//    the app's "Daily Reports" page in real time.
// 2. A registered recipient in `report_recipients` (e.g. the boss) sending
//    a trigger word like "report" or "status" → gets the current digest
//    texted straight back, instantly, no app needed on their end.
//
// Deploy:  supabase functions deploy whatsapp-webhook --no-verify-jwt
// Secrets: supabase secrets set WHATSAPP_VERIFY_TOKEN=<your-chosen-string>
//          supabase secrets set WHATSAPP_ACCESS_TOKEN=<from Meta App dashboard>
//          supabase secrets set WHATSAPP_PHONE_NUMBER_ID=<from Meta App dashboard>
//          MODEL_API_KEY must already be set (shared with ai-proxy)
//
// Meta setup (free): developers.facebook.com → your app → WhatsApp →
// Configuration → Webhook URL = this function's URL, Verify token = the
// same string as WHATSAPP_VERIFY_TOKEN above. Subscribe to "messages".

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computeDigest, digestToWhatsAppText } from "../_shared/digest.ts";
import { sendWhatsAppText } from "../_shared/notify.ts";

const VERIFY_TOKEN = Deno.env.get("WHATSAPP_VERIFY_TOKEN")!;
const WA_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN")!;
const MODEL_API_KEY = Deno.env.get("MODEL_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ORG_ID = Deno.env.get("WISUREL_ORG_ID")!;
const BIZ_NAME = Deno.env.get("BIZ_NAME") ?? "Wisurel Ogbomosho Farm";

// Trigger words a registered recipient can send to get an instant digest.
// "today" anywhere in the message switches the period from this week to today.
const TRIGGER_WORDS = /^(report|status|digest|update|summary)\b/i;

serve(async (req) => {
  const url = new URL(req.url);

  // ---- Meta's webhook verification handshake (GET) ----
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  // ---- Inbound message events (POST) ----
  if (req.method === "POST") {
    try {
      const body = await req.json();
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

      const entry = body.entry?.[0]?.changes?.[0]?.value;
      const message = entry?.messages?.[0];
      if (!message) return new Response("ok", { status: 200 }); // status update, not a message

      const fromPhone = "+" + message.from;
      const contactName = entry?.contacts?.[0]?.profile?.name ?? "Unknown";

      // ---- Check: is this a registered recipient asking for the report? ----
      if (message.type === "text" && TRIGGER_WORDS.test(message.text.body.trim())) {
        const { data: recipient } = await supabase
          .from("report_recipients")
          .select("*")
          .eq("org_id", ORG_ID)
          .eq("channel", "whatsapp")
          .eq("contact", fromPhone)
          .maybeSingle();

        if (recipient) {
          const wantsToday = /\btoday\b/i.test(message.text.body);
          const sinceISO = new Date(Date.now() - (wantsToday ? 1 : 7) * 86400000).toISOString();
          const digest = await computeDigest(supabase, ORG_ID, sinceISO);
          const text = digestToWhatsAppText(digest, BIZ_NAME, wantsToday ? "Today's Report" : "Weekly Digest");
          await sendWhatsAppText(fromPhone, text);
          return new Response("ok", { status: 200 });
        }
        // Not a registered recipient — fall through and log as a normal message below.
      }

      // ---- Otherwise: treat as a staff daily report ----
      let { data: sender } = await supabase
        .from("whatsapp_senders")
        .select("*")
        .eq("org_id", ORG_ID)
        .eq("phone_number", fromPhone)
        .maybeSingle();

      if (!sender) {
        const { data: created } = await supabase
          .from("whatsapp_senders")
          .insert({ org_id: ORG_ID, phone_number: fromPhone, staff_name: contactName })
          .select()
          .single();
        sender = created;
      }

      let rawText = "";
      let mediaUrl: string | null = null;
      let mediaType: string | null = null;

      if (message.type === "text") {
        rawText = message.text.body;
      } else if (["image", "document"].includes(message.type)) {
        const mediaId = message[message.type].id;
        const metaRes = await fetch(`https://graph.facebook.com/v20.0/${mediaId}`, {
          headers: { Authorization: `Bearer ${WA_ACCESS_TOKEN}` },
        });
        const metaData = await metaRes.json();
        const fileRes = await fetch(metaData.url, {
          headers: { Authorization: `Bearer ${WA_ACCESS_TOKEN}` },
        });
        const fileBuf = await fileRes.arrayBuffer();
        const ext = message.type === "image" ? "jpg" : "pdf";
        const path = `daily-reports/${ORG_ID}/${Date.now()}.${ext}`;
        await supabase.storage.from("wisurel-files").upload(path, fileBuf, {
          contentType: metaData.mime_type,
        });
        mediaUrl = path;
        mediaType = metaData.mime_type;
        rawText = message[message.type].caption ?? "";
      }

      const { data: report } = await supabase
        .from("daily_reports")
        .insert({
          org_id: ORG_ID,
          sender_id: sender.id,
          staff_name: sender.staff_name,
          phone_number: fromPhone,
          raw_message: rawText,
          media_url: mediaUrl,
          media_type: mediaType,
          status: "received",
        })
        .select()
        .single();

      // Fire-and-forget AI summarization (don't block Meta's webhook response —
      // Meta expects a 200 within a few seconds or it retries).
      summarizeReport(supabase, report, rawText).catch((e) => console.error(e));

      await sendWhatsAppText(fromPhone, `✅ Report received, thanks ${sender.staff_name.split(" ")[0]}!`);

      return new Response("ok", { status: 200 });
    } catch (e) {
      console.error(e);
      return new Response("ok", { status: 200 }); // always 200 so Meta doesn't hammer retries
    }
  }

  return new Response("Method not allowed", { status: 405 });
});

async function summarizeReport(supabase: any, report: any, rawText: string) {
  const system = `You read daily field/operations reports from farm staff (sent via WhatsApp,
often informal or shorthand) for a business automation tool. Extract a short structured summary.
Respond with ONLY JSON: {"summary": "one paragraph, plain language", "tasks_done": string[],
"issues": string[], "stock_or_numbers_mentioned": string[]}`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": MODEL_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 600,
      system,
      messages: [{ role: "user", content: rawText || "(no text — media only)" }],
    }),
  });
  const data = await res.json();
  const text = (data.content?.map((c: any) => c.text || "").join("\n") ?? "{}").replace(/```json|```/g, "").trim();
  let parsed: any = {};
  try { parsed = JSON.parse(text); } catch { parsed = { summary: text }; }

  await supabase
    .from("daily_reports")
    .update({
      ai_summary: parsed.summary ?? null,
      ai_structured: parsed,
      status: "processed",
      processed_at: new Date().toISOString(),
    })
    .eq("id", report.id);
}
