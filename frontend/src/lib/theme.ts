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

/** Organization brand colour: overrides the primary colour used by buttons, links and highlights. */
export function applyBrandColor(hex) {
  const root = document.documentElement.style;
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) {
    for (const v of ['--primary', '--primary-dark', '--primary-soft']) root.removeProperty(v);
    return;
  }
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255];
  const dark = `rgb(${Math.round(r * 0.82)}, ${Math.round(g * 0.82)}, ${Math.round(b * 0.82)})`;
  root.setProperty('--primary', hex);
  root.setProperty('--primary-dark', dark);
  root.setProperty('--primary-soft', `rgba(${r}, ${g}, ${b}, 0.12)`);
}
