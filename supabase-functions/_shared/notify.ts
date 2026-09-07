// supabase/functions/_shared/notify.ts
// One place that knows how to actually deliver a message — WhatsApp via
// Meta's Cloud API, email via Resend. Every function that sends something
// to a human goes through here so the delivery logic only exists once.

export async function sendWhatsAppText(toPhone: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneNumberId) return { ok: false, error: "WhatsApp not configured (missing WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID)" };
  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: toPhone.replace("+", ""), text: { body: text } }),
    });
    if (!res.ok) return { ok: false, error: await res.text() };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// Email via Resend (resend.com) — free tier covers this use case easily.
// Swap RESEND_API_KEY / the fetch call for any other provider (SendGrid,
// Postmark, etc.) if you already use one; the shape is nearly identical.
export async function sendEmail(toEmail: string, subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const fromAddress = Deno.env.get("REPORT_FROM_EMAIL") ?? "reports@wisurel.app";
  if (!apiKey) return { ok: false, error: "Email not configured (missing RESEND_API_KEY)" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: fromAddress, to: [toEmail], subject, html }),
    });
    if (!res.ok) return { ok: false, error: await res.text() };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
