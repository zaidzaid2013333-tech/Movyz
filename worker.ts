type ExecutionContextLike = { waitUntil(promise: Promise<unknown>): void };

type LocaleCode = 'ar' | 'en' | 'fr' | 'de' | 'es' | 'it' | 'pt' | 'ru' | 'tr' | 'hi' | 'ja' | 'ko' | 'zh' | 'nl' | 'sv' | 'da' | 'no' | 'fi' | 'pl' | 'cs' | 'uk' | 'he' | 'vi' | 'id' | 'ms' | 'th' | 'ro' | 'hu' | 'el' | 'bn' | 'ur' | 'fa';

const LOCALES: Record<LocaleCode, {
  tmdb: string;
  region: string;
  dir: 'rtl' | 'ltr';
  name: string;
  nativeName: string;
  countries: string[];
}> = {
  ar: { tmdb: 'ar-SA', region: 'DZ', dir: 'rtl', name: 'Arabic', nativeName: 'العربية', countries: ['AE','BH','DJ','DZ','EG','IQ','JO','KM','KW','LB','LY','MA','MR','OM','PS','QA','SA','SD','SO','SY','TN','YE','TD'] },
  en: { tmdb: 'en-US', region: 'US', dir: 'ltr', name: 'English', nativeName: 'English', countries: ['US','GB','CA','AU','NZ','IE','SG','JM','BS','BB','TT','GD','LC','VC','AG','DM','KN','BZ','GY','FJ','PG','SB','VU','WS','TO','FM','MH','PW','NR','KI','GH','NG','KE','UG','TZ','ZM','ZW','MW','BW','NA','LS','SZ','SL','LR','GM','SS','MU','SC','ZA','ET','ER','MT','IS','AL','BA','ME','MK','RS','SI','HR','BG','AD','SM','VA','MC','LI','AQ','AS','AW','AX','BM','BQ','BV','CC','CK','CW','CX','FK','FO','GG','GI','GL','GS','GU','HM','IM','IO','JE','KY','MM','MP','MS','NF','NU','SJ','SR','SX','TC','TF','TK','TV','UM','VG','VI','KH','LA','PH','LK','MV'] },
  fr: { tmdb: 'fr-FR', region: 'FR', dir: 'ltr', name: 'French', nativeName: 'Français', countries: ['FR','BE','LU','MC','SN','CI','BF','BJ','TG','ML','NE','GN','GA','CG','CD','CM','CF','MG','RW','BI','HT','TD','GQ','RE','GP','GF','MQ','NC','PF','PM','BL','MF','YT','WF'] },
  de: { tmdb: 'de-DE', region: 'DE', dir: 'ltr', name: 'German', nativeName: 'Deutsch', countries: ['DE','AT','CH','LI'] },
  es: { tmdb: 'es-ES', region: 'ES', dir: 'ltr', name: 'Spanish', nativeName: 'Español', countries: ['ES','MX','AR','CL','CO','PE','VE','UY','EC','BO','PY','CR','GT','PA','HN','SV','NI','CU','DO','GQ','PR'] },
  it: { tmdb: 'it-IT', region: 'IT', dir: 'ltr', name: 'Italian', nativeName: 'Italiano', countries: ['IT','SM','VA'] },
  pt: { tmdb: 'pt-BR', region: 'BR', dir: 'ltr', name: 'Portuguese', nativeName: 'Português', countries: ['PT','BR','AO','MZ','CV','GW','ST','TL'] },
  ru: { tmdb: 'ru-RU', region: 'RU', dir: 'ltr', name: 'Russian', nativeName: 'Русский', countries: ['RU','BY','KZ','KG','AM','GE','UZ','TJ','TM','MN'] },
  tr: { tmdb: 'tr-TR', region: 'TR', dir: 'ltr', name: 'Turkish', nativeName: 'Türkçe', countries: ['TR','AZ'] },
  hi: { tmdb: 'hi-IN', region: 'IN', dir: 'ltr', name: 'Hindi', nativeName: 'हिन्दी', countries: ['IN','NP'] },
  ja: { tmdb: 'ja-JP', region: 'JP', dir: 'ltr', name: 'Japanese', nativeName: '日本語', countries: ['JP'] },
  ko: { tmdb: 'ko-KR', region: 'KR', dir: 'ltr', name: 'Korean', nativeName: '한국어', countries: ['KR','KP'] },
  zh: { tmdb: 'zh-CN', region: 'CN', dir: 'ltr', name: 'Chinese', nativeName: '中文', countries: ['CN','TW','HK','MO'] },
  nl: { tmdb: 'nl-NL', region: 'NL', dir: 'ltr', name: 'Dutch', nativeName: 'Nederlands', countries: ['NL'] },
  sv: { tmdb: 'sv-SE', region: 'SE', dir: 'ltr', name: 'Swedish', nativeName: 'Svenska', countries: ['SE'] },
  da: { tmdb: 'da-DK', region: 'DK', dir: 'ltr', name: 'Danish', nativeName: 'Dansk', countries: ['DK'] },
  no: { tmdb: 'no-NO', region: 'NO', dir: 'ltr', name: 'Norwegian', nativeName: 'Norsk', countries: ['NO'] },
  fi: { tmdb: 'fi-FI', region: 'FI', dir: 'ltr', name: 'Finnish', nativeName: 'Suomi', countries: ['FI'] },
  pl: { tmdb: 'pl-PL', region: 'PL', dir: 'ltr', name: 'Polish', nativeName: 'Polski', countries: ['PL'] },
  cs: { tmdb: 'cs-CZ', region: 'CZ', dir: 'ltr', name: 'Czech', nativeName: 'Čeština', countries: ['CZ'] },
  uk: { tmdb: 'uk-UA', region: 'UA', dir: 'ltr', name: 'Ukrainian', nativeName: 'Українська', countries: ['UA'] },
  he: { tmdb: 'he-IL', region: 'IL', dir: 'rtl', name: 'Hebrew', nativeName: 'עברית', countries: ['IL'] },
  vi: { tmdb: 'vi-VN', region: 'VN', dir: 'ltr', name: 'Vietnamese', nativeName: 'Tiếng Việt', countries: ['VN'] },
  id: { tmdb: 'id-ID', region: 'ID', dir: 'ltr', name: 'Indonesian', nativeName: 'Bahasa Indonesia', countries: ['ID'] },
  ms: { tmdb: 'ms-MY', region: 'MY', dir: 'ltr', name: 'Malay', nativeName: 'Bahasa Melayu', countries: ['MY','BN'] },
  th: { tmdb: 'th-TH', region: 'TH', dir: 'ltr', name: 'Thai', nativeName: 'ไทย', countries: ['TH'] },
  ro: { tmdb: 'ro-RO', region: 'RO', dir: 'ltr', name: 'Romanian', nativeName: 'Română', countries: ['RO','MD'] },
  hu: { tmdb: 'hu-HU', region: 'HU', dir: 'ltr', name: 'Hungarian', nativeName: 'Magyar', countries: ['HU'] },
  el: { tmdb: 'el-GR', region: 'GR', dir: 'ltr', name: 'Greek', nativeName: 'Ελληνικά', countries: ['GR','CY'] },
  bn: { tmdb: 'bn-BD', region: 'BD', dir: 'ltr', name: 'Bengali', nativeName: 'বাংলা', countries: ['BD'] },
  ur: { tmdb: 'ur-PK', region: 'PK', dir: 'rtl', name: 'Urdu', nativeName: 'اردو', countries: ['PK'] },
  fa: { tmdb: 'fa-IR', region: 'IR', dir: 'rtl', name: 'Persian', nativeName: 'فارسی', countries: ['IR','AF'] },
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
  const codes: LocaleCode[] = ['ar', 'en', 'fr', 'de', 'es', 'it', 'pt', 'ru', 'tr', 'hi', 'ja', 'ko', 'zh', 'nl', 'sv', 'da', 'no', 'fi', 'pl', 'cs', 'uk', 'he', 'vi', 'id', 'ms', 'th', 'ro', 'hu', 'el', 'bn', 'ur', 'fa'];
  for (const token of raw.split(',')) {
    const base = token.trim().split(';')[0].split('-')[0];
    if (codes.includes(base as LocaleCode)) return base as LocaleCode;
  }
  return null;
};

