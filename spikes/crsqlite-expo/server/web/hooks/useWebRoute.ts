import { useState } from "react";

export type Route = {
  folderId: string;
  archived: boolean;
  selected: string;
  offset: number;
};
export function readRoute(): Route {
  const q = new URLSearchParams(window.location?.search ?? "");
  return {
    folderId: q.get("folder") ?? "",
    archived: q.get("archive") === "1",
    selected: q.get("item") ?? "",
    offset: Math.trunc(
      Math.max(0, Math.min(99999900, Number(q.get("offset")) || 0)),
    ),
  };
}
export function routeUrl(route: Route) {
  const q = new URLSearchParams();
  if (route.folderId) q.set("folder", route.folderId);
  if (route.archived) q.set("archive", "1");
  if (route.selected) q.set("item", route.selected);
  if (route.offset) q.set("offset", String(route.offset));
  return `${window.location?.pathname ?? "/"}${q.size ? `?${q}` : ""}`;
}

/** URL mechanics only. App owns discard/busy guards and transition resets. */
export function useWebRoute() {
  const [route, setRoute] = useState(readRoute);
  function writeRoute(next: Route, replace = false) {
    const url = routeUrl(next);
    if (
      replace ||
      `${window.location?.pathname ?? "/"}${window.location?.search ?? ""}` !==
        url
    )
      window.history?.[replace ? "replaceState" : "pushState"](null, "", url);
    setRoute(next);
  }
  return { route, setRoute, writeRoute };
}
