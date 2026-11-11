import { useContext, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { CompactLayoutContext } from "@/components/compact-layout";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MobileSelect } from "@/mobile/select";

/** Settings choices share the phone's dismissible drawer and the desktop's compact menu. */
export function SettingsChoice<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; icon?: ReactNode; description?: string }[];
  onChange(value: T): void;
  disabled?: boolean;
}) {
  const compact = useContext(CompactLayoutContext);
  const selected = options.find((option) => option.value === value);
  if (compact)
    return (
      <MobileSelect
        label={label}
        value={value}
        disabled={disabled}
        presentation="sheet"
        groups={[{ options: [...options] }]}
        onValueChange={(next) => {
          const option = options.find((option) => option.value === next);
          if (option) onChange(option.value);
        }}
      />
    );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          disabled={disabled}
          aria-label={label}
          variant="outline"
          size="sm"
          className="min-w-28 justify-between"
        >
          <span className="flex items-center gap-2">
            {selected?.icon}
            {selected?.label}
          </span>
          <ChevronDown className="opacity-60" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-36">
        {options.map((option) => (
          <DropdownMenuItem key={option.value} onSelect={() => onChange(option.value)}>
            {option.icon}
            {option.label}
            {option.value === value && <Check className="ml-auto" aria-hidden="true" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
