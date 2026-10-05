import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en';
import fr from './fr';

/** Add a language: create `xx.ts` typed as `Dict` and register it here. */
export const LANGUAGES = { fr: 'Français', en: 'English' } as const;
export type Language = keyof typeof LANGUAGES;

void i18n.use(initReactI18next).init({
  resources: { fr: { translation: fr }, en: { translation: en } },
  lng: 'fr',
  // Every language is typed against the French dictionary, so no fallback is needed
  // (and English Minecraft labels must fall back to game ids, not to French).
  fallbackLng: false,
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
