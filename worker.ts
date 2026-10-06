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
  fr: { tmdb: 'fr-FR', region: 'FR', dir: 'ltr', name: 'French', nativeName: 'Français', countries: ['FR','BE','LU','MC'] },
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

const SUBTITLE_COUNTRY_LANGUAGE: Record<string, LocaleCode> = {
  // Arabic
  DZ: 'ar', MA: 'ar', TN: 'ar', LY: 'ar', EG: 'ar', SD: 'ar', MR: 'ar',
  SA: 'ar', AE: 'ar', QA: 'ar', KW: 'ar', BH: 'ar', OM: 'ar', YE: 'ar',
  JO: 'ar', LB: 'ar', IQ: 'ar', SY: 'ar', PS: 'ar', SO: 'ar', DJ: 'ar',
  KM: 'ar',

  // English
  US: 'en', GB: 'en', IE: 'en', CA: 'en', AU: 'en', NZ: 'en', SG: 'en',
  JM: 'en', BS: 'en', BB: 'en', TT: 'en', GD: 'en', LC: 'en', VC: 'en',
  AG: 'en', DM: 'en', KN: 'en', BZ: 'en', GY: 'en', FJ: 'en', PG: 'en',
  SB: 'en', VU: 'en', WS: 'en', TO: 'en', FM: 'en', MH: 'en', PW: 'en',
  NR: 'en', KI: 'en', GH: 'en', NG: 'en', KE: 'en', UG: 'en', TZ: 'en',
  ZM: 'en', ZW: 'en', MW: 'en', BW: 'en', NA: 'en', LS: 'en', SZ: 'en',
  ZA: 'en', SL: 'en', LR: 'en', GM: 'en', SS: 'en', MU: 'en', SC: 'en',

  // French
  FR: 'fr', BE: 'fr', LU: 'fr', MC: 'fr', SN: 'fr', CI: 'fr', BF: 'fr',
  BJ: 'fr', TG: 'fr', ML: 'fr', NE: 'fr', GN: 'fr', GA: 'fr', CG: 'fr',
  CD: 'fr', CM: 'fr', CF: 'fr', TD: 'fr', MG: 'fr', RW: 'fr', BI: 'fr',
  HT: 'fr', CH: 'fr',

  // German
  DE: 'de', AT: 'de', LI: 'de',

  // Spanish
  ES: 'es', MX: 'es', AR: 'es', CL: 'es', CO: 'es', PE: 'es', VE: 'es',
  UY: 'es', PY: 'es', BO: 'es', EC: 'es', PA: 'es', CR: 'es', GT: 'es',
  HN: 'es', SV: 'es', NI: 'es', CU: 'es', DO: 'es', GQ: 'es',

  // Italian
  IT: 'it', SM: 'it', VA: 'it',

  // Portuguese
  PT: 'pt', BR: 'pt', AO: 'pt', MZ: 'pt', CV: 'pt', GW: 'pt', ST: 'pt',
  TL: 'pt',

  // Russian
  RU: 'ru', BY: 'ru', KZ: 'ru', KG: 'ru',

  // Turkish
  TR: 'tr',

  // Hindi
  IN: 'hi',

  // Japanese
  JP: 'ja',

  // Korean
  KR: 'ko',

  // Countries where none of the supported subtitle languages is a clear country-wide default:
  // use English rather than browser language or geolocation inference.
  CN: 'en', TW: 'en', HK: 'en', MO: 'en', NL: 'en',
  SE: 'en', NO: 'en', DK: 'en', FI: 'en', IS: 'en',
  PL: 'en', CZ: 'en', SK: 'en', HU: 'en', RO: 'en', BG: 'en', HR: 'en',
  SI: 'en', RS: 'en', BA: 'en', ME: 'en', MK: 'en', AL: 'en', EE: 'en',
  LV: 'en', LT: 'en', MD: 'en', UA: 'en', GR: 'en', MT: 'en', CY: 'en',
  GE: 'en', AM: 'en', AZ: 'en', UZ: 'en', TJ: 'en', TM: 'en', AF: 'en',
  NP: 'en', BD: 'en', LK: 'en', MV: 'en', PK: 'en', MY: 'en', TH: 'en',
  ID: 'en', PH: 'en', VN: 'en', KH: 'en', LA: 'en', MN: 'en',
  IL: 'en', IR: 'en'
};

const detectSubtitleLocale = (request: Request): LocaleCode => {
  const fromCountry = String(countryFromRequest(request) || '').toUpperCase();
  return SUBTITLE_COUNTRY_LANGUAGE[fromCountry] || 'en';
};
const subtitlePriorityForCountry = (country: string | null): string => {
  const primary = SUBTITLE_COUNTRY_LANGUAGE[String(country || '').toUpperCase()] || 'en';
  const fallbackByPrimary: Record<LocaleCode, string[]> = {
    ar: ['ar', 'en'],
    en: ['en'],
    fr: ['fr', 'en'],
    de: ['de', 'en'],
    es: ['es', 'en'],
    it: ['it', 'en'],
    pt: ['pt', 'en'],
    ru: ['ru', 'en'],
    tr: ['tr', 'en'],
    hi: ['hi', 'en'],
    ja: ['ja', 'en'],
    ko: ['ko', 'en'],
  };
  return fallbackByPrimary[primary].slice(0, 3).join(',');
};

