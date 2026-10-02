"use client";

import { Printer, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintToolbar() {
  return (
    <div className="sticky top-0 z-10 flex items-center justify-end gap-2 border-b bg-neutral-50 px-6 py-2 print:hidden">
      <span className="mr-auto text-sm text-neutral-600">Use “Save as PDF” in the print dialog to create a PDF.</span>
      <Button variant="ghost" size="sm" onClick={() => window.close()}><X /> Close</Button>
      <Button size="sm" onClick={() => window.print()}><Printer /> Print / Save PDF</Button>
    </div>
  );
}
