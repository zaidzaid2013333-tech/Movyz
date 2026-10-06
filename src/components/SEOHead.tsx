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

const keywordTemplates: Record<Language, (title: string) => string[]> = {
  ar: (title) => [
    `${title} مترجم عربي`, `${title} مترجم`, `${title} مشاهدة`, `مشاهدة ${title}`,
    `${title} فيلم`, `${title} مسلسل`, `${title} مشاهدة اون لاين`, `${title} بالعربي`,
  ],
  en: (title) => [`${title} watch`, `watch ${title}`, `${title} movie`, `${title} series`, `${title} online`, `${title} streaming`, `watch ${title} online`],
  fr: (title) => [`${title} film`, `regarder ${title}`, `${title} streaming`, `${title} VOSTFR`, `${title} VF`, `${title} en streaming`],
  de: (title) => [`${title} Film`, `${title} Stream`, `${title} online schauen`, `${title} ansehen`, `${title} Serie`],
  es: (title) => [`${title} película`, `ver ${title}`, `${title} online`, `${title} serie`, `${title} streaming`],
  it: (title) => [`${title} film`, `guardare ${title}`, `${title} streaming`, `${title} online`, `${title} serie TV`],
  pt: (title) => [`${title} filme`, `assistir ${title}`, `${title} online`, `${title} série`, `${title} streaming`],
  ru: (title) => [`${title} фильм`, `смотреть ${title}`, `${title} смотреть онлайн`, `${title} сериал`, `${title} онлайн`],
  tr: (title) => [`${title} film izle`, `${title} izle`, `${title} online`, `${title} dizi`, `${title} Türkçe altyazılı`],
  hi: (title) => [`${title} movie`, `${title} film`, `watch ${title}`, `${title} online`, `${title} series`],
  ja: (title) => [`${title} 映画`, `${title} 見る`, `${title} 配信`, `${title} ドラマ`],
  ko: (title) => [`${title} 영화`, `${title} 보기`, `${title} 스트리밍`, `${title} 드라마`],
};

export const buildSeoKeywords = (language: Language, title: string, extra: string[] = []) =>
  Array.from(new Set([...keywordTemplates[language](title), ...extra])).slice(0, 18);

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
