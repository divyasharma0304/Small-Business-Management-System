"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

/** Sets a new password for the signed-in user (reset flow and Settings → Account). */
export function PasswordForm({ redirectTo }: { redirectTo?: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm") ?? "");
    setError("");
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== confirm) return setError("The passwords do not match.");
    startTransition(async () => {
      const { error } = await createClient().auth.updateUser({ password });
      if (error) {
        setError(
          error.message.includes("different from the old")
            ? "The new password must be different from the current one."
            : error.message.includes("reauthentication")
              ? "For security, sign out and use “Forgot password” to change it."
              : "Could not update the password. Please try again.",
        );
        return;
      }
      toast.success("Password updated");
      formRef.current?.reset();
      if (redirectTo) router.replace(redirectTo);
    });
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="grid max-w-sm gap-4">
      <Field label="New password" htmlFor="password" hint="At least 8 characters.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required />
      </Field>
      <Field label="Confirm new password" htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{error}</p>}
      <Button type="submit" disabled={pending} className="justify-self-start">
        {pending && <Loader2 className="animate-spin" />} Update password
      </Button>
    </form>
  );
}
