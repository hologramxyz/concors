import { useState } from "react";
import { router } from "expo-router";
import { View } from "react-native";
import { newRequestId } from "@concors/client-core";
import type { PaneProfile } from "@concors/protocol";
import { useMachine } from "../../src/connection/provider";
import { ConnectionStatus } from "../../src/connection/status";
import { Button, Card, Copy, Field, Notice, Row, Screen, layout } from "../../src/ui";

export default function WorkspaceScreen() {
  const { machineId, connection } = useMachine();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [tabId, setTabId] = useState<string | null>(null);
  const [profile, setProfile] = useState<PaneProfile>("chat");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const projects = connection.workspace?.projects ?? [];
  const project = projects.find((item) => item.id === projectId) ?? projects[0];
  const tab = project?.tabs.find((item) => item.id === tabId) ?? project?.tabs[0];
  const create = async () => {
    if (!project || !connection.transport || !connection.workspace || !name.trim()) return;
    setBusy(true);
    setError(null);
    const nextTab = newRequestId();
    try {
      const result = await connection.transport.executeWorkspace({
        type: "workspace.command",
        commandId: newRequestId(),
        epoch: connection.workspace.epoch,
        operation: {
          kind: "tab.create",
          projectId: project.id,
          expectedVersion: project.version,
          tabId: nextTab,
          paneId: newRequestId(),
          name: name.trim(),
          profile,
        },
      });
      if (result.outcome.status === "rejected") throw new Error(result.outcome.message);
      setTabId(nextTab);
      setName("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create a session.");
    } finally {
      setBusy(false);
    }
  };
  if (!machineId)
    return (
      <Screen title="Workspace">
        <Copy muted>Select a machine to browse its projects and sessions.</Copy>
        <Button onPress={() => router.push("/(app)")}>Choose a machine</Button>
      </Screen>
    );
  return (
    <Screen title="Workspace" subtitle="Pick up where you left off.">
      <ConnectionStatus />
      {projects.length === 0 && (
        <Card>
          <Copy weight="600">No projects to show</Copy>
          <Copy muted>
            {connection.phase === "ready"
              ? "Open or create a project on this machine in Concors desktop. It will appear here automatically."
              : "Projects appear once the machine connects."}
          </Copy>
        </Card>
      )}
      {projects.map((item) => (
        <Row
          key={item.id}
          title={item.name}
          subtitle={item.directory}
          badge={project?.id === item.id ? "Selected" : undefined}
          onPress={() => {
            setProjectId(item.id);
            setTabId(null);
          }}
        />
      ))}
      {project && (
        <>
          <Copy size={18} weight="600">
            {project.name} / Sessions
          </Copy>
          <View style={layout.row}>
            {project.tabs.map((item) => (
              <Button
                key={item.id}
                secondary={tab?.id !== item.id}
                onPress={() => setTabId(item.id)}
              >
                {item.name}
              </Button>
            ))}
          </View>
          {tab?.nodes
            .filter((node) => node.kind === "pane")
            .map((pane, index) => (
              <Row
                key={pane.id}
                title={
                  pane.profile === "chat"
                    ? "Agent conversation"
                    : `${pane.profile === "shell" ? "Terminal" : pane.profile} ${index + 1}`
                }
                subtitle={pane.sessionId ? "Continue session" : "Ready to start"}
                badge={pane.profile === "chat" ? "Chat" : "Terminal"}
                onPress={() =>
                  router.push({
                    pathname: "/session",
                    params: { machineId, projectId: project.id, tabId: tab.id, paneId: pane.id },
                  })
                }
              />
            ))}
          <Copy muted size={13}>
            Each pane opens full screen on your phone. Your desktop layout stays saved on the
            machine.
          </Copy>
          <Card>
            <Copy weight="600">New session</Copy>
            <Field
              label="Session name"
              value={name}
              onChangeText={setName}
              maxLength={120}
              placeholder="What are you working on?"
            />
            <View style={layout.row}>
              {(["chat", "shell", "codex", "claude", "opencode"] as const).map((item) => (
                <Button key={item} secondary={profile !== item} onPress={() => setProfile(item)}>
                  {item === "chat" ? "Codex chat" : item === "shell" ? "Shell" : item}
                </Button>
              ))}
            </View>
            {error && <Notice>{error}</Notice>}
            <Button
              disabled={busy || !name.trim() || connection.phase !== "ready"}
              onPress={() => {
                void create();
              }}
            >
              {busy ? "Creating…" : "Create session"}
            </Button>
          </Card>
        </>
      )}
    </Screen>
  );
}
