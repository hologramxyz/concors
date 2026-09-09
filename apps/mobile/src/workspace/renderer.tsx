import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { View } from "react-native";
import {
  parseMobileRendererMessage,
  type MobileHostMessage,
  type MobileState,
} from "@concors/client-core";
import { WebView } from "react-native-webview";
import { NativeChrome } from "./native-chrome";
import type { NativeSurfaceSnapshot } from "./native-chrome-types";
import { workspaceHtml } from "../../assets/workspace-html";
import {
  workspaceScript,
  type WorkspaceRendererHandle,
  type WorkspaceRendererProps,
} from "./renderer-types";

export const WorkspaceRenderer = forwardRef<WorkspaceRendererHandle, WorkspaceRendererProps>(
  function WorkspaceRenderer({ onMessage, onError, backgroundColor }, ref) {
    const view = useRef<WebView>(null);
    const [host, setHost] = useState<MobileState | null>(null);
    const [snapshot, setSnapshot] = useState<NativeSurfaceSnapshot | null>(null);
    const send = (message: MobileHostMessage) =>
      view.current?.injectJavaScript(workspaceScript(message));
    useImperativeHandle(
      ref,
      () => ({
        send: (message) => {
          if (message.type === "state") setHost(message.state);
          send(message);
        },
      }),
      [],
    );
    return (
      <View style={{ flex: 1, backgroundColor }}>
        <WebView
          ref={view}
          source={{ html: workspaceHtml }}
          style={{ flex: 1, backgroundColor }}
          // Route every navigation through the deny-by-default callback. An origin excluded
          // here would otherwise be handed to the OS by react-native-webview itself.
          originWhitelist={["*"]}
          onShouldStartLoadWithRequest={(request) => request.url === "about:blank"}
          javaScriptEnabled
          domStorageEnabled={false}
          allowFileAccess={false}
          mixedContentMode="never"
          setSupportMultipleWindows={false}
          sharedCookiesEnabled={false}
          thirdPartyCookiesEnabled={false}
          cacheEnabled={false}
          keyboardDisplayRequiresUserAction
          hideKeyboardAccessoryView={false}
          automaticallyAdjustContentInsets={false}
          contentInsetAdjustmentBehavior="never"
          bounces={false}
          scrollEnabled={false}
          onMessage={(event) => {
            const message = parseMobileRendererMessage(event.nativeEvent.data);
            if (message?.type === "native-surfaces") setSnapshot(message);
            else onMessage(event.nativeEvent.data);
          }}
          onError={onError}
          onContentProcessDidTerminate={onError}
          onRenderProcessGone={onError}
          accessibilityLabel="Concors workspace"
        />
        <NativeChrome host={host} snapshot={snapshot} send={send} />
      </View>
    );
  },
);
