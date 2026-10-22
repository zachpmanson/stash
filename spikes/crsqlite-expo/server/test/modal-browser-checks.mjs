import assert from "node:assert/strict";

/** Real native dialogs, pointer/keyboard input and computed layout at both sizes. */
export async function modalConsistency({ evaluate, cdp, click, waitFor, screenshot, json, base, removeFixture, confirm }) {
  const { id: selected } = await json("/folders", "POST", { name: "Modal selected fixture" });
  const longName = ("Long Atom folder title · " + "readable wrapping ".repeat(9)).trim();
  const { id: target } = await json("/folders", "POST", { name: longName });
  const key = async (key, modifiers = 0) => {
    const windowsVirtualKeyCode = { Escape: 27, Tab: 9 }[key];
    for (const type of ["keyDown", "keyUp"]) await cdp("Input.dispatchKeyEvent", { type, key, code: key, windowsVirtualKeyCode, modifiers });
  };
  const pointer = async (selector) => {
    const p = await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.scrollIntoView({block:'nearest'});const r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    for (const type of ["mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", { type, button: "left", clickCount: 1, ...p });
  };
  const backdrop = async () => {
    for (const type of ["mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", { type, button: "left", clickCount: 1, x: 2, y: 2 });
  };
  const closed = () => waitFor(() => evaluate(`!document.querySelector('dialog')`));
  const input = (name) => evaluate(`(()=>{const n=document.querySelector('dialog input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(name)});n.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  const metrics = () => evaluate(`(()=>{
    const d=document.querySelector('dialog'),h=d.querySelector('h2'),header=d.querySelector('.dialog-header'),body=d.querySelector('.dialog-body'),actions=d.querySelector('.dialog-actions');
    const s=getComputedStyle(h),a=getComputedStyle(actions),b=getComputedStyle(body),ds=getComputedStyle(d),hs=getComputedStyle(header);
    const prior=actions.previousElementSibling;
    return {fontSize:s.fontSize,fontWeight:s.fontWeight,lineHeight:s.lineHeight,titleMargin:s.margin,titlePadding:s.padding,
      padding:ds.padding,headerMargin:hs.margin,bodyGap:b.rowGap,actionGap:a.gap,actionMargin:a.margin,actionPadding:a.padding,
      headerBodyGap:Math.round(body.getBoundingClientRect().top-header.getBoundingClientRect().bottom),
      sectionActionGap:Math.round(actions.getBoundingClientRect().top-prior.getBoundingClientRect().bottom)};
  })()`);
  const expected = { fontSize: "16px", fontWeight: "600", lineHeight: "20.8px", titleMargin: "0px", titlePadding: "0px", padding: "16px", headerMargin: "0px 0px 12px", bodyGap: "12px", actionGap: "8px", actionMargin: "0px", actionPadding: "0px", headerBodyGap: 12, sectionActionGap: 12 };
  const bounded = async (coarse) => assert.ok(await evaluate(`(()=>{const d=document.querySelector('dialog'),r=d.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth&&r.y>=0&&r.bottom<=innerHeight&&d.scrollWidth<=d.clientWidth&&document.documentElement.scrollWidth<=innerWidth&&[...d.querySelectorAll('button,input')].every(n=>{const b=n.getBoundingClientRect();return b.right<=r.right&&b.left>=r.left${coarse ? "&&b.height>=44" : ""}})})()`), "bounded modal/fields/actions without horizontal overflow");
  for (const width of [1440, 320]) {
    const coarse = width === 320;
    await cdp("Emulation.setDeviceMetricsOverride", { width, height: coarse ? 740 : 1000, deviceScaleFactor: 1, mobile: coarse });
    await cdp("Emulation.setTouchEmulationEnabled", { enabled: coarse });
    await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await cdp("Page.navigate", { url: `${base}/?folder=${selected}` });
    await waitFor(() => evaluate(`document.querySelector('.collection')?.getAttribute('aria-busy')==='false' && !!document.querySelector('.new-folder')`));
    if (coarse) await click("Open folders");
    await evaluate(`void(window.modalTrigger=document.querySelector('.new-folder'))`);
    await pointer(".new-folder");
    await waitFor(() => evaluate(`document.querySelector('dialog[open]')?.matches(':modal')`));
    assert.ok(await evaluate(`document.querySelectorAll('input[name=name]').length===1 && document.activeElement.name==='name' && document.querySelector('dialog').getAttribute('aria-labelledby')==='new-folder-title' && document.querySelector('dialog label').textContent.trim()==='Folder name'`));
    assert.deepEqual(await metrics(), expected);
    await bounded(coarse);
    await screenshot(`${width}-new-modal`);
    // Focus attempts cannot escape the UA's inert background. Real Tab/Shift+Tab loop.
    assert.ok(await evaluate(`(()=>{document.querySelector('[aria-label="New item"]').focus();return document.querySelector('dialog').contains(document.activeElement)})()`));
    for (let n = 0; n < 7; n++) {
      await key("Tab", n > 3 ? 8 : 0);
      assert.ok(await evaluate(`document.querySelector('dialog').contains(document.activeElement)`));
    }
    await key("Escape");
    await closed();
    await waitFor(() => evaluate(`document.activeElement===window.modalTrigger`));
    await pointer(".new-folder");
    // The real background New item coordinates hit the modal backdrop, never its button.
    await pointer('[aria-label="New item"]');
    await closed();
    assert.equal(await evaluate(`!!document.querySelector('textarea')`), false);
    await waitFor(() => evaluate(`document.activeElement===window.modalTrigger`));
    await pointer(".new-folder");
    await input("Retained create draft");
    await evaluate(`window.modalDraft=document.querySelector('dialog input');void(window.modalForm=window.modalDraft.form)`);
    await confirm(() => key("Escape"), false);
    await confirm(backdrop, false);
    await confirm(() => click("Cancel"), false);
    assert.ok(await evaluate(`document.querySelector('dialog input')===window.modalDraft && window.modalDraft.value==='Retained create draft' && !document.querySelector('textarea')`));
    // Local write failure is held explicitly, so pending guards are deterministic.
    await evaluate(`window.modalFetch=window.fetch;window.modalPosts=0;window.fetch=async (...a)=>{if(a[0]==='/api/folders'&&a[1]?.method==='POST'){window.modalPosts++;return new Promise(r=>window.releaseModalFailure=()=>r(Response.json({error:'Synthetic create failed; retry safely.'},{status:503})))}return window.modalFetch(...a)}`);
    await pointer("dialog button[type=submit]");
    await waitFor(() => evaluate(`document.querySelector('dialog').getAttribute('aria-busy')==='true' && !!window.releaseModalFailure`));
    assert.ok(await evaluate(`document.querySelector('dialog input').disabled && [...document.querySelectorAll('dialog button')].every(b=>b.disabled) && document.querySelector('dialog .primary').textContent.includes('Creating') && getComputedStyle(document.querySelector('dialog .spinner')).animationName==='none'`));
    await key("Escape");
    await backdrop();
    const busyRoute = await evaluate(`location.search`);
    await evaluate(`history.pushState(null,'','?archive=1');window.dispatchEvent(new PopStateEvent('popstate'))`);
    assert.equal(await evaluate(`location.search`), busyRoute, "busy browser navigation is rejected without discard");
    await evaluate(`window.modalForm.requestSubmit();window.modalForm.requestSubmit()`);
    assert.equal(await evaluate(`window.modalPosts`), 1);
    assert.ok(await evaluate(`!!document.querySelector('dialog[open]')`));
    await screenshot(`${width}-new-busy`);
    await evaluate(`window.releaseModalFailure()`);
    await waitFor(() => evaluate(`document.querySelector('dialog [role=alert]')?.textContent.includes('Synthetic create failed') && document.querySelector('dialog').getAttribute('aria-busy')==='false'`));
    assert.ok(await evaluate(`document.querySelector('dialog input')===window.modalDraft && window.modalDraft.value==='Retained create draft' && document.querySelectorAll('[role=alert]').length===1`));
    await bounded(coarse);
    await screenshot(`${width}-new-error`);
    await evaluate(`window.fetch=window.modalFetch`);
    await click("Create");
    await closed();
    await waitFor(() => evaluate(`document.querySelector('.collection h2')?.textContent==='Retained create draft' && document.querySelector('.collection')?.getAttribute('aria-busy')==='false'`));
    assert.ok(await evaluate(`(()=>{const n=document.activeElement;return n instanceof HTMLButtonElement && n.getClientRects().length>0 && getComputedStyle(n).visibility==='visible' && ${coarse ? "n.getAttribute('aria-label')==='Open folders' && !document.querySelector('.sidebar.is-open')" : "n===window.modalTrigger"}})()`), "success restores a visible control, not the now-hidden drawer trigger");
    assert.ok(await evaluate(`!new URLSearchParams(location.search).get('item') && !new URLSearchParams(location.search).get('offset')`));
    if (coarse) await click("Open folders");
    const menuSelector = `[aria-label=${JSON.stringify(`Actions for ${longName}`)}]`;
    const openMenu = () => pointer(menuSelector);
    await openMenu();
    await click("Rename");
    await waitFor(() => evaluate(`!!document.querySelector('dialog[open]')`));
    assert.deepEqual(await metrics(), expected);
    await bounded(coarse);
    await screenshot(`${width}-rename-modal`);
    await click("Cancel");
    await closed();
    const longOrigin = `https://${"a".repeat(60)}.${"b".repeat(60)}.${"c".repeat(60)}.example`;
    const feed = { version: 1, policy: "always-on", enabled: true, backend: longOrigin, url: `${longOrigin}/feeds/folders/${target}.atom` };
    await evaluate(`window.modalFeedFetch=window.fetch;window.modalFeedMode='loading';window.fetch=async (...a)=>{if(a[0]===${JSON.stringify(`/api/folders/${target}/feed`)}){if(a[1]?.method!=='GET')throw Error('GET only');if(window.modalFeedMode==='loading')await new Promise(r=>window.releaseModalFeed=r);if(window.modalFeedMode==='error')return Response.json({error:'Synthetic feed load failed.'},{status:503});return Response.json(${JSON.stringify(feed)})}return window.modalFeedFetch(...a)}`);
    await openMenu();
    await click("Atom feed");
    await waitFor(() => evaluate(`!!window.releaseModalFeed && !!document.querySelector('dialog .feed-status')`));
    assert.deepEqual(await metrics(), expected);
    await bounded(coarse);
    await screenshot(`${width}-atom-loading`);
    await evaluate(`window.modalFeedMode='error';window.releaseModalFeed()`);
    await waitFor(() => evaluate(`!!document.querySelector('dialog [role=alert]')`));
    assert.deepEqual(await metrics(), expected);
    await bounded(coarse);
    await screenshot(`${width}-atom-error`);
    await evaluate(`window.modalFeedMode='ready'`);
    await click("Retry");
    await waitFor(() => evaluate(`!!document.querySelector('input[name=feed-url]')`));
    assert.deepEqual(await metrics(), expected);
    assert.equal(await evaluate(`document.querySelector('input[name=feed-url]').value`), feed.url);
    await bounded(coarse);
    await cdp("Browser.grantPermissions", { origin: base, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
    await click("Copy URL");
    await waitFor(() => evaluate(`document.querySelector('.dialog-copy-status').textContent==='Copied URL.'`));
    assert.equal(await evaluate(`navigator.clipboard.readText()`), feed.url);
    assert.deepEqual(await metrics(), expected);
    await bounded(coarse);
    await screenshot(`${width}-atom-copied-long`);
    await click("Close");
    await closed();
    await evaluate(`window.fetch=window.modalFeedFetch`);
    console.log(`PASS ${width}px${coarse ? " coarse" : " desktop"} modal metrics ${JSON.stringify(expected)}; New focus/inert/Tab/discard/busy/error/retry/create/visible return, long Atom loading/error/URL/copied`);
  }
  // A timer/focus refresh, not a fake click through the inert dialog, invalidates filters.
  await cdp("Emulation.setTouchEmulationEnabled", { enabled: false });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp("Emulation.setEmulatedMedia", { features: [] });
  await cdp("Page.navigate", { url: `${base}/?folder=${selected}` });
  await waitFor(() => evaluate(`document.querySelector('.collection')?.getAttribute('aria-busy')==='false'`));
  await pointer(".new-folder");
  await input("Survives both deletions");
  await evaluate(`void(window.modalDraft=document.querySelector('dialog input'))`);
  for (const id of [target, selected]) {
    removeFixture("DELETE FROM sync_folders WHERE id=?", id);
    await evaluate(`window.dispatchEvent(new Event('focus'))`);
    await waitFor(() => evaluate(`document.querySelector('.collection')?.getAttribute('aria-busy')==='false' && ![...document.querySelectorAll('.folder-menu-toggle')].some(n=>n.getAttribute('aria-label')===${JSON.stringify(`Actions for ${id === target ? longName : "Modal selected fixture"}`)})`));
    assert.ok(await evaluate(`document.querySelector('dialog input')===window.modalDraft && window.modalDraft.value==='Survives both deletions'`));
  }
  assert.equal(await evaluate(`location.search`), "");
  await confirm(() => key("Escape"), false);
  await confirm(() => click("Cancel"), true);
  await closed();
  console.log("PASS new modal frozen DOM/draft/dirty protection across unrelated and selected-folder deletion");
}
