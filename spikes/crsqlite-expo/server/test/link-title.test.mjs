import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter, once } from "node:events";
import { PassThrough } from "node:stream";
import { Agent, createServer, request as httpRequest } from "node:http";
import { connect } from "node:net";
import { spawnSync } from "node:child_process";
import { Hono } from "hono";
import { createLinkTitleResolver, htmlTitle, publicAddress } from "../src/link-title.ts";
import { installApi } from "../src/api.ts";
import { launch } from "./web-helpers.mjs";

const publicDNS = async () => [{ address: "93.184.215.14", family: 4 }];
function fixture(pages, options = {}) {
  const calls = [];
  const request = (url, opts, callback) => {
    const req = new EventEmitter();
    req.destroy = () => { req.destroyed = true; };
    req.end = () => queueMicrotask(() => {
      const page = pages[calls.length];
      calls.push({ url: url.href, opts, req });
      if (!page) { req.emit("error", new Error("network failure")); return; }
      const res = new PassThrough();
      res.statusCode = page.status ?? 200;
      res.headers = { "content-type": "text/html; charset=utf-8", ...page.headers };
      const abort = () => { res.destroy(); req.emit("error", new Error("aborted")); };
      opts.signal.addEventListener("abort", abort, { once: true });
      callback(res);
      if (!page.stall && !res.destroyed) {
        for (const chunk of page.chunks ?? [page.html ?? "<title>Page title</title>"]) res.write(Buffer.from(chunk));
        res.end();
      }
    });
    return req;
  };
  return { calls, resolve: createLinkTitleResolver({ resolve: publicDNS, request, ...options }) };
}

test("HTML parsing decodes entities, respects real HTML semantics, ignores scripts/comments and limits titles", () => {
  assert.equal(htmlTitle('<title>Default &amp; &#x1F600;</title><meta content="OG &eacute; &quot;title&quot;" property="og:title">'), 'OG é "title"');
  assert.equal(htmlTitle('<META NAME=twitter:title CONTENT="Twitter &copy;">'), "Twitter ©");
  assert.equal(htmlTitle('<title>  Hello\n World &#0; &lt;safe&gt; </title>'), "Hello World � <safe>");
  assert.equal(htmlTitle('<!-- <meta property="og:title" content="Fake"> --><script>"<meta property=og:title content=Fake>"</script><title>Real</title>'), "Real");
  assert.equal(htmlTitle('<meta property=og:title content=" "><title>Fallback</title>'), "Fallback");
  assert.equal(htmlTitle('<title>' + 'x'.repeat(1000) + '</title>').length, 500);
  assert.equal(htmlTitle('<body><template><title>Not a page title</title></template>'), null);
});

test("SAX title extraction stops at real or implicit body, ignoring inert and raw-text decoys", () => {
  for (const head of [
    '<template><meta property=og:title content=Fake><title>Fake</title></template>',
    '<template><template><title>Fake</title></template><p>Inert body</p></template>',
    '<style><meta property=og:title content=Fake></style>',
    '<noscript><meta property=og:title content=Fake></noscript>',
    '<noframes><title>Fake</title></noframes>',
    '<script><!--<script><meta property=og:title content=Fake></script>--></script>',
  ]) assert.equal(htmlTitle(head + '<title>Real &amp; decoded</title>'), 'Real & decoded', head);
  for (const body of ['</head>', '<body>', '<p>', '<svg>', 'body text']) {
    assert.equal(htmlTitle('<title>Real</title>' + body + '<meta property=og:title content=Fake>'), 'Real', body);
    assert.equal(htmlTitle(body + '<title>Fake</title>'), null, body);
  }
  assert.equal(htmlTitle('<title></title><title>Second title</title>'), null);
  assert.equal(htmlTitle('<title>First</title><title>Second</title>'), 'First');
  assert.equal(htmlTitle('<title>A &lt;meta property=og:title content=Fake&gt; title</title>'), 'A <meta property=og:title content=Fake> title');
});

