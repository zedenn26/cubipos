"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { userMessage } from "@/lib/permissions/errors";
import { Eye, EyeOff } from "lucide-react";
export type Row = Record<string, unknown>;
export type Field = {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  value?: string | number;
  min?: number;
  step?: string;
  autoComplete?: string;
};
export function Form({
  fields,
  onSave,
  label = "Save",
  confirmation,
}: {
  fields: Field[];
  onSave: (data: Row) => Promise<void>;
  label?: string;
  confirmation?: string | ((data: Row) => string);
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(
    new Set(),
  );
  return (
    <form
      className="form-grid"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const data = Object.fromEntries(new FormData(form));
        const confirmationMessage =
          typeof confirmation === "function" ? confirmation(data) : confirmation;
        if (confirmationMessage && !window.confirm(confirmationMessage)) return;
        setBusy(true);
        setError("");
        try {
          await onSave(data);
          form.reset();
        } catch (e) {
          setError(userMessage(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      {fields.map((f) => (
        <label key={f.name}>
          {f.label}
          {f.options ? (
            <select
              name={f.name}
              defaultValue={f.value}
              required={f.required !== false}
            >
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : f.type === "password" ? (
            <span className="password-field">
              <input
                name={f.name}
                type={visiblePasswords.has(f.name) ? "text" : "password"}
                defaultValue={f.value}
                required={f.required !== false}
                minLength={12}
                maxLength={128}
                autoComplete={f.autoComplete ?? "new-password"}
              />
              <button
                type="button"
                className="password-toggle"
                aria-label={
                  visiblePasswords.has(f.name)
                    ? `Hide ${f.label}`
                    : `Show ${f.label}`
                }
                aria-pressed={visiblePasswords.has(f.name)}
                onClick={() =>
                  setVisiblePasswords((current) => {
                    const next = new Set(current);
                    if (next.has(f.name)) next.delete(f.name);
                    else next.add(f.name);
                    return next;
                  })
                }
              >
                {visiblePasswords.has(f.name) ? (
                  <EyeOff size={18} aria-hidden="true" />
                ) : (
                  <Eye size={18} aria-hidden="true" />
                )}
              </button>
            </span>
          ) : (
            <input
              name={f.name}
              type={f.type ?? "text"}
              defaultValue={f.value}
              min={f.min ?? (f.type === "number" ? 0 : undefined)}
              step={f.step ?? (f.type === "number" ? "0.01" : undefined)}
              required={f.required !== false}
            />
          )}
        </label>
      ))}
      <Button disabled={busy}>{busy ? "Saving…" : label}</Button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
export function DataTable({
  rows,
  columns,
  action,
  selected,
  onSelect,
}: {
  rows: Row[];
  columns: string[];
  action?: (row: Row) => React.ReactNode;
  selected?: Set<string>;
  onSelect?: (row: Row, checked: boolean) => void;
}) {
  const selectable = Boolean(selected && onSelect);
  const allSelected =
    selectable && rows.length > 0 && rows.every((row) => selected!.has(String(row.id)));
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {selectable && (
              <th className="selection-column">
                <input
                  type="checkbox"
                  aria-label="Select all visible records"
                  checked={allSelected}
                  onChange={(event) =>
                    rows.forEach((row) => onSelect!(row, event.target.checked))
                  }
                />
              </th>
            )}
            {columns.map((c) => (
              <th key={c}>{c.replaceAll("_", " ")}</th>
            ))}
            {action && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={String(r.id ?? i)}>
              {selectable && (
                <td className="selection-column">
                  <input
                    type="checkbox"
                    aria-label={`Select ${String(r.name ?? "record")}`}
                    checked={selected!.has(String(r.id))}
                    onChange={(event) => onSelect!(r, event.target.checked)}
                  />
                </td>
              )}
              {columns.map((c) => (
                <td key={c}>
                  {typeof r[c] === "object"
                    ? JSON.stringify(r[c])
                    : String(r[c] ?? "—")}
                </td>
              ))}
              {action && <td>{action(r)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className="empty">No records found.</p>}
    </div>
  );
}