const countryFromRequest = (request: Request): string | null =>
  ((request as Request & { cf?: { country?: string } }).cf?.country || null);

const COUNTRY_TO_LOCALE: Record<string, LocaleCode> = Object.fromEntries(
  Object.entries(LOCALES).flatMap(([locale, config]) =>
    config.countries.map((country) => [country, locale as LocaleCode]),
  ),
);

const detectRequestLocale = (request: Request): LocaleCode => {
  const country = String(countryFromRequest(request) || '').toUpperCase();
  return COUNTRY_TO_LOCALE[country]
    || languageFromAcceptLanguage(request.headers.get('accept-language'))
    || 'en';
};

const SUBTITLE_COUNTRY_LANGUAGE: Record<string, LocaleCode> = Object.fromEntries(
  Object.entries(LOCALES).flatMap(([locale, config]) =>
    config.countries.map((country) => [country, locale as LocaleCode]),
  ),
);

const detectSubtitleLocale = (request: Request): LocaleCode => {
  // An explicit /ar/... or /fr/... route is the strongest signal because the
  // visitor intentionally selected that Movyza language.
  const fromPath = localeFromPath(new URL(request.url).pathname);
  if (fromPath) return fromPath;

  const fromCountry = String(countryFromRequest(request) || '').toUpperCase();
  return SUBTITLE_COUNTRY_LANGUAGE[fromCountry] || 'en';
};

const VIDSRC_BASE_URL = 'https://player.movyza.sbs';

const subtitlePriorityForLanguage = (primary: LocaleCode): string =>
  primary === 'en' ? 'en' : primary + ',en';

const isAppHtmlPath = (pathname: string) =>
  !pathname.includes('.') &&
  !pathname.startsWith('/tmdb');

const titleKeywords = (locale: LocaleCode, title: string) => {
  const terms = {"ar":["مترجم عربي","مشاهدة","فيلم","مسلسل"],"en":["watch","watch","movie","series"],"fr":["film","regarder","streaming"],"de":["Film","Stream","online"],"es":["película","ver","online"],"it":["film","guardare","streaming"],"pt":["filme","assistir","online"],"ru":["фильм","смотреть","онлайн"],"tr":["film izle","izle","online"],"hi":["movie","watch","series"],"ja":["映画","見る","ドラマ"],"ko":["영화","보기","드라마"],"zh":["电影","观看","剧集"],"nl":["film","serie","kijken"],"sv":["film","se","serie"],"da":["film","se","serie"],"no":["film","se","serie"],"fi":["elokuva","katso","sarja"],"pl":["film","oglądaj","serial"],"cs":["film","sledovat","seriál"],"uk":["фільм","дивитися","серіал"],"he":["סרט","צפייה","סדרה"],"vi":["phim","xem","series"],"id":["film","nonton","serial"],"ms":["filem","tonton","siri"],"th":["หนัง","ดู","ซีรีส์"],"ro":["filmul","vezi","serial"],"hu":["film","nézd","sorozat"],"el":["ταινία","δες","σειρά"],"bn":["সিনেমা","দেখুন","সিরিজ"],"ur":["فلم","دیکھیں","سیریز"],"fa":["فیلم","تماشای","سریال"]}[locale] || {"ar":["مترجم عربي","مشاهدة","فيلم","مسلسل"],"en":["watch","watch","movie","series"],"fr":["film","regarder","streaming"],"de":["Film","Stream","online"],"es":["película","ver","online"],"it":["film","guardare","streaming"],"pt":["filme","assistir","online"],"ru":["фильм","смотреть","онлайн"],"tr":["film izle","izle","online"],"hi":["movie","watch","series"],"ja":["映画","見る","ドラマ"],"ko":["영화","보기","드라마"],"zh":["电影","观看","剧集"],"nl":["film","serie","kijken"],"sv":["film","se","serie"],"da":["film","se","serie"],"no":["film","se","serie"],"fi":["elokuva","katso","sarja"],"pl":["film","oglądaj","serial"],"cs":["film","sledovat","seriál"],"uk":["фільм","дивитися","серіал"],"he":["סרט","צפייה","סדרה"],"vi":["phim","xem","series"],"id":["film","nonton","serial"],"ms":["filem","tonton","siri"],"th":["หนัง","ดู","ซีรีส์"],"ro":["filmul","vezi","serial"],"hu":["film","nézd","sorozat"],"el":["ταινία","δες","σειρά"],"bn":["সিনেমা","দেখুন","সিরিজ"],"ur":["فلم","دیکھیں","سیریز"],"fa":["فیلم","تماشای","سریال"]}.en;
  return Array.from(new Set([title, ...terms.map((term) => term + ' ' + title)])).join(', ');
};

