import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { SetupWizard } from "@/components/setup/setup-wizard";
import { requireUser } from "@/lib/context";

export const metadata: Metadata = { title: "Set up your business" };

export default async function SetupPage() {
  const ctx = await requireUser();
  if (ctx.business) redirect("/dashboard");

  return (
    <div className="min-h-svh bg-muted/40 px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <Logo className="mb-8" />
        <SetupWizard email={ctx.email ?? ""} />
      </div>
    </div>
  );
}
