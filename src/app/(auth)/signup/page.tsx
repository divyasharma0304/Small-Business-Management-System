import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignupForm } from "@/components/auth/signup-form";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Create owner account" };

/**
 * First-run only: creating the owner account. Once an owner exists this page is
 * closed. (Also disable "Allow new users to sign up" in Supabase — see README.)
 */
export default async function SignupPage() {
  const supabase = await createClient();
  const { data: hasOwner } = await supabase.rpc("app_has_owner");

  if (hasOwner !== false) {
    return (
      <AuthShell title="Registration is closed" description="This Velqora installation already has an owner.">
        <Link href="/login" className="text-sm font-medium underline-offset-4 hover:underline">Go to sign in</Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create the owner account"
      description="This is a one-time step. The account you create here owns the business."
      footer={<>Already have an account? <Link href="/login" className="font-medium text-foreground hover:underline">Sign in</Link></>}
    >
      <SignupForm />
    </AuthShell>
  );
}
