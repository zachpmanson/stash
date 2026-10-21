import { cryb64 } from "@vlcn.io/ws-common";
import { STASH_SCHEMA_SQL } from "./stashSchema";

export const SCHEMA_NAME = "stash-sync-v1.sql";
export const SCHEMA_SQL = STASH_SCHEMA_SQL;
export const SCHEMA_VERSION = cryb64(SCHEMA_SQL);
// New room keeps this disposable schema/database separate from the older notes spike.
export const DATABASE_ROOM = "stash-backend";
