"use client";
import { useEffect, useState, useCallback } from "react";
import { useWorkspace, rpc, api } from "@/components/workspace";
import { supabase } from "@/lib/supabase/client";
import { Form, DataTable, Row } from "./common";
import { userMessage } from "@/lib/permissions/errors";
export function SettingsPanel() {
  const { profile, entity, stores, refresh, notify, allowed } = useWorkspace();
  const [settings, setSettings] = useState<Row | null>(null);
  const [team, setTeam] = useState<Row[]>([]);
  const [sessions, setSessions] = useState<Row[]>([]);
  const [permissions, setPermissions] = useState<Row[]>([]);
  const [member, setMember] = useState<Row | null>(null);
  const [userEdit, setUserEdit] = useState<Row | null>(null);
  const [storeEdit, setStoreEdit] = useState<Row | null>(null);
  const [assigned, setAssigned] = useState<string[]>([]);
  const [grants, setGrants] = useState<
    Record<string, { allowed: boolean; max_discount_percent: number }>
  >({});
  const load = useCallback(async () => {
    const [s, t, a, p] = await Promise.all([
      supabase!
        .from("entity_settings")
        .select("*")
        .eq("entity_id", profile.entity_id)
        .maybeSingle(),
      supabase!.from("profiles").select("*").order("display_name"),
      supabase!
        .from("entity_sessions")
        .select("*")
        .order("last_activity", { ascending: false })
        .limit(100),
      supabase!.from("permissions").select("*").order("code"),
    ]);
    if (s.error || t.error || a.error || p.error)
      throw s.error || t.error || a.error || p.error;
    setSettings(s.data ?? {});
    setTeam(t.data ?? []);
    setSessions(a.data ?? []);
    setPermissions(p.data ?? []);
  }, [profile.entity_id]);
  useEffect(() => {
    void Promise.resolve()
      .then(load)
      .catch((e) => notify(userMessage(e)));
  }, [load, notify]);
  return (
    <>
      {allowed("settings.manage") && settings && (
        <section className="panel">
          <h2>
            {settings.onboarding_completed
              ? "Company & tax settings"
              : "Welcome — complete business setup"}
          </h2>
          <p>
            {String(entity.country_code)} · {String(entity.currency_code)} ·{" "}
            {String(entity.timezone)}. Configure the taxes that apply to your
            business before your first sale.
          </p>
          <Form
            key={String(settings.updated_at ?? "new")}
            fields={[
              {
                name: "trading_name",
                label: "Trading name",
                value: String(settings.trading_name ?? entity.name ?? ""),
              },
              {
                name: "legal_name",
                label: "Legal company name",
                value: String(settings.legal_name ?? ""),
              },
              {
                name: "business_type",
                label: "Business type",
                value: String(settings.business_type ?? ""),
              },
              {
                name: "phone",
                label: "Phone",
                value: String(settings.phone ?? ""),
              },
              {
                name: "email",
                label: "Email",
                type: "email",
                value: String(settings.email ?? ""),
              },
              {
                name: "website",
                label: "Website",
                required: false,
                value: String(settings.website ?? ""),
              },
              {
                name: "address",
                label: "Full address",
                value:
                  typeof settings.address === "object"
                    ? String((settings.address as Row)?.formatted ?? "")
                    : String(settings.address ?? ""),
              },
              {
                name: "gstin",
                label: "Tax registration number",
                required: false,
                value: String(settings.gstin ?? ""),
              },
              {
                name: "registration_number",
                label: "Company registration number",
                required: false,
                value: String(settings.registration_number ?? ""),
              },
              {
                name: "tax_framework",
                label: "Tax framework",
                options: ["GST", "VAT", "Sales Tax", "Other"].map((value) => ({
                  value,
                  label: value,
                })),
                value: String(settings.tax_framework ?? "GST"),
              },
              {
                name: "footer_message",
                label: "Receipt footer",
                required: false,
                value: String(settings.footer_message ?? ""),
              },
              {
                name: "tax_components",
                label: "Invoice tax components",
                options:
                  String(entity.country_code).trim() === "IN"
                    ? [
                        {
                          value: '{"CGST":50,"SGST":50}',
                          label: "CGST + SGST (equal split)",
                        },
                        {
                          value: '{"IGST":100}',
                          label: "IGST",
                        },
                        {
                          value: '{"GST":100}',
                          label: "GST (single component)",
                        },
                      ]
                    : [
                        {
                          value: JSON.stringify({
                            [String(settings.tax_framework ?? "Tax")]: 100,
                          }),
                          label: `${String(settings.tax_framework ?? "Tax")} (single component)`,
                        },
                      ],
                value: JSON.stringify(
                  settings.tax_components ??
                    (String(entity.country_code).trim() === "IN"
                      ? { CGST: 50, SGST: 50 }
                      : { [String(settings.tax_framework ?? "Tax")]: 100 }),
                ),
              },
              {
                name: "tax_confirmed",
                label: "Tax settings",
                options: [
                  {
                    value: "false",
                    label: "Setup incomplete — checkout disabled",
                  },
                  {
                    value: "true",
                    label:
                      "I have configured the applicable category / product tax rates",
                  },
                ],
                value: String(settings.tax_confirmed ?? false),
              },
            ]}
            onSave={async (d) => {
              const result = await supabase!.from("entity_settings").upsert({
                ...d,
                entity_id: profile.entity_id,
                address: { formatted: d.address },
                tax_confirmed: d.tax_confirmed === "true",
                tax_components: JSON.parse(String(d.tax_components)),
                onboarding_completed: true,
                updated_at: new Date().toISOString(),
              });
              if (result.error) throw result.error;
              await load();
              notify("Business settings saved.");
            }}
          />
          <label>
            Optional receipt logo
            <small>
              Upload only if this entity should print a logo. Otherwise receipts
              use the store name, then the entity name.
            </small>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                void (async () => {
                  const path = `entities/${profile.entity_id}/${crypto.randomUUID()}`;
                  const r = await supabase!.storage
                    .from("entity-logos")
                    .upload(path, file);
                  if (r.error) throw r.error;
                  const saved = await supabase!
                    .from("entity_settings")
                    .update({ logo_path: path })
                    .eq("entity_id", profile.entity_id);
                  if (saved.error) throw saved.error;
                  notify("Logo uploaded.");
                })().catch((e) => notify(userMessage(e)));
              }}
            />
          </label>
        </section>
      )}
      {allowed("stores.manage") && (
        <section className="panel">
          <h2>Stores · limit {String(entity.max_stores)}</h2>
          <Form
            fields={[
              { name: "name", label: "Store name" },
              { name: "code", label: "Store code" },
              { name: "phone", label: "Store phone", required: false },
              {
                name: "email",
                label: "Store email",
                type: "email",
                required: false,
              },
            ]}
            label="Create store"
            onSave={async (d) => {
              const r = await supabase!
                .from("stores")
                .insert({ ...d, entity_id: profile.entity_id });
              if (r.error) throw r.error;
              await refresh();
              notify("Store created successfully.");
            }}
          />
          {storeEdit && (
            <Form
              key={String(storeEdit.id)}
              label="Save store"
              fields={[
                {
                  name: "name",
                  label: "Store name",
                  value: String(storeEdit.name),
                },
                {
                  name: "code",
                  label: "Store code",
                  value: String(storeEdit.code),
                },
                {
                  name: "phone",
                  label: "Store phone",
                  required: false,
                  value: String(storeEdit.phone ?? ""),
                },
                {
                  name: "email",
                  label: "Store email",
                  type: "email",
                  required: false,
                  value: String(storeEdit.email ?? ""),
                },
              ]}
              onSave={async (d) => {
                const result = await supabase!
                  .from("stores")
                  .update({ ...d, email: d.email || null })
                  .eq("id", storeEdit.id);
                if (result.error) throw result.error;
                setStoreEdit(null);
                await refresh();
                notify("Store updated.");
              }}
            />
          )}
          <DataTable
            rows={stores as unknown as Row[]}
            columns={["name", "code", "is_active"]}
            action={(store) => (
              <div className="actions">
                <button onClick={() => setStoreEdit(store)}>Edit</button>
                <button
                  onClick={() =>
                    void (async () => {
                      if (
                        store.is_active &&
                        !window.confirm(
                          `Deactivate ${String(store.name)}? Checkout and store operations will stop until it is activated again.`,
                        )
                      )
                        return;
                      const r = await supabase!
                        .from("stores")
                        .update({ is_active: !store.is_active })
                        .eq("id", store.id);
                      if (r.error) throw r.error;
                      await refresh();
                      notify(
                        store.is_active
                          ? "Store deactivated successfully."
                          : "Store activated successfully.",
                      );
                    })().catch((e) => notify(userMessage(e)))
                  }
                >
                  {store.is_active ? "Deactivate" : "Activate"}
                </button>
              </div>
            )}
          />
        </section>
      )}
      {allowed("users.manage") && (
        <>
          <section className="panel">
            <h2>Create user · limit {String(entity.max_users)}</h2>
            <Form
              fields={[
                { name: "display_name", label: "Full name" },
                { name: "email", label: "Email", type: "email" },
                {
                  name: "password",
                  label: "Initial password (12+ characters)",
                  type: "password",
                },
                {
                  name: "password_confirmation",
                  label: "Confirm initial password",
                  type: "password",
                },
                {
                  name: "role",
                  label: "Role",
                  options: [
                    "entity_admin",
                    "store_manager",
                    "cashier",
                  ].map((value) => ({
                    value,
                    label: value.replaceAll("_", " "),
                  })),
                },
                {
                  name: "store_id",
                  label: "Initial store assignment",
                  options: stores.map((s) => ({ value: s.id, label: s.name })),
                },
              ]}
              onSave={async (d) => {
                if (d.password !== d.password_confirmation) {
                  throw new Error("Passwords do not match.");
                }
                await api("/api/team", {
                  ...d,
                  store_ids: d.store_id ? [d.store_id] : [],
                });
                await load();
                notify("User created.");
              }}
            />
            <DataTable
              rows={team}
              columns={["display_name", "email", "role", "is_active"]}
              action={(r) =>
                r.id !== profile.id && (
                  <div className="actions">
                    <button onClick={() => setUserEdit(r)}>Edit / reset</button>
                    {r.role !== "entity_admin" && <button
                      onClick={() =>
                        void (async () => {
                          const [s, g] = await Promise.all([
                            supabase!
                              .from("user_stores")
                              .select("store_id")
                              .eq("user_id", r.id),
                            supabase!
                              .from("user_permissions")
                              .select("*")
                              .eq("user_id", r.id),
                          ]);
                          if (s.error || g.error) throw s.error || g.error;
                          setAssigned(s.data.map((v) => v.store_id));
                          setGrants(
                            Object.fromEntries(
                              g.data.map((v) => [
                                v.permission,
                                {
                                  allowed: v.allowed,
                                  max_discount_percent: v.max_discount_percent,
                                },
                              ]),
                            ),
                          );
                          setMember(r);
                        })().catch((e) => notify(userMessage(e)))
                      }
                    >
                      Access
                    </button>}
                    {r.role !== "entity_admin" && <button
                      onClick={() =>
                        void (async () => {
                          if (
                            r.is_active &&
                            !window.confirm(
                              `Deactivate ${String(r.display_name)}? Their active sessions will be closed.`,
                            )
                          )
                            return;
                          await rpc("set_team_active", {
                            target_user: r.id,
                            active: !r.is_active,
                          });
                          await load();
                          notify(
                            r.is_active
                              ? "User deactivated and active sessions revoked."
                              : "User activated successfully.",
                          );
                        })().catch((e) => notify(userMessage(e)))
                      }
                    >
                      {r.is_active ? "Deactivate" : "Activate"}
                    </button>}
                  </div>
                )
              }
            />
          </section>
          {userEdit && (
            <section className="panel">
              <h2>Edit user · {String(userEdit.display_name)}</h2>
              <p>
                Leave the password blank to keep it unchanged. Changing login
                details or role revokes the user&apos;s active sessions.
              </p>
              <Form
                key={String(userEdit.id)}
                label="Save user"
                confirmation={(data) =>
                  data.password
                    ? `Reset the password for ${String(userEdit.display_name)}? Their active sessions will be revoked.`
                    : "Save these user profile changes?"
                }
                fields={[
                  {
                    name: "display_name",
                    label: "Full name",
                    value: String(userEdit.display_name),
                  },
                  {
                    name: "email",
                    label: "Login email",
                    type: "email",
                    value: String(userEdit.email),
                  },
                  {
                    name: "role",
                    label: "Role",
                    value: String(userEdit.role),
                    options: [
                      "entity_admin",
                      "store_manager",
                      "cashier",
                    ].map((value) => ({
                      value,
                      label: value.replaceAll("_", " "),
                    })),
                  },
                  {
                    name: "password",
                    label: "New password (optional, 12+ characters)",
                    type: "password",
                    required: false,
                  },
                  {
                    name: "password_confirmation",
                    label: "Confirm new password",
                    type: "password",
                    required: false,
                  },
                ]}
                onSave={async (d) => {
                  if (d.password !== d.password_confirmation) {
                    throw new Error("Passwords do not match.");
                  }
                  await api(
                    "/api/team",
                    { ...d, target_user: userEdit.id },
                    "PATCH",
                  );
                  setUserEdit(null);
                  await load();
                  notify(
                    d.password
                      ? "Password reset completed. The user’s active sessions were revoked."
                      : "User profile updated successfully.",
                  );
                }}
              />
            </section>
          )}
          {member && (
            <section className="panel">
              <h2>Access for {String(member.display_name)}</h2>
              <p>
                Unchecked permissions use role defaults unless explicitly denied
                below.
              </p>
              {stores.map((s) => (
                <label className="check" key={s.id}>
                  <input
                    type="checkbox"
                    checked={assigned.includes(s.id)}
                    onChange={(e) =>
                      setAssigned(
                        e.target.checked
                          ? [...assigned, s.id]
                          : assigned.filter((id) => id !== s.id),
                      )
                    }
                  />
                  {s.name}
                </label>
              ))}
              <div className="form-grid">
                {permissions.map((p) => (
                  <label key={String(p.code)}>
                    {String(p.label)}
                    <select
                      value={
                        grants[String(p.code)]
                          ? String(grants[String(p.code)].allowed)
                          : "default"
                      }
                      onChange={(e) => {
                        const next = { ...grants };
                        if (e.target.value === "default")
                          delete next[String(p.code)];
                        else
                          next[String(p.code)] = {
                            allowed: e.target.value === "true",
                            max_discount_percent:
                              next[String(p.code)]?.max_discount_percent ?? 0,
                          };
                        setGrants(next);
                      }}
                    >
                      <option value="default">Role default</option>
                      <option value="true">Allow</option>
                      <option value="false">Deny</option>
                    </select>
                  </label>
                ))}
              </div>
              <label>
                Maximum discount %
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={grants["sales.discount"]?.max_discount_percent ?? 0}
                  onChange={(e) =>
                    setGrants({
                      ...grants,
                      "sales.discount": {
                        allowed: true,
                        max_discount_percent: Number(e.target.value),
                      },
                    })
                  }
                />
              </label>
              <button
                onClick={() =>
                  void rpc("configure_user", {
                    target: member.id,
                    store_ids: assigned,
                    grants,
                  })
                    .then(() => {
                      setMember(null);
                      notify("Store access and permissions saved.");
                    })
                    .catch((e) => notify(userMessage(e)))
                }
              >
                Save access
              </button>
            </section>
          )}
        </>
      )}
      <section className="panel">
        <h2>Device sessions</h2>
        <DataTable
          rows={sessions}
          columns={[
            "user_id",
            "device",
            "logged_in_at",
            "last_activity",
            "revoked_at",
          ]}
          action={(r) =>
            !r.revoked_at && (
              <button
                onClick={() =>
                  void (async () => {
                    if (!window.confirm("Revoke this device session now?")) return;
                    await rpc("revoke_session", { target: r.id });
                    await load();
                    notify("Device session revoked successfully.");
                  })().catch((e) => notify(userMessage(e)))
                }
              >
                Revoke
              </button>
            )
          }
        />
      </section>
    </>
  );
}
