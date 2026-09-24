"use client";
import { useCallback, useEffect, useState } from "react";
import { rpc, api, useWorkspace } from "@/components/workspace";
import { Form, DataTable, Row } from "@/components/operations/common";
import { supabase } from "@/lib/supabase/client";
import { userMessage } from "@/lib/permissions/errors";
import {
  Eye,
  EyeOff,
  ShieldCheck,
  Building2,
  Store,
  Users,
  Activity,
  CircleCheckBig,
  CircleOff,
  Plus,
} from "lucide-react";
export function SystemDashboard() {
  const { profile, notify } = useWorkspace();
  const [rows, setRows] = useState<Row[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [edit, setEdit] = useState<Row | null>(null);
  const [createdCredentials, setCreatedCredentials] = useState<{
    entity: string;
    email: string;
    password: string;
  } | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const refresh = useCallback(async () => {
    const overview = await rpc<Row[]>("platform_overview");
    const admins = await supabase!
      .from("profiles")
      .select("entity_id,email")
      .eq("role", "entity_admin")
      .eq("is_active", true);
    if (admins.error) throw admins.error;
    const emailByEntity = new Map(
      admins.data.map((admin) => [admin.entity_id, admin.email]),
    );
    setRows(
      overview.map((entity) => ({
        ...entity,
        admin_email:
          entity.admin_email ?? emailByEntity.get(String(entity.id)) ?? "",
      })),
    );
  }, []);
  useEffect(() => {
    void Promise.resolve()
      .then(refresh)
      .catch((e) => notify(userMessage(e)));
  }, [refresh, notify]);
  return (
    <>
      <section className="dashboard-hero system-hero">
        <div className="hero-icon"><ShieldCheck size={27} /></div>
        <div>
          <p className="eyebrow">PLATFORM OPERATIONS</p>
          <h2>Welcome, {profile.display_name}</h2>
          <p>Manage business access, subscription limits and active entity sessions from one secure workspace.</p>
        </div>
        <span className="hero-security"><CircleCheckBig size={16} /> System access active</span>
      </section>
      <div className="metrics">
        {[
          { label: "Entities", value: rows.length, icon: Building2, tone: "green" },
          { label: "Active", value: rows.filter((r) => r.status === "active").length, icon: CircleCheckBig, tone: "blue" },
          { label: "Suspended", value: rows.filter((r) => r.status === "suspended").length, icon: CircleOff, tone: "red" },
          { label: "Stores", value: rows.reduce((n, r) => n + Number(r.stores), 0), icon: Store, tone: "amber" },
          { label: "Users", value: rows.reduce((n, r) => n + Number(r.users), 0), icon: Users, tone: "blue" },
          { label: "Active sessions", value: rows.reduce((n, r) => n + Number(r.sessions), 0), icon: Activity, tone: "green" },
        ].map(({ label, value, icon: Icon, tone }) => (
          <div className="panel" key={label}>
            <span className={`metric-icon ${tone}`}><Icon size={20} /></span>
            <p>{label}</p>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">ENTITY ONBOARDING</p>
            <h2>Create business and primary admin</h2>
          </div>
          <span className="status-pill"><Plus size={14} /> New entity</span>
        </div>
        <p>
          The administrator signs in with their email address as the username.
          Set their initial password here and share it securely. For dummy
          accounts, use admin+entity-name@cubipos.local.
        </p>
        {createdCredentials && (
          <div className="credential-card" role="status">
            <h3>Entity administrator created</h3>
            <dl>
              <dt>Entity</dt>
              <dd>{createdCredentials.entity}</dd>
              <dt>Username / email</dt>
              <dd>{createdCredentials.email}</dd>
              <dt>Initial password</dt>
              <dd>
                {showPassword ? createdCredentials.password : "••••••••••••"}
              </dd>
            </dl>
            <div className="actions">
              <button
                type="button"
                className="btn btn-outline"
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? (
                  <EyeOff size={18} aria-hidden="true" />
                ) : (
                  <Eye size={18} aria-hidden="true" />
                )}
                {showPassword ? "Hide password" : "Show password"}
              </button>
              <button type="button" onClick={() => setCreatedCredentials(null)}>
                Dismiss credentials
              </button>
            </div>
            <small>
              This password is shown only in this browser until dismissed or the
              page is refreshed. Ask the administrator to change it after first
              sign-in.
            </small>
          </div>
        )}
        <Form
          label="Create entity"
          fields={[
            { name: "name", label: "Entity name" },
            {
              name: "country_code",
              label: "Country",
              options: [
                ["IN", "India"],
                ["AE", "UAE"],
                ["GB", "United Kingdom"],
                ["US", "United States"],
                ["SG", "Singapore"],
                ["AU", "Australia"],
              ].map(([value, label]) => ({ value, label })),
            },
            { name: "admin_name", label: "Primary admin name" },
            {
              name: "admin_email",
              label: "Login username / email address",
              type: "email",
            },
            { name: "admin_mobile", label: "Admin mobile", required: false },
            {
              name: "admin_password",
              label: "Initial password (12+ characters)",
              type: "password",
            },
            {
              name: "admin_password_confirmation",
              label: "Confirm initial password",
              type: "password",
            },
            {
              name: "max_stores",
              label: "Maximum stores",
              type: "number",
              value: 1,
              min: 1,
            },
            {
              name: "max_users",
              label: "Maximum users",
              type: "number",
              value: 10,
              min: 1,
            },
            {
              name: "max_concurrent_sessions",
              label: "Concurrent sessions",
              type: "number",
              value: 3,
              min: 1,
            },
            {
              name: "storage_limit_mb",
              label: "Storage limit (MB)",
              type: "number",
              value: 1024,
              min: 1,
            },
            {
              name: "subscription_expiry",
              label: "Subscription expiry",
              type: "date",
              required: false,
            },
          ]}
          onSave={async (d) => {
            if (d.admin_password !== d.admin_password_confirmation) {
              throw new Error("Admin passwords do not match.");
            }
            await api("/api/system", {
              ...d,
              max_stores: Number(d.max_stores),
              max_users: Number(d.max_users),
              max_concurrent_sessions: Number(d.max_concurrent_sessions),
              storage_limit_mb: Number(d.storage_limit_mb),
              subscription_expiry: d.subscription_expiry || null,
            });
            setCreatedCredentials({
              entity: String(d.name),
              email: String(d.admin_email),
              password: String(d.admin_password),
            });
            setShowPassword(false);
            await refresh();
            notify("Entity and primary administrator login created.");
          }}
        />
      </section>
      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">BUSINESS DIRECTORY</p>
            <h2>Entities and access</h2>
          </div>
          <span className="status-pill">{rows.length} total</span>
        </div>
        <div className="row">
          <input
            placeholder="Search entities…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search entities"
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Filter status"
          >
            <option value="">All statuses</option>
            {["active", "trial", "suspended", "cancelled"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <DataTable
          rows={rows.filter(
            (r) =>
              (String(r.name).toLowerCase().includes(query.toLowerCase()) ||
                String(r.admin_email ?? "")
                  .toLowerCase()
                  .includes(query.toLowerCase())) &&
              (!status || r.status === status),
          )}
          columns={[
            "name",
            "admin_email",
            "country_code",
            "stores",
            "users",
            "sessions",
            "max_concurrent_sessions",
            "status",
          ]}
          action={(r) => (
            <button onClick={() => setEdit(r)}>View / edit</button>
          )}
        />
      </section>
      {edit && (
        <section className="panel">
          <h2>Edit {String(edit.name)}</h2>
          <Form
            key={String(edit.id)}
            confirmation={(data) =>
              data.status === "suspended" || data.status === "cancelled"
                ? `Change ${String(edit.name)} to ${String(data.status)}? Its users will lose operational access.`
                : "Save these entity settings?"
            }
            fields={[
              { name: "name", label: "Entity name", value: String(edit.name) },
              {
                name: "status",
                label: "Status",
                value: String(edit.status),
                options: ["active", "suspended", "cancelled"].map((value) => ({
                  value,
                  label: value,
                })),
              },
              ...[
                "max_stores",
                "max_users",
                "max_concurrent_sessions",
                "storage_limit_mb",
              ].map((name) => ({
                name,
                label: name.replaceAll("_", " "),
                type: "number",
                min: 1,
                value: Number(edit[name]),
              })),
              {
                name: "subscription_expiry",
                label: "Subscription expiry",
                type: "date",
                required: false,
                value: String(edit.subscription_expiry ?? ""),
              },
            ]}
            onSave={async (d) => {
              const result = await supabase!
                .from("entities")
                .update({
                  ...d,
                  max_stores: Number(d.max_stores),
                  max_users: Number(d.max_users),
                  max_concurrent_sessions: Number(d.max_concurrent_sessions),
                  storage_limit_mb: Number(d.storage_limit_mb),
                  subscription_expiry: d.subscription_expiry || null,
                })
                .eq("id", edit.id);
              if (result.error) throw result.error;
              await refresh();
              setEdit(null);
              notify("Entity settings updated successfully.");
            }}
          />
          <h2>Reset entity administrator login</h2>
          <p>
            Current login email:{" "}
            <strong>
              {String(edit.admin_email ?? "No entity administrator found")}
            </strong>
            . Set a new email and password below. This immediately revokes their
            active device sessions.
          </p>
          <Form
            confirmation={`Reset the administrator login for ${String(edit.name)}? All of that administrator’s active sessions will be revoked.`}
            fields={[
              {
                name: "current_email",
                label: "Current administrator email",
                type: "email",
                value: String(edit.admin_email ?? ""),
              },
              {
                name: "new_email",
                label: "New login username / email address",
                type: "email",
                value: String(edit.admin_email ?? ""),
              },
              {
                name: "new_password",
                label: "New password (12+ characters)",
                type: "password",
              },
              {
                name: "new_password_confirmation",
                label: "Confirm new password",
                type: "password",
              },
            ]}
            label="Reset administrator login"
            onSave={async (d) => {
              if (d.new_password !== d.new_password_confirmation) {
                throw new Error("Admin passwords do not match.");
              }
              await api(
                "/api/system",
                {
                  entity_id: edit.id,
                  current_email: d.current_email,
                  new_email: d.new_email,
                  new_password: d.new_password,
                  new_password_confirmation: d.new_password_confirmation,
                },
                "PATCH",
              );
              setCreatedCredentials({
                entity: String(edit.name),
                email: String(d.new_email),
                password: String(d.new_password),
              });
              setShowPassword(false);
              setEdit((current) =>
                current
                  ? { ...current, admin_email: String(d.new_email) }
                  : current,
              );
              await refresh();
              notify(
                "Entity administrator login reset and active sessions revoked.",
              );
            }}
          />
        </section>
      )}
    </>
  );
}
