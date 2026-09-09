// CodeMirror integration informed by Paseo a7a708b file-pane/editor (Apache-2.0).
// See docs/project-files.md and third-party/paseo-LICENSE.
import { useEffect, useRef } from "react";
import { Annotation, Compartment, EditorState, Transaction } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, syntaxHighlighting } from "@codemirror/language";
import { searchKeymap } from "@codemirror/search";
import {
  createCodeMirrorHighlightStyle,
  darkHighlightColors,
  getLanguageForFile,
  lightHighlightColors,
} from "@getpaseo/highlight";
import { getCM, Vim, vim } from "@replit/codemirror-vim";
import type { FileLocation } from "./links";

const diskUpdate = Annotation.define<boolean>();
const saves = new WeakMap<object, () => void>();
Vim.defineEx("write", "w", (cm) => saves.get(cm)?.());

export default function CodeEditor({
  content,
  path,
  onChange,
  onSave,
  vimEnabled,
  wrap,
  location,
  navigation,
  readOnly = false,
}: {
  content: string;
  path: string;
  onChange(content: string): void;
  onSave(): void;
  vimEnabled: boolean;
  wrap: boolean;
  location: FileLocation;
  navigation: number;
  readOnly?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const settings = useRef(new Compartment());
  const colors = useRef(new Compartment());
  const callbacks = useRef({ onChange, onSave });
  useEffect(() => {
    callbacks.current = { onChange, onSave };
  }, [onChange, onSave]);
  const initial = useRef({ content, path });
  useEffect(() => {
    if (!host.current) return;
    const { content: text, path: filename } = initial.current;
    const separator = text.includes("\r\n") ? "\r\n" : text.includes("\r") ? "\r" : "\n";
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: text,
        extensions: [
          EditorState.lineSeparator.of(separator),
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          bracketMatching(),
          getLanguageForFile(filename)?.extension ?? [],
          settings.current.of([]),
          colors.current.of([]),
          EditorView.contentAttributes.of({
            "aria-label": `Code editor: ${filename}`,
            spellcheck: "false",
          }),
          keymap.of([
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                callbacks.current.onSave();
                return true;
              },
            },
            indentWithTab,
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !update.transactions.some((tr) => tr.annotation(diskUpdate)))
              callbacks.current.onChange(update.state.doc.sliceString(0, undefined, separator));
          }),
          EditorView.theme({
            "&": {
              height: "100%",
              backgroundColor: "var(--background)",
              color: "var(--foreground)",
              fontSize: "14px",
            },
            ".cm-scroller": {
              overflow: "auto",
              fontFamily: "var(--font-mono)",
              lineHeight: "1.65",
            },
            ".cm-content": { padding: "12px 0", caretColor: "var(--foreground)" },
            ".cm-gutters": {
              backgroundColor: "var(--background)",
              color: "var(--muted-foreground)",
              borderRight: "1px solid var(--border)",
            },
            ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--muted)" },
            ".cm-cursor": { borderLeftColor: "var(--foreground)" },
            "&.cm-focused": { outline: "none" },
            ".cm-panels": { backgroundColor: "var(--background)", color: "var(--foreground)" },
            ".cm-textfield": {
              backgroundColor: "var(--background)",
              color: "var(--foreground)",
              border: "1px solid var(--border)",
            },
            ".cm-button": {
              backgroundImage: "none",
              backgroundColor: "var(--muted)",
              color: "var(--foreground)",
            },
            "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
              backgroundColor: "color-mix(in srgb, var(--primary) 25%, transparent)",
            },
          }),
        ],
      }),
    });
    view.current = editor;
    const theme = () =>
      editor.dispatch({
        effects: colors.current.reconfigure(
          syntaxHighlighting(
            createCodeMirrorHighlightStyle(
              document.documentElement.classList.contains("dark")
                ? darkHighlightColors
                : lightHighlightColors,
            ),
          ),
        ),
      });
    theme();
    const observer = new MutationObserver(theme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => {
      observer.disconnect();
      const cm = getCM(editor);
      if (cm) saves.delete(cm);
      editor.destroy();
      view.current = null;
    };
  }, []);
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const cm = getCM(editor);
    if (cm) saves.delete(cm);
    editor.dispatch({
      effects: settings.current.reconfigure([
        vimEnabled && !readOnly ? vim() : [],
        wrap ? EditorView.lineWrapping : [],
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    });
    const next = getCM(editor);
    if (next) saves.set(next, () => callbacks.current.onSave());
  }, [vimEnabled, wrap, readOnly]);
  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const doc = editor.state.toText(content);
    if (editor.state.doc.eq(doc)) return;
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: doc },
      annotations: [diskUpdate.of(true), Transaction.addToHistory.of(false)],
    });
  }, [content]);
  useEffect(() => {
    const editor = view.current;
    if (!editor || !location.line) return;
    const line = editor.state.doc.line(Math.min(location.line, editor.state.doc.lines));
    editor.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    });
    editor.focus();
  }, [location.line, navigation]);
  return <div ref={host} className="h-full min-h-0 min-w-0 overflow-hidden" />;
}
