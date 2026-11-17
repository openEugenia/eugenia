import { create } from "zustand";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from "../lib/settings.ts";

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  load(): Promise<void>;
  update(change: (settings: Settings) => Settings): Promise<void>;
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  async load() {
    set({ settings: await loadSettings(), loaded: true });
  },
  async update(change) {
    const settings = change(get().settings);
    set({ settings });
    await saveSettings(settings);
  },
}));
