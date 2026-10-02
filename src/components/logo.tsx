import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-7", className)}>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <path d="M8 9.5 16 23l8-13.5" fill="none" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"
        className="stroke-primary-foreground" />
      <circle cx="16" cy="9.5" r="2" className="fill-primary-foreground/70" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      <span className="text-lg font-semibold tracking-tight">Velqora</span>
    </span>
  );
}
