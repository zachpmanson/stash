import assert from "node:assert/strict";
import { selectArchive } from "./select-browser-helpers.mjs";

/** Desktop sidebar-footer control; real Select keyboard, routes, content and guards. */
export async function archiveChecks({ evaluate, cdp, click, waitFor, json, base, confirm }) {
  const { id: folder } = await json("/folders", "POST", { name: "Archive dropdown fixture" });
  const { id: active } = await json("/items", "POST", { type: "text", title: "Active dropdown note", content: "Active fixture", folderId: folder });
  const { id: archived } = await json("/items", "POST", { type: "text", title: "Archived dropdown note", content: "Archived fixture", folderId: folder });
  await json(`/items/${archived}`, "PATCH", { archived: true });
  const folders = await json("/folders");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: Math.max(1000, folders.length * 32 + 400), deviceScaleFactor: 1, mobile: false });
  await cdp("Page.navigate", { url: `${base}/?folder=${folder}` });
  await waitFor(() => evaluate(`document.querySelector('[data-item-id=${JSON.stringify(active)}]') && document.querySelector('.collection').getAttribute('aria-busy')==='false'`));
  assert.ok(await evaluate(`(()=>{const s=document.querySelector('.sidebar'),f=s.querySelector('footer'),n=s.querySelector('.new-folder'),b=f.querySelector('.archive-select');return !document.querySelector('.app-header [aria-label=Archive]') && s.lastElementChild===f && f.getBoundingClientRect().top>=n.getBoundingClientRect().bottom && Math.abs(f.getBoundingClientRect().bottom-s.getBoundingClientRect().bottom)<16 && b.labels[0].textContent==='Show items' && b.textContent==='Active items'})()`), "single named dropdown is below folders/New folder at sidebar bottom");
  const context = { evaluate, cdp, waitFor };
  await selectArchive(context, true);
  await waitFor(() => evaluate(`new URLSearchParams(location.search).get('archive')==='1' && !!document.querySelector('[data-item-id=${JSON.stringify(archived)}]') && !document.querySelector('[data-item-id=${JSON.stringify(active)}]') && !document.querySelector('.new-folder')`));
  assert.equal(await evaluate(`new URLSearchParams(location.search).get('folder')`), folder);
  assert.ok(await evaluate(`document.activeElement.classList.contains('archive-select') && document.querySelector('.archive-select').textContent==='Archived items'`));
  await evaluate(`history.back()`);
  await waitFor(() => evaluate(`!new URLSearchParams(location.search).has('archive') && !!document.querySelector('[data-item-id=${JSON.stringify(active)}]') && document.querySelector('.archive-select').textContent==='Active items'`));
  await evaluate(`history.forward()`);
  await waitFor(() => evaluate(`new URLSearchParams(location.search).get('archive')==='1' && !!document.querySelector('[data-item-id=${JSON.stringify(archived)}]')`));
  await selectArchive(context, false);
  await waitFor(() => evaluate(`!!document.querySelector('[data-item-id=${JSON.stringify(active)}]') && document.querySelector('.collection').getAttribute('aria-busy')==='false'`));
  await click("New item");
  await waitFor(() => evaluate(`!!document.querySelector('textarea')`));
  await evaluate(`(()=>{const n=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(n,'Retained archive draft');n.dispatchEvent(new Event('input',{bubbles:true}));window.archiveDraft=n;window.archiveTitle=document.querySelector('input[name=title]')})()`);
  await confirm(() => selectArchive(context, true), false);
  assert.ok(await evaluate(`!new URLSearchParams(location.search).has('archive') && document.querySelector('.archive-select').textContent==='Active items' && document.querySelector('textarea')===window.archiveDraft && document.querySelector('input[name=title]')===window.archiveTitle && window.archiveDraft.value==='Retained archive draft'`), "rejected archive navigation preserves route, controlled selection and editor DOM/draft");
  await confirm(() => selectArchive(context, true), true);
  await waitFor(() => evaluate(`!document.querySelector('textarea') && !!document.querySelector('[data-item-id=${JSON.stringify(archived)}]') && document.querySelector('.archive-select').textContent==='Archived items'`));
  // Real long folder list: footer follows it in the same scrollable sidebar,
  // rather than overlapping or shrinking the navigation to force a fixed footer.
  for (let n = 0; n < 40; n++) await json("/folders", "POST", { name: `Long sidebar fixture ${n}` });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.navigate", { url: `${base}/?folder=${folder}` });
  await waitFor(() => evaluate(`document.querySelectorAll('.folder-row').length>=40 && document.querySelector('.collection').getAttribute('aria-busy')==='false'`));
  assert.ok(await evaluate(`(()=>{const s=document.querySelector('.sidebar'),f=s.querySelector('footer');s.scrollTop=s.scrollHeight;const r=f.getBoundingClientRect();return s.scrollHeight>s.clientHeight && r.bottom<=s.getBoundingClientRect().bottom && r.top>=s.querySelector('.new-folder').getBoundingClientRect().bottom && r.top>=s.querySelector('nav').getBoundingClientRect().bottom})()`), "long sidebar footer stays reachable below every folder and New folder");
  await selectArchive(context, true);
  await waitFor(() => evaluate(`new URLSearchParams(location.search).get('archive')==='1' && !!document.querySelector('[data-item-id=${JSON.stringify(archived)}]')`));
  console.log("PASS desktop footer Active/Archived Select: short-list bottom/long-list reachability, label, keyboard/focus, route/content/folder preservation, Back/Forward and rejected/accepted dirty draft navigation");
}
