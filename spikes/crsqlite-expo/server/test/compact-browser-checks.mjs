import assert from "node:assert/strict";

// Shared by the real Chromium/Caddy smoke, not a CSS-string approximation.
// Reference mode only records the old immutable package for matched evidence.
export async function desktopDensity(evaluate, layout) {
  const metrics = await evaluate(`(() => {
    const rect = s => document.querySelector(s).getBoundingClientRect();
    const style = s => getComputedStyle(document.querySelector(s));
    const cards = [...document.querySelectorAll('.item-card')];
    return {
      header: rect('.app-header').height,
      workspaceTop: rect('.workspace').top,
      sidebar: rect('.sidebar').width,
      folderRow: rect('.folder-link').height,
      collection: rect('.collection').width,
      toolbar: rect('.collection-heading').height,
      rows: cards.map(c => c.getBoundingClientRect().height),
      rowGap: style('.items').rowGap,
      radius: style('.item-card').borderRadius,
      separator: style('.item-card').borderBottomWidth,
      titleClamp: style('.card-title').webkitLineClamp,
      metadata: style('.item-card small').display,
      visibleCapacity: Math.floor((rect('.collection').height - rect('.collection-heading').height) / (rect('.item-card').height + (parseFloat(style('.items').rowGap) || 0))),
      readerPadding: style('.reader').paddingTop,
      readerHeading: style('.reader h2').fontSize,
      bodyText: style('.reader').fontSize,
      colours: Object.fromEntries(['bg','surface','raised','accent','ink','muted','line'].map(k => [k, getComputedStyle(document.documentElement).getPropertyValue('--color-'+k).trim().replace(/^#([a-f0-9])([a-f0-9])([a-f0-9])$/i, '#$1$1$2$2$3$3')]))
    };
  })()`);
  console.log(`COMPACT_${layout.toUpperCase()}_METRICS ` + JSON.stringify(metrics));
  if (process.env.STASH_DENSITY_REFERENCE === "1") return metrics;
  assert.ok(metrics.header >= 48 && metrics.header <= 52, "desktop chrome must be 48–52px");
  assert.equal(metrics.workspaceTop, metrics.header, "no empty status rail");
  assert.ok(metrics.sidebar >= 208 && metrics.sidebar <= 224);
  assert.ok(metrics.folderRow >= 32 && metrics.folderRow <= 34);
  assert.ok(metrics.collection >= 320 && metrics.collection <= 384);
  assert.ok(metrics.toolbar >= 48 && metrics.toolbar <= 56);
  assert.equal(metrics.bodyText, "16px", "readable reader text is not shrunk");
  assert.ok(parseFloat(metrics.readerHeading) >= 20 && parseFloat(metrics.readerHeading) <= 22);
  assert.ok(parseFloat(metrics.readerPadding) <= 24);
  assert.deepEqual(metrics.colours, {
    bg: "#0f0f14", surface: "#1a1a24", raised: "#242434", accent: "#7c6af7",
    ink: "#f0f0f8", muted: "#b0afc3", line: "#333344",
  }, "retain exact Stash theme tokens");
  if (layout === "list") {
    assert.ok(metrics.rows.every(h => h >= 48 && h <= 56), "bounded two-line desktop list rows");
    assert.equal(parseFloat(metrics.rowGap) || 0, 0, "flat list, no card gaps");
    assert.equal(metrics.radius, "0px");
    assert.equal(metrics.separator, "1px");
    assert.equal(metrics.titleClamp, "1");
    assert.equal(metrics.metadata, "flex", "preview and metadata share the second line");
    assert.ok(metrics.visibleCapacity >= 16, "at least 16 rows in 1000px viewport");
  } else {
    assert.ok(metrics.rows.every(h => h >= 90 && h <= 110), "compact grid without 180px empty cards");
    assert.equal(metrics.titleClamp, "2");
    assert.ok(metrics.visibleCapacity >= 8);
  }
  return metrics;
}
