"use client";
import { useCallback, useEffect, useState } from "react";
import { useWorkspace, rpc } from "@/components/workspace";
import { supabase } from "@/lib/supabase/client";
import { userMessage } from "@/lib/permissions/errors";
import { DataTable, Form, Row } from "./common";
import {
  calculateTax,
  normalizeTaxMode,
  splitTaxComponents,
  type TaxComponents,
} from "@/lib/pos";
import {
  Search,
  Grid2X2,
  List,
  Edit3,
  Archive,
  RotateCcw,
  Tag,
  PackageOpen,
  Trash2,
  CheckSquare,
} from "lucide-react";
export function Catalog({ inventory = false }: { inventory?: boolean }) {
  const { profile, entity, storeId, stores, notify, allowed } = useWorkspace();
  const [rows, setRows] = useState<Row[]>([]);
  const [taxCodes, setTaxCodes] = useState<Row[]>([]);
  const [taxEdit, setTaxEdit] = useState<Row | null>(null);
  const [categoryEdit, setCategoryEdit] = useState<Row | null>(null);
  const [categories, setCategories] = useState<Row[]>([]);
  const [movements, setMovements] = useState<Row[]>([]);
  const [transfers, setTransfers] = useState<Row[]>([]);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [edit, setEdit] = useState<Row | null>(null);
  const [manageMode, setManageMode] = useState<"product" | "bulk" | null>(null);
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkStore, setBulkStore] = useState(storeId);
  const [createMissingCategories, setCreateMissingCategories] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkFileKey, setBulkFileKey] = useState(0);
  const [catalogView, setCatalogView] = useState<"grid" | "table">("grid");
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(
    new Set(),
  );
  const [deletingProducts, setDeletingProducts] = useState(false);
  const [taxFramework, setTaxFramework] = useState("GST");
  const [taxComponents, setTaxComponents] = useState<TaxComponents>((): TaxComponents =>
    String(entity.country_code).trim() === "IN"
      ? { CGST: 50, SGST: 50 }
      : { Tax: 100 },
  );
  const money = (value: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: String(entity.currency_code ?? "INR"),
    }).format(value);
  const resolvedRate = (product: Row) => {
    if (
      product.tax_rate !== "" &&
      product.tax_rate !== null &&
      product.tax_rate !== undefined
    )
      return Number(product.tax_rate) || 0;
    const taxCode = taxCodes.find(
      (code) => String(code.id) === String(product.tax_code_id ?? ""),
    );
    if (taxCode) return Number(taxCode.rate ?? 0);
    const category = categories.find(
      (candidate) => String(candidate.id) === String(product.category_id ?? ""),
    );
    return Number(product.resolved_tax_rate ?? category?.default_tax_rate ?? 0);
  };
  const productPricing = (product: Row) => {
    const rate = resolvedRate(product);
    const mode = normalizeTaxMode(product.tax_mode);
    const totals = calculateTax(Number(product.selling_price ?? 0), rate, mode);
    return {
      rate,
      mode,
      ...totals,
      components: splitTaxComponents(totals.tax, taxComponents),
    };
  };
  const componentRate = (name: string, rate: number) => {
    const totalWeight = Object.values(taxComponents).reduce(
      (sum, weight) => sum + Number(weight),
      0,
    );
    return totalWeight > 0
      ? (rate * Number(taxComponents[name] ?? 0)) / totalWeight
      : 0;
  };
  const refresh = useCallback(async () => {
    if (!storeId) return;
    const [p, c, m, t] = await Promise.all([
      rpc<Row[]>("search_products", {
        target_store: storeId,
        search_text: search,
        page_number: page,
        include_archived: includeArchived,
      }),
      supabase!.from("categories").select("*").order("sort_order"),
      supabase!
        .from("inventory_movements")
        .select("*")
        .eq("store_id", storeId)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase!
        .from("stock_transfers")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    if (c.error || m.error || t.error) throw c.error || m.error || t.error;
    const [tax, configuration] = await Promise.all([
      supabase!.from("tax_codes").select("*").order("name"),
      supabase!
        .from("entity_settings")
        .select("tax_framework,tax_components")
        .eq("entity_id", profile.entity_id)
        .maybeSingle(),
    ]);
    if (tax.error || configuration.error)
      throw tax.error || configuration.error;
    setTaxCodes(tax.data);
    const configured = configuration.data?.tax_components;
    if (configured && typeof configured === "object" && !Array.isArray(configured))
      setTaxComponents(configured as TaxComponents);
    setTaxFramework(String(configuration.data?.tax_framework ?? "Tax"));
    setRows(p);
    setCategories(c.data ?? []);
    setMovements(m.data ?? []);
    setTransfers(t.data ?? []);
  }, [storeId, search, page, includeArchived, profile.entity_id]);
  useEffect(() => {
    const timer = setTimeout(
      () =>
        void Promise.resolve()
          .then(refresh)
          .catch((e) => notify(userMessage(e))),
      250,
    );
    return () => clearTimeout(timer);
  }, [refresh, notify]);
  const insert = async (table: string, data: Row) => {
    const r = await supabase!
      .from(table)
      .insert({ ...data, entity_id: profile.entity_id });
    if (r.error) throw r.error;
    await refresh();
    notify("Saved.");
  };
  async function downloadBulkTemplate() {
    setBulkBusy(true);
    try {
      const {
        data: { session },
      } = await supabase!.auth.getSession();
      const response = await fetch("/api/products/bulk", {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(String(data.error ?? "Template download failed."));
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "cubipos-product-import-template.xlsx";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Template download failed.");
    } finally {
      setBulkBusy(false);
    }
  }
  async function uploadBulkProducts() {
    if (!bulkFile) return notify("Select the completed XLSX template.");
    const targetStore = bulkStore || storeId;
    if (!targetStore) return notify("Select a store for opening stock.");
    if (
      !window.confirm(
        `Import products from ${bulkFile.name}? The complete file will be validated before products or opening stock are created.`,
      )
    )
      return;
    setBulkBusy(true);
    try {
      const {
        data: { session },
      } = await supabase!.auth.getSession();
      const body = new FormData();
      body.set("file", bulkFile);
      body.set("store", targetStore);
      body.set("create_missing_categories", String(createMissingCategories));
      const response = await fetch("/api/products/bulk", {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token}` },
        body,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(String(data.error ?? "Import failed."));
      notify(
        `Bulk product import completed: ${Number(data.products_created)} products created${Number(data.categories_created) ? `; ${Number(data.categories_created)} categories created` : ""}${Array.isArray(data.normalized_units) && data.normalized_units.length ? `; units normalized: ${data.normalized_units.join(", ")}` : ""}.`,
      );
      setBulkFile(null);
      setBulkFileKey((value) => value + 1);
      await refresh();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Product import failed.");
    } finally {
      setBulkBusy(false);
    }
  }
  function selectProduct(row: Row, checked: boolean) {
    setSelectedProducts((current) => {
      const next = new Set(current);
      const id = String(row.id);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  function selectVisibleProducts() {
    const visible = rows.map((row) => String(row.id));
    const allVisibleSelected = visible.every((id) => selectedProducts.has(id));
    setSelectedProducts((current) => {
      const next = new Set(current);
      visible.forEach((id) =>
        allVisibleSelected ? next.delete(id) : next.add(id),
      );
      return next;
    });
  }
  async function deleteSelectedProducts() {
    if (!selectedProducts.size || deletingProducts) return;
    const confirmed = window.confirm(
      `Delete ${selectedProducts.size} selected product${selectedProducts.size === 1 ? "" : "s"}? Products used by transactions or stock history will be archived instead.`,
    );
    if (!confirmed) return;
    setDeletingProducts(true);
    try {
      const result = await rpc<{
        deleted: number;
        archived: number;
        deleted_image_paths: string[];
      }>("bulk_delete_products", {
        product_ids: Array.from(selectedProducts),
      });
      let imageCleanupFailed = false;
      if (result.deleted_image_paths?.length) {
        const cleanup = await supabase!.storage
          .from("product-images")
          .remove(result.deleted_image_paths);
        imageCleanupFailed = Boolean(cleanup.error);
      }
      setSelectedProducts(new Set());
      await refresh();
      notify(
        `${result.deleted} product${result.deleted === 1 ? "" : "s"} deleted; ${result.archived} product${result.archived === 1 ? "" : "s"} with business history archived.${imageCleanupFailed ? " Product records were removed, but one or more image files could not be cleaned up." : ""}`,
      );
    } catch (error) {
      notify(userMessage(error));
    } finally {
      setDeletingProducts(false);
    }
  }
  function openProductEditor(product: Row | null) {
    setEdit(product);
    setManageMode("product");
    window.setTimeout(
      () => document.getElementById("product-editor")?.scrollIntoView({ behavior: "smooth" }),
      0,
    );
  }
  function productActions(r: Row) {
    return (
      <div className="actions product-actions">
        {!inventory && allowed("products.manage") && (
          <>
            <button onClick={() => openProductEditor(r)}><Edit3 size={15} /> Edit</button>
            <button
              onClick={() =>
                void (async () => {
                  if (
                    r.is_active &&
                    !window.confirm(
                      `Archive ${String(r.name)}? It will no longer appear in normal product searches.`,
                    )
                  )
                    return;
                  const result = await supabase!
                    .from("products")
                    .update({ is_active: !r.is_active })
                    .eq("id", r.id);
                  if (result.error) throw result.error;
                  await refresh();
                  notify(
                    r.is_active
                      ? "Product archived successfully."
                      : "Product restored successfully.",
                  );
                })().catch((e) => notify(userMessage(e)))
              }
            >
              {r.is_active ? <Archive size={15} /> : <RotateCcw size={15} />}
              {r.is_active ? "Archive" : "Restore"}
            </button>
            <button onClick={() => openProductEditor(r)}>
              <Tag size={15} /> Labels & codes
            </button>
          </>
        )}
        {inventory && allowed("inventory.manage") && (
          <Form
            label="Set stock"
            fields={[
              {
                name: "quantity",
                label: "Counted quantity",
                type: "number",
                step: "0.001",
                value: Number(r.stock ?? 0),
              },
            ]}
            onSave={async (d) => {
              await rpc("adjust_stock", {
                target_store: storeId,
                target_product: r.id,
                new_quantity: Number(d.quantity),
              });
              await refresh();
            }}
          />
        )}
      </div>
    );
  }
  return (
    <>
      {!storeId && (
        <p className="notice">
          Create or select a store in Settings to manage its catalog.
        </p>
      )}
      {!inventory && allowed("products.manage") && (
        <>
          <section className="panel product-entry-actions">
            <div>
              <p className="eyebrow">PRODUCT ENTRY</p>
              <h2>Add products</h2>
              <p>Choose one product or use the guided XLSX template for a bulk import.</p>
            </div>
            <div className="actions">
              <button
                type="button"
                className={manageMode === "product" && !edit ? "primary" : ""}
                onClick={() => openProductEditor(null)}
              >
                <PackageOpen size={17} /> Add new product
              </button>
              <button
                type="button"
                className={manageMode === "bulk" ? "primary" : ""}
                onClick={() => {
                  setEdit(null);
                  setManageMode("bulk");
                }}
              >
                <CheckSquare size={17} /> Bulk add products
              </button>
            </div>
          </section>
          {manageMode === "bulk" && (
          <section className="panel" id="bulk-product-import">
            <div className="section-heading">
              <div>
                <p className="eyebrow">GUIDED IMPORT</p>
                <h2>Bulk product import</h2>
              </div>
              <button type="button" onClick={() => setManageMode(null)}>Close</button>
            </div>
            <p>
              Download the XLSX template containing instructions, your current
              categories and active tax codes. Complete the Products sheet and
              upload it here. All rows are validated and committed together.
            </p>
            <div className="actions">
              <button
                type="button"
                className="primary"
                disabled={bulkBusy}
                onClick={() => void downloadBulkTemplate()}
              >
                Download product template
              </button>
            </div>
            <div className="form-grid">
              <label>
                Store for opening stock
                <select
                  value={bulkStore || storeId}
                  onChange={(event) => setBulkStore(event.target.value)}
                >
                  {stores.map((store) => (
                    <option key={store.id} value={store.id}>
                      {store.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Completed XLSX template
                <input
                  key={bulkFileKey}
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(event) =>
                    setBulkFile(event.target.files?.[0] ?? null)
                  }
                />
              </label>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={createMissingCategories}
                onChange={(event) =>
                  setCreateMissingCategories(event.target.checked)
                }
              />
              Create missing category and subcategory names from the file
            </label>
            <button
              type="button"
              className="primary"
              disabled={bulkBusy || !bulkFile || !(bulkStore || storeId)}
              onClick={() => void uploadBulkProducts()}
            >
              {bulkBusy ? "Processing…" : "Validate and import products"}
            </button>
            <p className="muted">
              Maximum 2,000 products or 5 MB per file. SKU, internal code,
              barcode and QR identifiers must be unique.
            </p>
          </section>
          )}
          {manageMode === "product" && (
          <section className="panel" id="product-editor">
            <div className="section-heading">
              <div>
                <p className="eyebrow">{edit ? "SELECTED PRODUCT" : "NEW PRODUCT"}</p>
                <h2>{edit ? `Edit ${String(edit.name)}` : "Add new product"}</h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEdit(null);
                  setManageMode(null);
                }}
              >
                Close
              </button>
            </div>
            <Form
              key={String(edit?.id ?? "new")}
              label={edit ? "Save product" : "Create product"}
              fields={[
                {
                  name: "name",
                  label: "Product name",
                  value: String(edit?.name ?? ""),
                },
                {
                  name: "category_id",
                  label: "Category",
                  options: categories
                    .filter((c) => !c.is_archived)
                    .map((c) => ({
                      value: String(c.id),
                      label: String(c.name),
                    })),
                  value: String(edit?.category_id ?? ""),
                },
                { name: "sku", label: "SKU", value: String(edit?.sku ?? "") },
                {
                  name: "internal_code",
                  label: "Internal item code",
                  value: String(edit?.internal_code ?? ""),
                },
                {
                  name: "barcode",
                  label: "Barcode",
                  required: false,
                  value: String(edit?.barcode ?? ""),
                },
                {
                  name: "selling_price",
                  label: "Price entered (final price when tax is inclusive)",
                  type: "number",
                  value: Number(edit?.selling_price ?? 0),
                },
                {
                  name: "purchase_price",
                  label: "Purchase cost",
                  type: "number",
                  value: Number(edit?.purchase_price ?? 0),
                },
                {
                  name: "mrp",
                  label: "MRP",
                  type: "number",
                  required: false,
                  value: String(edit?.mrp ?? ""),
                },
                {
                  name: "tax_code_id",
                  label: "Tax code (optional)",
                  value: String(edit?.tax_code_id ?? ""),
                  required: false,
                  options: [
                    { value: "", label: "Category default" },
                    ...taxCodes
                      .filter((t) => t.is_active)
                      .map((t) => ({
                        value: String(t.id),
                        label: `${t.name} (${t.rate}%)`,
                      })),
                  ],
                },
                {
                  name: "tax_rate",
                  label: "Tax override % (blank inherits category)",
                  type: "number",
                  required: false,
                  value: String(edit?.tax_rate ?? ""),
                },
                {
                  name: "tax_mode",
                  label: "Tax mode",
                  value: String(edit?.tax_mode ?? "inclusive"),
                  options: [
                    {
                      value: "inclusive",
                      label: "Inclusive — entered price is the final price",
                    },
                    {
                      value: "exclusive",
                      label: "Exclusive — tax is added to the entered price",
                    },
                    { value: "exempt", label: "Tax exempt" },
                    { value: "zero_rated", label: "Zero rated" },
                  ],
                },
                {
                  name: "hsn_sac",
                  label: "Tax / HSN code",
                  required: false,
                  value: String(edit?.hsn_sac ?? ""),
                },
                {
                  name: "unit",
                  label: "Unit",
                  value: String(edit?.unit ?? "pcs"),
                  options: [
                    "pcs",
                    "kg",
                    "g",
                    "l",
                    "ml",
                    "box",
                    "pack",
                    "dozen",
                  ].map((value) => ({ value, label: value.toUpperCase() })),
                },
                {
                  name: "brand",
                  label: "Brand",
                  required: false,
                  value: String(edit?.brand ?? ""),
                },
                {
                  name: "reorder_level",
                  label: "Reorder level",
                  type: "number",
                  value: Number(edit?.reorder_level ?? 0),
                },
                {
                  name: "batch_number",
                  label: "Batch",
                  required: false,
                  value: String(edit?.batch_number ?? ""),
                },
                {
                  name: "manufactured_on",
                  label: "Manufacturing date",
                  type: "date",
                  required: false,
                  value: String(edit?.manufactured_on ?? ""),
                },
                {
                  name: "expires_on",
                  label: "Expiry",
                  type: "date",
                  required: false,
                  value: String(edit?.expires_on ?? ""),
                },
              ]}
              preview={(data) => {
                const pricing = productPricing(data);
                const componentEntries = Object.entries(pricing.components);
                return (
                  <section className="tax-preview" aria-live="polite">
                    <div className="tax-preview-heading">
                      <div>
                        <small>PRICE AND TAX PREVIEW</small>
                        <strong>
                          {pricing.mode === "inclusive"
                            ? "Entered price includes tax"
                            : pricing.mode === "exclusive"
                              ? "Tax will be added at checkout"
                              : "No tax will be charged"}
                        </strong>
                      </div>
                      <span>{pricing.rate}% {taxFramework}</span>
                    </div>
                    <dl className="tax-preview-values">
                      <div>
                        <dt>Taxable value</dt>
                        <dd>{money(pricing.net)}</dd>
                      </div>
                      {componentEntries.map(([name, amount]) => (
                        <div key={name}>
                          <dt>
                            {name}{" "}
                            {pricing.rate > 0
                              ? `${componentRate(name, pricing.rate).toFixed(2)}%`
                              : ""}
                          </dt>
                          <dd>{money(amount)}</dd>
                        </div>
                      ))}
                      <div className="tax-preview-total">
                        <dt>Final selling price</dt>
                        <dd>{money(pricing.gross)}</dd>
                      </div>
                    </dl>
                  </section>
                );
              }}
              onSave={async (d) => {
                const payload = {
                  ...d,
                  internal_code: d.internal_code || d.sku,
                  tax_code_id: d.tax_code_id || null,
                  barcode: d.barcode || null,
                  tax_rate: d.tax_rate === "" ? null : Number(d.tax_rate),
                  selling_price: Number(d.selling_price),
                  purchase_price: Number(d.purchase_price),
                  mrp: d.mrp === "" ? null : Number(d.mrp),
                  reorder_level: Number(d.reorder_level),
                  expires_on: d.expires_on || null,
                  manufactured_on: d.manufactured_on || null,
                };
                if (edit) {
                  const r = await supabase!
                    .from("products")
                    .update(payload)
                    .eq("id", edit.id);
                  if (r.error) throw r.error;
                  setEdit(null);
                  setManageMode(null);
                  await refresh();
                  notify("Product updated successfully.");
                } else {
                  await insert("products", {
                    ...payload,
                    qr_identifier: `POS:P:${crypto.randomUUID()}`,
                  });
                  setManageMode(null);
                }
              }}
            />
          </section>
          )}
          <section className="panel">
            <h2>Categories and subcategories</h2>
            <Form
              fields={[
                { name: "name", label: "Name" },
                {
                  name: "parent_id",
                  label: "Parent",
                  required: false,
                  options: [
                    { value: "", label: "Top level" },
                    ...categories.map((c) => ({
                      value: String(c.id),
                      label: String(c.name),
                    })),
                  ],
                },
                {
                  name: "default_tax_rate",
                  label: "Default tax %",
                  type: "number",
                  value: 0,
                },
                {
                  name: "sort_order",
                  label: "Sort order",
                  type: "number",
                  value: 0,
                },
              ]}
              onSave={async (d) =>
                insert("categories", {
                  ...d,
                  parent_id: d.parent_id || null,
                  default_tax_rate: Number(d.default_tax_rate),
                  sort_order: Number(d.sort_order),
                })
              }
            />
            <label>
              Edit category
              <select
                value={String(categoryEdit?.id ?? "")}
                onChange={(e) =>
                  setCategoryEdit(
                    categories.find((c) => c.id === e.target.value) ?? null,
                  )
                }
              >
                <option value="">Choose category</option>
                {categories.map((c) => (
                  <option key={String(c.id)} value={String(c.id)}>
                    {String(c.name)}
                  </option>
                ))}
              </select>
            </label>
            {categoryEdit && (
              <Form
                key={String(categoryEdit.id)}
                fields={[
                  {
                    name: "name",
                    label: "Name",
                    value: String(categoryEdit.name),
                  },
                  {
                    name: "default_tax_rate",
                    label: "Default tax %",
                    type: "number",
                    value: Number(categoryEdit.default_tax_rate),
                  },
                  {
                    name: "sort_order",
                    label: "Sort order",
                    type: "number",
                    value: Number(categoryEdit.sort_order),
                  },
                ]}
                onSave={async (d) => {
                  const r = await supabase!
                    .from("categories")
                    .update({
                      ...d,
                      default_tax_rate: Number(d.default_tax_rate),
                      sort_order: Number(d.sort_order),
                    })
                    .eq("id", categoryEdit.id);
                  if (r.error) throw r.error;
                  setCategoryEdit(null);
                  await refresh();
                }}
              />
            )}
            <DataTable
              rows={categories}
              columns={[
                "name",
                "default_tax_rate",
                "sort_order",
                "is_archived",
              ]}
              action={(r) => (
                <button
                  onClick={() =>
                    void (async () => {
                      if (
                        !r.is_archived &&
                        !window.confirm(
                          `Archive ${String(r.name)}? Products keep their historical category data.`,
                        )
                      )
                        return;
                      const result = await supabase!
                        .from("categories")
                        .update({ is_archived: !r.is_archived })
                        .eq("id", r.id);
                      if (result.error) throw result.error;
                      await refresh();
                      notify(
                        r.is_archived
                          ? "Category restored successfully."
                          : "Category archived successfully.",
                      );
                    })().catch((e) => notify(userMessage(e)))
                  }
                >
                  {r.is_archived ? "Restore" : "Archive"}
                </button>
              )}
            />
          </section>
        </>
      )}
      {!inventory && allowed("settings.manage") && (
        <section className="panel">
          <h2>{taxEdit ? "Edit tax code" : "Tax codes"}</h2>
          <Form
            key={String(taxEdit?.id ?? "new")}
            label={taxEdit ? "Save tax code" : "Create tax code"}
            fields={[
              {
                name: "name",
                label: "Tax name",
                value: String(taxEdit?.name ?? ""),
              },
              {
                name: "code",
                label: "Code",
                value: String(taxEdit?.code ?? ""),
              },
              {
                name: "rate",
                label: "Rate (%)",
                type: "number",
                value: Number(taxEdit?.rate ?? 0),
              },
            ]}
            onSave={async (d) => {
              if (taxEdit) {
                const result = await supabase!
                  .from("tax_codes")
                  .update({ ...d, rate: Number(d.rate) })
                  .eq("id", taxEdit.id);
                if (result.error) throw result.error;
                setTaxEdit(null);
                await refresh();
                notify("Tax code updated.");
              } else {
                await insert("tax_codes", { ...d, rate: Number(d.rate) });
              }
            }}
          />
          <DataTable
            rows={taxCodes}
            columns={["name", "code", "rate", "is_active"]}
            action={(tax) => (
              <div className="actions">
                <button onClick={() => setTaxEdit(tax)}>Edit</button>
                <button
                  onClick={() =>
                    void (async () => {
                      if (
                        tax.is_active &&
                        !window.confirm(
                          `Deactivate ${String(tax.name)}? Existing invoice snapshots will remain unchanged.`,
                        )
                      )
                        return;
                      const result = await supabase!
                        .from("tax_codes")
                        .update({ is_active: !tax.is_active })
                        .eq("id", tax.id);
                      if (result.error) throw result.error;
                      await refresh();
                      notify(
                        tax.is_active
                          ? "Tax code deactivated successfully."
                          : "Tax code activated successfully.",
                      );
                    })().catch((e) => notify(userMessage(e)))
                  }
                >
                  {tax.is_active ? "Deactivate" : "Activate"}
                </button>
              </div>
            )}
          />
        </section>
      )}
      {!inventory && allowed("products.manage") && manageMode === "product" && edit && (
        <section className="panel">
          <p className="eyebrow">{String(edit.name).toUpperCase()}</p>
          <h2>Identifiers, image and label printing</h2>
          <Form
            label="Add secondary identifier"
            fields={[
              {
                name: "type",
                label: "Identifier type",
                options: ["BARCODE", "QR", "INTERNAL_CODE"].map((value) => ({
                  value,
                  label: value,
                })),
              },
              { name: "identifier_value", label: "Identifier value" },
            ]}
            onSave={async (d) =>
              insert("product_identifiers", {
                ...d,
                product_id: edit.id,
                is_primary: false,
              })
            }
          />
          <h2>Print labels</h2>
          <Form
            label="Download labels"
            fields={[
              {
                name: "format",
                label: "Code type",
                options: [
                  { value: "qr", label: "QR" },
                  { value: "barcode", label: "Code 128 barcode" },
                ],
              },
              {
                name: "count",
                label: "Label count (1–200)",
                type: "number",
                value: 1,
                min: 1,
              },
              {
                name: "width",
                label: "Width mm",
                type: "number",
                value: 40,
                min: 30,
              },
              {
                name: "height",
                label: "Height mm",
                type: "number",
                value: 25,
                min: 25,
              },
            ]}
            onSave={async (d) => {
              const {
                data: { session },
              } = await supabase!.auth.getSession();
              const params = new URLSearchParams(
                {
                  product: String(edit.id),
                  ...Object.fromEntries(
                  Object.entries(d).map(([k, v]) => [k, String(v)]),
                  ),
                },
              );
              const response = await fetch(`/api/labels?${params}`, {
                headers: { Authorization: `Bearer ${session?.access_token}` },
              });
              if (!response.ok) throw new Error("Label generation failed");
              const url = URL.createObjectURL(await response.blob());
              const a = document.createElement("a");
              a.href = url;
              a.download = "labels.pdf";
              a.click();
              URL.revokeObjectURL(url);
            }}
          />
          <label>
            Upload image for {String(edit.name)}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                void (async () => {
                  const path = `entities/${profile.entity_id}/products/${edit.id}/${crypto.randomUUID()}`;
                  const uploaded = await supabase!.storage
                    .from("product-images")
                    .upload(path, file);
                  if (uploaded.error) throw uploaded.error;
                  const saved = await supabase!
                    .from("products")
                    .update({ image_path: path })
                    .eq("id", edit.id);
                  if (saved.error) throw saved.error;
                  notify("Product image saved.");
                  await refresh();
                })().catch((e) => notify(userMessage(e)));
              }}
            />
          </label>
        </section>
      )}
      <section className="panel">
        <div className="section-heading catalog-heading">
          <div>
            <p className="eyebrow">{inventory ? "LIVE INVENTORY" : "PRODUCT MASTER"}</p>
            <h2>{inventory ? "Store stock" : "Product catalog"}</h2>
            <p>{rows.length} products on this page · use exact codes for instant lookup</p>
          </div>
          <div className="view-toggle" role="group" aria-label="Catalog view">
            <button className={catalogView === "grid" ? "active" : ""} aria-label="Grid view" onClick={() => setCatalogView("grid")}><Grid2X2 size={18} /></button>
            <button className={catalogView === "table" ? "active" : ""} aria-label="Table view" onClick={() => setCatalogView("table")}><List size={18} /></button>
          </div>
        </div>
        <div className="catalog-toolbar">
          <label className="catalog-search">
            <Search size={18} />
            <input
              aria-label="Search products"
              placeholder="Search name or exact barcode / QR / SKU"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </label>
          {!inventory && (
            <label className="check">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(e) => setIncludeArchived(e.target.checked)}
              />
              Include archived
            </label>
          )}
        </div>
        {!inventory && allowed("products.manage") && (
          <div className={`bulk-selection ${selectedProducts.size ? "active" : ""}`}>
            <span>
              <CheckSquare size={17} />
              {selectedProducts.size
                ? `${selectedProducts.size} selected`
                : "Select products to manage them together"}
            </span>
            <div className="actions">
              <button type="button" onClick={selectVisibleProducts}>
                {rows.length > 0 &&
                rows.every((row) => selectedProducts.has(String(row.id)))
                  ? "Clear page"
                  : "Select page"}
              </button>
              {selectedProducts.size > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedProducts(new Set())}
                >
                  Clear all
                </button>
              )}
              <button
                type="button"
                className="bulk-delete"
                disabled={!selectedProducts.size || deletingProducts}
                onClick={() => void deleteSelectedProducts()}
              >
                <Trash2 size={16} />
                {deletingProducts ? "Processing…" : "Delete selected"}
              </button>
            </div>
          </div>
        )}
        {catalogView === "grid" ? (
          <div className="catalog-grid">
            {rows.map((r, index) => {
              const stock = Number(r.stock ?? 0);
              const reorder = Number(r.reorder_level ?? 0);
              const pricing = productPricing(r);
              return (
                <article
                  className={`catalog-card ${selectedProducts.has(String(r.id)) ? "selected" : ""}`}
                  key={String(r.id)}
                >
                  {!inventory && allowed("products.manage") && (
                    <label className="product-select">
                      <input
                        type="checkbox"
                        aria-label={`Select ${String(r.name)}`}
                        checked={selectedProducts.has(String(r.id))}
                        onChange={(event) =>
                          selectProduct(r, event.target.checked)
                        }
                      />
                    </label>
                  )}
                  <div className={`catalog-art tone-${index % 6}`}>
                    <PackageOpen size={30} />
                    <span className={`status-pill ${stock <= 0 ? "danger" : stock <= reorder ? "warning" : "success"}`}>
                      {stock <= 0 ? "Out" : stock <= reorder ? "Low stock" : "In stock"}
                    </span>
                  </div>
                  <div className="catalog-card-copy">
                    <small>{String(r.sku ?? "No SKU")}</small>
                    <h3>{String(r.name)}</h3>
                    <div className="catalog-values">
                      <strong>{money(pricing.gross)}</strong>
                      <span>{stock} {String(r.unit ?? "")}</span>
                    </div>
                    <div className="catalog-tax">
                      <span>
                        {pricing.mode === "inclusive"
                          ? "Tax included"
                          : pricing.mode === "exclusive"
                            ? "Tax added"
                            : "No tax"}
                        {pricing.rate > 0 ? ` · ${pricing.rate}% ${taxFramework}` : ""}
                      </span>
                      {pricing.tax > 0 && (
                        <small>
                          Taxable {money(pricing.net)} · {Object.entries(
                            pricing.components,
                          )
                            .map(([name, amount]) => `${name} ${money(amount)}`)
                            .join(" + ")}
                        </small>
                      )}
                    </div>
                  </div>
                  {productActions(r)}
                </article>
              );
            })}
            {!rows.length && <p className="empty">No matching products found.</p>}
          </div>
        ) : (
          <DataTable
            rows={rows.map((row) => {
              const pricing = productPricing(row);
              return {
                ...row,
                final_price: money(pricing.gross),
                tax_details:
                  pricing.tax > 0
                    ? `${pricing.rate}% ${taxFramework} (${Object.entries(
                        pricing.components,
                      )
                        .map(([name, amount]) => `${name} ${money(amount)}`)
                        .join(" + ")})`
                    : "No tax",
              };
            })}
            columns={["name", "sku", "final_price", "tax_details", "stock", "unit", "expires_on"]}
            action={productActions}
            selected={
              !inventory && allowed("products.manage")
                ? selectedProducts
                : undefined
            }
            onSelect={
              !inventory && allowed("products.manage")
                ? selectProduct
                : undefined
            }
          />
        )}
        <div className="pagination">
          <button disabled={!page} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span>Page {page + 1}</span>
          <button disabled={rows.length < 48} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      </section>
      {inventory && allowed("transfers.manage") && (
        <section className="panel">
          <h2>Stock transfer</h2>
          <Form
            fields={[
              {
                name: "destination_store",
                label: "Destination",
                options: stores
                  .filter((s) => s.id !== storeId)
                  .map((s) => ({ value: s.id, label: s.name })),
              },
              {
                name: "product",
                label: "Product",
                options: rows.map((p) => ({
                  value: String(p.id),
                  label: String(p.name),
                })),
              },
              {
                name: "quantity",
                label: "Quantity",
                type: "number",
                step: "0.001",
              },
            ]}
            label="Request transfer"
            onSave={async (d) => {
              await rpc("request_transfer", {
                ...d,
                source_store: storeId,
                quantity: Number(d.quantity),
              });
              await refresh();
              notify("Stock transfer requested successfully.");
            }}
          />
          <DataTable
            rows={transfers}
            columns={["id", "from_store", "to_store", "status", "created_at"]}
            action={(r) => (
              <div className="actions">
                {(r.status === "requested"
                  ? ["approved", "cancelled"]
                  : r.status === "approved"
                    ? ["dispatched", "cancelled"]
                    : r.status === "dispatched"
                      ? ["received"]
                      : []
                ).map((status) => (
                  <button
                    key={status}
                    onClick={() =>
                      void (async () => {
                        if (
                          ["dispatched", "received", "cancelled"].includes(status) &&
                          !window.confirm(
                            `${status === "cancelled" ? "Cancel this transfer" : `Mark this transfer as ${status}`}?${status === "dispatched" || status === "received" ? " This changes store inventory." : ""}`,
                          )
                        )
                          return;
                        await rpc("advance_transfer", {
                          target: r.id,
                          next_status: status,
                        });
                        await refresh();
                        notify(`Transfer marked ${status} successfully.`);
                      })().catch((e) => notify(userMessage(e)))
                    }
                  >
                    {status}
                  </button>
                ))}
              </div>
            )}
          />
        </section>
      )}
      {inventory && (
        <section className="panel">
          <h2>Latest stock movements</h2>
          <DataTable
            rows={movements}
            columns={[
              "created_at",
              "product_id",
              "movement_type",
              "quantity",
              "reference_id",
            ]}
          />
        </section>
      )}
    </>
  );
}
