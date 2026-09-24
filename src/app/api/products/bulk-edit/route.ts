import { z } from "zod";
import { apiError, requirePermission } from "@/lib/auth/server";

const nullableText = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .nullable()
    .transform((value) => value || null);

const productSchema = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(200),
    description: nullableText(2_000),
    category_id: z.uuid(),
    brand: nullableText(150),
    unit: z.enum([
      "pcs",
      "kg",
      "g",
      "l",
      "ml",
      "box",
      "pack",
      "dozen",
      "bottle",
    ]),
    sku: z.string().trim().min(1).max(120),
    internal_code: z.string().trim().min(1).max(120),
    barcode: nullableText(200),
    qr_identifier: nullableText(200),
    purchase_price: z.number().min(0).max(1_000_000_000),
    selling_price: z.number().min(0).max(1_000_000_000),
    mrp: z.number().min(0).max(1_000_000_000).nullable(),
    tax_mode: z.enum(["inclusive", "exclusive", "exempt", "zero_rated"]),
    tax_rate: z.number().min(0).max(100),
    tax_code_id: z.uuid().nullable(),
    hsn_sac: nullableText(100),
    reorder_level: z.number().min(0).max(100_000_000),
    batch_number: nullableText(150),
    manufactured_on: z.string().date().nullable(),
    expires_on: z.string().date().nullable(),
    is_active: z.boolean(),
  })
  .superRefine((product, context) => {
    if (
      (product.tax_mode === "inclusive" || product.tax_mode === "exclusive") &&
      product.tax_rate <= 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["tax_rate"],
        message:
          "Select a GST/tax rate above 0%, or choose Zero rated / Tax exempt.",
      });
    }
    if (
      product.manufactured_on &&
      product.expires_on &&
      product.expires_on < product.manufactured_on
    ) {
      context.addIssue({
        code: "custom",
        path: ["expires_on"],
        message: "Expiry date cannot be before the manufacturing date.",
      });
    }
  });

const requestSchema = z.object({
  products: z.array(productSchema).min(1).max(100),
});

function uniqueIdentifiers(
  products: z.infer<typeof productSchema>[],
): string | null {
  const owners = new Map<string, { id: string; field: string }>();
  for (const product of products) {
    for (const [field, raw] of [
      ["SKU", product.sku],
      ["internal code", product.internal_code],
      ["barcode", product.barcode],
      ["QR identifier", product.qr_identifier],
    ] as const) {
      const value = raw?.trim();
      if (!value) continue;
      const key = value.toLocaleLowerCase();
      const owner = owners.get(key);
      if (owner && owner.id !== product.id)
        return `Identifier “${value}” is used by more than one edited product (${owner.field} and ${field}).`;
      owners.set(key, { id: product.id, field });
    }
  }
  return null;
}

export async function PATCH(request: Request) {
  try {
    const { db, profile } = await requirePermission(
      request,
      "products.manage",
    );
    if (!profile.entity_id) throw new Error("Access denied");

    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return Response.json(
        {
          error: issue
            ? `${issue.path.join(".") || "Products"}: ${issue.message}`
            : "Check the product changes and try again.",
        },
        { status: 400 },
      );
    }

    const ids = parsed.data.products.map((product) => product.id);
    if (new Set(ids).size !== ids.length)
      return Response.json(
        { error: "The same product was included more than once." },
        { status: 400 },
      );

    const duplicate = uniqueIdentifiers(parsed.data.products);
    if (duplicate)
      return Response.json({ error: duplicate }, { status: 400 });

    const existing = await db
      .from("products")
      .select("id")
      .eq("entity_id", profile.entity_id)
      .in("id", ids);
    if (existing.error) throw existing.error;
    if ((existing.data?.length ?? 0) !== ids.length)
      throw new Error("Access denied");

    const limited = await db.rpc("consume_operation", {
      operation: "products.bulk_edit",
      maximum: 20,
    });
    if (limited.error && limited.error.code !== "PGRST202") throw limited.error;

    const payload = parsed.data.products.map((product) => ({
      ...product,
      entity_id: profile.entity_id,
      tax_rate:
        product.tax_mode === "exempt" || product.tax_mode === "zero_rated"
          ? 0
          : product.tax_rate,
    }));
    const saved = await db
      .from("products")
      .upsert(payload, { onConflict: "id" })
      .select("id");
    if (saved.error) {
      const detail = `${saved.error.message} ${saved.error.details ?? ""}`;
      if (/duplicate|unique/i.test(detail))
        return Response.json(
          {
            error:
              "A SKU, internal code, barcode or QR identifier is already used by another product.",
          },
          { status: 409 },
        );
      if (/category|tax code/i.test(detail))
        return Response.json(
          { error: "One of the selected categories or tax codes is invalid." },
          { status: 400 },
        );
      throw saved.error;
    }

    return Response.json({ updated: saved.data?.length ?? payload.length });
  } catch (error) {
    return apiError(error);
  }
}
