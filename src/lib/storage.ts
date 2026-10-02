import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export const BUCKET = "business-files";

/** Short-lived signed URLs for private files (bucket is never public). */
export async function signedUrls(supabase: SupabaseClient, paths: (string | null | undefined)[], expiresIn = 3600) {
  const unique = Array.from(new Set(paths.filter((p): p is string => Boolean(p))));
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(unique, expiresIn);
  if (error) {
    console.error("[storage] signed urls failed", error);
    return map;
  }
  for (const item of data ?? []) if (item.path && item.signedUrl) map.set(item.path, item.signedUrl);
  return map;
}

export async function signedUrl(supabase: SupabaseClient, path: string | null | undefined, expiresIn = 3600) {
  if (!path) return null;
  return (await signedUrls(supabase, [path], expiresIn)).get(path) ?? null;
}
