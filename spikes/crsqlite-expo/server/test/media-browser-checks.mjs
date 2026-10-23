import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

/** Actual private UI + XHR + decoder + Caddy using synthetic raster files only. */
export async function mediaInteractions({ evaluate, cdp, click, waitFor, screenshot, json, base, directory, confirm }) {
  const { id: folder } = await json("/folders", "POST", { name: "Synthetic private image shelf" });
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/pkAAAAASUVORK5CYII=";
  const filename = `${directory}/synthetic-private-image.png`;
  await writeFile(filename, Buffer.from(png, "base64"));
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.navigate", { url: `${base}/?folder=${folder}` });
  await waitFor(() => evaluate(`document.querySelector('.collection')?.getAttribute('aria-busy')==='false'`));
  async function newImage(title, method) {
    await click("New item");
    await evaluate(`(()=>{const n=document.querySelector('select[name=type]');n.value='image';n.dispatchEvent(new Event('change',{bubbles:true}));const t=document.querySelector('input[name=title]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(t,${JSON.stringify(title)});t.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await waitFor(() => evaluate(`!!document.querySelector('input[type=file]')`));
    if (method === "pick") {
      const { root } = await cdp("DOM.getDocument");
      const { nodeId } = await cdp("DOM.querySelector", { nodeId: root.nodeId, selector: "input[type=file]" });
      await cdp("DOM.setFileInputFiles", { nodeId, files: [filename] });
    } else await evaluate(`(()=>{const file=new File([Uint8Array.from(atob('${png}'),c=>c.charCodeAt(0))],'synthetic-${method}.png',{type:'image/png'});const d=new DataTransfer();d.items.add(file);const zone=document.querySelector('.image-drop-zone');zone.dispatchEvent(${method === "drop" ? "new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:d})" : "new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:d})"})})()`);
    await waitFor(() => evaluate(`document.querySelector('.image-drop-zone').textContent.includes('KiB')`));
  }
  await newImage("Private picked image", "pick");
  // Lose only the first finalization response AFTER the real server commit.
  await evaluate(`window.mediaFetch=window.fetch;window.mediaFinalizations=0;window.fetch=async(...a)=>{if(String(a[0]).includes('/media/uploads/')&&String(a[0]).endsWith('/finalize')){window.mediaFinalizations++;const r=await window.mediaFetch(...a);if(window.mediaFinalizations===1){return new Promise(resolve=>window.releaseImageResponse=()=>resolve(Response.json({error:'Synthetic lost response; retry Save.'},{status:503})))}return r}return window.mediaFetch(...a)}`);
  await click("Save item");
  await waitFor(() => evaluate(`!!window.releaseImageResponse`));
  assert.ok(await evaluate(`document.querySelector('input[type=file]').matches(':disabled') && document.querySelector('[aria-label="New item"]').disabled && document.querySelector('.image-drop-zone').textContent.includes('validating and saving')`));
  await evaluate(`window.releaseImageResponse()`);
  await waitFor(() => evaluate(`document.querySelector('[role=alert]')?.textContent.includes('Synthetic lost response')`));
  await confirm(() => click("Cancel"), false);
  assert.ok(await evaluate(`document.querySelector('input[type=file]').files.length===1`));
  await click("Save item");
  await waitFor(() => evaluate(`!!document.querySelector('.reader-image') && !document.querySelector('input[type=file]')`));
  assert.equal(await evaluate(`window.mediaFinalizations`), 2);
  await evaluate(`window.fetch=window.mediaFetch`);
  assert.equal((await json(`/items?folderId=${folder}`)).items.length, 1);
  for (const method of ["drop", "paste"]) {
    await newImage(`Private ${method} image`, method); await click("Save item");
    await waitFor(() => evaluate(`!!document.querySelector('.reader-image') && !document.querySelector('input[type=file]')`));
  }
  const page = await json(`/items?folderId=${folder}`);
  assert.equal(page.items.length, 3);
  assert.ok(page.items.every(item => item.image?.state === "available" && item.folderIds.includes(folder)));
  await waitFor(() => evaluate(`(()=>{const n=document.querySelector('.reader-image');return n&&n.complete&&n.naturalWidth===1&&n.src.includes('/preview')})()`));
  await click("Grid layout");
  await waitFor(() => evaluate(`document.querySelectorAll('.card-thumbnail').length===3 && [...document.querySelectorAll('.card-thumbnail')].every(n=>n.complete&&n.naturalWidth===1)`));
  assert.ok(await evaluate(`!performance.getEntriesByType('resource').some(r=>r.name.includes('/original'))`), "grid/reader never load full originals");
  await screenshot("private-images-grid-reader");
  // Narrow display does not relax the CSP or private authenticated request path.
  await cdp("Emulation.setDeviceMetricsOverride", { width: 320, height: 740, deviceScaleFactor: 1, mobile: true });
  assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth && document.querySelector('.reader-image').getBoundingClientRect().right<=innerWidth`));
  await screenshot("private-image-narrow-reader");
  const id = page.items[0].id;
  for (const forged of [undefined, "web-test-owner"]) {
    const response = await fetch(`${base}/api/media/items/${id}/original`, { headers: forged ? { "X-Auth-User": forged } : {} });
    assert.equal(response.status, 401, "Caddy cannot be bypassed with a forged identity header");
  }
  console.log("PASS private image pick/drop/paste, real XHR progress, lost-finalization-response retry without duplicates, folder atomicity, bounded preview/grid decoding, narrow display and forged-identity Caddy rejection");
}
