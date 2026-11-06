import { useId, useRef } from "react";
import { CircleAlert, File as FileIcon, Paperclip, X } from "lucide-react";
import { MAX_SCHEDULE_FILES } from "@concors/protocol";
import { Button } from "@/components/ui/button";
import { formatSize } from "@/files/file-size";
import { UPLOAD_LIMIT, type ScheduleFile } from "./use-schedule-files";

/** The Files field: what each run is sent, and a button to attach more. */
export function ScheduleFiles({
  files,
  disabled,
  onAdd,
  onRemove,
}: {
  files: ScheduleFile[];
  disabled: boolean;
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const labelId = useId();
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span id={labelId}>Files</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || files.length >= MAX_SCHEDULE_FILES}
          onClick={() => picker.current?.click()}
          className="-mr-2"
        >
          <Paperclip />
          Attach files
        </Button>
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          aria-label="Choose files to attach"
          onChange={(event) => {
            if (event.target.files?.length) onAdd(Array.from(event.target.files));
            event.target.value = "";
          }}
        />
      </div>
      {files.length ? (
        <ul aria-labelledby={labelId} className="space-y-1.5">
          {files.map((file) => {
            const percent = file.size ? Math.round((file.received / file.size) * 100) : 0;
            return (
              <li
                key={file.id}
                className="flex min-h-9 items-center gap-2 rounded-md border px-2.5 py-1.5"
              >
                {file.error ? (
                  <CircleAlert className="size-4 shrink-0 text-destructive" aria-hidden="true" />
                ) : (
                  <FileIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                <span
                  className={`shrink-0 text-xs ${file.error ? "text-destructive" : "text-muted-foreground"}`}
                  {...(!file.upload && !file.error
                    ? {
                        role: "progressbar",
                        "aria-label": `Uploading ${file.name}`,
                        "aria-valuemin": 0,
                        "aria-valuemax": 100,
                        "aria-valuenow": percent,
                      }
                    : {})}
                >
                  {file.error
                    ? "Did not upload"
                    : file.upload
                      ? formatSize(file.size)
                      : `Uploading ${percent}%`}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove ${file.name}`}
                  disabled={disabled}
                  onClick={() => onRemove(file.id)}
                  className="-mr-1 shrink-0"
                >
                  <X />
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-muted-foreground">
          Sent with every run, as if attached to its message. Up to {MAX_SCHEDULE_FILES} files,{" "}
          {UPLOAD_LIMIT} each.
        </p>
      )}
    </div>
  );
}
