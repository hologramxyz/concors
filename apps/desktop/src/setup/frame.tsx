import type { ReactNode } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import { SETUP_STEPS } from "./model";

export interface PrimaryAction {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly busy?: boolean;
}

/**
 * One step's page: its counter, title and description, what it asks, and the footer. Every step
 * can be skipped except the last, whose own action finishes setup, as in Paseo's setup.
 */
export function StepFrame({
  step,
  title,
  description,
  banner,
  primary,
  onBack,
  onSkip,
  children,
}: {
  step: number;
  title: string;
  description: ReactNode;
  /** Above the title: how a cloud machine bought in the first step is getting on. */
  banner?: ReactNode;
  primary: PrimaryAction;
  onBack?: (() => void) | undefined;
  onSkip?: (() => void) | undefined;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby="setup-step-title" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="chat-scroll min-h-0 flex-1 overflow-y-auto px-6 pt-7 pb-6 sm:px-10">
        {banner}
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          Step {step + 1} of {SETUP_STEPS.length}
        </p>
        <h2 id="setup-step-title" className="text-[22px] font-semibold tracking-tight">
          {title}
        </h2>
        <p className="mt-1.5 mb-6 max-w-[600px] text-sm leading-relaxed text-muted-foreground">
          {description}
        </p>
        {children}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t px-6 py-4">
        {onSkip && (
          <Button variant="ghost" onClick={onSkip}>
            Skip setup
          </Button>
        )}
        <span className="flex-1" />
        {onBack && (
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
        )}
        <Button
          data-setup-primary
          disabled={primary.disabled || primary.busy}
          aria-busy={primary.busy || undefined}
          onClick={primary.onClick}
        >
          {primary.busy && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
          {primary.label}
        </Button>
      </div>
    </section>
  );
}

export function StepRail({ step, onGoTo }: { step: number; onGoTo: (step: number) => void }) {
  return (
    <nav
      aria-label="Setup steps"
      className="hidden w-[220px] shrink-0 flex-col border-r bg-muted/40 px-4 py-7 md:flex"
    >
      <p className="px-2 text-base font-semibold tracking-tight">Welcome to Concors</p>
      <p className="mt-1 mb-6 px-2 text-xs leading-relaxed text-muted-foreground">
        A few steps and your first agent is at work.
      </p>
      <ol className="space-y-1">
        {SETUP_STEPS.map((label, index) => {
          const done = index < step;
          const current = index === step;
          return (
            <li key={label}>
              <button
                type="button"
                aria-current={current ? "step" : undefined}
                // Only the steps already passed can be gone back to; the next ones depend on them.
                disabled={!done}
                onClick={() => onGoTo(index)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm text-muted-foreground disabled:cursor-default",
                  current && "bg-muted font-semibold text-foreground",
                  done && "text-foreground hover:bg-muted/70",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
                    current && "border-foreground bg-foreground text-background",
                    done &&
                      "border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400",
                  )}
                >
                  {done ? <Check className="size-3" /> : index + 1}
                </span>
                {label}
              </button>
            </li>
          );
        })}
      </ol>
      <p className="mt-auto px-2 text-xs leading-relaxed text-muted-foreground">
        Everything here can be changed later in Settings.
      </p>
    </nav>
  );
}

/** A step that works on the chosen machine, while that machine cannot be reached yet. */
export function WaitingForMachine({ children }: { children?: ReactNode }) {
  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-xl border bg-muted/30 px-4 py-5 text-sm text-muted-foreground"
    >
      <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden="true" />
      <span>
        {children ??
          "Waiting for your machine. This step carries on as soon as Concors can reach it."}
      </span>
    </div>
  );
}
