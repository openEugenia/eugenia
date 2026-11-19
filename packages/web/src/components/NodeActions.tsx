/** Déplacement, suppression et visibilité d'une page, avec les confirmations de §6.2 et §9.3. */
import { useState } from "react";
import {
  applyVisibility,
  deleteNode,
  descendants,
  makePrivateAssignments,
  makePublicAssignments,
  moveNode,
  planMakePublic,
  type WikiNode,
} from "@openeugenia/core";
import { navigate } from "../lib/router.ts";
import { confirmDialog, errorMessage, toast } from "../store/ui.ts";
import { useWiki } from "../store/wiki.ts";
import { Modal } from "./Modal.tsx";

/** Déplace une page sous un nouveau parent, après confirmation. */
export async function moveWithConfirmation(nodeId: string, parentId: string): Promise<void> {
  const { workspace, stage } = useWiki.getState();
  if (!workspace?.derived) return;
  const tree = workspace.tree;
  const node = tree.nodes.get(nodeId);
  const parent = tree.nodes.get(parentId);
  if (!node || !parent) return;
  const publicCount = [node, ...descendants(tree, nodeId)].filter((n) => n.isPublic).length;
  const ok = await confirmDialog({
    title: "Déplacer la page",
    body: (
      <>
        <p>
          Déplacer « {node.title} » sous « {parent.title} » ? Son identifiant est conservé et les
          liens qui pointent vers elle sont réécrits.
        </p>
        {!parent.isPublic && publicCount > 0 && (
          <p className="oe-alert oe-alert--warning" style={{ marginTop: "0.75rem" }}>
            « {parent.title} » est privé : {publicCount} page(s) publique(s) de la branche
            deviendront privées.
          </p>
        )}
      </>
    ),
    confirmLabel: "Déplacer",
  });
  if (!ok) return;
  try {
    await workspace.prefetchMarkdown();
    const changes = await moveNode(workspace, nodeId, parentId);
    await stage(changes, `Déplacer « ${node.title} » sous « ${parent.title} »`);
    toast("Page déplacée (en attente d'enregistrement).", "success");
  } catch (error) {
    toast(errorMessage(error), "error");
  }
}

