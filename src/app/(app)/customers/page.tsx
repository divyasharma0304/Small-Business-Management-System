import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Users } from "lucide-react";
import { ListToolbar } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { SortHeader } from "@/components/data/sort-header";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { PartyDialog } from "@/components/parties/party-dialog";
import { DemoBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireContext } from "@/lib/context";
import { formatDate } from "@/lib/format";
import { ilikeTerm, parseListParams } from "@/lib/list-params";
import type { Customer } from "@/lib/types";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: PageProps<"/customers">) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!ctx.settings.module_customers) redirect("/settings?tab=features");
  const lp = parseListParams(sp, { sortable: ["name", "created_at"], defaultSort: "name", defaultDir: "asc" });

  let q = ctx.supabase.from("customers").select("*", { count: "exact" }).eq("business_id", ctx.businessId);
  if (lp.q) q = q.or(`name.ilike.${ilikeTerm(lp.q)},phone.ilike.${ilikeTerm(lp.q)},email.ilike.${ilikeTerm(lp.q)},city.ilike.${ilikeTerm(lp.q)}`);
  const { data, count } = await q.order(lp.sort, { ascending: lp.dir === "asc" }).range(lp.from, lp.to);
  const customers = (data ?? []) as Customer[];

  const { data: orders } = customers.length
    ? await ctx.supabase
        .from("orders")
        .select("customer_id, total, amount_paid, order_date, status")
        .in("customer_id", customers.map((c) => c.id))
        .not("status", "in", "(draft,cancelled,returned)")
    : { data: [] };
  const stats = new Map<string, { orders: number; total: number; due: number; last: string | null }>();
  for (const o of orders ?? []) {
    const s = stats.get(o.customer_id) ?? { orders: 0, total: 0, due: 0, last: null };
    s.orders += 1;
    s.total += Number(o.total);
    s.due += Math.max(0, Number(o.total) - Number(o.amount_paid));
    if (!s.last || o.order_date > s.last) s.last = o.order_date;
    stats.set(o.customer_id, s);
  }

  const addButton = <PartyDialog kind="customer" defaultCountry={ctx.business.country} taxLabel={ctx.business.tax_label} trigger={<Button><Plus /> Add customer</Button>} />;

  return (
    <>
      <PageHeader title="Customers" description="Who buys from you, and who still owes you." actions={addButton} />
      <ListToolbar searchPlaceholder="Search name, phone, email, city…" />
      {customers.length === 0 ? (
        lp.q ? (
          <EmptyState icon={Users} title="No customers found" description="Try a different search." />
        ) : (
          <EmptyState icon={Users} title="No customers yet" description="Add customers to track their orders and what they owe." action={addButton} />
        )
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHeader column="name" label="Customer" pathname="/customers" searchParams={sp} current={lp.sort} dir={lp.dir} />
                  <TableHead className="hidden md:table-cell">Contact</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Total billed</TableHead>
                  <TableHead className="text-right">Owes you</TableHead>
                  <TableHead className="hidden lg:table-cell">Last order</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((c) => {
                  const s = stats.get(c.id);
                  return (
                    <TableRow key={c.id}>
                      <TableCell>
                        <Link href={`/customers/${c.id}`} className="font-medium hover:underline">{c.name}</Link>
                        {c.is_demo && <DemoBadge />}
                        {c.city && <div className="text-xs text-muted-foreground">{c.city}</div>}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">{[c.phone, c.email].filter(Boolean).join(" · ") || "—"}</TableCell>
                      <TableCell className="text-right tabular">{s?.orders ?? 0}</TableCell>
                      <TableCell className="hidden text-right sm:table-cell"><Money value={s?.total ?? 0} /></TableCell>
                      <TableCell className="text-right">{s?.due ? <Money value={s.due} className="font-medium text-destructive" /> : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="hidden text-muted-foreground lg:table-cell">{formatDate(s?.last)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <Pagination pathname="/customers" searchParams={sp} page={lp.page} total={count ?? 0} />
        </>
      )}
    </>
  );
}
