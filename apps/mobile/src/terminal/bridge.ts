import { z } from "zod";
export const RendererEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready") }),
  z.object({ type: z.literal("input"), data: z.string().min(1).max(16384) }),
  z.object({
    type: z.literal("resize"),
    cols: z.number().int().min(10).max(240),
    rows: z.number().int().min(2).max(100),
  }),
]);
export type RendererEvent = z.infer<typeof RendererEventSchema>;
export type RendererCommand =
  | { type: "reset"; data: string; cols: number; rows: number }
  | { type: "write"; data: string }
  | { type: "enabled"; value: boolean }
  | { type: "resize"; cols: number; rows: number }
  | { type: "focus" };
export interface RendererHandle {
  send(command: RendererCommand): void;
}
export interface RendererProps {
  onEvent(event: RendererEvent): void;
  onError(): void;
}
export function parseRendererEvent(value: unknown): RendererEvent | null {
  try {
    const parsed = RendererEventSchema.safeParse(
      typeof value === "string" ? JSON.parse(value) : value,
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
/** Data is serialized as a JS literal, never interpolated as executable terminal output. */
export function rendererScript(command: RendererCommand): string {
  return `window.ConcorsTerminal.receive(${JSON.stringify(command)});true;`;
}
