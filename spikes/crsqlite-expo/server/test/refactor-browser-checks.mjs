import assert from "node:assert/strict";

/** The actual bundled App in Chromium, including uncontrolled DOM input identity. */
export async function refactorComposition({
  evaluate,
  cdp,
  click,
  waitFor,
  screenshot,
  json,
  base,
  confirm,
}) {
  const { id: folder } = await json("/folders", "POST", {
    name: "Composition fixture",
  });
  const { id: other } = await json("/folders", "POST", {
    name: "Unrelated composition fixture",
  });
  const { id: item } = await json("/items", "POST", {
    type: "text",
    title: "Frozen title",
    content: "Frozen body",
    folderId: folder,
  });
  await cdp("Page.navigate", { url: `${base}/?folder=${folder}&item=${item}` });
  await waitFor(() =>
    evaluate(
      `document.querySelector('.reader h2')?.textContent==='Frozen title' && document.querySelector('.collection').getAttribute('aria-busy')==='false'`,
    ),
  );
  assert.deepEqual(
    await evaluate(`(() => {
      const button = document.querySelector('.folder-menu-toggle');
      return { button: button.getBoundingClientRect().width, icon: button.querySelector('svg').getBoundingClientRect().width };
    })()`),
    { button: 28, icon: 18 },
    "folder ellipsis retains an 18px Heroicon inside its compact 28px control",
  );
  await click("Edit item");
  await waitFor(() => evaluate(`!!document.querySelector('textarea')`));
  await evaluate(`(() => {
    const title=document.querySelector('input[name=title]'), content=document.querySelector('textarea');
    window.compositionNodes={title,content,form:title.form,section:title.closest('.reader'),workspace:title.closest('.workspace')};
    window.compositionAncestors=[];for(let n=content;n;n=n.parentElement)window.compositionAncestors.push(n);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(title,'Typed composition draft');
    title.dispatchEvent(new Event('input',{bubbles:true}));title.focus();title.setSelectionRange(3,8);
  })()`);
  const identity = async () =>
    assert.ok(
      await evaluate(`(() => {
    const n=window.compositionNodes,title=document.querySelector('input[name=title]'),content=document.querySelector('textarea');
    const ancestors=[];for(let a=content;a;a=a.parentElement)ancestors.push(a);
    return title===n.title && content===n.content && title.form===n.form && title.closest('.reader')===n.section && title.closest('.workspace')===n.workspace &&
      ancestors.length===window.compositionAncestors.length && ancestors.every((a,i)=>a===window.compositionAncestors[i]) &&
      title.value==='Typed composition draft' && content.value==='Frozen body';
  })()`),
      "same input/form/section/workspace and every actual ancestor node, with typed draft retained",
    );
  await json(`/items/${item}`, "PATCH", { content: "Concurrent fixture body" });
  await json(`/folders/${other}`, "PATCH", { name: "Remote unrelated name" });
  await click("Refresh");
  await waitFor(() =>
    evaluate(
      `!!document.querySelector('[aria-label="Actions for Remote unrelated name"]') && document.querySelector('.collection').getAttribute('aria-busy')==='false'`,
    ),
  );
  await identity();
  assert.ok(
    await evaluate(
      `document.activeElement===window.compositionNodes.title && document.activeElement.selectionStart===3 && document.activeElement.selectionEnd===8`,
    ),
  );
  await click("Grid layout");
  await waitFor(() =>
    evaluate(
      `document.querySelector('.items').classList.contains('grid') && !document.querySelector('[aria-label="New item"]').disabled`,
    ),
  );
  await identity();
  await click("List layout");
  await waitFor(() =>
    evaluate(
      `!document.querySelector('.items').classList.contains('grid') && !document.querySelector('[aria-label="New item"]').disabled`,
    ),
  );
  await identity();
  // Menu currentTarget must remain the actual trigger, even through shared controls.
  await evaluate(
    `document.querySelector('[aria-label="Actions for Remote unrelated name"]').click()`,
  );
  await click("Atom feed");
  await waitFor(() =>
    evaluate(`!!document.querySelector('input[name=feed-url]')`),
  );
  await identity();
  await click("Close");
  assert.ok(
    await evaluate(
      `document.activeElement===document.querySelector('[aria-label="Actions for Remote unrelated name"]')`,
    ),
  );
  await identity();
  await screenshot("desktop-editor-identity");
  await evaluate(`window.compositionFetch=window.fetch;window.compositionWrites=[];window.fetch=async (...a)=>{
    if(a[0]===${JSON.stringify(`/api/items/${item}`)}&&a[1]?.method==='PATCH'){
      window.compositionWrites.push(JSON.parse(a[1].body));await new Promise(r=>setTimeout(r,350));
      return Response.json({error:'Composition save failed'},{status:503});
    }return window.compositionFetch(...a);
  }`);
  await click("Save item");
  await waitFor(() => evaluate(`document.querySelector('fieldset').disabled`));
  await identity();
  await waitFor(() =>
    evaluate(
      `document.querySelector('[role=alert]')?.textContent.includes('Composition save failed')`,
    ),
  );
  await identity();
  assert.deepEqual(await evaluate(`window.compositionWrites`), [
    { title: "Typed composition draft" },
  ]);
  assert.equal(
    (await json(`/items/${item}`)).content,
    "Concurrent fixture body",
  );
  assert.equal(
    await evaluate(
      `document.querySelector('textarea').closest('fieldset').disabled`,
    ),
    false,
  );
  assert.equal(
    await evaluate(
      `window.dispatchEvent(new Event('beforeunload',{cancelable:true}))`,
    ),
    false,
    "failed save retains unload guard",
  );
  await confirm(() => click("All items"), false);
  await identity();
  await confirm(
    () =>
      evaluate(
        `history.pushState(null,'','?folder=${other}');window.dispatchEvent(new PopStateEvent('popstate'))`,
      ),
    false,
  );
  assert.equal(
    await evaluate(`new URLSearchParams(location.search).get('item')`),
    item,
  );
  await identity();
  // No-op uses the frozen baseline, not the refreshed server body, and sends no PATCH.
  await evaluate(
    `(() => {const n=window.compositionNodes.title;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(n,'Frozen title');n.dispatchEvent(new Event('input',{bubbles:true}));n.form.requestSubmit()})()`,
  );
  await waitFor(() => evaluate(`!document.querySelector('textarea')`));
  assert.equal(await evaluate(`window.compositionWrites.length`), 1);
  assert.equal(
    await evaluate(
      `window.dispatchEvent(new Event('beforeunload',{cancelable:true}))`,
    ),
    true,
  );
  await evaluate(`window.fetch=window.compositionFetch`);
  console.log(
    "PASS extracted composition: actual input and every ancestor identity, typed draft/focus/selection across refresh/layout/feed/failed save, dirty-only frozen payload, currentTarget focus, guarded popstate/unload and no-op save",
  );
}
