"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { useWorkspace, rpc } from "@/components/workspace";
import { supabase } from "@/lib/supabase/client";
import { Row, DataTable } from "./common";
import { Receipt } from "@/components/pos/receipt";
import { userMessage } from "@/lib/permissions/errors";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  CircleDollarSign,
  ReceiptText,
  ShoppingBasket,
  BadgePercent,
  Sparkles,
  Clock3,
  Mail,
  CalendarCheck2,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";

const DAY_MS = 86_400_000;

function dateValue(value: unknown) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match
    ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : null;
}

function displayDate(value: unknown) {
  const timestamp = dateValue(value);
  return timestamp === null
    ? "Not configured"
    : new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(timestamp));
}

export function Reports({
  dashboard = false,
  salesOnly = false,
}: {
  dashboard?: boolean;
  salesOnly?: boolean;
}) {
  const { profile, entity, storeId, stores, notify, allowed } = useWorkspace();
  const [type, setType] = useState("sales");
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [filterStore, setFilterStore] = useState("");
  const [filterCashier, setFilterCashier] = useState("");
  const [cashiers, setCashiers] = useState<Array<{ id: string; name: string }>>(
    [],
  );
  const [rows, setRows] = useState<Row[]>([]);
  const [page, setPage] = useState(0);
  const [receipt, setReceipt] = useState("");
  const [busy, setBusy] = useState(false);
  const expiryTimestamp = dateValue(entity.subscription_expiry);
  const today = new Date();
  const todayTimestamp = Date.UTC(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const daysRemaining =
    expiryTimestamp === null
      ? null
      : Math.round((expiryTimestamp - todayTimestamp) / DAY_MS);
  const subscriptionTone =
    daysRemaining === null
      ? "neutral"
      : daysRemaining < 0
        ? "expired"
        : daysRemaining <= 30
          ? "warning"
          : "active";
  const subscriptionStatus =
    daysRemaining === null
      ? "Validity date pending"
      : daysRemaining < 0
        ? `Expired ${Math.abs(daysRemaining)} day${Math.abs(daysRemaining) === 1 ? "" : "s"} ago`
        : daysRemaining === 0
          ? "Expires today"
          : `${daysRemaining} day${daysRemaining === 1 ? "" : "s"} remaining`;
  const renewalEmail = `mailto:info@cubixtop.com?subject=${encodeURIComponent(
    `CubiPOS subscription extension request - ${String(entity.name ?? "Business")}`,
  )}&body=${encodeURIComponent(
    `Hello Cubixtop team,\n\nPlease review a subscription validity extension for ${String(entity.name ?? "our business")}.\nCurrent valid-until date: ${displayDate(entity.subscription_expiry)}.\nRequested by: ${profile.display_name} (${profile.email ?? profile.role}).\n\nPlease contact us with the available extension options.`,
  )}`;
  const range = useMemo(
    () => ({
      starts_at: new Date(`${from}T00:00:00`).toISOString(),
      ends_at: new Date(
        new Date(`${to}T00:00:00`).getTime() + 86400000,
      ).toISOString(),
    }),
    [from, to],
  );
  const load = useCallback(async () => {
    if (!allowed("reports.read")) return;
    setBusy(true);
    try {
      const result = await rpc<Row[]>("report_rows", {
          report_name: type,
          ...range,
          target_store: filterStore || null,
          target_cashier: type === "sales" && filterCashier ? filterCashier : null,
        });
      setRows(result);
      if (type === "sales" && !filterCashier) {
        const unique = new Map<string, string>();
        result.forEach((row) => {
          if (row.cashier_id)
            unique.set(String(row.cashier_id), String(row.cashier ?? "Cashier"));
        });
        setCashiers(
          Array.from(unique, ([id, name]) => ({ id, name })).sort((a, b) =>
            a.name.localeCompare(b.name),
          ),
        );
      }
      setPage(0);
    } catch (e) {
      notify(userMessage(e));
    } finally {
      setBusy(false);
    }
  }, [type, range, filterStore, filterCashier, notify, allowed]);
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);
  const money = (n: number) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: String(entity.currency_code ?? "INR"),
    }).format(n);
  const validSales = rows.filter((row) => row.status !== "voided");
  const salesBeforeRefunds = validSales.reduce(
    (total, row) => total + Number(row.grand_total ?? 0),
    0,
  );
  const taxTotal = validSales.reduce(
    (total, row) => total + Number(row.tax_total ?? 0),
    0,
  );
  const chart = Object.values(
    validSales.reduce<Record<string, { date: string; sales: number }>>((a, r) => {
      const date = String(r.completed_at ?? "").slice(0, 10);
      if (date) {
        a[date] ??= { date, sales: 0 };
        a[date].sales += Number(r.grand_total ?? 0);
      }
      return a;
    }, {}),
  );
  async function download(format: string) {
    setBusy(true);
    try {
      const {
        data: { session },
      } = await supabase!.auth.getSession();
      const r = await fetch("/api/export", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          report: type,
          format,
          from: range.starts_at,
          to: range.ends_at,
          store: filterStore || null,
          cashier: type === "sales" ? filterCashier || null : null,
        }),
      });
      if (!r.ok) throw new Error("Export unavailable");
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `${type}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      notify(userMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function preset(days: number) {
    setFrom(new Date(Date.now() - days * 86400000).toISOString().slice(0, 10));
    setTo(new Date().toISOString().slice(0, 10));
  }
  return (
    <>
      {dashboard && (
        <>
          <section className="dashboard-hero">
            <div className="hero-icon"><Sparkles size={25} /></div>
            <div>
              <p className="eyebrow">LIVE BUSINESS SNAPSHOT</p>
              <h2>Welcome back, {profile.display_name.split(" ")[0]}!</h2>
              <p>Sales, stock and customer activity for your authorized stores are ready below.</p>
            </div>
            <div className="hero-actions">
              {allowed("sales.create") && <Link href="/pos">Start new sale <ArrowRight size={16} /></Link>}
              {allowed("inventory.read") && <Link href="/inventory">Check inventory <ArrowRight size={16} /></Link>}
            </div>
          </section>
          {(["entity_admin", "store_manager"].includes(profile.role)) && (
            <section className={`subscription-card ${subscriptionTone}`}>
              <span className="subscription-icon">
                {subscriptionTone === "active" ? <CalendarCheck2 size={24} /> : <Clock3 size={24} />}
              </span>
              <div className="subscription-copy">
                <p className="eyebrow">SUBSCRIPTION VALIDITY</p>
                <h2>
                  {expiryTimestamp === null
                    ? "Confirm your CubiPOS validity"
                    : `Valid until ${displayDate(entity.subscription_expiry)}`}
                </h2>
                <p>
                  {subscriptionStatus}. To extend your validity, email Cubixtop.
                  After the request is reviewed and approved, the System Super
                  Admin will update this date.
                </p>
              </div>
              <dl className="subscription-dates">
                <div><dt>Started</dt><dd>{displayDate(entity.subscription_start)}</dd></div>
                <div><dt>Valid through</dt><dd>{displayDate(entity.subscription_expiry)}</dd></div>
              </dl>
              <a className="subscription-email" href={renewalEmail}>
                <Mail size={17} /> Email info@cubixtop.com
              </a>
            </section>
          )}
        </>
      )}
      <section className="panel report-filters">
        <div className="form-grid">
          {!salesOnly && (
          <label>
            Report
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setFilterCashier("");
              }}
            >
              {[
                "sales",
                "tax",
                "discounts",
                "products",
                "payments",
                "inventory",
                "low_stock",
                "expiry",
                "returns",
                "exchanges",
                "movements",
                "registers",
                ...(allowed("purchases.manage") ? ["purchases"] : []),
                ...(profile.role === "entity_admin" ? ["audit"] : []),
                ...(allowed("reports.profit") ? ["profit"] : []),
              ].map((v) => (
                <option key={v} value={v}>
                  {v.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          )}
          <label>
            From
            <input
              type="date"
              value={from}
              onChange={(e) => e.target.value && setFrom(e.target.value)}
            />
          </label>
          <label>
            Through
            <input
              type="date"
              value={to}
              onChange={(e) => e.target.value && setTo(e.target.value)}
            />
          </label>
          <label>
            Store
            <select
              value={filterStore}
              onChange={(e) => setFilterStore(e.target.value)}
            >
              <option value="">All authorized stores</option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          {type === "sales" && (
            <label>
              Cashier
              <select
                value={filterCashier}
                onChange={(event) => setFilterCashier(event.target.value)}
              >
                <option value="">All cashiers</option>
                {cashiers.map((cashier) => (
                  <option key={cashier.id} value={cashier.id}>
                    {cashier.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="actions">
          <button onClick={() => preset(0)}>Today</button>
          <button onClick={() => preset(6)}>Last 7 days</button>
          <button onClick={() => preset(29)}>Last 30 days</button>
          <button onClick={() => setFilterStore(storeId)}>Current store</button>
          <button disabled={busy} onClick={() => void load()}>
            Refresh
          </button>
          {["csv", "xlsx", "pdf"].map((f) => (
            <button key={f} disabled={busy} onClick={() => void download(f)}>
              {f.toUpperCase()}
            </button>
          ))}
        </div>
        <p className="muted">
          Dates use this device’s local timezone. Maximum one year and 10,000
          rows per report; narrow the period when the limit is reached.
        </p>
      </section>
      {type === "sales" && (
        <>
          <div className="metrics">
            {[
              { label: "Sales before refunds", value: money(salesBeforeRefunds), icon: CircleDollarSign, tone: "green" },
              { label: "Transactions", value: validSales.length, icon: ReceiptText, tone: "blue" },
              { label: "Average basket", value: money(validSales.length ? salesBeforeRefunds / validSales.length : 0), icon: ShoppingBasket, tone: "amber" },
              { label: "Tax", value: money(taxTotal), icon: BadgePercent, tone: "red" },
            ].map(({ label, value, icon: Icon, tone }) => (
              <div className="panel" key={label}>
                <span className={`metric-icon ${tone}`}><Icon size={20} /></span>
                <p>{label}</p>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          {dashboard && (
            <section className="panel">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">PERFORMANCE</p>
                  <h2>Sales trend</h2>
                </div>
                <span className="status-pill"><CalendarDays size={14} /> Selected period</span>
              </div>
              <div style={{ height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart}>
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="sales" fill="#17ad6b" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}
        </>
      )}
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{type === "sales" ? "SALES LEDGER" : "REPORT CENTER"}</p>
            <h2>{type === "sales" ? "Recent sales and receipts" : `${type.replaceAll("_", " ")} report`}</h2>
          </div>
          {type === "sales" && <span className="status-pill">Receipt numbers included</span>}
        </div>
        {type === "sales" && (
          <p className="muted">
            Sales before refunds: {money(salesBeforeRefunds)} · Transactions: {validSales.length} · Average basket: {money(validSales.length ? salesBeforeRefunds / validSales.length : 0)} · Tax: {money(taxTotal)}
          </p>
        )}
        {busy && <p>Loading…</p>}
        <DataTable
          rows={rows.slice(page * 50, page * 50 + 50)}
          columns={type === "sales"
            ? [
                "invoice_number",
                "completed_at",
                "store",
                "cashier",
                "subtotal",
                "discount_total",
                "tax_total",
                "grand_total",
                "refund_total",
                "net_sales",
                "status",
              ]
            : rows.length ? Object.keys(rows[0]).filter((k) => k !== "id") : []}
          action={
            type === "sales"
              ? (r) => (
                  <button onClick={() => setReceipt(String(r.id))}>
                    Receipt
                  </button>
                )
              : undefined
          }
        />
        <div className="row">
          <button disabled={!page} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span>
            {rows.length} records · page {page + 1}
          </span>
          <button
            disabled={(page + 1) * 50 >= rows.length}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      </section>
      {receipt && <Receipt id={receipt} onClose={() => setReceipt("")} />}
    </>
  );
}
