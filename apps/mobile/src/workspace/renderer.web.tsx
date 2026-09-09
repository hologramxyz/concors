import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { workspaceHtml } from "../../assets/workspace-html";
import type { WorkspaceRendererHandle, WorkspaceRendererProps } from "./renderer-types";

export const WorkspaceRenderer = forwardRef<WorkspaceRendererHandle, WorkspaceRendererProps>(
  function WorkspaceRenderer({ onMessage, onError }, ref) {
    const frame = useRef<HTMLIFrameElement>(null);
    useEffect(() => {
      const viewport = window.visualViewport;
      const resize = () => {
        const element = frame.current;
        const parent = element?.parentElement;
        if (!element || !parent || !viewport) return;
        const available = viewport.offsetTop + viewport.height - parent.getBoundingClientRect().top;
        element.style.height = `${Math.max(1, Math.min(parent.clientHeight, available))}px`;
      };
      resize();
      viewport?.addEventListener("resize", resize);
      viewport?.addEventListener("scroll", resize);
      window.addEventListener("resize", resize);
      return () => {
        viewport?.removeEventListener("resize", resize);
        viewport?.removeEventListener("scroll", resize);
        window.removeEventListener("resize", resize);
      };
    }, []);
    useImperativeHandle(
      ref,
      () => ({
        send(message) {
          frame.current?.contentWindow?.postMessage({ concorsMobile: message }, "*");
        },
      }),
      [],
    );
    useEffect(() => {
      const receive = (event: MessageEvent) => {
        if (
          event.source === frame.current?.contentWindow &&
          event.data &&
          typeof event.data === "object" &&
          "concorsMobile" in event.data
        )
          onMessage(event.data.concorsMobile);
      };
      window.addEventListener("message", receive);
      return () => window.removeEventListener("message", receive);
    }, [onMessage]);
    return (
      <iframe
        ref={frame}
        title="Concors workspace"
        srcDoc={workspaceHtml}
        sandbox="allow-scripts allow-forms"
        onError={onError}
        style={{
          position: "absolute",
          inset: 0,
          border: 0,
          width: "100%",
          height: "100%",
          background: "#f4f3ef",
          touchAction: "pan-y",
        }}
      />
    );
  },
);
