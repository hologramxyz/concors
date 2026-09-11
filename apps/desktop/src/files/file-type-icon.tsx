import { DefaultFileIcon, FileIcon } from "@react-symbols/icons/utils";
import { BracketsYellow, Markdown, TypeScript } from "@react-symbols/icons/files";
import { cn } from "cn";

const extensions = {
  mts: TypeScript,
  cts: TypeScript,
  markdown: Markdown,
  mdown: Markdown,
  jsonc: BracketsYellow,
  json5: BracketsYellow,
};

/** Shared by the file tree and tabs, including the offline mobile renderer. */
export function FileTypeIcon({ path, className }: { path: string; className?: string }) {
  const name = path.split(/[\\/]/).pop() ?? path;
  const lower = name.toLowerCase();
  const fileName = lower.startsWith(".env.")
    ? ".env"
    : lower.startsWith("dockerfile.")
      ? "Dockerfile"
      : name;
  const iconProps = {
    "aria-hidden": true,
    focusable: false,
    "data-file-icon": true,
    className: cn("size-[20px] shrink-0 brightness-75 dark:brightness-110", className),
  } as const;
  // The upstream lookup uses plain objects. Inherited keys are filenames, not React components.
  const key = fileName.toLowerCase();
  if (
    Object.hasOwn(Object.prototype, key) ||
    Object.hasOwn(Object.prototype, key.split(".").at(-1) ?? "")
  )
    return <DefaultFileIcon {...iconProps} />;
  return (
    <FileIcon fileName={fileName} autoAssign editFileExtensionData={extensions} {...iconProps} />
  );
}
