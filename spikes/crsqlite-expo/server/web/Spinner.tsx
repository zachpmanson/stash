import React from "react";
import { IconRefresh } from "@tabler/icons-react";

/** Dripfeed's loading indicator; the refresh affordance stays still when idle. */
export function Spinner({ active = true }: { active?: boolean }) {
  return <IconRefresh className={`spinner${active ? "" : " is-idle"}`} aria-hidden="true" focusable="false" size={18} stroke={1.7} />;
}
