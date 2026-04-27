import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Speech from "expo-speech";

const DEFAULT_VOICE = "en-au-x-aub-network";

type State = {
  voices: Speech.Voice[];
  selectedVoice: string;
  loaded: boolean;
};

type Actions = {
  loadVoices: () => Promise<void>;
  setSelectedVoice: (id: string) => void;
};

export const useVoiceStore = create<State & Actions>()(
  persist(
    (set, get) => ({
      voices: [],
      selectedVoice: DEFAULT_VOICE,
      loaded: false,

      loadVoices: async () => {
        if (get().loaded) return;
        const voices = await Speech.getAvailableVoicesAsync();
        set({ voices, loaded: true });
      },

      setSelectedVoice: (id) => set({ selectedVoice: id }),
    }),
    {
      name: "voice-state",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ selectedVoice: state.selectedVoice }),
    },
  ),
);
