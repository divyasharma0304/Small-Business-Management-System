import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Business, BusinessSettings } from "@/lib/types";

/** The signed-in user, verified on the server (JWT signature checked). Null when signed out. */
export const getSession = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return { supabase, userId: claims.sub, email: (claims.email as string | undefined) ?? null };
});

export type AppContext = NonNullable<Awaited<ReturnType<typeof loadContext>>>;

async function loadContext() {
  const session = await getSession();
  if (!session) return null;
  const { supabase } = session;

  // MVP: one business per user. The schema allows several; pick the first.
  const { data: membership } = await supabase
    .from("business_members")
    .select("business_id, role")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!membership) return { ...session, business: null, settings: null, role: null };

  const [{ data: business }, { data: settings }] = await Promise.all([
    supabase.from("businesses").select("*").eq("id", membership.business_id).single(),
    supabase.from("business_settings").select("*").eq("business_id", membership.business_id).single(),
  ]);

  return {
    ...session,
    role: membership.role as string,
    business: business as Business | null,
    settings: settings as BusinessSettings | null,
  };
}

const getContextCached = cache(loadContext);

/**
 * For every protected page and server action: guarantees a signed-in user with a
 * configured business, otherwise redirects (to /login or /setup).
 */
export async function requireContext() {
  const ctx = await getContextCached();
  if (!ctx) redirect("/login");
  if (!ctx.business || !ctx.settings) redirect("/setup");
  return { ...ctx, business: ctx.business, settings: ctx.settings, businessId: ctx.business.id };
}

export type RequiredContext = Awaited<ReturnType<typeof requireContext>>;

/** For pages that only need a signed-in user (e.g. /setup). */
export async function requireUser() {
  const ctx = await getContextCached();
  if (!ctx) redirect("/login");
  return ctx;
}
