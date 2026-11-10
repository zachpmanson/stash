import React from "react";
import { createRoot } from "react-dom/client";
import { Tooltip } from "@base-ui/react/tooltip";
import { App } from "./App.js";
createRoot(document.getElementById("root")!).render(<Tooltip.Provider delay={400}><App /></Tooltip.Provider>);
