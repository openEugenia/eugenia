/**
 * Éditeur Markdown (CodeMirror 6). Les liens vers d'autres pages s'insèrent en cherchant
 * un titre (bouton ou saisie de `[[`) ; le chemin relatif est généré automatiquement (§5.8).
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderExt } from "@codemirror/view";
import { tags } from "@lezer/highlight";

export interface LinkCompletion {
  label: string;
  detail?: string;
  /** Texte Markdown inséré (`[Titre](chemin)`). */
  apply: string;
}

export interface MarkdownEditorHandle {
  insert(text: string): void;
  wrap(before: string, after?: string): void;
  focus(): void;
}

interface MarkdownEditorProps {
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  small?: boolean;
  ariaLabel?: string;
  /** Propositions de liens pour la saisie `[[titre`. */
  linkCompletions?(query: string): LinkCompletion[];
}

const theme = EditorView.theme({
  "&": { color: "var(--oe-color-text)", backgroundColor: "var(--oe-color-bg)" },
  ".cm-content": { caretColor: "var(--oe-color-text)", padding: "0.75rem 0" },
  ".cm-line": { padding: "0 0.9rem" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--oe-color-text)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--oe-color-primary-subtle) !important",
  },
  ".cm-placeholder": { color: "var(--oe-color-text-muted)" },
  ".cm-tooltip": {
    border: "1px solid var(--oe-color-border)",
    backgroundColor: "var(--oe-color-surface-raised)",
    color: "var(--oe-color-text)",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--oe-color-primary-subtle)",
    color: "var(--oe-color-text)",
  },
});

const highlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "700", color: "var(--oe-color-text)" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.link, color: "var(--oe-color-link)" },
  { tag: tags.url, color: "var(--oe-color-text-muted)" },
  { tag: tags.monospace, color: "var(--oe-color-info)" },
  {
    tag: [tags.processingInstruction, tags.contentSeparator, tags.quote],
    color: "var(--oe-color-text-muted)",
  },
  { tag: tags.list, color: "var(--oe-color-primary)" },
]);

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor(
    { value, onChange, placeholder, small = false, ariaLabel, linkCompletions },
    ref,
  ) {
    const host = useRef<HTMLDivElement>(null);
    const view = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    const completionsRef = useRef(linkCompletions);
    onChangeRef.current = onChange;
    completionsRef.current = linkCompletions;

    useEffect(() => {
      if (!host.current) return;
      const linkSource = (context: CompletionContext): CompletionResult | null => {
        const match = context.matchBefore(/\[\[[^\]\n]*/);
        if (!match || !completionsRef.current) return null;
        const query = match.text.slice(2);
        return {
          from: match.from,
          filter: false,
          options: completionsRef.current(query).map((c) => ({
            label: c.label,
            ...(c.detail ? { detail: c.detail } : {}),
            apply: c.apply,
            type: "text",
          })),
        };
      };
      const state = EditorState.create({
        doc: value,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          markdown(),
          syntaxHighlighting(highlight),
          EditorView.lineWrapping,
          autocompletion({ override: [linkSource], activateOnTyping: true }),
          theme,
          ...(placeholder ? [placeholderExt(placeholder)] : []),
          EditorView.contentAttributes.of({
            "aria-label": ariaLabel ?? "Texte Markdown",
            spellcheck: "true",
            lang: "fr",
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      });
      view.current = new EditorView({ state, parent: host.current });
      return () => {
        view.current?.destroy();
        view.current = null;
      };
      // L'éditeur est créé une fois ; la valeur externe est synchronisée ci-dessous.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      const v = view.current;
      if (v && v.state.doc.toString() !== value) {
        v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
      }
    }, [value]);

    useImperativeHandle(ref, () => ({
      insert(text) {
        const v = view.current;
        if (!v) return;
        const { from, to } = v.state.selection.main;
        v.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
        });
        v.focus();
      },
      wrap(before, after = before) {
        const v = view.current;
        if (!v) return;
        const { from, to } = v.state.selection.main;
        const selected = v.state.sliceDoc(from, to);
        v.dispatch({
          changes: { from, to, insert: `${before}${selected}${after}` },
          selection: { anchor: from + before.length, head: from + before.length + selected.length },
        });
        v.focus();
      },
      focus() {
        view.current?.focus();
      },
    }));

    return <div className={`cm-host${small ? " cm-host--small" : ""}`} ref={host} />;
  },
);
