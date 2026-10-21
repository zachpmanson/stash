import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { extensionPath } from '@vlcn.io/crsqlite';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { SCHEMA_SQL } from '../schema.ts';
import { pathToFileURL } from 'node:url';
const { canonicalFeedBase, initializeFeeds, feedSettings, renderFeed } = await import(
  process.env.STASH_TEST_SERVER_ENTRY ? new URL('./feeds.js', pathToFileURL(process.env.STASH_TEST_SERVER_ENTRY)).href : '../src/feeds.ts'
);
const base = 'https://feeds.example';
const parser = new XMLParser({ignoreAttributes:false, parseTagValue:false, trimValues:false});
function parsed(xml) { assert.equal(XMLValidator.validate(xml), true); return parser.parse(xml).feed; }
function fixture(t) {
  const db = new Database(':memory:'); db.loadExtension(extensionPath); db.exec(SCHEMA_SQL); initializeFeeds(db);
  t.after(() => { db.prepare('SELECT crsql_finalize()').get(); db.close(); });
  const folder = (id='f') => db.prepare('INSERT INTO sync_folders(id,name) VALUES (?,?)').run(id,'Folder & <one>');
  const item = (id='a',content='First note',time=1,type='text') => db.prepare('INSERT INTO sync_items(id,type,content,created_at) VALUES (?,?,?,?)').run(id,type,content,time);
  let generation=0;
  const add = (id='a',f='f') => db.prepare('INSERT INTO sync_item_folders(membership_id,item_id,folder_id) VALUES (?,?,?)').run(String(generation++),id,f);
  const render = (preview=false) => renderFeed(db,'f',base,preview);
  folder(); return {db,folder,item,add,render};
}
test('canonical base is explicit HTTPS origin only', () => {
  assert.equal(canonicalFeedBase(undefined),null);
  assert.equal(canonicalFeedBase('https://stash.example/'),'https://stash.example');
  for (const bad of ['http://localhost','https://a:b@host','https://host/base','https://host/?x=y','https://host/#x','file:///tmp','garbage']) assert.throws(()=>canonicalFeedBase(bad));
});
test('Atom parses required fields, exact plaintext Unicode/XML controls and no HTML/enclosures/secrets', t => {
  const {db,item,add,render}=fixture(t);
  const note='澳洲 & <script> "quotes" 🦆 ]]> ]]> <content type="html"> \u0001\u0000\ud800';
  item('a',note); add();
  db.prepare('UPDATE sync_items SET article_html=?,media_id=?,lat=1,listened_percent=80 WHERE id=?').run('<b>SECRET HTML</b>','/private/device','a');
  assert.throws(()=>render(), /unavailable/);
  const version=db.prepare('SELECT crsql_db_version()').pluck().get();
  const output=render(true); assert.equal(feedSettings(db,'f',base).enabled,false);
  assert.equal(db.prepare('SELECT crsql_db_version()').pluck().get(),version);
  const feed=parsed(output.xml), entry=feed.entry;
  assert.equal(feed['@_xmlns'],'http://www.w3.org/2005/Atom');
  assert.match(feed.id,/^urn:uuid:/); assert.ok(feed.title); assert.ok(feed.author.name); assert.ok(Date.parse(feed.updated));
  assert.equal(entry.content['@_type'],'text'); assert.equal(entry.title['@_type'],'text');
  assert.equal(entry.content['#text'],note.replace(/[\u0000\u0001\ud800]/g,''));
  assert.equal(entry.published,'1970-01-01T00:00:00.001Z');
  assert.doesNotMatch(output.xml,/SECRET HTML|private\/device|enclosure|listened|lat>/);
  feedSettings(db,'f',base,true); assert.equal(render().xml,output.xml);
  assert.equal(db.prepare('SELECT crsql_db_version()').pluck().get(),version);
});
test('stable IDs, semantic dates/cache, rename, disable/re-enable and no replicated writes', t => {
  const {db,item,add,render}=fixture(t); item(); add(); feedSettings(db,'f',base,true);
  const a=render(), first=parsed(a.xml), version=db.prepare('SELECT crsql_db_version()').pluck().get();
  const changes=db.prepare('SELECT total_changes()').pluck().get();
  assert.deepEqual(render(),a); assert.equal(db.prepare('SELECT total_changes()').pluck().get(),changes);
  assert.equal(db.prepare('SELECT crsql_db_version()').pluck().get(),version);
  db.exec("UPDATE sync_items SET listened_percent=99,lat=2,article_html='<b>ignored</b>'; UPDATE sync_folders SET layout='list',icon='⭐'");
  assert.deepEqual(render(),a);
  db.exec("UPDATE sync_folders SET name='Renamed'");
  const renamed=parsed(render().xml); assert.equal(renamed.id,first.id); assert.equal(renamed.entry.updated,first.entry.updated); assert.notEqual(renamed.updated,first.updated);
  db.exec("UPDATE sync_items SET content='Edited'");
  const edited=render(), edit=parsed(edited.xml); assert.equal(edit.entry.id,first.entry.id); assert.equal(edit.entry.published,first.entry.published); assert.notEqual(edit.entry.updated,first.entry.updated);
  assert.notEqual(edited.etag,a.etag);
  feedSettings(db,'f',base,false); assert.throws(()=>render(),/unavailable/);
  feedSettings(db,'f',base,true); assert.deepEqual(render(),edited);
});
test('distinct logical membership, active scope, latest 50 and stable ties, plaintext links and truncation', t => {
  const {db,folder,item,add,render}=fixture(t); folder('other');
  for(let n=0;n<55;n++) { item(`i${String(n).padStart(2,'0')}`,'x'.repeat(8100),100); add(`i${String(n).padStart(2,'0')}`); }
  add('i00'); item('private','OTHER FOLDER SECRET',200); add('private','other');
  item('media','/private/file',200,'image'); add('media');
  item('bad','https://user:password@example.com',200,'url'); add('bad');
  item('archived','ARCHIVED SECRET',200); add('archived'); db.exec("UPDATE sync_items SET archived_at=1 WHERE id='archived'");
  item('link','https://example.com/?a=1&b=2',300,'url'); add('link');
  db.exec("UPDATE sync_items SET title='Link <title>',description='Plain & description',article_text='Saved plaintext',article_html='RAW HTML SECRET' WHERE id='link'");
  feedSettings(db,'f',base,true);
  const output=render(), feed=parsed(output.xml);
  // An unsafe legacy link is omitted from the bounded candidate window.
  assert.equal(feed.entry.length,49);
  assert.equal(feed.entry[0].title['#text'],'Link <title>');
  assert.equal(feed.entry[0].link['@_href'],'https://example.com/?a=1&b=2');
  assert.match(feed.entry[0].content['#text'],/Saved plaintext/);
  assert.doesNotMatch(output.xml,/OTHER FOLDER|ARCHIVED SECRET|private\/file|RAW HTML SECRET|user:password/);
  assert.match(feed.entry[1].content['#text'],/\[Truncated\]$/);
  const ids = db.prepare('SELECT item_id FROM feed_entries ORDER BY item_id').all().map(x=>x.item_id);
  assert.ok(ids.includes('i00')); assert.ok(!ids.includes('i54')); assert.equal(ids.filter(x=>x==='i00').length,1);
  db.exec("DELETE FROM sync_item_folders WHERE item_id='link'"); assert.doesNotMatch(render().xml,/Saved plaintext/);
});
for (const order of ['tombstone-first','membership-first']) test(`add-wins visibility and observed archive/delete disable (${order})`, t => {
  const {db,item,add,render}=fixture(t); item();
  if (order==='tombstone-first') { db.exec('UPDATE sync_folders SET deleted=1'); add(); }
  else { add(); db.exec('UPDATE sync_folders SET deleted=1'); }
  feedSettings(db,'f',base,true); assert.ok(parsed(render().xml).entry);
  db.exec('UPDATE sync_folders SET archived_at=1');
  db.exec('UPDATE sync_folders SET archived_at=NULL');
  assert.equal(feedSettings(db,'f',base).enabled,false); assert.throws(()=>render(),/unavailable/);
  feedSettings(db,'f',base,true); db.exec('DELETE FROM sync_item_folders');
  add(); assert.equal(feedSettings(db,'f',base).enabled,false);
  feedSettings(db,'f',base,true); db.exec('DELETE FROM sync_items');
  item(); add(); assert.equal(feedSettings(db,'f',base).enabled,false);
});
test('empty feed is valid, preview never publishes, orphan memberships do not leak', t => {
  const {db,add,render}=fixture(t); add('missing');
  const feed=parsed(render(true).xml); assert.equal(feed.entry,undefined); assert.ok(feed.updated); assert.ok(feed.id);
  assert.equal(feedSettings(db,'f',base).enabled,false);
  db.exec('DELETE FROM sync_folders'); assert.throws(()=>render(true),/unavailable/);
});
