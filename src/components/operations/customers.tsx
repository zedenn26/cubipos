"use client";
import { useState, useEffect, useCallback } from "react";
import { useWorkspace, rpc } from "@/components/workspace";
import { supabase } from "@/lib/supabase/client";
import { DataTable, Form, Row } from "./common";
import { Receipt } from "@/components/pos/receipt";
import { userMessage } from "@/lib/permissions/errors";
export function Customers() {
  const { profile, notify, allowed } = useWorkspace();
  const [rows, setRows] = useState<Row[]>([]);
  const [history, setHistory] = useState<Row[]>([]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [receipt, setReceipt] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [selected, setSelected] = useState("");
  const [edit, setEdit] = useState<Row | null>(null);
  const load = useCallback(async () => {
    const name=query.replace(/[^\p{L}\p{N} ]/gu,'');
    const phone=query.replace(/[^+\d]/g,'');
    let lookup=supabase!.from('customers').select('*');
    if(query.trim()) { const filters=[name?`name.ilike.*${name}*`:null,phone?`mobile_normalized.ilike.*${phone}*`:null].filter(Boolean);if(filters.length)lookup=lookup.or(filters.join(',')); }
    const r=await lookup.order('name').range(page*50,page*50+49);
    if (r.error) throw r.error;
    setRows(r.data);
  }, [query, page]);
  useEffect(() => {
    const t = setTimeout(
      () =>
        void Promise.resolve()
          .then(load)
          .catch((e) => notify(userMessage(e))),
      250,
    );
    return () => clearTimeout(t);
  }, [load, notify]);
  return (
    <>
      {allowed("customers.manage") && (
        <section className="panel">
          <h2>{edit ? "Edit customer" : "Add customer"}</h2>
          <Form
            key={String(edit?.id ?? "new")}
            label={edit ? "Save customer" : "Create customer"}
            fields={[
              {
                name: "name",
                label: "Name",
                value: String(edit?.name ?? ""),
              },
              {
                name: "mobile_normalized",
                label: "International mobile (+country code)",
                type: "tel",
                required: false,
                value: String(edit?.mobile_normalized ?? ""),
              },
              {
                name: "email",
                label: "Email",
                type: "email",
                required: false,
                value: String(edit?.email ?? ""),
              },
              {
                name: "address",
                label: "Address",
                required: false,
                value:
                  typeof edit?.address === "object"
                    ? String((edit.address as Row).formatted ?? "")
                    : "",
              },
            ]}
            onSave={async (d) => {
              const mobile = String(d.mobile_normalized).replace(
                /[\s()-]/g,
                "",
              );
              if (mobile && !/^\+[1-9]\d{6,14}$/.test(mobile))
                throw new Error("Use an international phone number");
              const payload = {
                ...d,
                mobile_normalized: mobile || null,
                email: d.email || null,
                address: { formatted: d.address },
              };
              const r = edit
                ? await supabase!
                    .from("customers")
                    .update(payload)
                    .eq("id", edit.id)
                : await supabase!.from("customers").insert({
                    ...payload,
                    entity_id: profile.entity_id,
                  });
              if (r.error) throw r.error;
              setEdit(null);
              await load();
              notify(edit ? "Customer updated." : "Customer created.");
            }}
          />
        </section>
      )}
      <section className="panel">
        <h2>Customer directory</h2>
        <input
          aria-label="Search customers"
          placeholder="Name or mobile"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
        <DataTable
          rows={rows}
          columns={["name", "mobile_normalized", "email"]}
          action={(r) => (
            <div className="actions">
              {allowed("customers.manage") && (
                <button onClick={() => setEdit(r)}>Edit</button>
              )}
              <button
                onClick={() =>
                  void (async () => {
                    const h = await supabase!
                      .from("sales")
                      .select("*")
                      .eq("customer_id", r.id)
                      .order("completed_at", { ascending: false })
                      .limit(100);
                    if (h.error) throw h.error;
                    setSelected(String(r.name));
                    setCustomerId(String(r.id));
                    setHistory(h.data);
                  })().catch((e) => notify(userMessage(e)))
                }
              >
                Purchase history
              </button>
            </div>
          )}
        />
        <div className="row">
          <button disabled={!page} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <button disabled={rows.length < 50} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      </section>
      {selected && (
        <section className="panel">
          <h2>{selected} · purchase history</h2>
          {allowed("users.manage") && (
            <Form
              label="Set customer credit limit"
              fields={[
                {
                  name: "maximum",
                  label: "Maximum outstanding customer credit",
                  type: "number",
                },
              ]}
              onSave={async (d) => {
                await rpc("set_customer_credit", {
                  target: customerId,
                  maximum: Number(d.maximum),
                });
                notify("Credit limit saved.");
              }}
            />
          )}
          <DataTable
            rows={history}
            columns={[
              "invoice_number",
              "completed_at",
              "grand_total",
              "status",
            ]}
            action={(r) => (
              <button onClick={() => setReceipt(String(r.id))}>Receipt</button>
            )}
          />
        </section>
      )}
      {receipt && <Receipt id={receipt} onClose={() => setReceipt("")} />}
    </>
  );
}
