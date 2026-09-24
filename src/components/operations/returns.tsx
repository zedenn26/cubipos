"use client";

import { useMemo, useState } from "react";
import { ArrowLeftRight, CheckSquare, RotateCcw, Square } from "lucide-react";
import { useWorkspace, rpc } from "@/components/workspace";
import { supabase } from "@/lib/supabase/client";
import { Form, DataTable, Row } from "./common";
import { Receipt } from "@/components/pos/receipt";
import { userMessage } from "@/lib/permissions/errors";
import { calculateTax, TaxMode } from "@/lib/pos";

type Mode = "return" | "exchange";
type SelectedLine = { quantity: string; disposition: string };

export function Returns() {
  const { storeId, entity, notify, allowed } = useWorkspace();
  const [sales, setSales] = useState<Row[]>([]);
  const [sale, setSale] = useState<Row | null>(null);
  const [items, setItems] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Record<string, SelectedLine>>({});
  const [receipt, setReceipt] = useState("");
  const [mode, setMode] = useState<Mode>(
    allowed("returns.create") ? "return" : "exchange",
  );
  const [replacement, setReplacement] = useState<Row | null>(null);
  const [replacementQuantity, setReplacementQuantity] = useState(1);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  const money = (value: unknown) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: String(entity.currency_code ?? "INR"),
    }).format(Number(value ?? 0));

  const selectedLines = useMemo(
    () =>
      items
        .filter((item) => selected[String(item.id)])
        .map((item) => ({ item, selection: selected[String(item.id)] })),
    [items, selected],
  );
  const eligibleItems = items.filter(
    (item) => Number(item.available_quantity) > 0,
  );
  const allEligibleSelected =
    eligibleItems.length > 0 &&
    eligibleItems.every((item) => selected[String(item.id)]);

  const returnCredit = selectedLines.reduce((total, { item, selection }) => {
    const quantity = Number(selection.quantity || 0);
    const originalQuantity = Number(item.quantity || 0);
    const available = Number(item.available_quantity || 0);
    const remainingAmount =
      Number(item.line_total || 0) - Number(item.returned_amount || 0);
    const amount =
      quantity === available
        ? remainingAmount
        : Math.round(
            (Number(item.line_total || 0) * quantity * 100) /
              originalQuantity,
          ) / 100;
    return total + amount;
  }, 0);

  const replacementTotal = replacement
    ? calculateTax(
        Number(replacement.selling_price || 0) * replacementQuantity,
        Number(replacement.resolved_tax_rate || 0),
        String(replacement.tax_mode || "exclusive").replace(
          "_",
          "-",
        ) as TaxMode,
      ).gross
    : 0;
  const differenceDue =
    Math.round(Math.max(replacementTotal - returnCredit, 0) * 100) / 100;

  async function chooseSale(original: Row) {
    const itemResult = await supabase!
      .from("sale_items")
      .select(
        "id,product_name,sku,quantity,unit_price,taxable_value,tax_amount,line_total",
      )
      .eq("sale_id", original.id);
    if (itemResult.error) throw itemResult.error;
    const ids = itemResult.data.map((item) => item.id);
    const previous = ids.length
      ? await supabase!
          .from("return_items")
          .select("sale_item_id,quantity,amount")
          .in("sale_item_id", ids)
      : { data: [], error: null };
    if (previous.error) throw previous.error;
    const totals = new Map<string, { quantity: number; amount: number }>();
    for (const line of previous.data ?? []) {
      const key = String(line.sale_item_id);
      const current = totals.get(key) ?? { quantity: 0, amount: 0 };
      current.quantity += Number(line.quantity);
      current.amount += Number(line.amount);
      totals.set(key, current);
    }
    setItems(
      itemResult.data.map((item) => ({
        ...item,
        returned_quantity: totals.get(String(item.id))?.quantity ?? 0,
        returned_amount: totals.get(String(item.id))?.amount ?? 0,
        available_quantity:
          Number(item.quantity) -
          (totals.get(String(item.id))?.quantity ?? 0),
      })),
    );
    setSelected({});
    setReplacement(null);
    setReplacementQuantity(1);
    setSale(original);
    setRequestId(crypto.randomUUID());
  }

  function toggleItem(item: Row) {
    const id = String(item.id);
    setSelected((current) => {
      const next = { ...current };
      if (next[id]) delete next[id];
      else
        next[id] = {
          quantity: String(Math.min(1, Number(item.available_quantity))),
          disposition: "restocked",
        };
      return next;
    });
  }

  function selectAllEligible() {
    if (allEligibleSelected) {
      setSelected({});
      return;
    }
    setSelected(
      Object.fromEntries(
        eligibleItems.map((item) => [
          String(item.id),
          {
            quantity: String(Number(item.available_quantity)),
            disposition: "restocked",
          },
        ]),
      ),
    );
  }

  return (
    <>
      <section className="return-mode-grid" aria-label="Return or exchange mode">
        {allowed("returns.create") && (
          <button
            type="button"
            className={`return-mode-card ${mode === "return" ? "active" : ""}`}
            onClick={() => {
              setMode("return");
              setReplacement(null);
            }}
          >
            <RotateCcw size={23} />
            <span><strong>Return items</strong><small>Refund selected invoice lines</small></span>
          </button>
        )}
        {allowed("exchanges.create") && (
          <button
            type="button"
            className={`return-mode-card ${mode === "exchange" ? "active" : ""}`}
            onClick={() => setMode("exchange")}
          >
            <ArrowLeftRight size={23} />
            <span><strong>Exchange items</strong><small>Select returned lines and a replacement</small></span>
          </button>
        )}
      </section>

      <section className="panel">
        <h2>Find original invoice</h2>
        <Form
          label="Find invoice"
          fields={[
            {
              name: "invoice",
              label: "Invoice number (leave blank for recent sales)",
              required: false,
            },
          ]}
          onSave={async (data) => {
            let query = supabase!
              .from("sales")
              .select("*")
              .eq("store_id", storeId)
              .order("completed_at", { ascending: false })
              .limit(30);
            if (data.invoice) query = query.eq("invoice_number", data.invoice);
            const result = await query;
            if (result.error) throw result.error;
            setSales(result.data);
          }}
        />
        <DataTable
          rows={sales}
          columns={["invoice_number", "completed_at", "grand_total", "status"]}
          action={(row) => (
            <div className="actions">
              <button onClick={() => setReceipt(String(row.id))}>Receipt</button>
              <button
                onClick={() =>
                  void chooseSale(row).catch((error) =>
                    notify(userMessage(error)),
                  )
                }
              >
                Select items
              </button>
            </div>
          )}
        />
      </section>

      {sale && (
        <section className="panel return-workspace">
          <div className="section-heading">
            <div>
              <p className="eyebrow">{mode.toUpperCase()}</p>
              <h2>{String(sale.invoice_number)}</h2>
              <p>Select every invoice item included in this {mode}.</p>
            </div>
            <button type="button" onClick={selectAllEligible}>
              {allEligibleSelected ? (
                <Square size={16} />
              ) : (
                <CheckSquare size={16} />
              )}
              {allEligibleSelected ? "Clear selection" : "Select all"}
            </button>
          </div>

          <div className="return-item-list">
            {items.map((item) => {
              const id = String(item.id);
              const line = selected[id];
              const available = Number(item.available_quantity);
              return (
                <article
                  className={`return-item ${line ? "selected" : ""} ${available <= 0 ? "unavailable" : ""}`}
                  key={id}
                >
                  <label className="return-item-check">
                    <input
                      type="checkbox"
                      disabled={available <= 0}
                      checked={Boolean(line)}
                      onChange={() => toggleItem(item)}
                    />
                    <span>
                      <strong>{String(item.product_name)}</strong>
                      <small>
                        {String(item.sku ?? "")} · Purchased {String(item.quantity)} · Available {available}
                      </small>
                    </span>
                  </label>
                  <strong>{money(item.line_total)}</strong>
                  {line && (
                    <div className="return-item-controls">
                      <label>
                        Quantity
                        <input
                          type="number"
                          min="0.001"
                          max={available}
                          step="0.001"
                          value={line.quantity}
                          onChange={(event) =>
                            setSelected((current) => ({
                              ...current,
                              [id]: { ...current[id], quantity: event.target.value },
                            }))
                          }
                        />
                      </label>
                      <label>
                        Stock disposition
                        <select
                          value={line.disposition}
                          onChange={(event) =>
                            setSelected((current) => ({
                              ...current,
                              [id]: { ...current[id], disposition: event.target.value },
                            }))
                          }
                        >
                          {[
                            ["restocked", "Return to stock"],
                            ["damaged", "Damaged"],
                            ["quarantined", "Quarantine"],
                            ["disposed", "Dispose"],
                          ].map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          <div className="return-credit-summary">
            <span>{selectedLines.length} line{selectedLines.length === 1 ? "" : "s"} selected</span>
            <strong>Estimated return value {money(returnCredit)}</strong>
          </div>

          {mode === "exchange" && (
            <>
              <Form
                label="Find replacement"
                fields={[
                  {
                    name: "identifier",
                    label: "Replacement barcode / QR / SKU",
                  },
                ]}
                onSave={async (data) => {
                  setReplacement(
                    await rpc<Row>("resolve_product", {
                      target_store: storeId,
                      identifier: data.identifier,
                    }),
                  );
                }}
              />
              {replacement && (
                <div className="replacement-card">
                  <div>
                    <small>REPLACEMENT</small>
                    <strong>{String(replacement.name)}</strong>
                    <span>{money(replacement.selling_price)} each</span>
                  </div>
                  <label>
                    Quantity
                    <input
                      type="number"
                      min="0.001"
                      max={Number(replacement.stock)}
                      step="0.001"
                      value={replacementQuantity}
                      onChange={(event) =>
                        setReplacementQuantity(Number(event.target.value))
                      }
                    />
                  </label>
                  <button type="button" onClick={() => setReplacement(null)}>Remove</button>
                </div>
              )}
            </>
          )}

          <Form
            key={`${mode}-${requestId}`}
            label={mode === "exchange" ? "Process selected exchange" : "Process selected return"}
            confirmation={
              mode === "exchange"
                ? "Process the selected exchange? Returned items, replacement stock and the payment difference will be recorded together."
                : "Process the selected return and record its refund and stock movements?"
            }
            fields={[
              { name: "reason", label: `${mode === "exchange" ? "Exchange" : "Return"} reason` },
              {
                name: "method",
                label: mode === "exchange" ? "Payment method for amount due" : "Refund method",
                options: [
                  "cash",
                  "upi",
                  "card",
                  ...(mode === "return" ? ["store_credit", "customer_credit"] : []),
                ].map((value) => ({ value, label: value.replaceAll("_", " ") })),
              },
            ]}
            onSave={async (data) => {
              if (!selectedLines.length) throw new Error("Select at least one item");
              const returnLines = selectedLines.map(({ item, selection }) => {
                const quantity = Number(selection.quantity);
                if (
                  !Number.isFinite(quantity) ||
                  quantity <= 0 ||
                  quantity > Number(item.available_quantity)
                )
                  throw new Error("Invalid return quantity");
                return {
                  sale_item_id: item.id,
                  quantity,
                  disposition: selection.disposition,
                };
              });
              await rpc("ensure_daily_register", { target_store: storeId });
              if (mode === "exchange") {
                if (!replacement) throw new Error("Select a replacement product");
                if (
                  !Number.isFinite(replacementQuantity) ||
                  replacementQuantity <= 0 ||
                  replacementQuantity > Number(replacement.stock)
                )
                  throw new Error("Invalid replacement quantity");
                await rpc("process_exchange", {
                  original_sale: sale.id,
                  return_lines: returnLines,
                  replacement_lines: [
                    {
                      product_id: replacement.id,
                      quantity: replacementQuantity,
                    },
                  ],
                  payment_lines:
                    differenceDue > 0
                      ? [{ method: data.method, amount: differenceDue }]
                      : [],
                  reason: data.reason,
                  request_id: requestId,
                });
                notify(
                  differenceDue > 0
                    ? `Exchange processed. Additional payment recorded: ${money(differenceDue)}.`
                    : "Exchange processed successfully.",
                );
              } else {
                await rpc("process_return", {
                  original_sale: sale.id,
                  items: returnLines,
                  reason: data.reason,
                  refund_method: data.method,
                  request_id: requestId,
                });
                notify("Return processed successfully with all selected items.");
              }
              setSale(null);
              setItems([]);
              setSelected({});
              setReplacement(null);
              setReplacementQuantity(1);
              setRequestId(crypto.randomUUID());
            }}
          />

          {mode === "exchange" && replacement && (
            <div className="exchange-summary">
              <span>Return credit <strong>{money(returnCredit)}</strong></span>
              <span>Replacement total <strong>{money(replacementTotal)}</strong></span>
              <span>Amount due <strong>{money(differenceDue)}</strong></span>
            </div>
          )}
        </section>
      )}
      {receipt && <Receipt id={receipt} onClose={() => setReceipt("")} />}
    </>
  );
}
