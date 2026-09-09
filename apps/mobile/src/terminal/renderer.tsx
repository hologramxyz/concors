import { forwardRef, useImperativeHandle, useRef } from "react";
import { WebView } from "react-native-webview";
import { terminalHtml } from "../../assets/terminal-html";
import {
  parseRendererEvent,
  rendererScript,
  type RendererHandle,
  type RendererProps,
} from "./bridge";

/** Bundled, offline terminal renderer. It has no account credentials or network permissions. */
export const TerminalRenderer = forwardRef<RendererHandle, RendererProps>(function TerminalRenderer(
  { onEvent, onError },
  ref,
) {
  const webview = useRef<WebView>(null);
  useImperativeHandle(
    ref,
    () => ({
      send(command) {
        webview.current?.injectJavaScript(rendererScript(command));
      },
    }),
    [],
  );
  return (
    <WebView
      ref={webview}
      source={{ html: terminalHtml }}
      style={{ flex: 1, backgroundColor: "#151714" }}
      originWhitelist={["about:*"]}
      onShouldStartLoadWithRequest={(request) => request.url === "about:blank"}
      javaScriptEnabled
      domStorageEnabled={false}
      allowFileAccess={false}
      mixedContentMode="never"
      setSupportMultipleWindows={false}
      sharedCookiesEnabled={false}
      thirdPartyCookiesEnabled={false}
      cacheEnabled={false}
      keyboardDisplayRequiresUserAction={false}
      onMessage={(event) => {
        const parsed = parseRendererEvent(event.nativeEvent.data);
        if (parsed) onEvent(parsed);
      }}
      onError={onError}
      onContentProcessDidTerminate={onError}
      onRenderProcessGone={onError}
      accessibilityLabel="Interactive terminal"
    />
  );
});
