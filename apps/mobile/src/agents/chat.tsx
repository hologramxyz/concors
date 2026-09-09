import { useEffect, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, View } from "react-native";
import type { AgentInfo, AgentItem, AgentOperation, AgentPending } from "@concors/protocol";
import { useMachine } from "../connection/provider";
import { useConversation } from "./use-conversation";
import { Button, Card, Copy, Field, Loading, Notice, layout, useTheme } from "../ui";

export function Chat({ sessionId }: { sessionId: string }) {
  const { connection } = useMachine();
  const conversation = useConversation(connection.transport, sessionId);
  const agent = connection.agents.find((item) => item.id === sessionId);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<FlatList<AgentItem>>(null);
  const atBottom = useRef(true);
  const ready = connection.phase === "ready" && !conversation.loading;
  const act = async (operation: AgentOperation) => {
    setBusy(true);
    setError(null);
    try {
      await conversation.request(operation);
      if (operation.kind === "send") setDraft("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send your request.");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!agent?.attention || agent.attention.seen || !ready) return;
    void conversation
      .request({ kind: "seen", sessionId, attentionId: agent.attention.id })
      .catch(() => undefined);
    // Acknowledge only the attention currently displayed, once per authoritative event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent?.attention?.id, ready, sessionId]);
  return (
    <KeyboardAvoidingView
      style={layout.fill}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={100}
    >
      <View style={{ flex: 1, gap: 12 }}>
        <View style={layout.row}>
          <Copy weight="600">{agent?.name ?? "Agent conversation"}</Copy>
          <Copy size={13} muted>
            {agent?.status.replaceAll("_", " ")}
          </Copy>
        </View>
        {agent?.error && <Notice>{agent.error}</Notice>}
        {conversation.error && <Notice>{conversation.error}</Notice>}
        {conversation.loading && <Loading label="Loading conversation…" />}
        <FlatList
          ref={list}
          data={conversation.items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <TimelineItem item={item} />}
          contentContainerStyle={{ gap: 14, paddingBottom: 20 }}
          keyboardShouldPersistTaps="handled"
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          onScroll={({ nativeEvent }) => {
            atBottom.current =
              nativeEvent.contentSize.height -
                nativeEvent.contentOffset.y -
                nativeEvent.layoutMeasurement.height <
              80;
          }}
          scrollEventThrottle={100}
          onContentSizeChange={() => {
            if (atBottom.current) list.current?.scrollToEnd({ animated: false });
          }}
          ListHeaderComponent={
            conversation.hasMore ? (
              <Button
                secondary
                disabled={busy || !ready}
                onPress={() => {
                  void act({ kind: "read", sessionId, before: conversation.items[0]?.position });
                }}
              >
                Load earlier messages
              </Button>
            ) : null
          }
          ListEmptyComponent={
            !conversation.loading ? <Copy muted>Start a conversation with your agent.</Copy> : null
          }
          ListFooterComponent={
            <View style={layout.stack}>
              {agent?.pending.map((pending) => (
                <PendingRequest
                  key={pending.id}
                  pending={pending}
                  disabled={!ready || busy}
                  onRespond={(answer) => {
                    void act({ kind: "respond", sessionId, pendingId: pending.id, ...answer });
                  }}
                />
              ))}
            </View>
          }
        />
        {agent && (
          <ModelSettings
            agent={agent}
            disabled={!ready || busy || agent.status === "working"}
            onConfigure={(settings) => {
              void act({
                kind: "configure",
                sessionId,
                expectedRevision: agent.revision,
                settings,
              });
            }}
          />
        )}
        {error && <Notice>{error}</Notice>}
        <Field
          label="Message"
          value={draft}
          onChangeText={setDraft}
          placeholder="What should we work on?"
          multiline
          maxLength={16000}
          editable={!busy}
          style={{ maxHeight: 120 }}
        />
        <View style={layout.row}>
          <View style={layout.fill}>
            <Button
              disabled={!ready || busy || !draft.trim() || !!agent?.pending.length}
              onPress={() => {
                void act({ kind: "send", sessionId, text: draft });
              }}
            >
              {busy ? "Sending…" : agent?.status === "working" ? "Queue message" : "Send message"}
            </Button>
          </View>
          {agent?.status === "working" && agent.turnId && (
            <Button
              secondary
              disabled={!ready || busy}
              onPress={() => {
                if (agent.turnId) void act({ kind: "interrupt", sessionId, turnId: agent.turnId });
              }}
            >
              Stop
            </Button>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
function TimelineItem({ item }: { item: AgentItem }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const detail = [
    item.detail,
    item.presentation?.command,
    item.presentation?.output,
    ...(item.presentation?.files?.map((file) => `${file.path}\n${file.diff}`) ?? []),
  ]
    .filter(Boolean)
    .join("\n\n");
  return (
    <View
      style={{
        padding: 14,
        borderRadius: 12,
        backgroundColor: item.kind === "user" ? theme.tint : theme.surface,
        gap: 7,
      }}
    >
      <Copy size={12} muted>
        {item.kind === "user" ? "You" : item.title || "Agent"}
        {item.status === "running" ? " · working" : ""}
      </Copy>
      {!!item.text && <Copy selectable>{item.text}</Copy>}
      {item.presentation?.steps?.map((step, i) => (
        <Copy key={i} size={14}>
          {step.status === "completed" ? "✓" : "·"} {step.step}
        </Copy>
      ))}
      {!!detail && (
        <Pressable
          accessibilityRole="button"
          onPress={() => setExpanded(!expanded)}
          accessibilityState={{ expanded }}
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <Copy size={13} style={{ color: theme.accent }}>
            {expanded ? "Hide details" : "View details"}
          </Copy>
        </Pressable>
      )}
      {expanded && (
        <Copy
          selectable
          size={12}
          style={{ fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }}
        >
          {detail}
        </Copy>
      )}
    </View>
  );
}
function PendingRequest({
  pending,
  disabled,
  onRespond,
}: {
  pending: AgentPending;
  disabled: boolean;
  onRespond(answer: {
    decision?: "accept" | "decline" | "cancel";
    answers?: Record<string, string[]>;
  }): void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const answered = pending.questions.every((question) => answers[question.id]?.trim());
  return (
    <Card>
      <Copy weight="600">{pending.title}</Copy>
      <Copy size={14}>{pending.summary || pending.detail}</Copy>
      {pending.kind === "questions" ? (
        <>
          {pending.questions.map((question) => (
            <View key={question.id} style={layout.stack}>
              <Copy size={14}>{question.question}</Copy>
              {question.options?.map((option) => (
                <Button
                  key={option.label}
                  secondary={answers[question.id] !== option.label}
                  disabled={disabled}
                  onPress={() => setAnswers({ ...answers, [question.id]: option.label })}
                >
                  {option.label}
                </Button>
              ))}
              <Field
                label={question.header || "Your answer"}
                secureTextEntry={question.isSecret}
                value={answers[question.id] ?? ""}
                maxLength={4000}
                editable={!disabled}
                onChangeText={(answer) => setAnswers({ ...answers, [question.id]: answer })}
              />
            </View>
          ))}
          <Button
            disabled={disabled || !answered}
            onPress={() =>
              onRespond({
                answers: Object.fromEntries(
                  Object.entries(answers).map(([id, answer]) => [id, [answer]]),
                ),
              })
            }
          >
            Submit answers
          </Button>
        </>
      ) : (
        <View style={layout.row}>
          {pending.decisions.map((decision) => (
            <Button
              key={decision}
              secondary={decision !== "accept"}
              disabled={disabled}
              onPress={() => onRespond({ decision })}
            >
              {decision === "accept" ? "Approve" : decision === "decline" ? "Decline" : "Cancel"}
            </Button>
          ))}
        </View>
      )}
    </Card>
  );
}
function ModelSettings({
  agent,
  disabled,
  onConfigure,
}: {
  agent: AgentInfo;
  disabled: boolean;
  onConfigure(settings: NonNullable<AgentInfo["settings"]>): void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!agent.models?.length || !agent.settings) return null;
  const settings = agent.settings;
  return (
    <View style={layout.stack}>
      <Button
        secondary
        onPress={() => setExpanded(!expanded)}
      >{`Model: ${settings.model ?? agent.model ?? "Default"}`}</Button>
      {expanded && (
        <View style={layout.row}>
          {agent.models.map((model) => (
            <Button
              key={model.id}
              disabled={disabled}
              secondary
              onPress={() =>
                onConfigure({ ...settings, model: model.id, effort: model.defaultEffort })
              }
            >
              {model.label}
            </Button>
          ))}
        </View>
      )}
    </View>
  );
}