test("foreign SVG/MathML boundaries conservatively exclude later raw-text and template decoys", () => {
  for (const foreign of ['<svg/>', '<svg>', '<math/>', '<math>']) {
    const decoy = '<template>' + foreign + '</template><script>"<meta property=og:title content=Fake>"</script><title>Real</title>';
    assert.equal(htmlTitle(decoy), null, foreign + ' must use the URL fallback, not the script decoy');
    assert.equal(htmlTitle('<title>Safe before foreign content</title>' + decoy), 'Safe before foreign content', foreign);
    assert.equal(htmlTitle(foreign + '<title>Not a head title</title>'), null, foreign);
  }
});

test("title parsing has a bounded head prefix and ignores late metadata", () => {
  assert.equal(htmlTitle(' '.repeat(32 * 1024) + '<title>Too late</title>'), null);
  assert.equal(htmlTitle('<title>Early</title>' + '<!--' + 'x'.repeat(32 * 1024) + '--><meta property=og:title content=Late>'), 'Early');
  assert.equal(htmlTitle('<script>' + 'x'.repeat(32 * 1024) + '</script><title>Too late</title>'), null);
});

test("malicious nesting and active-formatting reconstruction cannot allocate a DOM or block past a child deadline", () => {
  // The old DOM parser takes ~13s on nested divs and allocates ~241MiB heap
  // on the 16KiB formatting fixture. Keep the proof in a disposable capped child.
  const child = spawnSync(process.execPath, ['--max-old-space-size=128', '--import', 'tsx', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import {htmlTitle} from './src/link-title.ts';
    const formatting = ('<title>ok</title><p>'+Array.from({length:1000},(_,i)=>'<b x='+i+'>').join('')+'</p>'+'<p>x</p>'.repeat(1000)).slice(0,16384);
    const inputs = ['<title>ok</title>'+'<div>'.repeat(50000), formatting,
      '<template>'+formatting.repeat(20), '<!--'+ 'x'.repeat(256*1024)];
    const start=performance.now();
    for (const input of inputs) assert.equal(htmlTitle(input), input.startsWith('<title>')?'ok':null);
    console.log(JSON.stringify({cases:inputs.length,elapsedMs:performance.now()-start,maxRssKiB:process.resourceUsage().maxRSS,heapUsed:process.memoryUsage().heapUsed}));
  `], { cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 10000 });
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.status, 0, child.stderr);
  const metrics = JSON.parse(child.stdout.trim());
  assert.equal(metrics.cases, 4);
  console.log('SAX_BOUNDED_PARSER ' + JSON.stringify(metrics));
});

test("public-address policy excludes private, reserved, mapped, translation and tunnel IPv4/IPv6", () => {
  for (const ip of ["0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.1.1", "192.168.1.1", "192.0.0.9", "192.0.2.1", "192.88.99.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "255.255.255.255", "::", "::1", "fc00::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:808:808", "64:ff9b::808:808", "2001:db8::1", "2001::1", "2002:808:808::1", "3fff::1", "4000::1", "fe80::1%lo", "bad"])
    assert.equal(publicAddress(ip), false, ip);
  for (const ip of ["1.1.1.1", "8.8.8.8", "93.184.215.14", "2606:4700:4700::1111", "2001:4860:4860::8888"]) assert.equal(publicAddress(ip), true, ip);
});

test("fetch pins validated DNS at the actual socket lookup and sends only fixed public headers", async () => {
  const h = fixture([{ html: '<title>Decoded &amp; title</title>' }]);
  assert.equal(await h.resolve("https://example.com/page#fragment"), "Decoded & title");
  const { opts, url } = h.calls[0];
  assert.equal(url, "https://example.com/page");
  assert.equal(opts.agent, false);
  assert.deepEqual(Object.keys(opts.headers).sort(), ["Accept", "Accept-Encoding", "User-Agent"]);
  assert.equal(opts.headers["Accept-Encoding"], "identity");
  assert.equal(opts.maxHeaderSize, 16384);
  assert.equal(opts.method, "GET");
  opts.lookup("example.com", {}, (error, address, family) => {
    assert.equal(error, null); assert.equal(address, "93.184.215.14"); assert.equal(family, 4);
  });
  opts.lookup("example.com", { all: true }, (error, addresses) => {
    assert.equal(error, null); assert.deepEqual(addresses, [{ address: "93.184.215.14", family: 4 }]);
  });
  const v6 = fixture([{}], { resolve: async () => [{ address: "2606:4700:4700::1111", family: 6 }] });
  assert.equal(await v6.resolve("http://example.com"), "Page title");
  v6.calls[0].opts.lookup("example.com", {}, (error, address, family) => {
    assert.equal(address, "2606:4700:4700::1111"); assert.equal(family, 6);
  });
});

test("real Node HTTP socket invokes the pinned lookup while preserving the original Host", async t => {
  const received = [];
  const server = createServer((req, res) => {
    received.push({ host: req.headers.host, url: req.url, authorization: req.headers.authorization, cookie: req.headers.cookie });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<title>Real socket &amp; title</title>');
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const lookups = [];
  const requests = [];
  const agent = new Agent();
  agent.createConnection = (options, callback) => connect({ ...options, port: server.address().port }, callback);
  t.after(() => agent.destroy());
  const resolve = createLinkTitleResolver({
    resolve: publicDNS,
    // Test-only transport adapter: real http.request calls the production lookup,
    // verifies its public answer, then maps that socket to our offline fixture.
    request: (url, options, callback) => {
      requests.push(url.href);
      assert.equal(options.agent, false);
      return httpRequest(url, { ...options, agent,
        lookup: (host, lookupOptions, cb) => options.lookup(host, lookupOptions, (error, address, family) => {
          lookups.push({ host, all: lookupOptions.all ?? false });
          assert.equal(error, null);
          if (lookupOptions.all) {
            assert.deepEqual(address, [{ address: '93.184.215.14', family: 4 }]);
            cb(null, [{ address: '127.0.0.1', family: 4 }]);
          } else {
            assert.equal(address, '93.184.215.14'); assert.equal(family, 4);
            cb(null, '127.0.0.1', 4);
          }
        }),
      }, callback);
    },
  });
  assert.equal(await resolve('http://public-fixture.invalid/page?x=1#fragment'), 'Real socket & title');
  assert.deepEqual(requests, ['http://public-fixture.invalid/page?x=1']);
  assert.equal(lookups.length, 1);
  assert.equal(lookups[0].host, 'public-fixture.invalid');
  assert.deepEqual(received, [{ host: 'public-fixture.invalid', url: '/page?x=1', authorization: undefined, cookie: undefined }]);
});

test("invalid hosts, credentials, ports, schemes and mixed/private DNS never create a socket", async () => {
  const h = fixture([{}]);
  for (const url of ["http://localhost", "http://x.localhost", "http://x.local", "http://127.1", "http://2130706433", "http://0x7f000001", "http://[::1]", "http://[::ffff:127.0.0.1]", "http://[fe80::1%25lo]", "https://user:pass@example.com", "https://example.com:444", "http://example.com:443", "file:///etc/passwd", "javascript:alert(1)"]) {
    assert.equal(await h.resolve(url), url.slice(0, 500));
  }
  assert.equal(h.calls.length, 0);
  for (const resolve of [async () => [], async () => { throw Error("DNS failed"); }, async () => [{ address: "10.0.0.1", family: 4 }], async () => [{ address: "1.1.1.1", family: 4 }, { address: "::1", family: 6 }], async () => [{ address: "1.1.1.1", family: 6 }]]) {
    const bad = fixture([{}], { resolve });
    assert.equal(await bad.resolve("https://example.com/"), "https://example.com/");
    assert.equal(bad.calls.length, 0);
  }
});

test("every redirect is re-resolved and checked, bounded and closed before following", async () => {
  const hosts = [];
  const h = fixture([{ status: 302, headers: { location: "https://other.example/final" } }, {}], {
    resolve: async host => { hosts.push(host); return publicDNS(); },
  });
  assert.equal(await h.resolve("http://example.com/"), "Page title");
  assert.deepEqual(hosts, ["example.com", "other.example"]);
  assert.ok(h.calls[0].req.destroyed);
  for (const location of ["http://127.0.0.1/secret", "http://[::1]/", "http://[::ffff:808:808]/", "https://u:p@other.example/", "https://other.example:8080/"]) {
    const bad = fixture([{ status: 302, headers: { location } }]);
    assert.equal(await bad.resolve("https://example.com/"), "https://example.com/");
    assert.equal(bad.calls.length, 1);
  }
  const rebound = fixture([{ status: 302, headers: { location: "/again" } }, {}], { resolve: async () => rebound.calls.length ? [{ address: "127.0.0.1", family: 4 }] : publicDNS() });
  assert.equal(await rebound.resolve("https://example.com/"), "https://example.com/");
  assert.equal(rebound.calls.length, 1);
  const loop = fixture(Array.from({ length: 8 }, () => ({ status: 302, headers: { location: "/loop" } })));
  assert.equal(await loop.resolve("https://example.com/"), "https://example.com/");
  assert.equal(loop.calls.length, 4);
});

test("lookup failures, missing titles, non-HTML, encodings and oversized bodies fall back without blocking Save", async () => {
  for (const page of [undefined, { html: "<body>no title</body>" }, { status: 403 }, { headers: { "content-type": "application/json" } }, { headers: { "content-encoding": "gzip" } }, { headers: { "content-length": "300000" } }, { chunks: ["a".repeat(200000), "b".repeat(200000)] }]) {
    const h = fixture([page]);
    assert.equal(await h.resolve("https://example.com/"), "https://example.com/");
  }
  const h = fixture([{ html: "<title>caf\u00e9</title>", headers: { "content-type": "text/html; charset=unknown" } }]);
  assert.equal(await h.resolve("https://example.com/"), "https://example.com/");
});

test("one deadline covers DNS, headers and a stalled body; at most four requests run concurrently", async () => {
  const dns = fixture([{}], { resolve: () => new Promise(() => {}), timeoutMs: 15 });
  assert.equal(await dns.resolve("https://example.com/"), "https://example.com/");
  assert.equal(dns.calls.length, 0);
  const body = fixture([{ stall: true }], { timeoutMs: 15 });
  assert.equal(await body.resolve("https://example.com/"), "https://example.com/");
  const stall = fixture(Array.from({ length: 4 }, () => ({ stall: true })), { timeoutMs: 30 });
  const running = Array.from({ length: 4 }, () => stall.resolve("https://example.com/"));
  assert.equal(await stall.resolve("https://example.com/fifth"), "https://example.com/fifth");
  assert.equal((await Promise.all(running)).length, 4);
  assert.equal(stall.calls.length, 4);
});

test("authenticated metadata route never acquires SQLite, forwards only the URL and performs no mutation", async () => {
  const app = new Hono();
  let resolved;
  installApi(app, { use() { throw Error("Metadata must not acquire DB"); } }, "owner", () => { throw Error("No notification"); }, null, async url => { resolved = url; return "Fixture page"; });
  const res = await app.request("http://localhost/api/link-title", {
    method: "POST", headers: { "X-Auth-User": "owner", "X-Stash-Request": "1", "Content-Type": "application/json", Authorization: "Basic private" },
    body: JSON.stringify({ url: "https://example.com" }),
  });
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { title: "Fixture page" });
  assert.equal(resolved, "https://example.com/");
});

test("real metadata route inherits auth, CSRF, body limits and validation; private URL lookup is read-only fallback", async t => {
  const h = await launch(t);
  const before = await (await fetch(h.base + "/healthz")).json();
  assert.equal((await fetch(h.base + "/api/link-title", { method: "POST" })).status, 401);
  for (const headers of [{ "X-Stash-Request": "" }, { Origin: "https://attacker.example" }, { "Sec-Fetch-Site": "cross-site" }])
    assert.equal((await h.api("/link-title", "POST", { url: "https://example.com/" }, headers)).status, 403);
  for (const data of [{}, { url: "file:///etc/passwd" }, { url: "https://u:p@example.com" }, { url: "https://example.com", auth: "bad" }])
    assert.equal((await h.api("/link-title", "POST", data)).status, 400);
  assert.equal((await h.api("/link-title", "POST", { url: "a".repeat(70000) })).status, 413);
  assert.deepEqual(await h.json("/link-title", "POST", { url: "http://127.0.0.1/" }), { title: "http://127.0.0.1/" });
  const after = await (await fetch(h.base + "/healthz")).json();
  assert.deepEqual(after, before);
});
