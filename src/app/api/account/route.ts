import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { apiError, requestContext, serviceClient } from "@/lib/auth/server";

const schema = z.object({
  current_password: z.string().min(1).max(128),
  new_password: z.string().min(12).max(128),
  new_password_confirmation: z.string().min(12).max(128),
});

export async function PATCH(request: Request) {
  try {
    const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
    if (!token) throw new Error("Sign in required");
    const { db, user, profile } = await requestContext(request);
    const input = schema.parse(await request.json());
    if (input.new_password !== input.new_password_confirmation) {
      throw new Error("Passwords do not match.");
    }
    if (input.current_password === input.new_password) {
      throw new Error("Choose a new password that is different from the current password.");
    }
    if (!profile.email) throw new Error("Account email unavailable");

    const limit = await db.rpc("consume_operation", {
      operation: "account.password_change",
      maximum: 5,
    });
    if (limit.error && limit.error.code !== "42702") {
      throw new Error(limit.error.message);
    }

    const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(
      /\/rest\/v1\/?$/,
      "",
    );
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) throw new Error("Server configuration unavailable");
    const verifier = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const verified = await verifier.auth.signInWithPassword({
      email: profile.email,
      password: input.current_password,
    });
    if (verified.error || verified.data.user?.id !== user.id) {
      throw new Error("Current password is incorrect.");
    }

    const service = serviceClient();
    if (verified.data.session?.access_token) {
      await service.auth.admin.signOut(
        verified.data.session.access_token,
        "local",
      );
    }
    const updated = await service.auth.admin.updateUserById(user.id, {
      password: input.new_password,
    });
    if (updated.error) throw new Error("Unable to change the password.");

    const otherAuthSessions = await service.auth.admin.signOut(token, "others");
    let otherSessionsRevoked = !otherAuthSessions.error;
    const session = await db.rpc("session_id");
    if (profile.entity_id) {
      let sessions = service
        .from("entity_sessions")
        .update({ revoked_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .is("revoked_at", null);
      if (session.data) sessions = sessions.neq("id", session.data);
      const revoked = await sessions;
      if (revoked.error) otherSessionsRevoked = false;
    }
    await service
      .from("profiles")
      .update({ must_change_password: false })
      .eq("id", user.id);
    await service.from("audit_logs").insert({
      entity_id: profile.entity_id,
      actor_id: user.id,
      action: "account.password_changed",
      resource_type: "profiles",
      resource_id: user.id,
      metadata: { other_sessions_revoked: otherSessionsRevoked },
    });
    return Response.json({ success: true, other_sessions_revoked: otherSessionsRevoked });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issue = error.issues[0];
      return Response.json(
        { error: `Invalid ${issue.path.join(" ") || "input"}: ${issue.message}` },
        { status: 400 },
      );
    }
    return apiError(error);
  }
}
