import { useEffect, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { findSession, newRequestId } from "@concors/client-core";
import { useAuth } from "../src/auth/provider";
import { useMachine } from "../src/connection/provider";
import { ConnectionStatus } from "../src/connection/status";
import { useMachines, useCapabilities } from "../src/queries";
import { Button, Copy, Loading, Notice, Screen } from "../src/ui";
import { Chat } from "../src/agents/chat";
import { TerminalSurface } from "../src/terminal/surface";
import SignInScreen from "./index";
import { config } from "../src/config";

export default function SessionScreen() {
  const { me, loading } = useAuth();
  const { machineId, selectMachine, connection } = useMachine();
  const params = useLocalSearchParams<{
    machineId?: string;
    projectId?: string;
    sessionId?: string;
    paneId?: string;
    tabId?: string;
  }>();
  const machines = useMachines();
  const capabilities = useCapabilities();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const permitted =
    typeof params.machineId === "string" &&
    !!machines.data?.some((item) => item.id === params.machineId);
  const remoteAccess = config.demo || !!config.developmentDaemon || capabilities.data?.remoteAccess;
  useEffect(() => {
    if (me && permitted && remoteAccess && params.machineId && machineId !== params.machineId)
      selectMachine(params.machineId);
  }, [me, permitted, remoteAccess, params.machineId, machineId, selectMachine]);
  if (loading) return <Loading />;
  if (!me) return <SignInScreen />;
  if (machines.isPending || capabilities.isPending)
    return <Loading label="Checking machine access…" />;
  if (!permitted || !remoteAccess)
    return (
      <Screen title="Session unavailable">
        <Copy muted>
          {!permitted
            ? "This machine is not available in your current account and organization."
            : "Remote access is not available on this Concors server yet."}
        </Copy>
        <Button
          secondary
          onPress={() => {
            void machines.refetch();
            void capabilities.refetch();
          }}
        >
          Retry
        </Button>
      </Screen>
    );
  const workspace = machineId === params.machineId ? connection.workspace : null;
  const found = workspace && params.sessionId ? findSession(workspace, params.sessionId) : null;
  const project =
    found?.project ?? workspace?.projects.find((item) => item.id === params.projectId);
  const tab = found?.tab ?? project?.tabs.find((item) => item.id === params.tabId);
  const node =
    found?.pane ?? tab?.nodes.find((item) => item.id === params.paneId && item.kind === "pane");
  const pane = node?.kind === "pane" ? node : null;
  if (!workspace)
    return (
      <Screen title="Connecting">
        <ConnectionStatus />
      </Screen>
    );
  if (!project || !tab || !pane || (params.projectId && project.id !== params.projectId))
    return (
      <Screen title="Session unavailable">
        <Copy muted>
          The session may have moved or its pane may have been closed. Open the workspace to choose
          a current session.
        </Copy>
      </Screen>
    );
  const start = async (recover = false) => {
    if (!connection.transport) return;
    setBusy(true);
    setError(null);
    try {
      const target = {
        epoch: workspace.epoch,
        projectId: project.id,
        tabId: tab.id,
        paneId: pane.id,
        expectedVersion: project.version,
      };
      const result =
        pane.profile === "chat"
          ? await connection.transport.requestAgent({ kind: "start", ...target }, newRequestId())
          : await connection.transport.requestTerminal(
              {
                kind: "start",
                ...target,
                expectedSessionId: pane.sessionId,
                cols: 80,
                rows: 24,
                recover,
              },
              newRequestId(),
            );
      if (result.outcome.status === "error") throw new Error(result.outcome.message);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not start session. Check its state before retrying.",
      );
    } finally {
      setBusy(false);
    }
  };
  const terminal = connection.terminals.find((item) => item.id === pane.sessionId);
  const agent = connection.agents.find((item) => item.id === pane.sessionId);
  const interrupted = terminal?.status === "interrupted" || agent?.status === "interrupted";
  return (
    <Screen title={project.name} subtitle={tab.name} scroll={false}>
      <ConnectionStatus />
      {error && <Notice>{error}</Notice>}
      {!pane.sessionId ? (
        <>
          <Copy muted>
            This pane is ready for a{" "}
            {pane.profile === "chat" ? "Codex conversation" : `${pane.profile} terminal`}.
          </Copy>
          <Button
            disabled={busy || connection.phase !== "ready"}
            onPress={() => {
              void start();
            }}
          >
            {busy ? "Starting…" : "Start session"}
          </Button>
        </>
      ) : (
        <>
          {interrupted && (
            <Notice>
              <Copy>The machine session was interrupted.</Copy>
              <Button
                disabled={busy || connection.phase !== "ready"}
                onPress={() => {
                  void start(true);
                }}
              >
                Recover session
              </Button>
            </Notice>
          )}
          {pane.profile === "chat" ? (
            <Chat key={pane.sessionId} sessionId={pane.sessionId} />
          ) : (
            <TerminalSurface key={pane.sessionId} sessionId={pane.sessionId} />
          )}
        </>
      )}
    </Screen>
  );
}
