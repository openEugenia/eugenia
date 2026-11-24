/** Moving, deleting and changing the visibility of a page, with the confirmations of §6.2 and §9.3. */
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

/** Moves a page under a new parent, after confirmation. */
export async function moveWithConfirmation(nodeId: string, parentId: string): Promise<void> {
  const { workspace, stage } = useWiki.getState();
  if (!workspace?.derived) return;
  const tree = workspace.tree;
  const node = tree.nodes.get(nodeId);
  const parent = tree.nodes.get(parentId);
  if (!node || !parent) return;
  const publicCount = [node, ...descendants(tree, nodeId)].filter((n) => n.isPublic).length;
  const ok = await confirmDialog({
    title: "Move the page",
    body: (
      <>
        <p>
          Move "{node.title}" under "{parent.title}"? Its identifier is kept and the links that
          point to it are rewritten.
        </p>
        {!parent.isPublic && publicCount > 0 && (
          <p className="oe-alert oe-alert--warning" style={{ marginTop: "0.75rem" }}>
            "{parent.title}" is private: {publicCount} public page(s) of the branch will become
            private.
          </p>
        )}
      </>
    ),
    confirmLabel: "Move",
  });
  if (!ok) return;
  try {
    await workspace.prefetchMarkdown();
    const changes = await moveNode(workspace, nodeId, parentId);
    await stage(changes, `Move "${node.title}" under "${parent.title}"`);
    toast("Page moved (waiting to be saved).", "success");
  } catch (error) {
    toast(errorMessage(error), "error");
  }
}

export function DeleteDialog({
  node,
  open,
  onClose,
  stay = false,
}: {
  node: WikiNode;
  open: boolean;
  onClose(): void;
  /** Stay on the current view once the page is deleted (otherwise: go to its parent). */
  stay?: boolean;
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
      await stage(changes, `Delete "${node.title}"${count ? ` and ${count} page(s)` : ""}`);
      onClose();
      if (!stay) navigate({ name: "node", id: node.parentId ?? workspace.tree.rootId });
      toast("Page deleted (waiting to be saved).", "success");
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  };
  return (
    <Modal title="Delete the page" open={open} onClose={onClose}>
      <p>
        Delete "{node.title}"? The links that point to it will become plain text. Until the change
        is saved, you can undo it from the list of changes.
      </p>
      {count > 0 && (
        <label className="check">
          <input
            type="checkbox"
            checked={recursive}
            onChange={(e) => setRecursive(e.target.checked)}
          />
          <span>
            Also delete the <strong>{count}</strong> page(s) of this branch (recursive deletion).
          </span>
        </label>
      )}
      <div className="actions">
        <button type="button" className="oe-button oe-button--ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="oe-button"
          style={{ background: "var(--oe-color-danger)" }}
          disabled={count > 0 && !recursive}
          onClick={() => void remove()}
        >
          Delete
        </button>
      </div>
    </Modal>
  );
}

/** Visibility change following rules 3 to 5 of §6.2. */
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
  // Flashcards follow their knowledge item: they are not checked one by one.
  const listed = plan.descendants.filter((d) => d.type !== "flashcard");
  const publicDescendants = descendants(tree, node.id).filter((d) => d.isPublic);

  const toggle = (id: string, checked: boolean): void => {
    setIncluded((prev) => {
      const next = new Set(prev);
      const target = tree.nodes.get(id)!;
      if (checked) {
        next.add(id);
        // An included descendant implies its ancestors in the branch.
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
        toast("No visibility change.");
        onClose();
        return;
      }
      const changes = await applyVisibility(workspace, assignments);
      await stage(
        changes,
        makingPublic ? `Make "${node.title}" public` : `Make "${node.title}" private`,
      );
      toast(
        makingPublic
          ? "Page made public (waiting to be saved)."
          : "Page made private (waiting to be saved).",
        "success",
      );
      onClose();
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  };

  return (
    <Modal
      title={makingPublic ? "Make the page public" : "Make the page private"}
      open={open}
      onClose={onClose}
      wide
    >
      {makingPublic ? (
        <>
          <p>
            A public page is published to your public repository and visible to everyone. The
            personal files of sources are never published.
          </p>
          {plan.privateAncestors.length > 0 && (
            <div className="oe-alert oe-alert--warning">
              <strong className="oe-alert__title">
                A public page cannot have a private ancestor
              </strong>
              <p>To publish "{node.title}", these pages must become public too:</p>
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
                <span>I also make these {plan.privateAncestors.length} page(s) public.</span>
              </label>
            </div>
          )}
          {plan.descendants.some((d) => d.type === "flashcard") && (
            <p className="muted small">Flashcards follow the visibility of their knowledge item.</p>
          )}
          {listed.length > 0 && (
            <fieldset className="oe-field" style={{ border: 0, padding: 0 }}>
              <legend className="oe-label">
                Pages of the branch to include (the others stay private)
              </legend>
              <div className="actions actions--start">
                <button
                  type="button"
                  className="oe-button oe-button--ghost oe-button--sm"
                  onClick={() => setIncluded(new Set(listed.map((d) => d.id)))}
                >
                  Include all
                </button>
                <button
                  type="button"
                  className="oe-button oe-button--ghost oe-button--sm"
                  onClick={() => setIncluded(new Set())}
                >
                  None
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
          {node.type === "source" ? (
            <p>
              The content of "{node.title}" will no longer be published. Its bibliographic record
              (title, kind, authors, date, URL) stays public, so that public knowledge can still
              cite it.
            </p>
          ) : (
            <p>"{node.title}" will no longer be published. Its whole branch becomes private.</p>
          )}
          {publicDescendants.length > 0 && (
            <div className="oe-alert oe-alert--warning">
              <p>These {publicDescendants.length} public page(s) will become private:</p>
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
          Cancel
        </button>
        <button
          type="button"
          className="oe-button"
          disabled={makingPublic && plan.privateAncestors.length > 0 && !confirmAncestors}
          onClick={() => void apply()}
        >
          {makingPublic ? "Make public" : "Make private"}
        </button>
      </div>
    </Modal>
  );
}
