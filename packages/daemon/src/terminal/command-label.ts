/** Labels are cut at a word boundary to about this many characters. */
const MAX_LENGTH = 40;

const assignment = /^[A-Za-z_][A-Za-z0-9_]*=/;

/**
 * A word that could carry a secret, so the label stops before it: an option, anything with "=",
 * or a long run of characters that is not a path, such as a token.
 */
function mayHoldSecret(word: string): boolean {
  return (
    word.startsWith("-") ||
    word.includes("=") ||
    (word.length >= 20 && !word.includes("/")) ||
    word.length > MAX_LENGTH
  );
}

/**
 * What a running shell command is called where others can see it, as in "npm run dev is still
 * running". Leading environment assignments are dropped, the program is named by its file name,
 * and the label stops at the first word that may hold a secret.
 */
export function commandLabel(command: string): string {
  const words = command.trim().split(/\s+/).filter(Boolean);
  while (words[0] && assignment.test(words[0])) words.shift();
  const program = words.shift()?.replace(/^-/, "").split("/").at(-1);
  if (!program || mayHoldSecret(program)) return "A command";
  let label = program;
  for (const word of words) {
    if (mayHoldSecret(word) || label.length + 1 + word.length > MAX_LENGTH) break;
    label += ` ${word}`;
  }
  return label;
}
