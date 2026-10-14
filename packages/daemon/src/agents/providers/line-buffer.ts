/**
 * Splits a text stream into lines in time proportional to its length. Searching and measuring a
 * buffer that grows with every chunk costs time in the square of a line's size, which is seconds
 * once a single line carries an image or a long tool output; only each new chunk is looked at here,
 * and the unfinished line is kept as its pieces.
 */
export class LineBuffer {
  #parts: string[] = [];
  #bytes = 0;
  readonly #maxBytes: number;
  readonly #tooLarge: () => Error;
  constructor(maxBytes: number, tooLarge: () => Error) {
    this.#maxBytes = maxBytes;
    this.#tooLarge = tooLarge;
  }
  /** Each complete line in the chunk, without its newline or a trailing carriage return. */
  push(chunk: string): string[] {
    const lines: string[] = [];
    let start = 0;
    let boundary: number;
    while ((boundary = chunk.indexOf("\n", start)) >= 0) {
      const tail = chunk.slice(start, boundary);
      const bytes = this.#bytes + Buffer.byteLength(tail);
      const line = this.#parts.length ? this.#parts.join("") + tail : tail;
      this.#parts = [];
      this.#bytes = 0;
      start = boundary + 1;
      if (bytes > this.#maxBytes) throw this.#tooLarge();
      lines.push(line.endsWith("\r") ? line.slice(0, -1) : line);
    }
    const rest = chunk.slice(start);
    if (rest) {
      this.#parts.push(rest);
      this.#bytes += Buffer.byteLength(rest);
      if (this.#bytes > this.#maxBytes) throw this.#tooLarge();
    }
    return lines;
  }
}
