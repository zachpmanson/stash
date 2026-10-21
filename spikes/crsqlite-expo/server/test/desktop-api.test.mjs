import assert from "node:assert/strict";
import test from "node:test";
import { launch } from "./web-helpers.mjs";

test("layout validates strictly, roundtrips without unrelated writes, and rolls back atomically", async (t) => {
  const { json, api } = await launch(t);
  const { id } = await json("/folders", "POST", { name: "Desktop" });
  const before = (await json("/folders"))[0];
  await json(`/folders/${id}`, "PATCH", { layout: "grid" });
  assert.deepEqual((await json("/folders"))[0], { ...before, layout: "grid" });
  await json(`/folders/${id}`, "PATCH", { name: "Concurrent name" });
  assert.equal((await json("/folders"))[0].layout, "grid");
  for (const layout of ["masonry", "", null, 1, ["grid"]]) {
    assert.equal(
      (await api(`/folders/${id}`, "PATCH", { layout, name: "Must roll back" }))
        .status,
      400,
    );
    assert.equal((await json("/folders"))[0].name, "Concurrent name");
    assert.equal((await json("/folders"))[0].layout, "grid");
  }
  await json(`/folders/${id}`, "PATCH", { layout: "list" });
  assert.equal((await json("/folders"))[0].layout, "list");
});

test("initial folder is validated and created atomically with a fresh membership; archive is independent", async (t) => {
  const { json, api } = await launch(t);
  const { id: folderId } = await json("/folders", "POST", { name: "Reading" });
  for (const invalid of ["missing", null, "", 4]) {
    assert.ok(
      [400, 404].includes(
        (
          await api("/items", "POST", {
            type: "text",
            content: "No orphan",
            folderId: invalid,
          })
        ).status,
      ),
    );
    assert.equal((await json("/items")).items.length, 0);
  }
  const { id } = await json("/items", "POST", {
    type: "text",
    content: "Created here",
    folderId,
  });
  assert.deepEqual((await json(`/items/${id}`)).folderIds, [folderId]);
  assert.equal((await json(`/items?folderId=${folderId}`)).items[0].id, id);
  await json(`/items/${id}`, "PATCH", { archived: true });
  assert.equal((await json(`/items?folderId=${folderId}`)).items.length, 0);
  assert.equal(
    (await json(`/items?folderId=${folderId}&archived=true`)).items[0].id,
    id,
  );
  assert.equal((await json("/folders"))[0].archived_at, null);
  await json(`/folders/${folderId}`, "PATCH", { archived: true });
  await json(`/items/${id}`, "PATCH", { archived: false });
  assert.equal((await json(`/items?folderId=${folderId}`)).items[0].id, id);
});

test("list DTOs carry only bounded plaintext excerpts and safe domain metadata", async (t) => {
  const { json } = await launch(t);
  const text = "<script>synthetic</script>" + "x".repeat(2000);
  const { id } = await json("/items", "POST", { type: "text", content: text });
  const { id: linkId } = await json("/items", "POST", {
    type: "url",
    content: "https://example.com/path?private=query",
  });
  const page = await json("/items");
  const note = page.items.find((i) => i.id === id),
    link = page.items.find((i) => i.id === linkId);
  assert.equal(note.excerpt, text.slice(0, 240));
  assert.equal(note.content, null);
  assert.equal(note.article_text, null);
  assert.equal(link.domain, "example.com");
  assert.equal(link.content, null);
  assert.ok(!JSON.stringify(page).includes("private=query"));
});
