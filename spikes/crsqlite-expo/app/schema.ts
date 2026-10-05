// This disposable candidate schema must match server/schema.ts exactly.
import { cryb64 } from "@vlcn.io/ws-common";

export const SCHEMA_NAME = "stash-spike.sql";
export const SCHEMA_SQL =
  "CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL DEFAULT '');\n" +
  "SELECT crsql_as_crr('notes');\n";
export const SCHEMA_VERSION = cryb64(SCHEMA_SQL);
export const DATABASE_ROOM = "stash-spike.sqlite";
