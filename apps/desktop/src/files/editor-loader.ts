import type * as CodeEditorModule from "./code-editor";
let editorModule: Promise<typeof CodeEditorModule> | undefined;
export function loadCodeEditor() {
  return (editorModule ??= import("./code-editor").catch((error: unknown) => {
    editorModule = undefined;
    throw error;
  }));
}
export function preloadCodeEditor() {
  void loadCodeEditor().catch(() => undefined);
}
