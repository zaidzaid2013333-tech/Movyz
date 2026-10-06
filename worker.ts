type ExecutionContextLike = { waitUntil(promise: Promise<unknown>): void };

type LocaleCode = 'ar' | 'en' | 'fr' | 'de' | 'es' | 'it' | 'pt' | 'ru' | 'tr' | 'hi' | 'ja' | 'ko';

const LOCALES: Record<LocaleCode, {
  tmdb: string;
  region: string;
  dir: 'rtl' | 'ltr';
  name: string;
  nativeName: string;
  countries: string[];
}> = {
  ar: { tmdb: 'ar-SA', region: 'DZ', dir: 'rtl', name: 'Arabic', nativeName: 'العربية', countries: ['DZ','MA','TN','LY','EG','SA','AE','QA','KW','BH','OM','JO','LB','IQ','SY','YE','PS','SD'] },
  en: { tmdb: 'en-US', region: 'US', dir: 'ltr', name: 'English', nativeName: 'English', countries: ['US','GB','CA','AU','NZ','IE','ZA','SG'] },
  fr: { tmdb: 'fr-FR', region: 'FR', dir: 'ltr', name: 'French', nativeName: 'Français', countries: ['FR','BE','CH','LU','MC'] },
  de: { tmdb: 'de-DE', region: 'DE', dir: 'ltr', name: 'German', nativeName: 'Deutsch', countries: ['DE','AT','CH','LI'] },
  es: { tmdb: 'es-ES', region: 'ES', dir: 'ltr', name: 'Spanish', nativeName: 'Español', countries: ['ES','MX','AR','CL','CO','PE','VE','UY','EC','BO','PY','CR','GT','PA'] },
  it: { tmdb: 'it-IT', region: 'IT', dir: 'ltr', name: 'Italian', nativeName: 'Italiano', countries: ['IT','SM','VA'] },
  pt: { tmdb: 'pt-BR', region: 'BR', dir: 'ltr', name: 'Portuguese', nativeName: 'Português', countries: ['BR','PT'] },
  ru: { tmdb: 'ru-RU', region: 'RU', dir: 'ltr', name: 'Russian', nativeName: 'Русский', countries: ['RU','BY','KZ','KG'] },
  tr: { tmdb: 'tr-TR', region: 'TR', dir: 'ltr', name: 'Turkish', nativeName: 'Türkçe', countries: ['TR','CY'] },
  hi: { tmdb: 'hi-IN', region: 'IN', dir: 'ltr', name: 'Hindi', nativeName: 'हिन्दी', countries: ['IN'] },
  ja: { tmdb: 'ja-JP', region: 'JP', dir: 'ltr', name: 'Japanese', nativeName: '日本語', countries: ['JP'] },
  ko: { tmdb: 'ko-KR', region: 'KR', dir: 'ltr', name: 'Korean', nativeName: '한국어', countries: ['KR'] },
};

const isLocale = (value: string | null | undefined): value is LocaleCode =>
  !!value && Object.prototype.hasOwnProperty.call(LOCALES, value);

const localeFromPath = (pathname: string): LocaleCode | null => {
  const first = pathname.split('/').filter(Boolean)[0] || '';
  return isLocale(first) ? first : null;
};

const stripLocale = (pathname: string) => {
  const locale = localeFromPath(pathname);
  if (!locale) return { locale: null, pathname: pathname || '/' };
  const stripped = '/' + pathname.split('/').filter(Boolean).slice(1).join('/');
  return { locale, pathname: stripped === '/' ? '/' : stripped || '/' };
};

const languageFromAcceptLanguage = (header: string | null): LocaleCode | null => {
  const raw = String(header || '').toLowerCase();
  const codes: Array<[string, LocaleCode]> = [
    ['ar', 'ar'], ['fr', 'fr'], ['de', 'de'], ['es', 'es'], ['it', 'it'],
    ['pt', 'pt'], ['ru', 'ru'], ['tr', 'tr'], ['hi', 'hi'], ['ja', 'ja'],
    ['ko', 'ko'], ['en', 'en'],
  ];
  for (const token of raw.split(',')) {
    const base = token.trim().split(';')[0].split('-')[0];
    const match = codes.find(([key]) => key === base);
    if (match) return match[1];
  }
  return null;
};

const countryFromRequest = (request: Request): string | null =>
  ((request as Request & { cf?: { country?: string } }).cf?.country || null);

