import { Check } from "lucide-react";
import appStoreQr from "@/assets/app-store-qr.svg";
import { Button } from "@/components/ui/button";
import { IOS_APP_STORE_URL } from "@/components/mobile-app";
import { openExternal } from "@/tauri/open-external";
import { StepFrame } from "./frame";

const FEATURES = [
  "See every chat and what each agent is working on",
  "Answer questions and approve changes when an agent needs you",
  "Start new agents and send follow-ups on the go",
];

/** Fourth step: the iPhone app, which connects to the same machine. */
export function PhoneStep({
  banner,
  onBack,
  onNext,
  onSkip,
}: {
  banner?: React.ReactNode;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  return (
    <StepFrame
      step={3}
      title="Take your agents with you"
      description="Concors for iPhone shows what your agents are doing and lets you answer them from anywhere. It connects to the same machine."
      banner={banner}
      primary={{ label: "Continue", onClick: onNext }}
      onBack={onBack}
      onSkip={onSkip}
    >
      <div className="flex flex-wrap items-center gap-7">
        <img
          src={appStoreQr}
          alt="QR code for Concors on the App Store"
          className="size-[170px] rounded-xl border bg-white p-2.5"
        />
        <div className="min-w-0 flex-1 space-y-3">
          <ul className="space-y-2.5 text-sm">
            {FEATURES.map((feature) => (
              <li key={feature} className="flex items-start gap-2.5">
                <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
                  <Check className="size-3" aria-hidden="true" />
                </span>
                {feature}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2.5 pt-2">
            <Button
              variant="outline"
              onClick={() => void openExternal(IOS_APP_STORE_URL).catch(() => undefined)}
            >
              Open in App Store
            </Button>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
              Android coming soon
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Scan with your iPhone camera, then sign in with the same account.
          </p>
        </div>
      </div>
    </StepFrame>
  );
}
