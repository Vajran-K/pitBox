import { useEffect, useState } from "react";

type Theme = "light" | "dark";
const KEY = "pitbox.theme";

function current(): Theme {
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Light/dark switch. Follows the system until you choose; your choice is remembered on this device. */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(current);
  // keep in step with the system while nothing has been chosen
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const on = () => { if (!document.documentElement.dataset.theme) setTheme(current()); };
    mq?.addEventListener?.("change", on);
    return () => mq?.removeEventListener?.("change", on);
  }, []);
  const flip = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem(KEY, next); } catch { /* not remembered */ }
    setTheme(next);
  };
  const dark = theme === "dark";
  return (
    <button className="theme-toggle" onClick={flip} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} title={dark ? "Light theme" : "Dark theme"}>
      {dark ? (
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="4.2" fill="currentColor" /><g stroke="currentColor" strokeWidth="2" strokeLinecap="round">{[0, 45, 90, 135, 180, 225, 270, 315].map((a) => <line key={a} x1="12" y1="2.5" x2="12" y2="5" transform={`rotate(${a} 12 12)`} />)}</g></svg>
      ) : (
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z" fill="currentColor" /></svg>
      )}
    </button>
  );
}
