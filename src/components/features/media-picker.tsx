"use client";

import { useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Film, X, Upload } from "lucide-react";
import { toast } from "sonner";

const ACCEPTED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "video/mp4",
  "video/quicktime",
];

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface MediaPickerProps {
  file: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
}

export function MediaPicker({ file, onChange, disabled }: MediaPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (f: File) => {
      if (!ACCEPTED_TYPES.includes(f.type)) {
        toast.error("Unsupported file type. Use PNG, JPEG, GIF, MP4, or MOV.");
        return;
      }
      if (f.size > MAX_FILE_SIZE) {
        toast.error("File exceeds 50 MB limit.");
        return;
      }
      onChange(f);
    },
    [onChange]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (disabled) return;
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    },
    [disabled, handleFile]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) handleFile(f);
      // Reset so the same file can be re-selected
      e.target.value = "";
    },
    [handleFile]
  );

  const isVideo = file?.type.startsWith("video/");
  const previewUrl = file && !isVideo ? URL.createObjectURL(file) : null;

  return (
    <div className="space-y-2">
      {!file ? (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); }}
          className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/30 p-6 text-center transition-colors hover:border-muted-foreground/50"
        >
          <Upload className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Drop image, video, or GIF here
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            Browse
          </Button>
        </div>
      ) : (
        <div className="relative rounded-lg border bg-muted/30 p-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-2 top-2 h-7 w-7"
            disabled={disabled}
            onClick={() => { onChange(null); }}
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Remove media</span>
          </Button>

          <div className="flex items-start gap-3">
            {isVideo ? (
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-muted">
                <Film className="h-8 w-8 text-muted-foreground" />
              </div>
            ) : previewUrl ? (
              <img
                src={previewUrl}
                alt="Media preview"
                className="h-16 w-16 shrink-0 rounded-md object-cover"
              />
            ) : null}

            <div className="min-w-0 flex-1 pr-6">
              <p className="truncate text-sm font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground">
                {formatSize(file.size)}
              </p>
            </div>
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES.join(",")}
        className="hidden"
        onChange={handleInputChange}
        disabled={disabled}
      />
    </div>
  );
}
