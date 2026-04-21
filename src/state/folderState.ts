import { create } from "zustand";
import { Folder } from "src/types";
import { getFolders } from "src/db/folders";

type State = {
  folders: Folder[];
};

type Actions = {
  refresh: () => Promise<void>;
};

export const useFolderStore = create<State & Actions>((set) => ({
  folders: [],

  refresh: async () => {
    const fs = await getFolders();
    set((state) => ({
      folders: fs,
    }));
  },
}));