const HOME_SEO: Record<LocaleCode, { title: string; description: string }> = {
  "ar": {
    "title": "مشاهدة الأفلام والمسلسلات مجانًا | Movyza",
    "description": "شاهد الأفلام والمسلسلات مجانًا على Movyza. استكشف مجموعة واسعة من العناوين، واكتشف الإصدارات الجديدة، واختر ما ترغب في مشاهدته عبر الإنترنت."
  },
  "en": {
    "title": "Watch Movies & TV Shows for Free | Movyza",
    "description": "Watch movies and TV series for free on Movyza. Explore a wide selection of films and series, discover new releases, and find something to watch online."
  },
  "fr": {
    "title": "Films et séries en streaming gratuit | Movyza",
    "description": "Regardez gratuitement des films et des séries sur Movyza. Explorez un large catalogue, découvrez les nouveautés et trouvez votre prochain programme à regarder en ligne."
  },
  "de": {
    "title": "Filme und Serien kostenlos ansehen | Movyza",
    "description": "Sieh dir Filme und Serien kostenlos auf Movyza an. Entdecke eine große Auswahl, finde Neuerscheinungen und entdecke Titel, die du online ansehen möchtest."
  },
  "es": {
    "title": "Ver películas y series gratis | Movyza",
    "description": "Mira películas y series gratis en Movyza. Explora un amplio catálogo, descubre nuevos estrenos y encuentra tu próxima película o serie para ver online."
  },
  "it": {
    "title": "Guarda film e serie TV gratis | Movyza",
    "description": "Guarda film e serie TV gratis su Movyza. Esplora un ampio catalogo, scopri le nuove uscite e trova il prossimo titolo da vedere online."
  },
  "pt": {
    "title": "Assista a filmes e séries grátis | Movyza",
    "description": "Assista a filmes e séries grátis na Movyza. Explore um catálogo variado, descubra novos lançamentos e encontre o que quer ver online."
  },
  "ru": {
    "title": "Смотреть фильмы и сериалы бесплатно | Movyza",
    "description": "Смотрите фильмы и сериалы бесплатно на Movyza. Изучайте большой каталог, открывайте новые премьеры и находите, что посмотреть онлайн."
  },
  "tr": {
    "title": "Ücretsiz film ve dizi izle | Movyza",
    "description": "Movyza'da film ve dizileri ücretsiz izle. Geniş kataloğu keşfet, yeni çıkanları incele ve çevrim içi izlemek için yeni içerikler bul."
  },
  "hi": {
    "title": "मुफ़्त फ़िल्में और सीरीज़ देखें | Movyza",
    "description": "Movyza पर फ़िल्में और सीरीज़ मुफ़्त देखें। बड़े कैटलॉग को एक्सप्लोर करें, नई रिलीज़ खोजें और ऑनलाइन देखने के लिए अगला पसंदीदा शीर्षक चुनें।"
  },
  "ja": {
    "title": "映画・ドラマを無料で視聴 | Movyza",
    "description": "Movyzaで映画やドラマを無料で視聴。豊富な作品を探し、新作をチェックして、オンラインで見たい映画やシリーズを見つけましょう。"
  },
  "ko": {
    "title": "영화와 TV 시리즈 무료 시청 | Movyza",
    "description": "Movyza에서 영화와 TV 시리즈를 무료로 감상하세요. 다양한 작품을 둘러보고 신작을 발견하며 온라인에서 볼 콘텐츠를 찾아보세요."
  },
  "zh": {
    "title": "免费在线看电影和电视剧 | Movyza",
    "description": "在 Movyza 免费观看电影和电视剧。浏览丰富的片库、发现最新作品，并找到想在线观看的电影或剧集。"
  },
  "nl": {
    "title": "Gratis films en series kijken | Movyza",
    "description": "Bekijk gratis films en series op Movyza. Ontdek een ruime catalogus, bekijk nieuwe releases en vind je volgende film of serie om online te kijken."
  },
  "sv": {
    "title": "Titta på filmer och serier gratis | Movyza",
    "description": "Se filmer och serier gratis på Movyza. Utforska ett brett utbud, upptäck nya släpp och hitta nästa film eller serie att titta på online."
  },
  "da": {
    "title": "Se film og serier gratis | Movyza",
    "description": "Se film og serier gratis på Movyza. Gå på opdagelse i et stort udvalg, find nye udgivelser, og vælg noget at streame online."
  },
  "no": {
    "title": "Se filmer og serier gratis | Movyza",
    "description": "Se filmer og serier gratis på Movyza. Utforsk et bredt utvalg, oppdag nye lanseringer og finn noe du vil se på nettet."
  },
  "fi": {
    "title": "Katso elokuvia ja sarjoja ilmaiseksi | Movyza",
    "description": "Katso elokuvia ja sarjoja ilmaiseksi Movyzassa. Tutustu laajaan valikoimaan, löydä uutuuksia ja valitse seuraava verkossa katsottava elokuva tai sarja."
  },
  "pl": {
    "title": "Oglądaj filmy i seriale za darmo | Movyza",
    "description": "Oglądaj filmy i seriale za darmo na Movyza. Przeglądaj bogaty katalog, odkrywaj nowości i znajdź kolejny tytuł do obejrzenia online."
  },
  "cs": {
    "title": "Sledujte filmy a seriály zdarma | Movyza",
    "description": "Sledujte filmy a seriály zdarma na Movyza. Procházejte široký katalog, objevujte novinky a najděte další titul ke sledování online."
  },
  "uk": {
    "title": "Дивіться фільми та серіали безкоштовно | Movyza",
    "description": "Дивіться фільми й серіали безкоштовно на Movyza. Переглядайте великий каталог, відкривайте новинки та знаходьте, що подивитися онлайн."
  },
  "he": {
    "title": "צפו בסרטים ובסדרות בחינם | Movyza",
    "description": "צפו בסרטים ובסדרות בחינם ב‑Movyza. גלו מבחר רחב, הכירו את התכנים החדשים ומצאו את הסרט או הסדרה הבאים לצפייה אונליין."
  },
  "vi": {
    "title": "Xem phim và series miễn phí | Movyza",
    "description": "Xem phim và series miễn phí trên Movyza. Khám phá danh mục đa dạng, tìm các bộ phim mới và chọn nội dung yêu thích để xem trực tuyến."
  },
  "id": {
    "title": "Nonton film dan serial gratis | Movyza",
    "description": "Tonton film dan serial gratis di Movyza. Jelajahi katalog pilihan, temukan rilisan terbaru, dan cari tontonan berikutnya untuk dinikmati online."
  },
  "ms": {
    "title": "Tonton filem dan siri secara percuma | Movyza",
    "description": "Tonton filem dan siri secara percuma di Movyza. Terokai katalog yang luas, temui keluaran baharu dan pilih tontonan seterusnya dalam talian."
  },
  "th": {
    "title": "ดูหนังและซีรีส์ฟรี | Movyza",
    "description": "ดูหนังและซีรีส์ฟรีบน Movyza สำรวจรายการหลากหลาย ค้นพบเรื่องใหม่ และเลือกภาพยนตร์หรือซีรีส์ที่ต้องการรับชมออนไลน์"
  },
  "ro": {
    "title": "Urmărește filme și seriale gratuit | Movyza",
    "description": "Urmărește filme și seriale gratuit pe Movyza. Explorează un catalog variat, descoperă noutăți și găsește următorul titlu de vizionat online."
  },
  "hu": {
    "title": "Filmek és sorozatok ingyen | Movyza",
    "description": "Nézz filmeket és sorozatokat ingyen a Movyza oldalán. Böngéssz a kínálatban, fedezd fel az újdonságokat, és válassz online néznivalót."
  },
  "el": {
    "title": "Δείτε ταινίες και σειρές δωρεάν | Movyza",
    "description": "Δείτε ταινίες και σειρές δωρεάν στο Movyza. Εξερευνήστε μια μεγάλη συλλογή, ανακαλύψτε νέες κυκλοφορίες και βρείτε τι να δείτε online."
  },
  "bn": {
    "title": "বিনামূল্যে সিনেমা ও সিরিজ দেখুন | Movyza",
    "description": "Movyza-তে বিনামূল্যে সিনেমা ও সিরিজ দেখুন। বড় সংগ্রহ ঘুরে দেখুন, নতুন মুক্তি খুঁজুন এবং অনলাইনে দেখার জন্য পছন্দের বিষয় বেছে নিন।"
  },
  "ur": {
    "title": "فلمیں اور سیریز مفت دیکھیں | Movyza",
    "description": "Movyza پر فلمیں اور سیریز مفت دیکھیں۔ وسیع کیٹلاگ دریافت کریں، نئی ریلیزز دیکھیں اور آن لائن دیکھنے کے لیے اگلا پسندیدہ عنوان تلاش کریں۔"
  },
  "fa": {
    "title": "تماشای رایگان فیلم و سریال | Movyza",
    "description": "در Movyza فیلم و سریال را رایگان تماشا کنید. مجموعه‌ای متنوع را بگردید، آثار تازه را کشف کنید و عنوان بعدی برای تماشای آنلاین را بیابید."
  }
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
  let watchVideo: { embedUrl: string; uploadDate?: string; duration?: number } | null = null;
  const detailMovie = route.match(/^\/movies\/(\d+)$/);
  const detailSeries = route.match(/^\/series\/(\d+)$/);
  const watchMovie = route.match(/^\/watch\/movie\/(\d+)$/);
  const watchEpisode = route.match(/^\/watch\/tv\/(\d+)\/(\d+)\/(\d+)$/);

  const generic: Record<LocaleCode, { home: string; movies: string; series: string; discover: string; search: string; catalog: string; legal: string }> = {
    ar: { home: "موفيزا — منصة الأفلام والمسلسلات", movies: "الأفلام والمسلسلات المترجمة | موفيزا", series: "المسلسلات التلفزيونية | موفيزا", discover: "استكشاف الأفلام والمسلسلات | موفيزا", search: "البحث في موفيزا", catalog: "أفضل 1000 فيلم ومسلسل | موفيزا", legal: "إخلاء المسؤولية وDMCA | موفيزا" },
    en: { home: "Movyza — Movies & TV Shows", movies: "Movies & Films | Movyza", series: "TV Series | Movyza", discover: "Discover Movies & TV | Movyza", search: "Search | Movyza", catalog: "Movyza Top 1000 Movies & TV Shows", legal: "DMCA & Third-Party Policy | Movyza" },
    fr: { home: "Movyza — Films et séries", movies: "Films | Movyza", series: "Séries TV | Movyza", discover: "Découvrir | Movyza", search: "Recherche | Movyza", catalog: "Top 1000 Films et séries | Movyza", legal: "DMCA et politique des tiers | Movyza" },
    de: { home: "Movyza — Filme & Serien", movies: "Filme | Movyza", series: "Serien | Movyza", discover: "Entdecken | Movyza", search: "Suche | Movyza", catalog: "Top 1000 Filme und Serien | Movyza", legal: "DMCA und Richtlinie für Drittanbieter | Movyza" },
    es: { home: "Movyza — Películas y series", movies: "Películas | Movyza", series: "Series | Movyza", discover: "Descubrir | Movyza", search: "Buscar | Movyza", catalog: "Top 1000 Películas y series | Movyza", legal: "DMCA y política de terceros | Movyza" },
    it: { home: "Movyza — Film e serie TV", movies: "Film | Movyza", series: "Serie TV | Movyza", discover: "Scopri | Movyza", search: "Cerca | Movyza", catalog: "Top 1000 Film e serie TV | Movyza", legal: "DMCA e policy di terze parti | Movyza" },
    pt: { home: "Movyza — Filmes e séries", movies: "Filmes | Movyza", series: "Séries | Movyza", discover: "Descobrir | Movyza", search: "Pesquisar | Movyza", catalog: "Top 1000 Filmes e séries | Movyza", legal: "DMCA e política de terceiros | Movyza" },
    ru: { home: "Movyza — Фильмы и сериалы", movies: "Фильмы | Movyza", series: "Сериалы | Movyza", discover: "Каталог | Movyza", search: "Поиск | Movyza", catalog: "Топ-1000 фильмов и сериалов | Movyza", legal: "DMCA и политика сторонних сервисов | Movyza" },
    tr: { home: "Movyza — Filmler ve diziler", movies: "Filmler | Movyza", series: "Diziler | Movyza", discover: "Keşfet | Movyza", search: "Ara | Movyza", catalog: "En İyi 1000 Film ve Dizi | Movyza", legal: "DMCA ve üçüncü taraf politikası | Movyza" },
    hi: { home: "Movyza — फ़िल्में और सीरीज़", movies: "फ़िल्में | Movyza", series: "सीरीज़ | Movyza", discover: "खोजें | Movyza", search: "खोज | Movyza", catalog: "Top 1000 फ़िल्में और सीरीज़ | Movyza", legal: "DMCA और तृतीय-पक्ष नीति | Movyza" },
    ja: { home: "Movyza — 映画・ドラマ", movies: "映画 | Movyza", series: "ドラマ | Movyza", discover: "探す | Movyza", search: "検索 | Movyza", catalog: "人気映画・ドラマ Top 1000 | Movyza", legal: "DMCA・第三者ポリシー | Movyza" },
    ko: { home: "Movyza — 영화 및 드라마", movies: "영화 | Movyza", series: "드라마 | Movyza", discover: "둘러보기 | Movyza", search: "검색 | Movyza", catalog: "인기 영화·드라마 Top 1000 | Movyza", legal: "DMCA 및 제3자 정책 | Movyza" },
    zh: { home: "Movyza — 电影与剧集", movies: "电影 | Movyza", series: "剧集 | Movyza", discover: "探索 | Movyza", search: "搜索 | Movyza", catalog: "热门电影与剧集 Top 1000 | Movyza", legal: "DMCA 与第三方政策 | Movyza" },
    nl: { home: "Movyza — Films en series", movies: "Films | Movyza", series: "Series | Movyza", discover: "Ontdekken | Movyza", search: "Zoeken | Movyza", catalog: "Top 1000 films en series | Movyza", legal: "DMCA en beleid voor derden | Movyza" },
    sv: { home: "Movyza — Filmer och serier", movies: "Filmer | Movyza", series: "Serier | Movyza", discover: "Upptäck | Movyza", search: "Sök | Movyza", catalog: "Top 1000 filmer och serier | Movyza", legal: "DMCA och policy för tredje part | Movyza" },
    da: { home: "Movyza — Film og serier", movies: "Film | Movyza", series: "Serier | Movyza", discover: "Udforsk | Movyza", search: "Søg | Movyza", catalog: "Top 1000 film og serier | Movyza", legal: "DMCA og tredjepartspolitik | Movyza" },
    no: { home: "Movyza — Filmer og serier", movies: "Filmer | Movyza", series: "Serier | Movyza", discover: "Utforsk | Movyza", search: "Søk | Movyza", catalog: "Topp 1000 filmer og serier | Movyza", legal: "DMCA og tredjepartspolicy | Movyza" },
    fi: { home: "Movyza — Elokuvat ja sarjat", movies: "Elokuvat | Movyza", series: "Sarjat | Movyza", discover: "Tutustu | Movyza", search: "Haku | Movyza", catalog: "Top 1000 elokuvat ja sarjat | Movyza", legal: "DMCA ja kolmansien osapuolten käytäntö | Movyza" },
    pl: { home: "Movyza — Filmy i seriale", movies: "Filmy | Movyza", series: "Seriale | Movyza", discover: "Odkrywaj | Movyza", search: "Szukaj | Movyza", catalog: "Top 1000 filmów i seriali | Movyza", legal: "DMCA i polityka stron trzecich | Movyza" },
    cs: { home: "Movyza — Filmy a seriály", movies: "Filmy | Movyza", series: "Seriály | Movyza", discover: "Prozkoumat | Movyza", search: "Hledat | Movyza", catalog: "Top 1000 filmů a seriálů | Movyza", legal: "DMCA a zásady třetích stran | Movyza" },
    uk: { home: "Movyza — Фільми та серіали", movies: "Фільми | Movyza", series: "Серіали | Movyza", discover: "Досліджувати | Movyza", search: "Пошук | Movyza", catalog: "Топ-1000 фільмів і серіалів | Movyza", legal: "DMCA та політика сторонніх сервісів | Movyza" },
    he: { home: "Movyza — סרטים וסדרות", movies: "סרטים | Movyza", series: "סדרות | Movyza", discover: "גילוי | Movyza", search: "חיפוש | Movyza", catalog: "1000 הסרטים והסדרות המובילים | Movyza", legal: "DMCA ומדיניות צד שלישי | Movyza" },
    vi: { home: "Movyza — Phim và series", movies: "Phim | Movyza", series: "Series | Movyza", discover: "Khám phá | Movyza", search: "Tìm kiếm | Movyza", catalog: "Top 1000 phim và series | Movyza", legal: "DMCA và chính sách bên thứ ba | Movyza" },
    id: { home: "Movyza — Film dan serial TV", movies: "Film | Movyza", series: "Serial | Movyza", discover: "Jelajahi | Movyza", search: "Cari | Movyza", catalog: "Top 1000 film dan serial | Movyza", legal: "DMCA dan kebijakan pihak ketiga | Movyza" },
    ms: { home: "Movyza — Filem dan siri", movies: "Filem | Movyza", series: "Siri | Movyza", discover: "Teroka | Movyza", search: "Cari | Movyza", catalog: "Top 1000 filem dan siri | Movyza", legal: "DMCA dan polisi pihak ketiga | Movyza" },
    th: { home: "Movyza — ภาพยนตร์และซีรีส์", movies: "ภาพยนตร์ | Movyza", series: "ซีรีส์ | Movyza", discover: "สำรวจ | Movyza", search: "ค้นหา | Movyza", catalog: "Top 1000 ภาพยนตร์และซีรีส์ | Movyza", legal: "DMCA และนโยบายบุคคลที่สาม | Movyza" },
    ro: { home: "Movyza — Filme și seriale", movies: "Filme | Movyza", series: "Seriale | Movyza", discover: "Descoperă | Movyza", search: "Caută | Movyza", catalog: "Top 1000 filme și seriale | Movyza", legal: "DMCA și politica terților | Movyza" },
    hu: { home: "Movyza — Filmek és sorozatok", movies: "Filmek | Movyza", series: "Sorozatok | Movyza", discover: "Felfedezés | Movyza", search: "Keresés | Movyza", catalog: "Top 1000 film és sorozat | Movyza", legal: "DMCA és harmadik felek szabályzata | Movyza" },
    el: { home: "Movyza — Ταινίες και σειρές", movies: "Ταινίες | Movyza", series: "Σειρές | Movyza", discover: "Εξερεύνηση | Movyza", search: "Αναζήτηση | Movyza", catalog: "Top 1000 ταινίες και σειρές | Movyza", legal: "DMCA και πολιτική τρίτων | Movyza" },
    bn: { home: "Movyza — সিনেমা ও সিরিজ", movies: "সিনেমা | Movyza", series: "সিরিজ | Movyza", discover: "অন্বেষণ | Movyza", search: "অনুসন্ধান | Movyza", catalog: "Top 1000 সিনেমা ও সিরিজ | Movyza", legal: "DMCA ও তৃতীয় পক্ষের নীতি | Movyza" },
    ur: { home: "Movyza — فلمیں اور سیریز", movies: "فلمیں | Movyza", series: "سیریز | Movyza", discover: "دریافت کریں | Movyza", search: "تلاش | Movyza", catalog: "ٹاپ 1000 فلمیں اور سیریز | Movyza", legal: "DMCA اور تھرڈ پارٹی پالیسی | Movyza" },
    fa: { home: "Movyza — فیلم و سریال", movies: "فیلم‌ها | Movyza", series: "سریال‌ها | Movyza", discover: "کشف | Movyza", search: "جستجو | Movyza", catalog: "۱۰۰۰ فیلم و سریال برتر | Movyza", legal: "DMCA و سیاست شخص ثالث | Movyza" },
  };

  if (route === '/') {
    // Keep the homepage's search-result title brand-first across every locale.
    contentTitle = 'Movyza';
    description = HOME_SEO[locale].description;
  } else if (route === '/movies') {
    contentTitle = generic[locale].movies;
    description = generic[locale].movies;
  } else if (route === '/series') {
    contentTitle = generic[locale].series;
    description = generic[locale].series;
  } else if (route === '/discover') {
    contentTitle = generic[locale].discover;
    description = generic[locale].discover;
  } else if (route === '/legal') {
    contentTitle = generic[locale].legal;
    description = generic[locale].legal;
  } else if (route === '/catalog') {
    contentTitle = generic[locale].catalog;
    description = generic[locale].catalog;
  } else if (route === '/search' || route.startsWith('/search/')) {
    contentTitle = generic[locale].search;
    description = generic[locale].search;
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
  } else if (watchMovie || watchEpisode) {
    if (env.TMDB_API_READ_ACCESS_TOKEN) {
      try {
        const isMovieWatch = Boolean(watchMovie);
        const id = Number((watchMovie || watchEpisode)?.[1] || 0);
        const seasonNumber = Number(watchEpisode?.[2] || 0);
        const episodeNumber = Number(watchEpisode?.[3] || 0);
        const subtitle = subtitlePriorityForLanguage(locale);
        const embedUrl = isMovieWatch
          ? `${VIDSRC_BASE_URL}/embed/movie/${id}?ds_lang=${encodeURIComponent(subtitle)}`
          : `${VIDSRC_BASE_URL}/embed/tv/${id}/${seasonNumber}/${episodeNumber}?ds_lang=${encodeURIComponent(subtitle)}`;

        if (isMovieWatch) {
          const upstream = await fetch(`https://api.themoviedb.org/3/movie/${id}?language=${encodeURIComponent(config.tmdb)}&append_to_response=credits`, {
            headers: tmdbHeaders(env),
          });
          const data = await upstream.json().catch(() => null) as any;
          contentTitle = data?.title || data?.original_title || `Movyza #${id}`;
          alternateTitle = data?.original_title || '';
          description = data?.overview || (locale === 'ar' ? `مشاهدة ${contentTitle} على موفيزا` : `Watch ${contentTitle} on Movyza`);
          imageUrl = data?.backdrop_path
            ? `https://image.tmdb.org/t/p/w1280${data.backdrop_path}`
            : (data?.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : '');
          schemaType = 'VideoObject';
          ogType = 'video.movie';
          watchVideo = {
            embedUrl,
            uploadDate: data?.release_date || '',
            duration: Number(data?.runtime || 0),
          };
        } else {
          const [seriesResponse, episodeResponse] = await Promise.all([
            fetch(`https://api.themoviedb.org/3/tv/${id}?language=${encodeURIComponent(config.tmdb)}`, { headers: tmdbHeaders(env) }),
            fetch(`https://api.themoviedb.org/3/tv/${id}/season/${seasonNumber}/episode/${episodeNumber}?language=${encodeURIComponent(config.tmdb)}`, { headers: tmdbHeaders(env) }),
          ]);
          const seriesData = await seriesResponse.json().catch(() => null) as any;
          const episodeData = await episodeResponse.json().catch(() => null) as any;
          const seriesTitle = seriesData?.name || seriesData?.original_name || `Series #${id}`;
          const episodeTitle = episodeData?.name || `Episode ${episodeNumber}`;
          contentTitle = `${seriesTitle} — ${episodeTitle} | S${seasonNumber} E${episodeNumber}`;
          alternateTitle = episodeData?.original_name || seriesData?.original_name || '';
          description = episodeData?.overview || seriesData?.overview || (locale === 'ar' ? `مشاهدة ${contentTitle} على موفيزا` : `Watch ${contentTitle} on Movyza`);
          imageUrl = episodeData?.still_path
            ? `https://image.tmdb.org/t/p/w780${episodeData.still_path}`
            : (seriesData?.backdrop_path ? `https://image.tmdb.org/t/p/w1280${seriesData.backdrop_path}` : '');
          schemaType = 'VideoObject';
          ogType = 'video.tv_show';
          watchVideo = {
            embedUrl,
            uploadDate: episodeData?.air_date || seriesData?.first_air_date || '',
            duration: Number(episodeData?.runtime || 0),
          };
        }
      } catch {
        contentTitle = 'Movyza Video';
        description = contentTitle;
      }
    }
  }

  if (!contentTitle) {
    contentTitle = generic[locale].home;
    description = generic[locale].home;
  }

  // Category pages should not reuse the short category label as the description.
  if (['/movies', '/series', '/discover', '/catalog'].includes(route)) {
    const categoryLabel = contentTitle.split(/\s+\|\s+/)[0].trim();
    const fullDescription = `${categoryLabel}. ${HOME_SEO[locale].description}`.replace(/\s+/g, ' ').trim();
    const descriptionChars = Array.from(fullDescription);
    if (descriptionChars.length <= 160) {
      description = fullDescription;
    } else {
      const shortened = descriptionChars.slice(0, 157).join('').replace(/\s+\S*$/u, '').trim();
      description = `${shortened}…`;
    }
  }

  const isWatchPage = Boolean(watchMovie || watchEpisode);
  const noindexRoutes = new Set([
    '/admin',
    '/profile',
    '/watchlist',
    '/history',
    '/login',
    '/register',
    '/forgot-password',
  ]);
  // Watch pages are intentionally excluded from search indexing. They remain
  // fully accessible to users, but are not SEO landing pages.
  const isNoIndex = isWatchPage || route === '/search' || route.startsWith('/search/') || noindexRoutes.has(route);
  const searchTitle = alternateTitle || contentTitle;
  const seoTitle = isWatchPage
    ? (locale === 'ar'
      ? `مشاهدة ${searchTitle} مترجم عربي | ${contentTitle} | موفيزا`
      : `Watch ${searchTitle} | ${contentTitle} | Movyza`)
    : (detailMovie || detailSeries)
      ? (locale === 'ar'
        ? `${searchTitle} مترجم عربي | ${contentTitle} | مشاهدة ${searchTitle} | موفيزا`
        : `${searchTitle} | ${contentTitle} | Movyza`)
      : contentTitle;
  const hasExplicitLocale = Boolean(localeFromPath(url.pathname));
  const canonicalPath = route === '/' && !hasExplicitLocale ? '/' : `/${locale}${route === '/' ? '/' : route}`;
  const origin = url.origin;
  const hreflangLinks = Object.entries(LOCALES)
    .map(([code, item]) => `<link rel="alternate" hreflang="${item.tmdb.toLowerCase()}" href="${origin}/${code}${route === '/' ? '/' : route}" />`)
    .join('');
  const xDefault = `<link rel="alternate" hreflang="x-default" href="${origin}/en${route === '/' ? '/' : route}" />`;
  const keywords = titleKeywords(locale, contentTitle + (alternateTitle && alternateTitle !== contentTitle ? `, ${alternateTitle}` : ''));

  const toIsoDuration = (minutes: number) => {
    const totalSeconds = Math.max(0, Math.round(minutes * 60));
    if (!totalSeconds) return undefined;
    const hours = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    return `PT${hours ? hours + 'H' : ''}${mins ? mins + 'M' : ''}${secs ? secs + 'S' : ''}`;
  };

  const jsonLd = isWatchPage
    ? {
        '@context': 'https://schema.org',
        '@type': 'VideoObject',
        name: contentTitle,
        description,
        thumbnailUrl: imageUrl ? [imageUrl] : undefined,
        uploadDate: watchVideo?.uploadDate || undefined,
        duration: toIsoDuration(Number(watchVideo?.duration || 0)),
        embedUrl: watchVideo?.embedUrl,
        url: origin + canonicalPath,
        inLanguage: locale,
        creator: {
          '@type': 'Organization',
          name: 'Movyz',
          url: origin,
        },
      }
    : {
        '@context': 'https://schema.org',
        '@type': schemaType,
        ...(route === '/' ? { '@id': 'https://movyza.sbs/#website', inLanguage: locale } : {}),
        // Use one stable brand name for every localized homepage. Site names
        // are domain-level in Google Search, not separate per-locale brands.
        name: route === '/' ? 'Movyza' : contentTitle,
        description,
        alternateName: route === '/' ? undefined : alternateTitle || undefined,
        image: imageUrl ? [imageUrl] : undefined,
        url: route === '/' ? 'https://movyza.sbs/' : origin + canonicalPath,
      };
  const subtitleLocale = detectSubtitleLocale(request);
  const injection = `<!-- movyz-seo -->` +
    `<meta name="movyz-country" content="${String(countryFromRequest(request) || 'XX').toUpperCase()}" />` +
    `<meta name="movyz-subtitle-language" content="${subtitleLocale}" />` +
    `<meta name="movyz-subtitle-priority" content="${subtitlePriorityForLanguage(subtitleLocale)}" />` +
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

  // Supply meaningful, visible server-delivered copy and internal links outside
  // the React mount node, so crawlers do not depend entirely on client rendering.
  const crawlableRoutes = ['/movies', '/series', '/discover', '/catalog', '/legal'];
  const hasIndexableContentRoute = route === '/' || crawlableRoutes.includes(route) || Boolean(detailMovie || detailSeries);
  const bodyHeading = route === '/' ? HOME_SEO[locale].title : contentTitle;
  const bodyDescription = description || HOME_SEO[locale].description;
  const sectionLinks = [
    { path: 'movies', label: generic[locale].movies },
    { path: 'series', label: generic[locale].series },
    { path: 'discover', label: generic[locale].discover },
    { path: 'catalog', label: generic[locale].catalog },
  ].map(({ path, label }) => {
    const displayLabel = label.replace(/\s*\|\s*(Movyza|موفيزا)$/i, '').trim();
    return `<a href="${origin}/${locale}/${path}" style="display:inline-flex;align-items:center;border:1px solid #3f3f46;border-radius:999px;padding:9px 14px;color:#fbbf24;background:#101012;text-decoration:none;font-size:14px;line-height:1.5">${escapeXml(displayLabel)}</a>`;
  }).join('');
  const crawlableBody = !isNoIndex && hasIndexableContentRoute
    ? `<section id="movyza-seo-content" dir="${config.dir}" aria-label="${escapeXml(HOME_SEO[locale].title)}" style="max-width:1160px;margin:28px auto 18px;padding:24px 20px;border-top:1px solid #27272a;color:#e4e4e7;font-family:inherit">
        <h1 style="margin:0 0 12px;font-size:clamp(22px,3vw,32px);line-height:1.35;font-weight:700;color:#fafafa">${escapeXml(bodyHeading)}</h1>
        <p style="max-width:900px;margin:0;color:#a1a1aa;font-size:15px;line-height:1.9">${escapeXml(bodyDescription)}</p>
        <nav style="display:flex;flex-wrap:wrap;gap:10px;margin-top:16px" aria-label="${escapeXml(HOME_SEO[locale].title)}">${sectionLinks}</nav>
      </section>`
    : '';

  let html = await response.text();
  html = html.replace(/<html\b[^>]*>/i, htmlLang + '>');
  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${seoTitle}</title>`);
  html = html.replace(/<meta\s+name=["']description["'][^>]*>/i, `<meta name="description" content="${description.replace(/"/g, '&quot;')}" />`);
  html = html.replace('</head>', injection + '</head>');
  if (crawlableBody) {
    html = html.replace(/(<div id="root"><\/div>)/i, `$1${crawlableBody}`);
  }
  const headers = new Headers(response.headers);
  headers.set('content-type', 'text/html; charset=UTF-8');
  // HTML is deterministic for a locale + path and safe to cache at the Worker edge.
  // This prevents crawlers and repeat navigation from executing the Worker repeatedly.
  headers.set('cache-control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=300');
  headers.set('cdn-cache-control', 'public, max-age=3600, stale-while-revalidate=300');
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


