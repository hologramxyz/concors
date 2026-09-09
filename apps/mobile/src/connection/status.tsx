import { useMachine } from "./provider";
import { Button, Copy, Notice, layout } from "../ui";
import { View } from "react-native";
export function ConnectionStatus() {
  const { connection, retry } = useMachine();
  if (connection.phase === "ready") return null;
  return (
    <Notice>
      <View style={layout.stack}>
        <Copy size={14}>{connection.message ?? "Connecting to your machine…"}</Copy>
        {connection.workspace && (
          <Copy size={13}>
            Showing the last received state. Controls are disabled until connected.
          </Copy>
        )}
        <Button secondary onPress={retry}>
          Reconnect
        </Button>
      </View>
    </Notice>
  );
}
