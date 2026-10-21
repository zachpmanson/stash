import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { withAppDb } from "../db/database";
import { mirrorAuRecipeSetting } from "../db/syncReplica";

type State = {
  /** Convert US/UK recipe ingredients to Australian English. */
  auRecipe: boolean;
};

type Actions = {
  setAuRecipe: (enabled: boolean) => void;
};

export const useSettingsStore = create<State & Actions>()(
  persist(
    (set) => ({
      auRecipe: false,
      setAuRecipe: (enabled) => set({ auRecipe: enabled }),
    }),
    {
      name: "settings-state",
      skipHydration: true,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ auRecipe: state.auRecipe }),
    },
  ),
);

let initialization: Promise<void> | undefined;

/** Run once at startup, after AsyncStorage hydration. Read/apply under the DB
 * ownership lock so a newer projection or offline edit cannot be overwritten. */
export function initializeSettingsFromDatabase(): Promise<void> {
  if (!initialization) {
    initialization = (async () => {
      await useSettingsStore.persist.rehydrate();
      if (!useSettingsStore.persist.hasHydrated()) throw new Error("Could not hydrate Stash settings. Please retry.");
      await withAppDb(async (db) => {
        const table = await db.getFirstAsync<{ present: number }>("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name = 'stash_sync_metadata') AS present");
        if (!table?.present) return;
        const setting = await db.getFirstAsync<{ value: string }>("SELECT value FROM stash_sync_metadata WHERE key = 'projected_au_recipe'");
        if (setting) useSettingsStore.getState().setAuRecipe(setting.value === "1");
      });
    })().catch((error) => { initialization = undefined; throw error; });
  }
  return initialization;
}

export async function changeAuRecipeSetting(enabled: boolean): Promise<void> {
  await initializeSettingsFromDatabase();
  await mirrorAuRecipeSetting(enabled, () => useSettingsStore.getState().setAuRecipe(enabled));
}