const MOVYZ_EDITORIAL_BOOST: Record<string, number> = {
  // Movies
  'movie:157336': 60, // Interstellar
  'movie:27205': 58, // Inception
  'movie:155': 56, // The Dark Knight
  'movie:122': 54, // The Lord of the Rings: The Return of the King
  'movie:693134': 52, // Dune: Part Two
  'movie:872585': 50, // Oppenheimer
  'movie:533535': 48, // Deadpool & Wolverine
  'movie:634649': 46, // Spider-Man: No Way Home
  'movie:299534': 44, // Avengers: Endgame
  'movie:299536': 42, // Avengers: Infinity War
  'movie:603692': 40, // John Wick: Chapter 4
  'movie:361743': 38, // Top Gun: Maverick
  'movie:414906': 36, // The Batman
  'movie:475557': 34, // Joker
  'movie:496243': 32, // Parasite
  'movie:396535': 30, // Train to Busan
  'movie:579974': 28, // RRR
  'movie:663712': 26, // Kantara
  'movie:803796': 24, // Kalki 2898 AD
  'movie:569094': 22, // Spider-Man: Across the Spider-Verse

  // Series
  'tv:66732': 60, // Stranger Things
  'tv:93405': 58, // Squid Game
  'tv:100088': 56, // The Last of Us
  'tv:95396': 54, // Severance
  'tv:1396': 52, // Breaking Bad
  'tv:1399': 50, // Game of Thrones
  'tv:60059': 48, // Better Call Saul
  'tv:76479': 46, // The Boys
  'tv:119051': 44, // Wednesday
  'tv:94997': 42, // House of the Dragon
  'tv:60574': 40, // Peaky Blinders
  'tv:70523': 38, // Dark
  'tv:136315': 36, // The Bear
  'tv:126308': 34, // Shōgun
  'tv:42009': 32, // Black Mirror
  'tv:37854': 30, // One Piece
  'tv:1429': 28, // Attack on Titan
  'tv:85937': 26, // Demon Slayer
  'tv:95479': 24, // Jujutsu Kaisen
  'tv:127532': 22, // Solo Leveling
};

