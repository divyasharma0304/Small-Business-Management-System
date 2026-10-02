"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { ConfirmAction } from "@/components/confirm-action";
import { Badge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { createLookupAction, deleteLookupAction, updateLookupAction, type LookupTable } from "@/lib/actions/lookups";

export interface LookupRow {
  id: string;
  name: string;
  is_active: boolean;
  is_demo?: boolean;
  usage?: number;
}

/** Add / rename / activate / delete rows of a simple named list. */
export function LookupList({ table, rows, noun, placeholder }: { table: LookupTable; rows: LookupRow[]; noun: string; placeholder?: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, after?: () => void) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(res.error);
      if (res.message) toast.success(res.message);
      after?.();
      router.refresh();
    });
  }

  return (
    <div className="grid gap-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          run(() => createLookupAction(table, name), () => setName(""));
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder ?? `New ${noun.toLowerCase()}`} aria-label={`New ${noun}`} className="max-w-xs" />
        <Button type="submit" disabled={pending || !name.trim()}>
          {pending ? <Loader2 className="animate-spin" /> : <Plus />} Add
        </Button>
      </form>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No {noun.toLowerCase()}s yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-3 py-2">
              {editing === r.id ? (
                <form
                  className="flex flex-1 items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(() => updateLookupAction(table, r.id, { name: editName }), () => setEditing(null));
                  }}
                >
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus aria-label="Name" className="h-7" />
                  <Button type="submit" size="icon-sm" variant="ghost" aria-label="Save"><Check /></Button>
                  <Button type="button" size="icon-sm" variant="ghost" aria-label="Cancel" onClick={() => setEditing(null)}><X /></Button>
                </form>
              ) : (
                <>
                  <span className={r.is_active ? "flex-1 text-sm" : "flex-1 text-sm text-muted-foreground line-through"}>{r.name}</span>
                  {r.is_demo && <Badge tone="primary">Demo</Badge>}
                  {r.usage !== undefined && <span className="text-xs text-muted-foreground tabular">{r.usage} used</span>}
                  <Switch
                    checked={r.is_active}
                    aria-label={r.is_active ? "Deactivate" : "Activate"}
                    onCheckedChange={(v) => run(() => updateLookupAction(table, r.id, { is_active: v }))}
                  />
                  <Button size="icon-sm" variant="ghost" aria-label={`Rename ${r.name}`} onClick={() => { setEditing(r.id); setEditName(r.name); }}>
                    <Pencil />
                  </Button>
                  <ConfirmAction
                    trigger={<Button size="icon-sm" variant="ghost" aria-label={`Delete ${r.name}`}><Trash2 /></Button>}
                    title={`Delete "${r.name}"?`}
                    description="If it is used by existing records it can't be deleted — deactivate it instead."
                    confirmLabel="Delete"
                    destructive
                    action={() => deleteLookupAction(table, r.id)}
                  />
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
