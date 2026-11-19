/** Suggestions de sous-catégories par Eugenia (§8.1). */
import { useState } from "react";
import { Lightbulb, Plus } from "lucide-react";
import {
  ancestors,
  createPage,
  descendants,
  knowledgeUnder,
  type WikiNode,
} from "@openeugenia/core";
import { taskContext } from "../lib/ai.ts";
import { errorMessage, toast } from "../store/ui.ts";
import { useWiki } from "../store/wiki.ts";
import { Spinner } from "./common.tsx";

interface Suggestion {
  title: string;
  reason: string;
}

export function CategorySuggestions({ node }: { node: WikiNode }) {
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);

  const suggest = async (): Promise<void> => {
    const derived = useWiki.getState().derived;
    if (!derived) return;
    setBusy(true);
    try {
      const tree = derived.tree;
      const involvesPrivate = !node.isPublic || descendants(tree, node.id).some((d) => !d.isPublic);
      const context = await taskContext(involvesPrivate);
      const { suggestCategories } = await import("@openeugenia/ai");
      const children = node.childIds.map((id) => tree.nodes.get(id)!);
      const result = await suggestCategories(context, {
        category: node.title,
        path: ancestors(tree, node.id).map((a) => a.title),
        subcategories: children.filter((c) => c.type === "category").map((c) => c.title),
        samples: knowledgeUnder(tree, node.id)
          .slice(0, 20)
          .map((c) => c.description ?? c.title),
      });
      setSuggestions(result);
      if (result.length === 0) toast("Eugenia ne propose pas de nouvelle sous-catégorie.");
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const create = async (suggestion: Suggestion): Promise<void> => {
    const { workspace, stage } = useWiki.getState();
    if (!workspace) return;
    try {
      const created = createPage(workspace, {
        parentPath: node.path,
        parentIsPublic: node.isPublic,
        title: suggestion.title,
      });
      await stage([created.change], `Créer la catégorie « ${suggestion.title} »`);
      setSuggestions((list) => list?.filter((s) => s !== suggestion) ?? null);
      toast(`Catégorie « ${suggestion.title} » créée (en attente d'enregistrement).`, "success");
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  };

  return (
    <div>
      <button
        type="button"
        className="oe-button oe-button--ghost oe-button--sm"
        disabled={busy}
        onClick={() => void suggest()}
      >
        {busy ? <Spinner small label="Eugenia réfléchit" /> : <Lightbulb aria-hidden="true" />}{" "}
        Suggérer des sous-catégories
      </button>
      {suggestions && suggestions.length > 0 && (
        <ul className="link-list" style={{ marginTop: "0.75rem" }}>
          {suggestions.map((s) => (
            <li key={s.title}>
              <strong>{s.title}</strong>
              <span className="muted small">{s.reason}</span>
              <button
                type="button"
                className="oe-button oe-button--ghost oe-button--sm"
                onClick={() => void create(s)}
              >
                <Plus aria-hidden="true" /> Créer
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