const catalogScore = (item: any, type: 'movie' | 'tv') => {
  const popularity = Math.log1p(Number(item?.popularity || 0));
  const votes = Math.log1p(Number(item?.vote_count || 0));
  const rating = Number(item?.vote_average || 0) / 10;
  const rawDate = String(item?.release_date || item?.first_air_date || '');
  const year = Number(rawDate.slice(0, 4) || 0);
  const currentYear = new Date().getUTCFullYear();
  const age = year > 0 ? Math.max(0, currentYear - year) : 20;
  const freshness = age <= 2 ? 1.24 : age <= 4 ? 1.17 : age <= 7 ? 1.10 : age <= 12 ? 1.04 : 1;
  const boost = MOVYZ_EDITORIAL_BOOST[(type === 'movie' ? 'movie:' : 'tv:') + String(item?.id || '')] || 0;
  return ((popularity * 0.58) + (votes * 0.25) + (rating * 1.7)) * freshness + boost;
};

const fetchCatalogPage = async (
  env: MovyzEnvironment,
  locale: LocaleCode,
  type: 'movie' | 'tv',
  page: number,
) => {
  const config = LOCALES[locale];
  const target = new URL('https://api.themoviedb.org/3/discover/' + type);
  target.searchParams.set('language', config.tmdb);
  target.searchParams.set('region', config.region);
  target.searchParams.set('page', String(page));
  target.searchParams.set('sort_by', 'popularity.desc');
  target.searchParams.set('include_adult', 'false');
  if (type === 'movie') target.searchParams.set('include_video', 'false');

  const upstream = await fetch(target.toString(), { headers: tmdbHeaders(env) });
  if (!upstream.ok) throw new Error('TMDB catalog upstream failed: ' + upstream.status);
  const data = await upstream.json().catch(() => null) as any;
  return Array.isArray(data?.results) ? data.results : [];
};

