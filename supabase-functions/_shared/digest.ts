// supabase/functions/_shared/digest.ts
// One place that computes "what's the current state of the business" —
// used by weekly-digest (scheduled), send-report (operator taps a button),
// and whatsapp-webhook (boss just asks for it in a message). Keeping this
// in one file means all three always agree on the numbers.

export interface DigestData {
  total: number;
  txCount: number;
  topCats: [string, number][];
  reportedStaff: string[];
  allStaff: string[];
  missingStaff: string[];
  issues: string[];
}

export async function computeDigest(supabase: any, orgId: string, sinceISO: string): Promise<DigestData> {
  const [{ data: rows }, { data: reports }, { data: senders }] = await Promise.all([
    supabase.from("workflow_rows").select("data, created_at").gte("created_at", sinceISO),
    supabase.from("daily_reports").select("staff_name, ai_structured, received_at").eq("org_id", orgId).gte("received_at", sinceISO),
    supabase.from("whatsapp_senders").select("staff_name").eq("org_id", orgId).eq("is_active", true),
  ]);

  const total = (rows ?? []).reduce((s: number, r: any) => s + (parseFloat(r.data?.amount) || 0), 0);
  const byCat: Record<string, number> = {};
  (rows ?? []).forEach((r: any) => {
    const c = r.data?.category || "Other";
    byCat[c] = (byCat[c] || 0) + (parseFloat(r.data?.amount) || 0);
  });
  const topCats = Object.entries(byCat).sort((a, b) => (b[1] as number) - (a[1] as number)).slice(0, 5) as [string, number][];

  const reportedStaff = [...new Set((reports ?? []).map((r: any) => r.staff_name))] as string[];
  const allStaff = [...new Set((senders ?? []).map((s: any) => s.staff_name))] as string[];
  const missingStaff = allStaff.filter((s) => !reportedStaff.includes(s));

  const issues: string[] = [];
  (reports ?? []).forEach((r: any) => (r.ai_structured?.issues ?? []).forEach((i: string) => issues.push(i)));

  return { total, txCount: (rows ?? []).length, topCats, reportedStaff, allStaff, missingStaff, issues };
}

export function digestToWhatsAppText(d: DigestData, bizName: string, periodLabel: string, currencySymbol = "₦"): string {
  return `📊 *${bizName} — ${periodLabel}*\n\n` +
    `Total tracked: ${currencySymbol}${d.total.toLocaleString("en-NG", { minimumFractionDigits: 2 })} (${d.txCount} transactions)\n\n` +
    `Top spend:\n${d.topCats.slice(0, 3).map(([c, v]) => `• ${c}: ${currencySymbol}${v.toLocaleString("en-NG", { minimumFractionDigits: 2 })}`).join("\n") || "• No data this period"}\n\n` +
    `Reports: ${d.reportedStaff.length}/${d.allStaff.length} staff checked in.\n` +
    (d.missingStaff.length ? `Missing: ${d.missingStaff.join(", ")}\n\n` : "\n") +
    (d.issues.length ? `Flagged issues:\n${d.issues.map((i) => "• " + i).join("\n")}` : "No issues flagged this period ✓");
}

export function digestToEmailHtml(d: DigestData, bizName: string, periodLabel: string, currencySymbol = "₦"): string {
  const rows = d.topCats.map(([c, v]) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #e5e5e5">${c}</td><td style="padding:6px 10px;border-bottom:1px solid #e5e5e5;text-align:right;font-family:monospace">${currencySymbol}${v.toLocaleString("en-NG", { minimumFractionDigits: 2 })}</td></tr>`).join("");
  const issuesList = d.issues.length ? `<ul>${d.issues.map((i) => `<li>${i}</li>`).join("")}</ul>` : "<p style='color:#16A34A'>No issues flagged ✓</p>";
  const missingLine = d.missingStaff.length ? `<p style="color:#F43F5E">Missing reports from: ${d.missingStaff.join(", ")}</p>` : "";
  return `
  <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#111">
    <h2 style="color:#166534">${bizName} — ${periodLabel}</h2>
    <p style="font-size:22px;font-weight:bold">${currencySymbol}${d.total.toLocaleString("en-NG", { minimumFractionDigits: 2 })} <span style="font-size:14px;font-weight:normal;color:#666">tracked (${d.txCount} transactions)</span></p>
    <h3>Top spend</h3>
    <table style="width:100%;border-collapse:collapse">${rows || "<tr><td>No data this period</td></tr>"}</table>
    <h3>Report compliance</h3>
    <p>${d.reportedStaff.length}/${d.allStaff.length} staff checked in.</p>
    ${missingLine}
    <h3>Issues flagged</h3>
    ${issuesList}
    <p style="color:#999;font-size:11px;margin-top:24px">Sent automatically by Wisurel AI.</p>
  </div>`;
}
