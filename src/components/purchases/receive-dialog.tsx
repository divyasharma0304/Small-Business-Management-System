"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, PackageCheck } from "lucide-react";
import { toast } from "sonner";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { receivePurchaseAction } from "@/lib/actions/purchases";
import { formatQty } from "@/lib/format";

export function ReceiveDialog({ purchaseId, lines }: {
  purchaseId: string;
  lines: { id: string; description: string; quantity: number; received_quantity: number }[];
}) {
  const router = useRouter();
  const outstanding = lines.filter((l) => l.quantity > l.received_quantity);
  const [open, setOpen] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [lot, setLot] = useState("");
  const [pending, startTransition] = useTransition();

  function reset() {
    setQty(Object.fromEntries(outstanding.map((l) => [l.id, String(l.quantity - l.received_quantity)])));
    setLot("");
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) reset(); }}>
      <DialogTrigger asChild>
        <Button><PackageCheck /> Receive stock</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Receive stock</DialogTitle>
          <DialogDescription>Enter what actually arrived. You can receive the rest later.</DialogDescription>
        </DialogHeader>
        <form
          id="receive-form"
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const res = await receivePurchaseAction(purchaseId, {
                lines: outstanding.map((l) => ({ item_id: l.id, quantity: qty[l.id] || 0 })),
                batch_lot: lot,
              });
              if (!res.ok) return void toast.error(res.error);
              toast.success(res.message);
              setOpen(false);
              router.refresh();
            });
          }}
        >
          {outstanding.map((l) => (
            <div key={l.id} className="grid grid-cols-[1fr_110px] items-center gap-3">
              <label htmlFor={`rcv-${l.id}`} className="text-sm">
                <span className="font-medium">{l.description}</span>
                <span className="block text-xs text-muted-foreground">Outstanding: {formatQty(l.quantity - l.received_quantity)}</span>
              </label>
              <Input id={`rcv-${l.id}`} type="number" min={0} max={l.quantity - l.received_quantity} step="any" value={qty[l.id] ?? ""} onChange={(e) => setQty((s) => ({ ...s, [l.id]: e.target.value }))} />
            </div>
          ))}
          <Field label="Batch / lot (optional)" htmlFor="rcv-lot">
            <Input id="rcv-lot" value={lot} onChange={(e) => setLot(e.target.value)} />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button type="submit" form="receive-form" disabled={pending}>{pending && <Loader2 className="animate-spin" />} Receive</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