const collectCatalogType = async (
  env: MovyzEnvironment,
  locale: LocaleCode,
  type: 'movie' | 'tv',
) => {
  const output: any[] = [];
  const pages = Array.from({ length: 25 }, (_, index) => index + 1);

  // Stay inside the six simultaneous outbound-connection limit.
  for (let offset = 0; offset < pages.length; offset += 6) {
    const batch = pages.slice(offset, offset + 6);
    const responses = await Promise.all(
      batch.map((page) => fetchCatalogPage(env, locale, type, page).catch(() => [])),
    );
    responses.forEach((items) => output.push(...items));
  }

  const byId = new Map<string, any>();
  for (const item of output) {
    const id = Number(item?.id || 0);
    if (!id) continue;
    const key = type + ':' + id;
    if (!byId.has(key)) byId.set(key, { ...item, media_type: type });
  }

  return Array.from(byId.values())
    .sort((a, b) => catalogScore(b, type) - catalogScore(a, type))
    .slice(0, 500);
};

const catalogTop1000 = async (request: Request, env: MovyzEnvironment) => {
  if (!env.TMDB_API_READ_ACCESS_TOKEN) {
    return new Response(JSON.stringify({ status_message: 'TMDB token is not configured' }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=UTF-8' },
    });
  }

  const url = new URL(request.url);
  const requested = url.searchParams.get('locale');
  const locale = isLocale(requested) ? requested : detectRequestLocale(request);
  const page = Math.max(1, Number(url.searchParams.get('page') || 1));
  const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit') || 1000)));
  const cache = (caches as unknown as { default: Cache }).default;

  const cacheUrl = new URL(url.toString());
  cacheUrl.pathname = '/catalog/top1000';
  cacheUrl.search = '?locale=' + encodeURIComponent(locale);
  const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });

  let payload: { items: any[]; total: number; generatedAt: string };
  const cached = await cache.match(cacheKey);

  if (cached) {
    payload = await cached.json() as { items: any[]; total: number; generatedAt: string };
  } else {
    const movies = await collectCatalogType(env, locale, 'movie');
    const series = await collectCatalogType(env, locale, 'tv');

    const combined = [...movies, ...series]
      .sort((a, b) => {
        const aType = a.media_type === 'movie' ? 'movie' : 'tv';
        const bType = b.media_type === 'movie' ? 'movie' : 'tv';
        return catalogScore(b, bType) - catalogScore(a, aType);
      })
      .slice(0, 1000)
      .map((item, index) => ({ ...item, movyz_rank: index + 1 }));

    payload = {
      items: combined,
      total: combined.length,
      generatedAt: new Date().toISOString(),
    };

    const cachedResponse = new Response(JSON.stringify(payload), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=UTF-8',
        'cache-control': 'public, max-age=21600, s-maxage=21600',
        'cdn-cache-control': 'public, max-age=21600',
        'access-control-allow-origin': '*',
      },
    });
    await cache.put(cacheKey, cachedResponse.clone());
  }

  const start = (page - 1) * limit;
  const body = {
    total: payload.total,
    page,
    limit,
    generatedAt: payload.generatedAt,
    items: payload.items.slice(start, start + limit),
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=UTF-8',
      'cache-control': 'public, max-age=300, s-maxage=21600',
      'cdn-cache-control': 'public, max-age=300',
      'access-control-allow-origin': '*',
    },
  });
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

