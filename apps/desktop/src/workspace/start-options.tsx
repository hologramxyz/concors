import { Button } from "@/components/ui/button";
import type { paneProfiles } from "./tab-profiles";

type Option = ReturnType<typeof paneProfiles>[number];

/**
 * The start screen's other ways to begin, beside the prompt box: everything the new-tab menu lists
 * after New chat, opened in this pane.
 */
export function StartOptions({
  options,
  disabled,
  onOpen,
}: {
  options: readonly Option[];
  disabled: boolean;
  onOpen: (option: Option) => void;
}) {
  return (
    <div role="group" aria-label="Start with" className="flex flex-wrap justify-center gap-2">
      {options
        .filter((option) => option.profile !== "chat")
        .map((option) => (
          <Button
            key={option.id}
            variant="outline"
            size="sm"
            className="text-muted-foreground"
            disabled={disabled}
            onClick={() => onOpen(option)}
          >
            <option.icon className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{option.label}</span>
          </Button>
        ))}
    </div>
  );
}
