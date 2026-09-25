import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, LoaderCircle, Mic, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { observeMicrophone } from "./dictation-audio";
import type { DictationState } from "./dictation-session";
import "./dictation.css";

/**
 * Stands in for the prompt box while you speak. Done (or Enter) puts the words into the prompt
 * box to read over and send; nothing is sent from here and no recording is kept.
 */
export function DictationRecording({
  state,
  onStop,
  onCancel,
}: {
  state: DictationState;
  onStop: () => void;
  onCancel: () => void;
}) {
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
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          !(event.target instanceof HTMLButtonElement)
        ) {
          event.preventDefault();
          event.stopPropagation();
          onStop();
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
          size="icon"
          aria-label="Finish dictation"
          title="Put the words in the message (Enter)"
          disabled={stopping}
          onClick={onStop}
        >
          {stopping ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="size-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
