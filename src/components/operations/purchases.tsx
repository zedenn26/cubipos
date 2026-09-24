"use client";
import { useState, useEffect, useCallback } from "react";
import { useWorkspace, rpc } from "@/components/workspace";
import { supabase } from "@/lib/supabase/client";
import { Form, DataTable, Row } from "./common";
import { userMessage } from "@/lib/permissions/errors";
export function Purchases() {
  const { profile, storeId, notify } = useWorkspace();
  const [suppliers, setSuppliers] = useState<Row[]>([]);
  const [returnOrder, setReturnOrder] = useState<Row | null>(null);
  const [returnItems, setReturnItems] = useState<Row[]>([]);
  const [returnId, setReturnId] = useState(() => crypto.randomUUID());
  const [orders, setOrders] = useState<Row[]>([]);
  const [products, setProducts] = useState<Row[]>([]);
  const [supplierEdit, setSupplierEdit] = useState<Row | null>(null);
  const refresh = useCallback(async () => {
    if (!storeId) return;
    const [s, o, p] = await Promise.all([
      supabase!.from("suppliers").select("*").order("name").limit(100),
      supabase!
        .from("purchase_orders")
        .select("*")
        .eq("store_id", storeId)
        .order("created_at", { ascending: false })
        .limit(50),
      rpc<Row[]>("search_products", { target_store: storeId }),
    ]);
    if (s.error || o.error) throw s.error || o.error;
    setSuppliers(s.data);
    setOrders(o.data);
    setProducts(p);
  }, [storeId]);
  useEffect(() => {
    void Promise.resolve()
      .then(refresh)
      .catch((e) => notify(userMessage(e)));
  }, [refresh, notify]);
  return (
    <>
      <section className="panel">
        <h2>{supplierEdit ? "Edit supplier" : "Add supplier"}</h2>
        <Form
          key={String(supplierEdit?.id ?? "new")}
          label={supplierEdit ? "Save supplier" : "Create supplier"}
          fields={[
            {
              name: "name",
              label: "Supplier name",
              value: String(supplierEdit?.name ?? ""),
            },
            {
              name: "email",
              label: "Email",
              type: "email",
              required: false,
              value: String(supplierEdit?.email ?? ""),
            },
            {
              name: "phone",
              label: "Phone",
              required: false,
              value: String(supplierEdit?.phone ?? ""),
            },
            {
              name: "tax_number",
              label: "Tax number",
              required: false,
              value: String(supplierEdit?.tax_number ?? ""),
            },
            {
              name: "address",
              label: "Address",
              required: false,
              value: String(supplierEdit?.address ?? ""),
            },
          ]}
          onSave={async (d) => {
            const r = supplierEdit
              ? await supabase!
                  .from("suppliers")
                  .update({ ...d, email: d.email || null })
                  .eq("id", supplierEdit.id)
              : await supabase!
                  .from("suppliers")
                  .insert({ ...d, entity_id: profile.entity_id });
            if (r.error) throw r.error;
            setSupplierEdit(null);
            await refresh();
            notify(
              supplierEdit
                ? "Supplier updated successfully."
                : "Supplier created successfully.",
            );
          }}
        />
        <DataTable
          rows={suppliers}
          columns={["name", "phone", "email", "tax_number"]}
          action={(supplier) => (
            <button onClick={() => setSupplierEdit(supplier)}>Edit</button>
          )}
        />
      </section>
      <section className="panel">
        <h2>Create purchase order</h2>
        <Form
          fields={[
            {
              name: "supplier",
              label: "Supplier",
              options: suppliers.map((s) => ({
                value: String(s.id),
                label: String(s.name),
              })),
            },
            {
              name: "product",
              label: "Product",
              options: products.map((p) => ({
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
            { name: "unit_cost", label: "Unit cost", type: "number" },
            { name: "invoice", label: "Supplier invoice", required: false },
          ]}
          onSave={async (d) => {
            await rpc("create_purchase", {
              target_store: storeId,
              supplier: d.supplier,
              invoice: d.invoice,
              items: [
                {
                  product_id: d.product,
                  quantity: Number(d.quantity),
                  unit_cost: Number(d.unit_cost),
                },
              ],
            });
            await refresh();
            notify("Purchase order created successfully.");
          }}
        />
      </section>
      <section className="panel">
        <h2>Purchase orders</h2>
        <DataTable
          rows={orders}
          columns={[
            "id",
            "supplier_invoice",
            "status",
            "created_at",
            "received_at",
          ]}
          action={(r) =>
            r.status === "received" ? (
              <button
                onClick={() =>
                  void (async () => {
                    const result = await supabase!
                      .from("purchase_items")
                      .select("*")
                      .eq("purchase_id", r.id);
                    if (result.error) throw result.error;
                    setReturnOrder(r);
                    setReturnItems(result.data);
                    setReturnId(crypto.randomUUID());
                  })().catch((e) => notify(userMessage(e)))
                }
              >
                Return to supplier
              </button>
            ) : (
              r.status === "ordered" && (
                <button
                  onClick={() =>
                    void (async () => {
                      if (
                        !window.confirm(
                          "Receive this purchase now? Product stock will be increased and the receipt cannot be applied twice.",
                        )
                      )
                        return;
                      await rpc("receive_purchase", { target: r.id });
                      await refresh();
                      notify("Goods received and stock updated successfully.");
                    })().catch((e) => notify(userMessage(e)))
                  }
                >
                  Receive goods
                </button>
              )
            )
          }
        />
      </section>
      {returnOrder && (
        <section className="panel">
          <h2>Return received goods to supplier</h2>
          <Form
            label="Record supplier return"
            confirmation="Record this supplier return and reduce the available stock?"
            fields={[
              {
                name: "item",
                label: "Purchase item",
                options: returnItems.map((i) => ({
                  value: String(i.id),
                  label: `${i.product_id} · ${i.quantity} received`,
                })),
              },
              {
                name: "quantity",
                label: "Quantity",
                type: "number",
                step: "0.001",
              },
              { name: "reason", label: "Reason" },
            ]}
            onSave={async (d) => {
              await rpc("return_purchase", {
                target: returnOrder.id,
                item: d.item,
                quantity: Number(d.quantity),
                reason: d.reason,
                request_id: returnId,
              });
              setReturnOrder(null);
              notify("Supplier return saved and stock reduced.");
              await refresh();
            }}
          />
        </section>
      )}
    </>
  );
}
