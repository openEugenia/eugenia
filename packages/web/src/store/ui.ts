/** Notifications and dialogs (confirmation, choice). */
import type { ReactNode } from "react";
import { create } from "zustand";

export interface Toast {
  id: number;
  kind: "info" | "success" | "error";
  message: string;
}

export interface DialogRequest {
  id: number;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  resolve(value: boolean): void;
}

interface UIState {
  toasts: Toast[];
  dialogs: DialogRequest[];
  toast(message: string, kind?: Toast["kind"]): void;
  dismiss(id: number): void;
  confirm(
    options: Omit<DialogRequest, "id" | "resolve" | "confirmLabel"> & { confirmLabel?: string },
  ): Promise<boolean>;
  closeDialog(id: number, value: boolean): void;
}

let nextId = 1;

export const useUI = create<UIState>((set, get) => ({
  toasts: [],
  dialogs: [],
  toast(message, kind = "info") {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    setTimeout(() => get().dismiss(id), kind === "error" ? 9000 : 4500);
  },
  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
  confirm(options) {
    return new Promise<boolean>((resolve) => {
      const id = nextId++;
      set((s) => ({
        dialogs: [...s.dialogs, { confirmLabel: "Confirm", ...options, id, resolve }],
      }));
    });
  },
  closeDialog(id, value) {
    const dialog = get().dialogs.find((d) => d.id === id);
    dialog?.resolve(value);
    set((s) => ({ dialogs: s.dialogs.filter((d) => d.id !== id) }));
  },
}));

export const toast = (message: string, kind?: Toast["kind"]): void =>
  useUI.getState().toast(message, kind);
export const confirmDialog = (options: Parameters<UIState["confirm"]>[0]): Promise<boolean> =>
  useUI.getState().confirm(options);

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
