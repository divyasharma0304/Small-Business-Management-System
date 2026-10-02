import "server-only";
import type { RequiredContext } from "@/lib/context";

/**
 * Append to the audit log for actions performed with direct table writes.
 * (Multi-step operations — orders, purchases, stock, production — are audited
 * inside their SQL functions, in the same transaction.)
 * Audit failures are logged but never block the user's action.
 */
export async function audit(
  ctx: RequiredContext,
  action: string,
  entityType: string,
  entityId: string | null,
  summary: string,
  oldValue?: unknown,
  newValue?: unknown,
) {
  const { error } = await ctx.supabase.from("audit_logs").insert({
    business_id: ctx.businessId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    summary,
    old_value: oldValue ?? null,
    new_value: newValue ?? null,
  });
  if (error) console.error("[audit] failed to write", action, error);
}
