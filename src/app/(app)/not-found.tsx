import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-16 text-center">
      <SearchX className="mb-3 size-8 text-muted-foreground" />
      <h2 className="text-lg font-semibold">Not found</h2>
      <p className="mt-1 text-sm text-muted-foreground">This record doesn&apos;t exist or was deleted.</p>
      <Button className="mt-5" asChild><Link href="/dashboard">Back to dashboard</Link></Button>
    </div>
  );
}
