import { Monitor, Server } from "lucide-react";

export function MachineIcon({
  local = false,
  icon,
  className = "size-4",
}: {
  local?: boolean;
  icon?: string | null | undefined;
  className?: string;
}) {
  if (local)
    return (
      <Monitor data-machine-icon="local" aria-hidden="true" className={`${className} shrink-0`} />
    );
  if (icon)
    return (
      <span
        data-machine-icon="custom"
        aria-hidden="true"
        className={`${className} inline-flex shrink-0 items-center justify-center leading-none`}
      >
        {icon}
      </span>
    );
  return (
    <Server data-machine-icon="server" aria-hidden="true" className={`${className} shrink-0`} />
  );
}