const detectRequestLocale = (request: Request): LocaleCode => {
  const fromCountry = String(countryFromRequest(request) || '').toUpperCase();
  for (const [code, config] of Object.entries(LOCALES) as Array<[LocaleCode, typeof LOCALES.en]>) {
    if (config.countries.includes(fromCountry)) return code;
  }
  return languageFromAcceptLanguage(request.headers.get('Accept-Language')) || 'ar';
};

const isAppHtmlPath = (pathname: string) =>
  !pathname.includes('.') &&
  !pathname.startsWith('/tmdb') &&
  true;

const titleKeywords = (locale: LocaleCode, title: string) => {
  const map: Record<LocaleCode, string[]> = {
    ar: [title, `${title} مترجم عربي`, `${title} مترجم`, `مشاهدة ${title}`, `${title} مشاهدة`, `${title} فيلم`, `${title} مسلسل`, `${title} اون لاين`],
    en: [title, `${title} watch`, `watch ${title}`, `${title} movie`, `${title} series`, `${title} online`, `${title} streaming`],
    fr: [title, `${title} film`, `regarder ${title}`, `${title} streaming`, `${title} VOSTFR`, `${title} en streaming`],
    de: [title, `${title} Film`, `${title} Stream`, `${title} online schauen`, `${title} ansehen`],
    es: [title, `${title} película`, `ver ${title}`, `${title} online`, `${title} streaming`],
    it: [title, `${title} film`, `guardare ${title}`, `${title} streaming`, `${title} online`],
    pt: [title, `${title} filme`, `assistir ${title}`, `${title} online`, `${title} streaming`],
    ru: [title, `${title} фильм`, `смотреть ${title}`, `${title} смотреть онлайн`, `${title} сериал`],
    tr: [title, `${title} film izle`, `${title} izle`, `${title} online`, `${title} Türkçe altyazılı`],
    hi: [title, `${title} movie`, `watch ${title}`, `${title} online`, `${title} series`],
    ja: [title, `${title} 映画`, `${title} 見る`, `${title} 配信`, `${title} ドラマ`],
    ko: [title, `${title} 영화`, `${title} 보기`, `${title} 스트리밍`, `${title} 드라마`],
  };
  return Array.from(new Set(map[locale])).join(', ');
};

