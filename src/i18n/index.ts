import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import zh from './locales/zh.json';
import en from './locales/en.json';

i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
        resources: {
            zh: { translation: zh },
            en: { translation: en },
        },
        fallbackLng: 'zh', // Default to Chinese if detection fails
        supportedLngs: ['zh', 'en'],
        load: 'languageOnly', // Load 'zh' instead of 'zh-CN', 'en' instead of 'en-US'
        detection: {
            // Detection order: browser language first, then localStorage
            order: ['navigator', 'localStorage', 'htmlTag'],
            caches: ['localStorage'],
            lookupLocalStorage: 'i18nextLng',
        },
        interpolation: {
            escapeValue: false, // React already escapes by default
        },
    });

export default i18n;
