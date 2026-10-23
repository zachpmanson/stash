import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";
import { launch } from "./web-helpers.mjs";

const source = await readFile(new URL("../web/favicon.svg", import.meta.url), "utf8");
test("favicon is packaged true vector, circular and faithfully traces the mobile strokes", async () => {
  assert.equal(await readFile(new URL("../dist/public/favicon.svg", import.meta.url), "utf8"), source);
  assert.match(source, /viewBox="0 0 500 500"/);
  assert.match(source, /<circle cx="250" cy="250" r="250" fill="white"\/>/);
  // Original assets/icon.png strokes: (240,240)-(480,210), then y=300/360/420/480.
  // Same geometry translated (-80,-95); no launcher background or extra padding.
  assert.match(source, /M160 145 400 115 M160 205H400 M100 265H340 M160 325H400 M130 385H370/);
  assert.doesNotMatch(source, /<(?:image|script|foreignObject|style|use|text)\b|\bon\w+\s*=|href\s*=|data:|base64|url\(|@font/i);
  assert.deepEqual([...source.matchAll(/<([a-zA-Z]+)\b/g)].map(m => m[1]), ["svg", "circle", "path"]);
  for (const size of [16, 32, 48]) {
    const { data, info } = await sharp(Buffer.from(source)).resize(size, size).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixel = (x, y) => [...data.subarray((y * size + x) * info.channels, (y * size + x) * info.channels + 4)];
    for (const [x, y] of [[0, 0], [size - 1, 0], [0, size - 1], [size - 1, size - 1]]) assert.equal(pixel(x, y)[3], 0);
    assert.deepEqual(pixel(size / 2, Math.floor(size * .12)), [255, 255, 255, 255]);
    assert.ok(pixel(Math.floor(size * .5), Math.floor(size * .41))[0] < 140, `visible black mark at ${size}px`);
  }
});

test("only approved SVG route is served behind existing auth/cache/CSP policy", async t => {
  const { base } = await launch(t);
  for (const identity of [undefined, "wrong-owner"]) {
    const res = await fetch(base + "/assets/favicon.svg", { headers: identity ? { "X-Auth-User": identity } : {} });
    assert.equal(res.status, 401);
    assert.doesNotMatch(await res.text(), /<svg/);
  }
  const headers = { "X-Auth-User": "web-test-owner" };
  const icon = await fetch(base + "/assets/favicon.svg", { headers });
  assert.equal(icon.status, 200);
  assert.equal(icon.headers.get("content-type"), "image/svg+xml");
  assert.equal(icon.headers.get("x-content-type-options"), "nosniff");
  assert.equal(icon.headers.get("cache-control"), "no-cache");
  assert.equal(await icon.text(), source);
  const page = await fetch(base + "/", { headers });
  const html = await page.text();
  assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="\/assets\/favicon.svg">/);
  assert.equal((html.match(/rel="(?:icon|shortcut icon|apple-touch-icon)"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /favicon\.(?:png|ico|jpe?g)|data:image/i);
  assert.match(page.headers.get("content-security-policy"), /(?:^|; )img-src 'self';/);
  for (const route of ["/favicon.ico", "/favicon.png", "/favicon.svg", "/assets/other.svg", "/web/favicon.svg", "/assets/%2e%2e%2fweb/favicon.svg", "/assets/favicon.svg/extra"]) {
    assert.equal((await fetch(base + route, { headers })).status, 404, route);
  }
});
