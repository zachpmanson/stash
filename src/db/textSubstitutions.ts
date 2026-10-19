import { TextSubstitution } from "../types";
import { randomId } from "../utils/randomId";
import { withAppDb } from "./database";
import { mirrorLocalSubstitutionOwned } from "./syncReplica";

export async function getTextSubstitutions(): Promise<TextSubstitution[]> {
  return withAppDb(async (db) => {
    return db.getAllAsync<TextSubstitution>(
      "SELECT id, find, replace, case_sensitive, created_at FROM text_substitutions ORDER BY find DESC",
    );
  });
}

export async function createTextSubstitution(
  find: string,
  replace: string,
  caseSensitive: boolean,
): Promise<TextSubstitution> {
  return withAppDb(async (db) => {
    const id = randomId();
    const now = Date.now();
    const cs: 0 | 1 = caseSensitive ? 1 : 0;
    await db.withTransactionAsync( async () => {
      await db.runAsync(
        "INSERT INTO text_substitutions (id, find, replace, case_sensitive, created_at) VALUES (?, ?, ?, ?, ?)",
        [id, find, replace, cs, now],
      );
      await mirrorLocalSubstitutionOwned(db, id);
    });
    return { id, find, replace, case_sensitive: cs, created_at: now };
  });
}

export async function updateTextSubstitution(
  id: string,
  find: string,
  replace: string,
  caseSensitive: boolean,
): Promise<void> {
  return withAppDb(async (db) => {
    const cs: 0 | 1 = caseSensitive ? 1 : 0;
    await db.withTransactionAsync( async () => {
      await db.runAsync("UPDATE text_substitutions SET find = ?, replace = ?, case_sensitive = ? WHERE id = ?", [
        find,
        replace,
        cs,
        id,
      ]);
      await mirrorLocalSubstitutionOwned(db, id);
    });
  });
}

export async function deleteTextSubstitution(id: string): Promise<void> {
  return withAppDb(async (db) => {
    await db.withTransactionAsync( async () => {
      await db.runAsync("DELETE FROM text_substitutions WHERE id = ?", [id]);
      await mirrorLocalSubstitutionOwned(db, id);
    });
  });
}
