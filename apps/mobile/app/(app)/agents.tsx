import { router } from "expo-router";
import { sessionHref } from "@concors/client-core";
import { useMachine } from "../../src/connection/provider";
import { ConnectionStatus } from "../../src/connection/status";
import { Button, Card, Copy, Row, Screen } from "../../src/ui";

export default function AgentsScreen() {
  const { machineId, connection } = useMachine();
  if (!machineId)
    return (
      <Screen title="Your agents">
        <Copy muted>Choose a machine to check in on its agents.</Copy>
        <Button onPress={() => router.push("/(app)")}>Choose a machine</Button>
      </Screen>
    );
  const priority: Record<string, number> = {
    needs_input: 0,
    failed: 1,
    working: 2,
    starting: 3,
    done: 4,
  };
  const agents = [...connection.agents].sort(
    (a, b) => (priority[a.status] ?? 5) - (priority[b.status] ?? 5),
  );
  const terminals = connection.terminals.filter(
    (item) => item.profile !== "shell" || item.detectedAgent,
  );
  const projectName = (id: string) =>
    connection.workspace?.projects.find((project) => project.id === id)?.name ?? "Project";
  return (
    <Screen title="Your agents" subtitle="Requests first. Progress at a glance.">
      <ConnectionStatus />
      {agents.length === 0 && terminals.length === 0 && (
        <Card>
          <Copy weight="600">A quiet workspace</Copy>
          <Copy muted>Start an agent from a project to follow its progress here.</Copy>
          <Button secondary onPress={() => router.push("/(app)/workspace")}>
            Open workspace
          </Button>
        </Card>
      )}
      {agents.map((agent) => (
        <Row
          key={agent.id}
          title={agent.name}
          subtitle={`${projectName(agent.projectId)} · Codex`}
          badge={agent.status}
          onPress={() =>
            router.push(sessionHref({ machineId, projectId: agent.projectId, sessionId: agent.id }))
          }
        />
      ))}
      {terminals.map((terminal) => (
        <Row
          key={terminal.id}
          title={`${terminal.detectedAgent ?? terminal.profile} terminal`}
          subtitle={projectName(terminal.projectId)}
          badge={terminal.agentActivity ?? terminal.status}
          onPress={() =>
            router.push(
              sessionHref({ machineId, projectId: terminal.projectId, sessionId: terminal.id }),
            )
          }
        />
      ))}
    </Screen>
  );
}
