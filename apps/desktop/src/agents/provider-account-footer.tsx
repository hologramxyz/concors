import { Button } from "@/components/ui/button";

/** The model menu's way to sign in to a provider that is not signed in, shaped like its update. */
export function ProviderAccountFooter({
  account,
  onConnect,
}: {
  /** What is signed into, as the sign-in notice names it. */
  account: string;
  onConnect: () => void;
}) {
  return (
    <div className="mt-1 border-t px-2 pt-2 pb-0.5 text-xs text-muted-foreground">
      <div className="flex min-h-7 items-center gap-2">
        <p className="min-w-0 flex-1 truncate">Connect {account} account</p>
        <Button size="sm" aria-label={`Connect ${account} account`} onClick={onConnect}>
          Connect
        </Button>
      </div>
    </div>
  );
}
