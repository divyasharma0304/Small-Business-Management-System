import { cn } from "@/lib/utils";
import { titleCase } from "@/lib/format";

type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "primary";

const TONES: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-info/12 text-info",
  success: "bg-success/12 text-success",
  warning: "bg-warning/18 text-[color-mix(in_oklch,var(--warning),black_40%)] dark:text-warning",
  danger: "bg-destructive/12 text-destructive",
  primary: "bg-primary/10 text-primary",
};

const STATUS_TONES: Record<string, Tone> = {
  // orders
  draft: "neutral",
  confirmed: "info",
  processing: "primary",
  ready: "primary",
  shipped: "info",
  delivered: "success",
  cancelled: "danger",
  returned: "warning",
  // purchases
  ordered: "info",
  partially_received: "warning",
  received: "success",
  // payments
  unpaid: "danger",
  partial: "warning",
  paid: "success",
  // production
  planned: "neutral",
  in_progress: "primary",
  completed: "success",
  // stock
  low: "warning",
  out: "danger",
  ok: "success",
  over: "info",
  active: "success",
  inactive: "neutral",
  demo: "primary",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", TONES[tone], className)}>
      {children}
    </span>
  );
}

export function StatusBadge({ status, label, className }: { status: string; label?: string; className?: string }) {
  return (
    <Badge tone={STATUS_TONES[status] ?? "neutral"} className={className}>
      {label ?? titleCase(status)}
    </Badge>
  );
}

export function StockBadge({ quantity, min, max }: { quantity: number; min: number; max?: number | null }) {
  if (quantity <= 0) return <StatusBadge status="out" label="Out of stock" />;
  if (min > 0 && quantity <= min) return <StatusBadge status="low" label="Low stock" />;
  if (max != null && quantity > max) return <StatusBadge status="over" label="Above max" />;
  return <StatusBadge status="ok" label="In stock" />;
}

export function DemoBadge() {
  return <Badge tone="primary">Demo</Badge>;
}

export function ImportedBadge() {
  return <Badge tone="neutral">Imported</Badge>;
}
