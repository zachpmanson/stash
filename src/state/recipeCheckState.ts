import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Persisted checked state for recipe ingredients, keyed by item id.
 * Values are ingredient indices (position in recipe.recipeIngredient).
 */
type State = {
  checked: Record<string, number[]>;
};

type Actions = {
  toggleChecked: (itemId: string, index: number) => void;
  resetRecipe: (itemId: string) => void;
};

export const useRecipeCheckStore = create<State & Actions>()(
  persist(
    (set) => ({
      checked: {},
      toggleChecked: (itemId, index) =>
        set((state) => {
          const current = state.checked[itemId] ?? [];
          const next = current.includes(index)
            ? current.filter((i) => i !== index)
            : [...current, index].sort((a, b) => a - b);
          return { checked: { ...state.checked, [itemId]: next } };
        }),
      resetRecipe: (itemId) =>
        set((state) => {
          if (!state.checked[itemId]?.length) return state;
          const { [itemId]: _removed, ...rest } = state.checked;
          return { checked: rest };
        }),
    }),
    {
      name: "recipe-check-state",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ checked: state.checked }),
    },
  ),
);