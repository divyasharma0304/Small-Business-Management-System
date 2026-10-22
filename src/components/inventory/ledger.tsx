import Link from "next/link";
import { Money } from "@/components/money";
import { UndoMovementButton } from "@/components/inventory/undo-movement-button";
import { Badge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, formatQty } from "@/lib/format";
import type { InventoryTransaction, InventoryTxnType } from "@/lib/types";

export const TXN_LABELS: Record<InventoryTxnType, string> = {
  initial_stock: "Opening stock",
  purchase: "Purchase",
  sale: "Sale",
  sale_reversal: "Sale cancelled",
  return: "Customer return",
  production_output: "Produced",
  production_consumption: "Used in production",
  wastage: "Wastage",
  adjustment: "Adjustment",
};

export function referenceHref(t: Pick<InventoryTransaction, "reference_type" | "reference_id">) {
  if (!t.reference_id) return null;
  switch (t.reference_type) {
    case "order": return `/orders/${t.reference_id}`;
    case "purchase": return `/purchases/${t.reference_id}`;
    case "production_batch": return `/production/batches/${t.reference_id}`;
    case "product": return `/catalog/${t.reference_id}`;
    case "reversal": return null;
    default: return null;
  }
}

export type LedgerRow = InventoryTransaction & { item_name?: string; unit?: string };

/** Stock movement history: every change to inventory with its reason and value. */
export function Ledger({ rows, timeZone, showItem, undone }: { rows: LedgerRow[]; timeZone: string; showItem?: boolean; undone?: Set<string> }) {
  // Movements already undone (on this page or found by the caller)
  const done = new Set(undone ?? []);
  for (const r of rows) if (r.reference_type === "reversal" && r.reference_id) done.add(r.reference_id);
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            {showItem && <TableHead>Item</TableHead>}
            <TableHead>Movement</TableHead>
            <TableHead className="hidden md:table-cell">Reference</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="hidden text-right sm:table-cell">Unit cost</TableHead>
            <TableHead className="hidden text-right lg:table-cell">Value</TableHead>
            <TableHead className="text-right">Balance</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((t) => {
            const href = referenceHref(t);
            const qty = Number(t.quantity);
            return (
              <TableRow key={t.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(t.occurred_at, timeZone)}</TableCell>
                {showItem && (
                  <TableCell className="max-w-52 truncate">
                    <Link href={`/inventory/${t.variant_id}`} className="hover:underline">{t.item_name}</Link>
                  </TableCell>
                )}
                <TableCell>
                  <Badge tone={qty > 0 ? "success" : t.txn_type === "wastage" ? "danger" : "neutral"}>{TXN_LABELS[t.txn_type]}</Badge>
                  {t.notes && <p className="mt-0.5 max-w-60 truncate text-xs text-muted-foreground">{t.notes}</p>}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {href ? <Link href={href} className="text-primary hover:underline">{t.reference_label ?? "View"}</Link> : <span className="text-muted-foreground">{t.reference_label ?? "—"}</span>}
                  {t.batch_lot && <span className="ml-1 text-xs text-muted-foreground">Lot {t.batch_lot}</span>}
                </TableCell>
                <TableCell className={`text-right font-medium tabular ${qty > 0 ? "text-success" : ""}`}>{qty > 0 ? "+" : ""}{formatQty(qty)}</TableCell>
                <TableCell className="hidden text-right sm:table-cell"><Money value={t.unit_cost} /></TableCell>
                <TableCell className="hidden text-right lg:table-cell"><Money value={t.total_cost} /></TableCell>
                <TableCell className="text-right tabular">{formatQty(t.balance_after, t.unit)}</TableCell>
                <TableCell className="pr-2">
                  {(t.txn_type === "adjustment" || t.txn_type === "initial_stock") && t.reference_type !== "reversal" && (
                    done.has(t.id)
                      ? <span className="text-xs text-muted-foreground">Undone</span>
                      : <UndoMovementButton id={t.id} label={t.txn_type === "initial_stock" ? "opening stock" : "adjustment"} />
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
