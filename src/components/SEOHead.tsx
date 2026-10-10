import React, { useEffect } from 'react';
import {
  Language,
  LANGUAGE_LIST,
  getLanguageConfig,
  getLanguageFromPath,
  stripLanguagePrefix,
  withLanguagePrefix,
} from '../lib/i18n';

interface SeoHeadProps {
  title: string;
  description: string;
  keywords?: string[];
  image?: string;
  type?: 'website' | 'video.movie' | 'video.tv_show';
  noindex?: boolean;
  jsonLd?: Record<string, unknown>;
}

const ensureMeta = (selector: string, attrs: Record<string, string>, content: string) => {
  let node = document.head.querySelector<HTMLMetaElement>(selector);
  if (!node) {
    node = document.createElement('meta');
    Object.entries(attrs).forEach(([key, value]) => node!.setAttribute(key, value));
    document.head.appendChild(node);
  }
  node.setAttribute('content', content);
};

const ensureLink = (rel: string, href: string, attrs: Record<string, string> = {}) => {
  const selector = `link[rel="${rel}"]${attrs.hreflang ? `[hreflang="${attrs.hreflang}"]` : ''}`;
  let node = document.head.querySelector<HTMLLinkElement>(selector);
  if (!node) {
    node = document.createElement('link');
    node.setAttribute('rel', rel);
    Object.entries(attrs).forEach(([key, value]) => node!.setAttribute(key, value));
    document.head.appendChild(node);
  }
  node.setAttribute('href', href);
};

const keywordTerms: Record<Language, string[]> = {
  ar: ['مترجم عربي','مشاهدة','فيلم','مسلسل'], en: ['watch','movie','series','online'],
  fr: ['film','regarder','streaming'], de: ['Film','Stream','online'], es: ['película','ver','online'],
  it: ['film','guardare','streaming'], pt: ['filme','assistir','online'], ru: ['фильм','смотреть','онлайн'],
  tr: ['film izle','izle','online'], hi: ['movie','watch','series'], ja: ['映画','見る','ドラマ'],
  ko: ['영화','보기','드라마'], zh: ['电影','观看','剧集'], nl: ['film','serie','kijken'],
  sv: ['film','se','serie'], da: ['film','se','serie'], no: ['film','se','serie'], fi: ['elokuva','katso','sarja'],
  pl: ['film','oglądaj','serial'], cs: ['film','sledovat','seriál'], uk: ['фільм','дивитися','серіал'],
  he: ['סרט','צפייה','סדרה'], vi: ['phim','xem','series'], id: ['film','nonton','serial'],
  ms: ['filem','tonton','siri'], th: ['หนัง','ดู','ซีรีส์'], ro: ['film','vezi','serial'],
  hu: ['film','nézd','sorozat'], el: ['ταινία','δες','σειρά'], bn: ['সিনেমা','দেখুন','সিরিজ'],
  ur: ['فلم','دیکھیں','سیریز'], fa: ['فیلم','تماشا','سریال'],
};

export type FreeContentKind = 'movie' | 'series' | 'episode';

const FREE_CONTENT_TITLES: Record<Language, Record<FreeContentKind, string> | string> = {
  ar: { movie: 'مشاهدة {title} مجانًا', series: 'مشاهدة مسلسل {title} مجانًا', episode: 'مشاهدة حلقة {title} مجانًا' },
  en: { movie: 'Watch {title} Online Free', series: 'Watch {title} Series Online Free', episode: 'Watch {title} Episode Free' },
  fr: { movie: 'Regarder {title} gratuitement', series: 'Regarder la série {title} gratuitement', episode: 'Regarder l’épisode {title} gratuitement' },
  de: { movie: '{title} kostenlos online ansehen', series: 'Serie {title} kostenlos ansehen', episode: 'Folge {title} kostenlos ansehen' },
  es: 'Ver {title} gratis online|Ver la serie {title} gratis|Ver el episodio {title} gratis',
  it: 'Guarda {title} gratis online|Guarda la serie {title} gratis|Guarda l’episodio {title} gratis',
  pt: 'Assistir {title} grátis online|Assistir à série {title} grátis|Assistir ao episódio {title} grátis',
  ru: 'Смотреть {title} бесплатно|Смотреть сериал {title} бесплатно|Смотреть серию {title} бесплатно',
  tr: '{title} ücretsiz izle|{title} dizisini ücretsiz izle|{title} bölümünü ücretsiz izle',
  hi: '{title} मुफ़्त ऑनलाइन देखें|{title} सीरीज़ मुफ़्त देखें|{title} एपिसोड मुफ़्त देखें',
  ja: '{title}を無料で視聴|ドラマ{title}を無料で視聴|エピソード{title}を無料で視聴',
  ko: '{title} 무료 시청|드라마 {title} 무료 시청|에피소드 {title} 무료 시청',
  zh: '免费在线看{title}|免费在线看剧集{title}|免费在线看{title}这一集',
  nl: '{title} gratis online kijken|Serie {title} gratis kijken|Aflevering {title} gratis kijken',
  sv: 'Se {title} gratis online|Se serien {title} gratis|Se avsnittet {title} gratis',
  da: 'Se {title} gratis online|Se serien {title} gratis|Se afsnittet {title} gratis',
  no: 'Se {title} gratis på nett|Se serien {title} gratis|Se episoden {title} gratis',
  fi: 'Katso {title} ilmaiseksi verkossa|Katso sarja {title} ilmaiseksi|Katso jakso {title} ilmaiseksi',
  pl: 'Oglądaj {title} online za darmo|Oglądaj serial {title} za darmo|Oglądaj odcinek {title} za darmo',
  cs: 'Sledujte {title} online zdarma|Sledujte seriál {title} zdarma|Sledujte epizodu {title} zdarma',
  uk: 'Дивіться {title} безкоштовно онлайн|Дивіться серіал {title} безкоштовно|Дивіться епізод {title} безкоштовно',
  he: 'צפו ב־{title} בחינם|צפו בסדרה {title} בחינם|צפו בפרק {title} בחינם',
  vi: 'Xem {title} miễn phí trực tuyến|Xem phim bộ {title} miễn phí|Xem tập {title} miễn phí',
  id: 'Nonton {title} online gratis|Nonton serial {title} gratis|Nonton episode {title} gratis',
  ms: 'Tonton {title} dalam talian secara percuma|Tonton siri {title} secara percuma|Tonton episod {title} secara percuma',
  th: 'ดู{title}ออนไลน์ฟรี|ดูซีรีส์{title}ฟรี|ดูตอน{title}ฟรี',
  ro: 'Urmărește {title} gratuit online|Urmărește serialul {title} gratuit|Urmărește episodul {title} gratuit',
  hu: 'Nézd meg a(z) {title} című filmet ingyen|Nézd meg a(z) {title} sorozatot ingyen|Nézd meg a(z) {title} epizódot ingyen',
  el: 'Δείτε το {title} δωρεάν online|Δείτε τη σειρά {title} δωρεάν|Δείτε το επεισόδιο {title} δωρεάν',
  bn: '{title} বিনামূল্যে অনলাইনে দেখুন|{title} সিরিজ বিনামূল্যে দেখুন|{title} পর্ব বিনামূল্যে দেখুন',
  ur: '{title} مفت آن لائن دیکھیں|سیریز {title} مفت دیکھیں|قسط {title} مفت دیکھیں',
  fa: '{title} را رایگان آنلاین تماشا کنید|سریال {title} را رایگان تماشا کنید|قسمت {title} را رایگان تماشا کنید',
};

