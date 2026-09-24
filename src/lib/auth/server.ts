import "server-only";
import { createClient } from "@supabase/supabase-js";
export function serviceClient() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")
    .trim()
    .replace(/\/rest\/v1\/?$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Server configuration unavailable");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export async function requestContext(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) throw new Error("Sign in required");
  const db = createClient(
    (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/rest\/v1\/?$/, ""),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new Error("Sign in required");
  const profile = await db
    .from("profiles")
    .select("*")
    .eq("id", data.user.id)
    .single();
  if (profile.error || !profile.data?.is_active)
    throw new Error("Account unavailable");
  return { db, user: data.user, profile: profile.data };
}
export async function requirePermission(request: Request, permission: string) {
  const context = await requestContext(request);
  const { data, error } = await context.db.rpc("has_permission", {
    code: permission,
  });
  if (error || !data) throw new Error("Access denied");
  return context;
}
export function apiError(error: unknown) {
  const message = error instanceof Error ? error.message : "Operation failed";
  const known = [
    "Sign in required",
    "Access denied",
    "Account unavailable",
    "Store limit reached",
    "User limit reached",
    "Server configuration unavailable",
    "This administrator email is already registered. Use a different email address.",
    "Unable to create the administrator login.",
    "Unable to create the entity. Check its limits and details.",
    "Unable to create the Entity Admin profile.",
    "No active Entity Admin account exists for this entity.",
    "Unable to reset the Entity Admin login.",
    "Unable to verify the new email address.",
    "Assign at least one store to this user.",
    "This user email is already registered. Use a different email address.",
    "Unable to create the user login.",
    "Unable to assign the selected stores.",
    "Unable to update the user login.",
    "Unable to update the user profile.",
    "Account email unavailable",
    "Current password is incorrect.",
    "Passwords do not match.",
    "Choose a new password that is different from the current password.",
    "Unable to change the password.",
    "Password changed, but other Auth sessions could not be closed.",
    "Password changed, but other device sessions could not be closed.",
  ];
  return Response.json(
    {
      error: known.includes(message)
        ? message
        : "Unable to complete this request. Check your input and try again.",
    },
    {
      status:
        message === "Sign in required"
          ? 401
          : message === "Access denied"
            ? 403
            : 400,
    },
  );
}
