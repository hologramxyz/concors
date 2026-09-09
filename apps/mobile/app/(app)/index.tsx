import { router } from "expo-router";
import { Button, Card, Copy, Loading, Notice, Row, Screen } from "../../src/ui";
import { useMachines, useCapabilities } from "../../src/queries";
import { useMachine } from "../../src/connection/provider";
import { config } from "../../src/config";

export default function MachinesScreen() {
  const machines = useMachines();
  const capabilities = useCapabilities();
  const { selectMachine } = useMachine();
  const connectable = config.demo || !!config.developmentDaemon || capabilities.data?.remoteAccess;
  return (
    <Screen
      title="Your machines"
      subtitle="A place for every project."
      action={
        <Button
          secondary
          onPress={() => {
            void machines.refetch();
            void capabilities.refetch();
          }}
        >
          Refresh
        </Button>
      }
    >
      {config.demo && <Notice>Demo preview · No real machines are connected.</Notice>}
      {machines.isPending && <Loading />}
      {machines.isError && (
        <Notice>Could not load your machines. Check your connection and tap Refresh.</Notice>
      )}
      {capabilities.isError && (
        <Notice>Could not check remote access availability. Tap Refresh to try again.</Notice>
      )}
      {!capabilities.isPending && !capabilities.isError && !connectable && (
        <Notice>
          Remote access is not available on this Concors server yet. You can still view your
          machines here.
        </Notice>
      )}
      {machines.data?.length === 0 && (
        <Card>
          <Copy weight="600">No machines yet</Copy>
          <Copy muted>Machines connected to your Concors account will appear here.</Copy>
        </Card>
      )}
      {machines.data?.map((machine) => (
        <Row
          key={machine.id}
          title={machine.name}
          subtitle={`${machine.region} · ${machine.size}`}
          badge={machine.status}
          disabled={!connectable || machine.status !== "running"}
          onPress={() => {
            if (connectable && machine.status === "running") {
              selectMachine(machine.id);
              router.push("/(app)/workspace");
            }
          }}
        />
      ))}
      <Copy muted size={13}>
        Your code and agent processes stay on your machine. This app connects you to their current
        state.
      </Copy>
    </Screen>
  );
}
