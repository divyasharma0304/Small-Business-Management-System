"use client";

import { useRef, useState } from "react";
import { FileText, ImageIcon, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

const MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/**
 * Uploads a file straight to the private Supabase Storage bucket using the
 * signed-in user's session. Storage policies only allow paths inside the user's
 * own business folder: {businessId}/{folder}/{random}.{ext}
 */
export function FileUpload({
  businessId,
  folder,
  value,
  previewUrl,
  onChange,
  kind = "image",
  label,
  className,
}: {
  businessId: string;
  folder: "products" | "logos" | "receipts" | "purchases";
  value: string | null;
  previewUrl?: string | null;
  onChange: (path: string | null) => void;
  kind?: "image" | "document";
  label?: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const accept = kind === "image" ? IMAGE_TYPES.join(",") : [...IMAGE_TYPES, "application/pdf"].join(",");

  async function upload(file: File) {
    if (file.size > MAX_BYTES) return toast.error(`File is too large (${formatBytes(file.size)}). Maximum is 10 MB.`);
    if (!accept.split(",").includes(file.type)) return toast.error("Unsupported file type.");
    setBusy(true);
    try {
      const ext = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `${businessId}/${folder}/${crypto.randomUUID()}.${ext}`;
      const { error } = await createClient().storage.from("business-files").upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (error) {
        console.error(error);
        toast.error("Upload failed. Please try again.");
        return;
      }
      setLocalPreview(file.type.startsWith("image/") ? URL.createObjectURL(file) : null);
      onChange(path);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const shownPreview = localPreview ?? (value ? previewUrl : null);

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted">
        {busy ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        ) : shownPreview ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed URLs from private storage
          <img src={shownPreview} alt="" className="size-full object-cover" />
        ) : value ? (
          <FileText className="size-6 text-muted-foreground" />
        ) : kind === "image" ? (
          <ImageIcon className="size-6 text-muted-foreground" />
        ) : (
          <FileText className="size-6 text-muted-foreground" />
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="sr-only"
          aria-label={label ?? "Upload file"}
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        />
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
          <Upload /> {value ? "Replace" : (label ?? "Upload")}
        </Button>
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              setLocalPreview(null);
              onChange(null);
            }}
          >
            <X /> Remove
          </Button>
        )}
        {value && previewUrl && !localPreview && kind === "document" && (
          <a href={previewUrl} target="_blank" rel="noreferrer" className="self-center text-sm text-primary hover:underline">
            View file
          </a>
        )}
      </div>
    </div>
  );
}
