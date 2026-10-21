import type { Hono } from "hono";
import type { attachWebsocketServer } from "@vlcn.io/ws-server";
import { DATABASE_ROOM, SCHEMA_NAME } from "../schema.js";
import { FeedError, renderFeed } from "./feeds.js";

export function installFeedRoutes(app: Hono, cache: ReturnType<typeof attachWebsocketServer>, authUser: string, base: string | null) {
  app.use("/feeds/*", async (c, next) => {
    c.header("Cache-Control", "private, no-cache");
    c.header("Vary", "Authorization");
    c.header("X-Content-Type-Options", "nosniff");
    // Identity before path/existence/cache tests. Caddy alone checks passwords.
    if (c.req.header("X-Auth-User") !== authUser) return c.json({ error: "Unauthorized" }, 401);
    await next();
  });
  app.get("/feeds/folders/:file", async (c) => {
    const file = c.req.param("file");
    if (!file.endsWith(".atom")) return c.notFound();
    const id = file.slice(0, -5);
    if (!id || id.length > 200 || id.includes("\0") || Object.keys(c.req.query()).length) return c.json({ error: "Invalid request" }, 400);
    try {
      let result!: ReturnType<typeof renderFeed>;
      await cache.use(DATABASE_ROOM, SCHEMA_NAME, async (peer) => {
        const db = peer.getDB();
        result = db.transaction(() => renderFeed(db, id, base))();
      });
      c.header("ETag", result.etag);
      c.header("Last-Modified", result.modified);
      // ETags preserve sub-second changes. Do not rely on date-only validators.
      const tags = c.req.header("If-None-Match")?.split(",").map((tag) => tag.trim().replace(/^W\//, ""));
      if (tags?.includes(result.etag) || tags?.includes("*")) return c.body(null, 304);
      return c.body(result.xml, 200, { "Content-Type": "application/atom+xml; charset=utf-8" });
    } catch (error) {
      if (error instanceof FeedError) return c.json({ error: error.message }, error.status);
      return c.json({ error: "Request failed" }, 500);
    }
  });
  app.all("/feeds/*", (c) => c.notFound());
}
