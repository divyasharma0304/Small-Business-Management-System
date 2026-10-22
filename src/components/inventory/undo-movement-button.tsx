"use client";

import { Undo2 } from "lucide-react";
import { ConfirmAction } from "@/components/confirm-action";
import { Button } from "@/components/ui/button";
import { undoStockMovementAction } from "@/lib/actions/inventory";

export function UndoMovementButton({ id, label }: { id: string; label: string }) {
  return (
    <ConfirmAction
      trigger={<Button size="icon-sm" variant="ghost" aria-label={`Undo ${label}`}><Undo2 /></Button>}
      title={`Undo this ${label}?`}
      description="An opposite entry is added to the stock history, so the quantity goes back to what it was. Both entries stay visible."
      confirmLabel="Undo"
      action={() => undoStockMovementAction(id)}
    />
  );
}
