"use client";
import {
  useEffect,
  useState,
  useCallback,
  createContext,
  useContext,
} from "react";
import { useRouter } from "next/navigation";
import { usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  Store,
  LogOut,
  ShoppingCart,
  Package,
  Settings,
  LayoutDashboard,
  RotateCcw,
  Boxes,
  ContactRound,
  Truck,
  FileBarChart,
  ShieldCheck,
  Moon,
  Sun,
  Menu,
  X,
  Bell,
  ChevronDown,
  Palette,
  UserRound,
  ReceiptText,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { userMessage } from "@/lib/permissions/errors";
import { Button } from "@/components/ui/button";
import { LoadingScreen } from "@/components/loading-screen";
import { Form } from "@/components/operations/common";
export type Profile = {
  id: string;
  entity_id: string | null;
  display_name: string;
  role: string;
  email: string;
};
export type Shop = {
  id: string;
  name: string;
  code: string;
  phone?: string | null;
  email?: string | null;
  is_active: boolean;
};
type Context = {
  profile: Profile;
  entity: Record<string, unknown>;
  stores: Shop[];
  storeId: string;
  setStoreId: (id: string) => void;
  allowed: (permission: string) => boolean;
  notify: (s: string) => void;
  refresh: () => Promise<void>;
};
const WorkspaceContext = createContext<Context | null>(null);
export function useWorkspace() {
  const c = useContext(WorkspaceContext);
  if (!c) throw new Error("Workspace required");
  return c;
}
export async function rpc<T = unknown>(
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  if (!supabase) throw new Error("Configuration missing");
  const r = await supabase.rpc(name, args);
  if (r.error) throw r.error;
  return r.data as T;
}
export async function api(path: string, body: unknown, method = "POST") {
  const {
    data: { session },
  } = await supabase!.auth.getSession();
  const r = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${session?.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error);
  return data;
}
const navigation = [
  ["/admin", "Dashboard", "reports.read", LayoutDashboard, "MAIN"],
  ["/pos", "Point of Sale", "sales.create", ShoppingCart, "SELL"],
  ["/sales", "Recent sales & receipts", "reports.read", ReceiptText, "SELL"],
  ["/returns", "Returns & exchanges", "returns.create", RotateCcw, "SELL"],
  ["/products", "Products", "products.manage", Package, "INVENTORY"],
  ["/inventory", "Stock & transfers", "inventory.read", Boxes, "INVENTORY"],
  ["/customers", "Customers", "customers.read", ContactRound, "CRM"],
  ["/purchases", "Suppliers & purchases", "purchases.manage", Truck, "CRM"],
  ["/reports", "Reports", "reports.read", FileBarChart, "ANALYTICS"],
  ["/settings", "Business settings", "settings.manage", Settings, "ADMIN"],
] as const;
export function Workspace({
  children,
  title,
  system = false,
}: {
  children: React.ReactNode;
  title: string;
  system?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [entity, setEntity] = useState<Record<string, unknown>>({});
  const [stores, setStores] = useState<Shop[]>([]);
  const [storeId, setStoreId] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const allowed = useCallback(
    (permission: string) => permissions.includes(permission),
    [permissions],
  );
  const [message, setMessage] = useState("");
  const [offline, setOffline] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const refresh = useCallback(async () => {
    if (!supabase) {
      setMessage("Configure Supabase in .env.local.");
      return;
    }
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.replace("/");
      return;
    }
    const p = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();
    if (p.error || !p.data?.is_active) throw new Error("Account unavailable");
    const platform = await rpc<boolean>("is_system_admin");
    if (platform !== system) {
      router.replace(platform ? "/system" : "/pos");
      return;
    }
    await rpc("register_session", { device_name: navigator.userAgent });
    setProfile(p.data);
    if (system) return;
    const [e, s, perms] = await Promise.all([
      supabase.from("entities").select("*").eq("id", p.data.entity_id).single(),
      supabase
        .from("stores")
        .select("id,name,code,phone,email,is_active")
        .order("name"),
      supabase.from("permissions").select("code"),
    ]);
    if (e.error || s.error || perms.error)
      throw e.error || s.error || perms.error;
    const setup = await supabase
      .from("entity_settings")
      .select("onboarding_completed")
      .eq("entity_id", p.data.entity_id)
      .maybeSingle();
    if (
      p.data.role === "entity_admin" &&
      !setup.data?.onboarding_completed &&
      window.location.pathname !== "/settings"
    )
      router.replace("/settings");
    setEntity(e.data);
    setStores(s.data);
    setStoreId((current) =>
      s.data.some((row) => row.id === current && row.is_active)
        ? current
        : (s.data.find(row=>row.is_active)?.id ?? ""),
    );
    const allowed = await Promise.all(
      perms.data.map(async ({ code }) =>
        (await rpc<boolean>("has_permission", { code })) ? code : null,
      ),
    );
    setPermissions(allowed.filter((p): p is string => Boolean(p)));
  }, [router, system]);
  useEffect(() => {
    let alive = true;
    void Promise.resolve()
      .then(refresh)
      .catch((e) => alive && setMessage(userMessage(e)));
    const heartbeat = setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine)
        void rpc("register_session", {
          device_name: navigator.userAgent,
        }).catch((e) => {
          setMessage(userMessage(e));
          setProfile(null);
        });
    }, 60000);
    return () => {
      alive = false;
      clearInterval(heartbeat);
    };
  }, [refresh]);
  useEffect(() => {
    const change = () => setOffline(!navigator.onLine);
    change();
    window.addEventListener("online", change);
    window.addEventListener("offline", change);
    return () => {
      window.removeEventListener("online", change);
      window.removeEventListener("offline", change);
    };
  }, []);
  useEffect(() => {
    const saved =
      localStorage.getItem("cubipos.theme") ??
      localStorage.getItem("mypos.theme");
    const accent =
      localStorage.getItem("cubipos.accent") ??
      localStorage.getItem("mypos.accent") ??
      "green";
    if (saved) localStorage.setItem("cubipos.theme", saved);
    localStorage.setItem("cubipos.accent", accent);
    localStorage.removeItem("mypos.theme");
    localStorage.removeItem("mypos.accent");
    document.documentElement.dataset.accent = accent;
    const enabled =
      saved === "dark" ||
      (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.dataset.theme = enabled ? "dark" : "light";
  }, []);
  function cycleAccent() {
    const accents = ["green", "blue", "orange"];
    const current = document.documentElement.dataset.accent ?? "green";
    const next = accents[(accents.indexOf(current) + 1) % accents.length];
    document.documentElement.dataset.accent = next;
    localStorage.setItem("cubipos.accent", next);
  }
  function toggleTheme() {
    const next = document.documentElement.dataset.theme !== "dark";
    document.documentElement.dataset.theme = next ? "dark" : "light";
    localStorage.setItem("cubipos.theme", next ? "dark" : "light");
  }
  async function logout() {
    try {
      const {
        data: { session },
      } = await supabase!.auth.getSession();
      if (session) {
        const payload = JSON.parse(
          atob(
            session.access_token
              .split(".")[1]
              .replace(/-/g, "+")
              .replace(/_/g, "/"),
          ),
        );
        if (!system)
          await rpc("revoke_session", { target: payload.session_id });
      }
      await supabase!.auth.signOut();
      router.replace("/");
    } catch (e) {
      setMessage(userMessage(e));
    }
  }
  if (!profile)
    return <LoadingScreen message={message || "Loading your secure workspace"} />;
  return (
    <WorkspaceContext.Provider
      value={{
        profile,
        entity,
        stores,
        storeId,
        setStoreId,
        allowed,
        notify: setMessage,
        refresh,
      }}
    >
      <div className="workspace">
        <button
          type="button"
          aria-label="Close navigation"
          className={`sidebar-scrim ${sidebarOpen ? "show" : ""}`}
          onClick={() => setSidebarOpen(false)}
        />
        <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
          <div className="brand">
            <Image
              className="brand-logo"
              src="/cubipos-logo.png"
              alt="CubiPOS by Cubixtop"
              width={155}
              height={52}
              priority
            />
            <small>{system ? "PLATFORM CONTROL" : "RETAIL MANAGEMENT"}</small>
            <button
              type="button"
              className="mobile-close"
              aria-label="Close navigation"
              onClick={() => setSidebarOpen(false)}
            >
              <X size={20} />
            </button>
          </div>
          <nav aria-label="Primary navigation">
            {system ? (
              <>
                <small className="nav-section">PLATFORM</small>
                <Link href="/system" className="active">
                  <ShieldCheck size={19} />
                  Entities & access
                </Link>
              </>
            ) : (
              navigation.reduce<React.ReactNode[]>((items, item, index, all) => {
                const [href, label, permission, Icon, section] = item;
                if (!permissions.includes(permission)) return items;
                const previousVisible = all
                  .slice(0, index)
                  .filter(([, , candidate]) => permissions.includes(candidate))
                  .at(-1);
                if (!previousVisible || previousVisible[4] !== section)
                  items.push(
                    <small className="nav-section" key={`section-${section}`}>
                      {section}
                    </small>,
                  );
                items.push(
                  <Link
                    key={href}
                    href={href}
                    className={pathname === href ? "active" : undefined}
                    onClick={() => setSidebarOpen(false)}
                  >
                    <Icon size={19} />
                    {label}
                  </Link>,
                );
                return items;
              }, [])
            )}
          </nav>
          <div className="account">
            <span className="avatar" aria-hidden="true">
              {profile.display_name.slice(0, 2).toUpperCase()}
            </span>
            <span className="account-copy">
              <strong>{profile.display_name}</strong>
              <small>{profile.role.replaceAll("_", " ")}</small>
            </span>
            <div className="account-actions">
              <button
                type="button"
                className="icon-button"
                aria-label="Open profile and password"
                title="Profile and password"
                onClick={() => setProfileOpen(true)}
              >
                <UserRound size={17} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Change color theme"
                title="Change color theme"
                onClick={cycleAccent}
              >
                <Palette size={17} />
              </button>
              <button
                type="button"
                className="icon-button logout-action"
                aria-label="Sign out"
                title="Sign out"
                onClick={() => void logout()}
              >
                <LogOut size={17} />
              </button>
            </div>
          </div>
        </aside>
        <main className="content">
          <header className="topbar">
            <button
              type="button"
              className="icon-button menu-button"
              aria-label="Open navigation"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu size={22} />
            </button>
            <div className="page-heading">
              <p className="eyebrow">
                {system
                  ? "System Super Admin"
                  : String(entity.name ?? "Your business")}
              </p>
              <h1>{title}</h1>
            </div>
            <div className="topbar-actions">
              {!system && allowed("sales.create") && pathname !== "/pos" && (
                <Button asChild className="new-sale-button">
                  <Link href="/pos"><ShoppingCart size={17} /> New sale</Link>
                </Button>
              )}
              {!system && (
                <label className="store-picker">
                  <Store size={17} />
                  <span>
                    <small>ACTIVE STORE</small>
                    <select
                      value={storeId}
                      aria-label="Active store"
                      onChange={(e) => setStoreId(e.target.value)}
                    >
                      <option value="">Select store</option>
                      {stores.filter((s) => s.is_active).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </span>
                  <ChevronDown size={15} />
                </label>
              )}
              <button type="button" className="icon-button notification-button" aria-label="Notifications" title="Notifications">
                <Bell size={19} />
                {message && <span className="notification-dot" />}
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="Toggle color theme"
                title="Toggle color theme"
                onClick={toggleTheme}
              >
                <Sun className="theme-sun" size={19} />
                <Moon className="theme-moon" size={19} />
              </button>
            </div>
          </header>
          {offline && (
            <div role="alert" className="notice">
              Offline — checkout is unavailable. Your active cart stays on this
              device.
            </div>
          )}
          {message && (
            <div className="notice" role="status">
              {message}
              <button onClick={() => setMessage("")}>Dismiss</button>
            </div>
          )}
          {children}
          <footer className="app-footer">© 2026 CubiPOS · by Cubixtop</footer>
        </main>
      </div>
      {profileOpen && (
        <div className="modal" role="dialog" aria-modal="true" aria-label="Profile and password">
          <section className="panel account-modal">
            <div className="section-heading">
              <div>
                <p className="eyebrow">SIGNED-IN PROFILE</p>
                <h2>{profile.display_name}</h2>
              </div>
              <button type="button" className="icon-button" aria-label="Close profile" onClick={() => setProfileOpen(false)}>
                <X size={19} />
              </button>
            </div>
            <dl className="profile-summary">
              <dt>Email / username</dt>
              <dd>{profile.email}</dd>
              <dt>Role</dt>
              <dd>{profile.role.replaceAll("_", " ")}</dd>
            </dl>
            <h3>Change password</h3>
            <p>Confirm your current password. Other signed-in devices will be logged out.</p>
            <Form
              label="Change password"
              confirmation="Change your password and sign out your other devices?"
              fields={[
                {
                  name: "current_password",
                  label: "Current password",
                  type: "password",
                  autoComplete: "current-password",
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
              onSave={async (data) => {
                const result = await api("/api/account", data, "PATCH");
                setProfileOpen(false);
                setMessage(
                  result.other_sessions_revoked
                    ? "Password changed successfully. Other signed-in devices were logged out."
                    : "Password changed successfully. Review active sessions and revoke any device you no longer use.",
                );
              }}
            />
          </section>
        </div>
      )}
    </WorkspaceContext.Provider>
  );
}
