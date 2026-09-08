// DOM adaptation of Paseo highlighted-code-block.tsx; Apache-2.0.
// Copyright (c) 2025-present Mohamed Boudra. See third-party/paseo-LICENSE.
import { useMemo, type CSSProperties } from "react";
import { darkHighlightColors, lightHighlightColors } from "@getpaseo/highlight";
import { highlightToKeyedLines } from "./paseo/highlight-cache";
const LANGUAGE_ALIASES: Record<string, string> = {
  typescript: "ts",
  javascript: "js",
  python: "py",
  rust: "rs",
  golang: "go",
  "c++": "cpp",
  csharp: "cs",
  "c#": "cs",
  objc: "m",
  "objective-c": "m",
  markdown: "md",
  elixir: "ex",
};
export default function HighlightedCode({
  code,
  language,
}: {
  code: string;
  language: string | null;
}) {
  const normalized = language?.trim().split(/\s+/)[0]?.toLowerCase().replace(/^\./, "") ?? "";
  const ext = LANGUAGE_ALIASES[normalized] ?? normalized;
  const lines = useMemo(() => highlightToKeyedLines(code, ext || null), [code, ext]);
  if (!lines) return <code>{code}</code>;
  return (
    <code>
      {lines.map((line, index) => (
        <span key={line.key}>
          {line.tokens.map(({ key, token }) =>
            token.style ? (
              <span
                key={key}
                className="syntax-token"
                data-syntax={token.style}
                style={
                  {
                    "--token-light": lightHighlightColors[token.style],
                    "--token-dark": darkHighlightColors[token.style],
                  } as CSSProperties
                }
              >
                {token.text}
              </span>
            ) : (
              <span key={key}>{token.text}</span>
            ),
          )}
          {index < lines.length - 1 ? "\n" : ""}
        </span>
      ))}
    </code>
  );
}
