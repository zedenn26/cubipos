import { Workbook, type Cell } from "exceljs";
import JSZip from "jszip";
import { z } from "zod";
import { requirePermission, apiError } from "@/lib/auth/server";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 2000;
const headers = [
  "product_name*",
  "category*",
  "subcategory",
  "sku*",
  "internal_code",
  "primary_barcode",
  "qr_identifier",
  "description",
  "brand",
  "unit*",
  "purchase_price*",
  "selling_price*",
  "mrp",
  "tax_mode*",
  "gst_tax_rate*",
  "tax_code",
  "hsn_sac",
  "opening_quantity",
  "reorder_level",
  "batch_number",
  "manufacturing_date",
  "expiry_date",
  "status",
] as const;

const rowSchema = z.object({
  row_number: z.number().int().min(2),
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(150),
  subcategory: z.string().trim().max(150),
  sku: z.string().trim().min(1).max(120),
  internal_code: z.string().trim().max(120),
  barcode: z.string().trim().max(200),
  qr_identifier: z.string().trim().max(200),
  description: z.string().trim().max(2000),
  brand: z.string().trim().max(150),
  unit: z.enum(["pcs", "kg", "g", "l", "ml", "box", "pack", "dozen", "bottle"]),
  purchase_price: z.number().min(0).max(1_000_000_000),
  selling_price: z.number().min(0).max(1_000_000_000),
  mrp: z.number().min(0).max(1_000_000_000).nullable(),
  tax_mode: z.enum(["inclusive", "exclusive", "exempt", "zero_rated"]),
  tax_rate: z.number().min(0).max(100),
  tax_code: z.string().trim().max(100),
  hsn_sac: z.string().trim().max(100),
  opening_quantity: z.number().min(0).max(100_000_000),
  reorder_level: z.number().min(0).max(100_000_000),
  batch_number: z.string().trim().max(150),
  manufactured_on: z.string().date().or(z.literal("")),
  expires_on: z.string().date().or(z.literal("")),
  is_active: z.boolean(),
}).superRefine((row, context) => {
  if (["inclusive", "exclusive"].includes(row.tax_mode) && row.tax_rate <= 0)
    context.addIssue({
      code: "custom",
      path: ["tax_rate"],
      message:
        "must be above 0 for inclusive/exclusive products; use zero_rated or exempt for 0%",
    });
});

