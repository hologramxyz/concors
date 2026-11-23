import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { writeClipboardText } from "@/tauri";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { webhookCurl, webhookUrl } from "./helpers";

export function SecretDialog({
  id,
  secret,
  hostname,
  onClose,
}: {
  id: string;
  secret: string;
  hostname: string | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const url = webhookUrl(hostname, id);
  const curl = webhookCurl(url, secret);
  const copy = async (label: string, text: string) => {
    try {
      await writeClipboardText(text);
      setCopied(label);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not copy");
    }
  };
  const field = (label: string, value: string) => (
    <div className="space-y-1.5">
      <label className="text-ui" htmlFor={`webhook-${label}`}>
        {label}
      </label>
      <div className="flex gap-2">
        <Input id={`webhook-${label}`} readOnly value={value} className="font-mono text-xs" />
        <Button
          variant="outline"
          size="icon"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={() => void copy(label, value)}
        >
          {copied === label ? <Check /> : <Copy />}
        </Button>
      </div>
    </div>
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Webhook connection details</DialogTitle>
          <DialogDescription>
            The secret is shown only once. Save it somewhere secure before closing. Rotate it if it
            is lost or exposed.
          </DialogDescription>
        </DialogHeader>
        {url ? (
          field("URL", url)
        ) : (
          <p className="rounded-md bg-muted p-3 text-ui text-muted-foreground">
            Webhooks need a cloud machine. You can still manage triggers here; this local machine
            has no public webhook URL.
          </p>
        )}
        {field("Secret", secret)}
        {url && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-ui">Ready-to-use curl</span>
              <Button variant="outline" size="sm" onClick={() => void copy("curl", curl)}>
                <Copy />
                {copied === "curl" ? "Copied" : "Copy curl"}
              </Button>
            </div>
            <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs break-all whitespace-pre-wrap">
              {curl}
            </pre>
            <p className="text-xs text-muted-foreground">
              Use a different Idempotency-Key for each event. Reusing a key returns the original
              result.
            </p>
          </div>
        )}
        {error && (
          <p role="alert" className="text-ui text-destructive">
            {error}
          </p>
        )}
        {copied && (
          <p role="status" className="text-xs text-muted-foreground">
            {copied} copied
          </p>
        )}
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
