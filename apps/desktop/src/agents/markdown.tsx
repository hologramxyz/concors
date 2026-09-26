import { useContext } from "react";
import { FileLinkContext } from "@/files/context";
import {
  Children,
  createContext,
  isValidElement,
  useState,
  lazy,
  Suspense,
  type ComponentProps,
  type ReactNode,
} from "react";
import Markdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy, ImageOff } from "lucide-react";
import type { AgentItem } from "@concors/protocol";
import { copyText } from "@/lib/clipboard";
import { TerminalConnectionContext } from "@/terminal/connection-context";
import { openPreview } from "@/tauri/open-external";
import { isFileLink, localPreviewLink, previewLinkUrl } from "./preview-links";
import { InlineImage } from "./attachment-preview";
import { messageImageIndex } from "./message-images";
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
/** What the Markdown components need from the message they render, without being rebuilt. */
const MarkdownScope = createContext<{
  item?: AgentItem | undefined;
  sourcePath?: string | undefined;
}>({});

function MarkdownImage({ src, alt }: ComponentProps<"img">) {
  const { item } = useContext(MarkdownScope);
  const source = typeof src === "string" ? src : "";
  const index = item ? messageImageIndex(item.attachments, source) : -1;
  if (item && index >= 0) return <InlineImage item={item} index={index} alt={alt ?? ""} />;
  // Web images are never loaded; a file the daemon could not keep says so.
  if (item?.status === "running") return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-sm text-muted-foreground"
      title={source ? `Image not available: ${source}` : undefined}
    >
      <ImageOff className="size-3.5 shrink-0" aria-hidden="true" />
      {alt || source || "Image"}
    </span>
  );
}

function MarkdownLink({ children: content, href, node: _node, ...props }: LinkProps) {
  const openFile = useContext(FileLinkContext);
  const connection = useContext(TerminalConnectionContext);
  const { sourcePath } = useContext(MarkdownScope);
  const preview = href && connection ? localPreviewLink(href) : null;
  const previewUrl =
    preview && connection?.endpoint.kind === "remote"
      ? connection.previewUrl(preview.preview)
      : null;
  // The preview address carries access in its fragment, so it is only used on click and never
  // lands in the DOM. A preview that stopped listening simply does not open.
  if (previewUrl && preview)
    return (
      <a
        {...props}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => {
          event.preventDefault();
          void openPreview(preview.preview, previewLinkUrl(preview, previewUrl)).catch(
            () => undefined,
          );
        }}
      >
        {content}
      </a>
    );
  const open = href && openFile ? openFile(href, sourcePath) : null;
  // A file the chat cannot open (outside the project, or no project at all) reads as plain text:
  // following it would only land on a broken page inside the app.
  if (!href || (!open && isFileLink(href)))
    return (
      <span
        className="underline decoration-dotted underline-offset-2"
        title={href ? `Outside this project: ${href}` : undefined}
      >
        {content}
      </span>
    );
  return (
    <a
      {...props}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => {
        if (!open) return;
        event.preventDefault();
        open();
      }}
    >
      {content}
    </a>
  );
}
type LinkProps = ComponentProps<"a"> & { node?: unknown };

// Fixed components that read their message from MarkdownScope. Components built per render would
// be new element types each time, remounting every image and closing its viewer whenever the chat
// re-renders, which it does every second while an agent works.
const components: Components = { pre: CodeBlock, img: MarkdownImage, a: MarkdownLink };

export function AgentMarkdown({
  children,
  sourcePath,
  item,
}: {
  children: string;
  sourcePath?: string;
  /** The agent message being shown, whose kept images its Markdown images refer to. */
  item?: AgentItem;
}) {
  const openFile = useContext(FileLinkContext);
  return (
    <MarkdownScope value={{ item, sourcePath }}>
      <div className="chat-markdown min-w-0 break-words">
        <Markdown
          remarkPlugins={[remarkGfm]}
          // Image sources are only matched against the images the daemon kept, never loaded.
          urlTransform={(url, key) =>
            key === "src" ||
            (openFile &&
              (/^file:\/\//i.test(url) ||
                /^[a-z]:[\\/]/i.test(url) ||
                /^[^:/]+\.[^:/]+:\d+(?::\d+)?$/.test(url)))
              ? url
              : defaultUrlTransform(url)
          }
          components={components}
        >
          {children}
        </Markdown>
      </div>
    </MarkdownScope>
  );
}
