import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import en from './locales/en.json';
import ha from './locales/ha.json';
import yo from './locales/yo.json';
import ig from './locales/ig.json';

export const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'ha', name: 'Hausa', nativeName: 'Hausa' },
  { code: 'yo', name: 'Yoruba', nativeName: 'Yorùbá' },
  { code: 'ig', name: 'Igbo', nativeName: 'Igbo' },
] as const;

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ha: { translation: ha },
      yo: { translation: yo },
      ig: { translation: ig },
    },
    fallbackLng: 'en',
    supportedLngs: ['en', 'ha', 'yo', 'ig'],
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
      lookupLocalStorage: 'insureportal_language',
    },
  });

export default i18n;
