import { useState } from "react";

function localLayout(): "grid" | "list" {
  try {
    return window.localStorage.getItem("stash.all.layout") === "grid"
      ? "grid"
      : "list";
  } catch {
    return "list";
  }
}

/** Only all-items local storage; App still mutates replicated folder layouts. */
export function useLayoutPreference() {
  const [allLayout, setLayout] = useState(localLayout);
  function setAllLayout(next: "list" | "grid") {
    setLayout(next);
    try {
      window.localStorage.setItem("stash.all.layout", next);
    } catch {
      /* Storage may be disabled. */
    }
  }
  return [allLayout, setAllLayout] as const;
}
