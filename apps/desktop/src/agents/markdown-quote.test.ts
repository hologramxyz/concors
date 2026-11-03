import { expect, it } from "vitest";
import { quotedSource } from "./markdown-quote";

const span = (source: string, quote: string) => {
  const start = source.indexOf(quote);
  return [source, start, start + quote.length] as const;
};

it("keeps the Markdown a quote holds and removes only its own markers", () => {
  const quote = `> Go to **Railway**.
>
> 1. Open [the project](https://example.com).
> 2. Run \`deploy\`.
>
>     indented code
> > nested`;
  expect(quotedSource(...span(`Here it is:\n\n${quote}\n\nDone.`, quote))).toBe(
    `Go to **Railway**.

1. Open [the project](https://example.com).
2. Run \`deploy\`.

    indented code
> nested`,
  );
});

it("handles lazy lines, a marker with no space, and a quote inside a list", () => {
  expect(quotedSource(...span("> first\nsecond", "> first\nsecond"))).toBe("first\nsecond");
  expect(quotedSource(...span(">tight", ">tight"))).toBe("tight");
  const nested = "> one\n   > two";
  expect(quotedSource(...span(`1. Item\n\n   ${nested}`, nested))).toBe("one\ntwo");
});
