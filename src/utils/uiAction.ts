import { showModal } from "../state/modalState";

export function showActionError(error: unknown): void {
  showModal({ title: "Action not completed", message: error instanceof Error ? error.message : String(error) });
}

/** Event boundaries must consume expected read-only rejections (including races). */
export async function runUiAction(action: () => void | Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    showActionError(error);
  }
}
