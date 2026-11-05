import { X } from "lucide-react";
import {
  setAccountPromptDismissed,
  useAccountPromptDismissed,
} from "@/agents/dismissed-account-prompts";
import { SidebarTooltip } from "@/components/sidebar-tooltip";
import { Button } from "@/components/ui/button";

const DISMISSAL_KEY = "guest-sign-in";

/**
 * Tells a guest what an account adds. It looks and is remembered like the account prompts in a
 * chat, and offers no more than the account menu's Sign in does, which stays after a dismissal.
 */
export function GuestSignInCard({
  onSignIn,
  onDismissed,
}: {
  onSignIn: () => void;
  /** The focused × is gone by now, so the caller gives a keyboard user somewhere to continue. */
  onDismissed: () => void;
}) {
  const dismissed = useAccountPromptDismissed(DISMISSAL_KEY);
  if (dismissed) return null;
  return (
    <section
      aria-label="Sign in to Concors"
      className="mx-2 mb-1 shrink-0 rounded-xl border bg-muted/50 p-3 text-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-foreground">Sign in to Concors</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Use cloud machines and Concors on your phone.
          </p>
        </div>
        {/* One title line tall, so the larger button centres on that line. */}
        <div className="flex h-lh items-center">
          <SidebarTooltip place="above" content="Dismiss">
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground"
              aria-label="Dismiss"
              onClick={() => {
                setAccountPromptDismissed(DISMISSAL_KEY, true);
                onDismissed();
              }}
            >
              <X className="size-4" />
            </Button>
          </SidebarTooltip>
        </div>
      </div>
      <div className="mt-3">
        <Button variant="outline" onClick={onSignIn}>
          Sign in
        </Button>
      </div>
    </section>
  );
}
