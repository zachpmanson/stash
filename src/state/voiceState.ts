import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Speech from "expo-speech";
import type { VoiceMode } from "../utils/readability";

const DEFAULT_VOICE = "en-au-x-aub-network";
// Pre-seeded second voice so quoted text is audibly distinct out of the box.
const DEFAULT_QUOTE_VOICE = "en-gb-x-rjs-network";

type State = {
  voices: Speech.Voice[];
  selectedVoice: string;
  quoteVoice: string;
  loaded: boolean;
};

type Actions = {
  loadVoices: () => Promise<void>;
  setSelectedVoice: (id: string) => void;
  setQuoteVoice: (id: string) => void;
  setVoiceFor: (mode: VoiceMode, id: string) => void;
};

export const useVoiceStore = create<State & Actions>()(
  persist(
    (set, get) => ({
      voices: [],
      selectedVoice: DEFAULT_VOICE,
      quoteVoice: DEFAULT_QUOTE_VOICE,
      loaded: false,

      loadVoices: async () => {
        if (get().loaded) return;
        const voices = await Speech.getAvailableVoicesAsync();
        set({ voices, loaded: true });
      },

      setSelectedVoice: (id) => set({ selectedVoice: id }),
      setQuoteVoice: (id) => set({ quoteVoice: id }),
      setVoiceFor: (mode, id) =>
        set(mode === "quote" ? { quoteVoice: id } : { selectedVoice: id }),
    }),
    {
      name: "voice-state",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        selectedVoice: state.selectedVoice,
        quoteVoice: state.quoteVoice,
      }),
    },
  ),
);
