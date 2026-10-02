import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, error } = await searchParams;
  const supabase = await createClient();
  const { data: hasOwner } = await supabase.rpc("app_has_owner");

  return (
    <AuthShell
      title="Sign in"
      description="Welcome back. Sign in to manage your business."
      footer={
        hasOwner === false ? (
          <>
            First time here? <Link href="/signup" className="font-medium text-foreground underline-offset-4 hover:underline">Create the owner account</Link>
          </>
        ) : null
      }
    >
      <LoginForm next={typeof next === "string" ? next : undefined} initialError={typeof error === "string" ? error : undefined} />
    </AuthShell>
  );
}
