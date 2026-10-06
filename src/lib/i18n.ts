export type Language =
  | 'ar'
  | 'en'
  | 'fr'
  | 'de'
  | 'es'
  | 'it'
  | 'pt'
  | 'ru'
  | 'tr'
  | 'hi'
  | 'ja'
  | 'ko';

export interface LanguageConfig {
  code: Language;
  tmdb: string;
  region: string;
  label: string;
  nativeName: string;
  countries: string[];
}

export const LANGUAGE_CONFIGS: Record<Language, LanguageConfig> = {
  ar: { code: 'ar', tmdb: 'ar-SA', region: 'DZ', label: 'Arabic', nativeName: 'العربية', countries: ['AE','BH','DJ','DZ','EG','EH','IQ','JO','KM','KW','LB','LY','MA','MR','OM','PS','QA','SA','SD','SO','SY','TN','YE'] },
  en: { code: 'en', tmdb: 'en-US', region: 'US', label: 'English', nativeName: 'English', countries: ['US','GB','CA','AU','NZ','IE','ZA','SG','JM','BS','BB','TT','GD','LC','VC','AG','DM','KN','BZ','GY','FJ','PG','SB','VU','WS','TO','FM','MH','PW','NR','KI','GH','NG','KE','UG','TZ','ZM','ZW','MW','BW','NA','LS','SZ','SL','LR','GM','SS','MU','SC','CN','TW','HK','MO','NL','SE','NO','DK','FI','IS','PL','CZ','SK','HU','RO','BG','HR','SI','RS','BA','ME','MK','AL','EE','LV','LT','MD','UA','GR','MT','CY','GE','AM','AZ','UZ','TJ','TM','AF','NP','BD','LK','MV','PK','MY','TH','ID','PH','VN','KH','LA','MN','IL','IR','AD','AI','AQ','AS','AW','AX','BM','BN','BQ','BV','CC','CK','CW','CX','ER','ET','FK','FO','GG','GI','GL','GS','GU','HM','IM','IO','JE','KY','MM','MP','MS','NF','NU','SJ','SR','SX','TC','TF','TK','TV','UM','VG','VI'] },
  fr: { code: 'fr', tmdb: 'fr-FR', region: 'FR', label: 'French', nativeName: 'Français', countries: ['FR','BE','LU','MC','SN','CI','BF','BJ','TG','ML','NE','GN','GA','CG','CD','CM','CF','TD','MG','RW','BI','HT','GP','GF','MQ','NC','PF','PM','RE','BL','MF','YT','WF'] },
  de: { code: 'de', tmdb: 'de-DE', region: 'DE', label: 'German', nativeName: 'Deutsch', countries: ['DE','AT','CH','LI'] },
  es: { code: 'es', tmdb: 'es-ES', region: 'ES', label: 'Spanish', nativeName: 'Español', countries: ['ES','MX','AR','CL','CO','PE','VE','UY','EC','BO','PY','CR','GT','PA','HN','SV','NI','CU','DO','GQ','PR'] },
  it: { code: 'it', tmdb: 'it-IT', region: 'IT', label: 'Italian', nativeName: 'Italiano', countries: ['IT','SM','VA'] },
  pt: { code: 'pt', tmdb: 'pt-BR', region: 'BR', label: 'Portuguese', nativeName: 'Português', countries: ['PT','BR','AO','MZ','CV','GW','ST','TL'] },
  ru: { code: 'ru', tmdb: 'ru-RU', region: 'RU', label: 'Russian', nativeName: 'Русский', countries: ['RU','BY','KZ','KG'] },
  tr: { code: 'tr', tmdb: 'tr-TR', region: 'TR', label: 'Turkish', nativeName: 'Türkçe', countries: ['TR'] },
  hi: { code: 'hi', tmdb: 'hi-IN', region: 'IN', label: 'Hindi', nativeName: 'हिन्दी', countries: ['IN'] },
  ja: { code: 'ja', tmdb: 'ja-JP', region: 'JP', label: 'Japanese', nativeName: '日本語', countries: ['JP'] },
  ko: { code: 'ko', tmdb: 'ko-KR', region: 'KR', label: 'Korean', nativeName: '한국어', countries: ['KR','KP'] },
};

export const LANGUAGE_LIST = Object.values(LANGUAGE_CONFIGS);

export const getLanguageConfig = (language: Language) => LANGUAGE_CONFIGS[language];

export const isLanguage = (value: string | null | undefined): value is Language =>
  !!value && value in LANGUAGE_CONFIGS;

export const getLanguageFromPath = (pathname: string): Language | null => {
  const first = pathname.split('/').filter(Boolean)[0] || '';
  return isLanguage(first) ? first : null;
};

export const stripLanguagePrefix = (pathname: string) => {
  const language = getLanguageFromPath(pathname);
  if (!language) return { language: null, pathname: pathname || '/' };
  const stripped = '/' + pathname.split('/').filter(Boolean).slice(1).join('/');
  return { language, pathname: stripped === '/' ? '/' : stripped || '/' };
};

export const withLanguagePrefix = (pathname: string, language: Language): string => {
  const clean = pathname.startsWith('/') ? pathname : '/' + pathname;
  if (getLanguageFromPath(clean)) {
    const stripped = stripLanguagePrefix(clean).pathname;
    return stripped === '/' ? `/${language}/` : `/${language}${stripped}`;
  }
  return clean === '/' ? `/${language}/` : `/${language}${clean}`;
};

export const languageFromLocaleTag = (value: string | null | undefined): Language | null => {
  const raw = String(value || '').toLowerCase().split('-')[0];
  return isLanguage(raw) ? raw : null;
};

export const detectLanguageFromBrowser = (): Language => {
  if (typeof navigator === 'undefined') return 'ar';
  for (const candidate of navigator.languages || []) {
    const found = languageFromLocaleTag(candidate);
    if (found) return found;
  }
  return languageFromLocaleTag(navigator.language) || 'ar';
};

export const detectLanguageFromCountry = (country: string | null | undefined): Language | null => {
  const upper = String(country || '').toUpperCase();
  if (!upper) return null;
  for (const config of LANGUAGE_LIST) {
    if (config.countries.includes(upper)) return config.code;
  }
  return null;
};

export const localizeLabel = (language: Language) => LANGUAGE_CONFIGS[language].nativeName;
