/** Light only — white page, white cards, and the frame (sidebar + topbar) in
 *  the opposite theme, near-black, the way the admin panel this design comes
 *  from looks with the lights on. */
export function bootTheme(): void {
  const el = document.documentElement;
  el.classList.remove("dark");
  el.classList.add("light");
  el.style.colorScheme = "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#050506");
  try {
    localStorage.removeItem("copilot-theme");
  } catch {
    /* private mode */
  }
}
