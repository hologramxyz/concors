import { ArrowRight, ExternalLink, Smartphone, X } from "lucide-react";
import { useRef, useState, type RefObject } from "react";
import appStoreQr from "@/assets/app-store-qr.svg";
import { openExternal } from "@/tauri";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const IOS_APP_STORE_URL =
  "https://apps.apple.com/us/app/concors-agent-orchestrator/id6817622624";
const DISMISSED_KEY = "concors.mobile-app-ios.dismissed";

/** A launch notice, remembered on this computer. The account menu keeps the download available. */
export function MobileAppCard({ onDismissed }: { onDismissed: () => void }) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  if (dismissed) return null;

  return (
    <>
      <section
        aria-label="Concors for iOS"
        className="mx-2 mb-1 shrink-0 rounded-xl border border-primary/20 bg-primary/5 p-3 text-ui"
      >
        <div className="flex items-center gap-2">
          <Smartphone className="size-4 shrink-0 text-primary" aria-hidden="true" />
          <p className="flex-1 font-medium text-foreground">Concors for iOS</p>
          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            New
          </span>
          <button
            type="button"
            aria-label="Dismiss iOS app announcement"
            className="-mr-1 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => {
              try {
                localStorage.setItem(DISMISSED_KEY, "true");
              } catch {
                // Dismiss for this session even when storage is unavailable.
              }
              setDismissed(true);
              onDismissed();
            }}
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          Keep up with your agents from your phone.
        </p>
        <button
          ref={trigger}
          type="button"
          aria-haspopup="dialog"
          className="mt-2 inline-flex items-center gap-1.5 rounded font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          onClick={() => setOpen(true)}
        >
          Get the iOS app <ArrowRight className="size-3.5" aria-hidden="true" />
        </button>
      </section>
      <MobileAppDialog open={open} onOpenChange={setOpen} returnFocus={trigger} />
    </>
  );
}

export function MobileAppDialog({
  open,
  onOpenChange,
  returnFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocus: RefObject<HTMLButtonElement | null>;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[360px]"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus.current?.focus();
        }}
      >
        <DialogHeader>
          <div className="mb-1 flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Smartphone className="size-5" aria-hidden="true" />
          </div>
          <DialogTitle>Your agents, on your phone.</DialogTitle>
          <DialogDescription>
            Get Concors for iOS to check in, reply, and keep work moving wherever you are.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3">
          <img
            src={appStoreQr}
            alt="QR code to download Concors on the App Store"
            width={200}
            height={200}
            className="size-[200px] rounded-xl bg-white"
          />
          <p className="text-center text-ui text-muted-foreground">Scan with your iPhone camera.</p>
        </div>
        <p className="text-ui leading-relaxed text-muted-foreground">
          Add a machine in the desktop app, then sign in on your iPhone to connect to the same
          running sessions.
        </p>
        <Button
          className="w-full"
          onClick={() => {
            setError(null);
            void openExternal(IOS_APP_STORE_URL).catch(() =>
              setError("Could not open the App Store. Scan the QR code with your iPhone instead."),
            );
          }}
        >
          Open in App Store <ExternalLink aria-hidden="true" />
        </Button>
        {error && (
          <p role="alert" className="text-ui text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
