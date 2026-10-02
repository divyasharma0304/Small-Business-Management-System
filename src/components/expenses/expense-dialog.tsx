"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Field } from "@/components/forms/field";
import { FileUpload } from "@/components/forms/file-upload";
import { SimpleSelect } from "@/components/forms/simple-select";
import { useCurrency } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveExpenseAction } from "@/lib/actions/expenses";

export interface ExpenseValues {
  id?: string;
  expense_date: string;
  category_id: string | null;
  description: string;
  amount: string;
  vendor: string;
  supplier_id: string | null;
  payment_method: string | null;
  reference: string;
  receipt_path: string | null;
  notes: string;
}

export function ExpenseDialog({
  trigger,
  initial,
  receiptUrl,
  today,
  businessId,
  categories,
  methods,
  suppliers,
}: {
  trigger: ReactNode;
  initial?: ExpenseValues;
  receiptUrl?: string | null;
  today: string;
  businessId: string;
  categories: { id: string; name: string }[];
  methods: string[];
  suppliers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const { symbol } = useCurrency();
  const blank: ExpenseValues = { expense_date: today, category_id: null, description: "", amount: "", vendor: "", supplier_id: null, payment_method: methods[0] ?? null, reference: "", receipt_path: null, notes: "" };
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<ExpenseValues>(initial ?? blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const set = (p: Partial<ExpenseValues>) => setV((s) => ({ ...s, ...p }));

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setV(initial ?? blank); setErrors({}); } }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit expense" : "Record expense"}</DialogTitle>
          <DialogDescription>Running costs such as rent, ads, packaging or software. Stock purchases belong in Purchases.</DialogDescription>
        </DialogHeader>
        <form
          id="expense-form"
          className="grid gap-4 sm:grid-cols-2"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const res = await saveExpenseAction(v);
              if (!res.ok) {
                setErrors(res.fieldErrors ?? {});
                toast.error(res.error);
                return;
              }
              toast.success(res.message);
              setOpen(false);
              router.refresh();
            });
          }}
        >
          <Field label="Description" htmlFor="ex-desc" required error={errors.description} className="sm:col-span-2">
            <Input id="ex-desc" value={v.description} onChange={(e) => set({ description: e.target.value })} autoFocus aria-invalid={!!errors.description} />
          </Field>
          <Field label={`Amount (${symbol})`} htmlFor="ex-amount" required error={errors.amount}>
            <Input id="ex-amount" type="number" min={0} step="0.01" inputMode="decimal" value={v.amount} onChange={(e) => set({ amount: e.target.value })} aria-invalid={!!errors.amount} />
          </Field>
          <Field label="Date" htmlFor="ex-date" error={errors.expense_date}>
            <Input id="ex-date" type="date" value={v.expense_date} onChange={(e) => set({ expense_date: e.target.value })} />
          </Field>
          <Field label="Category" htmlFor="ex-cat">
            <SimpleSelect id="ex-cat" value={v.category_id} allowNone noneLabel="Uncategorised" onChange={(x) => set({ category_id: x === "none" ? null : x })} options={categories.map((c) => ({ value: c.id, label: c.name }))} />
          </Field>
          <Field label="Payment method" htmlFor="ex-method">
            <SimpleSelect id="ex-method" value={v.payment_method} allowNone noneLabel="—" onChange={(x) => set({ payment_method: x === "none" ? null : x })} options={methods.map((m) => ({ value: m, label: m }))} />
          </Field>
          {suppliers.length > 0 && (
            <Field label="Supplier (optional)" htmlFor="ex-sup">
              <SimpleSelect id="ex-sup" value={v.supplier_id} allowNone noneLabel="—" onChange={(x) => set({ supplier_id: x === "none" ? null : x })} options={suppliers.map((s) => ({ value: s.id, label: s.name }))} />
            </Field>
          )}
          <Field label="Vendor / paid to" htmlFor="ex-vendor">
            <Input id="ex-vendor" value={v.vendor} onChange={(e) => set({ vendor: e.target.value })} />
          </Field>
          <Field label="Reference" htmlFor="ex-ref">
            <Input id="ex-ref" value={v.reference} onChange={(e) => set({ reference: e.target.value })} />
          </Field>
          <Field label="Receipt" className="sm:col-span-2">
            <FileUpload businessId={businessId} folder="receipts" kind="document" value={v.receipt_path} previewUrl={receiptUrl} onChange={(p) => set({ receipt_path: p })} label="Attach receipt" />
          </Field>
          <Field label="Notes" htmlFor="ex-notes" className="sm:col-span-2">
            <Textarea id="ex-notes" rows={2} value={v.notes} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button type="submit" form="expense-form" disabled={pending}>{pending && <Loader2 className="animate-spin" />} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
