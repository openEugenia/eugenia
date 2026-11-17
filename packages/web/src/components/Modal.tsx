import { useEffect, useRef, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { useUI } from "../store/ui.ts";

interface ModalProps {
  title: string;
  open: boolean;
  onClose(): void;
  children: ReactNode;
  wide?: boolean;
}

/** Boîte de dialogue modale (élément `<dialog>` natif). */
export function Modal({ title, open, onClose, children, wide = false }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`modal${wide ? " modal--wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-label={title}
    >
      {open && (
        <div className="modal__body">
          <div className="modal__head">
            <h2>{title}</h2>
            <button
              type="button"
              className="oe-button oe-button--ghost oe-button--sm icon-only"
              onClick={onClose}
              aria-label="Fermer"
            >
              <X />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

/** Affiche les demandes de confirmation du magasin d'interface. */
export function DialogHost() {
  const dialogs = useUI((s) => s.dialogs);
  const close = useUI((s) => s.closeDialog);
  const dialog = dialogs[0];
  if (!dialog) return null;
  return (
    <Modal title={dialog.title} open onClose={() => close(dialog.id, false)}>
      <div>{dialog.body}</div>
      <div className="actions">
        <button
          type="button"
          className="oe-button oe-button--ghost"
          onClick={() => close(dialog.id, false)}
        >
          {dialog.cancelLabel ?? "Annuler"}
        </button>
        <button
          type="button"
          className="oe-button"
          style={dialog.danger ? { background: "var(--oe-color-danger)" } : undefined}
          onClick={() => close(dialog.id, true)}
          autoFocus
        >
          {dialog.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function Toasts() {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismiss);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast oe-alert oe-alert--${t.kind === "error" ? "danger" : t.kind === "success" ? "success" : "info"}`}
        >
          {t.kind === "error" ? (
            <AlertTriangle aria-hidden="true" />
          ) : t.kind === "success" ? (
            <CheckCircle2 aria-hidden="true" />
          ) : (
            <Info aria-hidden="true" />
          )}
          <span style={{ flex: 1 }}>{t.message}</span>
          <button
            type="button"
            className="oe-button oe-button--ghost oe-button--sm icon-only"
            onClick={() => dismiss(t.id)}
            aria-label="Fermer"
          >
            <X />
          </button>
        </div>
      ))}
    </div>
  );
}
