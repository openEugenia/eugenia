/**
 * Flashcards proposées par Eugenia pour une connaissance atomique : de nouvelles questions
 * sur la même connaissance, à relire, retoucher et ajouter en un commit.
 */
import { useState } from "react";
import { Plus, Sparkles } from "lucide-react";
import {
  ancestors,
  createFlashcard,
  parseFlashcardBody,
  parseKnowledgeBody,
  parsePage,
  type WikiNode,
} from "@openeugenia/core";
import type { FlashcardDraft } from "@openeugenia/ai";
import { taskContext } from "../lib/ai.ts";
import { errorMessage, toast } from "../store/ui.ts";
import { useWiki } from "../store/wiki.ts";
import { Spinner } from "./common.tsx";

interface Draft extends FlashcardDraft {
  include: boolean;
}

export function FlashcardSuggestions({ node }: { node: WikiNode }) {
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);

  const suggest = async (): Promise<void> => {
    const workspace = useWiki.getState().workspace;
    if (!workspace) return;
    setBusy(true);
    try {
      const tree = workspace.tree;
      const statement = parseKnowledgeBody(
        parsePage(await workspace.readText(node.indexPath)).body,
      ).statement;
      const cards = node.childIds
        .map((id) => tree.nodes.get(id)!)
        .filter((c) => c.type === "flashcard");
      await workspace.prefetch(cards.map((c) => workspace.files.get(c.indexPath)!).filter(Boolean));
      const existing = await Promise.all(
        cards.map(async (c) => {
          const card = parseFlashcardBody(parsePage(await workspace.readText(c.indexPath)).body);
          return { question: card.question, answer: card.answer };
        }),
      );
      const context = await taskContext(!node.isPublic);
      const { proposeFlashcards } = await import("@openeugenia/ai");
      const result = await proposeFlashcards(context, {
        knowledge: statement,
        title: node.title,
        path: ancestors(tree, node.id).map((a) => a.title),
        existing,
      });
      setDrafts(result.map((d) => ({ ...d, include: true })));
      if (result.length === 0) toast("Eugenia ne propose pas de nouvelle flashcard.");
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const add = async (): Promise<void> => {
    const { workspace, stage, commit } = useWiki.getState();
    if (!workspace || !drafts) return;
    const selected = drafts.filter((d) => d.include && d.question.trim() && d.answer.trim());
    if (selected.length === 0) return;
    try {
      const reserved: string[] = [];
      const changes = selected.map((d) => {
        const created = createFlashcard(workspace, node, d, reserved);
        reserved.push(created.indexPath);
        return created.change;
      });
      const message = `Flashcards de « ${node.title} »`;
      await stage(changes, message);
      await commit(message, reserved);
      setDrafts(null);
      toast(`${selected.length} flashcard(s) ajoutée(s).`, "success");
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  };

  const update = (index: number, patch: Partial<Draft>): void =>
    setDrafts((list) => list?.map((d, i) => (i === index ? { ...d, ...patch } : d)) ?? null);

  return (
    <div className="flashcard-suggestions">
      <button
        type="button"
        className="oe-button oe-button--ghost oe-button--sm"
        disabled={busy}
        onClick={() => void suggest()}
      >
        {busy ? <Spinner small label="Eugenia réfléchit" /> : <Sparkles aria-hidden="true" />}{" "}
        Proposer des flashcards
      </button>
      {drafts && drafts.length > 0 && (
        <div className="stack" style={{ marginTop: "0.75rem" }}>
          {drafts.map((d, i) => (
            <fieldset key={i} className="oe-card draft-card">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={d.include}
                  onChange={(e) => update(i, { include: e.target.checked })}
                />{" "}
                Garder cette flashcard
              </label>
              <label className="oe-field">
                <span className="oe-label">Question</span>
                <textarea
                  className="oe-textarea"
                  rows={2}
                  value={d.question}
                  onChange={(e) => update(i, { question: e.target.value })}
                />
              </label>
              <label className="oe-field">
                <span className="oe-label">Réponse attendue</span>
                <input
                  className="oe-input"
                  value={d.answer}
                  onChange={(e) => update(i, { answer: e.target.value })}
                />
              </label>
            </fieldset>
          ))}
          <div className="actions actions--start">
            <button
              type="button"
              className="oe-button oe-button--sm"
              disabled={!drafts.some((d) => d.include)}
              onClick={() => void add()}
            >
              <Plus aria-hidden="true" /> Ajouter les flashcards retenues
            </button>
            <button
              type="button"
              className="oe-button oe-button--ghost oe-button--sm"
              onClick={() => setDrafts(null)}
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
