import { create } from "zustand";

export type SnackbarVariant = "info" | "success" | "error";

type Snackbar = {
  id: number;
  message: string;
  variant: SnackbarVariant;
};

type State = {
  current: Snackbar | null;
};

type Actions = {
  show: (message: string, variant?: SnackbarVariant) => void;
  hide: () => void;
};

let nextId = 1;

export const useSnackbarStore = create<State & Actions>((set) => ({
  current: null,
  show: (message, variant = "info") =>
    set({ current: { id: nextId++, message, variant } }),
  hide: () => set({ current: null }),
}));

export const showSnackbar = (message: string, variant?: SnackbarVariant) =>
  useSnackbarStore.getState().show(message, variant);
