import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { App, ItemEditor, ItemReader } from '../web/App.tsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const sample = { id: 'i1', type: 'text', title: 'Original title', content: 'Original content', description: null, article_text: null, created_at: 1, archived_at: null, folderIds: ['f1'], mediaUnavailable: false };
const flush = async fn => act(async () => { await fn?.(); await new Promise(resolve => setImmediate(resolve)); });

async function fixture(t) {
  const previous = { fetch: globalThis.fetch, window: globalThis.window, document: globalThis.document, FormData: globalThis.FormData };
  const state = { items: [{ ...sample }], folders: [{ id: 'f1', name: 'Reading', icon: 'F', archived_at: null }], calls: [] };
  globalThis.FormData = class extends Map { constructor(form) { super(Object.entries(form.fields)); } };
  globalThis.window = { addEventListener() {}, removeEventListener() {}, setInterval: () => 1, clearInterval() {} };
  globalThis.document = { hidden: false };
  globalThis.fetch = async (url, options) => {
    state.calls.push({ url, ...options });
    if (options.method !== 'GET') {
      assert.equal(options.method, 'PATCH');
      const data = JSON.parse(options.body);
      state.items[0] = { ...state.items[0], ...data };
      return Response.json({ id: state.items[0].id });
    }
    if (url === '/api/folders') return Response.json(state.folders);
    if (url.startsWith('/api/items?')) return Response.json({ items: state.items, hasMore: false });
    const found = state.items.find(item => url === `/api/items/${item.id}`);
    return found ? Response.json(found) : Response.json({ error: 'Item not found' }, { status: 404 });
  };
  let renderer;
  t.after(async () => { if (renderer) await act(() => renderer.unmount()); Object.assign(globalThis, previous); });
  await flush(() => { renderer = create(React.createElement(App)); });
  const button = label => renderer.root.findAllByType('button').find(node => node.props['aria-label'] === label || node.children.join('') === label);
  const selectItem = () => flush(() => renderer.root.findAllByType('button').find(node => node.props['data-item-id']).props.onClick());
  const submit = fields => flush(() => renderer.root.findByType(ItemEditor).findByType('form').props.onSubmit({ preventDefault() {}, currentTarget: { fields } }));
  return { state, renderer, button, selectItem, submit };
}

test('actual edit form submits only dirty fields even after refresh receives concurrent native changes', async t => {
  const h = await fixture(t);
  await h.selectItem();
  await flush(() => h.button('Edit item').props.onClick());
  h.state.items[0] = { ...h.state.items[0], content: 'Concurrent phone content' };
  await flush(() => h.button('Refresh').props.onClick());
  assert.equal(h.renderer.root.findByType(ItemEditor).findByType('textarea').props.defaultValue, sample.content);
  await h.submit({ title: 'Web title', content: sample.content });
  const writes = h.state.calls.filter(call => call.method !== 'GET');
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(writes[0].body), { title: 'Web title' });
  assert.equal(h.state.items[0].content, 'Concurrent phone content');
  assert.equal(h.renderer.root.findByType(ItemReader).props.item.content, 'Concurrent phone content');
});

test('unchanged edit closes without a mutation or new replicated clocks', async t => {
  const h = await fixture(t);
  await h.selectItem();
  await flush(() => h.button('Edit item').props.onClick());
  await h.submit({ title: sample.title, content: sample.content });
  assert.equal(h.state.calls.filter(call => call.method !== 'GET').length, 0);
  assert.equal(h.renderer.root.findAllByType(ItemEditor).length, 0);
});

test('selected item deletion clears detail instead of poisoning every library refresh', async t => {
  const h = await fixture(t);
  await h.selectItem();
  await flush(() => h.button('Edit item').props.onClick());
  h.state.items = [{ ...sample, id: 'i2', title: 'New phone item' }];
  await flush(() => h.button('Refresh').props.onClick());
  assert.equal(h.renderer.root.findAllByProps({ role: 'alert' }).length, 0);
  assert.equal(h.renderer.root.findAllByType(ItemReader).length, 0);
  assert.equal(h.renderer.root.findAllByType(ItemEditor).length, 0);
  assert.match(JSON.stringify(h.renderer.toJSON()), /no longer available/);
  assert.equal(h.state.calls.filter(call => call.method !== 'GET').length, 0);
  const staleReads = h.state.calls.filter(call => call.url === '/api/items/i1').length;
  await flush(() => h.button('Refresh').props.onClick());
  assert.equal(h.state.calls.filter(call => call.url === '/api/items/i1').length, staleReads);
  await h.selectItem();
  assert.equal(h.renderer.root.findByType(ItemReader).props.item.id, 'i2');
});

for (const editor of ['edit', 'new']) test(`removed folder clears invalid edit but preserves an unrelated new draft (${editor})`, async t => {
  const h = await fixture(t);
  await flush(() => h.renderer.root.findAllByType('button').find(node => node.props.title === 'Reading').props.onClick());
  if (editor === 'edit') await h.selectItem();
  await flush(() => h.button(editor === 'edit' ? 'Edit item' : 'New item').props.onClick());
  h.state.folders = [];
  await flush(() => h.button('Refresh').props.onClick());
  assert.ok(h.renderer.root.findAllByType('button').some(node => node.children.includes('All items') && node.props['aria-current'] === 'page'));
  assert.ok(!h.state.calls.filter(call => call.url.startsWith('/api/items?')).at(-1).url.includes('folderId='));
  assert.equal(h.renderer.root.findAllByProps({ role: 'alert' }).length, 0);
  assert.equal(h.renderer.root.findAllByType(ItemEditor).length, editor === 'new' ? 1 : 0);
  assert.equal(h.state.calls.filter(call => call.method !== 'GET').length, 0);
});
