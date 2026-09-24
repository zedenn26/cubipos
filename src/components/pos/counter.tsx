"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  ScanLine,
  Plus,
  Minus,
  Search,
  UserRound,
  Pause,
  Banknote,
  CreditCard,
  Smartphone,
  ShoppingBasket,
  Trash2,
  CircleDot,
  RotateCcw,
  ArrowLeftRight,
  Printer,
  ReceiptText,
} from "lucide-react";
import Link from "next/link";
import { useWorkspace, rpc } from "@/components/workspace";
import { supabase } from "@/lib/supabase/client";
import {
  calculateTax,
  splitTaxComponents,
  type TaxComponents,
  type TaxMode,
} from "@/lib/pos";
import { userMessage } from "@/lib/permissions/errors";
import { CameraScanner } from "@/components/scanner/camera";
import { Form, Row, DataTable } from "@/components/operations/common";
import { Receipt } from "./receipt";
import { Button } from "@/components/ui/button";
type Product = {
  id: string;
  name: string;
  sku: string;
  selling_price: number;
  resolved_tax_rate: number;
  tax_mode: string;
  stock: number;
  unit: string;
};
type Line = Product & { quantity: number; discount_percent: number };
type CompletedReceipt = { id: string; autoPrint: boolean };
export function Counter() {
  const { storeId } = useWorkspace();
  return storeId ? (
    <ActiveCounter key={storeId} />
  ) : (
    <p className="notice">
      Select an assigned store. Your admin can create stores and assign access
      in Settings.
    </p>
  );
}
function ActiveCounter() {
  const { profile, entity, storeId, allowed, notify } = useWorkspace();
  const key = `cubipos.cart.${profile.id}.${storeId}`;
  const legacyKey = `mypos.cart.${profile.id}.${storeId}`;
  const storedCart = () =>
    localStorage.getItem(key) ?? localStorage.getItem(legacyKey) ?? "{}";
  const [lines, setLines] = useState<Line[]>(() => {
    try {
      return JSON.parse(storedCart()).lines ?? [];
    } catch {
      return [];
    }
  });
  const [requestId, setRequestId] = useState<string | null>(() => {
    try {
      return JSON.parse(storedCart()).requestId ?? null;
    } catch {
      return null;
    }
  });
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [products, setProducts] = useState<Product[]>([]);
  const [customer, setCustomer] = useState(() => {
    try {
      return JSON.parse(storedCart()).customer ?? "";
    } catch {
      return "";
    }
  });
  const [mobile, setMobile] = useState("");
  const [customers, setCustomers] = useState<Row[]>([]);
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [receipt, setReceipt] = useState<CompletedReceipt | null>(null);
  const [held, setHeld] = useState<Row[]>([]);
  const [shift, setShift] = useState<Row | null>(null);
  const [registerLoading, setRegisterLoading] = useState(true);
  const [taxFramework, setTaxFramework] = useState("GST");
  const [taxComponents, setTaxComponents] = useState<TaxComponents>((): TaxComponents =>
    String(entity.country_code).trim() === "IN"
      ? { CGST: 50, SGST: 50 }
      : { Tax: 100 },
  );
  const [payments, setPayments] = useState<
    Array<{ method: string; amount: string }>
  >(() => {
    try {
      return (
        JSON.parse(storedCart()).payments ?? [
          { method: "cash", amount: "" },
        ]
      );
    } catch {
      return [{ method: "cash", amount: "" }];
    }
  });
  const search = useRef<HTMLInputElement>(null);
  const money = (v: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: String(entity.currency_code ?? "INR"),
    }).format(v);
  const finalUnitPrice = (product: Product) =>
    calculateTax(
      Number(product.selling_price),
      Number(product.resolved_tax_rate),
      product.tax_mode.replace("_", "-") as TaxMode,
    ).gross;
  const productTaxLabel = (product: Product) =>
    product.tax_mode === "exempt" || product.tax_mode === "zero_rated"
      ? "No tax"
      : `${Number(product.resolved_tax_rate)}% ${taxFramework} included`;
  const totals = lines.map((l) =>
    calculateTax(
      Number(l.selling_price) * l.quantity * (1 - l.discount_percent / 100),
      Number(l.resolved_tax_rate),
      l.tax_mode.replace("_", "-") as TaxMode,
    ),
  );
  const total = Math.round(totals.reduce((n, t) => n + t.gross, 0) * 100) / 100;
  const componentTotals = totals.reduce<TaxComponents>((components, line) => {
    for (const [name, amount] of Object.entries(
      splitTaxComponents(line.tax, taxComponents),
    ))
      components[name] =
        Math.round(((components[name] ?? 0) + amount) * 100) / 100;
    return components;
  }, {});
  useEffect(() => {
    let active = true;
    void supabase!
      .from("entity_settings")
      .select("tax_framework,tax_components")
      .eq("entity_id", profile.entity_id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active || error || !data) return;
        setTaxFramework(String(data.tax_framework ?? "Tax"));
        if (
          data.tax_components &&
          typeof data.tax_components === "object" &&
          !Array.isArray(data.tax_components)
        )
          setTaxComponents(data.tax_components as TaxComponents);
      });
    return () => {
      active = false;
    };
  }, [profile.entity_id]);
  useEffect(() => {
    try {
      localStorage.setItem(
        key,
        JSON.stringify({ lines, requestId, payments, customer }),
      );
      localStorage.removeItem(legacyKey);
    } catch {
      notify(
        "Device storage unavailable. Keep this tab open to preserve your cart.",
      );
    }
  }, [key, legacyKey, lines, requestId, payments, customer, notify]);
  const load = useCallback(async () => {
    const result = await rpc<Product[]>("search_products", {
      target_store: storeId,
      search_text: query,
      page_number: page,
    });
    setProducts(result);
  }, [storeId, query, page]);
  const loadRegister = useCallback(async () => {
    const shiftId = await rpc<string>("ensure_daily_register", {
      target_store: storeId,
    });
    const [r, h] = await Promise.all([
      supabase!
        .from("register_shifts")
        .select("*")
        .eq("id", shiftId)
        .single(),
      supabase!
        .from("held_sales")
        .select("*")
        .eq("store_id", storeId)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    if (r.error || h.error) throw r.error || h.error;
    setShift(r.data);
    setHeld(h.data);
    setRegisterLoading(false);
  }, [storeId]);
  useEffect(() => {
    const timer = setTimeout(
      () =>
        void Promise.resolve()
          .then(load)
          .catch((e) => notify(userMessage(e))),
      200,
    );
    return () => clearTimeout(timer);
  }, [load, notify]);
  useEffect(() => {
    const refreshRegister = () =>
      void Promise.resolve()
        .then(loadRegister)
        .catch((e) => {
          setRegisterLoading(false);
          notify(userMessage(e));
        });
    refreshRegister();
    const timer = window.setInterval(refreshRegister, 60000);
    return () => window.clearInterval(timer);
  }, [loadRegister, notify]);
  const add = useCallback(
    (p: Product) => {
      if (locked.current || requestId) return;
      setRequestId(null);
      setLines((current) => {
        const line = current.find((l) => l.id === p.id);
        if ((line?.quantity ?? 0) + 1 > Number(p.stock)) {
          notify("Insufficient stock");
          return current;
        }
        return line
          ? current.map((l) =>
              l.id === p.id ? { ...l, quantity: l.quantity + 1 } : l,
            )
          : [...current, { ...p, quantity: 1, discount_percent: 0 }];
      });
    },
    [notify, requestId],
  );
  const scan = useCallback(
    (identifier: string) => {
      void rpc<Product>("resolve_product", {
        target_store: storeId,
        identifier,
      })
        .then((p) => {
          add(p);
          setQuery("");
          search.current?.focus();
        })
        .catch((e) => notify(userMessage(e)));
    },
    [storeId, add, notify],
  );
  const closeCamera = useCallback(() => setCamera(false), []);
  useEffect(() => {
    let buffer = "";
    let last = 0;
    const onKey = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement;
      if (
        ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) ||
        event.ctrlKey ||
        event.metaKey
      )
        return;
      const now = Date.now();
      if (now - last > 80) buffer = "";
      last = now;
      if (event.key === "Enter" && buffer.length > 2) {
        event.preventDefault();
        scan(buffer);
        buffer = "";
      } else if (event.key.length === 1) buffer += event.key;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scan]);
  async function act(task: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      await task();
    } catch (e) {
      notify(userMessage(e));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function checkout(mode: "print" | "view") {
    await act(async () => {
      if (!navigator.onLine) throw new Error("network offline");
      const dailyShift = await rpc<string>("ensure_daily_register", {
        target_store: storeId,
      });
      if (!shift || shift.id !== dailyShift) await loadRegister();
      const id = requestId ?? crypto.randomUUID();
      setRequestId(id);
      localStorage.setItem(
        key,
        JSON.stringify({ lines, requestId: id, payments, customer }),
      );
      const paid = payments.map((p) => ({
        method: p.method,
        amount:
          payments.length === 1 && p.amount === "" ? total : Number(p.amount),
      }));
      let result: string;
      try {
        result = await rpc<string>("checkout_v2", {
          target_store: storeId,
          lines: lines.map((l) => ({
            product_id: l.id,
            quantity: l.quantity,
            discount_percent: l.discount_percent,
          })),
          payment_lines: paid,
          request_id: id,
          target_customer: customer || null,
        });
      } catch (error) {
        if (
          typeof error === "object" &&
          error &&
          "code" in error &&
          String(error.code).match(/^(P0001|22|23)/)
        )
          setRequestId(null);
        throw error;
      }
      setLines([]);
      setRequestId(null);
      localStorage.removeItem(key);
      setReceipt({ id: result, autoPrint: mode === "print" });
      setPayments([{ method: "cash", amount: "" }]);
      await load();
      await loadRegister();
      notify(
        mode === "print"
          ? "Sale completed. Opening the thermal print flow."
          : "Sale completed. Review the receipt and print when ready.",
      );
    });
  }
  return (
    <>
      <section className={`panel register-panel ${shift ? "is-open" : ""}`}>
        <div className="register-heading">
          <span className="status-icon"><CircleDot size={18} /></span>
          <div>
            <h2>{shift ? "Daily register ready" : "Preparing today’s register"}</h2>
            <p>
              {shift
                ? `Runs automatically from ${new Date(String(shift.opened_at)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: String(entity.timezone) })} to ${new Date(String(shift.scheduled_close_at)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: String(entity.timezone) })} (${String(entity.timezone)}).`
                : "The register opens automatically for the current business day."}
            </p>
          </div>
          <span className={`status-pill ${shift ? "success" : ""}`}>
            {registerLoading ? "Starting…" : shift ? "Active today" : "Unavailable"}
          </span>
        </div>
        {shift && (
          <details className="register-actions">
            <summary>Record cash added or withdrawn</summary>
            <Form
              label="Record cash movement"
              confirmation="Record this cash movement in today’s register?"
              fields={[
                {
                  name: "action",
                  label: "Action",
                  options: ["add", "withdraw"].map((value) => ({
                    value,
                    label: value === "add" ? "Add cash" : "Withdraw cash",
                  })),
                },
                {
                  name: "amount",
                  label: "Cash amount",
                  type: "number",
                },
                {
                  name: "reason",
                  label: "Reason",
                },
              ]}
              onSave={async (d) => {
                await rpc("register_action", {
                  target_store: storeId,
                  ...d,
                  amount: Number(d.amount),
                });
                await loadRegister();
                notify("Cash movement recorded successfully.");
              }}
            />
          </details>
        )}
      </section>
      {(allowed("returns.create") || allowed("exchanges.create")) && (
        <section className="pos-menu-grid" aria-label="Point of sale actions">
          <button
            type="button"
            className="pos-menu-card primary-card"
            onClick={() => search.current?.focus()}
          >
            <span><ShoppingBasket size={22} /></span>
            <strong>New sale</strong>
            <small>Scan or choose products</small>
          </button>
          {allowed("returns.create") && (
            <Link className="pos-menu-card" href="/returns">
              <span><RotateCcw size={22} /></span>
              <strong>Return items</strong>
              <small>Select items from an invoice</small>
            </Link>
          )}
          {allowed("exchanges.create") && (
            <Link className="pos-menu-card" href="/returns">
              <span><ArrowLeftRight size={22} /></span>
              <strong>Exchange items</strong>
              <small>Return and add a replacement</small>
            </Link>
          )}
        </section>
      )}
      <div className="pos-grid">
        <section className="panel product-browser">
          <div className="section-heading">
            <div>
              <p className="eyebrow">PRODUCT CATALOG</p>
              <h2>Choose products</h2>
            </div>
            <span className="status-pill">{products.length} shown</span>
          </div>
          <div className="pos-search">
            <Search size={20} />
            <input
              ref={search}
              autoFocus
              aria-label="Scan or search product"
              placeholder="Scan barcode or search by product, SKU, QR…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  scan(query);
                }
              }}
            />
            <Button className="scan-button" onClick={() => setCamera(true)}>
              <ScanLine size={19} />
              Scan
            </Button>
          </div>
          <div className="products">
            {products.map((p, i) => (
              <button
                disabled={busy || Boolean(requestId) || Number(p.stock) <= 0}
                className="product"
                key={p.id}
                onClick={() => add(p)}
              >
                <span className={`product-art tone-${i % 6}`}>
                  <span>{p.name.slice(0, 2).toUpperCase()}</span>
                  <small className={`stock-badge ${Number(p.stock) <= 0 ? "out" : Number(p.stock) <= 5 ? "low" : ""}`}>
                    {Number(p.stock) <= 0 ? "Out of stock" : `${p.stock} ${p.unit}`}
                  </small>
                </span>
                <span className="product-copy">
                  <strong>{p.name}</strong>
                  <small>{p.sku}</small>
                  <span className="product-price">{money(finalUnitPrice(p))}</span>
                  <small>{productTaxLabel(p)}</small>
                </span>
                <span className="add-product" aria-hidden="true"><Plus size={17} /></span>
              </button>
            ))}
          </div>
          {!products.length && (
            <p className="empty">
              No products found. Search another code or ask your admin to add
              stock.
            </p>
          )}
          <div className="pagination">
            <button disabled={!page} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <span>Page {page + 1}</span>
            <button
              disabled={products.length < 48}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </section>
        <section className="panel order-panel">
          <div className="section-heading order-heading">
            <div>
              <p className="eyebrow">CURRENT SALE</p>
              <h2>Order summary</h2>
            </div>
            <span className="cart-count"><ShoppingBasket size={16} /> {lines.reduce((sum, line) => sum + Number(line.quantity), 0)}</span>
          </div>
          {requestId && (
            <p className="notice">
              Checkout result pending. Retry the same sale to safely confirm its
              status before changing the cart.
            </p>
          )}
          <div className="customer-picker">
            <UserRound size={19} />
            <div>
              <small>CUSTOMER</small>
              <input
                aria-label="Customer mobile or name"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                placeholder="Walk-in · search mobile or name"
              />
            </div>
            <button
              disabled={busy || Boolean(requestId)}
              onClick={() =>
                void act(async () => {
                  const r = await supabase!
                    .from("customers")
                    .select("id,name,mobile_normalized")
                    .or(
                      `mobile_normalized.eq.${mobile.replace(/[^+\d]/g, "") || "none"},name.ilike.*${mobile.replace(/[^\p{L}\p{N} ]/gu, "")}*`,
                    )
                    .limit(10);
                  if (r.error) throw r.error;
                  setCustomers(r.data);
                })
              }
            >
              Find
            </button>
          </div>
          {(customers.length > 0 || customer) && (
            <select
              className="customer-results"
              aria-label="Customer"
              value={customer}
              disabled={busy || Boolean(requestId)}
              onChange={(e) => {
                setCustomer(e.target.value);
                setRequestId(null);
              }}
            >
              <option value="">Walk-in customer</option>
              {customers.map((c) => (
                <option key={String(c.id)} value={String(c.id)}>
                  {String(c.name)} {String(c.mobile_normalized ?? "")}
                </option>
              ))}
            </select>
          )}
          <div className="cart-items">
          {lines.map((l, index) => (
            <div className="cart-line" key={l.id}>
              <span className={`cart-thumb tone-${index % 6}`}>{l.name.slice(0, 2).toUpperCase()}</span>
              <div className="cart-product">
                <strong>{l.name}</strong>
                <small>{money(finalUnitPrice(l))} incl. tax · {productTaxLabel(l)} · {l.sku}</small>
                <label>
                  Quantity
                  <input
                    type="number"
                    step="0.001"
                    min="0.001"
                    value={l.quantity}
                    disabled={busy || Boolean(requestId)}
                    onChange={(e) => {
                      setRequestId(null);
                      setLines(
                        lines.map((x) =>
                          x.id === l.id
                            ? { ...x, quantity: Number(e.target.value) }
                            : x,
                        ),
                      );
                    }}
                  />
                </label>
                {allowed("sales.discount") && (
                  <label>
                    Discount %
                    <input
                      type="number"
                      min="0"
                      max="100"
                      disabled={busy || Boolean(requestId)}
                      value={l.discount_percent}
                      onChange={(e) => {
                        setRequestId(null);
                        setLines(
                          lines.map((x) =>
                            x.id === l.id
                              ? {
                                  ...x,
                                  discount_percent: Number(e.target.value),
                                }
                              : x,
                          ),
                        );
                      }}
                    />
                  </label>
                )}
              </div>
              <div className="cart-line-actions">
                <strong>{money(totals[index]?.gross ?? 0)}</strong>
                <div className="quantity">
                <button
                  aria-label={`Remove ${l.name}`}
                  disabled={busy || Boolean(requestId)}
                  onClick={() => {
                    setRequestId(null);
                    setLines(lines.filter((x) => x.id !== l.id));
                  }}
                >
                  {l.quantity <= 1 ? <Trash2 size={15} /> : <Minus size={15} />}
                </button>
                <span>{l.quantity}</span>
                <button
                  aria-label={`Add ${l.name}`}
                  disabled={busy || Boolean(requestId)}
                  onClick={() => add(l)}
                >
                  <Plus size={16} />
                </button>
                </div>
              </div>
            </div>
          ))}
          </div>
          {!lines.length && <p className="empty">Scan or select a product.</p>}
          <div className="totals">
            <div className="row">
              <span>Items</span>
              <span>{lines.reduce((sum, line) => sum + Number(line.quantity), 0)}</span>
            </div>
            {Object.entries(componentTotals).map(([name, amount]) => (
              <div className="row" key={name}>
                <span>{name}</span>
                <span>{money(amount)}</span>
              </div>
            ))}
            <div className="row">
              <span>Total {taxFramework}</span>
              <span>{money(totals.reduce((n, t) => n + t.tax, 0))}</span>
            </div>
            <div className="row">
              <strong>Total</strong>
              <strong>{money(total)}</strong>
            </div>
          </div>
          <p className="payment-label">PAYMENT METHOD</p>
          <div className="payment-methods" role="group" aria-label="Payment method">
            {[
              ["cash", "Cash", Banknote],
              ["upi", "UPI", Smartphone],
              ["credit_card", "Credit", CreditCard],
              ["debit_card", "Debit", CreditCard],
            ].map(([method, label, Icon]) => (
              <button
                type="button"
                key={String(method)}
                className={payments.length === 1 && payments[0].method === method ? "active" : ""}
                disabled={busy || Boolean(requestId)}
                onClick={() => {
                  setRequestId(null);
                  setPayments([{ method: String(method), amount: "" }]);
                }}
              >
                <Icon size={17} />
                {String(label)}
              </button>
            ))}
          </div>
          {payments.map((p, i) => (
            <div className="payment-row" key={i}>
              <select
                aria-label="Payment method"
                disabled={busy || Boolean(requestId)}
                value={p.method}
                onChange={(e) => {
                  setRequestId(null);
                  setPayments(
                    payments.map((x, j) =>
                      j === i ? { ...x, method: e.target.value } : x,
                    ),
                  );
                }}
              >
                {[
                  "cash",
                  "upi",
                  "credit_card",
                  "debit_card",
                  "customer_credit",
                  "store_credit",
                ].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
              <input
                aria-label="Payment amount"
                disabled={busy || Boolean(requestId)}
                type="number"
                min="0"
                step="0.01"
                placeholder={String(total)}
                value={p.amount}
                onChange={(e) => {
                  setRequestId(null);
                  setPayments(
                    payments.map((x, j) =>
                      j === i ? { ...x, amount: e.target.value } : x,
                    ),
                  );
                }}
              />
            </div>
          ))}
          <button
            className="split-payment"
            disabled={busy || Boolean(requestId) || payments.length >= 10}
            onClick={() =>
              setPayments([...payments, { method: "cash", amount: "" }])
            }
          >
            Split payment
          </button>
          <div className="checkout-actions">
            <Button
              className="checkout-print"
              disabled={busy || !lines.length || !shift}
              onClick={() => void checkout("print")}
            >
              <Printer size={17} />
              {busy ? "Saving…" : `Complete sale & print · ${money(total)}`}
            </Button>
            <Button
              variant="outline"
              disabled={busy || !lines.length || !shift}
              onClick={() => void checkout("view")}
            >
              <ReceiptText size={17} />
              Complete sale & view
            </Button>
          </div>
          <p className="muted">
            Record only payments already received. Card and UPI processing
            happens externally.
          </p>
          {allowed("sales.hold") && (
            <button
              className="hold-sale"
              disabled={busy || Boolean(requestId) || !lines.length}
              onClick={() =>
                void act(async () => {
                  const r = await supabase!.from("held_sales").insert({
                    entity_id: profile.entity_id,
                    store_id: storeId,
                    user_id: profile.id,
                    cart: lines,
                  });
                  if (r.error) throw r.error;
                  setLines([]);
                  setRequestId(null);
                  await loadRegister();
                  notify("Sale held successfully.");
                })
              }
            >
              <Pause size={16} /> Hold sale
            </button>
          )}
        </section>
      </div>
      {held.length > 0 && (
        <section className="panel">
          <h2>Held sales</h2>
          <DataTable
            rows={held}
            columns={["created_at", "user_id"]}
            action={(r) => (
              <button
                disabled={busy || lines.length > 0}
                onClick={() =>
                  void act(async () => {
                    if (r.user_id !== profile.id) {
                      notify(
                        "Only the original cashier can resume this held sale.",
                      );
                      return;
                    }
                    const result = await supabase!
                      .from("held_sales")
                      .delete()
                      .eq("id", r.id);
                    if (result.error) throw result.error;
                    setLines(r.cart as Line[]);
                    setRequestId(null);
                    await loadRegister();
                    notify("Held sale resumed successfully.");
                  })
                }
              >
                Resume
              </button>
            )}
          />
        </section>
      )}
      {receipt && (
        <Receipt
          id={receipt.id}
          autoPrint={receipt.autoPrint}
          onClose={() => setReceipt(null)}
        />
      )}{" "}
      {camera && <CameraScanner onCode={scan} onClose={closeCamera} />}
    </>
  );
}
