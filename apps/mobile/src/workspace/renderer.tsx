import { forwardRef, useImperativeHandle, useRef } from "react";
import { WebView } from "react-native-webview";
import { workspaceHtml } from "../../assets/workspace-html";
import {
  workspaceScript,
  type WorkspaceRendererHandle,
  type WorkspaceRendererProps,
} from "./renderer-types";

export const WorkspaceRenderer = forwardRef<WorkspaceRendererHandle, WorkspaceRendererProps>(
  function WorkspaceRenderer({ onMessage, onError }, ref) {
    const view = useRef<WebView>(null);
    useImperativeHandle(
      ref,
      () => ({ send: (message) => view.current?.injectJavaScript(workspaceScript(message)) }),
      [],
    );
    return (
      <WebView
        ref={view}
        source={{ html: workspaceHtml }}
        style={{ flex: 1, backgroundColor: "#f4f3ef" }}
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
        keyboardDisplayRequiresUserAction
        hideKeyboardAccessoryView={false}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        bounces={false}
        scrollEnabled={false}
        onMessage={(event) => onMessage(event.nativeEvent.data)}
        onError={onError}
        onContentProcessDidTerminate={onError}
        onRenderProcessGone={onError}
        accessibilityLabel="Concors workspace"
      />
    );
  },
);
