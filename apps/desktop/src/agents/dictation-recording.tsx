import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, LoaderCircle, Mic, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { observeMicrophone } from "./dictation-audio";
import type { DictationAction, DictationState } from "./dictation-session";
import "./dictation.css";

/**
 * Stands in for the prompt box while you speak. Edit (or Enter) puts the words into the prompt
 * box to read over; Send (or Ctrl+Enter) sends them as a message. No recording is kept.
 */
export function DictationRecording({
  state,
  onStop,
  onCancel,
  canSend,
  queued,
}: {
  state: DictationState;
  onStop: (action: DictationAction) => void;
  onCancel: () => void;
  canSend: boolean;
  /** A turn is running, so a sent message waits in the queue. */
  queued: boolean;
}) {
  // The button that ended the recording shows the wait for the last words.
  const [chosen, setChosen] = useState<DictationAction | null>(null);
  const stop = (action: DictationAction) => {
    setChosen(action);
    onStop(action);
  };
  const root = useRef<HTMLDivElement>(null);
  const recording = state.phase === "recording";
  const stopping = state.phase === "stopping";
  const [levels, setLevels] = useState<number[]>(Array(48).fill(0));
  const [meterAvailable, setMeterAvailable] = useState(true);
  const [seconds, setSeconds] = useState(0);
  useLayoutEffect(() => {
    root.current?.focus();
  }, []);
  useEffect(() => {
    if (!recording) return;
    const start = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 250);
    const stop = observeMicrophone(
      (value) => setLevels((values) => [...values.slice(1), value]),
      () => setMeterAvailable(false),
    );
    return () => {
      clearInterval(timer);
      stop();
    };
  }, [recording]);
  const volume = Math.round((levels.at(-1) ?? 0) * 100);
  return (
    <div
      ref={root}
      role="group"
      aria-label="Dictation"
      tabIndex={-1}
      data-dictation-phase={state.phase}
      className="dictation-recording"
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.repeat) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        } else if (
          event.key === "Enter" &&
          !event.shiftKey &&
          !event.altKey &&
          !(event.target instanceof HTMLButtonElement)
        ) {
          event.preventDefault();
          event.stopPropagation();
          // Plain Enter only fills the prompt box, so a stray key never sends a message.
          if (event.ctrlKey || event.metaKey) {
            if (canSend) stop("send");
          } else stop("insert");
        }
      }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Cancel dictation"
          title="Cancel dictation (Escape)"
          onClick={onCancel}
        >
          <X className="size-4" />
        </Button>
        <div className="flex shrink-0 items-center gap-2 text-primary">
          <Mic className="size-4" aria-hidden="true" />
          <div
            role="meter"
            aria-label="Microphone volume"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={recording && meterAvailable ? volume : 0}
            aria-valuetext={
              !meterAvailable ? "Level unavailable" : !recording ? "Microphone off" : `${volume}%`
            }
            title={
              !meterAvailable
                ? "Microphone level is unavailable in this browser"
                : "Microphone volume"
            }
            className="dictation-volume"
          >
            {[0, 1, 2, 3].map((index) => (
              <span key={index} data-lit={recording && meterAvailable && volume > index * 25} />
            ))}
          </div>
        </div>
        <svg
          data-dictation-waveform
          aria-hidden="true"
          viewBox="0 0 384 48"
          preserveAspectRatio="none"
          className="dictation-waveform"
        >
          {levels.map((value, index) => {
            const height = 3 + value * 41;
            return (
              <rect
                key={index}
                x={index * 8 + 2}
                y={(48 - height) / 2}
                width={3}
                height={height}
                rx={1.5}
              />
            );
          })}
        </svg>
        <time
          className="shrink-0 text-xs text-muted-foreground tabular-nums"
          aria-label="Dictation duration"
        >
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
        </time>
        <span role="status" className="sr-only">
          {stopping ? "Finishing dictation…" : "Listening"}
        </span>
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className="rounded-full"
          aria-label="Edit dictated message"
          title="Put the words in the message to edit (Enter)"
          disabled={stopping}
          onClick={() => stop("insert")}
        >
          {stopping && chosen === "insert" ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Pencil className="size-4" />
          )}
        </Button>
        <Button
          type="button"
          size="icon"
          className="rounded-full"
          aria-label={queued ? "Queue dictated message" : "Send dictated message"}
          title={queued ? "Queue the message (Ctrl+Enter)" : "Send the message (Ctrl+Enter)"}
          disabled={stopping || !canSend}
          onClick={() => stop("send")}
        >
          {stopping && chosen === "send" ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <ArrowUp className="size-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
