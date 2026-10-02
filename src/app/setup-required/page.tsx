import { AuthShell } from "@/components/auth/auth-shell";

/** Shown when .env.local is missing the Supabase settings. */
export default function SetupRequiredPage() {
  return (
    <AuthShell title="Connect Supabase" description="Velqora needs your Supabase project details before it can start.">
      <ol className="list-decimal space-y-2 pl-5 text-sm">
        <li>Copy <code className="rounded bg-muted px-1">.env.example</code> to <code className="rounded bg-muted px-1">.env.local</code>.</li>
        <li>Fill in <code className="rounded bg-muted px-1">NEXT_PUBLIC_SUPABASE_URL</code> and <code className="rounded bg-muted px-1">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> from your Supabase dashboard.</li>
        <li>Restart <code className="rounded bg-muted px-1">npm run dev</code>.</li>
      </ol>
      <p className="mt-4 text-sm text-muted-foreground">Full instructions are in README.md.</p>
    </AuthShell>
  );
}
