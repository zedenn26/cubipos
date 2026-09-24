import { z } from "zod";
import { requirePermission, apiError } from "@/lib/auth/server";
import {renderReport} from "@/lib/reports/render";
const schema = z.object({
  report: z.enum([
    "sales",
    "tax",
    "discounts",
    "products",
    "profit",
    "payments",
    "inventory",
    "low_stock",
    "expiry",
    "returns",
    "exchanges",
    "movements",
    "purchases",
    "registers",
    "audit",
  ]),
  format: z.enum(["csv", "xlsx", "pdf"]),
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  store: z.uuid().nullable().optional(),
  cashier: z.uuid().nullable().optional(),
});
export async function POST(request: Request) {
  try {
    const { db, profile } = await requirePermission(request, "reports.read");
    const input = schema.parse(await request.json());
    const result = await db.rpc("report_rows", {
      report_name: input.report,
      starts_at: input.from,
      ends_at: input.to,
      target_store: input.store ?? null,
      target_cashier: input.cashier ?? null,
    });
    if (result.error) throw result.error;
    const rows = (result.data ?? []) as Record<string, unknown>[];
    const entity = await db
      .from("entities")
      .select("name,currency_code")
      .eq("id", profile.entity_id)
      .single();
    const heading = `${entity.data?.name ?? "CubiPOS"} — ${input.report}`;
    const metadata = `${input.from.slice(0, 10)} to ${input.to.slice(0, 10)} | Generated ${new Date().toISOString()} | ${input.store ?? "All authorized stores"} | ${entity.data?.currency_code ?? ""}`;
    const {body,type}=await renderReport(rows,heading,metadata,input.format);
    return new Response(body as BodyInit, {
      headers: {
        "Content-Type": type,
        "Content-Disposition": `attachment; filename="${input.report}.${input.format}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
