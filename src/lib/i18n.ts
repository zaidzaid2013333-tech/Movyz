export type Language =
  | 'ar' | 'en' | 'fr' | 'de' | 'es' | 'it' | 'pt' | 'ru' | 'tr' | 'hi' | 'ja' | 'ko'
  | 'zh' | 'nl' | 'sv' | 'da' | 'no' | 'fi' | 'pl' | 'cs' | 'uk' | 'he' | 'vi'
  | 'id' | 'ms' | 'th' | 'ro' | 'hu' | 'el' | 'bn' | 'ur' | 'fa';

export interface LanguageConfig {
  code: Language;
  tmdb: string;
  region: string;
  label: string;
  nativeName: string;
  countries: string[];
}

export const LANGUAGE_CONFIGS: Record<Language, LanguageConfig> = {
  ar: { code: 'ar', tmdb: 'ar-SA', region: 'DZ', label: 'Arabic', nativeName: 'العربية', countries: ['AE','BH','DJ','DZ','EG','IQ','JO','KM','KW','LB','LY','MA','MR','OM','PS','QA','SA','SD','SO','SY','TN','YE','TD'] },
  en: { code: 'en', tmdb: 'en-US', region: 'US', label: 'English', nativeName: 'English', countries: ['US','GB','CA','AU','NZ','IE','SG','JM','BS','BB','TT','GD','LC','VC','AG','DM','KN','BZ','GY','FJ','PG','SB','VU','WS','TO','FM','MH','PW','NR','KI','GH','NG','KE','UG','TZ','ZM','ZW','MW','BW','NA','LS','SZ','SL','LR','GM','SS','MU','SC','ZA','ET','ER','LR','MT','IS','AL','BA','ME','MK','RS','SI','HR','BG','RO','MD','GR','CY','EE','LV','LT','CH','AD','MC','SM','VA','LI','AQ','AS','AW','AX','BM','BN','BQ','BV','CC','CK','CW','CX','FK','FO','GG','GI','GL','GS','GU','HM','IM','IO','JE','KY','MM','MP','MS','NF','NU','SJ','SR','SX','TC','TF','TK','TV','UM','VG','VI','KH','LA','MN','NP','PH','PK','LK','IR','AF','AM','GE','KZ','KG','UZ','TJ','TM','AZ'] },
  fr: { code: 'fr', tmdb: 'fr-FR', region: 'FR', label: 'French', nativeName: 'Français', countries: ['FR','BE','LU','MC','SN','CI','BF','BJ','TG','ML','NE','GN','GA','CG','CD','CM','CF','MG','RW','BI','HT','TD','GQ','DJ','RE','GP','GF','MQ','NC','PF','PM','BL','MF','YT','WF','VU'] },
  de: { code: 'de', tmdb: 'de-DE', region: 'DE', label: 'German', nativeName: 'Deutsch', countries: ['DE','AT','CH','LI'] },
  es: { code: 'es', tmdb: 'es-ES', region: 'ES', label: 'Spanish', nativeName: 'Español', countries: ['ES','MX','AR','CL','CO','PE','VE','UY','EC','BO','PY','CR','GT','PA','HN','SV','NI','CU','DO','GQ','PR'] },
  it: { code: 'it', tmdb: 'it-IT', region: 'IT', label: 'Italian', nativeName: 'Italiano', countries: ['IT','SM','VA'] },
  pt: { code: 'pt', tmdb: 'pt-BR', region: 'BR', label: 'Portuguese', nativeName: 'Português', countries: ['PT','BR','AO','MZ','CV','GW','ST','TL'] },
  ru: { code: 'ru', tmdb: 'ru-RU', region: 'RU', label: 'Russian', nativeName: 'Русский', countries: ['RU','BY','KZ','KG','AM','GE','UZ','TJ','TM','MN'] },
  tr: { code: 'tr', tmdb: 'tr-TR', region: 'TR', label: 'Turkish', nativeName: 'Türkçe', countries: ['TR','AZ'] },
  hi: { code: 'hi', tmdb: 'hi-IN', region: 'IN', label: 'Hindi', nativeName: 'हिन्दी', countries: ['IN','NP'] },
  ja: { code: 'ja', tmdb: 'ja-JP', region: 'JP', label: 'Japanese', nativeName: '日本語', countries: ['JP'] },
  ko: { code: 'ko', tmdb: 'ko-KR', region: 'KR', label: 'Korean', nativeName: '한국어', countries: ['KR','KP'] },
  zh: { code: 'zh', tmdb: 'zh-CN', region: 'CN', label: 'Chinese', nativeName: '中文', countries: ['CN','TW','HK','MO'] },
  nl: { code: 'nl', tmdb: 'nl-NL', region: 'NL', label: 'Dutch', nativeName: 'Nederlands', countries: ['NL'] },
  sv: { code: 'sv', tmdb: 'sv-SE', region: 'SE', label: 'Swedish', nativeName: 'Svenska', countries: ['SE'] },
  da: { code: 'da', tmdb: 'da-DK', region: 'DK', label: 'Danish', nativeName: 'Dansk', countries: ['DK'] },
  no: { code: 'no', tmdb: 'no-NO', region: 'NO', label: 'Norwegian', nativeName: 'Norsk', countries: ['NO'] },
  fi: { code: 'fi', tmdb: 'fi-FI', region: 'FI', label: 'Finnish', nativeName: 'Suomi', countries: ['FI'] },
  pl: { code: 'pl', tmdb: 'pl-PL', region: 'PL', label: 'Polish', nativeName: 'Polski', countries: ['PL'] },
  cs: { code: 'cs', tmdb: 'cs-CZ', region: 'CZ', label: 'Czech', nativeName: 'Čeština', countries: ['CZ'] },
  uk: { code: 'uk', tmdb: 'uk-UA', region: 'UA', label: 'Ukrainian', nativeName: 'Українська', countries: ['UA'] },
  he: { code: 'he', tmdb: 'he-IL', region: 'IL', label: 'Hebrew', nativeName: 'עברית', countries: ['IL'] },
  vi: { code: 'vi', tmdb: 'vi-VN', region: 'VN', label: 'Vietnamese', nativeName: 'Tiếng Việt', countries: ['VN'] },
  id: { code: 'id', tmdb: 'id-ID', region: 'ID', label: 'Indonesian', nativeName: 'Bahasa Indonesia', countries: ['ID'] },
  ms: { code: 'ms', tmdb: 'ms-MY', region: 'MY', label: 'Malay', nativeName: 'Bahasa Melayu', countries: ['MY','BN'] },
  th: { code: 'th', tmdb: 'th-TH', region: 'TH', label: 'Thai', nativeName: 'ไทย', countries: ['TH'] },
  ro: { code: 'ro', tmdb: 'ro-RO', region: 'RO', label: 'Romanian', nativeName: 'Română', countries: ['RO','MD'] },
  hu: { code: 'hu', tmdb: 'hu-HU', region: 'HU', label: 'Hungarian', nativeName: 'Magyar', countries: ['HU'] },
  el: { code: 'el', tmdb: 'el-GR', region: 'GR', label: 'Greek', nativeName: 'Ελληνικά', countries: ['GR','CY'] },
  bn: { code: 'bn', tmdb: 'bn-BD', region: 'BD', label: 'Bengali', nativeName: 'বাংলা', countries: ['BD'] },
  ur: { code: 'ur', tmdb: 'ur-PK', region: 'PK', label: 'Urdu', nativeName: 'اردو', countries: ['PK'] },
  fa: { code: 'fa', tmdb: 'fa-IR', region: 'IR', label: 'Persian', nativeName: 'فارسی', countries: ['IR','AF'] },
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

// ISO 3166-1 country -> primary Movyza language. For multilingual countries,
// this chooses the dominant/primary supported official language; an explicit
// localized URL still always wins over automatic country detection.
const COUNTRY_GROUPS: Record<Language, string[]> = {
  ar: LANGUAGE_CONFIGS.ar.countries,
  en: LANGUAGE_CONFIGS.en.countries,
  fr: LANGUAGE_CONFIGS.fr.countries,
  de: LANGUAGE_CONFIGS.de.countries,
  es: LANGUAGE_CONFIGS.es.countries,
  it: LANGUAGE_CONFIGS.it.countries,
  pt: LANGUAGE_CONFIGS.pt.countries,
  ru: LANGUAGE_CONFIGS.ru.countries,
  tr: LANGUAGE_CONFIGS.tr.countries,
  hi: LANGUAGE_CONFIGS.hi.countries,
  ja: LANGUAGE_CONFIGS.ja.countries,
  ko: LANGUAGE_CONFIGS.ko.countries,
  zh: LANGUAGE_CONFIGS.zh.countries,
  nl: LANGUAGE_CONFIGS.nl.countries,
  sv: LANGUAGE_CONFIGS.sv.countries,
  da: LANGUAGE_CONFIGS.da.countries,
  no: LANGUAGE_CONFIGS.no.countries,
  fi: LANGUAGE_CONFIGS.fi.countries,
  pl: LANGUAGE_CONFIGS.pl.countries,
  cs: LANGUAGE_CONFIGS.cs.countries,
  uk: LANGUAGE_CONFIGS.uk.countries,
  he: LANGUAGE_CONFIGS.he.countries,
  vi: LANGUAGE_CONFIGS.vi.countries,
  id: LANGUAGE_CONFIGS.id.countries,
  ms: LANGUAGE_CONFIGS.ms.countries,
  th: LANGUAGE_CONFIGS.th.countries,
  ro: LANGUAGE_CONFIGS.ro.countries,
  hu: LANGUAGE_CONFIGS.hu.countries,
  el: LANGUAGE_CONFIGS.el.countries,
  bn: LANGUAGE_CONFIGS.bn.countries,
  ur: LANGUAGE_CONFIGS.ur.countries,
  fa: LANGUAGE_CONFIGS.fa.countries,
};

export const COUNTRY_TO_LANGUAGE: Record<string, Language> = Object.fromEntries(
  Object.entries(COUNTRY_GROUPS).flatMap(([language, countries]) =>
    countries.map((country) => [country, language as Language]),
  ),
);

export const detectLanguageFromBrowser = (): Language => {
  if (typeof navigator === 'undefined') return 'ar';
  for (const candidate of navigator.languages || []) {
    const found = languageFromLocaleTag(candidate);
    if (found) return found;
  }
  return languageFromLocaleTag(navigator.language) || 'ar';
};

export const detectLanguageFromCountry = (country: string | null | undefined): Language | null =>
  COUNTRY_TO_LANGUAGE[String(country || '').toUpperCase()] || null;

export const localizeLabel = (language: Language) => LANGUAGE_CONFIGS[language].nativeName;