export function DeleteDialog({
  node,
  open,
  onClose,
}: {
  node: WikiNode;
  open: boolean;
  onClose(): void;
}) {
  const workspace = useWiki((s) => s.workspace);
  const stage = useWiki((s) => s.stage);
  const [recursive, setRecursive] = useState(false);
  const count = workspace?.derived ? descendants(workspace.tree, node.id).length : 0;
  const remove = async (): Promise<void> => {
    if (!workspace) return;
    try {
      await workspace.prefetchMarkdown();
      const changes = await deleteNode(workspace, node.id, { recursive });
      await stage(changes, `Supprimer « ${node.title} »${count ? ` et ${count} page(s)` : ""}`);
      onClose();
      navigate({ name: "node", id: node.parentId ?? workspace.tree.rootId });
      toast("Page supprimée (en attente d'enregistrement).", "success");
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  };
  return (
    <Modal title="Supprimer la page" open={open} onClose={onClose}>
      <p>
        Supprimer « {node.title} » ? Les liens qui pointent vers elle deviendront du texte simple.
        Tant que la modification n'est pas enregistrée, vous pouvez l'annuler depuis la liste des
        modifications.
      </p>
      {count > 0 && (
        <label className="check">
          <input
            type="checkbox"
            checked={recursive}
            onChange={(e) => setRecursive(e.target.checked)}
          />
          <span>
            Supprimer aussi les <strong>{count}</strong> page(s) de cette branche (suppression
            récursive).
          </span>
        </label>
      )}
      <div className="actions">
        <button type="button" className="oe-button oe-button--ghost" onClick={onClose}>
          Annuler
        </button>
        <button
          type="button"
          className="oe-button"
          style={{ background: "var(--oe-color-danger)" }}
          disabled={count > 0 && !recursive}
          onClick={() => void remove()}
        >
          Supprimer
        </button>
      </div>
    </Modal>
  );
}

/** Changement de visibilité selon les règles 3 à 5 de §6.2. */
export function VisibilityDialog({
  node,
  open,
  onClose,
}: {
  node: WikiNode;
  open: boolean;
  onClose(): void;
}) {
  const workspace = useWiki((s) => s.workspace);
  const stage = useWiki((s) => s.stage);
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [confirmAncestors, setConfirmAncestors] = useState(false);
  if (!workspace?.derived) return null;
  const tree = workspace.tree;
  const makingPublic = !node.isPublic;
  const plan = planMakePublic(tree, node.id);
  // Les flashcards suivent leur connaissance : elles ne se cochent pas une à une.
  const listed = plan.descendants.filter((d) => d.type !== "flashcard");
  const publicDescendants = descendants(tree, node.id).filter((d) => d.isPublic);

  const toggle = (id: string, checked: boolean): void => {
    setIncluded((prev) => {
      const next = new Set(prev);
      const target = tree.nodes.get(id)!;
      if (checked) {
        next.add(id);
        // Un descendant inclus implique ses ancêtres dans la branche.
        let parentId = target.parentId;
        while (parentId && parentId !== node.id) {
          next.add(parentId);
          parentId = tree.nodes.get(parentId)?.parentId ?? null;
        }
      } else {
        next.delete(id);
        for (const d of descendants(tree, id)) next.delete(d.id);
      }
      return next;
    });
  };

  const apply = async (): Promise<void> => {
    try {
      const withCards = new Set(included);
      for (const d of plan.descendants) {
        if (d.type === "flashcard" && (d.parentId === node.id || withCards.has(d.parentId ?? "")))
          withCards.add(d.id);
      }
      const assignments = makingPublic
        ? makePublicAssignments(tree, node.id, withCards, confirmAncestors)
        : makePrivateAssignments(tree, node.id);
      if (assignments.size === 0) {
        toast("Aucun changement de visibilité.");
        onClose();
        return;
      }
      const changes = await applyVisibility(workspace, assignments);
      await stage(
        changes,
        makingPublic ? `Rendre public « ${node.title} »` : `Rendre privé « ${node.title} »`,
      );
      toast(
        makingPublic
          ? "Page rendue publique (en attente d'enregistrement)."
          : "Page rendue privée (en attente d'enregistrement).",
        "success",
      );
      onClose();
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  };

  return (
    <Modal
      title={makingPublic ? "Rendre la page publique" : "Rendre la page privée"}
      open={open}
      onClose={onClose}
      wide
    >
      {makingPublic ? (
        <>
          <p>
            Une page publique est publiée dans votre dépôt public et visible par tous. Les fichiers
            personnels de ses sources ne sont jamais publiés.
          </p>
          {plan.privateAncestors.length > 0 && (
            <div className="oe-alert oe-alert--warning">
              <strong className="oe-alert__title">
                Une page publique ne peut pas avoir d'ancêtre privé
              </strong>
              <p>Pour publier « {node.title} », ces pages doivent aussi devenir publiques :</p>
              <ul>
                {plan.privateAncestors.map((a) => (
                  <li key={a.id}>{a.title}</li>
                ))}
              </ul>
              <label className="check">
                <input
                  type="checkbox"
                  checked={confirmAncestors}
                  onChange={(e) => setConfirmAncestors(e.target.checked)}
                />
                <span>Je rends aussi publiques ces {plan.privateAncestors.length} page(s).</span>
              </label>
            </div>
          )}
          {plan.descendants.some((d) => d.type === "flashcard") && (
            <p className="muted small">
              Les flashcards suivent la visibilité de leur connaissance.
            </p>
          )}
          {listed.length > 0 && (
            <fieldset className="oe-field" style={{ border: 0, padding: 0 }}>
              <legend className="oe-label">
                Pages de la branche à inclure (les autres restent privées)
              </legend>
              <div className="actions actions--start">
                <button
                  type="button"
                  className="oe-button oe-button--ghost oe-button--sm"
                  onClick={() => setIncluded(new Set(listed.map((d) => d.id)))}
                >
                  Tout inclure
                </button>
                <button
                  type="button"
                  className="oe-button oe-button--ghost oe-button--sm"
                  onClick={() => setIncluded(new Set())}
                >
                  Aucune
                </button>
              </div>
              <div
                style={{ maxHeight: "16rem", overflow: "auto", display: "grid", gap: "0.35rem" }}
              >
                {listed.map((d) => (
                  <label
                    key={d.id}
                    className="check"
                    style={{ paddingLeft: `${(d.depth - node.depth - 1) * 1.25}rem` }}
                  >
                    <input
                      type="checkbox"
                      checked={included.has(d.id)}
                      onChange={(e) => toggle(d.id, e.target.checked)}
                    />
                    <span>{d.title}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </>
      ) : (
        <>
          <p>« {node.title} » ne sera plus publié. Sa branche entière devient privée.</p>
          {publicDescendants.length > 0 && (
            <div className="oe-alert oe-alert--warning">
              <p>Ces {publicDescendants.length} page(s) publiques deviendront privées :</p>
              <ul>
                {publicDescendants.slice(0, 30).map((d) => (
                  <li key={d.id}>{d.title}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <div className="actions">
        <button type="button" className="oe-button oe-button--ghost" onClick={onClose}>
          Annuler
        </button>
        <button
          type="button"
          className="oe-button"
          disabled={makingPublic && plan.privateAncestors.length > 0 && !confirmAncestors}
          onClick={() => void apply()}
        >
          {makingPublic ? "Rendre public" : "Rendre privé"}
        </button>
      </div>
    </Modal>
  );
}
