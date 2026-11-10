
/**
 * PRINTING A DASHBOARD
 *
 * The printout is the dashboard itself — the same blocks, on paper. There is no
 * second report to keep in step with the first: `print.css` hides the frame
 * (rail, topbar, tab strip, copilot), unrolls the scrolling card and keeps each
 * card, chart and table whole on a sheet.
 *
 * Two things have to happen in JavaScript rather than in CSS:
 *
 *  - A dashboard read in the dark theme is a sheet of ink on paper, so the light
 *    palette is switched on for the print and switched back after it.
 *    `applyTheme` only touches the document, never the stored preference, so the
 *    reader's choice survives.
 *  - The switch needs a frame to paint before the browser takes its snapshot.
 */
export function printDashboard(): void {
  requestAnimationFrame(() => window.print());
}
