import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { terminalHtml } from "../../assets/terminal-html";
import { parseRendererEvent, type RendererHandle, type RendererProps } from "./bridge";

export const TerminalRenderer = forwardRef<RendererHandle, RendererProps>(function TerminalRenderer(
  { onEvent, onError },
  ref,
) {
  const frame = useRef<HTMLIFrameElement>(null);
  useImperativeHandle(
    ref,
    () => ({
      send(command) {
        frame.current?.contentWindow?.postMessage({ concorsTerminal: command }, "*");
      },
    }),
    [],
  );
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const parsed = parseRendererEvent(event.data);
      if (parsed) onEvent(parsed);
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [onEvent]);
  return (
    <iframe
      ref={frame}
      title="Interactive terminal"
      srcDoc={terminalHtml}
      sandbox="allow-scripts"
      onError={onError}
      style={{
        position: "absolute",
        inset: 0,
        border: 0,
        width: "100%",
        height: "100%",
        background: "#151714",
      }}
    />
  );
});
