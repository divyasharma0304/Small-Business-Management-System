"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { deleteProductAction, getDeleteImpactAction, setProductActiveAction, type DeleteImpact } from "@/lib/actions/catalog";

/**
 * Delete button for an item. Before confirming it shows exactly what will be
 * removed with the item — or, if the item is part of sales/production/purchase
 * history, why it can't be deleted (and offers to deactivate it instead).
 */
export function DeleteProductDialog({ id, name, active }: { id: string; name: string; active: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [impact, setImpact] = useState<DeleteImpact | null>(null);
  const [loadError, setLoadError] = useState("");
  const [pending, startTransition] = useTransition();

  function load() {
    setImpact(null);
    setLoadError("");
    startTransition(async () => {
      const res = await getDeleteImpactAction(id);
      if (res.ok) setImpact(res.data);
      else setLoadError(res.error);
    });
  }

  function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, then: () => void) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.message ?? "Done");
      setOpen(false);
      then();
    });
  }

  const list = (items: string[]) => (items.length > 4 ? `${items.slice(0, 4).join(", ")} and ${items.length - 4} more` : items.join(", "));

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!pending) { setOpen(o); if (o) load(); } }}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost"><Trash2 /> Delete</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{name}”?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="grid gap-3 text-sm">
              {!impact && !loadError && (
                <p className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Checking where this item is used…</p>
              )}
              {loadError && <p className="text-destructive">{loadError}</p>}
              {impact && impact.can_delete && (
                <>
                  <p>This permanently removes the item. It can&apos;t be undone.</p>
                  {(impact.stock_movements > 0 || impact.purchases.length > 0 || impact.recipes_output.length > 0 || impact.recipes_component.length > 0) && (
                    <div className="rounded-md bg-muted p-3 text-foreground">
                      <p className="mb-1 font-medium">Also removed:</p>
                      <ul className="list-disc space-y-0.5 pl-5">
                        {impact.stock_movements > 0 && <li>{impact.stock_movements} stock movement{impact.stock_movements === 1 ? "" : "s"} (opening stock, purchases, adjustments, wastage)</li>}
                        {impact.purchases.length > 0 && <li>Purchase{impact.purchases.length === 1 ? "" : "s"} {list(impact.purchases)} — only this item, no payments</li>}
                        {impact.recipes_output.length > 0 && <li>Recipe{impact.recipes_output.length === 1 ? "" : "s"} that make it: {list(impact.recipes_output)}</li>}
                        {impact.recipes_component.length > 0 && <li>Its line in recipe{impact.recipes_component.length === 1 ? "" : "s"}: {list(impact.recipes_component)}</li>}
                      </ul>
                    </div>
                  )}
                </>
              )}
              {impact && !impact.can_delete && (
                <>
                  <p className="flex items-start gap-2 text-foreground">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                    This item can&apos;t be deleted because it&apos;s part of your business history, and deleting it would change past sales, costs or purchases:
                  </p>
                  <ul className="list-disc space-y-0.5 pl-9 text-foreground">
                    {impact.orders.length > 0 && <li>Orders: {list(impact.orders)}</li>}
                    {impact.batches.length > 0 && <li>Production batches: {list(impact.batches)}</li>}
                    {impact.blocking_purchases.length > 0 && <li>Purchases with other items or payments: {list(impact.blocking_purchases)}</li>}
                  </ul>
                  <p>
                    {active ? "You can deactivate it instead: it disappears from new orders, purchases and the item pickers, but your history stays correct." : "It's already inactive, so it won't show up in new orders or purchases."}
                    {impact.orders.length === 0 && impact.batches.length === 0 && " If those purchases were mistakes, delete them first, then try again."}
                  </p>
                </>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          {impact?.can_delete && (
            <Button variant="destructive" disabled={pending} onClick={() => run(() => deleteProductAction(id), () => { router.push("/catalog"); router.refresh(); })}>
              {pending && <Loader2 className="animate-spin" />} Delete permanently
            </Button>
          )}
          {impact && !impact.can_delete && active && (
            <Button disabled={pending} onClick={() => run(() => setProductActiveAction(id, false), () => router.refresh())}>
              {pending && <Loader2 className="animate-spin" />} Deactivate instead
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
