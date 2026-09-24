"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Eye,
  Pencil,
  Phone,
  ReceiptText,
  Search,
  ShoppingBag,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { useWorkspace } from "@/components/workspace";
import { supabase } from "@/lib/supabase/client";
import { Form, type Row } from "./common";
import { Receipt } from "@/components/pos/receipt";
import { userMessage } from "@/lib/permissions/errors";

type CustomerSummary = {
  id: string;
  name: string;
  mobile_normalized: string | null;
  visits: number;
  total_purchased: number;
  last_visit: string | null;
};

type SaleItem = {
  product_name: string | null;
  sku: string | null;
  quantity: number;
  unit_price: number;
  line_total: number | null;
};

type CustomerSale = {
  id: string;
  invoice_number: string;
  completed_at: string;
  grand_total: number;
  status: string;
  store: { name?: string } | Array<{ name?: string }> | null;
  sale_items: SaleItem[];
};

function formatDate(value: string | null) {
  if (!value) return "No purchases yet";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function storeName(store: CustomerSale["store"]) {
  if (Array.isArray(store)) return store[0]?.name ?? "Store";
  return store?.name ?? "Store";
}

export function Customers() {
  const { profile, entity, notify, allowed } = useWorkspace();
  const [rows, setRows] = useState<CustomerSummary[]>([]);
  const [history, setHistory] = useState<CustomerSale[]>([]);
  const [historyCustomer, setHistoryCustomer] =
    useState<CustomerSummary | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [receipt, setReceipt] = useState("");
  const [edit, setEdit] = useState<CustomerSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const money = useCallback(
    (value: number) =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: String(entity.currency_code ?? "INR"),
      }).format(value),
    [entity.currency_code],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const name = query.replace(/[^\p{L}\p{N} ]/gu, "");
      const phone = query.replace(/[^+\d]/g, "");
      let lookup = supabase!
        .from("customers")
        .select("id,name,mobile_normalized");
      if (query.trim()) {
        const filters = [
          name ? `name.ilike.*${name}*` : null,
          phone ? `mobile_normalized.ilike.*${phone}*` : null,
        ].filter(Boolean);
        if (filters.length) lookup = lookup.or(filters.join(","));
      }
      const customers = await lookup
        .order("name")
        .range(page * 50, page * 50 + 49);
      if (customers.error) throw customers.error;

      const ids = (customers.data ?? []).map((customer) => customer.id);
      const visits = ids.length
        ? await supabase!
            .from("sales")
            .select("id,customer_id,completed_at,grand_total,status")
            .in("customer_id", ids)
            .neq("status", "voided")
            .order("completed_at", { ascending: false })
            .limit(5_000)
        : { data: [], error: null };
      if (visits.error) throw visits.error;

      const summaries = new Map<
        string,
        { visits: number; total: number; lastVisit: string | null }
      >();
      (visits.data ?? []).forEach((sale) => {
        if (!sale.customer_id) return;
        const current = summaries.get(sale.customer_id) ?? {
          visits: 0,
          total: 0,
          lastVisit: null,
        };
        current.visits += 1;
        current.total += Number(sale.grand_total ?? 0);
        if (!current.lastVisit || sale.completed_at > current.lastVisit)
          current.lastVisit = sale.completed_at;
        summaries.set(sale.customer_id, current);
      });

      setRows(
        (customers.data ?? []).map((customer) => {
          const summary = summaries.get(customer.id);
          return {
            id: customer.id,
            name: customer.name,
            mobile_normalized: customer.mobile_normalized,
            visits: summary?.visits ?? 0,
            total_purchased: summary?.total ?? 0,
            last_visit: summary?.lastVisit ?? null,
          };
        }),
      );
    } catch (error) {
      notify(userMessage(error));
    } finally {
      setLoading(false);
    }
  }, [notify, page, query]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function openHistory(customer: CustomerSummary) {
    setHistoryCustomer(customer);
    setHistory([]);
    setHistoryLoading(true);
    window.setTimeout(
      () =>
        document
          .getElementById("customer-purchase-history")
          ?.scrollIntoView({ behavior: "smooth", block: "start" }),
      0,
    );
    try {
      const result = await supabase!
        .from("sales")
        .select(
          "id,invoice_number,completed_at,grand_total,status,store:stores(name),sale_items(product_name,sku,quantity,unit_price,line_total)",
        )
        .eq("customer_id", customer.id)
        .order("completed_at", { ascending: false })
        .limit(250);
      if (result.error) throw result.error;
      setHistory((result.data ?? []) as unknown as CustomerSale[]);
    } catch (error) {
      notify(userMessage(error));
    } finally {
      setHistoryLoading(false);
    }
  }

  const purchasedItems = useMemo(() => {
    const totals = new Map<
      string,
      { name: string; sku: string; quantity: number; amount: number; orders: number }
    >();
    history
      .filter((sale) => sale.status !== "voided")
      .forEach((sale) =>
        (sale.sale_items ?? []).forEach((item) => {
          const key = item.sku || item.product_name || "product";
          const current = totals.get(key) ?? {
            name: item.product_name || "Product",
            sku: item.sku || "—",
            quantity: 0,
            amount: 0,
            orders: 0,
          };
          current.quantity += Number(item.quantity ?? 0);
          current.amount += Number(
            item.line_total ??
              Number(item.unit_price ?? 0) * Number(item.quantity ?? 0),
          );
          current.orders += 1;
          totals.set(key, current);
        }),
      );
    return Array.from(totals.values()).sort((a, b) => b.amount - a.amount);
  }, [history]);

  const historyTotal = history
    .filter((sale) => sale.status !== "voided")
    .reduce((total, sale) => total + Number(sale.grand_total ?? 0), 0);

  return (
    <>
      {allowed("customers.manage") && (
        <section className="panel customer-create-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">CUSTOMER PROFILE</p>
              <h2>{edit ? `Edit ${edit.name}` : "Create customer"}</h2>
              <p>
                Keep checkout fast with only the customer name and mobile number.
              </p>
            </div>
            <span className="customer-heading-icon">
              <UserRound size={21} />
            </span>
          </div>
          <Form
            key={String(edit?.id ?? "new")}
            label={edit ? "Save customer" : "Create customer"}
            fields={[
              {
                name: "name",
                label: "Customer name",
                value: edit?.name ?? "",
              },
              {
                name: "mobile_normalized",
                label: "Mobile number with country code",
                type: "tel",
                value: edit?.mobile_normalized ?? "",
              },
            ]}
            onSave={async (data: Row) => {
              const mobile = String(data.mobile_normalized).replace(
                /[\s()-]/g,
                "",
              );
              if (!/^\+[1-9]\d{6,14}$/.test(mobile))
                throw new Error(
                  "Use an international phone number beginning with + and the country code.",
                );
              const payload = {
                name: String(data.name).trim(),
                mobile_normalized: mobile,
              };
              const result = edit
                ? await supabase!
                    .from("customers")
                    .update(payload)
                    .eq("id", edit.id)
                : await supabase!.from("customers").insert({
                    ...payload,
                    entity_id: profile.entity_id,
                  });
              if (result.error) throw result.error;
              const wasEditing = Boolean(edit);
              setEdit(null);
              await load();
              notify(
                wasEditing
                  ? "Customer updated successfully."
                  : "Customer created successfully.",
              );
            }}
          />
          {edit && (
            <button
              type="button"
              className="customer-cancel-edit"
              onClick={() => setEdit(null)}
            >
              <X size={16} /> Cancel editing
            </button>
          )}
        </section>
      )}

      <section className="panel customer-directory-panel">
        <div className="section-heading customer-directory-heading">
          <div>
            <p className="eyebrow">CUSTOMER REPORT</p>
            <h2>Customer directory</h2>
            <p>
              See each customer&apos;s visits, purchase value and latest activity.
            </p>
          </div>
          <span className="status-pill">
            <UsersRound size={14} /> {rows.length} on this page
          </span>
        </div>

        <label className="customer-search">
          <Search size={18} />
          <input
            aria-label="Search customers"
            placeholder="Search customer name or mobile number"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
          />
        </label>

        <div className="customer-table-wrap">
          <table className="customer-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Mobile number</th>
                <th>Store visits</th>
                <th>Total purchased</th>
                <th>Last visit</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((customer) => (
                <tr key={customer.id}>
                  <td data-label="Customer">
                    <span className="customer-name">
                      <span className="customer-avatar">
                        {customer.name.trim().slice(0, 1).toUpperCase()}
                      </span>
                      <strong>{customer.name}</strong>
                    </span>
                  </td>
                  <td data-label="Mobile number">
                    <span className="customer-mobile">
                      <Phone size={14} /> {customer.mobile_normalized ?? "—"}
                    </span>
                  </td>
                  <td data-label="Store visits">
                    <strong>{customer.visits}</strong>
                  </td>
                  <td data-label="Total purchased">
                    <strong>{money(customer.total_purchased)}</strong>
                  </td>
                  <td data-label="Last visit">
                    {formatDate(customer.last_visit)}
                  </td>
                  <td data-label="Actions">
                    <div className="customer-row-actions">
                      <button
                        type="button"
                        className="primary"
                        onClick={() => void openHistory(customer)}
                      >
                        <Eye size={15} /> Purchases
                      </button>
                      {allowed("customers.manage") && (
                        <button
                          type="button"
                          onClick={() => {
                            setEdit(customer);
                            window.scrollTo({ top: 0, behavior: "smooth" });
                          }}
                        >
                          <Pencil size={15} /> Edit
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !rows.length && (
            <div className="customer-empty">
              <UserRound size={30} />
              <strong>No customers found</strong>
              <span>Create a customer or try a different search.</span>
            </div>
          )}
          {loading && <p className="customer-loading">Loading customers…</p>}
        </div>

        <div className="customer-pagination">
          <span>
            Page {page + 1} · up to 50 customers
          </span>
          <div className="actions">
            <button
              disabled={!page || loading}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </button>
            <button
              disabled={rows.length < 50 || loading}
              onClick={() => setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </section>

      {historyCustomer && (
        <section
          className="panel customer-history"
          id="customer-purchase-history"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">PURCHASE HISTORY</p>
              <h2>{historyCustomer.name}</h2>
              <p>
                {historyCustomer.mobile_normalized} · products and transactions
                visible to your role
              </p>
            </div>
            <button type="button" onClick={() => setHistoryCustomer(null)}>
              <X size={16} /> Close
            </button>
          </div>

          <div className="customer-history-metrics">
            <div>
              <span><CalendarDays size={18} /></span>
              <small>Store visits</small>
              <strong>
                {history.filter((sale) => sale.status !== "voided").length}
              </strong>
            </div>
            <div>
              <span><ShoppingBag size={18} /></span>
              <small>Products purchased</small>
              <strong>{purchasedItems.length}</strong>
            </div>
            <div>
              <span><ReceiptText size={18} /></span>
              <small>Purchase total</small>
              <strong>{money(historyTotal)}</strong>
            </div>
          </div>

          {historyLoading ? (
            <p className="customer-loading">Loading purchase history…</p>
          ) : (
            <>
              <div className="customer-history-section">
                <div className="section-heading compact">
                  <div>
                    <p className="eyebrow">PRODUCT REPORT</p>
                    <h3>What this customer purchased</h3>
                  </div>
                  <span className="status-pill">
                    {purchasedItems.length} products
                  </span>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>SKU</th>
                        <th>Quantity</th>
                        <th>Purchase lines</th>
                        <th>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {purchasedItems.map((item) => (
                        <tr key={`${item.sku}-${item.name}`}>
                          <td><strong>{item.name}</strong></td>
                          <td>{item.sku}</td>
                          <td>{item.quantity}</td>
                          <td>{item.orders}</td>
                          <td><strong>{money(item.amount)}</strong></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!purchasedItems.length && (
                    <p className="empty">No completed product purchases found.</p>
                  )}
                </div>
              </div>

              <div className="customer-history-section">
                <div className="section-heading compact">
                  <div>
                    <p className="eyebrow">TRANSACTIONS</p>
                    <h3>Invoices and receipts</h3>
                  </div>
                  <span className="status-pill">{history.length} records</span>
                </div>
                <div className="customer-sales-list">
                  {history.map((sale) => (
                    <article className="customer-sale-card" key={sale.id}>
                      <div className="customer-sale-head">
                        <span className="customer-sale-icon">
                          <ReceiptText size={18} />
                        </span>
                        <div>
                          <strong>{sale.invoice_number}</strong>
                          <small>
                            {storeName(sale.store)} · {formatDate(sale.completed_at)}
                          </small>
                        </div>
                        <span
                          className={`status-pill ${sale.status === "voided" ? "danger" : "success"}`}
                        >
                          {sale.status.replaceAll("_", " ")}
                        </span>
                        <strong className="customer-sale-total">
                          {money(Number(sale.grand_total))}
                        </strong>
                      </div>
                      <div className="customer-sale-items">
                        {(sale.sale_items ?? []).map((item, index) => (
                          <div key={`${item.sku}-${index}`}>
                            <span>
                              <strong>{item.product_name ?? "Product"}</strong>
                              <small>
                                {item.sku ?? "No SKU"} · Qty {item.quantity}
                              </small>
                            </span>
                            <strong>
                              {money(
                                Number(
                                  item.line_total ??
                                    Number(item.unit_price) * Number(item.quantity),
                                ),
                              )}
                            </strong>
                          </div>
                        ))}
                      </div>
                      <button type="button" onClick={() => setReceipt(sale.id)}>
                        <ReceiptText size={15} /> View receipt
                      </button>
                    </article>
                  ))}
                  {!history.length && (
                    <p className="empty">This customer has no purchases yet.</p>
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      )}

      {receipt && <Receipt id={receipt} onClose={() => setReceipt("")} />}
    </>
  );
}
