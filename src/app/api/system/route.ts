import { z } from "zod";
import { requestContext, serviceClient, apiError } from "@/lib/auth/server";
const schema = z.object({
  name: z.string().trim().min(2).max(150),
  country_code: z.enum(["IN", "AE", "GB", "US", "SG", "AU"]),
  admin_name: z.string().trim().min(2).max(100),
  admin_email: z.email(),
  admin_mobile: z.string().max(30).optional(),
  admin_password: z.string().min(12).max(128),
  admin_password_confirmation: z.string().min(12).max(128),
  max_stores: z.number().int().min(1).max(10000),
  max_users: z.number().int().min(1).max(100000),
  max_concurrent_sessions: z.number().int().min(1).max(100000),
  storage_limit_mb: z.number().int().positive(),
  subscription_expiry: z.iso.date().nullable(),
});
export async function POST(request: Request) {
  try {
    const { db } = await requestContext(request);
    const check = await db.rpc("is_system_admin");
    if (check.error || !check.data) throw new Error("Access denied");
    const {
      admin_name,
      admin_email,
      admin_mobile,
      admin_password,
      admin_password_confirmation,
      ...entity
    } = schema.parse(await request.json());
    if (admin_password !== admin_password_confirmation) {
      return Response.json(
        { error: "Admin passwords do not match." },
        { status: 400 },
      );
    }
    const rate = await db.rpc("consume_operation", {
      operation: "entity.create",
      maximum: 10,
    });
    if (rate.error && rate.error.code !== "42702") {
      throw new Error(rate.error.message);
    }
    const service = serviceClient();
    const auth = await service.auth.admin.createUser({
      email: admin_email,
      password: admin_password,
      email_confirm: true,
    });
    if (auth.error) {
      const duplicate =
        auth.error.code === "email_exists" ||
        /already|registered|exists/i.test(auth.error.message);
      throw new Error(
        duplicate
          ? "This administrator email is already registered. Use a different email address."
          : "Unable to create the administrator login.",
      );
    }
    const created = await db
      .from("entities")
      .insert({ ...entity, status: "active" })
      .select("id")
      .single();
    if (created.error) {
      await service.auth.admin.deleteUser(auth.data.user.id);
      throw new Error("Unable to create the entity. Check its limits and details.");
    }
    const profile = await service.from("profiles").insert({
      id: auth.data.user.id,
      entity_id: created.data.id,
      display_name: admin_name,
      email: admin_email,
      phone: admin_mobile,
      role: "entity_admin",
    });
    if (profile.error) {
      await service.auth.admin.deleteUser(auth.data.user.id);
      await service.from("audit_logs").delete().eq("entity_id", created.data.id);
      await service.from("entities").delete().eq("id", created.data.id);
      throw new Error("Unable to create the Entity Admin profile.");
    }
    return Response.json({
      success: true,
      entity_id: created.data.id,
      admin_email,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      const issue = e.issues[0];
      return Response.json(
        { error: `Invalid ${issue.path.join(" ") || "input"}: ${issue.message}` },
        { status: 400 },
      );
    }
    return apiError(e);
  }
}
export async function PATCH(request: Request) {
  try {
    const { db, profile: actor } = await requestContext(request);
    const check = await db.rpc("is_system_admin");
    if (check.error || !check.data) throw new Error("Access denied");
    const input = z
      .object({
        entity_id: z.uuid(),
        current_email: z.email().optional(),
        new_email: z.email(),
        new_password: z.string().min(12).max(128),
        new_password_confirmation: z.string().min(12).max(128),
      })
      .parse(await request.json());
    if (input.new_password !== input.new_password_confirmation) {
      return Response.json(
        { error: "Admin passwords do not match." },
        { status: 400 },
      );
    }
    const service = serviceClient();
    const member = await service
      .from("profiles")
      .select("id,email,is_active")
      .eq("entity_id", input.entity_id)
      .eq("role", "entity_admin")
      .eq("is_active", true)
      .order("created_at")
      .limit(1)
      .single();
    if (member.error) {
      throw new Error("No active Entity Admin account exists for this entity.");
    }
    const emailOwner = await service
      .from("profiles")
      .select("id")
      .eq("email", input.new_email)
      .neq("id", member.data.id)
      .limit(1)
      .maybeSingle();
    if (emailOwner.error) {
      throw new Error("Unable to verify the new email address.");
    }
    if (emailOwner.data) {
      throw new Error(
        "This administrator email is already registered. Use a different email address.",
      );
    }
    const limit = await db.rpc("consume_operation", {
      operation: "admin.reset",
      maximum: 5,
    });
    if (limit.error && limit.error.code !== "42702") {
      throw new Error(limit.error.message);
    }
    const profileUpdate = await service
      .from("profiles")
      .update({ email: input.new_email, is_active: true })
      .eq("id", member.data.id)
      .eq("entity_id", input.entity_id)
      .eq("role", "entity_admin");
    if (profileUpdate.error) throw new Error("Admin profile update failed");
    const updated = await service.auth.admin.updateUserById(member.data.id, {
      email: input.new_email,
      password: input.new_password,
      email_confirm: true,
    });
    if (updated.error) {
      await service
        .from("profiles")
        .update({ email: member.data.email })
        .eq("id", member.data.id);
      const duplicate =
        updated.error.code === "email_exists" ||
        /already|registered|exists/i.test(updated.error.message);
      throw new Error(
        duplicate
          ? "This administrator email is already registered. Use a different email address."
          : "Unable to reset the Entity Admin login.",
      );
    }
    await service
      .from("entity_sessions")
      .update({ revoked_at: new Date().toISOString() })
      .eq("user_id", member.data.id)
      .is("revoked_at", null);
    await service.from("audit_logs").insert({
      entity_id: input.entity_id,
      actor_id: actor.id,
      action: "entity_admin.login_reset",
      resource_type: "profiles",
      resource_id: member.data.id,
      metadata: {
        previous_email: member.data.email,
        new_email: input.new_email,
        sessions_revoked: true,
      },
    });
    return Response.json({
      success: true,
      admin_email: input.new_email,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      const issue = e.issues[0];
      return Response.json(
        { error: `Invalid ${issue.path.join(" ") || "input"}: ${issue.message}` },
        { status: 400 },
      );
    }
    return apiError(e);
  }
}
