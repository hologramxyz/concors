import { useContext, useState } from "react";
import { CompactLayoutContext } from "@/components/compact-layout";
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
import { validPreviewUrl } from "./preview-links";

export function PreviewEditor({
  name: initialName = "",
  url: initialUrl = "",
  onSave,
  onRemove,
  onClose,
}: {
  name?: string;
  url?: string;
  onSave: (name: string, url: string) => void;
  onRemove?: () => void;
  onClose: () => void;
}) {
  const compact = useContext(CompactLayoutContext);
  const [name, setName] = useState(initialName);
  const [url, setUrl] = useState(initialUrl);
  const href = validPreviewUrl(url, compact);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{onRemove ? "Edit preview" : "Add preview"}</DialogTitle>
          <DialogDescription>
            Add an existing {compact ? "HTTPS" : "HTTP(S)"} preview or tunnel URL. This does not
            start a server or publish a port.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (href && name.trim()) onSave(name.trim(), href);
          }}
        >
          <label className="block space-y-2 text-sm">
            Name
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              placeholder="Web app"
            />
          </label>
          <label className="block space-y-2 text-sm">
            Preview URL
            <Input
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://your-preview.example"
            />
          </label>
          <p className="text-xs text-muted-foreground">
            For a remote machine, use its reachable URL—not this device’s localhost.
          </p>
          <DialogFooter>
            {onRemove && (
              <Button type="button" variant="ghost" onClick={onRemove}>
                Remove preview
              </Button>
            )}
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!href || !name.trim()}>
              Save preview
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
