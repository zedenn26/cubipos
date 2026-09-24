import { requirePermission, apiError } from "@/lib/auth/server";
import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import bwipjs from "bwip-js/node";
import { z } from "zod";
const schema = z.object({
  product: z.uuid(),
  count: z.coerce.number().int().min(1).max(200).default(1),
  width: z.coerce.number().min(30).max(150).default(40),
  height: z.coerce.number().min(25).max(100).default(25),
  format: z.enum(["qr", "barcode"]).default("qr"),
});
export async function GET(request: Request) {
  try {
    const { db } = await requirePermission(request, "products.manage");
    const input = schema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const r = await db
      .from("products")
      .select("name,sku,barcode,qr_identifier,selling_price")
      .eq("id", input.product)
      .single();
    if (r.error) throw r.error;
    const image =
      input.format === "qr"
        ? await QRCode.toDataURL(r.data.qr_identifier ?? r.data.sku)
        : `data:image/png;base64,${(await bwipjs.toBuffer({ bcid: "code128", text: r.data.barcode ?? r.data.sku, scale: 3, height: 8, includetext: true })).toString("base64")}`;
    const doc = new jsPDF({
      unit: "mm",
      format: [input.width, input.height],
      orientation: input.width >= input.height ? "landscape" : "portrait",
    });
    for (let i = 0; i < input.count; i++) {
      if (i)
        doc.addPage(
          [input.width, input.height],
          input.width >= input.height ? "landscape" : "portrait",
        );
      doc.setFontSize(6);
      doc.text(r.data.name.slice(0, Math.floor(input.width)), 2, 4);
      if (input.format === "qr") {
        const size = Math.min(input.height - 8, input.width / 2);
        doc.addImage(image, "PNG", 2, 6, size, size);
        doc.text(r.data.sku.slice(0, 15), size + 3, 10);
        doc.text(String(r.data.selling_price), size + 3, 15);
      } else {
        doc.addImage(image, "PNG", 2, 6, input.width - 4, input.height - 11);
        doc.text(String(r.data.selling_price), 2, input.height - 2);
      }
    }
    return new Response(doc.output("arraybuffer"), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="labels.pdf"',
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
