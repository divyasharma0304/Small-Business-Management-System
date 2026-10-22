import { Money } from "@/components/money";
import { PaymentRowActions } from "@/components/payments/payment-row-actions";
import { Badge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import type { Payment } from "@/lib/types";

/** Payments linked to one order or purchase. */
export function PaymentsTable({ payments, methods, today }: { payments: Payment[]; methods: string[]; today: string }) {
  if (payments.length === 0) return <p className="px-6 pb-6 text-sm text-muted-foreground">No payments recorded yet.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-6">Date</TableHead>
          <TableHead>Method</TableHead>
          <TableHead className="hidden sm:table-cell">Reference</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead className="w-20 pr-6" />
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
              <PaymentRowActions payment={p} methods={methods} today={today} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
