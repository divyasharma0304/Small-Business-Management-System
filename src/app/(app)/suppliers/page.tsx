import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Truck } from "lucide-react";
import { ListToolbar } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { SortHeader } from "@/components/data/sort-header";
import { EmptyState } from "@/components/empty-state";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { PartyDialog } from "@/components/parties/party-dialog";
import { DemoBadge, StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireContext } from "@/lib/context";
import { formatDate } from "@/lib/format";
import { ilikeTerm, parseListParams } from "@/lib/list-params";
import type { Supplier } from "@/lib/types";

export const metadata: Metadata = { title: "Suppliers" };

export default async function SuppliersPage({ searchParams }: PageProps<"/suppliers">) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!ctx.settings.module_suppliers) redirect("/settings?tab=features");
  const lp = parseListParams(sp, { sortable: ["name", "created_at"], defaultSort: "name", defaultDir: "asc" });

  let q = ctx.supabase.from("suppliers").select("*", { count: "exact" }).eq("business_id", ctx.businessId);
  if (lp.q) q = q.or(`name.ilike.${ilikeTerm(lp.q)},contact_person.ilike.${ilikeTerm(lp.q)},phone.ilike.${ilikeTerm(lp.q)},email.ilike.${ilikeTerm(lp.q)}`);
  const status = lp.get("status");
  if (status === "active") q = q.eq("is_active", true);
  if (status === "inactive") q = q.eq("is_active", false);
  const { data, count } = await q.order(lp.sort, { ascending: lp.dir === "asc" }).range(lp.from, lp.to);
  const suppliers = (data ?? []) as Supplier[];

  const { data: purchases } = suppliers.length
    ? await ctx.supabase.from("purchases").select("supplier_id, total, amount_paid, purchase_date").in("supplier_id", suppliers.map((s) => s.id)).not("status", "in", "(draft,cancelled)")
    : { data: [] };
  const stats = new Map<string, { count: number; total: number; due: number; last: string | null }>();
  for (const p of purchases ?? []) {
    const s = stats.get(p.supplier_id) ?? { count: 0, total: 0, due: 0, last: null };
    s.count += 1;
    s.total += Number(p.total);
    s.due += Math.max(0, Number(p.total) - Number(p.amount_paid));
    if (!s.last || p.purchase_date > s.last) s.last = p.purchase_date;
    stats.set(p.supplier_id, s);
  }

  const addButton = <PartyDialog kind="supplier" defaultCountry={ctx.business.country} taxLabel={ctx.business.tax_label} trigger={<Button><Plus /> Add supplier</Button>} />;

  return (
    <>
      <PageHeader title="Suppliers" description="The businesses you buy stock and materials from." actions={addButton} />
      <ListToolbar searchPlaceholder="Search name, contact, phone…" filters={[{ key: "status", label: "Statuses", options: [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }] }]} />
      {suppliers.length === 0 ? (
        lp.q || status ? (
          <EmptyState icon={Truck} title="No suppliers found" />
        ) : (
          <EmptyState icon={Truck} title="No suppliers yet" description="Add the businesses you buy from to track purchases and what you owe them." action={addButton} />
        )
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHeader column="name" label="Supplier" pathname="/suppliers" searchParams={sp} current={lp.sort} dir={lp.dir} />
                  <TableHead className="hidden md:table-cell">Contact</TableHead>
                  <TableHead className="text-right">Purchases</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Total</TableHead>
                  <TableHead className="text-right">You owe</TableHead>
                  <TableHead className="hidden lg:table-cell">Last purchase</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppliers.map((s) => {
                  const st = stats.get(s.id);
                  return (
                    <TableRow key={s.id} className={s.is_active ? "" : "opacity-60"}>
                      <TableCell>
                        <Link href={`/suppliers/${s.id}`} className="font-medium hover:underline">{s.name}</Link>{" "}
                        {!s.is_active && <StatusBadge status="inactive" />}
                        {s.is_demo && <DemoBadge />}
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">{[s.contact_person, s.phone].filter(Boolean).join(" · ") || "—"}</TableCell>
                      <TableCell className="text-right tabular">{st?.count ?? 0}</TableCell>
                      <TableCell className="hidden text-right sm:table-cell"><Money value={st?.total ?? 0} /></TableCell>
                      <TableCell className="text-right">{st?.due ? <Money value={st.due} className="font-medium" /> : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="hidden text-muted-foreground lg:table-cell">{formatDate(st?.last)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <Pagination pathname="/suppliers" searchParams={sp} page={lp.page} total={count ?? 0} />
        </>
      )}
    </>
  );
}
