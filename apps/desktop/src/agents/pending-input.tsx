import { useState } from "react";
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
  return (
    <section
      aria-label={pending.title}
      className="min-w-0 space-y-3 rounded-lg border bg-muted/20 p-3"
    >
      <h3 className="text-sm font-medium">{pending.title}</h3>
      {pending.summary && (
        <p className="text-sm break-words whitespace-pre-wrap">{pending.summary}</p>
      )}
      {pending.kind === "approval" ? (
        <>
          {pending.plan && (
            <div className="chat-markdown chat-scroll max-h-80 overflow-auto text-sm">
              <AgentMarkdown>{pending.plan}</AgentMarkdown>
            </div>
          )}
          <details>
            <summary className="cursor-pointer text-sm text-muted-foreground">
              Review request details
            </summary>
            <pre className="chat-scroll mt-2 max-h-40 overflow-auto text-sm break-words whitespace-pre-wrap">
              {pending.detail}
            </pre>
          </details>
          <div className="flex flex-wrap gap-2">
            {pending.actions
              ? pending.actions.map((action) => (
                  <Button
                    key={action.id}
                    variant="outline"
                    disabled={disabled}
                    onClick={() =>
                      void onRespond({ decision: action.decision, actionId: action.id })
                    }
                  >
                    {action.label}
                  </Button>
                ))
              : pending.decisions.map((decision) => (
                  <Button
                    key={decision}
                    variant="outline"
                    disabled={disabled}
                    onClick={() => void onRespond({ decision })}
                  >
                    {label(decision)}
                  </Button>
                ))}
          </div>
        </>
      ) : (
        <form
          className="space-y-4"
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
          {pending.questions.map((q) => {
            const changeText = (value: string) => {
              setOther((current) => ({ ...current, [q.id]: value }));
              if (!q.multiSelect) setAnswers((current) => ({ ...current, [q.id]: [] }));
            };
            const field = {
              "aria-label": q.options?.length ? `Other answer: ${q.question}` : q.question,
              value: other[q.id] ?? "",
              placeholder: q.placeholder ?? (q.options?.length ? "Other answer" : "Your answer"),
              required: q.required !== false && !answers[q.id]?.length,
              disabled,
              className: "w-full min-w-0 rounded border bg-background px-3 py-2 text-sm",
              maxLength: 16000,
            };
            return (
              <fieldset key={q.id} className="min-w-0 space-y-2 text-sm">
                <legend className="mb-1 font-medium">
                  {q.header || q.question}
                  {q.required === false ? " (optional)" : ""}
                </legend>
                {q.header && <p>{q.question}</p>}
                {!!q.options?.length && (
                  <div
                    role={q.multiSelect ? "group" : "radiogroup"}
                    aria-label={q.question}
                    className="space-y-2"
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
                          className={`block w-full min-w-0 rounded-md border px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-40 ${selected ? "border-foreground bg-muted" : ""}`}
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
                            if (!q.multiSelect) setOther((current) => ({ ...current, [q.id]: "" }));
                          }}
                        >
                          <span className="block font-medium break-words">{option.label}</span>
                          {option.description && (
                            <span className="mt-1 block break-words text-muted-foreground">
                              {option.description}
                            </span>
                          )}
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
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant="outline"
              disabled={
                disabled ||
                pending.questions.some(
                  (q) => q.required !== false && !answers[q.id]?.length && !other[q.id]?.trim(),
                )
              }
            >
              {pending.elicitation?.url
                ? "Authentication completed"
                : pending.questions.length
                  ? "Submit answers"
                  : "Continue"}
            </Button>
            {pending.decisions
              .filter((d) => d !== "accept")
              .map((decision) => (
                <Button
                  key={decision}
                  type="button"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => void onRespond({ decision })}
                >
                  {label(decision)}
                </Button>
              ))}
          </div>
        </form>
      )}
    </section>
  );
}
