import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

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
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ auRecipe: state.auRecipe }),
    },
  ),
);