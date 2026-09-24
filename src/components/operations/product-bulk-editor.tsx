"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckSquare2,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Save,
  Search,
  Sheet,
} from "lucide-react";
import { api, rpc, useWorkspace } from "@/components/workspace";
import { supabase } from "@/lib/supabase/client";
import { userMessage } from "@/lib/permissions/errors";

type Category = {
  id: string;
  name: string;
  default_tax_rate: number;
  is_archived: boolean;
};

type TaxCode = {
  id: string;
  name: string;
  code: string;
  rate: number;
  is_active: boolean;
};

type EditableProduct = {
  id: string;
  name: string;
  description: string;
  category_id: string;
  brand: string;
  unit: string;
  sku: string;
  internal_code: string;
  barcode: string;
  qr_identifier: string;
  purchase_price: string;
  selling_price: string;
  mrp: string;
  tax_mode: "inclusive" | "exclusive" | "exempt" | "zero_rated";
  tax_rate: string;
  tax_code_id: string;
  hsn_sac: string;
  reorder_level: string;
  batch_number: string;
  manufactured_on: string;
  expires_on: string;
  is_active: boolean;
  stock: number;
};

type ProductField = keyof Omit<EditableProduct, "id" | "stock">;

const units = ["pcs", "kg", "g", "l", "ml", "box", "pack", "dozen", "bottle"];

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}

function editable(row: Record<string, unknown>): EditableProduct {
  return {
    id: text(row.id),
    name: text(row.name),
    description: text(row.description),
    category_id: text(row.category_id),
    brand: text(row.brand),
    unit: text(row.unit || "pcs"),
    sku: text(row.sku),
    internal_code: text(row.internal_code),
    barcode: text(row.barcode),
    qr_identifier: text(row.qr_identifier),
    purchase_price: text(row.purchase_price ?? 0),
    selling_price: text(row.selling_price ?? 0),
    mrp: text(row.mrp),
    tax_mode: (text(row.tax_mode || "inclusive") === "zero-rated"
      ? "zero_rated"
      : text(row.tax_mode || "inclusive")) as EditableProduct["tax_mode"],
    tax_rate: text(row.tax_rate ?? row.resolved_tax_rate ?? ""),
    tax_code_id: text(row.tax_code_id),
    hsn_sac: text(row.hsn_sac),
    reorder_level: text(row.reorder_level ?? 0),
    batch_number: text(row.batch_number),
    manufactured_on: text(row.manufactured_on),
    expires_on: text(row.expires_on),
    is_active: Boolean(row.is_active),
    stock: Number(row.stock ?? 0),
  };
}

function productErrors(product: EditableProduct) {
  const errors: string[] = [];
  if (!product.name.trim()) errors.push("Product name is required");
  if (!product.category_id) errors.push("Category is required");
  if (!product.sku.trim()) errors.push("SKU is required");
  if (!product.internal_code.trim()) errors.push("Internal code is required");
  for (const [label, raw] of [
    ["Purchase price", product.purchase_price],
    ["Selling price", product.selling_price],
    ["Reorder level", product.reorder_level],
  ]) {
    if (raw === "" || !Number.isFinite(Number(raw)) || Number(raw) < 0)
      errors.push(`${label} must be zero or more`);
  }
  if (
    product.mrp !== "" &&
    (!Number.isFinite(Number(product.mrp)) || Number(product.mrp) < 0)
  )
    errors.push("MRP must be zero or more");
  if (
    !Number.isFinite(Number(product.tax_rate)) ||
    Number(product.tax_rate) < 0 ||
    Number(product.tax_rate) > 100
  )
    errors.push("GST/tax rate must be between 0 and 100");
  if (
    (product.tax_mode === "inclusive" || product.tax_mode === "exclusive") &&
    Number(product.tax_rate) <= 0
  )
    errors.push("Taxable products need a GST/tax rate above 0%");
  if (
    product.manufactured_on &&
    product.expires_on &&
    product.expires_on < product.manufactured_on
  )
    errors.push("Expiry cannot be before manufacturing date");
  return errors;
}

