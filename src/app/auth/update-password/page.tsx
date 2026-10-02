import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { PasswordForm } from "@/components/auth/password-form";
import { getSession } from "@/lib/context";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function UpdatePasswordPage() {
  const session = await getSession();
  if (!session) redirect("/login?error=" + encodeURIComponent("Your reset link has expired. Please request a new one."));
  return (
    <AuthShell title="Choose a new password" description={`For ${session.email ?? "your account"}`}>
      <PasswordForm redirectTo="/dashboard" />
    </AuthShell>
  );
}
