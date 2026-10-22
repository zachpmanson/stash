import React from "react";
import { ArrowPathIcon } from "@heroicons/react/24/outline";

/** Dripfeed's loading indicator; the refresh affordance stays still when idle. */
export function Spinner({ active = true }: { active?: boolean }) {
  return <ArrowPathIcon className={`spinner${active ? "" : " is-idle"}`} aria-hidden="true" />;
}