function normalizedHeader(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replaceAll("*", "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function text(cell: Cell) {
  if (cell.value instanceof Date) return cell.value.toISOString().slice(0, 10);
  return cell.text.trim();
}

function number(cell: Cell, required = false) {
  const value = text(cell);
  if (!value && !required) return null;
  if (!value) return Number.NaN;
  return Number(value.replaceAll(",", ""));
}

function normalizeUnit(value: string) {
  const unit = value.trim().toLowerCase().replace(/[._-]+/g, " ").replace(/\s+/g, " ");
  const aliases: Record<string, string> = {
    pc: "pcs",
    piece: "pcs",
    pieces: "pcs",
    each: "pcs",
    item: "pcs",
    items: "pcs",
    unit: "pcs",
    units: "pcs",
    bottle: "bottle",
    bottles: "bottle",
    box: "box",
    boxes: "box",
    pack: "pack",
    packs: "pack",
    dozen: "dozen",
    gram: "g",
    grams: "g",
    kilogram: "kg",
    kilograms: "kg",
    litre: "l",
    litres: "l",
    liter: "l",
    liters: "l",
    millilitre: "ml",
    millilitres: "ml",
    milliliter: "ml",
    milliliters: "ml",
    can: "pcs",
    cans: "pcs",
    jar: "pcs",
    jars: "pcs",
    tin: "pcs",
    tins: "pcs",
    tube: "pcs",
    tubes: "pcs",
    sachet: "pcs",
    sachets: "pcs",
    bag: "pcs",
    bags: "pcs",
    pouch: "pcs",
    pouches: "pcs",
    pair: "pcs",
    pairs: "pcs",
    set: "pcs",
    sets: "pcs",
    tablet: "pcs",
    tablets: "pcs",
    strip: "pcs",
    strips: "pcs",
    roll: "pcs",
    rolls: "pcs",
  };
  return aliases[unit] ?? unit;
}

function safeImportError(error: unknown) {
  const message = error instanceof Error ? error.message : "Bulk import failed";
  if (message.includes("Could not find the function public.bulk_import_products")) {
    return Response.json(
      {
        error:
          "Bulk product import is not enabled in this database. Apply migration 0013_bulk_product_import.sql in Supabase, then retry.",
      },
      { status: 503 },
    );
  }
  if (/^(Row \d+:|Bulk import requires)/.test(message)) {
    return Response.json({ error: message }, { status: 400 });
  }
  return apiError(error);
}

async function loadWorkbook(buffer: ArrayBuffer) {
  const zip = await JSZip.loadAsync(buffer);
  for (const name of Object.keys(zip.files)) {
    if (!name.endsWith(".xml") || zip.files[name].dir) continue;
    const xml = await zip.files[name].async("string");
    if (!xml.includes("<x:")) continue;
    const normalized = xml
      .replaceAll("xmlns:x=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"", "xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"")
      .replaceAll("<x:", "<")
      .replaceAll("</x:", "</");
    zip.file(name, normalized);
  }
  const normalizedBuffer = await zip.generateAsync({ type: "nodebuffer" });
  const workbook = new Workbook();
  await workbook.xlsx.load(
    normalizedBuffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  return workbook;
}

export async function GET(request: Request) {
  try {
    const { db, profile } = await requirePermission(request, "products.manage");
    const [categories, taxCodes, entity] = await Promise.all([
      db
        .from("categories")
        .select("id,parent_id,name,default_tax_rate,is_archived")
        .eq("is_archived", false)
        .order("sort_order")
        .order("name"),
      db
        .from("tax_codes")
        .select("code,name,rate")
        .eq("is_active", true)
        .order("name"),
      db
        .from("entities")
        .select("name,currency_code,country_code")
        .eq("id", profile.entity_id)
        .single(),
    ]);
    if (categories.error || taxCodes.error || entity.error) {
      throw categories.error || taxCodes.error || entity.error;
    }
    const topCategories = categories.data.filter((category) => !category.parent_id);
    const subcategories = categories.data.filter((category) => category.parent_id);
    const availableTaxRates = Array.from(
      new Set(
        [
          ...(String(entity.data.country_code).trim() === "IN"
            ? [0, 3, 5, 12, 18, 28]
            : [0]),
          ...categories.data.map((category) => Number(category.default_tax_rate)),
          ...taxCodes.data.map((taxCode) => Number(taxCode.rate)),
        ].filter((rate) => Number.isFinite(rate) && rate >= 0 && rate <= 100),
      ),
    ).sort((a, b) => a - b);

    const workbook = new Workbook();
    workbook.creator = "CubiPOS by Cubixtop";
    workbook.created = new Date();
    const instructions = workbook.addWorksheet("Instructions");
    instructions.columns = [{ width: 28 }, { width: 95 }];
    instructions.addRows([
      ["CubiPOS product import", entity.data.name],
      ["Maximum rows", MAX_ROWS],
      ["Required columns", "Columns ending in * must contain a value."],
      ["Categories", "Use an existing category/subcategory from the Categories sheet, or enable Create missing categories during upload."],
      ["Opening quantity", "Stock is added to the store selected during upload and creates an opening-stock ledger entry."],
      ["GST / tax rate", "Required. Select a rate from the dropdown. For 0%, choose zero_rated or exempt as the tax mode."],
      ["Inclusive price", "For inclusive mode, selling_price is the final customer price and CubiPOS calculates the taxable value and GST inside it."],
      ["Identifiers", "SKU and internal code must be unique in the entity. Barcode and QR identifiers must also be unique."],
      ["Status", "Use active or inactive."],
      ["Dates", "Use YYYY-MM-DD."],
      ["Example", "Coffee Beans | Grocery & Kitchen | Coffee | COF-001 | COF-001 | 890000000001 | blank | Arabica coffee | Example Brand | pack | 100 | 140 | 160 | inclusive | 18 | blank | 0901 | 25 | 5 | B-001 | 2026-01-01 | 2027-01-01 | active"],
    ]);
    instructions.getRow(1).font = { bold: true, size: 16, color: { argb: "FF1E7652" } };
    instructions.getColumn(1).font = { bold: true };

    const products = workbook.addWorksheet("Products", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    products.autoFilter = { from: "A1", to: "W1" };
    products.addRow([...headers]);
    products.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    products.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1E7652" },
    };
    products.columns.forEach((column, index) => {
      column.width = [24, 22, 22, 18, 18, 20, 20, 30, 18, 12, 16, 16, 14, 16, 18, 16, 14, 18, 16, 16, 18, 18, 12][index];
    });
    for (const column of [1, 2, 4, 10, 11, 12, 14, 15]) {
      products.getCell(1, column).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE07824" },
      };
    }
    for (let row = 2; row <= MAX_ROWS + 1; row++) {
      products.getCell(row, 10).dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: ['"pcs,kg,g,l,ml,box,pack,dozen,bottle"'],
      };
      if (topCategories.length) {
        products.getCell(row, 2).dataValidation = {
          type: "list",
          allowBlank: false,
          formulae: ["CubiPOSCategoryChoices"],
        };
      }
      if (subcategories.length) {
        products.getCell(row, 3).dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: ["CubiPOSSubcategoryChoices"],
        };
      }
      if (taxCodes.data.length) {
        products.getCell(row, 16).dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: ["CubiPOSTaxCodeChoices"],
        };
      }
      products.getCell(row, 14).dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: ['"inclusive,exclusive,exempt,zero_rated"'],
      };
      products.getCell(row, 15).dataValidation = {
        type: "list",
        allowBlank: false,
        formulae: ["CubiPOSTaxRateChoices"],
      };
      products.getCell(row, 23).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: ['"active,inactive"'],
      };
      for (const column of [4, 5, 6, 7, 16, 17]) {
        products.getCell(row, column).numFmt = "@";
      }
      products.getCell(row, 21).numFmt = "yyyy-mm-dd";
      products.getCell(row, 22).numFmt = "yyyy-mm-dd";
    }

    const categorySheet = workbook.addWorksheet("Categories");
    categorySheet.columns = [
      { header: "name", width: 28 },
      { header: "parent", width: 28 },
      { header: "default_tax_rate", width: 20 },
      { header: "type", width: 18 },
      { header: "category_choices", width: 28 },
      { header: "subcategory_choices", width: 28 },
    ];
    const names = new Map(categories.data.map((category) => [category.id, category.name]));
    for (const category of categories.data) {
      categorySheet.addRow([
        category.name,
        category.parent_id ? names.get(category.parent_id) ?? "" : "",
        category.default_tax_rate,
        category.parent_id ? "subcategory" : "category",
      ]);
    }
    topCategories.forEach((category, index) => {
      categorySheet.getCell(index + 2, 5).value = category.name;
    });
    subcategories.forEach((category, index) => {
      categorySheet.getCell(index + 2, 6).value = category.name;
    });
    if (topCategories.length) {
      workbook.definedNames.add(
        `'Categories'!$E$2:$E$${topCategories.length + 1}`,
        "CubiPOSCategoryChoices",
      );
    }
    if (subcategories.length) {
      workbook.definedNames.add(
        `'Categories'!$F$2:$F$${subcategories.length + 1}`,
        "CubiPOSSubcategoryChoices",
      );
    }
    categorySheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    categorySheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1E7652" },
    };

    const taxRateSheet = workbook.addWorksheet("GST Rates");
    taxRateSheet.columns = [
      { header: "rate", width: 16 },
      { header: "use", width: 52 },
    ];
    for (const rate of availableTaxRates) {
      taxRateSheet.addRow([
        rate,
        rate === 0
          ? "Use only with zero_rated or exempt tax mode"
          : `${rate}% applicable GST / tax`,
      ]);
    }
    workbook.definedNames.add(
      `'GST Rates'!$A$2:$A$${availableTaxRates.length + 1}`,
      "CubiPOSTaxRateChoices",
    );
    taxRateSheet.getRow(1).font = {
      bold: true,
      color: { argb: "FFFFFFFF" },
    };
    taxRateSheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1E7652" },
    };

    const taxSheet = workbook.addWorksheet("Tax Codes");
    taxSheet.columns = [
      { header: "code", width: 20 },
      { header: "name", width: 28 },
      { header: "rate", width: 15 },
    ];
    for (const taxCode of taxCodes.data) {
      taxSheet.addRow([taxCode.code, taxCode.name, taxCode.rate]);
    }
    if (taxCodes.data.length) {
      workbook.definedNames.add(
        `'Tax Codes'!$A$2:$A$${taxCodes.data.length + 1}`,
        "CubiPOSTaxCodeChoices",
      );
    }
    taxSheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    taxSheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1E7652" },
    };

    const body = new Uint8Array(await workbook.xlsx.writeBuffer());
    return new Response(body as BodyInit, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="cubipos-product-import-template.xlsx"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { db } = await requirePermission(request, "products.manage");
    const form = await request.formData();
    const file = form.get("file");
    const store = z.uuid().parse(form.get("store"));
    const createMissingCategories = form.get("create_missing_categories") === "true";
    if (!(file instanceof File)) {
      return Response.json({ error: "Select an XLSX product file." }, { status: 400 });
    }
    if (file.size === 0 || file.size > MAX_FILE_BYTES || !file.name.toLowerCase().endsWith(".xlsx")) {
      return Response.json({ error: "Upload an XLSX file no larger than 5 MB." }, { status: 400 });
    }
    const workbook = await loadWorkbook(await file.arrayBuffer());
    const sheet = workbook.getWorksheet("Products") ?? workbook.worksheets[0];
    if (!sheet) return Response.json({ error: "The workbook has no Products sheet." }, { status: 400 });

    const columns = new Map<string, number>();
    sheet.getRow(1).eachCell((cell, column) => {
      columns.set(normalizedHeader(text(cell)), column);
    });
    const requiredHeaders = [
      "product_name",
      "category",
      "sku",
      "unit",
      "purchase_price",
      "selling_price",
      "tax_mode",
    ];
    const taxRateHeader = columns.has("gst_tax_rate")
      ? "gst_tax_rate"
      : columns.has("tax_rate_override")
        ? "tax_rate_override"
        : null;
    const missing = requiredHeaders.filter((header) => !columns.has(header));
    if (!taxRateHeader) missing.push("gst_tax_rate");
    if (missing.length) {
      return Response.json(
        { error: `Missing required columns: ${missing.join(", ")}` },
        { status: 400 },
      );
    }
    const cell = (row: number, name: string) =>
      columns.has(name) ? sheet.getCell(row, columns.get(name)!) : sheet.getCell(row, 16384);
    const parsed: z.infer<typeof rowSchema>[] = [];
    const errors: string[] = [];
    const normalizedUnits = new Set<string>();
    for (let row = 2; row <= sheet.rowCount; row++) {
      if (!text(cell(row, "product_name")) && !text(cell(row, "sku"))) continue;
      const status = text(cell(row, "status")).toLowerCase();
      const candidate = {
        row_number: row,
        name: text(cell(row, "product_name")),
        category: text(cell(row, "category")),
        subcategory: text(cell(row, "subcategory")),
        sku: text(cell(row, "sku")),
        internal_code: text(cell(row, "internal_code")),
        barcode: text(cell(row, "primary_barcode")),
        qr_identifier: text(cell(row, "qr_identifier")),
        description: text(cell(row, "description")),
        brand: text(cell(row, "brand")),
        unit: normalizeUnit(text(cell(row, "unit"))),
        purchase_price: number(cell(row, "purchase_price"), true),
        selling_price: number(cell(row, "selling_price"), true),
        mrp: number(cell(row, "mrp")),
        tax_mode: text(cell(row, "tax_mode")).toLowerCase(),
        tax_rate: number(cell(row, taxRateHeader!), true),
        tax_code: text(cell(row, "tax_code")),
        hsn_sac: text(cell(row, "hsn_sac")),
        opening_quantity: number(cell(row, "opening_quantity")) ?? 0,
        reorder_level: number(cell(row, "reorder_level")) ?? 0,
        batch_number: text(cell(row, "batch_number")),
        manufactured_on: text(cell(row, "manufacturing_date")),
        expires_on: text(cell(row, "expiry_date")),
        is_active: !["inactive", "false", "no", "0"].includes(status),
      };
      const result = rowSchema.safeParse(candidate);
      if (result.success) {
        parsed.push(result.data);
        const sourceUnit = text(cell(row, "unit")).trim().toLowerCase();
        if (sourceUnit && sourceUnit !== result.data.unit) {
          normalizedUnits.add(`${sourceUnit} → ${result.data.unit}`);
        }
      }
      else {
        errors.push(
          `Row ${row}: ${result.error.issues.map((issue) => `${issue.path.join(" ")} ${issue.message}`).join("; ")}`,
        );
      }
      if (errors.length >= 20) break;
    }
    if (errors.length) return Response.json({ error: errors.join("\n") }, { status: 400 });
    if (!parsed.length) return Response.json({ error: "No product rows found in the Products sheet." }, { status: 400 });
    if (parsed.length > MAX_ROWS) return Response.json({ error: `A maximum of ${MAX_ROWS} products can be imported at once.` }, { status: 400 });

    const result = await db.rpc("bulk_import_products", {
      target_store: store,
      product_rows: parsed,
      create_missing_categories: createMissingCategories,
    });
    if (result.error) throw new Error(result.error.message);
    return Response.json({
      success: true,
      ...result.data,
      normalized_units: [...normalizedUnits],
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Select a valid assigned store." }, { status: 400 });
    }
    return safeImportError(error);
  }
}
