"use client";

import { Pencil, Trash2 } from "lucide-react";
import { ConfirmAction } from "@/components/confirm-action";
import { PaymentDialog } from "@/components/payments/payment-dialog";
import { Button } from "@/components/ui/button";
import { deletePaymentAction } from "@/lib/actions/payments";
import type { Payment } from "@/lib/types";

/** Edit / delete buttons for one payment row. */
export function PaymentRowActions({ payment, methods, today }: { payment: Payment; methods: string[]; today: string }) {
  return (
    <div className="flex justify-end gap-1">
      <PaymentDialog
        editing={payment}
        direction={payment.direction}
        methods={methods}
        today={today}
        trigger={<Button size="icon-sm" variant="ghost" aria-label="Edit payment"><Pencil /></Button>}
      />
      <ConfirmAction
        trigger={<Button size="icon-sm" variant="ghost" aria-label="Delete payment"><Trash2 /></Button>}
        title="Delete this payment?"
        description="Use this to correct a mistake. The amount paid on the order or purchase is recalculated."
        confirmLabel="Delete payment"
        destructive
        action={() => deletePaymentAction(payment.id)}
      />
    </div>
  );
}