const localizedHtml = async (request: Request, env: MovyzEnvironment, response: Response, locale: LocaleCode) => {
  if (!response.headers.get('content-type')?.includes('text/html')) return response;
  const url = new URL(request.url);
  const route = stripLocale(url.pathname).pathname;
  const config = LOCALES[locale];

  let contentTitle = '';
  let alternateTitle = '';
  let description = '';
  let imageUrl = '';
  let schemaType = 'WebSite';
  let ogType = 'website';
  const detailMovie = route.match(/^\/movies\/(\d+)$/);
  const detailSeries = route.match(/^\/series\/(\d+)$/);

  const generic = {
    ar: { home: 'موفيزا — منصة الأفلام والمسلسلات', movies: 'الأفلام والمسلسلات المترجمة | موفيزا', series: 'المسلسلات التلفزيونية | موفيزا', discover: 'استكشاف الأفلام والمسلسلات | موفيزا', search: 'البحث في موفيزا' },
    en: { home: 'Movyza — Movies & TV Shows', movies: 'Movies & Films | Movyza', series: 'TV Series | Movyza', discover: 'Discover Movies & TV | Movyza', search: 'Search | Movyza' },
    fr: { home: 'Movyza — Films et séries', movies: 'Films | Movyza', series: 'Séries TV | Movyza', discover: 'Découvrir | Movyza', search: 'Recherche | Movyza' },
    de: { home: 'Movyza — Filme & Serien', movies: 'Filme | Movyza', series: 'Serien | Movyza', discover: 'Entdecken | Movyza', search: 'Suche | Movyza' },
    es: { home: 'Movyza — Películas y series', movies: 'Películas | Movyza', series: 'Series | Movyza', discover: 'Descubrir | Movyza', search: 'Buscar | Movyza' },
    it: { home: 'Movyza — Film e serie TV', movies: 'Film | Movyza', series: 'Serie TV | Movyza', discover: 'Scopri | Movyza', search: 'Cerca | Movyza' },
    pt: { home: 'Movyza — Filmes e séries', movies: 'Filmes | Movyza', series: 'Séries | Movyza', discover: 'Descobrir | Movyza', search: 'Pesquisar | Movyza' },
    ru: { home: 'Movyza — Фильмы и сериалы', movies: 'Фильмы | Movyza', series: 'Сериалы | Movyza', discover: 'Каталог | Movyza', search: 'Поиск | Movyza' },
    tr: { home: 'Movyza — Filmler ve diziler', movies: 'Filmler | Movyza', series: 'Diziler | Movyza', discover: 'Keşfet | Movyza', search: 'Ara | Movyza' },
    hi: { home: 'Movyza — फ़िल्में और सीरीज़', movies: 'फ़िल्में | Movyza', series: 'सीरीज़ | Movyza', discover: 'खोजें | Movyza', search: 'खोज | Movyza' },
    ja: { home: 'Movyza — 映画・ドラマ', movies: '映画 | Movyza', series: 'ドラマ | Movyza', discover: '探す | Movyza', search: '検索 | Movyza' },
    ko: { home: 'Movyza — 영화 및 드라마', movies: '영화 | Movyza', series: '드라마 | Movyza', discover: '둘러보기 | Movyza', search: '검색 | Movyza' },
  }[locale];

  if (route === '/') {
    contentTitle = generic.home;
    description = locale === 'ar' ? 'شاهد أحدث الأفلام والمسلسلات مع تجربة سينمائية متوافقة مع لغتك.' : generic.home;
  } else if (route === '/movies') {
    contentTitle = generic.movies;
    description = locale === 'ar' ? 'اكتشف أفلامًا مترجمة ومعلوماتها وقصصها وطاقمها على موفيزا.' : generic.movies;
  } else if (route === '/series') {
    contentTitle = generic.series;
    description = locale === 'ar' ? 'اكتشف المسلسلات والمواسم والحلقات على موفيزا.' : generic.series;
  } else if (route === '/discover') {
    contentTitle = generic.discover;
    description = generic.discover;
  } else if (route === '/search' || route.startsWith('/search/')) {
    contentTitle = generic.search;
    description = generic.search;
  } else if (detailMovie || detailSeries) {
    const type = detailMovie ? 'movie' : 'tv';
    const id = Number((detailMovie || detailSeries)?.[1] || 0);
    if (id && env.TMDB_API_READ_ACCESS_TOKEN) {
      try {
        const upstream = await fetch(`https://api.themoviedb.org/3/${type}/${id}?language=${encodeURIComponent(config.tmdb)}&append_to_response=credits`, {
          headers: tmdbHeaders(env),
        });
        const data = await upstream.json().catch(() => null) as any;
        contentTitle = data?.title || data?.name || data?.original_title || data?.original_name || `Movyza #${id}`;
        alternateTitle = data?.original_title || data?.original_name || '';
        description = data?.overview || `${contentTitle} — Movyza`;
        imageUrl = data?.backdrop_path ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}` : (data?.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : '');
        schemaType = type === 'movie' ? 'Movie' : 'TVSeries';
        ogType = type === 'movie' ? 'video.movie' : 'video.tv_show';
      } catch {
        contentTitle = `Movyza #${id}`;
        description = contentTitle;
      }
    }
  }

  if (!contentTitle) {
    contentTitle = generic.home;
    description = generic.home;
  }

  const isNoIndex = route === '/search' || route.startsWith('/search/') || route.startsWith('/watch/');
  const searchTitle = alternateTitle || contentTitle;
  const seoTitle = detailMovie || detailSeries
    ? (locale === 'ar'
      ? `${searchTitle} مترجم عربي | ${contentTitle} | مشاهدة ${searchTitle} | موفيزا`
      : `${searchTitle} | ${contentTitle} | Movyza`)
    : contentTitle;
  const canonicalPath = `/${locale}${route === '/' ? '/' : route}`;
  const origin = url.origin;
  const hreflangLinks = Object.entries(LOCALES)
    .map(([code, item]) => `<link rel="alternate" hreflang="${item.tmdb.toLowerCase()}" href="${origin}/${code}${route === '/' ? '/' : route}" />`)
    .join('');
  const xDefault = `<link rel="alternate" hreflang="x-default" href="${origin}/en${route === '/' ? '/' : route}" />`;
  const keywords = titleKeywords(locale, contentTitle + (alternateTitle && alternateTitle !== contentTitle ? `, ${alternateTitle}` : ''));

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': schemaType,
    name: contentTitle,
    description,
    alternateName: alternateTitle || undefined,
    image: imageUrl ? [imageUrl] : undefined,
    url: origin + canonicalPath,
  };
  const injection = `<!-- movyz-seo -->` +
    `<meta name="keywords" content="${keywords.replace(/"/g, '&quot;')}" />` +
    `<meta name="robots" content="${isNoIndex ? 'noindex,follow' : 'index,follow,max-image-preview:large'}" />` +
    `<meta property="og:title" content="${seoTitle.replace(/"/g, '&quot;')}" />` +
    `<meta property="og:description" content="${description.replace(/"/g, '&quot;')}" />` +
    `<meta property="og:type" content="${ogType}" />` +
    `<meta property="og:locale" content="${config.tmdb.replace('-', '_')}" />` +
    (imageUrl ? `<meta property="og:image" content="${imageUrl}" />` : '') +
    `<meta property="og:url" content="${origin + canonicalPath}" />` +
    `<meta name="twitter:card" content="summary_large_image" />` +
    (imageUrl ? `<meta name="twitter:image" content="${imageUrl}" />` : '') +
    `<link rel="canonical" href="${origin + canonicalPath}" />` +
    hreflangLinks + xDefault +
    `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`;
  const htmlLang = `<html lang="${locale}" dir="${config.dir}"`;
  let html = await response.text();
  html = html.replace(/<html\b[^>]*>/i, htmlLang + '>');
  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${seoTitle}</title>`);
  html = html.replace(/<meta\s+name=["']description["'][^>]*>/i, `<meta name="description" content="${description.replace(/"/g, '&quot;')}" />`);
  html = html.replace('</head>', injection + '</head>');
  const headers = new Headers(response.headers);
  headers.set('content-type', 'text/html; charset=UTF-8');
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
};


