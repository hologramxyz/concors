import { useEffect, useState } from "react";
import { Linking, View } from "react-native";
import { api } from "./runtime";
import { deviceStorage } from "../platform/storage";
import { Button, Copy, Notice } from "../ui";

/** A status-only receipt remains available after account sessions have been revoked. */
export function DeletionReceipt() {
  const [receipt, setReceipt] = useState<string | null>(null);
  const [status, setStatus] = useState(
    "Deletion requested. Your account sessions have been revoked.",
  );
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void deviceStorage
      .get("account-deletion-receipt.v1")
      .then(setReceipt)
      .catch(() => undefined);
  }, []);
  const check = async () => {
    if (!receipt || busy) return;
    setBusy(true);
    try {
      const result = await api.getAccountDeletionStatus(receipt);
      setStatus(
        result.status === "completed"
          ? "Deletion complete. Your Concors account and associated service records have been removed."
          : result.delayed
            ? "Cleanup is delayed. Contact gm@hologram.xyz using your private receipt link."
            : "Deletion is processing. Cleanup usually finishes within minutes and retries after provider outages.",
      );
    } catch {
      setStatus(
        "Could not check deletion status. Your private receipt is saved; retry when connected.",
      );
    } finally {
      setBusy(false);
    }
  };
  if (!receipt) return null;
  return (
    <Notice>
      <View style={{ gap: 12 }}>
        <Copy>{status}</Copy>
        <Button
          secondary
          disabled={busy}
          onPress={() => {
            void check();
          }}
        >
          Check deletion status
        </Button>
        <Button
          secondary
          onPress={() => {
            void Linking.openURL(`https://concors.dev/account/delete#receipt=${receipt}`);
          }}
        >
          Open private receipt
        </Button>
        <Button
          secondary
          onPress={() => {
            void deviceStorage
              .set("account-deletion-receipt.v1", null)
              .then(() => setReceipt(null))
              .catch(() => setStatus("Could not remove this receipt. Try again."));
          }}
        >
          Dismiss receipt from this device
        </Button>
      </View>
    </Notice>
  );
}
