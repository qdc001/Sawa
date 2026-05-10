import { useEffect, useState } from 'react';

const THEME_KEY = 'kommo:theme'; // 'light' | 'dark'
const PRIMARY_KEY = 'kommo:primary-color';
const DATE_FORMAT_KEY = 'kommo:date-format';

export type Theme = 'light' | 'dark';

export function getTheme(): Theme {
  return (localStorage.getItem(THEME_KEY) as Theme) || 'light';
}

export function setTheme(t: Theme) {
  localStorage.setItem(THEME_KEY, t);
  applyTheme(t);
  window.dispatchEvent(new CustomEvent('theme-changed'));
}

export function applyTheme(t: Theme) {
  if (t === 'dark') document.documentElement.classList.add('dark');
  else document.documentElement.classList.remove('dark');
}

export function applyPrimaryColor(hex: string) {
  if (!hex) return;
  document.documentElement.style.setProperty('--primary', hex);
  // computar primary-light + primary-hover automaticamente
  document.documentElement.style.setProperty('--primary-light', hex + '22');
  document.documentElement.style.setProperty('--primary-hover', darken(hex, 10));
  localStorage.setItem(PRIMARY_KEY, hex);
}

function darken(hex: string, percent: number): string {
  const m = hex.replace('#', '').match(/.{2}/g);
  if (!m) return hex;
  const [r, g, b] = m.map((x) => parseInt(x, 16));
  const f = (1 - percent / 100);
  const dr = Math.max(0, Math.floor(r * f));
  const dg = Math.max(0, Math.floor(g * f));
  const db = Math.max(0, Math.floor(b * f));
  return '#' + [dr, dg, db].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [t, setT] = useState<Theme>(getTheme);
  useEffect(() => {
    const handler = () => setT(getTheme());
    window.addEventListener('theme-changed', handler);
    return () => window.removeEventListener('theme-changed', handler);
  }, []);
  return [t, setTheme];
}

export function applyStoredCustomization() {
  applyTheme(getTheme());
  const primary = localStorage.getItem(PRIMARY_KEY);
  if (primary) applyPrimaryColor(primary);
}

export function setDateFormatPref(f: string) {
  localStorage.setItem(DATE_FORMAT_KEY, f);
}
export function getDateFormatPref(): string {
  return localStorage.getItem(DATE_FORMAT_KEY) || 'DD/MM/YYYY';
}