const SITEMAP_DISCOVERY_PAGES = 20;
// Retain the episode sitemap endpoint for direct requests, but keep it bounded.
const SITEMAP_EPISODE_PAGES = 20;
// The root sitemap advertises only the localized homepages. Keep catalog/detail
// URLs out of the submitted sitemap so Google is first directed to the language entry pages.
const SITEMAP_CRAWL_ORIGIN = 'https://movyza.sbs';

const buildSitemapIndex = (origin: string) => {
  // Include localized entry/category pages and indexable movie/series detail pages.
  // Watch/episode URLs remain excluded because the page templates mark them noindex.
  const entries = [`<sitemap><loc>${origin}/sitemap-gsc.xml</loc></sitemap>`];
  for (const locale of Object.keys(LOCALES) as LocaleCode[]) {
    entries.push(`<sitemap><loc>${origin}/sitemap/${locale}/static.xml</loc></sitemap>`);
    for (const type of ['movies', 'series'] as const) {
      for (let page = 1; page <= SITEMAP_DISCOVERY_PAGES; page += 1) {
        entries.push(`<sitemap><loc>${origin}/sitemap/${locale}/${type}/${page}.xml</loc></sitemap>`);
      }
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.join('')}</sitemapindex>`;
};

const buildStaticSitemapSegment = (request: Request, locale: LocaleCode) => {
  const origin = SITEMAP_PUBLIC_ORIGIN;
  const routes = ['/', '/movies', '/series', '/discover', '/catalog', '/legal'];
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
  type: 'movies' | 'series' | 'episodes',
  page: number,
) => {
  if (!env.TMDB_API_READ_ACCESS_TOKEN || page < 1) {
    return new Response('Not found', { status: 404 });
  }

  const config = LOCALES[locale];
  const origin = SITEMAP_PUBLIC_ORIGIN;

  const fetchJson = async (target: URL) => {
    const upstream = await fetch(target.toString(), { headers: tmdbHeaders(env) });
    if (!upstream.ok) throw new Error('TMDB sitemap upstream failed: ' + upstream.status);
    return await upstream.json().catch(() => null) as any;
  };

  try {
    // Episode sitemap: five popular series per segment, covering all seasons
    // using TMDB's season metadata without making one request per episode.
    if (type === 'episodes') {
      if (page > SITEMAP_EPISODE_PAGES) return new Response('Not found', { status: 404 });

      const discoverPage = Math.floor((page - 1) / 4) + 1;
      const sliceStart = ((page - 1) % 4) * 5;
      const discoverTarget = new URL('https://api.themoviedb.org/3/discover/tv');
      discoverTarget.searchParams.set('language', config.tmdb);
      discoverTarget.searchParams.set('region', config.region);
      discoverTarget.searchParams.set('page', String(discoverPage));
      discoverTarget.searchParams.set('sort_by', 'popularity.desc');
      discoverTarget.searchParams.set('include_adult', 'false');

      const discoverData = await fetchJson(discoverTarget);
      const seriesBatch = (discoverData?.results || []).slice(sliceStart, sliceStart + 5);

      const detailData = await Promise.all(
        seriesBatch.map(async (series: any) => {
          const id = Number(series?.id || 0);
          if (!id) return null;
          try {
            const target = new URL(`https://api.themoviedb.org/3/tv/${id}`);
            target.searchParams.set('language', config.tmdb);
            return { id, data: await fetchJson(target) };
          } catch {
            return null;
          }
        }),
      );

      const urls: string[] = [];
      for (const entry of detailData) {
        if (!entry?.data) continue;
        for (const season of entry.data.seasons || []) {
          const seasonNumber = Number(season?.season_number || 0);
          const episodeCount = Number(season?.episode_count || 0);
          if (seasonNumber <= 0 || episodeCount <= 0) continue;

          for (let episode = 1; episode <= episodeCount; episode += 1) {
            urls.push(
              `<url><loc>${escapeXml(`${origin}/${locale}/watch/tv/${entry.id}/${seasonNumber}/${episode}`)}</loc><changefreq>monthly</changefreq><priority>0.55</priority></url>`
            );
          }
        }
      }

      const xml =
        `<?xml version="1.0" encoding="UTF-8"?>` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`;

      return new Response(xml, {
        status: 200,
        headers: {
          'content-type': 'application/xml; charset=UTF-8',
          'cache-control': 'public, max-age=3600, s-maxage=86400',
          'cdn-cache-control': 'public, max-age=86400',
        },
      });
    }

    if (page > SITEMAP_DISCOVERY_PAGES) {
      return new Response('Not found', { status: 404 });
    }

    const tmdbType = type === 'movies' ? 'movie' : 'tv';
    const target = new URL(`https://api.themoviedb.org/3/discover/${tmdbType}`);
    target.searchParams.set('language', config.tmdb);
    target.searchParams.set('region', config.region);
    target.searchParams.set('page', String(page));
    target.searchParams.set('sort_by', 'popularity.desc');
    target.searchParams.set('include_adult', 'false');
    if (tmdbType === 'movie') target.searchParams.set('include_video', 'false');

    const data = await fetchJson(target);
    const urls: string[] = [];

    for (const item of data?.results || []) {
      const id = Number(item?.id || 0);
      if (!id) continue;

      urls.push(
        `<url><loc>${escapeXml(`${origin}/${locale}/${type}/${id}`)}</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>`
      );

      // Watch pages are intentionally not included in sitemaps.
      // Detail pages remain the SEO entry points for each title.
    }

    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`;

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

const SITEMAP_PUBLIC_ORIGIN = 'https://movyza.sbs';

const buildGscSitemap = () => {
  const urls: string[] = [
    `<url><loc>${escapeXml(SITEMAP_PUBLIC_ORIGIN + '/')}</loc></url>`,
  ];
  for (const locale of Object.keys(LOCALES) as LocaleCode[]) {
    urls.push(
      `<url><loc>${escapeXml(`${SITEMAP_PUBLIC_ORIGIN}/${locale}/`)}</loc></url>`,
    );
  }

  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`;
};

