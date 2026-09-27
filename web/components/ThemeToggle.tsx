"use client";

// Switches between light and dark. Until you press it, the site follows the phone/computer setting.
export default function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const current =
      root.dataset.theme ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Private browsing can block storage; the toggle still works for this visit.
    }
  }

  return (
    <button className="theme-toggle" onClick={toggle} aria-label="Switch light or dark mode" title="Light / dark">
      ◐
    </button>
  );
}
