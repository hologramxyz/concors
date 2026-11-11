import { useContext, type ReactNode } from "react";
import { cn } from "cn";
import type { LucideIcon } from "lucide-react";
import { CompactLayoutContext } from "./compact-layout";

/** Phone empty states need a visible destination, rather than a sentence lost in a tall sheet. */
export function EmptyState({
  icon: Icon,
  title,
  children,
  inCard = false,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  inCard?: boolean;
}) {
  const compact = useContext(CompactLayoutContext);
  return compact ? (
    <div className={cn("mobile-empty-state", inCard && "mobile-empty-state-in-card")} role="status">
      <span className="mobile-empty-state-icon" aria-hidden="true">
        <Icon />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  ) : (
    <p role="status" className={cn("text-sm text-muted-foreground", inCard && "p-4")}>
      {children}
    </p>
  );
}
