import { useContext } from "react";
import { FileLinkContext } from "@/files/context";
import { Children, isValidElement, useState, lazy, Suspense, type ReactNode } from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";
import { copyText } from "@/lib/clipboard";
const HighlightedCode = lazy(() => import("./highlighted-code"));

export function CopyButton({ text, label = "Copy message" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false),
    [error, setError] = useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : error ? "Copy failed; try again" : label}
      title={copied ? "Copied" : error ? "Copy failed; try again" : label}
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      onClick={() => {
        void copyText(text).then(
          () => {
            setCopied(true);
            setError(false);
          },
          () => {
            setCopied(false);
            setError(true);
          },
        );
      }}
      onBlur={() => setCopied(false)}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}
function codeText(value: ReactNode): string {
  return Children.toArray(value)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child)
        ? codeText(child.props.children)
        : typeof child === "string" || typeof child === "number"
          ? String(child)
          : "",
    )
    .join("");
}
function CodeBlock({ children }: { children?: ReactNode }) {
  const child = Children.toArray(children)[0];
  const language = isValidElement<{ className?: string }>(child)
    ? child.props.className?.replace("language-", "")
    : undefined;
  return (
    <div className="my-4 overflow-hidden rounded-xl border bg-muted/40">
      <div className="flex items-center justify-between border-b px-3 py-1 text-xs text-muted-foreground">
        <span>{language ?? "Code"}</span>
        <CopyButton text={codeText(children).replace(/\n$/, "")} label="Copy code" />
      </div>
      <pre className="chat-scroll m-0! rounded-none! bg-transparent!">
        <Suspense fallback={children}>
          <HighlightedCode
            code={codeText(children).replace(/\n$/, "")}
            language={language ?? null}
          />
        </Suspense>
      </pre>
    </div>
  );
}
export function AgentMarkdown({ children, sourcePath }: { children: string; sourcePath?: string }) {
  const openFile = useContext(FileLinkContext);
  return (
    <div className="chat-markdown min-w-0 break-words">
      <Markdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) =>
          openFile &&
          (/^file:\/\//i.test(url) ||
            /^[a-z]:[\\/]/i.test(url) ||
            /^[^:/]+\.[^:/]+:\d+(?::\d+)?$/.test(url))
            ? url
            : defaultUrlTransform(url)
        }
        components={{
          pre: CodeBlock,
          img: () => null,
          a: ({ children: content, ...props }) => (
            <a
              {...props}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => {
                if (!props.href || !openFile) return;
                if (openFile(props.href, sourcePath)) event.preventDefault();
                else if (
                  /^file:\/\//i.test(props.href) ||
                  !/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(props.href)
                ) {
                  event.preventDefault();
                  window.alert(
                    "This file link is outside the current project or cannot be opened.",
                  );
                }
              }}
            >
              {content}
            </a>
          ),
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}
