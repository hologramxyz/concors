/**
 * Agents name files in plain text ("Saved to docs/plan.md") far more often than as Markdown
 * links. This finds such mentions in a reply and turns them into links, so they open like any
 * file link the chat shows; whether one is openable (inside the project) is still the link's call.
 *
 * It is deliberately narrow, since a word wrongly linked is worse than a path left plain: a path
 * with a slash must end in an extension, and a bare name only counts with a known file extension.
 * Directories, URLs, home-relative paths (~/...) and text already inside a link or code block are
 * left alone.
 */

/** Extensions a bare name needs to count as a file: words like "Node.js" or "concors.dev" do not. */
const BARE_EXTENSIONS = new Set(
  (
    "md mdx txt rst json jsonc json5 yaml yml toml ini env csv tsv log ts tsx mts cts js jsx mjs " +
    "cjs py ipynb rb go rs java kt kts swift cc cpp hpp cs php sh zsh bash fish ps1 sql html htm " +
    "css scss sass less vue svelte astro xml svg png jpg jpeg gif webp avif ico bmp pdf mp4 mov " +
    "webm m4v mp3 wav lock zip gz tgz tar docx xlsx pptx proto graphql gql tf hcl dart lua scala " +
    "ex exs erl hs ml nix conf cfg plist gradle patch diff"
  ).split(" "),
);

/** Names that read as products rather than files. */
const NOT_FILES = /^(?:node|next|nuxt|vue|react|three|express|deno|bun|chart|d3|p5)\.js$/i;

const SEGMENT = String.raw`[\w@+-][\w.@+-]*`;
const LINE = String.raw`(?::\d+(?::\d+)?)?`;
// A path with a slash ends in an extension; a bare name is checked against BARE_EXTENSIONS.
const NAME = String.raw`[\w@+-][\w.@+-]*\.[A-Za-z\d]{1,10}`;
const PATH = String.raw`(?:\.{1,2}\/(?:${SEGMENT}\/)*|\/?(?:${SEGMENT}\/)+)${NAME}`;
const BARE = String.raw`[\w@+-][\w.@+-]*\.([A-Za-z\d]{1,10})`;
const MENTION = new RegExp(
  String.raw`(?<![\w/.~:@\\-])(?:(${PATH})|(${BARE}))(${LINE})(?![\w/@\\-]|\.[\w])`,
  "g",
);

export interface FileMention {
  start: number;
  end: number;
  /** The mention as written, line suffix included, which is what the link points at. */
  href: string;
}

function isBareFile(name: string, extension: string): boolean {
  return BARE_EXTENSIONS.has(extension.toLowerCase()) && !NOT_FILES.test(name);
}

/** The file mentions in a run of plain text, in order. */
export function findFileMentions(text: string): FileMention[] {
  const found: FileMention[] = [];
  for (const match of text.matchAll(MENTION)) {
    const [whole, path, bare, extension = ""] = match;
    if (!path && !(bare && isBareFile(bare, extension))) continue;
    found.push({ start: match.index, end: match.index + whole.length, href: whole });
  }
  return found;
}

/** Whether a piece of inline code is, as a whole, a file mention. */
export function isFileMention(code: string): boolean {
  const [only, ...rest] = findFileMentions(code.trim());
  return !rest.length && only?.href === code.trim();
}

interface Node {
  type: string;
  value?: string;
  url?: string;
  children?: Node[];
  data?: { hProperties?: Record<string, unknown> };
}

function link(href: string, children: Node[]): Node {
  return { type: "link", url: href, children, data: { hProperties: { "data-file-mention": "" } } };
}

function linkify(parent: Node): void {
  if (!parent.children) return;
  const next: Node[] = [];
  for (const child of parent.children) {
    if (child.type === "text" && child.value) {
      let at = 0;
      for (const mention of findFileMentions(child.value)) {
        if (mention.start > at)
          next.push({ type: "text", value: child.value.slice(at, mention.start) });
        next.push(link(mention.href, [{ type: "text", value: mention.href }]));
        at = mention.end;
      }
      next.push(at ? { type: "text", value: child.value.slice(at) } : child);
      continue;
    }
    if (child.type === "inlineCode" && child.value && isFileMention(child.value)) {
      next.push(link(child.value.trim(), [child]));
      continue;
    }
    // Links already go somewhere, and code blocks are code.
    if (!["link", "linkReference", "definition", "code", "html"].includes(child.type))
      linkify(child);
    next.push(child);
  }
  parent.children = next.filter((node) => node.type !== "text" || node.value);
}

/** A remark plugin: file mentions in the reply become links marked `data-file-mention`. */
export function remarkFileMentions() {
  return (tree: unknown) => linkify(tree as Node);
}
