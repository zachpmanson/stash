import { getDb } from "./database";
import { TextSubstitution } from "../types";
import { randomId } from "../utils/randomId";

export async function getTextSubstitutions(): Promise<TextSubstitution[]> {
  const db = await getDb();
  return db.getAllAsync<TextSubstitution>(
    "SELECT id, find, replace, case_sensitive, created_at FROM text_substitutions ORDER BY created_at DESC",
  );
}

export async function createTextSubstitution(
  find: string,
  replace: string,
  caseSensitive: boolean,
): Promise<TextSubstitution> {
  const db = await getDb();
  const id = randomId();
  const now = Date.now();
  const cs: 0 | 1 = caseSensitive ? 1 : 0;
  await db.runAsync(
    "INSERT INTO text_substitutions (id, find, replace, case_sensitive, created_at) VALUES (?, ?, ?, ?, ?)",
    [id, find, replace, cs, now],
  );
  return { id, find, replace, case_sensitive: cs, created_at: now };
}

export async function deleteTextSubstitution(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM text_substitutions WHERE id = ?", [id]);
}
