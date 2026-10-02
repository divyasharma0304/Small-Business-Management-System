export type ColumnType = "text" | "date" | "money" | "qty" | "number" | "pct" | "status";

export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
  /** Hide on small screens */
  secondary?: boolean;
  /** Include in the totals row */
  total?: boolean;
}

export interface ReportRow {
  [key: string]: string | number | null | undefined;
  _href?: string;
}

export interface ReportResult {
  columns: ReportColumn[];
  rows: ReportRow[];
  summary: { label: string; value: number; type: "money" | "number" | "pct"; emphasis?: boolean }[];
  /** Explanatory note (formulas, definitions) shown above the table */
  note?: string;
}

export type FilterKey = "range" | "category" | "product" | "customer" | "supplier" | "orderStatus" | "purchaseStatus" | "paymentStatus" | "batchStatus" | "expenseCategory" | "direction";

export interface ReportParams {
  from: string;
  to: string;
  category?: string;
  product?: string;
  customer?: string;
  supplier?: string;
  status?: string;
  payment?: string;
  expenseCategory?: string;
  direction?: string;
}