const isAppHtmlPath = (pathname: string) =>
  !pathname.includes('.') &&
  !pathname.startsWith('/tmdb');

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
  const subtitleLocale = detectSubtitleLocale(request);
  const injection = `<!-- movyz-seo -->` +
    `<meta name="movyz-country" content="${String(countryFromRequest(request) || 'XX').toUpperCase()}" />` +
    `<meta name="movyz-subtitle-language" content="${subtitleLocale}" />` +
    `<meta name="movyz-subtitle-priority" content="${subtitlePriorityForCountry(countryFromRequest(request))}" />` +
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


const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const SITEMAP_DISCOVERY_PAGES = 500;

const buildSitemapIndex = (origin: string) => {
  const entries: string[] = [];

  // Static localized surfaces: home + public catalog landing pages.
  for (const locale of Object.keys(LOCALES) as LocaleCode[]) {
    entries.push(`<sitemap><loc>${origin}/sitemap/${locale}/static.xml</loc></sitemap>`);
  }

  // Localized movie/series detail pages are generated from TMDB discover.
  for (const locale of Object.keys(LOCALES) as LocaleCode[]) {
    for (const type of ['movies', 'series'] as const) {
      for (let page = 1; page <= SITEMAP_DISCOVERY_PAGES; page += 1) {
        entries.push(
          `<sitemap><loc>${origin}/sitemap/${locale}/${type}/${page}.xml</loc></sitemap>`
        );
      }
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.join('')}</sitemapindex>`;
};

const buildStaticSitemapSegment = (request: Request, locale: LocaleCode) => {
  const origin = new URL(request.url).origin;
  const routes = ['/', '/movies', '/series', '/discover'];
  const urls = routes
    .map((route) =>
      `<url><loc>${escapeXml(`${origin}/${locale}${route === '/' ? '/' : route}`)}</loc><changefreq>daily</changefreq><priority>${route === '/' ? '1.0' : '0.8'}</priority></url>`
    )
    .join('');

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;

  return new Response(xml, {
    status: 200,
    headers: {
      'content-type': 'application/xml; charset=UTF-8',
      'cache-control': 'public, max-age=3600, s-maxage=86400',
      'cdn-cache-control': 'public, max-age=86400',
    },
  });
};

const buildSitemapSegment = async (
  request: Request,
  env: MovyzEnvironment,
  locale: LocaleCode,
  type: 'movies' | 'series',
  page: number,
) => {
  if (!env.TMDB_API_READ_ACCESS_TOKEN || page < 1 || page > SITEMAP_DISCOVERY_PAGES) {
    return new Response('Not found', { status: 404 });
  }

  const config = LOCALES[locale];
  const tmdbType = type === 'movies' ? 'movie' : 'tv';
  const target = new URL(`https://api.themoviedb.org/3/discover/${tmdbType}`);
  target.searchParams.set('language', config.tmdb);
  target.searchParams.set('page', String(page));
  target.searchParams.set('sort_by', 'popularity.desc');
  target.searchParams.set('include_adult', 'false');
  if (tmdbType === 'movie') target.searchParams.set('include_video', 'false');

  try {
    const upstream = await fetch(target.toString(), { headers: tmdbHeaders(env) });
    if (!upstream.ok) return new Response('Upstream error', { status: 502 });
    const data = await upstream.json().catch(() => null) as { results?: Array<{ id?: number }> } | null;
    const origin = new URL(request.url).origin;
    const urls = (data?.results || [])
      .map((item) => Number(item?.id))
      .filter((id) => Number.isFinite(id) && id > 0)
      .map((id) => `<url><loc>${escapeXml(`${origin}/${locale}/${type}/${id}`)}</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>`)
      .join('');

    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;

    return new Response(xml, {
      status: 200,
      headers: {
        'content-type': 'application/xml; charset=UTF-8',
        'cache-control': 'public, max-age=3600, s-maxage=86400',
        'cdn-cache-control': 'public, max-age=86400',
      },
    });
  } catch {
    return new Response('Upstream error', { status: 502 });
  }
};

const handleSitemap = async (request: Request, env: MovyzEnvironment) => {
  const url = new URL(request.url);
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });

  if (url.pathname === '/sitemap.xml') {
    const xml = buildSitemapIndex(url.origin);
    return new Response(xml, {
      status: 200,
      headers: {
        'content-type': 'application/xml; charset=UTF-8',
        'cache-control': 'public, max-age=3600, s-maxage=86400',
        'cdn-cache-control': 'public, max-age=86400',
      },
    });
  }

  const staticMatch = url.pathname.match(/^\/sitemap\/(ar|en|fr|de|es|it|pt|ru|tr|hi|ja|ko)\/static\.xml$/);
  if (staticMatch) {
    return buildStaticSitemapSegment(request, staticMatch[1] as LocaleCode);
  }

  const match = url.pathname.match(/^\/sitemap\/(ar|en|fr|de|es|it|pt|ru|tr|hi|ja|ko)\/(movies|series)\/(\d+)\.xml$/);
  if (!match) return null;

  const locale = match[1] as LocaleCode;
  const type = match[2] as 'movies' | 'series';
  const page = Number(match[3]);
  return buildSitemapSegment(request, env, locale, type, page);
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
    if (request.method === 'GET' && (url.pathname === '/sitemap.xml' || url.pathname.startsWith('/sitemap/'))) {
      const sitemapResponse = await handleSitemap(request, env);
      if (sitemapResponse) return sitemapResponse;
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
