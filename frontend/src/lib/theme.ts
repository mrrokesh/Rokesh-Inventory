// Appearance preference: 'system' (default), 'light' or 'dark'. Stored per browser.
const KEY = 'inv_theme';

export function getTheme() {
  try { return localStorage.getItem(KEY) || 'system'; } catch { return 'system'; }
}

export function applyTheme(pref = getTheme()) {
  const root = document.documentElement;
  if (pref === 'light' || pref === 'dark') root.dataset.theme = pref;
  else delete root.dataset.theme;
}

export function setTheme(pref) {
  try { localStorage.setItem(KEY, pref); } catch { /* storage unavailable: applies for this visit only */ }
  applyTheme(pref);
}

/** True when the dark appearance is currently in effect (for chart colours). */
export function isDark() {
  const t = document.documentElement.dataset.theme;
  if (t) return t === 'dark';
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}
