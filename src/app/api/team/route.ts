import { z } from "zod";
import { serviceClient, requirePermission, apiError } from "@/lib/auth/server";
const schema = z.object({
  email: z.email(),
  password: z.string().min(12).max(128),
  password_confirmation: z.string().min(12).max(128),
  display_name: z.string().trim().min(1).max(100),
  role: z.enum([
    "entity_admin",
    "store_manager",
    "cashier",
  ]),
  store_ids: z.array(z.uuid()).max(100).default([]),
});
const updateSchema = z.object({
  target_user: z.uuid(),
  email: z.email(),
  display_name: z.string().trim().min(1).max(100),
  role: z.enum(["entity_admin", "store_manager", "cashier"]),
  password: z
    .string()
    .max(128)
    .refine((value) => value === "" || value.length >= 12),
  password_confirmation: z.string().max(128),
});
export async function POST(request: Request) {
  try {
    const { db, profile } = await requirePermission(request, "users.manage");
    const input = schema.parse(await request.json());
    if (input.password !== input.password_confirmation) {
      return Response.json(
        { error: "Passwords do not match." },
        { status: 400 },
      );
    }
    if (profile.role !== "entity_admin") throw new Error("Access denied");
    if (input.role !== "entity_admin" && input.store_ids.length === 0) {
      throw new Error("Assign at least one store to this user.");
    }
    const limit = await db.rpc("consume_operation", {
      operation: "user.create",
      maximum: 20,
    });
    if (limit.error && limit.error.code !== "42702") {
      throw new Error(limit.error.message);
    }
    if (input.store_ids.length) {
      const stores = await db
        .from("stores")
        .select("id")
        .in("id", input.store_ids);
      if (stores.error || stores.data.length !== input.store_ids.length)
        throw new Error("Access denied");
    }
    const service = serviceClient();
    const auth = await service.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
    });
    if (auth.error) {
      const duplicate =
        auth.error.code === "email_exists" ||
        /already|registered|exists/i.test(auth.error.message);
      throw new Error(
        duplicate
          ? "This user email is already registered. Use a different email address."
          : "Unable to create the user login.",
      );
    }
    const result = await service.from("profiles").insert({
      id: auth.data.user.id,
      entity_id: profile.entity_id,
      email: input.email,
      display_name: input.display_name,
      role: input.role,
    });
    if (result.error) {
      await service.auth.admin.deleteUser(auth.data.user.id);
      throw new Error(result.error.message);
    }
    if (input.store_ids.length) {
      const assigned = await service.from("user_stores").insert(
        input.store_ids.map((store_id) => ({
          user_id: auth.data.user.id,
          store_id,
        })),
      );
      if (assigned.error) {
        await service.auth.admin.deleteUser(auth.data.user.id);
        throw new Error("Unable to assign the selected stores.");
      }
    }
    return Response.json({ success: true });
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
    const { db, profile } = await requirePermission(request, "users.manage");
    if (profile.role !== "entity_admin") throw new Error("Access denied");
    const input = updateSchema.parse(await request.json());
    if (input.password !== input.password_confirmation) {
      throw new Error("Passwords do not match.");
    }
    const member = await db
      .from("profiles")
      .select("id,entity_id,email,display_name,role")
      .eq("id", input.target_user)
      .eq("entity_id", profile.entity_id)
      .single();
    if (
      member.error ||
      member.data.id === profile.id ||
      member.data.role === "super_admin"
    ) {
      throw new Error("Access denied");
    }
    if (input.role !== "entity_admin") {
      const stores = await db
        .from("user_stores")
        .select("store_id")
        .eq("user_id", member.data.id)
        .limit(1);
      if (stores.error || stores.data.length === 0) {
        throw new Error("Assign at least one store to this user.");
      }
    }
    const service = serviceClient();
    const emailOwner = await service
      .from("profiles")
      .select("id")
      .eq("email", input.email)
      .neq("id", member.data.id)
      .limit(1)
      .maybeSingle();
    if (emailOwner.error) throw new Error("Unable to verify the new email address.");
    if (emailOwner.data) {
      throw new Error(
        "This user email is already registered. Use a different email address.",
      );
    }
    const credentialsChanged =
      input.email !== member.data.email || Boolean(input.password);
    const updated = await service
      .from("profiles")
      .update({
        email: input.email,
        display_name: input.display_name,
        role: input.role,
      })
      .eq("id", member.data.id)
      .eq("entity_id", profile.entity_id);
    if (updated.error) throw new Error("Unable to update the user profile.");
    if (credentialsChanged) {
      const auth = await service.auth.admin.updateUserById(member.data.id, {
        email: input.email,
        ...(input.password ? { password: input.password } : {}),
        email_confirm: true,
      });
      if (auth.error) {
        await service
          .from("profiles")
          .update({
            email: member.data.email,
            display_name: member.data.display_name,
            role: member.data.role,
          })
          .eq("id", member.data.id);
        throw new Error("Unable to update the user login.");
      }
    }
    if (credentialsChanged || input.role !== member.data.role) {
      await service
        .from("entity_sessions")
        .update({ revoked_at: new Date().toISOString() })
        .eq("user_id", member.data.id)
        .is("revoked_at", null);
    }
    await service.from("audit_logs").insert({
      entity_id: profile.entity_id,
      actor_id: profile.id,
      action: "user.updated",
      resource_type: "profiles",
      resource_id: member.data.id,
      metadata: {
        previous_email: member.data.email,
        email: input.email,
        previous_role: member.data.role,
        role: input.role,
        credentials_changed: credentialsChanged,
      },
    });
    return Response.json({ success: true });
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
