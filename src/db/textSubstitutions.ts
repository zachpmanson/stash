import { TextSubstitution } from "../types";
import { randomId } from "../utils/randomId";
import { getDb } from "./database";

export async function getTextSubstitutions(): Promise<TextSubstitution[]> {
  const db = await getDb();
  return db.getAllAsync<TextSubstitution>(
    "SELECT id, find, replace, case_sensitive, created_at FROM text_substitutions ORDER BY find DESC",
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

export async function updateTextSubstitution(
  id: string,
  find: string,
  replace: string,
  caseSensitive: boolean,
): Promise<void> {
  const db = await getDb();
  const cs: 0 | 1 = caseSensitive ? 1 : 0;
  await db.runAsync("UPDATE text_substitutions SET find = ?, replace = ?, case_sensitive = ? WHERE id = ?", [
    find,
    replace,
    cs,
    id,
  ]);
}

export async function deleteTextSubstitution(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM text_substitutions WHERE id = ?", [id]);
}
