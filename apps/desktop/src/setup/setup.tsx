import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { Machine } from "@concors/api-client";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { describeStatus } from "@/machines/format";
import { useMachines } from "@/machines/use-machines";
import { LOCAL_HOST, machineAvailability, machineHost, type Host } from "@/workspace/machines";
import { AgentsStep } from "./agents-step";
import { FirstAgentStep } from "./first-agent-step";
import { StepRail } from "./frame";
import { PhoneStep } from "./phone-step";
import { ProjectStep } from "./project-step";
import {
  finishSetup,
  opensSetup,
  saveSetup,
  startSetup,
  useSetupRecord,
  type SetupRecord,
} from "./store";
import { WhereStep } from "./where-step";

type Open = Extract<SetupRecord, { status: "open" }>;

export interface FirstRunSetupProps {
  /** The selected machine's workspace has loaded, so whether it has workspaces is known. */
  ready: boolean;
  hasWorkspace: boolean;
  organization: { id: string; name: string } | null;
  selectedHost: Host;
  onSelectMachine: (host: Host) => void;
  onSignIn: () => void;
  onOpenFolder: () => void;
  onClone: () => void;
  onNewWorkspace: () => void;
  newWorkspaceBusy: boolean;
  onSelectProject: (projectId: string) => void;
  onNewChat: (projectId: string) => Promise<void>;
  onShowChat: (projectId: string, tabId: string) => void;
}

/**
 * First-run setup, after Paseo's: a window of five steps that gets a new user from nothing to an
 * agent at work. Where agents run (this computer, a cloud machine bought here, or one's own
 * server), the agents on that machine, a first project, the phone app, and a first task. Each step
 * reuses what the rest of the app offers for the same thing, so nothing here works differently
 * from Settings or the menus.
 *
 * It opens once per device for someone with no workspaces, can be skipped from any step, and comes
 * back from "Set up Concors" in the account menu and Search.
 */
export function FirstRunSetup(props: FirstRunSetupProps) {
  const { ready, hasWorkspace } = props;
  const record = useSetupRecord();
  // Decided once, when the app first has a workspace to look at: adding a project during setup,
  // or removing every one later, never opens or closes it by itself.
  const [decided, setDecided] = useState<boolean | null>(null);
  if (ready && decided === null) setDecided(opensSetup(record, hasWorkspace));
  const opens = decided === true && record.status === "none";
  useEffect(() => {
    if (opens) startSetup();
  }, [opens]);
  const open = record.status === "open" && decided !== null;
  return (
    <Dialog open={open}>
      {open && (
        <DialogContent
          size="wide"
          showCloseButton={false}
          aria-describedby="setup-description"
          // Leaving is "Skip setup", never a stray click or Escape meant for a dialog on top.
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          className="h-[min(660px,calc(100dvh-2rem))] max-w-[960px] flex-row gap-0 overflow-hidden p-0"
        >
          <DialogTitle className="sr-only">Set up Concors</DialogTitle>
          <DialogDescription id="setup-description" className="sr-only">
            A few steps to get your first agent working.
          </DialogDescription>
          <StepRail step={record.step} onGoTo={(step) => saveSetup({ ...rest(record), step })} />
          <Steps {...props} record={record} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function rest(record: Open): Omit<Open, "status"> {
  const { status: _status, ...kept } = record;
  return kept;
}

function Steps(props: FirstRunSetupProps & { record: Open }) {
  const { record, organization, selectedHost } = props;
  const go = (step: number) => saveSetup({ ...rest(record), step });
  const next = () => go(record.step + 1);
  const back = () => go(Math.max(0, record.step - 1));
  const skip = () => finishSetup("skipped");
  // A machine bought or connected in the first step is followed: it is selected as soon as
  // Concors can reach it, and until then the steps that need it say what it is doing.
  const banner =
    record.machineId && organization ? (
      <MachineBanner
        organizationId={organization.id}
        machineId={record.machineId}
        selectedHost={selectedHost}
        onSelectMachine={props.onSelectMachine}
      />
    ) : undefined;
  switch (Math.min(record.step, 4)) {
    case 0:
      return (
        <WhereStep
          record={record}
          organization={organization}
          onSignIn={props.onSignIn}
          onChoose={(where, size) =>
            saveSetup({ ...rest(record), where, ...(size ? { size } : {}) })
          }
          onLocal={() => {
            if (selectedHost.machineId !== LOCAL_HOST.machineId) props.onSelectMachine(LOCAL_HOST);
            saveSetup({ step: 1, where: "local" });
          }}
          onMachine={(where, machine: Machine) =>
            saveSetup({ step: 1, where, machineId: machine.id })
          }
          onNext={next}
          onSkip={skip}
        />
      );
    case 1:
      return <AgentsStep banner={banner} onBack={back} onNext={next} onSkip={skip} />;
    case 2:
      return (
        <ProjectStep
          banner={banner}
          onOpenFolder={props.onOpenFolder}
          onClone={props.onClone}
          onNewWorkspace={props.onNewWorkspace}
          newWorkspaceBusy={props.newWorkspaceBusy}
          onBack={back}
          onNext={next}
          onSkip={skip}
        />
      );
    case 3:
      return <PhoneStep banner={banner} onBack={back} onNext={next} onSkip={skip} />;
    default:
      return (
        <FirstAgentStep
          banner={banner}
          onSelectProject={props.onSelectProject}
          onNewChat={props.onNewChat}
          onStarted={(projectId, tabId) => {
            finishSetup("finished");
            props.onShowChat(projectId, tabId);
          }}
          onFinish={() => finishSetup("finished")}
          onBack={back}
        />
      );
  }
}

/** How the machine from the first step is getting on, until Concors is connected to it. */
function MachineBanner({
  organizationId,
  machineId,
  selectedHost,
  onSelectMachine,
}: {
  organizationId: string;
  machineId: string;
  selectedHost: Host;
  onSelectMachine: (host: Host) => void;
}) {
  const machines = useMachines(organizationId, { catalog: false });
  const machine = machines.machines?.find((candidate) => candidate.id === machineId);
  const connectable = !!machine && machineAvailability(machine) === "connectable";
  const selected = selectedHost.machineId === machineId;
  useEffect(() => {
    if (machine && connectable && !selected) onSelectMachine(machineHost(machine));
  }, [machine, connectable, selected, onSelectMachine]);
  if (selected && connectable) return null;
  return (
    <div
      role="status"
      className="mb-5 flex items-center gap-3 rounded-lg border bg-muted/40 px-3.5 py-2.5 text-sm"
    >
      <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-semibold">
          {machine ? `Setting up ${machine.name}` : "Setting up"}
        </span>
        {machine && <span className="text-muted-foreground"> · {describeStatus(machine)}</span>}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">usually a few minutes</span>
    </div>
  );
}
