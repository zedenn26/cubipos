"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { supabase } from "@/lib/supabase/client";
import { rpc } from "@/components/workspace";
import { Button } from "@/components/ui/button";
import { userMessage } from "@/lib/permissions/errors";
import { Eye, EyeOff } from "lucide-react";
import Image from "next/image";
const schema = z.object({ email: z.email(), password: z.string().min(1) });
export default function Login() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  return (
    <main className="login">
      <section className="panel login-card">
        <div className="brand">
          <Image
            className="brand-logo"
            src="/cubipos-logo.png"
            alt="CubiPOS by Cubixtop"
            width={230}
            height={78}
            priority
          />
          <small>RETAIL MANAGEMENT</small>
        </div>
        <h1>Welcome back</h1>
        <p>Sign in to sell, manage inventory or operate your business.</p>
        <form
          onSubmit={handleSubmit(async (values) => {
            setError("");
            try {
              if (!supabase) throw new Error("Configuration missing");
              const auth = await supabase.auth.signInWithPassword(values);
              if (auth.error) throw auth.error;
              await rpc("register_session", {
                device_name: navigator.userAgent,
              });
              const system = await rpc<boolean>("is_system_admin");
              router.push(system ? "/system" : "/pos");
            } catch (e) {
              setError(userMessage(e));
            }
          })}
        >
          <label>
            Email
            <input
              {...register("email")}
              type="email"
              autoComplete="username"
            />
          </label>
          {errors.email && <small>Enter a valid email.</small>}
          <label>
            Password
            <span className="password-field">
              <input
                {...register("password")}
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="password-toggle"
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? (
                  <EyeOff size={18} aria-hidden="true" />
                ) : (
                  <Eye size={18} aria-hidden="true" />
                )}
              </button>
            </span>
          </label>
          <Button disabled={isSubmitting}>
            {isSubmitting ? "Signing in…" : "Sign in"}
          </Button>
          {error && <p role="alert">{error}</p>}
        </form>
        <footer className="app-footer">© 2026 CubiPOS · by Cubixtop</footer>
      </section>
    </main>
  );
}
