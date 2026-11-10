import React from "react";
import { createRoot } from "react-dom/client";
import { library } from "@fortawesome/fontawesome-svg-core";
import { glyphs } from "./lib/icons";
import App from "./App";
import { initHairline } from "./lib/hairline";
import { bootTheme } from "./lib/theme";
import "./styles.css";
// Loaded after the design system: the dashboard on paper (lib/print.ts).
import "./print.css";

// The design system draws ONE hairline, pinned to a whole device pixel. Has to
// run before the first paint or every border is antialiased on a scaled display.
initHairline();
bootTheme();

// Icons are registered by name, so a component can ask for
// "fa-sharp fa-regular fa-chart-line" as a string instead of importing a glyph.
// Only the glyphs the app uses are vendored (lib/icons.ts).
library.add(...(glyphs as Parameters<typeof library.add>));

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
