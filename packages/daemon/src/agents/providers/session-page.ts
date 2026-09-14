export function sessionOffset(cursor: unknown): number {
  if (cursor === undefined) return 0;
  if (typeof cursor !== "string" || !/^\d+$/.test(cursor))
    throw new Error("Invalid session cursor");
  const offset = Number(cursor);
  if (!Number.isSafeInteger(offset) || offset > 1_000_000)
    throw new Error("Invalid session cursor");
  return offset;
}
