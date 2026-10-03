import { useState } from "react";
import { Check, MessageCircleQuestionMark, ShieldAlert } from "lucide-react";
import type { AgentPending } from "@concors/protocol";
import { AgentMarkdown } from "./markdown";
import { Button } from "@/components/ui/button";
export function PendingInput({
  pending,
  disabled,
  onRespond,
}: {
  pending: AgentPending;
  disabled: boolean;
  onRespond: (value: {
    decision?: "accept" | "decline" | "cancel";
    actionId?: string;
    answers?: Record<string, string[]>;
  }) => Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>(() =>
    Object.fromEntries(pending.questions.map((q) => [q.id, q.defaultValue ?? ""])),
  );
  const label = (decision: "accept" | "decline" | "cancel") =>
    pending.decisionLabels?.[decision] ??
    (decision === "accept" ? "Allow once" : decision === "decline" ? "Dismiss" : "Cancel turn");
  const Icon = pending.kind === "approval" ? ShieldAlert : MessageCircleQuestionMark;
  // A lone question needs no "Question 1" label; several are numbered so answers can be matched.
  const numbered = pending.questions.length > 1;
  return (
    <section
      aria-label={pending.title}
      className="min-w-0 overflow-hidden rounded-xl border bg-card shadow-sm"
    >
      <header className="flex items-start gap-2.5 px-4 pt-3.5">
        <span className="mt-px flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="size-3.5" aria-hidden />
        </span>
        <div className="min-w-0 space-y-0.5">
          <h3 className="text-[length:var(--text-ui)] leading-6 font-medium">{pending.title}</h3>
          {pending.summary && (
            <p className="text-xs break-words whitespace-pre-wrap text-muted-foreground">
              {pending.summary}
            </p>
          )}
        </div>
      </header>
      {pending.kind === "approval" ? (
        <>
          <div className="space-y-3 px-4 pt-3 pb-4">
            {pending.plan && (
              <div className="chat-markdown chat-scroll max-h-80 overflow-auto rounded-lg border bg-background px-3 py-2 text-sm">
                <AgentMarkdown>{pending.plan}</AgentMarkdown>
              </div>
            )}
            <details className="group">
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                Review request details
              </summary>
              <pre className="chat-scroll mt-2 max-h-40 overflow-auto rounded-lg border bg-background px-3 py-2 font-mono text-xs break-words whitespace-pre-wrap">
                {pending.detail}
              </pre>
            </details>
          </div>
          <footer className="flex flex-wrap justify-end gap-2 border-t bg-muted/30 px-4 py-2.5">
            {(pending.actions
              ? pending.actions.map((action) => ({
                  key: action.id,
                  label: action.label,
                  decision: action.decision,
                  actionId: action.id,
                }))
              : pending.decisions.map((decision) => ({
                  key: decision,
                  label: label(decision),
                  decision,
                  actionId: undefined,
                }))
            ).map((choice, index, choices) => (
              <Button
                key={choice.key}
                variant={
                  choices.findIndex((c) => c.decision === "accept") === index
                    ? "default"
                    : "outline"
                }
                disabled={disabled}
                onClick={() =>
                  void onRespond({
                    decision: choice.decision,
                    ...(choice.actionId ? { actionId: choice.actionId } : {}),
                  })
                }
              >
                {choice.label}
              </Button>
            ))}
          </footer>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onRespond({
              answers: Object.fromEntries(
                pending.questions.map((q) => [
                  q.id,
                  [
                    ...(answers[q.id] ?? []),
                    ...(q.multiline && other[q.id]
                      ? [other[q.id] ?? ""]
                      : other[q.id]?.trim()
                        ? [(other[q.id] ?? "").trim()]
                        : []),
                  ],
                ]),
              ),
            });
          }}
        >
          <div className="space-y-5 px-4 pt-3 pb-4">
            {pending.elicitation?.url && (
              <a
                href={pending.elicitation.url}
                target="_blank"
                rel="noreferrer"
                className="block text-sm break-all underline"
              >
                Open the server’s authentication page
              </a>
            )}
            {pending.questions.map((q, questionIndex) => {
              const changeText = (value: string) => {
                setOther((current) => ({ ...current, [q.id]: value }));
                if (!q.multiSelect) setAnswers((current) => ({ ...current, [q.id]: [] }));
              };
              const field = {
                "aria-label": q.options?.length ? `Other answer: ${q.question}` : q.question,
                value: other[q.id] ?? "",
                placeholder:
                  q.placeholder ?? (q.options?.length ? "Something else…" : "Type your answer…"),
                required: q.required !== false && !answers[q.id]?.length,
                disabled,
                className:
                  "w-full min-w-0 rounded-lg border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:opacity-50",
                maxLength: 16000,
              };
              // Codex labels its questions "Question N" itself; that only repeats the numbering.
              const header =
                q.header && !/^Question \d+$/.test(q.header)
                  ? q.header
                  : numbered
                    ? `Question ${questionIndex + 1} of ${pending.questions.length}`
                    : undefined;
              return (
                <fieldset key={q.id} className="min-w-0 space-y-2.5">
                  <legend className="w-full">
                    {header && (
                      <span className="mb-1 block text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                        {header}
                      </span>
                    )}
                    <span className="block text-sm leading-snug font-medium break-words text-foreground">
                      {q.question}
                      {q.required === false && (
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                          Optional
                        </span>
                      )}
                    </span>
                  </legend>
                  {q.multiSelect && !!q.options?.length && (
                    <p className="text-xs text-muted-foreground">Choose all that apply.</p>
                  )}
                  {!!q.options?.length && (
                    <div
                      role={q.multiSelect ? "group" : "radiogroup"}
                      aria-label={q.question}
                      className="space-y-1.5"
                    >
                      {q.options.map((option, optionIndex) => {
                        const selected = answers[q.id]?.includes(option.label) ?? false;
                        return (
                          <button
                            type="button"
                            role={q.multiSelect ? "checkbox" : "radio"}
                            aria-checked={selected}
                            tabIndex={
                              q.multiSelect ||
                              selected ||
                              (!answers[q.id]?.length && optionIndex === 0)
                                ? 0
                                : -1
                            }
                            onKeyDown={(event) => {
                              if (
                                q.multiSelect ||
                                ![
                                  "ArrowDown",
                                  "ArrowRight",
                                  "ArrowUp",
                                  "ArrowLeft",
                                  "Home",
                                  "End",
                                ].includes(event.key)
                              )
                                return;
                              event.preventDefault();
                              const choices = Array.from(
                                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                                  '[role="radio"]',
                                ) ?? [],
                              );
                              const index =
                                event.key === "Home"
                                  ? 0
                                  : event.key === "End"
                                    ? choices.length - 1
                                    : (optionIndex +
                                        (["ArrowDown", "ArrowRight"].includes(event.key) ? 1 : -1) +
                                        choices.length) %
                                      choices.length;
                              choices[index]?.focus();
                              choices[index]?.click();
                            }}
                            key={option.label}
                            className={`group/option flex w-full min-w-0 cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:pointer-events-none disabled:opacity-50 ${selected ? "border-foreground/50 bg-muted" : "bg-background hover:bg-muted/60"}`}
                            disabled={disabled}
                            onClick={() => {
                              setAnswers((current) => ({
                                ...current,
                                [q.id]: q.multiSelect
                                  ? selected
                                    ? (current[q.id] ?? []).filter((v) => v !== option.label)
                                    : [...(current[q.id] ?? []), option.label]
                                  : [option.label],
                              }));
                              if (!q.multiSelect)
                                setOther((current) => ({ ...current, [q.id]: "" }));
                            }}
                          >
                            <span
                              aria-hidden
                              className={`mt-[3px] flex size-[14px] shrink-0 items-center justify-center border transition-colors ${q.multiSelect ? "rounded-[4px]" : "rounded-full"} ${selected ? "border-foreground bg-foreground text-background" : "border-muted-foreground/50"}`}
                            >
                              {selected &&
                                (q.multiSelect ? (
                                  <Check className="size-[10px]" strokeWidth={3.5} />
                                ) : (
                                  <span className="size-[6px] rounded-full bg-background" />
                                ))}
                            </span>
                            <span className="min-w-0">
                              <span className="block text-sm break-words text-foreground">
                                {option.label}
                              </span>
                              {option.description && (
                                <span className="mt-0.5 block text-xs break-words text-muted-foreground">
                                  {option.description}
                                </span>
                              )}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {(q.allowOther !== false || !q.options?.length) &&
                    (q.multiline && !q.isSecret ? (
                      <textarea
                        {...field}
                        rows={3}
                        className={`${field.className} max-h-64 resize-y`}
                        onChange={(e) => changeText(e.target.value)}
                      />
                    ) : (
                      <input
                        {...field}
                        type={q.isSecret ? "password" : "text"}
                        onChange={(e) => changeText(e.target.value)}
                      />
                    ))}
                </fieldset>
              );
            })}
          </div>
          <footer className="flex flex-wrap justify-end gap-2 border-t bg-muted/30 px-4 py-2.5">
            {pending.decisions
              .filter((d) => d !== "accept")
              .map((decision) => (
                <Button
                  key={decision}
                  type="button"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => void onRespond({ decision })}
                >
                  {label(decision)}
                </Button>
              ))}
            <Button
              type="submit"
              disabled={
                disabled ||
                pending.questions.some(
                  (q) => q.required !== false && !answers[q.id]?.length && !other[q.id]?.trim(),
                )
              }
            >
              {pending.elicitation?.url
                ? "Authentication completed"
                : pending.questions.length > 1
                  ? "Submit answers"
                  : pending.questions.length
                    ? "Submit answer"
                    : "Continue"}
            </Button>
          </footer>
        </form>
      )}
    </section>
  );
}