export function ProductBulkEditor() {
  const { entity, storeId, allowed, notify } = useWorkspace();
  const [products, setProducts] = useState<EditableProduct[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [taxCodes, setTaxCodes] = useState<TaxCode[]>([]);
  const [taxFramework, setTaxFramework] = useState("GST");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkTaxMode, setBulkTaxMode] = useState("");
  const [bulkTaxRate, setBulkTaxRate] = useState("");
  const [bulkStatus, setBulkStatus] = useState("");
  const [priceAdjustment, setPriceAdjustment] = useState("");

  const load = useCallback(async () => {
    if (!storeId || !allowed("products.manage")) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [productRows, categoryRows, taxRows, settings] = await Promise.all([
        rpc<Record<string, unknown>[]>("search_products", {
          target_store: storeId,
          search_text: query,
          page_number: page,
          include_archived: true,
        }),
        supabase!.from("categories").select("id,name,default_tax_rate,is_archived").order("sort_order"),
        supabase!.from("tax_codes").select("id,name,code,rate,is_active").order("name"),
        supabase!.from("entity_settings").select("tax_framework").maybeSingle(),
      ]);
      if (categoryRows.error || taxRows.error || settings.error)
        throw categoryRows.error || taxRows.error || settings.error;
      setProducts(productRows.map(editable));
      setCategories((categoryRows.data ?? []) as Category[]);
      setTaxCodes((taxRows.data ?? []) as TaxCode[]);
      setTaxFramework(text(settings.data?.tax_framework || "GST"));
      setDirty(new Set());
      setSelected(new Set());
      setErrors({});
    } catch (error) {
      notify(userMessage(error));
    } finally {
      setLoading(false);
    }
  }, [allowed, notify, page, query, storeId]);

  useEffect(() => {
    void revision;
    void load();
  }, [load, revision]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty.size) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty.size]);

  const taxRates = useMemo(
    () =>
      Array.from(
        new Set(
          [
            ...(text(entity.country_code).trim() === "IN"
              ? [0, 3, 5, 12, 18, 28]
              : [0]),
            ...categories.map((category) => Number(category.default_tax_rate)),
            ...taxCodes.map((taxCode) => Number(taxCode.rate)),
            ...products.map((product) => Number(product.tax_rate)),
          ].filter((rate) => Number.isFinite(rate) && rate >= 0 && rate <= 100),
        ),
      ).sort((a, b) => a - b),
    [categories, entity.country_code, products, taxCodes],
  );

  function updateProduct(id: string, field: ProductField, value: string | boolean) {
    setProducts((current) =>
      current.map((product) => {
        if (product.id !== id) return product;
        const next = { ...product, [field]: value };
        if (
          field === "tax_mode" &&
          (value === "exempt" || value === "zero_rated")
        )
          next.tax_rate = "0";
        return next;
      }),
    );
    setDirty((current) => new Set(current).add(id));
    setErrors((current) => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function canDiscard() {
    return (
      !dirty.size ||
      window.confirm("Discard your unsaved product changes and continue?")
    );
  }

  function search(event: FormEvent) {
    event.preventDefault();
    if (!canDiscard()) return;
    setPage(0);
    setQuery(searchDraft.trim());
    if (query === searchDraft.trim()) setRevision((value) => value + 1);
  }

  function changePage(nextPage: number) {
    if (!canDiscard()) return;
    setPage(Math.max(0, nextPage));
  }

  function applyBulkValues() {
    if (!selected.size) return notify("Select at least one product row first.");
    const adjustment = priceAdjustment === "" ? null : Number(priceAdjustment);
    if (adjustment !== null && (!Number.isFinite(adjustment) || adjustment < -100 || adjustment > 1000))
      return notify("Price adjustment must be between -100% and 1000%.");
    if (
      !bulkCategory &&
      !bulkTaxMode &&
      bulkTaxRate === "" &&
      !bulkStatus &&
      adjustment === null
    )
      return notify("Choose at least one value to apply.");

    setProducts((current) =>
      current.map((product) => {
        if (!selected.has(product.id)) return product;
        const next = { ...product };
        if (bulkCategory) next.category_id = bulkCategory;
        if (bulkTaxMode)
          next.tax_mode = bulkTaxMode as EditableProduct["tax_mode"];
        if (bulkTaxRate !== "") next.tax_rate = bulkTaxRate;
        if (bulkTaxMode === "exempt" || bulkTaxMode === "zero_rated")
          next.tax_rate = "0";
        if (bulkStatus) next.is_active = bulkStatus === "active";
        if (adjustment !== null)
          next.selling_price = String(
            Math.max(
              0,
              Math.round(Number(next.selling_price || 0) * (1 + adjustment / 100) * 100) /
                100,
            ),
          );
        return next;
      }),
    );
    setDirty((current) => {
      const next = new Set(current);
      selected.forEach((id) => next.add(id));
      return next;
    });
    setErrors({});
    notify(`Applied values to ${selected.size} selected product${selected.size === 1 ? "" : "s"}. Review and save the changes.`);
  }

  async function saveChanges() {
    const changed = products.filter((product) => dirty.has(product.id));
    if (!changed.length) return;
    const validation = Object.fromEntries(
      changed
        .map((product) => [product.id, productErrors(product)] as const)
        .filter(([, messages]) => messages.length),
    );
    if (Object.keys(validation).length) {
      setErrors(validation);
      notify("Correct the highlighted product rows before saving.");
      return;
    }
    if (
      !window.confirm(
        `Save changes to ${changed.length} product${changed.length === 1 ? "" : "s"}?`,
      )
    )
      return;

    setSaving(true);
    try {
      const result = await api(
        "/api/products/bulk-edit",
        {
          products: changed.map((product) => ({
            id: product.id,
            name: product.name,
            description: product.description || null,
            category_id: product.category_id,
            brand: product.brand || null,
            unit: product.unit,
            sku: product.sku,
            internal_code: product.internal_code,
            barcode: product.barcode || null,
            qr_identifier: product.qr_identifier || null,
            purchase_price: Number(product.purchase_price),
            selling_price: Number(product.selling_price),
            mrp: product.mrp === "" ? null : Number(product.mrp),
            tax_mode: product.tax_mode,
            tax_rate: Number(product.tax_rate),
            tax_code_id: product.tax_code_id || null,
            hsn_sac: product.hsn_sac || null,
            reorder_level: Number(product.reorder_level),
            batch_number: product.batch_number || null,
            manufactured_on: product.manufactured_on || null,
            expires_on: product.expires_on || null,
            is_active: product.is_active,
          })),
        },
        "PATCH",
      );
      notify(`${Number(result.updated)} product${Number(result.updated) === 1 ? "" : "s"} updated successfully.`);
      await load();
    } catch (error) {
      notify(userMessage(error));
    } finally {
      setSaving(false);
    }
  }

  const allSelected =
    products.length > 0 && products.every((product) => selected.has(product.id));

  if (!allowed("products.manage"))
    return <p className="notice">You do not have permission to edit products.</p>;

  return (
    <div className="bulk-editor-page">
      <section className="panel bulk-editor-intro">
        <div>
          <p className="eyebrow">PRODUCT MASTER</p>
          <h2>Spreadsheet product editor</h2>
          <p>
            Edit products row by row, use Tab to move between cells, or select
            several rows and fill common price, category and {taxFramework} values.
          </p>
        </div>
        <div className="actions">
          <Link className="button-link" href="/products">
            <ArrowLeft size={17} /> Products
          </Link>
          <button
            type="button"
            disabled={!dirty.size || saving}
            onClick={() => {
              if (!canDiscard()) return;
              setRevision((value) => value + 1);
            }}
          >
            <RotateCcw size={17} /> Discard
          </button>
          <button
            type="button"
            className="primary"
            disabled={!dirty.size || saving}
            onClick={() => void saveChanges()}
          >
            <Save size={17} /> {saving ? "Saving…" : `Save ${dirty.size || ""} changes`}
          </button>
        </div>
      </section>

      <section className="panel bulk-editor-tools">
        <form className="bulk-editor-search" onSubmit={search}>
          <Search size={18} />
          <input
            aria-label="Search products"
            placeholder="Search product name or exact SKU, barcode, QR or item code"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
          />
          <button type="submit">Search</button>
        </form>

        <div className="bulk-fill-heading">
          <span><CheckSquare2 size={17} /> {selected.size} selected</span>
          <small>Blank controls keep the current value.</small>
        </div>
        <div className="bulk-fill-grid">
          <label>
            Category
            <select value={bulkCategory} onChange={(event) => setBulkCategory(event.target.value)}>
              <option value="">Keep category</option>
              {categories.filter((category) => !category.is_archived).map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </label>
          <label>
            Tax mode
            <select value={bulkTaxMode} onChange={(event) => setBulkTaxMode(event.target.value)}>
              <option value="">Keep mode</option>
              <option value="inclusive">Inclusive</option>
              <option value="exclusive">Exclusive</option>
              <option value="zero_rated">Zero rated</option>
              <option value="exempt">Tax exempt</option>
            </select>
          </label>
          <label>
            {taxFramework} rate
            <select value={bulkTaxRate} onChange={(event) => setBulkTaxRate(event.target.value)}>
              <option value="">Keep rate</option>
              {taxRates.map((rate) => <option key={rate} value={rate}>{rate}%</option>)}
            </select>
          </label>
          <label>
            Selling price change
            <div className="percent-input">
              <input
                type="number"
                min="-100"
                max="1000"
                step="0.01"
                placeholder="e.g. 5 or -10"
                value={priceAdjustment}
                onChange={(event) => setPriceAdjustment(event.target.value)}
              />
              <span>%</span>
            </div>
          </label>
          <label>
            Status
            <select value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value)}>
              <option value="">Keep status</option>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </label>
          <button type="button" className="primary bulk-apply" disabled={!selected.size} onClick={applyBulkValues}>
            Apply to selected
          </button>
        </div>
      </section>

      <section className="panel bulk-editor-grid-panel">
        <div className="section-heading bulk-grid-heading">
          <div>
            <p className="eyebrow">EDITABLE GRID</p>
            <h2>{loading ? "Loading products…" : `${products.length} products on page ${page + 1}`}</h2>
            <p>Scroll sideways for all fields. Stock is read-only and follows the inventory ledger.</p>
          </div>
          <span className="dirty-count"><Sheet size={16} /> {dirty.size} unsaved</span>
        </div>

        <div className="bulk-edit-scroll" role="region" aria-label="Editable product spreadsheet" tabIndex={0}>
          <table className="bulk-edit-table">
            <thead>
              <tr>
                <th className="bulk-sticky-select">
                  <input
                    type="checkbox"
                    aria-label="Select all products on this page"
                    checked={allSelected}
                    onChange={() =>
                      setSelected(
                        allSelected
                          ? new Set()
                          : new Set(products.map((product) => product.id)),
                      )
                    }
                  />
                </th>
                <th className="bulk-sticky-name">Product name *</th>
                <th>Category *</th>
                <th>SKU *</th>
                <th>Internal code *</th>
                <th>Barcode</th>
                <th>Brand</th>
                <th>Unit</th>
                <th className="number-column">Cost</th>
                <th className="number-column">Selling price</th>
                <th className="number-column">MRP</th>
                <th>Tax mode</th>
                <th className="tax-column">{taxFramework} % *</th>
                <th>Tax code</th>
                <th>HSN / SAC</th>
                <th className="number-column">Stock</th>
                <th className="number-column">Reorder</th>
                <th>Batch</th>
                <th>Manufactured</th>
                <th>Expiry</th>
                <th>QR identifier</th>
                <th>Description</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {!loading && !products.length && (
                <tr><td className="bulk-empty" colSpan={23}>No products matched this search.</td></tr>
              )}
              {products.map((product) => {
                const rowErrors = errors[product.id] ?? [];
                const selectedRow = selected.has(product.id);
                const dirtyRow = dirty.has(product.id);
                const input = (field: ProductField, label: string, type = "text") => (
                  <input
                    aria-label={`${label} for ${product.name}`}
                    type={type}
                    min={type === "number" ? 0 : undefined}
                    step={type === "number" ? "0.01" : undefined}
                    value={String(product[field] ?? "")}
                    onChange={(event) => updateProduct(product.id, field, event.target.value)}
                  />
                );
                return (
                  <tr key={product.id} className={`${selectedRow ? "selected" : ""} ${dirtyRow ? "dirty" : ""} ${rowErrors.length ? "invalid" : ""}`}>
                    <td className="bulk-sticky-select">
                      <input
                        type="checkbox"
                        aria-label={`Select ${product.name}`}
                        checked={selectedRow}
                        onChange={(event) =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(product.id);
                            else next.delete(product.id);
                            return next;
                          })
                        }
                      />
                    </td>
                    <td className="bulk-sticky-name">
                      {input("name", "Product name")}
                      {rowErrors.length > 0 && <small title={rowErrors.join(". ")}>{rowErrors[0]}</small>}
                    </td>
                    <td>
                      <select aria-label={`Category for ${product.name}`} value={product.category_id} onChange={(event) => updateProduct(product.id, "category_id", event.target.value)}>
                        <option value="">Select category</option>
                        {categories.map((category) => <option key={category.id} value={category.id}>{category.name} ({category.default_tax_rate}%)</option>)}
                      </select>
                    </td>
                    <td>{input("sku", "SKU")}</td>
                    <td>{input("internal_code", "Internal code")}</td>
                    <td>{input("barcode", "Barcode")}</td>
                    <td>{input("brand", "Brand")}</td>
                    <td>
                      <select aria-label={`Unit for ${product.name}`} value={product.unit} onChange={(event) => updateProduct(product.id, "unit", event.target.value)}>
                        {units.map((unit) => <option key={unit} value={unit}>{unit.toUpperCase()}</option>)}
                      </select>
                    </td>
                    <td>{input("purchase_price", "Purchase price", "number")}</td>
                    <td>{input("selling_price", "Selling price", "number")}</td>
                    <td>{input("mrp", "MRP", "number")}</td>
                    <td>
                      <select aria-label={`Tax mode for ${product.name}`} value={product.tax_mode} onChange={(event) => updateProduct(product.id, "tax_mode", event.target.value)}>
                        <option value="inclusive">Inclusive</option>
                        <option value="exclusive">Exclusive</option>
                        <option value="zero_rated">Zero rated</option>
                        <option value="exempt">Tax exempt</option>
                      </select>
                    </td>
                    <td>
                      <select aria-label={`${taxFramework} rate for ${product.name}`} value={product.tax_rate} onChange={(event) => updateProduct(product.id, "tax_rate", event.target.value)} disabled={product.tax_mode === "exempt" || product.tax_mode === "zero_rated"}>
                        <option value="">Select rate</option>
                        {taxRates.map((rate) => <option key={rate} value={rate}>{rate}%</option>)}
                      </select>
                    </td>
                    <td>
                      <select aria-label={`Tax code for ${product.name}`} value={product.tax_code_id} onChange={(event) => updateProduct(product.id, "tax_code_id", event.target.value)}>
                        <option value="">No tax code</option>
                        {taxCodes.map((taxCode) => <option key={taxCode.id} value={taxCode.id}>{taxCode.code} · {taxCode.rate}%</option>)}
                      </select>
                    </td>
                    <td>{input("hsn_sac", "HSN or SAC")}</td>
                    <td><output>{product.stock}</output></td>
                    <td>{input("reorder_level", "Reorder level", "number")}</td>
                    <td>{input("batch_number", "Batch number")}</td>
                    <td>{input("manufactured_on", "Manufacturing date", "date")}</td>
                    <td>{input("expires_on", "Expiry date", "date")}</td>
                    <td>{input("qr_identifier", "QR identifier")}</td>
                    <td>{input("description", "Description")}</td>
                    <td>
                      <select aria-label={`Status for ${product.name}`} value={product.is_active ? "active" : "archived"} onChange={(event) => updateProduct(product.id, "is_active", event.target.value === "active")}>
                        <option value="active">Active</option>
                        <option value="archived">Archived</option>
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="bulk-editor-footer">
          <span>Page {page + 1} · up to 48 products per page</span>
          <div className="actions">
            <button type="button" disabled={page === 0 || loading} onClick={() => changePage(page - 1)}><ChevronLeft size={17} /> Previous</button>
            <button type="button" disabled={products.length < 48 || loading} onClick={() => changePage(page + 1)}>Next <ChevronRight size={17} /></button>
            <button type="button" className="primary" disabled={!dirty.size || saving} onClick={() => void saveChanges()}><Save size={17} /> {saving ? "Saving…" : `Save ${dirty.size || ""} changes`}</button>
          </div>
        </div>
      </section>
    </div>
  );
}
