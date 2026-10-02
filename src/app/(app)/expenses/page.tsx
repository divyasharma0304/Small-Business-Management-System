import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CreditCard, FileText, Pencil, Plus, Settings2, Trash2 } from "lucide-react";
import { ConfirmAction } from "@/components/confirm-action";
import { ListToolbar } from "@/components/data/list-toolbar";
import { Pagination } from "@/components/data/pagination";
import { SortHeader } from "@/components/data/sort-header";
import { EmptyState } from "@/components/empty-state";
import { ExpenseDialog } from "@/components/expenses/expense-dialog";
import { Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { DemoBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { deleteExpenseAction } from "@/lib/actions/expenses";
import { requireContext } from "@/lib/context";
import { todayIn } from "@/lib/dates";
import { formatDate, formatMoney, localeFor } from "@/lib/format";
import { ilikeTerm, parseListParams } from "@/lib/list-params";
import { loadPaymentMethods, loadSuppliers } from "@/lib/queries/documents";
import { signedUrls } from "@/lib/storage";
import type { Expense } from "@/lib/types";

export const metadata: Metadata = { title: "Expenses" };

export default async function ExpensesPage({ searchParams }: PageProps<"/expenses">) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!ctx.settings.module_expenses) redirect("/settings?tab=features");
  const lp = parseListParams(sp, { sortable: ["expense_date", "amount"], defaultSort: "expense_date", timeZone: ctx.business.timezone });

  const build = (select: string) => {
    let q = ctx.supabase.from("expenses").select(select, { count: "exact" }).eq("business_id", ctx.businessId);
    if (lp.q) q = q.or(`description.ilike.${ilikeTerm(lp.q)},vendor.ilike.${ilikeTerm(lp.q)},reference.ilike.${ilikeTerm(lp.q)}`);
    const cat = lp.get("category");
    if (cat) q = cat === "none" ? q.is("category_id", null) : q.eq("category_id", cat);
    const method = lp.get("method");
    if (method) q = q.eq("payment_method", method);
    if (lp.range) q = q.gte("expense_date", lp.range.from).lte("expense_date", lp.range.to);
    return q;
  };

  const [{ data, count }, { data: sums }, { data: categories }, methods, suppliers] = await Promise.all([
    build("*, expense_categories(name)").order(lp.sort, { ascending: lp.dir === "asc" }).order("created_at", { ascending: false }).range(lp.from, lp.to),
    build("amount").limit(10000),
    ctx.supabase.from("expense_categories").select("id, name, is_active").eq("business_id", ctx.businessId).order("name"),
    loadPaymentMethods(ctx),
    ctx.settings.module_suppliers ? loadSuppliers(ctx) : Promise.resolve([]),
  ]);
  const rows = (data ?? []) as unknown as (Expense & { expense_categories: { name: string } | null })[];
  const total = ((sums ?? []) as unknown as { amount: number }[]).reduce((a, r) => a + Number(r.amount), 0);
  const urls = await signedUrls(ctx.supabase, rows.map((r) => r.receipt_path));
  const today = todayIn(ctx.business.timezone);
  const activeCats = (categories ?? []).filter((c) => c.is_active).map(({ id, name }) => ({ id, name }));
  const dialogProps = { today, businessId: ctx.businessId, categories: activeCats, methods, suppliers };
  const addButton = <ExpenseDialog {...dialogProps} trigger={<Button><Plus /> Record expense</Button>} />;
  const filtered = Boolean(lp.q || lp.get("category") || lp.get("method") || lp.range);

  return (
    <>
      <PageHeader
        title="Expenses"
        description="Running costs of the business. They reduce net profit."
        actions={
          <>
            <Button variant="outline" asChild><Link href="/settings?tab=expense-categories"><Settings2 /> Categories</Link></Button>
            {addButton}
          </>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={filtered ? "Total (filtered)" : "Total (all time)"} value={formatMoney(total, ctx.business.currency, localeFor(ctx.business.country))} icon={CreditCard} />
        <StatCard label="Entries" value={count ?? 0} />
      </div>
      <ListToolbar
        searchPlaceholder="Search description, vendor…"
        dateFilter
        filters={[
          { key: "category", label: "Categories", options: [{ value: "none", label: "Uncategorised" }, ...(categories ?? []).map((c) => ({ value: c.id, label: c.name }))] },
          { key: "method", label: "Methods", options: methods.map((m) => ({ value: m, label: m })) },
        ]}
      />
      {rows.length === 0 ? (
        filtered ? <EmptyState icon={CreditCard} title="No expenses match" /> : <EmptyState icon={CreditCard} title="No expenses recorded" description="Record rent, marketing, packaging, software and other running costs." action={addButton} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHeader column="expense_date" label="Date" pathname="/expenses" searchParams={sp} current={lp.sort} dir={lp.dir} />
                  <TableHead>Description</TableHead>
                  <TableHead className="hidden md:table-cell">Category</TableHead>
                  <TableHead className="hidden lg:table-cell">Method</TableHead>
                  <SortHeader column="amount" label="Amount" pathname="/expenses" searchParams={sp} current={lp.sort} dir={lp.dir} className="text-right" align="right" />
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap">{formatDate(e.expense_date)}</TableCell>
                    <TableCell>
                      <span className="font-medium">{e.description}</span> {e.is_demo && <DemoBadge />}
                      {e.vendor && <div className="text-xs text-muted-foreground">{e.vendor}</div>}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{e.expense_categories?.name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="hidden lg:table-cell">{e.payment_method ?? "—"}</TableCell>
                    <TableCell className="text-right"><Money value={e.amount} /></TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {e.receipt_path && urls.get(e.receipt_path) && (
                          <Button size="icon-sm" variant="ghost" asChild aria-label="View receipt"><a href={urls.get(e.receipt_path)} target="_blank" rel="noreferrer"><FileText /></a></Button>
                        )}
                        <ExpenseDialog
                          {...dialogProps}
                          receiptUrl={e.receipt_path ? urls.get(e.receipt_path) : null}
                          initial={{
                            id: e.id,
                            expense_date: e.expense_date,
                            category_id: e.category_id,
                            description: e.description,
                            amount: String(e.amount),
                            vendor: e.vendor ?? "",
                            supplier_id: e.supplier_id,
                            payment_method: e.payment_method,
                            reference: e.reference ?? "",
                            receipt_path: e.receipt_path,
                            notes: e.notes ?? "",
                          }}
                          trigger={<Button size="icon-sm" variant="ghost" aria-label="Edit expense"><Pencil /></Button>}
                        />
                        <ConfirmAction trigger={<Button size="icon-sm" variant="ghost" aria-label="Delete expense"><Trash2 /></Button>} title="Delete this expense?" description={`"${e.description}" will be removed permanently.`} confirmLabel="Delete" destructive action={deleteExpenseAction.bind(null, e.id)} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination pathname="/expenses" searchParams={sp} page={lp.page} total={count ?? 0} />
        </>
      )}
    </>
  );
}
