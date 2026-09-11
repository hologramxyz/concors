import type { AgentQuestion } from "@concors/protocol";

/** Validate before resolving a native request; a malformed response must keep the form open. */
export function questionAnswers(
  questions: AgentQuestion[],
  answers: Record<string, string[]> = {},
) {
  if (Object.keys(answers).some((id) => !questions.some((q) => q.id === id)))
    throw new Error("An answer refers to an unknown question");
  return Object.fromEntries(
    questions.map((q) => {
      const values = (answers[q.id] ?? []).map((value) => (q.multiline ? value : value.trim()));
      if (values.some((value) => !value.trim()) && !(q.multiline && q.required === false))
        throw new Error("Enter an answer or leave the optional question blank");
      if (q.required !== false && !values.length) throw new Error("Answer each required question");
      if (!q.multiSelect && values.length > 1)
        throw new Error("Choose one answer for this question");
      if (new Set(values).size !== values.length) throw new Error("Choose each answer only once");
      if (
        q.options?.length &&
        q.allowOther === false &&
        values.some((value) => !(q.options ?? []).some((option) => option.label === value))
      )
        throw new Error("Choose one of the available answers");
      return [q.id, { answers: values }];
    }),
  );
}