const resolveFreeContentTemplate = (language: Language, kind: FreeContentKind) => {
  const raw = FREE_CONTENT_TITLES[language] || FREE_CONTENT_TITLES.en;
  if (typeof raw === 'string') {
    const [movie, series, episode] = raw.split('|');
    return ({ movie, series, episode } as Record<FreeContentKind, string>)[kind];
  }
  return raw[kind];
};

export const buildFreeContentTitle = (language: Language, title: string, kind: FreeContentKind) => {
  const cleanTitle = String(title || '').replace(/\s+/g, ' ').trim();
  const template = resolveFreeContentTemplate(language, kind);
  return `${(template || resolveFreeContentTemplate('en', 'movie')).replace('{title}', cleanTitle)} | Movyza`;
};

export const buildSeoKeywords = (language: Language, title: string, extra: string[] = []) =>
  Array.from(new Set([
    title,
    ...(keywordTerms[language] || keywordTerms.en).map((term) => term + ' ' + title),
    ...extra,
  ])).slice(0, 18);

export const SeoHead: React.FC<SeoHeadProps> = ({
  title,
  description,
  keywords = [],
  image,
  type = 'website',
  noindex = false,
  jsonLd,
}) => {
  useEffect(() => {
    const language = getLanguageFromPath(window.location.pathname) || 'ar';
    const origin = window.location.origin;
    const current = stripLanguagePrefix(window.location.pathname).pathname;
    const canonicalPath = withLanguagePrefix(current, language);
    document.title = title;

    ensureMeta('meta[name="description"]', { name: 'description' }, description);
    ensureMeta('meta[name="keywords"]', { name: 'keywords' }, buildSeoKeywords(language, title, keywords).join(', '));
    ensureMeta('meta[name="robots"]', { name: 'robots' }, noindex ? 'noindex,follow' : 'index,follow,max-image-preview:large');
    ensureMeta('meta[property="og:title"]', { property: 'og:title' }, title);
    ensureMeta('meta[property="og:description"]', { property: 'og:description' }, description);
    ensureMeta('meta[property="og:type"]', { property: 'og:type' }, type);
    ensureMeta('meta[name="twitter:title"]', { name: 'twitter:title' }, title);
    ensureMeta('meta[name="twitter:description"]', { name: 'twitter:description' }, description);

    if (image) {
      ensureMeta('meta[property="og:image"]', { property: 'og:image' }, image);
      ensureMeta('meta[name="twitter:image"]', { name: 'twitter:image' }, image);
    }

    ensureLink('canonical', origin + canonicalPath);

    for (const config of LANGUAGE_LIST) {
      ensureLink('alternate', origin + withLanguagePrefix(current, config.code), { hreflang: config.tmdb.toLowerCase() });
    }
    ensureLink('alternate', origin + withLanguagePrefix(current, 'en'), { hreflang: 'x-default' });

    document.querySelectorAll('link[rel="alternate"][data-movyz-hreflang]').forEach((node) => {
      const code = node.getAttribute('data-movyz-hreflang');
      if (!code) return;
      if (!LANGUAGE_LIST.some((entry) => entry.tmdb.toLowerCase() === code)) node.remove();
    });

    let script = document.getElementById('movyz-jsonld') as HTMLScriptElement | null;
    if (jsonLd) {
      if (!script) {
        script = document.createElement('script');
        script.id = 'movyz-jsonld';
        script.type = 'application/ld+json';
        document.head.appendChild(script);
      }
      script.textContent = JSON.stringify(jsonLd);
    } else if (script) {
      script.remove();
    }
  }, [title, description, keywords.join('|'), image, type, noindex, JSON.stringify(jsonLd)]);

  return null;
};
