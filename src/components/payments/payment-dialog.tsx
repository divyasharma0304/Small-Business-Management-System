"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Field } from "@/components/forms/field";
import { SimpleSelect } from "@/components/forms/simple-select";
import { useCurrency } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { recordPaymentAction } from "@/lib/actions/payments";

/**
 * Records a payment (or refund). When linked to an order/purchase, the maximum is
 * suggested from the amount due; the database enforces it.
 */
export function PaymentDialog({
  trigger,
  direction,
  kind = "payment",
  methods,
  today,
  orderId,
  purchaseId,
  suggestedAmount,
  defaultMethod,
  parties,
  title,
  description,
}: {
  trigger: ReactNode;
  direction: "in" | "out";
  kind?: "payment" | "refund";
  methods: string[];
  today: string;
  orderId?: string;
  purchaseId?: string;
  suggestedAmount?: number;
  defaultMethod?: string | null;
  /** For standalone payments: choose a customer (in) or supplier (out). */
  parties?: { id: string; name: string }[];
  title?: string;
  description?: string;
}) {
  const router = useRouter();
  const { format, symbol } = useCurrency();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState(defaultMethod && methods.includes(defaultMethod) ? defaultMethod : methods[0] ?? "");
  const [date, setDate] = useState(today);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [party, setParty] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  function reset() {
    setAmount(suggestedAmount && suggestedAmount > 0 ? String(suggestedAmount) : "");
    setReference("");
    setNotes("");
    setErrors({});
    setDate(today);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const res = await recordPaymentAction({
        direction,
        kind,
        payment_date: date,
        amount,
        method,
        reference,
        notes,
        order_id: orderId ?? null,
        purchase_id: purchaseId ?? null,
        customer_id: direction === "in" && !orderId ? party : null,
        supplier_id: direction === "out" && !purchaseId ? party : null,
      });
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      setOpen(false);
      router.refresh();
    });
  }

  const heading = title ?? (kind === "refund" ? "Record refund" : direction === "in" ? "Record payment received" : "Record payment made");

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) reset(); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
          <DialogDescription>
            {description ?? (suggestedAmount !== undefined ? `${kind === "refund" ? "Refundable" : "Amount due"}: ${format(suggestedAmount)}` : "Not linked to a specific order or purchase.")}
          </DialogDescription>
        </DialogHeader>
        <form id="payment-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          {parties && (
            <Field label={direction === "in" ? "Customer" : "Supplier"} htmlFor="pay-party" className="sm:col-span-2">
              <SimpleSelect id="pay-party" value={party} allowNone noneLabel="None" onChange={(v) => setParty(v === "none" ? null : v)} options={parties.map((p) => ({ value: p.id, label: p.name }))} />
            </Field>
          )}
          <Field label={`Amount (${symbol})`} htmlFor="pay-amount" required error={errors.amount}>
            <Input id="pay-amount" type="number" min={0} step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus aria-invalid={!!errors.amount} />
          </Field>
          <Field label="Date" htmlFor="pay-date" error={errors.payment_date}>
            <Input id="pay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Method" htmlFor="pay-method" error={errors.method}>
            <SimpleSelect id="pay-method" value={method || undefined} onChange={setMethod} options={methods.map((m) => ({ value: m, label: m }))} placeholder="Choose method" />
          </Field>
          <Field label="Reference" htmlFor="pay-ref" hint="UPI ref, cheque no., transaction ID…">
            <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field label="Notes" htmlFor="pay-notes" className="sm:col-span-2">
            <Textarea id="pay-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button type="submit" form="payment-form" disabled={pending || !amount || !method}>
            {pending && <Loader2 className="animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
