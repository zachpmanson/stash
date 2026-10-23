import assert from "node:assert/strict";

/** Saved replica metadata and native-equivalent fallbacks in the actual bundle. */
export async function folderEmojiChecks({ evaluate, cdp, click, waitFor, screenshot, json, base, removeFixture }) {
  const fixtures = [
    ["emoji-saved", "Saved family and flag with a deliberately long folder name", "👨‍👩‍👧‍👦🏳️‍🌈", null, "👨‍👩‍👧‍👦🏳️‍🌈"],
    ["emoji-mail", "Saved variation selector", "✉️", null, "✉️"],
    ["emoji-archived", "Archived developer", "🧑🏽‍💻", 123, "🧑🏽‍💻"],
    ["inbox", "Inbox fallback", null, null, "📥"],
    ["emoji-name", "  Books fallback", "", null, "📚"],
    ["emoji-generic", "123 generic fallback", null, null, "📁"],
  ];
  for (const [i, [id, name, icon, archived]] of fixtures.entries())
    removeFixture("INSERT INTO sync_folders(id,name,icon,archived_at,created_at) VALUES (?,?,?,?,?)", id, name, icon, archived, Date.now() + 100 + i);
  const icons = await json("/folders");
  for (const [id, , , , expected] of fixtures)
    assert.equal(icons.find(f => f.id === id).icon, expected);
  const selector = name => `.folder-link[title=${JSON.stringify(name)}]`;
  const check = async () => {
    for (const [, name, , archived, expected] of fixtures) {
      const row = selector(name);
      const metrics = await evaluate(`(()=>{
        const b=document.querySelector(${JSON.stringify(row)}), e=b.querySelector('.folder-emoji'), n=b.querySelector('.truncate');
        const r=document.createRange();r.selectNodeContents(e);
        const glyph=r.getBoundingClientRect(), icon=e.getBoundingClientRect(), button=b.getBoundingClientRect(), label=n.getBoundingClientRect();
        const menu=b.parentElement.querySelector('.folder-menu-toggle').getBoundingClientRect();
        return {text:e.textContent,hidden:e.getAttribute('aria-hidden'),shrink:getComputedStyle(e).flexShrink,clip:getComputedStyle(e).overflow,
          fits:glyph.left>=button.left&&glyph.right<=button.right&&glyph.top>=button.top&&glyph.bottom<=button.bottom,
          spaced:label.left>=icon.right+5&&label.width>20&&label.right<=menu.left,
          inViewport:button.left>=0&&menu.right<=innerWidth, svg:b.querySelectorAll('svg').length};
      })()`);
      assert.equal(metrics.text, expected);
      assert.equal(metrics.hidden, "true");
      assert.equal(metrics.shrink, "0");
      assert.equal(metrics.clip, "visible");
      assert.equal(metrics.svg, 0);
      assert.ok(metrics.fits && metrics.spaced && metrics.inViewport, JSON.stringify({ name, metrics }));
      const tree = await cdp("Accessibility.getFullAXTree");
      assert.ok(tree.nodes.some(n => n.role?.value === "button" && n.name?.value === name.trim() + (archived ? " (archived)" : "")), `accessible folder name: ${name}`);
    }
    assert.equal(await evaluate(`document.querySelector('.folder-nav > .folder-link').querySelectorAll('svg').length`), 1);
    assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`), true);
  };
  try {
    await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await cdp("Emulation.setEmulatedMedia", { features: [{ name: "pointer", value: "fine" }] });
    await cdp("Page.navigate", { url: base + "/?archive=1&folder=emoji-saved" });
    await waitFor(() => evaluate(`document.querySelector('.folder-emoji') && document.querySelector('.collection').getAttribute('aria-busy')==='false'`));
    await check();
    assert.equal(await evaluate(`document.querySelector(${JSON.stringify(selector(fixtures[0][1]))}).getAttribute('aria-current')`), "page");
    await screenshot("folder-emoji-desktop");
    // Replicated metadata changes do not require a page reload, and unrelated
    // web rename/archive actions must not overwrite the saved string.
    removeFixture("UPDATE sync_folders SET icon=? WHERE id=?", "🧑🏿‍🚀", "emoji-mail");
    await click("Refresh");
    await waitFor(() => evaluate(`document.querySelector(${JSON.stringify(selector(fixtures[1][1]))})?.querySelector('.folder-emoji').textContent==='🧑🏿‍🚀'`));
    fixtures[1][4] = "🧑🏿‍🚀";
    await json("/folders/emoji-mail", "PATCH", { name: "Renamed astronaut", archived: true });
    fixtures[1][1] = "Renamed astronaut";
    fixtures[1][3] = 123;
    await click("Refresh");
    await waitFor(() => evaluate(`!!document.querySelector(${JSON.stringify(selector(fixtures[1][1]))})`));
    assert.equal((await json("/folders")).find(f => f.id === "emoji-mail").icon, "🧑🏿‍🚀");
    await cdp("Emulation.setDeviceMetricsOverride", { width: 320, height: 740, deviceScaleFactor: 1, mobile: true });
    await cdp("Emulation.setTouchEmulationEnabled", { enabled: true });
    await cdp("Emulation.setEmulatedMedia", { features: [{ name: "pointer", value: "coarse" }] });
    await click("Open folders");
    await waitFor(() => evaluate(`document.querySelector('.sidebar').classList.contains('is-open')`));
    await check();
    assert.ok(await evaluate(`[...document.querySelectorAll('.folder-menu-toggle')].every(b=>b.getBoundingClientRect().height>=44)`));
    await screenshot("folder-emoji-320-drawer");
    // A real keyboard activation keeps decorative emoji out of the name and
    // selects/closes the drawer without disturbing archived-row semantics.
    await evaluate(`document.querySelector(${JSON.stringify(selector(fixtures[2][1]))}).focus()`);
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", text: "\r", unmodifiedText: "\r", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await waitFor(() => evaluate(`new URLSearchParams(location.search).get('folder')==='emoji-archived' && !document.querySelector('.sidebar').classList.contains('is-open')`));
    console.log("PASS folder emoji desktop/320 drawer: full saved family/flag/skin-tone/variation strings, Inbox/name/generic fallbacks, AX names, geometry/no clipping, refresh, rename/archive preservation and keyboard selection");
  } finally {
    for (const [id] of fixtures) removeFixture("DELETE FROM sync_folders WHERE id=?", id);
    await cdp("Emulation.setTouchEmulationEnabled", { enabled: false });
    await cdp("Emulation.setEmulatedMedia", { features: [] });
    await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await cdp("Page.navigate", { url: base + "/" });
    await waitFor(() => evaluate(`document.querySelector('.collection')?.getAttribute('aria-busy')==='false'`));
  }
}
