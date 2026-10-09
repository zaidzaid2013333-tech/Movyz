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
    const isHomepage = current === '/';
    const shouldNoindex = noindex || !isHomepage;
    document.title = title;

    ensureMeta('meta[name="description"]', { name: 'description' }, description);
    ensureMeta('meta[name="keywords"]', { name: 'keywords' }, buildSeoKeywords(language, title, keywords).join(', '));
    ensureMeta('meta[name="robots"]', { name: 'robots' }, shouldNoindex ? 'noindex,follow' : 'index,follow,max-image-preview:large');
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

    if (isHomepage) {
      for (const config of LANGUAGE_LIST) {
        ensureLink('alternate', origin + withLanguagePrefix('/', config.code), { hreflang: config.tmdb.toLowerCase() });
      }
      ensureLink('alternate', origin + withLanguagePrefix('/', 'en'), { hreflang: 'x-default' });
    } else {
      document.head.querySelectorAll('link[rel="alternate"][hreflang]').forEach((node) => node.remove());
    }

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
