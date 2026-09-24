"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import bwipjs from "bwip-js/browser";
import { Download, Printer, X } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { Row } from "@/components/operations/common";
import { userMessage } from "@/lib/permissions/errors";
import { Button } from "@/components/ui/button";

const paymentLabels: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  credit_card: "Credit card",
  debit_card: "Debit card",
  customer_credit: "Customer credit",
  store_credit: "Store credit",
  exchange_credit: "Exchange credit",
};

function text(value: unknown) {
  return value == null ? "" : String(value);
}

function address(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const row = value as Row;
  if (row.formatted) return text(row.formatted);
  return [
    row.line1,
    row.line2,
    row.address,
    row.city,
    row.state,
    row.postal_code,
    row.country,
  ]
    .map(text)
    .filter(Boolean)
    .join(", ");
}

export function Receipt({
  id,
  onClose,
  autoPrint = false,
}: {
  id: string;
  onClose: () => void;
  autoPrint?: boolean;
}) {
  const [sale, setSale] = useState<Row | null>(null);
  const [items, setItems] = useState<Row[]>([]);
  const [payments, setPayments] = useState<Row[]>([]);
  const [business, setBusiness] = useState<Row>({});
  const [logoUrl, setLogoUrl] = useState("");
  const [error, setError] = useState("");
  const printed = useRef(false);
  const barcode = useRef<HTMLCanvasElement>(null);

  const load = useCallback(async () => {
    const s = await supabase!.from("sales").select("*").eq("id", id).single();
    if (s.error) throw s.error;
    const [i, p, b] = await Promise.all([
      supabase!
        .from("sale_items")
        .select(
          "product_name,sku,quantity,unit_price,discount_amount,taxable_value,tax_rate,tax_amount,tax_components,tax_code,line_total",
        )
        .eq("sale_id", id),
      supabase!.from("payments").select("method,amount").eq("sale_id", id),
      supabase!
        .from("entity_settings")
        .select("*")
        .eq("entity_id", s.data.entity_id)
        .single(),
    ]);
    if (i.error || p.error || b.error) throw i.error || p.error || b.error;
    setSale(s.data);
    setItems(i.data);
    setPayments(p.data);
    setBusiness(s.data.receipt_snapshot?.business ?? b.data);
    const logoPath = text(
      s.data.receipt_snapshot?.business?.logo_path ?? b.data.logo_path,
    );
    if (logoPath) {
      const signed = await supabase!.storage
        .from("entity-logos")
        .createSignedUrl(logoPath, 300);
      if (!signed.error) setLogoUrl(signed.data.signedUrl);
    }
  }, [id]);

  useEffect(() => {
    void Promise.resolve()
      .then(load)
      .catch((loadError) => setError(userMessage(loadError)));
  }, [load]);

  useEffect(() => {
    if (!sale || !barcode.current) return;
    try {
      bwipjs.toCanvas(barcode.current, {
        bcid: "code128",
        text: text(sale.invoice_number),
        scale: 2,
        height: 9,
        includetext: false,
        paddingwidth: 4,
        paddingheight: 1,
        backgroundcolor: "FFFFFF",
        barcolor: "111827",
      });
    } catch {
      barcode.current.hidden = true;
    }
  }, [sale]);

  const printReceipt = useCallback(async (format: "thermal" | "a4") => {
    document.documentElement.dataset.printFormat = format;
    await document.fonts?.ready;
    const images = Array.from(
      document.querySelectorAll<HTMLImageElement>(".receipt img"),
    );
    await Promise.all(
      images.map((image) => image.decode().catch(() => undefined)),
    );
    window.print();
  }, []);

  useEffect(() => {
    if (
      !autoPrint ||
      !sale ||
      items.length === 0 ||
      payments.length === 0 ||
      printed.current
    )
      return;
    printed.current = true;
    const timer = window.setTimeout(() => void printReceipt("thermal"), 350);
    return () => window.clearTimeout(timer);
  }, [autoPrint, items.length, payments.length, printReceipt, sale]);

  const snapshot = (sale?.receipt_snapshot as Row | undefined) ?? {};
  const store = (snapshot.store as Row | undefined) ?? {};
  const customer = (snapshot.customer as Row | undefined) ?? {};
  const storeName = text(
    store.name ?? business.trading_name ?? business.legal_name ?? "CubiPOS Store",
  );
  const storeAddress = address(store.address) || address(business.address);
  const storePhone = text(store.phone ?? business.phone);
  const taxNumber = text(business.gstin ?? business.tax_registration_number);
  const currency = text(sale?.currency_code || "INR");
  const money = (value: unknown) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(Number(value ?? 0));
  const quantity = (value: unknown) =>
    Number(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

  return (
    <div
      className="modal receipt-modal"
      role="dialog"
      aria-modal="true"
      aria-label="Sale receipt"
    >
      <section className="receipt" aria-live="polite">
        <div className="receipt-paper">
          {error && (
            <p className="receipt-error" role="alert">
              {error}
            </p>
          )}
          {!sale && !error && (
            <p className="receipt-loading">Preparing receipt…</p>
          )}
          {sale && (
            <>
              <header className="receipt-header">
                {logoUrl && (
                  <Image
                    className="receipt-logo"
                    src={logoUrl}
                    alt="Store logo"
                    width={180}
                    height={80}
                    unoptimized
                  />
                )}
                <h2>{storeName}</h2>
                {storeAddress && <p>{storeAddress}</p>}
                {storePhone && <p>Tel: {storePhone}</p>}
                {taxNumber && <p>Tax No: {taxNumber}</p>}
              </header>

              <div className="receipt-rule" aria-hidden="true" />
              <h3 className="receipt-title">SALES RECEIPT</h3>
              <div className="receipt-rule" aria-hidden="true" />

              <dl className="receipt-meta">
                <div>
                  <dt>Invoice</dt>
                  <dd>{text(sale.invoice_number)}</dd>
                </div>
                <div>
                  <dt>Date</dt>
                  <dd>{new Date(text(sale.completed_at)).toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Cashier</dt>
                  <dd>{text(snapshot.cashier) || "—"}</dd>
                </div>
                <div>
                  <dt>Customer</dt>
                  <dd>{text(customer.name) || "Walk-in"}</dd>
                </div>
              </dl>

              <div className="receipt-rule" aria-hidden="true" />
              <div className="receipt-item-head">
                <strong>Description</strong>
                <strong>Amount</strong>
              </div>
              <div className="receipt-items">
                {items.map((item, index) => (
                  <div
                    className="receipt-item"
                    key={`${text(item.sku)}-${index}`}
                  >
                    <div>
                      <strong>{text(item.product_name) || "Product"}</strong>
                      <small>
                        {quantity(item.quantity)} × {money(item.unit_price)}
                        {Number(item.discount_amount ?? 0) > 0
                          ? ` · Discount ${money(item.discount_amount)}`
                          : ""}
                      </small>
                      {Boolean(item.sku || item.tax_code) && (
                        <small>
                          {[
                            item.sku && `SKU ${text(item.sku)}`,
                            item.tax_code && `Tax ${text(item.tax_code)}`,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                      )}
                    </div>
                    <strong>
                      {money(
                        item.line_total ??
                          Number(item.taxable_value ?? 0) +
                            Number(item.tax_amount ?? 0),
                      )}
                    </strong>
                  </div>
                ))}
              </div>

              <div className="receipt-rule" aria-hidden="true" />
              <div className="receipt-totals">
                <div>
                  <span>Subtotal</span>
                  <span>{money(sale.subtotal)}</span>
                </div>
                {Number(sale.discount_total ?? 0) > 0 && (
                  <div>
                    <span>Discount</span>
                    <span>− {money(sale.discount_total)}</span>
                  </div>
                )}
                <div>
                  <span>Tax</span>
                  <span>{money(sale.tax_total)}</span>
                </div>
                <div className="receipt-grand-total">
                  <strong>Total</strong>
                  <strong>{money(sale.grand_total)}</strong>
                </div>
              </div>

              <div className="receipt-rule" aria-hidden="true" />
              <div className="receipt-payments">
                {payments.map((payment, index) => (
                  <div key={`${text(payment.method)}-${index}`}>
                    <span>
                      {paymentLabels[text(payment.method)] ??
                        text(payment.method).replaceAll("_", " ")}
                    </span>
                    <strong>{money(payment.amount)}</strong>
                  </div>
                ))}
              </div>

              <div className="receipt-rule" aria-hidden="true" />
              <footer className="receipt-footer">
                <strong>THANK YOU!</strong>
                <p>
                  {text(business.footer_message) ||
                    "Thank you for shopping with us."}
                </p>
                <canvas
                  ref={barcode}
                  className="receipt-barcode"
                  aria-label={`Barcode for invoice ${text(sale.invoice_number)}`}
                />
                <small>{text(sale.invoice_number)}</small>
                <small>Powered by CubiPOS by Cubixtop</small>
              </footer>
            </>
          )}
        </div>

        <div className="receipt-actions no-print">
          <Button disabled={!sale} onClick={() => void printReceipt("thermal")}>
            <Printer size={17} /> Print receipt
          </Button>
          <Button
            variant="outline"
            disabled={!sale}
            onClick={() => void printReceipt("a4")}
          >
            <Download size={17} /> A4 / save PDF
          </Button>
          <Button variant="outline" onClick={onClose}>
            <X size={17} /> Close
          </Button>
        </div>
      </section>
    </div>
  );
}
