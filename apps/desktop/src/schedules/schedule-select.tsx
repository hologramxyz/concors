import { ChevronDown } from "lucide-react";
import { useContext, useId, type ReactNode } from "react";
import { CompactLayoutContext } from "@/components/compact-layout";
import { MobileSelect } from "@/mobile/select";
import { SidebarTooltip } from "@/components/sidebar-tooltip";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface ScheduleSelectOption<Value extends string> {
  value: Value;
  label: ReactNode;
  textValue?: string;
  tooltip?: string | undefined;
}

/** A labelled field that opens the app's menu, for the choices in the schedule form. */
export function ScheduleSelect<Value extends string>({
  label,
  value,
  options,
  placeholder,
  disabled,
  onChange,
}: {
  label: string;
  value: Value;
  options: readonly ScheduleSelectOption<Value>[];
  /** Shown while nothing listed is chosen. A saved choice can outlive what it pointed at. */
  placeholder: ReactNode;
  disabled?: boolean;
  onChange: (value: Value) => void;
}) {
  const labelId = useId();
  const compact = useContext(CompactLayoutContext);
  const chosen = options.find((option) => option.value === value);
  if (compact)
    return (
      <div className="min-w-0 space-y-1.5">
        <span>{label}</span>
        <MobileSelect
          label={label}
          value={value}
          disabled={!!disabled}
          selectedLabel={chosen?.label ?? placeholder}
          presentation="sheet"
          groups={[
            {
              options: options.map((option) => ({
                value: option.value,
                label: option.label,
                ...(option.textValue ? { textValue: option.textValue } : {}),
                ...(option.tooltip ? { description: option.tooltip } : {}),
              })),
            },
          ]}
          onValueChange={(next) => {
            const option = options.find((option) => option.value === next);
            if (option) onChange(option.value);
          }}
        />
      </div>
    );
  return (
    <div className="min-w-0 space-y-1.5">
      <span id={labelId}>{label}</span>
      <DropdownMenu>
        <SidebarTooltip place="menu" content={chosen?.tooltip}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-labelledby={labelId}
              disabled={disabled}
              className="flex h-8 min-h-0 w-full min-w-0 justify-start bg-transparent px-2.5 py-1 font-normal dark:bg-input/30"
            >
              <span className="flex min-w-0 flex-1 gap-2 truncate text-left">
                {chosen ? chosen.label : placeholder}
              </span>
              <ChevronDown className="shrink-0 text-muted-foreground" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
        </SidebarTooltip>
        <DropdownMenuContent
          align="start"
          collisionPadding={16}
          className="max-h-[min(16rem,var(--radix-dropdown-menu-content-available-height))]"
        >
          <DropdownMenuRadioGroup
            aria-labelledby={labelId}
            value={value}
            onValueChange={(next) => onChange(next as Value)}
          >
            {options.map((option) => (
              <SidebarTooltip key={option.value} place="menu" content={option.tooltip}>
                <DropdownMenuRadioItem value={option.value}>
                  <span className="flex min-w-0 flex-1 gap-2 truncate">{option.label}</span>
                </DropdownMenuRadioItem>
              </SidebarTooltip>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
