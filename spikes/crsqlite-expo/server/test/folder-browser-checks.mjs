import assert from "node:assert/strict";

/** Actual bundled components in Chromium: no mocked dialog/focus/menu geometry. */
export async function folderInteractions({ evaluate, cdp, click, waitFor, screenshot, json, base, removeFixture, confirm }) {
  const { id: selected } = await json("/folders", "POST", { name: "Selected shelf" });
  const { id: target } = await json("/folders", "POST", { name: "Target shelf" });
  const route = `?folder=${selected}`;
  const go = async () => {
    await cdp("Page.navigate", { url: base + "/" + route });
    await waitFor(() => evaluate(`document.querySelector('.collection h2')?.textContent==='Selected shelf' && document.querySelector('.collection').getAttribute('aria-busy')==='false'`));
  };
  const key = async (key, code = key, modifiers = 0) => {
    const windowsVirtualKeyCode = { Escape: 27, Tab: 9, ArrowDown: 40, ArrowUp: 38, Home: 36, End: 35, ContextMenu: 93, F10: 121 }[key];
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", key, code, modifiers, windowsVirtualKeyCode });
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key, code, modifiers, windowsVirtualKeyCode });
  };
  const point = async (selector) => evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  const row = `.folder-link[title="Target shelf"]`;
  const fallback = `[aria-label="Actions for Target shelf"]`;
  const openMenu = async () => {
    await evaluate(`document.querySelector(${JSON.stringify(fallback)}).click()`);
    await waitFor(() => evaluate(`!!document.querySelector('[role=menu]')`));
  };
  const rename = async () => { await openMenu(); await click("Rename"); await waitFor(() => evaluate(`!!document.querySelector('dialog[open]')`)); };
  const input = async (name) => evaluate(`(()=>{const n=document.querySelector('dialog input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(name)});n.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  const modalClosed = () => waitFor(() => evaluate(`!document.querySelector('dialog')`));
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "pointer", value: "fine" }, { name: "prefers-reduced-motion", value: "no-preference" }] });
  await go();
  assert.equal(await evaluate(`document.querySelector('.app-header h1').textContent.trim()`), "Stash");
  assert.ok(await evaluate(`!document.querySelector('.sidebar h2,.sidebar .nav-label,.folder-actions') && !document.body.textContent.includes('Your collection') && !document.body.textContent.includes('A little space for later.') && !document.querySelector('button button')`));
  assert.ok(await evaluate(`getComputedStyle(document.querySelector('[aria-label=Refresh] .spinner')).animationName==='none' && document.querySelector('.spinner').getAttribute('aria-hidden')==='true'`));
  await evaluate(`window.fixtureOriginalFetch=window.fetch;window.fetch=async (...a)=>{await new Promise(r=>setTimeout(r,650));return window.fixtureOriginalFetch(...a)};document.querySelector('[aria-label=Refresh]').click()`);
  await waitFor(() => evaluate(`/Loading|Refreshing/.test(document.querySelector('[role=status]').textContent)`));
  assert.ok(await evaluate(`getComputedStyle(document.querySelector('.spinner')).animationName==='spin' && getComputedStyle(document.querySelector('.spinner')).animationDuration==='0.8s' && getComputedStyle(document.querySelector('.spinner')).color==='rgb(124, 106, 247)'`));
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  assert.ok(await evaluate(`[...document.querySelectorAll('.spinner')].every(s=>getComputedStyle(s).animationName==='none')`));
  await waitFor(() => evaluate(`document.querySelector('.collection').getAttribute('aria-busy')==='false'`));
  await evaluate(`window.fetch=window.fixtureOriginalFetch`);
  await cdp("Emulation.setEmulatedMedia", { features: [] });
  // Real right click on NONSELECTED row, not a dispatchEvent approximation.
  const p = await point(row);
  await cdp("Input.dispatchMouseEvent", { type: "mousePressed", button: "right", clickCount: 1, ...p });
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", button: "right", clickCount: 1, ...p });
  await waitFor(() => evaluate(`document.querySelector('[role=menu]')?.getAttribute('aria-label')==='Actions for Target shelf'`));
  assert.equal(await evaluate(`location.search`), route);
  assert.ok(await evaluate(`[...document.querySelectorAll('.folder-row')].every(r=>r.getBoundingClientRect().height===32)`));
  assert.equal(await evaluate(`document.activeElement.textContent`), "Rename");
  await key("ArrowDown");
  assert.equal(await evaluate(`document.activeElement.textContent.trim()`), "Archive folder");
  await key("Home");
  assert.equal(await evaluate(`document.activeElement.textContent`), "Rename");
  await screenshot("desktop-folder-context");
  await key("Escape");
  assert.ok(await evaluate(`!document.querySelector('[role=menu]') && document.activeElement.title==='Target shelf'`));
  await key("F10", "F10", 8);
  await waitFor(() => evaluate(`!!document.querySelector('[role=menu]')`));
  await key("End");
  assert.equal(await evaluate(`document.activeElement.textContent.trim()`), "Atom feed");
  await key("Escape");
  await key("ContextMenu", "ContextMenu");
  await waitFor(() => evaluate(`!!document.querySelector('[role=menu]')`));
  const outside = await point(".app-header h1");
  await cdp("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...outside });
  await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...outside });
  assert.equal(await evaluate(`!!document.querySelector('[role=menu]')`), false);
  await rename();
  assert.ok(await evaluate(`document.activeElement.name==='name' && document.activeElement.value==='Target shelf' && document.querySelector('dialog').getAttribute('aria-labelledby')==='rename-folder-title'`));
  for (let n = 0; n < 5; n++) { await key("Tab"); assert.ok(await evaluate(`document.querySelector('dialog').contains(document.activeElement)`)); }
  await key("Tab", "Tab", 8);
  assert.ok(await evaluate(`document.querySelector('dialog').contains(document.activeElement)`));
  await screenshot("desktop-folder-rename-modal");
  await input("Unsaved target");
  await confirm(() => key("Escape"), false);
  assert.equal(await evaluate(`document.querySelector('dialog input').value`), "Unsaved target");
  await confirm(() => click("Cancel"), false);
  assert.equal(await evaluate(`document.querySelector('dialog input').value`), "Unsaved target");
  await confirm(() => cdp("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, x: 5, y: 5 }).then(() => cdp("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x: 5, y: 5 })), true);
  await modalClosed();
  assert.equal(await evaluate(`document.activeElement.getAttribute('aria-label')`), "Actions for Target shelf");
  assert.equal(await evaluate(`location.search`), route);
  // Frozen baseline/no-op must not overwrite a remote rename or send a PATCH.
  await rename();
  await json(`/folders/${target}`, "PATCH", { name: "Remote target" });
  await evaluate(`window.dispatchEvent(new Event('focus'))`);
  await waitFor(() => evaluate(`!!document.querySelector('[aria-label="Actions for Remote target"]')`));
  assert.equal(await evaluate(`document.querySelector('dialog input').value`), "Target shelf");
  await click("Rename folder");
  await modalClosed();
  assert.equal((await json("/folders")).find(f => f.id === target).name, "Remote target");
  // Actual menu Archive writes the nonselected folder without moving the reader/filter.
  await evaluate(`document.querySelector('[aria-label="Actions for Remote target"]').click()`);
  await click("Archive folder");
  await waitFor(() => evaluate(`!document.querySelector('[role=menu]') && !document.querySelector('[aria-label="New item"]').disabled && document.querySelector('.collection').getAttribute('aria-busy')==='false'`));
  assert.notEqual((await json("/folders")).find(f => f.id === target).archived_at, null);
  assert.equal(await evaluate(`location.search`), route);
  await json(`/folders/${target}`, "PATCH", { archived: false });
  await click("Refresh");
  await waitFor(() => evaluate(`!!document.querySelector('[aria-label="Actions for Remote target"]')`));
  // Live context state changes from Archive to Unarchive without touching selected route.
  await evaluate(`document.querySelector('[aria-label="Actions for Remote target"]').click()`);
  await json(`/folders/${target}`, "PATCH", { archived: true });
  await click("Refresh");
  await waitFor(() => evaluate(`document.querySelector('[role=menu]')?.textContent.includes('Unarchive folder')`));
  await click("Unarchive folder");
  await waitFor(() => evaluate(`!document.querySelector('[role=menu]') && !document.querySelector('[aria-label="New item"]').disabled && document.querySelector('.collection').getAttribute('aria-busy')==='false'`));
  assert.equal((await json("/folders")).find(f => f.id === target).archived_at, null);
  assert.equal(await evaluate(`location.search`), route);
  // Submit the actual rename modal, including pending guards and a failed retry.
  await evaluate(`document.querySelector('[aria-label="Actions for Remote target"]').click()`);
  await click("Rename");
  await waitFor(() => evaluate(`!!document.querySelector('dialog[open]')`));
  await input("Target shelf");
  await evaluate(`window.fixtureRenameFetch=window.fetch;window.fetch=async (...a)=>{if(a[0]===${JSON.stringify(`/api/folders/${target}`)}&&a[1]?.method==='PATCH'){await new Promise(r=>setTimeout(r,650));window.fetch=window.fixtureRenameFetch;return Response.json({error:'Synthetic rename failed'},{status:503})}return window.fixtureRenameFetch(...a)}`);
  await click("Rename folder");
  await waitFor(() => evaluate(`document.querySelector('dialog').getAttribute('aria-busy')==='true'`));
  assert.equal(await evaluate(`document.querySelector('dialog input').disabled`), true);
  await key("Escape");
  assert.equal(await evaluate(`!!document.querySelector('dialog[open]')`), true);
  await waitFor(() => evaluate(`document.querySelector('[role=alert]')?.textContent.includes('Synthetic rename failed')`));
  assert.equal(await evaluate(`document.querySelector('dialog input').value`), "Target shelf");
  await click("Rename folder");
  await modalClosed();
  assert.equal((await json("/folders")).find(f => f.id === target).name, "Target shelf");
  assert.equal(await evaluate(`location.search`), route);
  await waitFor(() => evaluate(`!!document.querySelector(${JSON.stringify(fallback)})`));
  // HTTP response fixtures exercise capability and late-result failures against
  // either backend policy. The dialog itself never sends an enable/disable PUT.
  const oldRead = await json(`/folders/${target}/feed`);
  await evaluate(`window.fixtureFeedReply=${JSON.stringify({ ...oldRead, policy: "always-on", enabled: true })};window.fixtureFeedFetch=window.fetch;window.fixtureFeedReads=0;window.fetch=async (...a)=>{if(a[0]===${JSON.stringify(`/api/folders/${target}/feed`)}){if(a[1]?.method!=='GET')throw Error('Feed UI must be read-only');window.fixtureFeedReads++;if(window.fixtureHoldFeed)await new Promise(r=>window.fixtureReleaseFeed=r);return Response.json(window.fixtureFeedReply)}return window.fixtureFeedFetch(...a)}`);
  const openFeed = async () => { await openMenu(); await click("Atom feed"); await waitFor(() => evaluate(`!!document.querySelector('dialog[open]')`)); };
  await click("New item");
  await waitFor(() => evaluate(`!!document.querySelector('textarea')`));
  await evaluate(`(()=>{const n=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(n,'Retained beneath feed dialog');n.dispatchEvent(new Event('input',{bubbles:true}));window.fixtureDraft=n})()`);
  await openFeed();
  await waitFor(() => evaluate(`!!document.querySelector('input[name=feed-url]')`));
  assert.ok(await evaluate(`document.querySelector('input[name=feed-url]').readOnly && document.querySelector('input[name=feed-url]').value===window.fixtureFeedReply.url && document.querySelector('dialog').textContent.includes('HTTP Basic authentication') && !document.querySelector('dialog').textContent.includes('Disable') && document.querySelector('textarea')===window.fixtureDraft`));
  await cdp("Browser.grantPermissions", { origin: base, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
  await click("Copy URL");
  await waitFor(() => evaluate(`document.querySelector('dialog [aria-live]').textContent==='Copied URL.'`));
  assert.equal(await evaluate(`navigator.clipboard.readText()`), oldRead.url);
  await screenshot("desktop-folder-feed-modal");
  await click("Close");
  await modalClosed();
  assert.equal(await evaluate(`document.querySelector('textarea').value`), "Retained beneath feed dialog");
  await confirm(() => click("Cancel"), false);
  assert.equal(await evaluate(`document.querySelector('textarea')===window.fixtureDraft`), true);
  await confirm(() => click("Cancel"), true);
  await waitFor(() => evaluate(`!document.querySelector('textarea')`));
  // Wrong-target/credential-bearing/capability-less results never become links.
  for (const reply of [{ ...oldRead, policy: "always-on", enabled: true, url: 'https://user:secret@feeds.example/feeds/folders/other.atom' }, { ...oldRead, enabled: true, policy: undefined }]) {
    await evaluate(`window.fixtureFeedReply=${JSON.stringify(reply)}`);
    await openFeed();
    await waitFor(() => evaluate(`!!document.querySelector('dialog [role=alert]')`));
    assert.equal(await evaluate(`!!document.querySelector('input[name=feed-url]')`), false);
    await click("Close");
    await modalClosed();
  }
  await evaluate(`window.fixtureFeedReply=${JSON.stringify({ ...oldRead, policy: "always-on", enabled: true })};window.fixtureHoldFeed=true`);
  await openFeed();
  await waitFor(() => evaluate(`!!window.fixtureReleaseFeed`));
  await click("Close");
  await modalClosed();
  await click("New folder");
  await evaluate(`(()=>{const n=document.querySelector('input[name=name]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,'Retained after late feed');n.dispatchEvent(new Event('input',{bubbles:true}));window.fixtureLateDraft=n;window.fixtureReleaseFeed()})()`);
  await waitFor(() => evaluate(`document.querySelector('input[name=name]')?.value==='Retained after late feed'`));
  assert.ok(await evaluate(`document.querySelector('dialog')?.getAttribute('aria-labelledby')==='new-folder-title' && document.querySelector('input[name=name]')===window.fixtureLateDraft`));
  await confirm(() => click("Cancel"), true);
  await evaluate(`window.fetch=window.fixtureFeedFetch`);
  console.log("PASS target-owned Atom URL dialog: GET-only capability validation, private-auth copy via real clipboard, unsafe/old-backend errors, retained item/new-folder drafts and ignored late response");
  // Touch fallback + viewport clamping + modal coarse controls at 320px.
  await cdp("Emulation.setDeviceMetricsOverride", { width: 320, height: 740, deviceScaleFactor: 1, mobile: true });
  await cdp("Emulation.setTouchEmulationEnabled", { enabled: true });
  await cdp("Emulation.setEmulatedMedia", { features: [{ name: "pointer", value: "coarse" }] });
  await click("Open folders");
  const touch = await point(fallback);
  await cdp("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...touch, id: 1 }] });
  await cdp("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await waitFor(() => evaluate(`!!document.querySelector('[role=menu]')`));
  assert.ok(await evaluate(`(()=>{const m=document.querySelector('[role=menu]').getBoundingClientRect();return m.x>=0&&m.right<=innerWidth&&m.bottom<=innerHeight&&[...document.querySelectorAll('[role=menu] button,.folder-menu-toggle')].every(b=>b.getBoundingClientRect().height>=44)})()`));
  await screenshot("320-touch-folder-context");
  await key("Escape");
  await evaluate(`document.querySelector(${JSON.stringify(row)}).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:innerWidth-1,clientY:innerHeight-1}))`);
  await waitFor(() => evaluate(`!!document.querySelector('[role=menu]')`));
  assert.ok(await evaluate(`(()=>{const r=document.querySelector('[role=menu]').getBoundingClientRect();return r.right<=innerWidth-7&&r.bottom<=innerHeight-7})()`));
  await click("Rename");
  await waitFor(() => evaluate(`!!document.querySelector('dialog[open]')`));
  assert.ok(await evaluate(`(()=>{const d=document.querySelector('dialog').getBoundingClientRect();return d.x>=0&&d.right<=innerWidth&&document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll('dialog button,dialog input')].every(b=>b.getBoundingClientRect().height>=44)})()`));
  await screenshot("320-touch-folder-modal");
  await click("Cancel");
  await modalClosed();
  // Target ownership remains safe when it disappears/archives during a dirty rename.
  await rename();
  await input("Invalidated draft");
  await json(`/folders/${target}`, "PATCH", { archived: true });
  await evaluate(`window.dispatchEvent(new Event('focus'))`);
  await modalClosed();
  assert.equal(await evaluate(`location.search`), route);
  await json(`/folders/${target}`, "PATCH", { archived: false });
  await click("Refresh");
  await waitFor(() => evaluate(`!!document.querySelector(${JSON.stringify(fallback)})`));
  // Close a live menu on deletion, then separately invalidate an in-flight feed.
  const { id: deadMenu } = await json("/folders", "POST", { name: "Deleted menu target" });
  await click("Refresh");
  await waitFor(() => evaluate(`!!document.querySelector('[aria-label="Actions for Deleted menu target"]')`));
  await evaluate(`document.querySelector('[aria-label="Actions for Deleted menu target"]').click()`);
  removeFixture("DELETE FROM sync_folders WHERE id=?", deadMenu);
  await click("Refresh");
  await waitFor(() => evaluate(`!document.querySelector('[role=menu]')`));
  assert.equal(await evaluate(`location.search`), route);
  await evaluate(`window.fixtureFeedReply=${JSON.stringify({ ...oldRead, policy: "always-on", enabled: true })};window.fixtureFeedFetch=window.fetch;window.fixtureReleaseFeed=null;window.fetch=async (...a)=>{if(a[0]===${JSON.stringify(`/api/folders/${target}/feed`)}){await new Promise(r=>window.fixtureReleaseFeed=r);return Response.json(window.fixtureFeedReply)}return window.fixtureFeedFetch(...a)}`);
  // New is modal now: never open a second dialog through an inert background.
  await openFeed();
  await waitFor(() => evaluate(`!!window.fixtureReleaseFeed`));
  await screenshot("320-touch-folder-feed-loading");
  removeFixture("DELETE FROM sync_folders WHERE id=?", target);
  await evaluate(`window.dispatchEvent(new Event('focus'))`);
  await modalClosed();
  await click("New folder");
  await evaluate(`(()=>{const n=document.querySelector('input[name=name]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,'Draft after deleted feed');n.dispatchEvent(new Event('input',{bubbles:true}));window.fixtureDeletedFeedDraft=n;window.fixtureReleaseFeed();window.fetch=window.fixtureFeedFetch})()`);
  assert.ok(await evaluate(`document.querySelector('dialog')?.getAttribute('aria-labelledby')==='new-folder-title'&&document.querySelector('input[name=name]')===window.fixtureDeletedFeedDraft&&window.fixtureDeletedFeedDraft.value==='Draft after deleted feed'`));
  await confirm(() => click("Cancel"), true);
  assert.equal(await evaluate(`location.search`), route);
  await key("Escape");
  await cdp("Emulation.setTouchEmulationEnabled", { enabled: false });
  await cdp("Emulation.setEmulatedMedia", { features: [] });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  console.log("PASS actual Stash brand/single navigation, Heroicons idle/loading/reduced motion; right-click nonselected target, keyboard menu, modal focus/trap/discard/backdrop/frozen save, live target state/deletion and 320px touch fallback");
}
