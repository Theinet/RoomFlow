import React, { useSyncExternalStore } from 'react';
import { translate, translateFeedback, type Language } from './translations.js';

let language: Language = localStorage.getItem('roomflow-language') === 'uk' ? 'uk' : 'en';
const listeners = new Set<() => void>();
export function getLanguage() { return language; }
export function t(key: string, ...values: unknown[]) { return translate(key, language, ...values); }
export function feedback(message: string) { return translateFeedback(message, language); }
export function verificationLink(url: string) {
  const result = new URL(url, window.location.origin);
  result.searchParams.set('lang', language);
  return result.toString();
}
function syncDocument() {
  document.documentElement.lang = language;
  document.title = language === 'en' ? 'RoomFlow — Meeting rooms, made simple' : 'RoomFlow — Бронювання переговорних';
}
syncDocument();
export function useLanguage() {
  return useSyncExternalStore(callback => { listeners.add(callback); return () => listeners.delete(callback); }, getLanguage);
}
export function LanguageSwitcher() {
  const current = useLanguage();
  return <div className="language-switch" role="group" aria-label={current === 'en' ? 'Language' : 'Мова'}>
    {(['en', 'uk'] as const).map(value => <button type="button" key={value} lang={value} aria-label={value === 'en' ? 'English' : 'Українська'} aria-pressed={value === current} onClick={() => {
      language = value;
      localStorage.setItem('roomflow-language', value);
      syncDocument();
      listeners.forEach(listener => listener());
    }}>{value === 'en' ? 'EN' : 'УК'}</button>)}
  </div>;
}
