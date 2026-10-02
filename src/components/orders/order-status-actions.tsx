"use client";

import { Ban, CheckCircle2, PackageCheck, RotateCcw, Truck, Wrench } from "lucide-react";
import { ConfirmAction } from "@/components/confirm-action";
import { Button } from "@/components/ui/button";
import { setOrderStatusAction } from "@/lib/actions/orders";
import type { OrderStatus } from "@/lib/types";

const FLOW: OrderStatus[] = ["draft", "confirmed", "processing", "ready", "shipped", "delivered"];
const RANK = Object.fromEntries(FLOW.map((s, i) => [s, i])) as Record<string, number>;
const ICONS = { confirmed: CheckCircle2, processing: Wrench, ready: PackageCheck, shipped: Truck, delivered: CheckCircle2 } as const;
const VERB: Record<string, string> = { confirmed: "Confirm", processing: "Mark processing", ready: "Mark ready", shipped: "Mark shipped", delivered: "Mark delivered" };

/**
 * Buttons to move an order forward through its workflow, plus cancel/return.
 * Explains when a step will deduct stock / record the sale.
 */
export function OrderStatusActions({
  orderId,
  status,
  recognized,
  deductionStatus,
  tracksStock,
  amountPaid,
}: {
  orderId: string;
  status: OrderStatus;
  recognized: boolean;
  deductionStatus: OrderStatus;
  tracksStock: boolean;
  amountPaid: number;
}) {
  if (status === "cancelled" || status === "returned") return null;
  const next = FLOW.slice(RANK[status] + 1);
  const primary = next[0];
  const others = next.slice(1);

  const describe = (target: OrderStatus) => {
    const recognises = !recognized && RANK[target] >= RANK[deductionStatus];
    return recognises ? (
      <>
        This records the order as a sale{tracksStock ? " and deducts its items from stock" : ""}. After this, its items can no longer be edited.
      </>
    ) : (
      <>The order status will change to “{target}”.</>
    );
  };

  const step = (target: OrderStatus, isPrimary: boolean) => {
    const Icon = ICONS[target as keyof typeof ICONS] ?? CheckCircle2;
    return (
      <ConfirmAction
        key={target}
        trigger={<Button variant={isPrimary ? "default" : "outline"}><Icon /> {VERB[target]}</Button>}
        title={`${VERB[target]}?`}
        description={describe(target)}
        confirmLabel={VERB[target]}
        action={() => setOrderStatusAction(orderId, target)}
      />
    );
  };

  return (
    <>
      <ConfirmAction
        trigger={<Button variant="ghost"><Ban /> Cancel order</Button>}
        title="Cancel this order?"
        description={
          <>
            {recognized && tracksStock ? "Its items will be put back into stock at their original cost. " : ""}
            The order will no longer count as a sale.
            {amountPaid > 0 ? " Payments already received stay recorded — record a refund if you return the money." : ""} This can&apos;t be undone.
          </>
        }
        confirmLabel="Cancel order"
        destructive
        action={() => setOrderStatusAction(orderId, "cancelled")}
      />
      {recognized && (
        <ConfirmAction
          trigger={<Button variant="outline"><RotateCcw /> Return</Button>}
          title="Mark order as returned?"
          description={
            <>
              Use this when the customer returns the whole order. {tracksStock ? "Items go back into stock at their original cost. " : ""}
              The sale is removed from revenue. Record a refund separately if you pay money back. This can&apos;t be undone.
            </>
          }
          confirmLabel="Mark returned"
          destructive
          action={() => setOrderStatusAction(orderId, "returned")}
        />
      )}
      {others.length > 0 && others.map((s) => step(s, false))}
      {primary && step(primary, true)}
    </>
  );
}
