import { create } from "zustand";

type ListenSession = {
  activeItemId: string | null;
  lastItemId: string | null;
  lastIndex: number;
  setActiveItemId: (id: string | null) => void;
  rememberIndex: (itemId: string, index: number) => void;
  getRememberedIndex: (itemId: string) => number;
};

export const useListenSession = create<ListenSession>((set, get) => ({
  activeItemId: null,
  lastItemId: null,
  lastIndex: 0,
  setActiveItemId: (id) => set({ activeItemId: id }),
  rememberIndex: (itemId, index) => set({ lastItemId: itemId, lastIndex: index }),
  getRememberedIndex: (itemId) => (get().lastItemId === itemId ? get().lastIndex : 0),
}));

export const getActiveListenItemId = () => useListenSession.getState().activeItemId;
