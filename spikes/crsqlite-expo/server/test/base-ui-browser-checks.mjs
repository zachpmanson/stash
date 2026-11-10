import assert from "node:assert/strict";

/** Unmocked Base UI bundle, actual keyboard input, and content-only scroll geometry. */
export async function baseUiChecks({ evaluate, cdp, click, waitFor, json, base }) {
  const key = async (key, windowsVirtualKeyCode, modifiers = 0) => {
    for (const type of ["keyDown", "keyUp"])
      await cdp("Input.dispatchKeyEvent", { type, key, code: key === " " ? "Space" : key, windowsVirtualKeyCode, modifiers,
        ...(key === "Enter" && type === "keyDown" ? { text: "\r", unmodifiedText: "\r" } : {}) });
  };
  const { id: folder } = await json("/folders", "POST", { name: "Base UI scroll fixture" });
  const { id: empty } = await json("/folders", "POST", { name: "Base UI empty fixture" });
  const { id: item } = await json("/items", "POST", { type: "text", title: "Scroll reader", content: "Reader paragraph.\n\n".repeat(300), folderId: folder });
  for (let n = 0; n < 35; n++)
    await json("/items", "POST", { type: "text", title: `Scroll note ${n}`, content: "Synthetic content only", folderId: folder });
  for (const width of [1440, 320]) {
    await cdp("Emulation.setDeviceMetricsOverride", { width, height: 740, deviceScaleFactor: 1, mobile: width === 320 });
    await cdp("Emulation.setTouchEmulationEnabled", { enabled: false });
    await cdp("Page.navigate", { url: `${base}/?folder=${folder}` });
    await waitFor(() => evaluate(`document.querySelectorAll('.item-card').length===36 && document.querySelector('.collection').getAttribute('aria-busy')==='false'`));
    assert.ok(await evaluate(`['Refresh','New item'].every(name=>{const b=document.querySelector('.app-header [aria-label="'+name+'"]');return b instanceof HTMLButtonElement && b.textContent.trim()==='' && !!b.querySelector('svg') && getComputedStyle(b.querySelector('svg')).display!=='none'})`), "named icon-only header actions remain visible at narrow widths");
    for (const name of ["Refresh", "New item"]) {
      await evaluate(`document.querySelector('.app-header [aria-label=${JSON.stringify(name)}]').focus()`);
      await waitFor(() => evaluate(`[...document.querySelectorAll('[role=tooltip]')].some(n=>n.textContent===${JSON.stringify(name)})`));
      await key("Escape", 27);
      await waitFor(() => evaluate(`!document.querySelector('[role=tooltip]')`));
    }
    await evaluate(`document.querySelector('[aria-label="List layout"]').focus()`);
    await key("ArrowRight", 39);
    await waitFor(() => evaluate(`document.activeElement.getAttribute('aria-label')==='Grid layout'`));
    await key(" ", 32);
    await waitFor(() => evaluate(`document.querySelector('.items').classList.contains('grid')`));
    await key(" ", 32);
    assert.ok(await evaluate(`document.querySelector('[aria-label="Grid layout"]').getAttribute('aria-pressed')==='true'`), "exclusive layout cannot be cleared");
    await click("List layout");
    await waitFor(() => evaluate(`document.querySelector('.items').classList.contains('flex')`));
    assert.ok(await evaluate(`(()=>{const p=document.querySelector('.collection-scroll'),h=document.querySelector('.collection-heading');window.scrollFixtureWidth=p.clientWidth;window.scrollFixtureHeader=h.getBoundingClientRect().toJSON();p.scrollTop=400;return p.scrollTop===400 && !p.contains(h) && getComputedStyle(p).scrollbarGutter==='stable' && h.getBoundingClientRect().bottom<=p.getBoundingClientRect().top && document.querySelector('.collection').scrollTop===0})()`));
    await evaluate(`document.querySelectorAll('.item-card')[18].focus()`);
    await key("ArrowUp", 38);
    assert.ok(await evaluate(`document.activeElement.classList.contains('item-card') && document.activeElement.getBoundingClientRect().top>=document.querySelector('.collection-heading').getBoundingClientRect().bottom`));
    // Navigate through the real guarded sidebar, rather than reloading (which
    // would conceal retained stale scroll offsets).
    if (width === 320) await click("Open folders");
    await evaluate(`document.querySelector('.folder-link[title="Base UI empty fixture"]').click()`);
    await waitFor(() => evaluate(`!!document.querySelector('.empty') && document.querySelector('.collection').getAttribute('aria-busy')==='false'`));
    assert.ok(await evaluate(`(()=>{const p=document.querySelector('.collection-scroll'),h=document.querySelector('.collection-heading');return p.scrollTop===0 && p.clientWidth===window.scrollFixtureWidth && h.getBoundingClientRect().top===window.scrollFixtureHeader.top && document.documentElement.scrollWidth<=innerWidth})()`), "folder switch resets only content scroll; gutter and header geometry stay stable without items");
    if (width === 320) await click("Open folders");
    await evaluate(`document.querySelector('.folder-link[title="Base UI scroll fixture"]').click()`);
    await waitFor(() => evaluate(`document.querySelectorAll('.item-card').length===36`));
    assert.equal(await evaluate(`document.querySelector('.collection-scroll').scrollTop`), 0);
    if (width === 1440) {
      await evaluate(`document.querySelector('.collection-scroll').scrollTop=400;document.querySelector('[data-item-id=${JSON.stringify(item)}]').click()`);
      await waitFor(() => evaluate(`!!document.querySelector('.organise') && document.activeElement.classList.contains('reader')`));
      assert.ok(await evaluate(`(()=>{const p=document.querySelector('.collection-scroll'),r=document.querySelector('.reader');r.scrollTop=250;return p.scrollTop===400 && r.scrollTop===250 && getComputedStyle(r).scrollbarGutter==='stable'})()`), "selection and reader scrolling do not alter collection offset");
      assert.ok(await evaluate(`document.querySelector('.organise-trigger').getAttribute('aria-expanded')==='false' && !document.querySelector('.organise .check').getBoundingClientRect().height`));
      await evaluate(`document.querySelector('.organise-trigger').focus()`);
      await key(" ", 32);
      await waitFor(() => evaluate(`document.querySelector('.organise-trigger').getAttribute('aria-expanded')==='true' && document.querySelector('.organise .check').getBoundingClientRect().height>0`));
      await evaluate(`[...document.querySelectorAll('.check')].find(n=>n.textContent.includes('Base UI empty fixture')).querySelector('.membership-checkbox').focus()`);
      await key(" ", 32);
      await waitFor(() => evaluate(`[...document.querySelectorAll('.check')].find(n=>n.textContent.includes('Base UI empty fixture')).querySelector('.membership-checkbox').getAttribute('aria-checked')==='true'`));
      assert.ok((await json(`/items/${item}`)).folderIds.includes(empty), "keyboard checkbox performs real membership mutation");
      await evaluate(`document.querySelector('.organise-trigger').focus()`);
      await key("Enter", 13);
      try {
        await waitFor(() => evaluate(`document.querySelector('.organise-trigger').getAttribute('aria-expanded')==='false' && !document.querySelector('.organise .check').getBoundingClientRect().height`));
      } catch (error) {
        console.log('COLLAPSIBLE_FAILURE', await evaluate(`({active:document.activeElement.outerHTML, organise:document.querySelector('.organise').outerHTML})`));
        throw error;
      }
      assert.ok(await evaluate(`document.activeElement.classList.contains('organise-trigger')`));
      await json(`/items/${item}/folders/${empty}`, "PUT", { present: false });
    }
  }
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  console.log("PASS Base UI icon-only header/keyboard tooltips, ToggleGroup roving focus/nonempty selection, Space checkbox mutation; desktop/320 content-only scrolling, reserved gutter/no width jump, folder reset, visible focus and independent reader scroll");
}
