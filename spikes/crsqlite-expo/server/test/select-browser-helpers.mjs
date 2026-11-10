import assert from "node:assert/strict";

export async function selectArchive({ evaluate, cdp, waitFor }, archived) {
  const key = async (key, windowsVirtualKeyCode) => {
    for (const type of ["keyDown", "keyUp"])
      await cdp("Input.dispatchKeyEvent", { type, key, windowsVirtualKeyCode });
  };
  await evaluate(`document.querySelector('.archive-select').focus()`);
  await key("ArrowDown", 40);
  await waitFor(() => evaluate(`document.querySelector('.archive-select').getAttribute('aria-expanded')==='true' && document.activeElement.getAttribute('role')==='option'`));
  await key(archived ? "End" : "Home", archived ? 35 : 36);
  await waitFor(() => evaluate(`document.activeElement.getAttribute('role')==='option' && document.activeElement.textContent===${JSON.stringify(archived ? "Archived items" : "Active items")}`));
  await key("Enter", 13);
  try {
    await waitFor(() => evaluate(`document.querySelector('.archive-select').getAttribute('aria-expanded')==='false' && !document.querySelector('[role=listbox]')?.getBoundingClientRect().height`));
  } catch (error) {
    console.log('SELECT_FAILURE', await evaluate(`({trigger:document.querySelector('.archive-select').outerHTML, popup:document.querySelector('[role=listbox]')?.parentElement.parentElement.outerHTML, rect:document.querySelector('[role=listbox]')?.getBoundingClientRect().toJSON(), active:document.activeElement.outerHTML, route:location.search})`));
    throw error;
  }
}

/** Real keyboard input into the unmocked Base UI Select (not a hidden-input change). */
export async function selectType({ evaluate, cdp, waitFor }, value) {
  const key = async (key, code) => {
    for (const type of ["keyDown", "keyUp"])
      await cdp("Input.dispatchKeyEvent", { type, key, windowsVirtualKeyCode: code });
  };
  await evaluate(`document.querySelector('.type-select').focus()`);
  await key("ArrowDown", 40);
  await waitFor(() => evaluate(`document.querySelector('.type-select').getAttribute('aria-expanded')==='true' && document.activeElement.getAttribute('role')==='option'`));
  await key("Home", 36);
  for (let n = 0; n < ["text", "url", "image"].indexOf(value); n++) await key("ArrowDown", 40);
  await waitFor(() => evaluate(`document.activeElement.getAttribute('role')==='option' && document.activeElement.textContent===${JSON.stringify({ text: "Text", url: "Link", image: "Image" }[value])}`));
  await key("Enter", 13);
  await waitFor(() => evaluate(`document.querySelector('.type-select').getAttribute('aria-expanded')==='false' && !document.querySelector('[role=listbox]')?.getBoundingClientRect().height && document.querySelector('.reader input[name=type]').value===${JSON.stringify(value)}`));
  assert.ok(await evaluate(`document.activeElement===document.querySelector('.type-select')`), "Select returns keyboard focus to its trigger");
  assert.equal(await evaluate(`new FormData(document.querySelector('.reader form')).get('type')`), value);
}
