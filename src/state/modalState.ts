import { create } from "zustand";

export type ModalButtonStyle = "default" | "cancel" | "destructive";

export type ModalButton = {
  text: string;
  style?: ModalButtonStyle;
  onPress?: () => void | Promise<void>;
};

export type ModalConfig = {
  title: string;
  message?: string;
  buttons?: ModalButton[];
};

type ModalEntry = ModalConfig & { id: number };

type State = {
  current: ModalEntry | null;
};

type Actions = {
  show: (config: ModalConfig) => void;
  dismiss: () => void;
};

let nextId = 1;

export const useModalStore = create<State & Actions>((set) => ({
  current: null,
  show: (config) => set({ current: { id: nextId++, ...config } }),
  dismiss: () => set({ current: null }),
}));

export const showModal = (config: ModalConfig) =>
  useModalStore.getState().show(config);
