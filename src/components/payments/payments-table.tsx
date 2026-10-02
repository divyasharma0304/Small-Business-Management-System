import { Trash2 } from "lucide-react";
import { ConfirmAction } from "@/components/confirm-action";
import { Money } from "@/components/money";
import { Badge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { deletePaymentAction } from "@/lib/actions/payments";
import { formatDate } from "@/lib/format";
import type { Payment } from "@/lib/types";

/** Payments linked to one order or purchase. */
export function PaymentsTable({ payments }: { payments: Payment[] }) {
  if (payments.length === 0) return <p className="px-6 pb-6 text-sm text-muted-foreground">No payments recorded yet.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-6">Date</TableHead>
          <TableHead>Method</TableHead>
          <TableHead className="hidden sm:table-cell">Reference</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead className="w-12 pr-6" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {payments.map((p) => (
          <TableRow key={p.id}>
            <TableCell className="pl-6 whitespace-nowrap">{formatDate(p.payment_date)}</TableCell>
            <TableCell>
              {p.method} {p.kind === "refund" && <Badge tone="warning">Refund</Badge>}
            </TableCell>
            <TableCell className="hidden max-w-40 truncate text-muted-foreground sm:table-cell">{p.reference ?? "—"}</TableCell>
            <TableCell className="text-right"><Money value={p.kind === "refund" ? -p.amount : p.amount} signed={p.kind === "refund"} /></TableCell>
            <TableCell className="pr-6">
              <ConfirmAction
                trigger={<Button size="icon-sm" variant="ghost" aria-label="Delete payment"><Trash2 /></Button>}
                title="Delete this payment?"
                description="Use this only to correct a mistake. The amount paid on the order/purchase is recalculated."
                confirmLabel="Delete payment"
                destructive
                action={deletePaymentAction.bind(null, p.id)}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
