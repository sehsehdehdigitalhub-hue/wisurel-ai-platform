// supabase/functions/ai-proxy/index.ts
// Deno Edge Function — the ONLY place the model API key lives.
// The browser (app.html) never sees a key and never sees "Claude" or
// "Anthropic" in any response — this function reshapes everything into
// your own product's voice before returning it.
//
// Deploy:  supabase functions deploy ai-proxy
// Secret:  supabase secrets set MODEL_API_KEY=sk-ant-...
//
// Actions supported (POST body: { action, ...payload }):
//   "blueprint"    — turn a plain-English prompt into a sheet/column JSON blueprint
//   "chat"         — normal project chat turn
//   "extract"      — extract structured rows from an uploaded file's text, against a blueprint
//   "summary"      — human-readable summary of a project's data (for the share button)
//   "raw"          — passthrough for app.html: { system, content, max_tokens }, content is a
//                    full Anthropic content-block array (text/image/document). Used by the
//                    receipt extractor and chat so the client never talks to Anthropic directly.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MODEL_API_KEY = Deno.env.get("MODEL_API_KEY")!;
const MODEL_ENDPOINT = "https://api.anthropic.com/v1/messages";
const MODEL_NAME = "claude-sonnet-4-6"; // update as needed

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function callModel(system: string, userContent: string | unknown[], maxTokens = 2000) {
  const res = await fetch(MODEL_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": MODEL_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL_NAME,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: userContent }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Model call failed: ${res.status} ${err}`);
  }
  const data = await res.json();
  const text = data.content?.map((c: any) => c.text || "").join("\n") ?? "";
  const usage = data.usage ?? { input_tokens: 0, output_tokens: 0 };
  return { text, usage };
}

function stripJsonFence(text: string) {
  return text.replace(/```json|```/g, "").trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const { action, org_id, project_id } = body;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

    let result: any;
    let usage = { input_tokens: 0, output_tokens: 0 };

    if (action === "blueprint") {
      // Turn plain English into a sheet/column blueprint (Pillar 1)
      const system = `You design spreadsheet blueprints for a business automation tool called Wisurel AI.
Given the user's plain-English description of what they want to automate, respond with ONLY valid JSON,
no markdown fences, no preamble, in this exact shape:
{
  "workflow_name": string,
  "sheets": [ { "name": string, "columns": string[], "rows": [] } ]
}
Infer sensible sheets and columns even if the user is vague. Keep column names short and title-cased.`;
      const r = await callModel(system, body.prompt, 1500);
      usage = r.usage;
      result = JSON.parse(stripJsonFence(r.text));
    } else if (action === "chat") {
      // Normal project conversation
      const system = `You are the Wisurel AI assistant embedded in the Wisurel Ogbomosho Farm
automation platform. Never mention what model or company powers you. Be concise and practical,
speaking as part of the Wisurel team's own tooling.`;
      const r = await callModel(system, body.message, 1200);
      usage = r.usage;
      result = { reply: r.text };
    } else if (action === "extract") {
      // Extract structured rows from a file's text content against a blueprint
      const system = `Extract structured data from the provided document text to fill the given
spreadsheet blueprint. Respond with ONLY a JSON array of row objects whose keys exactly match the
blueprint's column names for the relevant sheet. No markdown fences, no commentary.
Blueprint columns: ${JSON.stringify(body.columns)}`;
      const r = await callModel(system, body.document_text, 3000);
      usage = r.usage;
      result = { rows: JSON.parse(stripJsonFence(r.text)) };
    } else if (action === "raw") {
      // Passthrough for app.html — client builds the content-block array
      // (text/image/document), this function just relays it with the key attached.
      const r = await callModel(body.system ?? "", body.content, body.max_tokens ?? 2000);
      usage = r.usage;
      result = { text: r.text };
    } else if (action === "summary") {
      const system = `Write a short, friendly WhatsApp-style summary (under 80 words) of this
automation run's results for a farm business owner. Plain text, no markdown, no mention of AI models.`;
      const r = await callModel(system, JSON.stringify(body.data), 400);
      usage = r.usage;
      result = { summary: r.text };
    } else {
      return new Response(JSON.stringify({ error: "unknown action" }), {
        status: 400,
        headers: { ...CORS, "content-type": "application/json" },
      });
    }

    // log token usage for the admin analytics dashboard
    if (org_id) {
      await supabase.from("usage_events").insert({
        org_id,
        project_id: project_id ?? null,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
      });
    }

    return new Response(JSON.stringify(result), {
      headers: { ...CORS, "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...CORS, "content-type": "application/json" },
    });
  }
});
