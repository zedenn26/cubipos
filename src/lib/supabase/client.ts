import { createBrowserClient } from "@supabase/ssr";
export function supabaseUrl() {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")
    .replace(/\/rest\/v1\/?$/, "")
    .replace(/\/$/, "");
}
export const supabase =
  supabaseUrl() && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? createBrowserClient(
        supabaseUrl(),
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        {
          cookieOptions: {
            sameSite: "lax",
            secure:
              process.env.NEXT_PUBLIC_APP_URL?.startsWith("https://") ?? false,
          },
        },
      )
    : null;
