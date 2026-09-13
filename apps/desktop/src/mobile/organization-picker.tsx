import { useRef, useState } from "react";
import { Users, UserRound } from "lucide-react";
import { activeOrganization, type SignedInAuth } from "@/auth/auth-state";
import { MobileSelect } from "./select";

/** Account and Settings use the same organization drawer, never a separate team model. */
export function MobileOrganizationPicker({
  auth,
  onSelect,
}: {
  auth: SignedInAuth;
  onSelect(id: string): void | Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const organization = activeOrganization(auth);
  const select = async (id: string) => {
    if (pending.current || id === organization?.id) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await onSelect(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not switch organization");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="min-w-0 space-y-2">
      <MobileSelect
        label="Organization"
        presentation="sheet"
        value={organization?.id ?? ""}
        placeholder="Choose an organization"
        disabled={busy || !auth.organizations.length}
        onValueChange={(id) => void select(id)}
        groups={[
          {
            label: "Your organizations",
            options: auth.organizations.map((item) => ({
              value: item.id,
              label: item.name,
              icon: item.isPersonal ? <UserRound /> : <Users />,
              description: `${item.isPersonal ? "Personal" : "Team"} · ${item.role}`,
            })),
          },
        ]}
      />
      {busy && (
        <p role="status" className="text-xs text-muted-foreground">
          Switching organization…
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
