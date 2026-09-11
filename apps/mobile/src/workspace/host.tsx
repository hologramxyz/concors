import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  useColorScheme,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, NO_MOBILE_CAPABILITIES } from "@concors/api-client";
import {
  createProtocolRelay,
  machineAvailability,
  newRequestId,
  parseMobileRendererMessage,
  MobilePreferencesSchema,
  MobileTargetSchema,
  type MobileAction,
  type MobileHostMessage,
  type MobilePreferences,
  type MobileState,
} from "@concors/client-core";
import { createProtocolError } from "@concors/protocol";
import { useAuth } from "../auth/provider";
import { api } from "../auth/runtime";
import { useMachine } from "../connection/provider";
import { useCapabilities, useMachines } from "../queries";
import { config } from "../config";
import { deviceStorage } from "../platform/storage";
import { disablePush, enablePush, pushEnabled } from "../platform/notifications";
import { Button, Copy } from "../ui";
import { WorkspaceRenderer } from "./renderer";
import type { WorkspaceRendererHandle } from "./renderer-types";
import { dispatchMobileApi } from "./api";
import { assertWorkspaceActionAllowed } from "./access";
import { useAIConsent } from "../privacy/provider";

const defaults: MobilePreferences = { theme: "system", corners: "subtle", sound: false };
export function WorkspaceHost() {
  const auth = useAuth();
  // A fresh renderer/session nonce on account or organization change rejects stale bridge actions.
  if (!auth.me && !auth.direct) return null;
  return (
    <SignedInWorkspace
      key={auth.direct ? "direct" : `${auth.me?.user.id}:${auth.me?.session.activeOrganizationId}`}
    />
  );
}
function SignedInWorkspace() {
  const auth = useAuth();
  const consent = useAIConsent();
  const query = useQueryClient();
  const machines = useMachines();
  const capabilities = useCapabilities();
  const { machineId, selectMachine, connection, retry } = useMachine();
  const params = useLocalSearchParams();
  const systemDark = useColorScheme() === "dark";
  const [scope] = useState(newRequestId);
  const [preferences, setPreferences] = useState(defaults);
  const [push, setPush] = useState(false);
  const [failed, setFailed] = useState(false);
  const [rendererKey, setRendererKey] = useState(0);
  const renderer = useRef<WorkspaceRendererHandle>(null);
  const ready = useRef(false);
  const alive = useRef(true);
  const pending = useRef(new Set<string>());
  const fileGuard = useRef(false);
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const guard = (event: BeforeUnloadEvent) => {
      if (fileGuard.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, []);
  const organizations = useQuery({
    queryKey: ["organizations", auth.me?.user.id],
    queryFn: () => api.listOrganizations(),
    enabled: !!auth.me && !auth.direct,
  });
  const transport = connection.phase === "ready" && !failed ? connection.transport : null;
  const connectionId = useMemo(
    () => (transport ? `${rendererKey}:${newRequestId()}` : null),
    [transport, rendererKey],
  );
  const relay = useRef<ReturnType<typeof createProtocolRelay> | null>(null);
  useEffect(() => {
    const current =
      transport && connectionId
        ? createProtocolRelay(transport, (message) =>
            renderer.current?.send({ type: "protocol", connectionId, message }),
          )
        : null;
    relay.current = current;
    return () => {
      current?.dispose();
      relay.current = null;
    };
  }, [transport, connectionId]);
  const userId = auth.me?.user.id;
  useEffect(() => {
    alive.current = true;
    void deviceStorage.get("appearance.v1").then((raw) => {
      if (!alive.current || !raw) return;
      try {
        const result = MobilePreferencesSchema.safeParse(JSON.parse(raw));
        if (result.success) setPreferences(result.data);
      } catch {
        /* Keep defaults for corrupt preferences. */
      }
    });
    if (userId)
      void pushEnabled(userId)
        .then((value) => {
          if (alive.current) setPush(value);
        })
        .catch(() => undefined);
    return () => {
      alive.current = false;
    };
  }, [userId]);
  const target = MobileTargetSchema.safeParse(params);
  const state: MobileState | null =
    auth.me || auth.direct
      ? {
          scope,
          me: auth.me,
          profile:
            auth.direct && auth.profile
              ? { name: auth.profile.name, email: auth.profile.email }
              : null,
          direct: auth.direct,
          organizations: organizations.data ?? [],
          machines: machines.data ?? [],
          machineId,
          connectionId,
          phase: connection.phase,
          message: machines.isError
            ? "Could not load machines. Retry when connected."
            : organizations.isError
              ? "Could not load organizations. Retry when connected."
              : connection.message,
          capabilities: {
            ...(capabilities.data ?? NO_MOBILE_CAPABILITIES),
            remoteAccess: !!auth.me || auth.direct,
          },
          demo: config.demo,
          native: Platform.OS !== "web",
          nativeChrome: Platform.OS === "ios",
          systemDark,
          preferences,
          pushEnabled: push,
          target: target.success ? target.data : {},
          supportUrl: config.supportUrl,
          privacyUrl: config.privacyUrl,
          apiUrl: config.apiUrl,
          endpointLabel: auth.direct
            ? `Direct desktop daemon${config.developmentDaemon ? ` · ${new URL(config.developmentDaemon).host}` : ""}`
            : config.demo
              ? "In-memory demo"
              : transport
                ? "Authenticated native gateway"
                : "Not connected",
        }
      : null;
  const latest = useRef({
    state,
    action: async (_action: MobileAction): Promise<unknown> => undefined,
  });
  const action = async (action: MobileAction): Promise<unknown> => {
    assertWorkspaceActionAllowed(auth.direct, !!auth.me, action);
    switch (action.kind) {
      case "open-profile":
        if (auth.direct) auth.openProfile();
        return;
      case "withdraw-ai-consent":
        await consent.withdraw();
        return;
      case "dismiss-keyboard":
        Keyboard.dismiss();
        return;
      case "file-guard":
        fileGuard.current = action.active;
        return;
      case "api":
        return dispatchMobileApi(api, action.call);
      case "select-machine":
        if (auth.direct) {
          if (action.machineId !== machineId)
            throw new Error("This is not the connected desktop daemon.");
          return;
        }
        {
          const machine = machines.data?.find((item) => item.id === action.machineId);
          if (!machine) throw new Error("Machine is unavailable in this organization");
          const availability = machineAvailability(machine);
          if (!config.demo && availability !== "connectable")
            throw new Error(`This machine is ${availability}.`);
        }
        selectMachine(action.machineId);
        return;
      case "retry":
        retry();
        return;
      case "refresh":
        await query.invalidateQueries();
        return;
      case "sign-out":
        await auth.signOut();
        return;
      case "switch-organization":
        if (!organizations.data?.some((org) => org.id === action.organizationId))
          throw new Error("Organization is unavailable");
        selectMachine(null);
        await api.setActiveOrganization(action.organizationId);
        await auth.refresh();
        return;
      case "push":
        if (!auth.me) throw new Error("Sign in again");
        if (!capabilities.data?.pushNotifications)
          throw new Error("Push is not available on this server");
        if (action.enabled) await enablePush(api, auth.me.user.id);
        else await disablePush(api);
        if (alive.current) setPush(action.enabled);
        return;
      case "delete-account":
        if (!capabilities.data?.accountDeletion)
          throw new Error("Account deletion is not available on this server");
        await api.deleteAccount(action.password);
        await auth.signOut();
        return;
      case "clipboard":
        await Clipboard.setStringAsync(action.text);
        return;
      case "preferences":
        await deviceStorage.set("appearance.v1", JSON.stringify(action.preferences));
        if (alive.current) setPreferences(action.preferences);
        return;
      case "open-url": {
        const url = new URL(action.url);
        if (!["https:", "mailto:"].includes(url.protocol) || url.username || url.password)
          throw new Error("Only secure web and email links can be opened");
        const approved =
          Platform.OS === "web"
            ? window.confirm(`Open external link?\n${url.href}`)
            : await new Promise<boolean>((resolve) =>
                Alert.alert(
                  "Open external link?",
                  url.href,
                  [
                    { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
                    { text: "Open", onPress: () => resolve(true) },
                  ],
                  { cancelable: true, onDismiss: () => resolve(false) },
                ),
              );
        if (approved) await Linking.openURL(url.href);
        return;
      }
    }
  };
  useEffect(() => {
    latest.current = { state, action };
    if (ready.current && state) renderer.current?.send({ type: "state", state });
  });
  const onMessage = useCallback((raw: unknown) => {
    const message = parseMobileRendererMessage(raw);
    const current = latest.current;
    if (!message || !alive.current || !current.state) return;
    if (message.type === "ready") {
      ready.current = true;
      renderer.current?.send({ type: "state", state: current.state });
      return;
    }
    // Native surface messages are handled by the renderer's UI layer, not the action/API relay.
    if (message.type === "native-surfaces") return;
    if (message.type === "protocol") {
      if (message.connectionId !== current.state.connectionId || !relay.current) return;
      void relay.current.receive(message.message).catch((cause: unknown) => {
        if (alive.current && latest.current.state?.connectionId === message.connectionId)
          renderer.current?.send({
            type: "protocol",
            connectionId: message.connectionId,
            message: {
              type: "error",
              error: createProtocolError(
                "INTERNAL_ERROR",
                cause instanceof Error ? cause.message : "Connection failed",
              ),
            },
          });
      });
      return;
    }
    if (
      message.scope !== current.state.scope ||
      pending.current.has(message.requestId) ||
      pending.current.size >= 16
    )
      return;
    pending.current.add(message.requestId);
    const reply = (
      value: Pick<Extract<MobileHostMessage, { type: "result" }>, "result" | "error">,
    ) => {
      if (alive.current && latest.current.state?.scope === message.scope)
        renderer.current?.send({
          type: "result",
          scope: message.scope,
          requestId: message.requestId,
          ...value,
        });
    };
    void current
      .action(message.action)
      .then(
        (result) => reply({ result }),
        (cause: unknown) =>
          reply({
            error: {
              message: cause instanceof Error ? cause.message : "Request failed",
              ...(cause instanceof ApiError ? { status: cause.status, code: cause.code } : {}),
            },
          }),
      )
      .finally(() => pending.current.delete(message.requestId));
  }, []);
  const dark = preferences.theme === "dark" || (preferences.theme === "system" && systemDark);
  const backgroundColor = dark ? "#141414" : "#f4f3ef";
  return (
    <SafeAreaView testID="workspace-safe-area" style={{ flex: 1, backgroundColor }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <View style={{ flex: 1, minHeight: 0 }}>
          {failed ? (
            <View style={{ padding: 24, gap: 16 }}>
              <Copy>The workspace renderer stopped. Your machine sessions are still running.</Copy>
              <Button
                onPress={() => {
                  ready.current = false;
                  setRendererKey((value) => value + 1);
                  setFailed(false);
                }}
              >
                Reload workspace
              </Button>
            </View>
          ) : (
            <WorkspaceRenderer
              key={rendererKey}
              ref={renderer}
              backgroundColor={backgroundColor}
              onMessage={onMessage}
              onError={() => setFailed(true)}
            />
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
