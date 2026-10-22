import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { folderInteractions } from "./folder-browser-checks.mjs";
import { desktopDensity } from "./compact-browser-checks.mjs";
import { refactorComposition } from "./refactor-browser-checks.mjs";
import { launch, waitFor } from "./web-helpers.mjs";
// Opt-in disposable browser test: no real credentials, live service or network.
// STASH_TEST_SERVER_ENTRY optionally selects the exact built service package.
const req = createRequire(new URL("../package.json", import.meta.url));
const { encode, decode, tags } = await import(
  req.resolve("@vlcn.io/ws-common")
);
const caddyBin = process.env.CADDY_BIN;
const chromeBin = process.env.CHROMIUM_BIN;
assert.ok(
  caddyBin && chromeBin,
  "Set CADDY_BIN and CHROMIUM_BIN to installed binaries",
);
const cleanup = [];
let caddy, chrome, attacker;
async function freePort() {
  const s = createServer().listen(0, "127.0.0.1");
  await once(s, "listening");
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
}
try {
  const { base, json, port, tmp } = await launch({
    after: (fn) => cleanup.push(fn),
  }, { FEED_BASE_URL: "https://feeds.example" });
  const created = await json("/items", "POST", {
    type: "text",
    content: "security-synthetic-only",
  });
  const health = await (await fetch(base + "/healthz")).json();
  const dir = await mkdtemp("/tmp/stash-security-browser-");
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const proxyPort = await freePort();
  const password = "synthetic-review-only";
  const hash = spawnSync(caddyBin, ["hash-password", "--plaintext", password], {
    encoding: "utf8",
  });
  assert.equal(hash.status, 0, hash.stderr);
  const config = `{\n admin off\n auto_https off\n}\nhttp://127.0.0.1:${proxyPort} {\n bind 127.0.0.1\n log {\n output stdout\n format json\n }\n basic_auth {\n review ${hash.stdout.trim()}\n }\n reverse_proxy 127.0.0.1:${port} {\n header_up X-Auth-User web-test-owner\n }\n}\n`;
  await writeFile(dir + "/Caddyfile", config);
  caddy = spawn(
    caddyBin,
    ["run", "--config", dir + "/Caddyfile", "--adapter", "caddyfile"],
    {
      env: {
        ...process.env,
        HOME: dir,
        XDG_DATA_HOME: dir + "/data",
        XDG_CONFIG_HOME: dir + "/config",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let caddyLogs = "";
  caddy.stderr.on("data", (x) => (caddyLogs += x));
  caddy.stdout.on("data", (x) => (caddyLogs += x));
  cleanup.push(async () => {
    if (caddy.exitCode === null) {
      caddy.kill("SIGTERM");
      await once(caddy, "exit");
    }
  });
  await waitFor(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${proxyPort}/`)).status === 401;
    } catch {
      return false;
    }
  });
  attacker = createServer((_req, res) =>
    res.end("<html><title>Synthetic attacker</title></html>"),
  ).listen(0, "127.0.0.1");
  await once(attacker, "listening");
  const attackerPort = attacker.address().port;
  cleanup.push(() => new Promise((r) => attacker.close(r)));
  chrome = spawn(
    chromeBin,
    [
      "--headless",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--remote-debugging-pipe",
      `--user-data-dir=${dir}/profile`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-domain-reliability",
      "--disable-sync",
      "--metrics-recording-only",
      "--safebrowsing-disable-auto-update",
      "--disable-default-apps",
      "--disable-quic",
      "--disable-features=OptimizationHints,MediaRouter,CertificateTransparencyComponentUpdater",
      "--proxy-server=http://127.0.0.1:9",
      "--proxy-bypass-list=127.0.0.1;localhost;[::1]",
      "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
  );
  let chromeLogs = "";
  chrome.stderr.on("data", (x) => (chromeLogs += x));
  cleanup.push(async () => {
    if (chrome.exitCode === null) {
      chrome.kill("SIGTERM");
      await once(chrome, "exit");
    }
  });
  let dialog = null,
    next = 0,
    buf = "",
    pending = new Map();
  chrome.stdio[4].on("data", (chunk) => {
    buf += chunk;
    for (;;) {
      let pos = buf.indexOf("\0");
      if (pos < 0) break;
      let frame = buf.slice(0, pos);
      buf = buf.slice(pos + 1);
      if (!frame) continue;
      const msg = JSON.parse(frame);
      if (msg.method === "Page.javascriptDialogOpening") dialog = msg.params;
      if (msg.id && pending.has(msg.id)) {
        const [resolve, reject, timer] = pending.get(msg.id);
        pending.delete(msg.id);
        clearTimeout(timer);
        msg.error
          ? reject(new Error(JSON.stringify(msg.error)))
          : resolve(msg.result);
      }
    }
  });
  function cdp(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      let id = ++next;
      let timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("CDP timeout " + method + " " + chromeLogs));
      }, 5000);
      pending.set(id, [resolve, reject, timer]);
      chrome.stdio[3].write(
        JSON.stringify({
          id,
          method,
          params,
          ...(sessionId ? { sessionId } : {}),
        }) + "\0",
      );
    });
  }
  const { targetId } = await cdp("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  await cdp("Page.enable", {}, sessionId);
  const evaluate = async (expression) => {
    const r = await cdp(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true },
      sessionId,
    );
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  console.log(
    "LOGIN_NAV " +
      JSON.stringify(
        await cdp(
          "Page.navigate",
          { url: `http://review:${password}@127.0.0.1:${proxyPort}/` },
          sessionId,
        ),
      ),
  );
  await waitFor(
    async () =>
      await evaluate(
        `location.port==='${proxyPort}' && document.readyState==='complete'`,
      ),
  );
  console.log(
    "LOGIN_DOC " +
      JSON.stringify(
        await evaluate(
          "({href:location.href,text:document.body.innerText.slice(0,200)})",
        ),
      ),
  );
  await cdp(
    "Page.navigate",
    { url: `http://127.0.0.1:${proxyPort}/` },
    sessionId,
  );
  await waitFor(
    async () =>
      await evaluate(
        `location.port==='${proxyPort}' && document.readyState==='complete'`,
      ),
  );
  const same = await evaluate(
    `fetch('http://127.0.0.1:${proxyPort}/api/items/${created.id}').then(async r=>({status:r.status,body:await r.text()}))`,
  );
  assert.equal(same.status, 200, JSON.stringify(same));
  console.log(
    "PASS real Chromium + real Caddy synthetic Basic login and authenticated API GET",
  );
  // Exercise the actual static React bundle and browser FormData, not only mocked components.
  await waitFor(
    async () =>
      await evaluate(
        `[...document.querySelectorAll('button')].some(b=>b.textContent==='New item')`,
      ),
  );
  await evaluate(
    `[...document.querySelectorAll('button')].find(b=>b.textContent==='New item').click()`,
  );
  await waitFor(
    async () =>
      await evaluate(`!!document.querySelector('textarea[name=content]')`),
  );
  await evaluate(
    `(()=>{const form=document.querySelector('textarea[name=content]').form;form.elements.title.value='Browser made';form.elements.content.value='Original browser body';form.requestSubmit()})()`,
  );
  await waitFor(
    async () =>
      await evaluate(
        `document.querySelector('.reader h2')?.textContent==='Browser made'`,
      ),
  );
  const browserItem = await evaluate(
    `fetch('/api/items').then(r=>r.json()).then(p=>p.items.find(i=>i.title==='Browser made'))`,
  );
  assert.ok(browserItem?.id);
  await evaluate(
    `[...document.querySelectorAll('button')].find(b=>b.textContent==='Edit item').click()`,
  );
  await json(`/items/${browserItem.id}`, "PATCH", {
    content: "Concurrent synthetic phone content",
  });
  await evaluate(
    `[...document.querySelectorAll('button')].find(b=>b.textContent==='Refresh').click()`,
  );
  await waitFor(
    async () =>
      await evaluate(
        `!document.querySelector('[role=status]').textContent.includes('Loading')`,
      ),
  );
  assert.equal(
    await evaluate(`document.querySelector('textarea[name=content]').value`),
    "Original browser body",
  );
  await evaluate(
    `(()=>{const form=document.querySelector('textarea[name=content]').form;form.elements.title.value='Browser renamed';form.requestSubmit()})()`,
  );
  await waitFor(
    async () =>
      await evaluate(
        `document.querySelector('.reader h2')?.textContent==='Browser renamed'`,
      ),
  );
  const saved = await json(`/items/${browserItem.id}`);
  assert.equal(saved.content, "Concurrent synthetic phone content");
  console.log(
    "PASS real static React create/edit; untouched concurrent field survives refresh and browser FormData submission",
  );
  // Desktop/Tailwind acceptance uses only synthetic records on the isolated service.
  const click = async (label) => {
    const selector = `[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===${JSON.stringify(label)}||b.textContent===${JSON.stringify(label)})`;
    await waitFor(() =>
      evaluate(`(()=>{const b=${selector};return !!b && !b.disabled})()`),
    );
    return evaluate(`(${selector}).click()`);
  };
  const screenshot = async (name) => {
    if (!process.env.STASH_SCREENSHOT_DIR) return;
    await mkdir(process.env.STASH_SCREENSHOT_DIR, { recursive: true });
    const { data } = await cdp(
      "Page.captureScreenshot",
      { format: "png" },
      sessionId,
    );
    await writeFile(
      process.env.STASH_SCREENSHOT_DIR + "/" + name + ".png",
      Buffer.from(data, "base64"),
    );
  };
  await cdp(
    "Emulation.setDeviceMetricsOverride",
    { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );
  assert.ok(await evaluate(`document.querySelector('.organise summary')?.textContent.includes('Organise · No folders')`));
  await evaluate(`document.documentElement.dataset.fixtureReload='old'`);
  await cdp('Page.reload', {}, sessionId);
  await waitFor(() => evaluate(`!document.documentElement.dataset.fixtureReload && !!document.querySelector('.organise summary') && document.querySelector('.collection').getAttribute('aria-busy')==='false'`));
  // The busy probe delays only synthetic local writes; no production traffic.
  await evaluate(`(()=>{const original=window.fetch;window.fetch=async (...args)=>{if(window.fixtureDelayWrite && args[1]?.method && args[1].method!=='GET')await new Promise(r=>setTimeout(r,350));return original(...args)}})()`);
  if (process.env.STASH_DENSITY_REFERENCE !== "1") {
    // Loading/empty feedback must not reserve or resize a chrome rail.
    await evaluate(`window.fixturePaneTop=document.querySelector('.workspace').getBoundingClientRect().top;window.fixtureFetch=window.fetch;window.fetch=async (...a)=>{if(!a[1]?.method||a[1].method==='GET')await new Promise(r=>setTimeout(r,350));return window.fixtureFetch(...a)};document.querySelector('[aria-label="Refresh"]').click()`);
    await waitFor(() => evaluate(`document.querySelector('[role=status]').textContent.includes('Refreshing')`));
    assert.ok(await evaluate(`document.querySelector('[role=status]').getAttribute('aria-live')==='polite' && document.querySelector('.workspace').getBoundingClientRect().top===window.fixturePaneTop`));
    await waitFor(() => evaluate(`document.querySelector('.collection').getAttribute('aria-busy')==='false'`));
    assert.ok(await evaluate(`document.querySelector('[role=status]').textContent==='' && document.querySelector('[role=status]').getBoundingClientRect().height===0 && document.querySelector('.workspace').getBoundingClientRect().top===window.fixturePaneTop`));
    await evaluate(`window.fetch=window.fixtureFetch`);
  }
  await click("New folder");
  await waitFor(() => evaluate(`!!document.querySelector('input[name=name]')`));
  assert.ok(await evaluate(`(()=>{const f=document.querySelector('input[name=name]').form;return f.querySelectorAll('button.primary[type=submit]').length===1 && f.querySelector('button[type=button]').textContent==='Cancel'})()`));
  await screenshot("desktop-folder-form");
  await evaluate(`window.fixtureDelayWrite=true`);
  await evaluate(
    `(()=>{const f=document.querySelector('input[name=name]').form;f.elements.name.value='Synthetic reading shelf';f.requestSubmit()})()`,
  );
  await waitFor(() => evaluate(`document.querySelector('input[name=name]')?.form.querySelector('button.primary')?.textContent.trim()==='Creating…' && document.querySelector('input[name=name]').form.querySelector('button.primary').disabled`));
  await waitFor(() =>
    evaluate(
      `document.querySelector('.collection h2')?.textContent==='Synthetic reading shelf'`,
    ),
  );
  const folderId = await evaluate(
    `new URLSearchParams(location.search).get('folder')`,
  );
  assert.ok(folderId);
  const feedPolicy = await json(`/folders/${folderId}/feed`);
  assert.equal(feedPolicy.policy, "always-on");
  assert.equal(feedPolicy.enabled, true);
  assert.equal(await evaluate(`document.querySelector('.empty button').textContent`), "New item");
  // Empty-state creation uses the same guarded transition as the header.
  await click('New folder');
  await waitFor(() => evaluate(`!!document.querySelector('input[name=name]')`));
  await evaluate(`(()=>{const n=document.querySelector('input[name=name]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,'Keep empty-state draft');n.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  const emptyNavigation = evaluate(`document.querySelector('.empty button').click()`);
  await waitFor(() => !!dialog);
  await cdp('Page.handleJavaScriptDialog', { accept: false }, sessionId);
  await emptyNavigation;
  dialog = null;
  assert.equal(await evaluate(`document.querySelector('input[name=name]').value`), 'Keep empty-state draft');
  const cancelEmptyDraft = click('Cancel');
  await waitFor(() => !!dialog);
  await cdp('Page.handleJavaScriptDialog', { accept: true }, sessionId);
  await cancelEmptyDraft;
  dialog = null;
  await waitFor(() => evaluate(`!!document.querySelector('.empty button')`));
  await evaluate(`document.querySelector('.empty button').click()`);
  await waitFor(() => evaluate(`!!document.querySelector('textarea')`));
  assert.ok(await evaluate(`(()=>{const f=document.querySelector('textarea').form,c=f.elements.content;return f.querySelectorAll('button.primary[type=submit]').length===1 && f.elements.title.closest('label').textContent.includes('optional') && !f.elements.title.required && c.required && document.getElementById(c.getAttribute('aria-describedby')).textContent.includes('http:// or https://') && f.querySelector('button[type=button]').textContent.trim()==='Cancel'})()`));
  await screenshot("desktop-item-form");
  await evaluate(
    `(()=>{const f=document.querySelector('textarea').form;f.elements.title.value='A quiet place for ideas';f.elements.content.value='This is a synthetic notebook, created only for interface review.\\n\\nA library does not need to be loud. Keep a thought, save a link, and come back when there is time to enjoy it.\\n\\n'+('A note for another day: make space for the things that catch your eye. Read slowly, follow an interesting thread, and leave a little room for something unexpected.\\n\\n').repeat(18)+'Long-word wrapping check: '+ 'x'.repeat(90);f.requestSubmit()})()`,
  );
  await waitFor(() => evaluate(`document.querySelector('textarea')?.form.querySelector('button.primary')?.textContent.trim()==='Saving…' && document.querySelector('textarea').closest('fieldset').disabled`));
  await waitFor(() =>
    evaluate(
      `document.querySelector('.reader h2')?.textContent==='A quiet place for ideas'`,
    ),
  );
  await evaluate(`window.fixtureDelayWrite=false`);
  const filedId = await evaluate(
    `new URLSearchParams(location.search).get('item')`,
  );
  assert.deepEqual((await json("/items/" + filedId)).folderIds, [folderId]);
  await json("/items", "POST", {
    type: "url",
    title: "Read something wonderful",
    content: "https://example.com/synthetic",
    folderId,
  });
  await json("/items", "POST", {
    type: "text",
    content:
      "Untitled synthetic text with an excerpt instead of a generic title.",
    folderId,
  });
  await click("Refresh");
  await waitFor(() =>
    evaluate(
      `document.querySelectorAll('.item-card').length===3 && !document.querySelector('[role=status]').textContent.includes('Refreshing')`,
    ),
  );
  await click("Grid layout");
  await waitFor(() =>
    evaluate(`document.querySelector('.items')?.classList.contains('grid')`),
  );
  const grid = await evaluate(
    `(()=>{const u=document.querySelector('.items'),cards=[...u.querySelectorAll('li')].map(n=>n.getBoundingClientRect());return {columns:getComputedStyle(u).gridTemplateColumns.split(' ').length,widths:cards.map(c=>c.width),right:document.documentElement.scrollWidth,window:innerWidth,sidebar:getComputedStyle(document.querySelector('.sidebar')).overflowY,reader:getComputedStyle(document.querySelector('.reader')).overflowY}})()`,
  );
  assert.equal(grid.columns, 2);
  assert.equal(grid.widths[0], grid.widths[2]);
  assert.ok(grid.right <= grid.window);
  assert.equal(grid.sidebar, "auto");
  assert.equal(grid.reader, "auto");
  assert.equal(
    (await json("/folders")).find((f) => f.id === folderId).layout,
    "grid",
  );
  await desktopDensity(evaluate, "grid");
  await screenshot("desktop-grid-reader");
  await click("List layout");
  await waitFor(() =>
    evaluate(`document.querySelector('.items')?.classList.contains('flex')`),
  );
  assert.equal(
    await evaluate(`new URLSearchParams(location.search).get('item')`),
    filedId,
  );
  assert.ok(await evaluate(`(()=>{const cards=[...document.querySelectorAll('.item-card')];return cards.length===3 && document.querySelector('.layout-toggle').getAttribute('role')==='group' && [...document.querySelectorAll('.layout-toggle button')].every(b=>b.title===b.getAttribute('aria-label'))})()`));
  assert.ok(await evaluate(`document.querySelector('.organise summary').textContent.includes('Organise · 1 folder')`));
  assert.ok(await evaluate(`[...document.querySelectorAll('.item-card small')].some(n=>n.textContent.startsWith('Note')) && [...document.querySelectorAll('.item-card small')].some(n=>n.textContent.startsWith('example.com'))`));
  assert.ok(await evaluate(`(()=>{const b=[...document.querySelectorAll('.layout-toggle button')];return getComputedStyle(b.find(n=>n.getAttribute('aria-pressed')==='true')).backgroundColor!==getComputedStyle(b.find(n=>n.getAttribute('aria-pressed')==='false')).backgroundColor})()`));
  console.log('UI10_LIST_GEOMETRY ' + JSON.stringify(await evaluate(`[...document.querySelectorAll('.item-card')].map(c=>({title:c.querySelector('.card-title').textContent,height:c.getBoundingClientRect().height}))`)));
  await desktopDensity(evaluate, "list");
  await screenshot("desktop-list-reader");
  // Membership count includes archived folders and updates through the real checkbox mutation.
  const { id: archivedMembership } = await json('/folders', 'POST', { name: 'Synthetic archived membership' });
  await json(`/folders/${archivedMembership}`, 'PATCH', { archived: true });
  await json(`/items/${filedId}/folders/${archivedMembership}`, 'PUT', { present: true });
  await click('Refresh');
  await waitFor(() => evaluate(`document.querySelector('.organise summary')?.textContent.includes('Organise · 2 folders')`));
  await evaluate(`document.querySelector('.organise').open=true;[...document.querySelectorAll('.organise label')].find(n=>n.textContent.includes('Synthetic archived membership')).querySelector('input').click()`);
  await waitFor(() => evaluate(`document.querySelector('.organise summary')?.textContent.includes('Organise · 1 folder')`));
  await evaluate(`document.querySelector('.organise').open=false`);
  const linkId = (await json(`/items?folderId=${folderId}`)).items.find(i => i.type === 'url').id;
  await evaluate(`document.querySelector('[data-item-id="${linkId}"]').click()`);
  await waitFor(() => evaluate(`!!document.querySelector('.reader a')`));
  assert.ok(await evaluate(`(()=>{const a=document.querySelector('.reader a');return a.href==='https://example.com/synthetic' && a.target==='_blank' && a.rel==='noopener noreferrer' && document.getElementById(a.getAttribute('aria-describedby')).textContent==='Opens in a new tab'})()`));
  await screenshot('desktop-link-reader');
  await evaluate(`document.querySelector('[data-item-id="${filedId}"]').click()`);
  await waitFor(() => evaluate(`document.querySelector('.reader h2')?.textContent==='A quiet place for ideas'`));
  // Desktop layout writes and atomic filing must preserve master's private feeds.
  const feedPath = `/feeds/folders/${folderId}.atom`;
  assert.equal((await fetch(`http://127.0.0.1:${proxyPort}${feedPath}`, {
    headers: { "X-Auth-User": "web-test-owner", "If-None-Match": "*" },
  })).status, 401, "a forged identity must not bypass Caddy Basic auth for feeds");
  const feed = await evaluate(`fetch(${JSON.stringify(feedPath)}).then(async r=>({status:r.status,type:r.headers.get('content-type'),cache:r.headers.get('cache-control'),etag:r.headers.get('etag'),body:await r.text()}))`);
  assert.equal(feed.status, 200);
  assert.match(feed.type, /application\/atom\+xml/);
  assert.equal(feed.cache, "private, no-cache");
  assert.match(feed.body, /A quiet place for ideas/);
  assert.match(feed.body, /Read something wonderful/);
  assert.equal((await json(`/folders/${folderId}/feed`)).enabled, true);
  assert.equal(await evaluate(`fetch(${JSON.stringify(feedPath)},{headers:{'If-None-Match':${JSON.stringify(feed.etag)}}}).then(r=>r.status)`), 304);
  console.log("PASS combined desktop atomic filing/layout and private Atom feed through cached Basic auth; unauthenticated forged-header request rejected");
  await cdp(
    "Page.navigate",
    {
      url: `http://127.0.0.1:${proxyPort}/?folder=${folderId}&item=${filedId}`,
    },
    sessionId,
  );
  await waitFor(() =>
    evaluate(
      `document.querySelector('.reader h2')?.textContent==='A quiet place for ideas'`,
    ),
  );
  assert.ok(
    await evaluate(
      `document.querySelector('button[aria-label="List layout"]').getAttribute('aria-pressed')==='true'`,
    ),
  );
  // Folder and item editing must not coexist or silently clear dirty protection.
  for (const action of ["New folder", "Rename"]) {
    if (action === "Rename" && process.env.STASH_DENSITY_REFERENCE !== "1") {
      await evaluate(`document.querySelector('.folder-link[aria-current=page]').parentElement.querySelector('.folder-menu-toggle').click()`);
      await waitFor(() => evaluate(`!!document.querySelector('[role=menu]')`));
    }
    await click(action);
    await waitFor(() => evaluate(`!!document.querySelector('input[name=name]')`));
    await evaluate(`(()=>{const n=document.querySelector('input[name=name]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,'Unsaved folder draft');n.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    const editing = click("Edit item");
    await waitFor(() => !!dialog);
    assert.match(dialog.message, /unsaved/i);
    await cdp("Page.handleJavaScriptDialog", { accept: false }, sessionId);
    await editing;
    dialog = null;
    assert.equal(await evaluate(`document.querySelector('input[name=name]').value`), "Unsaved folder draft");
    assert.equal(await evaluate(`!!document.querySelector('textarea')`), false);
    const navigating = click("All items");
    await waitFor(() => !!dialog);
    await cdp("Page.handleJavaScriptDialog", { accept: false }, sessionId);
    await navigating;
    dialog = null;
    assert.equal(await evaluate(`document.querySelector('input[name=name]').value`), "Unsaved folder draft");
    const acceptingEdit = click("Edit item");
    await waitFor(() => !!dialog);
    await cdp("Page.handleJavaScriptDialog", { accept: true }, sessionId);
    await acceptingEdit;
    dialog = null;
    await waitFor(() => evaluate(`!!document.querySelector('textarea') && !document.querySelector('input[name=name]')`));
    await click("Cancel");
    await waitFor(() => evaluate(`!document.querySelector('textarea')`));
  }
  console.log("PASS real new-folder/rename drafts guard Edit item and All items; accepted discard opens only the item editor");
  // A real edited draft must survive a rejected navigation confirmation.
  await click("Edit item");
  await waitFor(() => evaluate(`!!document.querySelector('textarea')`));
  await evaluate(
    `(()=>{const n=document.querySelector('input[name=title]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,'Unsaved synthetic draft');n.dispatchEvent(new Event('input',{bubbles:true}))})()`,
  );
  const abandoning = click("Archive");
  await waitFor(() => !!dialog);
  assert.match(dialog.message, /unsaved/i);
  await cdp("Page.handleJavaScriptDialog", { accept: false }, sessionId);
  await abandoning;
  dialog = null;
  assert.equal(
    await evaluate(`document.querySelector('input[name=title]').value`),
    "Unsaved synthetic draft",
  );
  const canceling = click("Cancel");
  await waitFor(() => !!dialog);
  await cdp("Page.handleJavaScriptDialog", { accept: true }, sessionId);
  await canceling;
  dialog = null;
  await waitFor(() => evaluate(`!document.querySelector('textarea')`));
  await click("Archive item");
  await waitFor(() =>
    evaluate(
      `!document.querySelector('[role=status]').textContent.includes('Saving') && document.querySelector('[role=status]').textContent.includes('archived')`,
    ),
  );
  assert.notEqual(
    await evaluate(`new URLSearchParams(location.search).get('item')`),
    filedId,
  );
  await click("Undo");
  await waitFor(
    async () => (await json("/items/" + filedId)).archived_at === null,
  );
  await waitFor(() =>
    evaluate(
      `![...document.querySelectorAll('button')].find(b=>b.textContent==='Archive').disabled`,
    ),
  );
  await click("Archive");
  await waitFor(() =>
    evaluate(
      `new URLSearchParams(location.search).get('archive')==='1' && !document.querySelector('[aria-label="New item"]')`,
    ),
  );
  assert.equal(
    await evaluate(`new URLSearchParams(location.search).get('folder')`),
    folderId,
  );
  assert.ok(
    await evaluate(
      `[...document.querySelectorAll('.folder-link')].some(b=>b.textContent==='Synthetic reading shelf')`,
    ),
  );
  await waitFor(() => evaluate(`!!document.querySelector('.empty button')`));
  assert.equal(await evaluate(`document.querySelector('.empty button').textContent`), 'Back to collection');
  await screenshot("desktop-empty-archive");
  await evaluate(`document.querySelector('.empty button').click()`);
  await waitFor(() =>
    evaluate(
      `!new URLSearchParams(location.search).has('archive') && !!document.querySelector('[aria-label="New item"]')`,
    ),
  );
  // Keyboard selection, Escape and focus return in a real browser.
  await waitFor(() =>
    evaluate(`document.querySelectorAll('.item-card').length===3`),
  );
  await evaluate(`document.querySelector('.item-card').focus()`);
  await cdp(
    "Input.dispatchKeyEvent",
    {
      type: "rawKeyDown",
      key: "ArrowDown",
      code: "ArrowDown",
      windowsVirtualKeyCode: 40,
    },
    sessionId,
  );
  await cdp(
    "Input.dispatchKeyEvent",
    {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      text: "\r",
      unmodifiedText: "\r",
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
    },
    sessionId,
  );
  await cdp(
    "Input.dispatchKeyEvent",
    { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
    sessionId,
  );
  await waitFor(() =>
    evaluate(
      `!!new URLSearchParams(location.search).get('item') && document.activeElement.classList.contains('reader')`,
    ),
  );
  await cdp(
    "Input.dispatchKeyEvent",
    {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    },
    sessionId,
  );
  await waitFor(() =>
    evaluate(
      `!new URLSearchParams(location.search).get('item') && document.activeElement.classList.contains('item-card')`,
    ),
  );
  await cdp(
    "Emulation.setDeviceMetricsOverride",
    { width: 390, height: 844, deviceScaleFactor: 1, mobile: true },
    sessionId,
  );
  await click("Grid layout");
  await waitFor(() =>
    evaluate(`document.querySelector('.items')?.classList.contains('grid')`),
  );
  assert.ok(
    await evaluate(
      `document.documentElement.scrollWidth<=innerWidth && getComputedStyle(document.querySelector('.sidebar')).display==='none'`,
    ),
  );
  await screenshot("narrow-grid");
  await cdp(
    "Emulation.setDeviceMetricsOverride",
    { width: 320, height: 740, deviceScaleFactor: 1, mobile: true },
    sessionId,
  );
  assert.ok(
    await evaluate(
      `document.documentElement.scrollWidth<=innerWidth && document.querySelector('[aria-label="New item"]').getBoundingClientRect().right<=innerWidth`,
    ),
  );
  await evaluate(`document.querySelector('[aria-label="List layout"]').focus()`);
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId);
  assert.ok(await evaluate(`document.activeElement.getAttribute('aria-label')==='Grid layout' && getComputedStyle(document.activeElement).outlineStyle!=='none'`));
  await screenshot('320-layout-focus');
  if (process.env.STASH_DENSITY_REFERENCE !== "1") {
    await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 }, sessionId);
    assert.ok(await evaluate(`matchMedia('(pointer: coarse)').matches && [...document.querySelectorAll('.app-header button, .layout-toggle button')].filter(b=>b.getBoundingClientRect().width>0).every(b=>{const r=b.getBoundingClientRect();return r.height>=44&&r.width>=44}) && document.documentElement.scrollWidth<=innerWidth`));
    await click('Open folders');
    assert.ok(await evaluate(`[...document.querySelectorAll('.sidebar .folder-link')].every(b=>b.getBoundingClientRect().height>=44) && document.documentElement.scrollWidth<=innerWidth`));
    await screenshot('320-touch-folders');
    await click('Close folders');
    await cdp('Emulation.setTouchEmulationEnabled', { enabled: false }, sessionId);
  }
  await click('New item');
  await waitFor(() => evaluate(`!!document.querySelector('textarea')`));
  assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth && document.querySelector('.field-help').getBoundingClientRect().right<=innerWidth && document.querySelector('textarea').getBoundingClientRect().right<=innerWidth`));
  if (process.env.STASH_DENSITY_REFERENCE !== "1") {
    await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 }, sessionId);
    assert.ok(await evaluate(`[...document.querySelectorAll('.reader input:not([type=checkbox]), .reader select, .reader button')].every(b=>b.getBoundingClientRect().height>=44) && document.documentElement.scrollWidth<=innerWidth`));
    await screenshot('320-touch-form');
    await cdp('Emulation.setTouchEmulationEnabled', { enabled: false }, sessionId);
  }
  await screenshot('320-item-form');
  await click('Cancel');
  await waitFor(() => evaluate(`!document.querySelector('textarea')`));
  await cdp(
    "Emulation.setDeviceMetricsOverride",
    { width: 390, height: 844, deviceScaleFactor: 1, mobile: true },
    sessionId,
  );
  await click("Open folders");
  await waitFor(() =>
    evaluate(
      `document.querySelector('.sidebar').classList.contains('is-open')`,
    ),
  );
  await screenshot("narrow-folders");
  await click("Close folders");
  await evaluate(`document.querySelector('.item-card').click()`);
  await waitFor(() =>
    evaluate(
      `!!document.querySelector('.reader h2') && getComputedStyle(document.querySelector('.collection')).visibility==='hidden'`,
    ),
  );
  await screenshot("narrow-reader");
  await cdp(
    "Emulation.setDeviceMetricsOverride",
    { width: 1000, height: 800, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );
  assert.ok(
    await evaluate(
      `getComputedStyle(document.querySelector('.collection')).visibility==='visible' && document.querySelector('.reader').getBoundingClientRect().width<=innerWidth-document.querySelector('.sidebar').getBoundingClientRect().width`,
    ),
  );
  await screenshot("medium-reader-drawer");
  await click("Back to collection");
  await waitFor(() =>
    evaluate(`document.activeElement.classList.contains('item-card')`),
  );
  assert.ok(
    await evaluate(
      `getComputedStyle(document.querySelector('.reader')).display==='none'`,
    ),
  );
  // 200% desktop zoom equivalent: a 720-CSS-pixel layout viewport at DPR 2.
  await cdp(
    "Emulation.setDeviceMetricsOverride",
    { width: 720, height: 500, deviceScaleFactor: 2, mobile: false },
    sessionId,
  );
  assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth`));
  await screenshot("zoom-200-layout");
  await cdp(
    "Emulation.setDeviceMetricsOverride",
    { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false },
    sessionId,
  );
  for (let n = 0; n < 24; n++)
    await json("/items", "POST", {
      type: "text",
      title: "Synthetic scroll card " + n,
      content: "Only for scroll retention checks",
      folderId,
    });
  await click("Refresh");
  await waitFor(() =>
    evaluate(`document.querySelectorAll('.item-card').length===27`),
  );
  for (const metrics of [
    { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false },
    { width: 320, height: 740, deviceScaleFactor: 1, mobile: true },
    { width: 720, height: 500, deviceScaleFactor: 2, mobile: false },
  ]) {
    await cdp('Emulation.setDeviceMetricsOverride', metrics, sessionId);
    assert.ok(await evaluate(`(()=>{const pane=document.querySelector('.collection'),h=document.querySelector('.collection-heading');pane.scrollTop=320;const a=h.getBoundingClientRect(),p=pane.getBoundingClientRect();return Math.abs(a.top-p.top)<2 && a.bottom<p.bottom && getComputedStyle(h).position==='sticky' && getComputedStyle(h).backgroundColor!=='rgba(0, 0, 0, 0)' && document.documentElement.scrollWidth<=innerWidth})()`));
    await screenshot('sticky-' + metrics.width);
    // Keyboard focus cannot be hidden underneath the sticky toolbar.
    await evaluate(`document.querySelectorAll('.item-card')[10].focus()`);
    await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 }, sessionId);
    assert.ok(await evaluate(`document.activeElement.classList.contains('item-card') && document.activeElement.getBoundingClientRect().top>=document.querySelector('.collection-heading').getBoundingClientRect().bottom+5`));
  }
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);
  await evaluate(
    `document.querySelector('.collection').scrollTop=320;document.querySelector('.item-card').click()`,
  );
  await waitFor(() =>
    evaluate(
      `!!new URLSearchParams(location.search).get('item') && !!document.querySelector('.reader .reader-content')`,
    ),
  );
  assert.equal(
    await evaluate(`document.querySelector('.collection').scrollTop`),
    320,
  );
  const selectionBeforeLayout = await evaluate(
    `new URLSearchParams(location.search).get('item')`,
  );
  await click("List layout");
  await waitFor(() =>
    evaluate(`document.querySelector('.items').classList.contains('flex')`),
  );
  assert.equal(
    await evaluate(`document.querySelector('.collection').scrollTop`),
    320,
  );
  assert.equal(
    await evaluate(`new URLSearchParams(location.search).get('item')`),
    selectionBeforeLayout,
  );
  // Only the freshly launched fixture DB is touched. Simulate remote removal
  // after the real form opens; there is intentionally no product delete API.
  const Database = req("better-sqlite3");
  const { extensionPath } = await import(req.resolve("@vlcn.io/crsqlite"));
  function removeFixture(sql, ...args) {
    const db = new Database(tmp + "/stash-backend");
    try {
      db.loadExtension(extensionPath);
      db.prepare(sql).run(...args);
    } finally {
      db.close();
    }
  }
  await click("Edit item");
  await waitFor(() => evaluate(`!!document.querySelector('textarea')`));
  removeFixture("DELETE FROM sync_items WHERE id=?", selectionBeforeLayout);
  await click("Refresh");
  await waitFor(() =>
    evaluate(
      `!document.querySelector('textarea') && !new URLSearchParams(location.search).get('item') && document.querySelector('[role=status]').textContent.includes('no longer available')`,
    ),
  );
  await click("New item");
  await waitFor(() => evaluate(`!!document.querySelector('textarea')`));
  await evaluate(
    `(()=>{const n=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(n,'Unrelated new synthetic draft');n.dispatchEvent(new Event('input',{bubbles:true}))})()`,
  );
  removeFixture("DELETE FROM sync_item_folders WHERE folder_id=?", folderId);
  removeFixture("DELETE FROM sync_folders WHERE id=?", folderId);
  await click("Refresh");
  await waitFor(() =>
    evaluate(
      `!new URLSearchParams(location.search).get('folder') && document.querySelector('[role=status]').textContent.includes('Folder removed')`,
    ),
  );
  assert.equal(
    await evaluate(`document.querySelector('textarea').value`),
    "Unrelated new synthetic draft",
  );
  const cancelNew = click("Cancel");
  await waitFor(() => !!dialog);
  await cdp("Page.handleJavaScriptDialog", { accept: true }, sessionId);
  await cancelNew;
  dialog = null;
  // An unrelated new-folder draft must keep its DOM identity and input value
  // when its selected filter disappears remotely. Rename remains owner-bound.
  for (const action of ["New folder", "Rename"]) {
    const { id: removedFolder } = await json("/folders", "POST", { name: `Disposable filter ${action}` });
    await cdp("Page.navigate", { url: `http://127.0.0.1:${proxyPort}/?folder=${removedFolder}` }, sessionId);
    await waitFor(() => evaluate(`document.querySelector('.collection h2')?.textContent===${JSON.stringify(`Disposable filter ${action}`)}`));
    if (action === "Rename" && process.env.STASH_DENSITY_REFERENCE !== "1") {
      await evaluate(`document.querySelector('.folder-link[aria-current=page]').parentElement.querySelector('.folder-menu-toggle').click()`);
      await waitFor(() => evaluate(`!!document.querySelector('[role=menu]')`));
    }
    await click(action);
    await waitFor(() => evaluate(`!!document.querySelector('input[name=name]')`));
    await evaluate(`(()=>{const n=document.querySelector('input[name=name]');window.fixtureFolderInput=n;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,'Unrelated new folder draft');n.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    removeFixture("DELETE FROM sync_folders WHERE id=?", removedFolder);
    await click("Refresh");
    await waitFor(() => evaluate(`!new URLSearchParams(location.search).get('folder') && document.querySelector('.collection h2')?.textContent==='All items' && !document.querySelector('[role=status]').textContent.includes('Refreshing')`));
    if (action === "Rename") {
      assert.equal(await evaluate(`!!document.querySelector('input[name=name]')`), false);
      continue;
    }
    assert.equal(await evaluate(`document.querySelector('input[name=name]')===window.fixtureFolderInput`), true);
    assert.equal(await evaluate(`document.querySelector('input[name=name]').value`), "Unrelated new folder draft");
    const leaving = click("Archive");
    await waitFor(() => !!dialog);
    await cdp("Page.handleJavaScriptDialog", { accept: false }, sessionId);
    await leaving;
    dialog = null;
    assert.equal(await evaluate(`document.querySelector('input[name=name]').value`), "Unrelated new folder draft");
    const cancelFolder = click("Cancel");
    await waitFor(() => !!dialog);
    await cdp("Page.handleJavaScriptDialog", { accept: true }, sessionId);
    await cancelFolder;
    dialog = null;
    await waitFor(() => evaluate(`!document.querySelector('input[name=name]')`));
  }
  // A separate synthetic collection exercises real 100-item paging, never guessed totals.
  const { id: pageFolder } = await json('/folders', 'POST', { name: 'Synthetic pagination' });
  for (let n = 0; n < 103; n++) await json('/items', 'POST', { type: 'text', content: `Paging note ${n}`, folderId: pageFolder });
  await cdp('Page.navigate', { url: `http://127.0.0.1:${proxyPort}/?folder=${pageFolder}` }, sessionId);
  await waitFor(() => evaluate(`document.querySelectorAll('.item-card').length===100`));
  assert.ok(await evaluate(`document.querySelector('[aria-label="Item pages"]').textContent.includes('Items 1–100') && [...document.querySelectorAll('[aria-label="Item pages"] button')].find(b=>b.textContent==='Previous').disabled`));
  // Fail only the next synthetic page GET in this disposable browser session.
  await evaluate(`(()=>{window.fixtureFirstPage=[...document.querySelectorAll('[data-item-id]')].map(b=>b.dataset.itemId);const original=window.fetch;window.fetch=async (...args)=>{const url=new URL(args[0],location.href);if(url.pathname==='/api/items' && url.searchParams.get('offset')==='100' && args[1]?.method==='GET'){window.fetch=original;return Response.json({error:'Synthetic page failed'},{status:503})}return original(...args)}})()`);
  await click('Next');
  await waitFor(() => evaluate(`document.querySelector('[role=alert]')?.textContent.includes('Synthetic page failed') && document.querySelector('.collection').getAttribute('aria-busy')==='false'`));
  assert.ok(await evaluate(`new URLSearchParams(location.search).get('offset')==='100' && JSON.stringify([...document.querySelectorAll('[data-item-id]')].map(b=>b.dataset.itemId))===JSON.stringify(window.fixtureFirstPage) && !document.querySelector('[aria-label="Item pages"]').textContent.includes('Items')`));
  await screenshot('pagination-failed-503');
  await click('Retry');
  await waitFor(() => evaluate(`document.querySelectorAll('.item-card').length===3 && document.querySelector('[aria-label="Item pages"]').textContent.includes('Items 101–103')`));
  assert.ok(await evaluate(`new URLSearchParams(location.search).get('offset')==='100' && [...document.querySelectorAll('[aria-label="Item pages"] button')].find(b=>b.textContent==='Next').disabled && !document.querySelector('[aria-label="Item pages"]').textContent.includes(' of ')`));
  await cdp('Emulation.setDeviceMetricsOverride', { width: 320, height: 740, deviceScaleFactor: 1, mobile: true }, sessionId);
  assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth`));
  await screenshot('320-pagination');
  console.log('PASS failed Next 503 retains first 100 cards without false range; successful Retry commits Items 101–103');
  await click('Previous');
  await waitFor(() => evaluate(`document.querySelectorAll('.item-card').length===100 && !new URLSearchParams(location.search).has('offset')`));
  await cdp('Page.navigate', { url: `http://127.0.0.1:${proxyPort}/?folder=${pageFolder}&offset=200` }, sessionId);
  await waitFor(() => evaluate(`!!document.querySelector('.empty button') && !!document.querySelector('[aria-label="Item pages"]')`));
  assert.ok(await evaluate(`!document.querySelector('[aria-label="Item pages"]').textContent.includes('Items') && !document.body.textContent.includes('1–0')`));
  // Long names/cards/URLs, unsafe replicated links and device-only media use only this disposable DB.
  const longName = 'Synthetic shelf ' + 'x'.repeat(184);
  const { id: overflowFolder } = await json('/folders', 'POST', { name: longName });
  const longHref = 'https://example.com/' + 'x'.repeat(200) + '?synthetic=1';
  const { id: longLink } = await json('/items', 'POST', { type: 'url', title: 'Long synthetic link', content: longHref, folderId: overflowFolder });
  await json('/items', 'POST', { type: 'text', title: 'T'.repeat(500), content: 'E'.repeat(1000), folderId: overflowFolder });
  for (const [id, type, content] of [
    ['fixture-unsafe', 'url', 'javascript:alert(1)'],
    ['fixture-media', 'image', null],
  ]) {
    removeFixture('INSERT INTO sync_items(id,type,content) VALUES (?,?,?)', id, type, content);
    removeFixture('INSERT INTO sync_item_folders(membership_id,item_id,folder_id) VALUES (?,?,?)', id, id, overflowFolder);
  }
  await cdp('Page.navigate', { url: `http://127.0.0.1:${proxyPort}/?folder=${overflowFolder}&item=${longLink}` }, sessionId);
  await waitFor(() => evaluate(`!!document.querySelector('.reader a') && document.querySelectorAll('.item-card').length===4`));
  assert.ok(await evaluate(`(()=>{const a=document.querySelector('.reader a');return a.href===${JSON.stringify(longHref)} && a.textContent===a.href && a.getBoundingClientRect().right<=innerWidth && document.getElementById(a.getAttribute('aria-describedby')).textContent==='Opens in a new tab' && document.documentElement.scrollWidth<=innerWidth})()`));
  await screenshot('320-long-link');
  await click('Back to collection');
  await waitFor(() => evaluate(`!new URLSearchParams(location.search).get('item')`));
  await click('Grid layout');
  await waitFor(() => evaluate(`document.querySelector('.items').classList.contains('grid')`));
  assert.ok(await evaluate(`(()=>{const h=document.querySelector('.collection-heading h2'),cards=[...document.querySelectorAll('.item-card')];return h.title===${JSON.stringify(longName)} && h.getBoundingClientRect().height<=parseFloat(getComputedStyle(h).lineHeight)*2+1 && cards.every(c=>c.getBoundingClientRect().right<=innerWidth) && document.documentElement.scrollWidth<=innerWidth && cards.some(c=>c.querySelector('small').textContent==='Link') && cards.some(c=>c.querySelector('small').textContent==='Media · available on device')})()`));
  await screenshot('320-long-title-grid');
  await evaluate(`document.querySelector('[data-item-id="fixture-unsafe"]').click()`);
  await waitFor(() => evaluate(`document.querySelector('.reader').textContent.includes('unsafe to open')`));
  assert.equal(await evaluate(`document.querySelectorAll('.reader a, .external-link-hint').length`), 0);
  await click('Back to collection');
  await evaluate(`document.querySelector('[data-item-id="fixture-media"]').click()`);
  await waitFor(() => evaluate(`document.querySelector('.reader').textContent.includes('Media unavailable on the web')`));
  assert.equal(await evaluate(`document.querySelectorAll('.reader img, .reader video').length`), 0);
  console.log('PASS 320px long heading/card/URL overflow, unsafe replicated Link label without anchor/hint, and honest device-only media');
  if (process.env.STASH_DENSITY_REFERENCE !== "1") await folderInteractions({
    evaluate, cdp: (method, params) => cdp(method, params, sessionId), click, waitFor, screenshot, json,
    base: `http://127.0.0.1:${proxyPort}`, removeFixture,
    confirm: async (action, accept) => {
      const pending = action();
      await waitFor(() => !!dialog);
      assert.match(dialog.message, /unsaved/i);
      await cdp("Page.handleJavaScriptDialog", { accept }, sessionId);
      await pending;
      dialog = null;
    },
  });
  if (process.env.STASH_DENSITY_REFERENCE !== "1") await refactorComposition({
    evaluate, cdp: (method, params) => cdp(method, params, sessionId), click, waitFor, screenshot, json,
    base: `http://127.0.0.1:${proxyPort}`,
    confirm: async (action, accept) => {
      const pending = action();
      await waitFor(() => !!dialog);
      assert.match(dialog.message, /unsaved/i);
      await cdp("Page.handleJavaScriptDialog", { accept }, sessionId);
      await pending;
      dialog = null;
    },
  });
  console.log(process.env.STASH_DENSITY_REFERENCE === '1'
    ? 'PASS baseline behavior; density metrics recorded only (compact acceptance intentionally disabled)'
    : 'PASS compact density/chrome/panes/grid/touch controls and preserved UI safeguards: compact list/sticky toolbar/empty CTAs/forms+busy/help/membership/layout group/card labels/new-tab hint/truthful pagination');
  console.log("PASS real remote filter removal preserves unrelated new-folder DOM/value/dirty protection and invalidates owned rename");
  console.log(
    "PASS Tailwind static CSS, exact two-column odd grid, independent scrolling/retention, layout persistence, folder creation/atomic filing, deep link/Back, real dirty-draft confirmation, item/folder-removal invalidation, archive/Undo, keyboard/focus, narrow drawers and 200% layout",
  );
  const protocol = Buffer.from("room=stash-backend")
    .toString("base64")
    .replace(/=+$/, "");
  const announced = Buffer.from(
    encode({
      _tag: tags.AnnouncePresence,
      sender: new Uint8Array(16).fill(42),
      lastSeens: [],
      schemaName: health.schema,
      schemaVersion: BigInt(health.schemaVersion),
    }),
  ).toString("base64");
  const wsExpr = `new Promise(resolve=>{const w=new WebSocket('ws://127.0.0.1:${proxyPort}/sync','${protocol}');w.binaryType='arraybuffer';const frames=[];let opened=false;const timer=setTimeout(()=>{w.close();resolve({opened,frames,timeout:true})},1500);w.onopen=()=>{opened=true;w.send(Uint8Array.from(atob('${announced}'),x=>x.charCodeAt(0)))};w.onmessage=e=>{frames.push(Array.from(new Uint8Array(e.data)));if(frames.length>=2){clearTimeout(timer);w.close();resolve({opened,frames})}};w.onerror=()=>{clearTimeout(timer);resolve({opened,frames,error:true})}})`;
  const sameWs = await evaluate(wsExpr);
  assert.equal(sameWs.opened, true, JSON.stringify(sameWs));
  assert.ok(
    sameWs.frames
      .map((f) => decode(Uint8Array.from(f)))
      .some(
        (m) =>
          m._tag === tags.Changes &&
          m.changes.some((c) => c[3] === "security-synthetic-only"),
      ),
  );
  console.log(
    "PASS same-origin browser WebSocket uses cached Basic auth and replicates",
  );
  await cdp(
    "Page.navigate",
    { url: `http://localhost:${attackerPort}/` },
    sessionId,
  );
  await waitFor(
    async () =>
      await evaluate(
        `location.port==='${attackerPort}' && document.readyState==='complete'`,
      ),
  );
  const evil = await evaluate(wsExpr);
  console.log(
    "CROSS_SITE_RESULT " +
      JSON.stringify({
        opened: evil.opened,
        frameCount: evil.frames.length,
        error: evil.error ?? false,
      }),
  );
  await delay(200);
  const access = caddyLogs
    .split("\n")
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    })
    .filter((entry) => entry.request?.uri === "/sync");
  console.log(
    "CADDY_WS_HANDSHAKES " +
      JSON.stringify(
        access.map((entry) => ({
          status: entry.status,
          origin: entry.request.headers.Origin,
          fetchSite: entry.request.headers["Sec-Fetch-Site"],
        })),
      ),
  );
  assert.equal(
    evil.opened,
    false,
    "Cross-site browser WebSocket must not authenticate with cached Basic credentials",
  );
  assert.equal(
    evil.frames.length,
    0,
    "No replicated data may reach attacker origin",
  );
  assert.ok(access.some((entry) => entry.status === 101));
  assert.ok(access.some((entry) => entry.status === 401));
  console.log(
    "PASS cross-site browser WebSocket rejected; no private synthetic frames disclosed",
  );
} finally {
  for (const fn of cleanup.reverse()) await fn();
}
