import { z } from "zod";
import { isoDate, money, optionalDate, optionalText, optionalUuid, percent, positiveMoney, quantity, uuid } from "./common";

export const lineSchema = z.object({
  variant_id: uuid,
  quantity: quantity(),
  unit_price: money("Price"),
  discount_amount: money("Discount").default(0),
  tax_rate: percent("Tax rate").default(0),
});

export const orderSchema = z.object({
  id: optionalUuid,
  customer_id: optionalUuid,
  order_date: isoDate("Order date"),
  due_date: optionalDate,
  status: z.enum(["draft", "confirmed"]).optional(),
  discount_amount: money("Order discount").default(0),
  shipping_charge: money("Shipping charge").default(0),
  preferred_payment_method: optionalText(60),
  notes: optionalText(2000),
  lines: z.array(lineSchema).min(1, "Add at least one item").max(200),
});

export const purchaseSchema = z.object({
  id: optionalUuid,
  supplier_id: optionalUuid,
  purchase_date: isoDate("Purchase date"),
  invoice_number: optionalText(64),
  status: z.enum(["draft", "ordered"]),
  discount_amount: money("Discount").default(0),
  other_charges: money("Other charges").default(0),
  attachment_path: optionalText(500),
  notes: optionalText(2000),
  lines: z.array(lineSchema).min(1, "Add at least one item").max(200),
  receive_now: z.boolean().default(false),
});

export const paymentSchema = z
  .object({
    direction: z.enum(["in", "out"]),
    kind: z.enum(["payment", "refund"]).default("payment"),
    payment_date: isoDate("Payment date"),
    amount: positiveMoney("Amount"),
    method: z.string().trim().min(1, "Choose a payment method").max(60),
    reference: optionalText(100),
    customer_id: optionalUuid,
    supplier_id: optionalUuid,
    order_id: optionalUuid,
    purchase_id: optionalUuid,
    notes: optionalText(1000),
  })
  .refine((p) => (p.direction === "in" ? !p.supplier_id && !p.purchase_id : !p.customer_id && !p.order_id), {
    message: "Payment links don't match its direction",
  });
