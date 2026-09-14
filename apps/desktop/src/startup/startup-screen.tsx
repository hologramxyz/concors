import { useEffect, useState } from "react";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";

export function StartupScreen({
  embedded = false,
  onOpenSettings,
}: {
  embedded?: boolean;
  onOpenSettings?: () => void;
}) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 12_000);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div
      className={embedded ? "concors-startup concors-startup--embedded" : "concors-startup"}
      data-startup-screen
      role="status"
      aria-label="Opening Concors"
      aria-busy={!slow}
    >
      <div className="concors-startup-brand" aria-hidden="true">
        <BrandMark className="concors-startup-mark" />
        <div className="concors-startup-shimmer" />
      </div>
      {slow && (
        <div className="absolute inset-x-4 top-[calc(50%+90px)] flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-muted-foreground">This is taking longer than expected.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" onClick={() => window.location.reload()}>
              Retry
            </Button>
            {onOpenSettings && (
              <Button variant="ghost" onClick={onOpenSettings}>
                Connection settings
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
