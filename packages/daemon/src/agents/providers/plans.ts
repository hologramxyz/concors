/** Shared task snapshots, following the task primitives in Paseo's native adapters. */
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) => (typeof value === "string" ? value : "");
export interface PlanStep {
  step: string;
  status: string;
  id?: string;
  activeForm?: string;
}
export function planSteps(value: unknown): PlanStep[] {
  return (Array.isArray(value) ? value : [])
    .flatMap((raw) => {
      const entry = record(raw),
        step = text(entry["step"] ?? entry["content"] ?? entry["subject"] ?? entry["text"]);
      if (!step || entry["status"] === "deleted") return [];
      const state = entry["status"];
      return [
        {
          step,
          status:
            state === "completed"
              ? "completed"
              : ["in_progress", "inProgress"].includes(text(state))
                ? "inProgress"
                : "pending",
          ...(entry["id"] ? { id: text(entry["id"]) } : {}),
          ...(entry["activeForm"] ? { activeForm: text(entry["activeForm"]) } : {}),
        },
      ];
    })
    .slice(0, 100);
}
const normalize = (name: string) => name.toLowerCase().replaceAll("_", "").replaceAll("-", "");
export const isTaskTool = (name: string) =>
  ["todowrite", "updatetodo", "taskcreate", "taskupdate", "tasklist"].includes(normalize(name));
export class TaskState {
  private tasks = new Map<string, PlanStep>();
  restore(turns: { items: unknown[] }[]) {
    const latest = turns
      .flatMap((turn) => turn.items)
      .map(record)
      .findLast((item) => item["type"] === "plan" && Array.isArray(item["steps"]));
    this.tasks.clear();
    planSteps(latest?.["steps"]).forEach((step, index) =>
      this.tasks.set(step.id ?? `todo:${index}`, step),
    );
  }
  update(
    name: string,
    rawInput: unknown,
    rawOutput: unknown,
    done: boolean,
    failed = false,
  ): PlanStep[] | null {
    if (!isTaskTool(name) || !done || failed) return null;
    const input = record(rawInput),
      result = record(rawOutput);
    const data = record(result["details"] ?? result["metadata"] ?? rawOutput);
    if (data["success"] === false) return null;
    const kind = normalize(name);
    if (kind === "todowrite" || kind === "updatetodo") {
      const list = input["todos"] ?? input["tasks"] ?? data["todos"];
      if (!Array.isArray(list)) return null;
      this.tasks.clear();
      planSteps(list).forEach((step, index) => this.tasks.set(step.id ?? `todo:${index}`, step));
    } else if (kind === "tasklist") {
      const list = data["tasks"];
      if (!Array.isArray(list)) return null;
      this.tasks.clear();
      planSteps(list).forEach((step, index) => this.tasks.set(step.id ?? `task:${index}`, step));
    } else if (kind === "taskcreate") {
      const task = record(data["task"]);
      const id = text(task["id"] ?? data["taskId"]);
      const step = planSteps([{ ...input, ...task, id }])[0];
      if (!id || !step) return null;
      if (this.tasks.size >= 100 && !this.tasks.has(id)) return null;
      this.tasks.set(id, step);
    } else {
      const id = text(input["taskId"] ?? data["taskId"]),
        previous = this.tasks.get(id);
      if (!previous) return null;
      const status = input["status"] ?? record(data["statusChange"])["to"] ?? previous.status;
      if (status === "deleted") this.tasks.delete(id);
      else {
        const next = planSteps([
          { ...previous, ...input, step: input["subject"] ?? previous.step, status },
        ])[0];
        if (next) this.tasks.set(id, next);
      }
    }
    return [...this.tasks.values()].slice(0, 100);
  }
}
