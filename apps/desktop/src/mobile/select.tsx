import type { ReactNode } from "react";
import { Select } from "radix-ui";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

export interface MobileSelectOption {
  value: string;
  label: string;
  icon?: ReactNode;
  description?: string;
}

/** One accessible, touch-sized picker for workspace, machines and settings. */
export function MobileSelect({
  label,
  value,
  onValueChange,
  groups,
  placeholder,
  className = "",
}: {
  label: string;
  value: string;
  onValueChange(value: string): void;
  groups: { label: string; options: MobileSelectOption[] }[];
  placeholder?: string;
  className?: string;
}) {
  const selected = groups.flatMap((group) => group.options).find((item) => item.value === value);
  return (
    <Select.Root value={value} onValueChange={onValueChange}>
      <Select.Trigger
        aria-label={label}
        data-value={value}
        className={`mobile-select-trigger ${className}`}
      >
        {selected?.icon && <span className="mobile-select-icon">{selected.icon}</span>}
        <Select.Value placeholder={placeholder}>
          <span className="truncate">{selected?.label ?? placeholder}</span>
        </Select.Value>
        <Select.Icon className="mobile-select-chevron">
          <ChevronDown />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          position="popper"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="mobile-select-content"
        >
          <Select.ScrollUpButton className="mobile-select-scroll">
            <ChevronUp className="size-4" />
          </Select.ScrollUpButton>
          <Select.Viewport>
            {groups.map((group) => (
              <Select.Group key={group.label}>
                <Select.Label className="mobile-select-label">{group.label}</Select.Label>
                {group.options.map((option) => (
                  <Select.Item
                    key={option.value}
                    value={option.value}
                    data-value={option.value}
                    textValue={option.label}
                    className="mobile-select-option"
                  >
                    {option.icon && <span className="mobile-select-icon">{option.icon}</span>}
                    <span className="min-w-0 flex-1">
                      <Select.ItemText>{option.label}</Select.ItemText>
                      {option.description && (
                        <span className="mobile-select-description">{option.description}</span>
                      )}
                    </span>
                    <Select.ItemIndicator>
                      <Check className="size-4" />
                    </Select.ItemIndicator>
                  </Select.Item>
                ))}
              </Select.Group>
            ))}
          </Select.Viewport>
          <Select.ScrollDownButton className="mobile-select-scroll">
            <ChevronDown className="size-4" />
          </Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