const buildRootSitemap = () => buildSitemapIndex(SITEMAP_CRAWL_ORIGIN);

const buildRobotsTxt = () => [
  '# Movyza crawler policy',
  '# robots.txt manages crawling; it is not an access-control mechanism.',
  '',
  'User-agent: *',
  'Allow: /',
  'Disallow: /admin',
  'Disallow: /*/admin',
  'Disallow: /tmdb',
  'Disallow: /tmdb/',
  'Disallow: /api/v1/playback/resolve',
  '',
  '# Search pages are marked noindex by the application instead of being blocked here.',
  '',
  'Sitemap: https://movyza.sbs/sitemap.xml',
  '',
].join('\n');

const xmlResponse = (xml: string, maxAge = 3600) =>
  new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=UTF-8',
      'Cache-Control': `public, max-age=${maxAge}, s-maxage=86400`,
      'CDN-Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  });

const handleSitemap = async (request: Request, env: MovyzEnvironment) => {
  const url = new URL(request.url);
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });

  const staticMatch = url.pathname.match(/^\/sitemap\/(ar|en|fr|de|es|it|pt|ru|tr|hi|ja|ko|zh|nl|sv|da|no|fi|pl|cs|uk|he|vi|id|ms|th|ro|hu|el|bn|ur|fa)\/static\.xml$/);
  if (staticMatch) {
    return buildStaticSitemapSegment(request, staticMatch[1] as LocaleCode);
  }

  const match = url.pathname.match(/^\/sitemap\/(ar|en|fr|de|es|it|pt|ru|tr|hi|ja|ko|zh|nl|sv|da|no|fi|pl|cs|uk|he|vi|id|ms|th|ro|hu|el|bn|ur|fa)\/(movies|series|episodes)\/(\d+)\.xml$/);
  if (!match) return null;

  const locale = match[1] as LocaleCode;
  const type = match[2] as 'movies' | 'series' | 'episodes';
  const page = Number(match[3]);
  return buildSitemapSegment(request, env, locale, type, page);
};

export default {
  async fetch(request: Request, env: MovyzEnvironment, _ctx: ExecutionContextLike): Promise<Response> {
    const url = new URL(request.url);
    // Canonicalize every public request to HTTPS before locale redirects or HTML
    // generation. Otherwise an HTTP root request can redirect to an HTTP locale
    // URL and expose duplicate insecure URLs to crawlers.
    const localHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
    if (url.protocol === 'http:' && !localHost) {
      const secureUrl = new URL(request.url);
      secureUrl.protocol = 'https:';
      if (secureUrl.port === '80') secureUrl.port = '';
      return new Response(null, {
        status: 301,
        headers: {
          Location: secureUrl.toString(),
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization,Content-Type',
      }});
    }
    if (request.method === 'GET' && url.pathname === '/robots.txt') {
      return new Response(buildRobotsTxt(), {
        status: 200,
        headers: {
          'content-type': 'text/plain; charset=UTF-8',
          'cache-control': 'public, max-age=3600, s-maxage=86400',
          'cdn-cache-control': 'public, max-age=86400',
        },
      });
    }
    if (request.method === 'GET' && url.pathname === '/sitemap-gsc.xml') {
      return xmlResponse(buildGscSitemap(), 3600);
    }
    if (request.method === 'GET' && url.pathname === '/sitemap.xml') {
      return xmlResponse(buildRootSitemap());
    }
    if (request.method === 'GET' && url.pathname.startsWith('/sitemap/')) {
      const sitemapResponse = await handleSitemap(request, env);
      if (sitemapResponse) return sitemapResponse;
    }
    if (request.method === 'GET' && url.pathname === '/catalog/top1000') {
      return catalogTop1000(request, env);
    }
    if (url.pathname === '/tmdb' || url.pathname.startsWith('/tmdb/')) {
      return proxyTmdb(request, env);
    }
    if (request.method === 'GET' && url.pathname !== '/' && isAppHtmlPath(url.pathname) && !localeFromPath(url.pathname)) {
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
      // Never rely on the asset binding's SPA fallback for document requests.
      // Fetch the real application shell explicitly so deep links such as
      // /ar/movies/157336 and /ar/watch/movie/157336 remain client-routable,
      // while /sitemap.xml, robots.txt and other real assets never become HTML.
      const shellUrl = new URL(request.url);
      shellUrl.pathname = '/index.html';
      shellUrl.search = '__movyz_asset_version=' + encodeURIComponent(env.MOVYZ_BUILD_ID || 'dev');
      const shellRequest = new Request(shellUrl.toString(), request);
      const localized = await env.ASSETS.fetch(shellRequest);
      if (!localized.ok) {
        return new Response('Application shell unavailable', { status: 503 });
      }
      const locale = localeFromPath(url.pathname) || detectRequestLocale(request);
      return await localizedHtml(request, env, localized, locale);
    }
    return await env.ASSETS.fetch(request);
  },
};
