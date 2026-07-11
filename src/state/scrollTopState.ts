import { create } from "zustand";

type ScrollTopState = {
  handler: (() => void) | null;
  setHandler: (fn: (() => void) | null) => void;
};

export const useScrollTopState = create<ScrollTopState>((set) => ({
  handler: null,
  setHandler: (fn) => set({ handler: fn }),
}));

export function triggerScrollToTop() {
  useScrollTopState.getState().handler?.();
}