type MovyzEnvironment = {
  ASSETS: { fetch(request: Request): Promise<Response> };
  TMDB_API_READ_ACCESS_TOKEN?: string;
  MOVYZ_BUILD_ID?: string;
};

const tmdbHeaders = (env: MovyzEnvironment) => ({
  Authorization: `Bearer ${env.TMDB_API_READ_ACCESS_TOKEN || ''}`,
  Accept: 'application/json',
});

const proxyTmdb = async (request: Request, env: MovyzEnvironment) => {
  if (!env.TMDB_API_READ_ACCESS_TOKEN) {
    return new Response(JSON.stringify({ status_message: 'TMDB token is not configured' }), {
      status: 503, headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
  const url = new URL(request.url);
  const suffix = url.pathname.slice('/tmdb'.length).replace(/^\/+/, '');
  if (!suffix || suffix.includes('..')) {
    return new Response('Bad TMDB path', { status: 400 });
  }
  const target = new URL(`https://api.themoviedb.org/3/${suffix}`);
  url.searchParams.forEach((value, key) => target.searchParams.set(key, value));
  const upstream = await fetch(target.toString(), {
    method: request.method,
    headers: tmdbHeaders(env),
  });
  const headers = new Headers(upstream.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Cache-Control', 'public, max-age=60, s-maxage=300');
  return new Response(upstream.body, { status: upstream.status, headers });
};


const noCache = (response: Response) => {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('CDN-Cache-Control', 'no-store');
  headers.set('Cloudflare-CDN-Cache-Control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};

export default {
  async fetch(request: Request, env: MovyzEnvironment, _ctx: ExecutionContextLike): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization,Content-Type',
      }});
    }
    if (url.pathname === '/tmdb' || url.pathname.startsWith('/tmdb/')) {
      return proxyTmdb(request, env);
    }
    if (request.method === 'GET' && isAppHtmlPath(url.pathname) && !localeFromPath(url.pathname)) {
      const target = new URL(request.url);
      const locale = detectRequestLocale(request);
      target.pathname = target.pathname === '/' ? `/${locale}/` : `/${locale}${target.pathname}`;
      return new Response(null, {
        status: 302,
        headers: {
          Location: target.toString(),
          'Cache-Control': 'public, max-age=300',
        },
      });
    }

    const html = request.method === 'GET' && (url.pathname === '/' || isAppHtmlPath(url.pathname));
    if (html) {
      const freshUrl = new URL(request.url);
      freshUrl.searchParams.set('__movyz_asset_version', env.MOVYZ_BUILD_ID || 'dev');
      const freshRequest = new Request(freshUrl.toString(), request);
      const localized = await env.ASSETS.fetch(freshRequest);
      const locale = localeFromPath(url.pathname);
      if (locale) return noCache(await localizedHtml(request, env, localized, locale));
      return noCache(localized);
    }
    return await env.ASSETS.fetch(request);
  },
};
