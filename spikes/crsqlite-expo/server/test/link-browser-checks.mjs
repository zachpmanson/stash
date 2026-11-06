import assert from "node:assert/strict";

/** Actual browser form semantics and persistence, with synthetic metadata only. */
export async function linkEditorChecks({ evaluate, cdp, click, waitFor, json, base, confirm }) {
  await cdp("Page.navigate", { url: base + "/" });
  await waitFor(() => evaluate(`document.querySelector('.collection')?.getAttribute('aria-busy')==='false'`));
  await evaluate(`window.linkOriginalFetch=window.fetch;window.linkCalls=[];window.linkMetadataMode='success';window.linkSaveFailure=false;window.fetch=async (...a)=>{
    if(a[0]==='/api/link-title'){
      window.linkCalls.push({url:a[0],body:JSON.parse(a[1].body)});
      await new Promise(r=>setTimeout(r,250));
      return window.linkMetadataMode==='success'?Response.json({title:'Synthetic & decoded page'}):Response.json({error:'Unavailable'},{status:503});
    }
    if(a[0]==='/api/items'&&a[1]?.method==='POST'){
      window.linkCalls.push({url:a[0],body:JSON.parse(a[1].body)});
      if(window.linkSaveFailure)return Response.json({error:'Synthetic link save failed'},{status:503});
    }
    return window.linkOriginalFetch(...a);
  }`);
  const input = (selector, value) => evaluate(`(() => {
    const n=document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(n instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(value)});
    n.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  const mode = value => evaluate(`(() => {const n=document.querySelector('select[name=type]');n.value=${JSON.stringify(value)};n.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await click("New item");
  await waitFor(() => evaluate(`!!document.querySelector('textarea[name=content]')`));
  await input('input[name=title]', 'Keep this text draft, not a link title');
  await input('textarea[name=content]', 'https://example.com/synthetic-link-title');
  await mode("url");
  await waitFor(() => evaluate(`!!document.querySelector('input[type=url]')`));
  assert.deepEqual(await evaluate(`(() => {
    const form=document.querySelector('.reader form'),url=form.elements.content,title=form.elements.title;
    return {label:url.closest('label').firstChild.textContent,value:url.value,required:url.required,max:url.maxLength,titleVisible:!!title.getBoundingClientRect().height,titleInPayload:new FormData(form).has('title')};
  })()`), { label: "URL (required)", value: "https://example.com/synthetic-link-title", required: true, max: 4096, titleVisible: false, titleInPayload: false });
  await mode("text");
  await waitFor(() => evaluate(`!!document.querySelector('textarea[name=content]')`));
  assert.equal(await evaluate(`document.querySelector('input[name=title]').value`), 'Keep this text draft, not a link title');
  assert.equal(await evaluate(`document.querySelector('textarea[name=content]').value`), 'https://example.com/synthetic-link-title');
  await mode("url");
  await waitFor(() => evaluate(`!!document.querySelector('input[type=url]')`));
  for (const invalid of ['', 'not a URL']) {
    await input('input[type=url]', invalid);
    assert.equal(await evaluate(`document.querySelector('input[type=url]').checkValidity()`), false);
    await evaluate(`document.querySelector('.reader form').requestSubmit()`);
    assert.equal(await evaluate(`window.linkCalls.length`), 0, 'invalid URLs must not submit metadata or item requests');
    assert.equal(await evaluate(`document.querySelector('.reader fieldset').disabled`), false);
  }
  await input('input[type=url]', 'https://example.com/synthetic-link-title');
  await evaluate(`document.querySelector('.reader form').requestSubmit();document.querySelector('.reader form').requestSubmit()`);
  await waitFor(() => evaluate(`document.querySelector('.reader fieldset')?.disabled`));
  await evaluate(`document.querySelector('.reader form button[type=button]').click()`);
  assert.equal(await evaluate(`!!document.querySelector('input[type=url]')`), true);
  await waitFor(() => evaluate(`document.querySelector('.reader h2')?.textContent==='Synthetic & decoded page'`));
  const id = await evaluate(`new URLSearchParams(location.search).get('item')`);
  assert.equal((await json(`/items/${id}`)).title, 'Synthetic & decoded page');
  assert.deepEqual(await evaluate(`window.linkCalls.map(x=>x.url)`), ["/api/link-title", "/api/items"]);
  assert.equal(await evaluate(`window.linkCalls[1].body.title`), 'Synthetic & decoded page');

  // Existing-link edits keep the optional title and do not re-resolve metadata.
  await click("Edit item");
  await waitFor(() => evaluate(`!!document.querySelector('textarea[name=content]')`));
  assert.equal(await evaluate(`!!document.querySelector('input[name=title]').getBoundingClientRect().height`), true);
  await click("Save item");
  await waitFor(() => evaluate(`!document.querySelector('.reader form')`));
  assert.equal(await evaluate(`window.linkCalls.length`), 2);

  await click("New item");
  await mode("url");
  await waitFor(() => evaluate(`!!document.querySelector('input[type=url]')`));
  await input('input[type=url]', 'https://example.com/synthetic-fallback');
  await evaluate(`window.linkMetadataMode='failure';window.linkSaveFailure=true`);
  await click("Save item");
  await waitFor(() => evaluate(`document.querySelector('[role=alert]')?.textContent.includes('Synthetic link save failed')`));
  assert.equal(await evaluate(`document.querySelector('input[type=url]').value`), 'https://example.com/synthetic-fallback');
  assert.equal(await evaluate(`document.querySelector('.reader fieldset').disabled`), false);
  await evaluate(`window.linkSaveFailure=false`);
  await click("Save item");
  await waitFor(() => evaluate(`document.querySelector('.reader h2')?.textContent==='https://example.com/synthetic-fallback'`));
  const fallbackId = await evaluate(`new URLSearchParams(location.search).get('item')`);
  assert.equal((await json(`/items/${fallbackId}`)).title, 'https://example.com/synthetic-fallback');
  const beforeCancel = await evaluate(`window.linkCalls.length`);
  await click("New item");
  await mode("url");
  await waitFor(() => evaluate(`!!document.querySelector('input[type=url]')`));
  await confirm(() => click("Cancel"), true);
  assert.equal(await evaluate(`window.linkCalls.length`), beforeCancel);
  await evaluate(`window.fetch=window.linkOriginalFetch`);
  console.log("PASS link creation: actual URL label/validation, hidden-title FormData, preserved mode drafts, fetched title persisted, serialized busy/cancel, editable existing title, URL fallback and failed-save retry");
}
