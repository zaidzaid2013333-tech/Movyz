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

const detectSubtitleLocale = (request: Request): LocaleCode => {
  // An explicit locale in the URL is authoritative. On the unprefixed homepage,
  // reuse the same country/Accept-Language detection as the rendered document so
  // the subtitle preference cannot silently fall back to English or Arabic.
  const fromPath = localeFromPath(new URL(request.url).pathname);
  return fromPath || detectRequestLocale(request);
};

const VIDSRC_BASE_URL = 'https://player.movyza.sbs';

const subtitlePriorityForLanguage = (primary: LocaleCode): string =>
  primary === 'en' ? 'en' : primary + ',en';

const isAppHtmlPath = (pathname: string) =>
  !pathname.includes('.') &&
  !pathname.startsWith('/tmdb');

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

const FREE_SEO_TITLES: Record<LocaleCode, { movie: string; series: string; episode: string; movies: string; seriesList: string; discover: string; catalog: string }> = {
  ar: { movie: 'مشاهدة {title} مجانًا', series: 'مشاهدة مسلسل {title} مجانًا', episode: 'مشاهدة حلقة {title} مجانًا', movies: 'مشاهدة الأفلام مجانًا', seriesList: 'مشاهدة المسلسلات مجانًا', discover: 'اكتشف أفلامًا ومسلسلات مجانية', catalog: 'أفضل 1000 فيلم ومسلسل مجاني' },
  en: { movie: 'Watch {title} Online Free', series: 'Watch {title} Series Online Free', episode: 'Watch {title} Episode Free', movies: 'Watch Movies Online Free', seriesList: 'Watch TV Series Online Free', discover: 'Discover Movies and Series to Watch Free', catalog: 'Top 1000 Movies and Series to Watch Free' },
  fr: { movie: 'Regarder {title} gratuitement', series: 'Regarder la série {title} gratuitement', episode: 'Regarder l’épisode {title} gratuitement', movies: 'Regarder des films gratuitement', seriesList: 'Regarder des séries gratuitement', discover: 'Découvrir des films et séries gratuits', catalog: 'Top 1000 films et séries gratuits' },
  de: { movie: '{title} kostenlos online ansehen', series: 'Serie {title} kostenlos ansehen', episode: 'Folge {title} kostenlos ansehen', movies: 'Filme kostenlos online ansehen', seriesList: 'Serien kostenlos online ansehen', discover: 'Kostenlose Filme und Serien entdecken', catalog: 'Top 1000 Filme und Serien kostenlos ansehen' },
  es: { movie: 'Ver {title} gratis online', series: 'Ver la serie {title} gratis', episode: 'Ver el episodio {title} gratis', movies: 'Ver películas gratis', seriesList: 'Ver series gratis', discover: 'Descubrir películas y series gratis', catalog: 'Top 1000 películas y series gratis' },
  it: { movie: 'Guarda {title} gratis online', series: 'Guarda la serie {title} gratis', episode: 'Guarda l’episodio {title} gratis', movies: 'Guarda film gratis', seriesList: 'Guarda serie TV gratis', discover: 'Scopri film e serie gratis', catalog: 'Top 1000 film e serie gratis' },
  pt: { movie: 'Assistir {title} grátis online', series: 'Assistir à série {title} grátis', episode: 'Assistir ao episódio {title} grátis', movies: 'Assistir a filmes grátis', seriesList: 'Assistir a séries grátis', discover: 'Descubra filmes e séries grátis', catalog: 'Top 1000 filmes e séries grátis' },
  ru: { movie: 'Смотреть {title} бесплатно', series: 'Смотреть сериал {title} бесплатно', episode: 'Смотреть серию {title} бесплатно', movies: 'Смотреть фильмы бесплатно', seriesList: 'Смотреть сериалы бесплатно', discover: 'Бесплатные фильмы и сериалы', catalog: 'Топ-1000 фильмов и сериалов бесплатно' },
  tr: { movie: '{title} ücretsiz izle', series: '{title} dizisini ücretsiz izle', episode: '{title} bölümünü ücretsiz izle', movies: 'Ücretsiz film izle', seriesList: 'Ücretsiz dizi izle', discover: 'Ücretsiz film ve dizileri keşfet', catalog: 'En iyi 1000 film ve diziyi ücretsiz izle' },
  hi: { movie: '{title} मुफ़्त ऑनलाइन देखें', series: '{title} सीरीज़ मुफ़्त देखें', episode: '{title} एपिसोड मुफ़्त देखें', movies: 'मुफ़्त फ़िल्में देखें', seriesList: 'मुफ़्त सीरीज़ देखें', discover: 'मुफ़्त फ़िल्में और सीरीज़ खोजें', catalog: 'टॉप 1000 फ़िल्में और सीरीज़ मुफ़्त देखें' },
  ja: { movie: '{title}を無料で視聴', series: 'ドラマ{title}を無料で視聴', episode: 'エピソード{title}を無料で視聴', movies: '映画を無料で視聴', seriesList: 'ドラマを無料で視聴', discover: '無料の映画・ドラマを探す', catalog: '人気映画・ドラマTop 1000を無料で視聴' },
  ko: { movie: '{title} 무료 시청', series: '드라마 {title} 무료 시청', episode: '에피소드 {title} 무료 시청', movies: '영화 무료 시청', seriesList: 'TV 시리즈 무료 시청', discover: '무료 영화와 시리즈 찾기', catalog: '인기 영화·시리즈 Top 1000 무료 시청' },
  zh: { movie: '免费在线看{title}', series: '免费在线看剧集{title}', episode: '免费在线看{title}这一集', movies: '免费在线看电影', seriesList: '免费在线看电视剧', discover: '发现免费电影和剧集', catalog: '免费查看热门电影和剧集Top 1000' },
  nl: { movie: '{title} gratis online kijken', series: 'Serie {title} gratis kijken', episode: 'Aflevering {title} gratis kijken', movies: 'Gratis films kijken', seriesList: 'Gratis series kijken', discover: 'Gratis films en series ontdekken', catalog: 'Top 1000 films en series gratis kijken' },
  sv: { movie: 'Se {title} gratis online', series: 'Se serien {title} gratis', episode: 'Se avsnittet {title} gratis', movies: 'Se filmer gratis', seriesList: 'Se serier gratis', discover: 'Upptäck gratis filmer och serier', catalog: 'Topp 1000 filmer och serier gratis' },
  da: { movie: 'Se {title} gratis online', series: 'Se serien {title} gratis', episode: 'Se afsnittet {title} gratis', movies: 'Se film gratis', seriesList: 'Se serier gratis', discover: 'Find gratis film og serier', catalog: 'Top 1000 film og serier gratis' },
  no: { movie: 'Se {title} gratis på nett', series: 'Se serien {title} gratis', episode: 'Se episoden {title} gratis', movies: 'Se filmer gratis på nett', seriesList: 'Se serier gratis på nett', discover: 'Finn gratis filmer og serier', catalog: 'Topp 1000 filmer og serier gratis' },
  fi: { movie: 'Katso {title} ilmaiseksi verkossa', series: 'Katso sarja {title} ilmaiseksi', episode: 'Katso jakso {title} ilmaiseksi', movies: 'Katso elokuvia ilmaiseksi', seriesList: 'Katso sarjoja ilmaiseksi', discover: 'Löydä ilmaisia elokuvia ja sarjoja', catalog: 'Top 1000 elokuvaa ja sarjaa ilmaiseksi' },
  pl: { movie: 'Oglądaj {title} online za darmo', series: 'Oglądaj serial {title} za darmo', episode: 'Oglądaj odcinek {title} za darmo', movies: 'Oglądaj filmy za darmo', seriesList: 'Oglądaj seriale za darmo', discover: 'Odkrywaj darmowe filmy i seriale', catalog: 'Top 1000 filmów i seriali za darmo' },
  cs: { movie: 'Sledujte {title} online zdarma', series: 'Sledujte seriál {title} zdarma', episode: 'Sledujte epizodu {title} zdarma', movies: 'Sledujte filmy zdarma', seriesList: 'Sledujte seriály zdarma', discover: 'Objevte filmy a seriály zdarma', catalog: 'Top 1000 filmů a seriálů zdarma' },
  uk: { movie: 'Дивіться {title} безкоштовно онлайн', series: 'Дивіться серіал {title} безкоштовно', episode: 'Дивіться епізод {title} безкоштовно', movies: 'Дивіться фільми безкоштовно', seriesList: 'Дивіться серіали безкоштовно', discover: 'Знайдіть безкоштовні фільми й серіали', catalog: 'Топ-1000 фільмів і серіалів безкоштовно' },
  he: { movie: 'צפו ב־{title} בחינם', series: 'צפו בסדרה {title} בחינם', episode: 'צפו בפרק {title} בחינם', movies: 'צפו בסרטים בחינם', seriesList: 'צפו בסדרות בחינם', discover: 'גלו סרטים וסדרות בחינם', catalog: '1000 הסרטים והסדרות המובילים בחינם' },
  vi: { movie: 'Xem {title} miễn phí trực tuyến', series: 'Xem phim bộ {title} miễn phí', episode: 'Xem tập {title} miễn phí', movies: 'Xem phim miễn phí', seriesList: 'Xem series miễn phí', discover: 'Khám phá phim và series miễn phí', catalog: 'Top 1000 phim và series miễn phí' },
  id: { movie: 'Nonton {title} online gratis', series: 'Nonton serial {title} gratis', episode: 'Nonton episode {title} gratis', movies: 'Nonton film gratis', seriesList: 'Nonton serial gratis', discover: 'Temukan film dan serial gratis', catalog: 'Top 1000 film dan serial gratis' },
  ms: { movie: 'Tonton {title} dalam talian secara percuma', series: 'Tonton siri {title} secara percuma', episode: 'Tonton episod {title} secara percuma', movies: 'Tonton filem percuma', seriesList: 'Tonton siri percuma', discover: 'Temui filem dan siri percuma', catalog: 'Top 1000 filem dan siri percuma' },
  th: { movie: 'ดู{title}ออนไลน์ฟรี', series: 'ดูซีรีส์{title}ฟรี', episode: 'ดูตอน{title}ฟรี', movies: 'ดูหนังฟรีออนไลน์', seriesList: 'ดูซีรีส์ฟรีออนไลน์', discover: 'ค้นหาหนังและซีรีส์ฟรี', catalog: 'หนังและซีรีส์ยอดนิยม 1000 รายการฟรี' },
  ro: { movie: 'Urmărește {title} gratuit online', series: 'Urmărește serialul {title} gratuit', episode: 'Urmărește episodul {title} gratuit', movies: 'Urmărește filme gratuit', seriesList: 'Urmărește seriale gratuit', discover: 'Descoperă filme și seriale gratuite', catalog: 'Top 1000 filme și seriale gratuite' },
  hu: { movie: 'Nézd meg a(z) {title} című filmet ingyen', series: 'Nézd meg a(z) {title} sorozatot ingyen', episode: 'Nézd meg a(z) {title} epizódot ingyen', movies: 'Filmek ingyen online', seriesList: 'Sorozatok ingyen online', discover: 'Ingyenes filmek és sorozatok felfedezése', catalog: 'Top 1000 ingyenes film és sorozat' },
  el: { movie: 'Δείτε το {title} δωρεάν online', series: 'Δείτε τη σειρά {title} δωρεάν', episode: 'Δείτε το επεισόδιο {title} δωρεάν', movies: 'Δείτε ταινίες δωρεάν', seriesList: 'Δείτε σειρές δωρεάν', discover: 'Ανακαλύψτε δωρεάν ταινίες και σειρές', catalog: 'Top 1000 ταινίες και σειρές δωρεάν' },
  bn: { movie: '{title} বিনামূল্যে অনলাইনে দেখুন', series: '{title} সিরিজ বিনামূল্যে দেখুন', episode: '{title} পর্ব বিনামূল্যে দেখুন', movies: 'বিনামূল্যে সিনেমা দেখুন', seriesList: 'বিনামূল্যে সিরিজ দেখুন', discover: 'বিনামূল্যে সিনেমা ও সিরিজ খুঁজুন', catalog: 'সেরা ১০০০ সিনেমা ও সিরিজ বিনামূল্যে' },
  ur: { movie: '{title} مفت آن لائن دیکھیں', series: 'سیریز {title} مفت دیکھیں', episode: 'قسط {title} مفت دیکھیں', movies: 'فلمیں مفت دیکھیں', seriesList: 'سیریز مفت دیکھیں', discover: 'مفت فلمیں اور سیریز دریافت کریں', catalog: '1000 بہترین فلمیں اور سیریز مفت' },
  fa: { movie: '{title} را رایگان آنلاین تماشا کنید', series: 'سریال {title} را رایگان تماشا کنید', episode: 'قسمت {title} را رایگان تماشا کنید', movies: 'تماشای رایگان فیلم', seriesList: 'تماشای رایگان سریال', discover: 'کشف فیلم و سریال رایگان', catalog: '۱۰۰۰ فیلم و سریال برتر رایگان' },
};

const DETAIL_SEO_LABELS: Record<LocaleCode, { details: string; originalTitle: string; genres: string; cast: string; release: string; rating: string; runtime: string; status: string; countries: string; seasons: string; episodeCount: string; networks: string; related: string; allMovies: string; allSeries: string; discover: string; viewSeries: string }> = {
  ar: { details: 'تفاصيل العمل', originalTitle: 'العنوان الأصلي', genres: 'التصنيفات', cast: 'بطولة', release: 'تاريخ الإصدار', rating: 'التقييم', runtime: 'المدة', status: 'الحالة', countries: 'بلد الإنتاج', seasons: 'المواسم', episodeCount: 'عدد الحلقات', networks: 'الشبكات', related: 'استكشف المزيد', allMovies: 'كل الأفلام', allSeries: 'كل المسلسلات', discover: 'اكتشف المزيد', viewSeries: 'صفحة المسلسل' },
  en: { details: 'Movie and series information', originalTitle: 'Original title', genres: 'Genres', cast: 'Cast', release: 'Release date', rating: 'Rating', runtime: 'Runtime', status: 'Status', countries: 'Production countries', seasons: 'Seasons', episodeCount: 'Episodes', networks: 'Networks', related: 'Explore more', allMovies: 'Browse movies', allSeries: 'Browse series', discover: 'Discover titles', viewSeries: 'Series details' },
  fr: { details: 'Informations sur le film ou la série', originalTitle: 'Titre original', genres: 'Genres', cast: 'Distribution', release: 'Date de sortie', rating: 'Note', runtime: 'Durée', status: 'Statut', countries: 'Pays de production', seasons: 'Saisons', episodeCount: 'Épisodes', networks: 'Chaînes', related: 'À découvrir', allMovies: 'Voir les films', allSeries: 'Voir les séries', discover: 'Découvrir', viewSeries: 'Détails de la série' },
  de: { details: 'Film- und Serieninformationen', originalTitle: 'Originaltitel', genres: 'Genres', cast: 'Besetzung', release: 'Veröffentlichungsdatum', rating: 'Bewertung', runtime: 'Laufzeit', status: 'Status', countries: 'Produktionsländer', seasons: 'Staffeln', episodeCount: 'Episoden', networks: 'Sender', related: 'Mehr entdecken', allMovies: 'Filme ansehen', allSeries: 'Serien ansehen', discover: 'Titel entdecken', viewSeries: 'Seriendetails' },
  es: { details: 'Información de películas y series', originalTitle: 'Título original', genres: 'Géneros', cast: 'Reparto', release: 'Fecha de estreno', rating: 'Valoración', runtime: 'Duración', status: 'Estado', countries: 'Países de producción', seasons: 'Temporadas', episodeCount: 'Episodios', networks: 'Cadenas', related: 'Descubre más', allMovies: 'Ver películas', allSeries: 'Ver series', discover: 'Explorar títulos', viewSeries: 'Detalles de la serie' },
  it: { details: 'Informazioni su film e serie', originalTitle: 'Titolo originale', genres: 'Generi', cast: 'Cast', release: 'Data di uscita', rating: 'Valutazione', runtime: 'Durata', status: 'Stato', countries: 'Paesi di produzione', seasons: 'Stagioni', episodeCount: 'Episodi', networks: 'Reti', related: 'Scopri di più', allMovies: 'Film', allSeries: 'Serie TV', discover: 'Scopri titoli', viewSeries: 'Dettagli della serie' },
  pt: { details: 'Informações sobre filmes e séries', originalTitle: 'Título original', genres: 'Gêneros', cast: 'Elenco', release: 'Data de lançamento', rating: 'Avaliação', runtime: 'Duração', status: 'Estado', countries: 'Países de produção', seasons: 'Temporadas', episodeCount: 'Episódios', networks: 'Emissoras', related: 'Descubra mais', allMovies: 'Ver filmes', allSeries: 'Ver séries', discover: 'Explorar títulos', viewSeries: 'Detalhes da série' },
  ru: { details: 'Информация о фильме или сериале', originalTitle: 'Оригинальное название', genres: 'Жанры', cast: 'В ролях', release: 'Дата выхода', rating: 'Рейтинг', runtime: 'Продолжительность', status: 'Статус', countries: 'Страны производства', seasons: 'Сезоны', episodeCount: 'Эпизоды', networks: 'Телеканалы', related: 'Больше материалов', allMovies: 'Фильмы', allSeries: 'Сериалы', discover: 'Открыть подборку', viewSeries: 'Страница сериала' },
  tr: { details: 'Film ve dizi bilgileri', originalTitle: 'Orijinal ad', genres: 'Türler', cast: 'Oyuncular', release: 'Yayın tarihi', rating: 'Puan', runtime: 'Süre', status: 'Durum', countries: 'Yapım ülkeleri', seasons: 'Sezonlar', episodeCount: 'Bölümler', networks: 'Yayın ağları', related: 'Daha fazlasını keşfet', allMovies: 'Filmler', allSeries: 'Diziler', discover: 'İçerikleri keşfet', viewSeries: 'Dizi bilgileri' },
  hi: { details: 'फ़िल्म और सीरीज़ की जानकारी', originalTitle: 'मूल शीर्षक', genres: 'शैलियाँ', cast: 'कलाकार', release: 'रिलीज़ तारीख', rating: 'रेटिंग', runtime: 'अवधि', status: 'स्थिति', countries: 'निर्माण देश', seasons: 'सीज़न', episodeCount: 'एपिसोड', networks: 'नेटवर्क', related: 'और खोजें', allMovies: 'फ़िल्में देखें', allSeries: 'सीरीज़ देखें', discover: 'शीर्षक खोजें', viewSeries: 'सीरीज़ विवरण' },
  ja: { details: '映画・シリーズ情報', originalTitle: '原題', genres: 'ジャンル', cast: '出演者', release: '公開日', rating: '評価', runtime: '再生時間', status: '状態', countries: '制作国', seasons: 'シーズン数', episodeCount: 'エピソード数', networks: '放送局', related: 'さらに探す', allMovies: '映画一覧', allSeries: 'シリーズ一覧', discover: '作品を探す', viewSeries: 'シリーズ詳細' },
  ko: { details: '영화 및 시리즈 정보', originalTitle: '원제', genres: '장르', cast: '출연진', release: '공개일', rating: '평점', runtime: '상영 시간', status: '상태', countries: '제작 국가', seasons: '시즌 수', episodeCount: '에피소드 수', networks: '방송사', related: '더 알아보기', allMovies: '영화 보기', allSeries: '시리즈 보기', discover: '작품 찾기', viewSeries: '시리즈 정보' },
  zh: { details: '电影与剧集信息', originalTitle: '原名', genres: '类型', cast: '演员', release: '上映日期', rating: '评分', runtime: '时长', status: '状态', countries: '制作国家/地区', seasons: '季数', episodeCount: '集数', networks: '播出平台', related: '探索更多', allMovies: '浏览电影', allSeries: '浏览剧集', discover: '发现作品', viewSeries: '剧集详情' },
  nl: { details: 'Film- en serie-informatie', originalTitle: 'Originele titel', genres: 'Genres', cast: 'Cast', release: 'Releasedatum', rating: 'Beoordeling', runtime: 'Speelduur', status: 'Status', countries: 'Productielanden', seasons: 'Seizoenen', episodeCount: 'Afleveringen', networks: 'Omroepen', related: 'Ontdek meer', allMovies: 'Films bekijken', allSeries: 'Series bekijken', discover: 'Titels ontdekken', viewSeries: 'Seriegegevens' },
  sv: { details: 'Film- och serieinformation', originalTitle: 'Originaltitel', genres: 'Genrer', cast: 'Medverkande', release: 'Premiärdatum', rating: 'Betyg', runtime: 'Speltid', status: 'Status', countries: 'Produktionsländer', seasons: 'Säsonger', episodeCount: 'Avsnitt', networks: 'Kanaler', related: 'Upptäck mer', allMovies: 'Visa filmer', allSeries: 'Visa serier', discover: 'Upptäck titlar', viewSeries: 'Seriedetaljer' },
  da: { details: 'Film- og serieinformation', originalTitle: 'Originaltitel', genres: 'Genrer', cast: 'Medvirkende', release: 'Udgivelsesdato', rating: 'Bedømmelse', runtime: 'Spilletid', status: 'Status', countries: 'Produktionslande', seasons: 'Sæsoner', episodeCount: 'Afsnit', networks: 'Netværk', related: 'Udforsk mere', allMovies: 'Se film', allSeries: 'Se serier', discover: 'Find titler', viewSeries: 'Seriedetaljer' },
  no: { details: 'Film- og serieinformasjon', originalTitle: 'Originaltittel', genres: 'Sjangre', cast: 'Medvirkende', release: 'Utgivelsesdato', rating: 'Vurdering', runtime: 'Spilletid', status: 'Status', countries: 'Produksjonsland', seasons: 'Sesonger', episodeCount: 'Episoder', networks: 'Nettverk', related: 'Utforsk mer', allMovies: 'Se filmer', allSeries: 'Se serier', discover: 'Utforsk titler', viewSeries: 'Seriedetaljer' },
  fi: { details: 'Elokuva- ja sarjatiedot', originalTitle: 'Alkuperäinen nimi', genres: 'Tyylilajit', cast: 'Näyttelijät', release: 'Julkaisupäivä', rating: 'Arvio', runtime: 'Kesto', status: 'Tila', countries: 'Tuotantomaat', seasons: 'Kaudet', episodeCount: 'Jaksot', networks: 'Verkostot', related: 'Tutustu lisää', allMovies: 'Elokuvat', allSeries: 'Sarjat', discover: 'Tutustu nimikkeisiin', viewSeries: 'Sarjan tiedot' },
  pl: { details: 'Informacje o filmie lub serialu', originalTitle: 'Tytuł oryginalny', genres: 'Gatunki', cast: 'Obsada', release: 'Data premiery', rating: 'Ocena', runtime: 'Czas trwania', status: 'Status', countries: 'Kraje produkcji', seasons: 'Sezony', episodeCount: 'Odcinki', networks: 'Nadawcy', related: 'Odkryj więcej', allMovies: 'Filmy', allSeries: 'Seriale', discover: 'Odkryj tytuły', viewSeries: 'Szczegóły serialu' },
  cs: { details: 'Informace o filmu nebo seriálu', originalTitle: 'Původní název', genres: 'Žánry', cast: 'Obsazení', release: 'Datum vydání', rating: 'Hodnocení', runtime: 'Délka', status: 'Stav', countries: 'Země výroby', seasons: 'Řady', episodeCount: 'Epizody', networks: 'Vysílatelé', related: 'Objevte více', allMovies: 'Filmy', allSeries: 'Seriály', discover: 'Objevovat tituly', viewSeries: 'Podrobnosti seriálu' },
  uk: { details: 'Інформація про фільм або серіал', originalTitle: 'Оригінальна назва', genres: 'Жанри', cast: 'У ролях', release: 'Дата виходу', rating: 'Рейтинг', runtime: 'Тривалість', status: 'Статус', countries: 'Країни виробництва', seasons: 'Сезони', episodeCount: 'Епізоди', networks: 'Мережі', related: 'Досліджуйте далі', allMovies: 'Фільми', allSeries: 'Серіали', discover: 'Знайти твори', viewSeries: 'Деталі серіалу' },
  he: { details: 'מידע על סרטים וסדרות', originalTitle: 'שם מקורי', genres: 'ז׳אנרים', cast: 'שחקנים', release: 'תאריך יציאה', rating: 'דירוג', runtime: 'משך', status: 'סטטוס', countries: 'מדינות הפקה', seasons: 'עונות', episodeCount: 'פרקים', networks: 'רשתות שידור', related: 'לגלות עוד', allMovies: 'סרטים', allSeries: 'סדרות', discover: 'לגלות תכנים', viewSeries: 'פרטי הסדרה' },
  vi: { details: 'Thông tin phim và series', originalTitle: 'Tên gốc', genres: 'Thể loại', cast: 'Diễn viên', release: 'Ngày phát hành', rating: 'Đánh giá', runtime: 'Thời lượng', status: 'Trạng thái', countries: 'Quốc gia sản xuất', seasons: 'Mùa', episodeCount: 'Tập', networks: 'Mạng phát sóng', related: 'Khám phá thêm', allMovies: 'Xem phim', allSeries: 'Xem series', discover: 'Khám phá nội dung', viewSeries: 'Thông tin series' },
  id: { details: 'Informasi film dan serial', originalTitle: 'Judul asli', genres: 'Genre', cast: 'Pemeran', release: 'Tanggal rilis', rating: 'Rating', runtime: 'Durasi', status: 'Status', countries: 'Negara produksi', seasons: 'Musim', episodeCount: 'Episode', networks: 'Jaringan', related: 'Jelajahi lainnya', allMovies: 'Lihat film', allSeries: 'Lihat serial', discover: 'Jelajahi judul', viewSeries: 'Detail serial' },
  ms: { details: 'Maklumat filem dan siri', originalTitle: 'Tajuk asal', genres: 'Genre', cast: 'Pelakon', release: 'Tarikh keluaran', rating: 'Penilaian', runtime: 'Tempoh', status: 'Status', countries: 'Negara pengeluaran', seasons: 'Musim', episodeCount: 'Episod', networks: 'Rangkaian', related: 'Terokai lagi', allMovies: 'Lihat filem', allSeries: 'Lihat siri', discover: 'Terokai tajuk', viewSeries: 'Butiran siri' },
  th: { details: 'ข้อมูลภาพยนตร์และซีรีส์', originalTitle: 'ชื่อเรื่องต้นฉบับ', genres: 'ประเภท', cast: 'นักแสดง', release: 'วันเข้าฉาย', rating: 'คะแนน', runtime: 'ความยาว', status: 'สถานะ', countries: 'ประเทศผู้ผลิต', seasons: 'ซีซัน', episodeCount: 'ตอน', networks: 'เครือข่าย', related: 'ค้นหาเพิ่มเติม', allMovies: 'ดูภาพยนตร์', allSeries: 'ดูซีรีส์', discover: 'ค้นหาผลงาน', viewSeries: 'รายละเอียดซีรีส์' },
  ro: { details: 'Informații despre filme și seriale', originalTitle: 'Titlu original', genres: 'Genuri', cast: 'Distribuție', release: 'Data lansării', rating: 'Evaluare', runtime: 'Durată', status: 'Stare', countries: 'Țări de producție', seasons: 'Sezoane', episodeCount: 'Episoade', networks: 'Rețele', related: 'Descoperă mai mult', allMovies: 'Vezi filme', allSeries: 'Vezi seriale', discover: 'Descoperă titluri', viewSeries: 'Detalii serial' },
  hu: { details: 'Film- és sorozatinformációk', originalTitle: 'Eredeti cím', genres: 'Műfajok', cast: 'Szereplők', release: 'Megjelenés dátuma', rating: 'Értékelés', runtime: 'Játékidő', status: 'Állapot', countries: 'Gyártási országok', seasons: 'Évadok', episodeCount: 'Epizódok', networks: 'Hálózatok', related: 'Fedezz fel többet', allMovies: 'Filmek', allSeries: 'Sorozatok', discover: 'Címek felfedezése', viewSeries: 'Sorozat adatai' },
  el: { details: 'Πληροφορίες ταινιών και σειρών', originalTitle: 'Πρωτότυπος τίτλος', genres: 'Είδη', cast: 'Ηθοποιοί', release: 'Ημερομηνία κυκλοφορίας', rating: 'Βαθμολογία', runtime: 'Διάρκεια', status: 'Κατάσταση', countries: 'Χώρες παραγωγής', seasons: 'Σεζόν', episodeCount: 'Επεισόδια', networks: 'Δίκτυα', related: 'Εξερευνήστε περισσότερα', allMovies: 'Ταινίες', allSeries: 'Σειρές', discover: 'Ανακαλύψτε τίτλους', viewSeries: 'Λεπτομέρειες σειράς' },
  bn: { details: 'সিনেমা ও সিরিজের তথ্য', originalTitle: 'মূল শিরোনাম', genres: 'ধরন', cast: 'অভিনয়ে', release: 'মুক্তির তারিখ', rating: 'রেটিং', runtime: 'সময়কাল', status: 'অবস্থা', countries: 'প্রযোজনা দেশ', seasons: 'সিজন', episodeCount: 'পর্ব', networks: 'নেটওয়ার্ক', related: 'আরও দেখুন', allMovies: 'সিনেমা দেখুন', allSeries: 'সিরিজ দেখুন', discover: 'শিরোনাম খুঁজুন', viewSeries: 'সিরিজের বিবরণ' },
  ur: { details: 'فلموں اور سیریز کی معلومات', originalTitle: 'اصل عنوان', genres: 'اقسام', cast: 'اداکار', release: 'ریلیز کی تاریخ', rating: 'درجہ بندی', runtime: 'دورانیہ', status: 'حیثیت', countries: 'پروڈکشن ممالک', seasons: 'سیزن', episodeCount: 'اقساط', networks: 'نیٹ ورکس', related: 'مزید دریافت کریں', allMovies: 'فلمیں دیکھیں', allSeries: 'سیریز دیکھیں', discover: 'عنوانات دریافت کریں', viewSeries: 'سیریز کی تفصیل' },
  fa: { details: 'اطلاعات فیلم و سریال', originalTitle: 'عنوان اصلی', genres: 'ژانرها', cast: 'بازیگران', release: 'تاریخ انتشار', rating: 'امتیاز', runtime: 'مدت', status: 'وضعیت', countries: 'کشورهای تولیدکننده', seasons: 'فصل‌ها', episodeCount: 'قسمت‌ها', networks: 'شبکه‌ها', related: 'بیشتر کشف کنید', allMovies: 'فیلم‌ها', allSeries: 'سریال‌ها', discover: 'کشف آثار', viewSeries: 'جزئیات سریال' },
};

const freeTitle = (locale: LocaleCode, kind: 'movie' | 'series' | 'episode' | 'movies' | 'seriesList' | 'discover' | 'catalog', title = '') => {
  const template = FREE_SEO_TITLES[locale]?.[kind] || FREE_SEO_TITLES.en[kind];
  const label = template.replace('{title}', String(title || '').replace(/\s+/g, ' ').trim());
  return label.endsWith('| Movyza') ? label : `${label} | Movyza`;
};

const brandedHomepageTitle = (locale: LocaleCode) =>
  `Movyza — ${HOME_SEO[locale].title.replace(/\s*\|\s*Movyza\s*$/i, '').replace(/^Movyza\s*[—-]\s*/i, '')}`;

const localizedHtml = async (request: Request, env: MovyzEnvironment, response: Response, locale: LocaleCode) => {
  if (!response.headers.get('content-type')?.includes('text/html')) return response;
  const url = new URL(request.url);
  const route = stripLocale(url.pathname).pathname;
  const config = LOCALES[locale];

  let contentTitle = '';
  let alternateTitle = '';
  let description = '';
  let imageUrl = '';
  let schemaType = route === '/' ? 'WebSite' : 'WebPage';
  let ogType = 'website';
  let watchVideo: { embedUrl: string; uploadDate?: string; duration?: number } | null = null;
  let episodeDetails: { seriesData: any; episodeData: any; seasonData: any; seasonNumber: number; episodeNumber: number } | null = null;
  let detailSeoData: any = null;
  const detailMovie = route.match(/^\/movies\/(\d+)$/);
  const detailSeries = route.match(/^\/series\/(\d+)$/);
  const episodeInfo = route.match(/^\/episodes\/(\d+)\/(\d+)\/(\d+)$/);
  const watchMovie = route.match(/^\/watch\/movie\/(\d+)$/);
  const watchEpisode = route.match(/^\/watch\/(?:tv|series)\/(\d+)\/(\d+)\/(\d+)$/);
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
        const upstream = await fetch(`https://api.themoviedb.org/3/${type}/${id}?language=${encodeURIComponent(config.tmdb)}&append_to_response=credits,similar,recommendations`, {
          headers: tmdbHeaders(env),
        });
        const data = await upstream.json().catch(() => null) as any;
        detailSeoData = data;
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
  } else if (episodeInfo) {
    const id = Number(episodeInfo[1]);
    const seasonNumber = Number(episodeInfo[2]);
    const episodeNumber = Number(episodeInfo[3]);
    if (id && seasonNumber > 0 && episodeNumber > 0 && env.TMDB_API_READ_ACCESS_TOKEN) {
      try {
        const seriesUrl = new URL(`https://api.themoviedb.org/3/tv/${id}`);
        seriesUrl.searchParams.set('language', config.tmdb);
        seriesUrl.searchParams.set('append_to_response', 'credits,similar,recommendations');
        const seasonUrl = new URL(`https://api.themoviedb.org/3/tv/${id}/season/${seasonNumber}`);
        seasonUrl.searchParams.set('language', config.tmdb);
        const [seriesResponse, seasonResponse] = await Promise.all([
          fetch(seriesUrl.toString(), { headers: tmdbHeaders(env) }),
          fetch(seasonUrl.toString(), { headers: tmdbHeaders(env) }),
        ]);
        if (!seriesResponse.ok || !seasonResponse.ok) throw new Error('Episode metadata unavailable');
        const [seriesData, seasonData] = await Promise.all([seriesResponse.json(), seasonResponse.json()]) as [any, any];
        const episodeData = (seasonData?.episodes || []).find((item: any) => Number(item?.episode_number) === episodeNumber);
        if (!episodeData) throw new Error('Episode not found');
        const seriesName = seriesData?.name || seriesData?.original_name || `Series ${id}`;
        const episodeName = episodeData?.name || `Episode ${episodeNumber}`;
        contentTitle = `${seriesName} — ${episodeName} (S${seasonNumber} E${episodeNumber})`;
        alternateTitle = episodeData?.original_name || seriesData?.original_name || '';
        description = episodeData?.overview || seriesData?.overview || `${episodeName} from ${seriesName}, Season ${seasonNumber}, Episode ${episodeNumber}.`;
        imageUrl = episodeData?.still_path
          ? `https://image.tmdb.org/t/p/w1280${episodeData.still_path}`
          : (seriesData?.backdrop_path ? `https://image.tmdb.org/t/p/w1280${seriesData.backdrop_path}` : '');
        schemaType = 'TVEpisode';
        ogType = 'video.tv_show';
        episodeDetails = { seriesData, episodeData, seasonData, seasonNumber, episodeNumber };
      } catch {
        contentTitle = `Episode ${episodeNumber} | Movyza`;
        description = locale === 'ar' ? 'معلومات الحلقة وتاريخ عرضها وتفاصيل المسلسل.' : 'Episode information, air date, and series details.';
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

  const isWatchPage = route.startsWith('/watch/') || Boolean(watchMovie || watchEpisode);
  const noindexRoutes = [
    '/admin', '/profile', '/watchlist', '/history', '/login', '/register', '/forgot-password', '/search',
  ];
  const isPrivateOrSearchRoute = noindexRoutes.some((base) => route === base || route.startsWith(base + '/'));
  const isIndexableInfoRoute = route === '/' || ['/movies', '/series', '/discover', '/catalog', '/legal'].includes(route)
    || Boolean(detailMovie || detailSeries || episodeInfo);
  // Public information pages are indexable; every actual playback route remains noindex.
  const isNoIndex = isWatchPage || isPrivateOrSearchRoute || !isIndexableInfoRoute;
  const searchTitle = contentTitle || alternateTitle;
  const seoTitle = isWatchPage
    ? `${locale === 'ar' ? 'مشاهدة' : 'Watch'} ${searchTitle} | Movyza`
    : episodeInfo
      ? freeTitle(locale, 'episode', searchTitle)
      : detailMovie
        ? freeTitle(locale, 'movie', searchTitle)
        : detailSeries
          ? freeTitle(locale, 'series', searchTitle)
          : route === '/'
            ? brandedHomepageTitle(locale)
            : route === '/movies'
              ? freeTitle(locale, 'movies')
              : route === '/series'
                ? freeTitle(locale, 'seriesList')
                : route === '/discover'
                  ? freeTitle(locale, 'discover')
                  : route === '/catalog'
                    ? freeTitle(locale, 'catalog')
                    : (contentTitle.endsWith('| Movyza') ? contentTitle : `${contentTitle} | Movyza`);
  const hasExplicitLocale = Boolean(localeFromPath(url.pathname));
  const canonicalPath = route === '/' && !hasExplicitLocale ? '/' : `/${locale}${route === '/' ? '/' : route}`;
  const origin = url.origin;
  const hreflangLinks = !isNoIndex
    ? Object.entries(LOCALES)
        .map(([code, item]) => `<link rel="alternate" hreflang="${item.tmdb.toLowerCase()}" href="${origin}/${code}${route === '/' ? '/' : route}" />`)
        .join('')
    : '';
  const xDefault = !isNoIndex
    ? `<link rel="alternate" hreflang="x-default" href="${origin}/en${route === '/' ? '/' : route}" />`
    : '';
  const metaDescriptionSource = String(description || HOME_SEO[locale].description).replace(/\s+/g, ' ').trim();
  const metaDescriptionChars = Array.from(metaDescriptionSource);
  const metaDescription = metaDescriptionChars.length <= 155
    ? metaDescriptionSource
    : metaDescriptionChars.slice(0, 152).join('').replace(/\s+\S*$/u, '').trim() + '…';

  const toIsoDuration = (minutes: number) => {
    const totalSeconds = Math.max(0, Math.round(minutes * 60));
    if (!totalSeconds) return undefined;
    const hours = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    return `PT${hours ? hours + 'H' : ''}${mins ? mins + 'M' : ''}${secs ? secs + 'S' : ''}`;
  };

  const jsonLd = isWatchPage && watchVideo
    ? {
        '@context': 'https://schema.org',
        '@type': 'VideoObject',
        name: contentTitle,
        description,
        thumbnailUrl: imageUrl ? [imageUrl] : undefined,
        uploadDate: watchVideo.uploadDate || undefined,
        duration: toIsoDuration(Number(watchVideo.duration || 0)),
        embedUrl: watchVideo.embedUrl,
        url: origin + canonicalPath,
        inLanguage: locale,
        creator: { '@type': 'Organization', name: 'Movyza', url: origin, logo: { '@type': 'ImageObject', url: `${origin}/favicon.png` } },
      }
    : episodeDetails
      ? {
          '@context': 'https://schema.org',
          '@type': 'TVEpisode',
          name: episodeDetails.episodeData?.name || contentTitle,
          description,
          image: imageUrl ? [imageUrl] : undefined,
          datePublished: episodeDetails.episodeData?.air_date || undefined,
          episodeNumber: episodeDetails.episodeNumber,
          partOfSeason: { '@type': 'TVSeason', seasonNumber: episodeDetails.seasonNumber },
          partOfSeries: {
            '@type': 'TVSeries',
            name: episodeDetails.seriesData?.name || episodeDetails.seriesData?.original_name,
            url: origin + `/${locale}/series/${episodeInfo?.[1] || ''}`,
          },
          url: origin + canonicalPath,
          inLanguage: locale,
        }
      : {
          '@context': 'https://schema.org',
          '@type': schemaType,
          ...(route === '/' ? { '@id': 'https://movyza.sbs/#website', inLanguage: locale } : {}),
          name: route === '/' ? 'Movyza' : contentTitle,
          alternateName: route === '/' ? undefined : alternateTitle || undefined,
          image: imageUrl ? [imageUrl] : undefined,
          description,
          ...(detailSeoData?.genres?.length ? { genre: detailSeoData.genres.map((genre: any) => genre?.name).filter(Boolean) } : {}),
          ...(detailSeoData?.credits?.cast?.length ? { actor: detailSeoData.credits.cast.slice(0, 10).map((person: any) => ({ '@type': 'Person', name: person?.name })).filter((person: any) => person.name) } : {}),
          ...(detailSeoData?.release_date || detailSeoData?.first_air_date ? { datePublished: detailSeoData.release_date || detailSeoData.first_air_date } : {}),
          url: route === '/' ? 'https://movyza.sbs/' : origin + canonicalPath,
        };
  const subtitleLocale = detectSubtitleLocale(request);
  const injection = `<!-- movyz-seo -->` +
    `<meta name="movyz-country" content="${String(countryFromRequest(request) || 'XX').toUpperCase()}" />` +
    `<meta name="movyz-subtitle-language" content="${subtitleLocale}" />` +
    `<meta name="movyz-subtitle-priority" content="${subtitlePriorityForLanguage(subtitleLocale)}" />` +
    `<meta name="robots" content="${isNoIndex ? 'noindex,follow' : 'index,follow,max-image-preview:large'}" />` +
    `<meta property="og:site_name" content="Movyza" />` +
    `<meta name="application-name" content="Movyza" />` +
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
    `<script id="movyz-jsonld" type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`;
  const htmlLang = `<html lang="${locale}" dir="${config.dir}"`;


  // Crawlable content belongs only on the 33 intended homepage URLs.
  // Put it before </body> so it does not depend on the exact React mount markup.
  const HOME_SEO_INTRO: Record<LocaleCode, string> = {
    ar: 'اكتشف معلومات الأفلام والمسلسلات وتصنيفاتها وتواريخ إصدارها، واختر لغة التصفح التي تناسبك.',
    en: 'Explore movie and TV details, genres, release years, and new titles, then choose the language you prefer for browsing.',
    fr: 'Explorez les fiches des films et séries, les genres, les années de sortie et les nouveautés, puis choisissez votre langue de navigation.',
    de: 'Entdecke Filmdetails, Genres, Erscheinungsjahre und neue Titel und wähle die passende Sprache für die Navigation.',
    es: 'Explora fichas de películas y series, géneros, años de estreno y novedades, y elige el idioma que prefieras para navegar.',
    it: 'Esplora schede di film e serie, generi, anni di uscita e novità, quindi scegli la lingua che preferisci per navigare.',
    pt: 'Explore informações de filmes e séries, gêneros, anos de lançamento e novidades, e escolha o idioma que preferir para navegar.',
    ru: 'Изучайте информацию о фильмах и сериалах, жанры, годы выхода и новинки, а также выбирайте удобный язык интерфейса.',
    tr: 'Film ve dizi bilgilerini, türleri, yayın yıllarını ve yeni yapımları keşfedin; gezinmek için tercih ettiğiniz dili seçin.',
    hi: 'फ़िल्मों और सीरीज़ के विवरण, शैली, रिलीज़ वर्ष और नई रिलीज़ खोजें, और ब्राउज़ करने के लिए अपनी पसंदीदा भाषा चुनें।',
    ja: '映画やシリーズの作品情報、ジャンル、公開年、新作を調べ、使いやすい表示言語を選べます。',
    ko: '영화와 시리즈의 작품 정보, 장르, 공개 연도와 신작을 살펴보고 편한 표시 언어를 선택하세요.',
    zh: '查看电影和剧集的作品资料、类型、上映年份和新作，并选择适合自己的浏览语言。',
    nl: 'Bekijk informatie over films en series, genres, releasejaren en nieuwe titels, en kies de taal waarin je wilt browsen.',
    sv: 'Utforska information om filmer och serier, genrer, premiärår och nya titlar och välj ditt föredragna språk.',
    da: 'Udforsk information om film og serier, genrer, udgivelsesår og nye titler, og vælg det sprog, du foretrækker.',
    no: 'Utforsk informasjon om filmer og serier, sjangre, utgivelsesår og nye titler, og velg språket du foretrekker.',
    fi: 'Tutustu elokuvien ja sarjojen tietoihin, genreihin, julkaisuvuosiin ja uutuuksiin sekä valitse haluamasi käyttöliittymän kieli.',
    pl: 'Poznawaj informacje o filmach i serialach, gatunki, lata premier i nowości, a następnie wybierz preferowany język.',
    cs: 'Prohlížejte si informace o filmech a seriálech, žánry, roky vydání a novinky a vyberte si preferovaný jazyk.',
    uk: 'Переглядайте інформацію про фільми й серіали, жанри, роки виходу та новинки й обирайте зручну мову.',
    he: 'גלו פרטים על סרטים וסדרות, ז׳אנרים, שנות יציאה ותכנים חדשים ובחרו את שפת הגלישה המועדפת עליכם.',
    vi: 'Khám phá thông tin phim và series, thể loại, năm phát hành và nội dung mới, đồng thời chọn ngôn ngữ duyệt phù hợp.',
    id: 'Jelajahi informasi film dan serial, genre, tahun rilis, dan judul terbaru, lalu pilih bahasa yang paling nyaman untuk digunakan.',
    ms: 'Terokai maklumat filem dan siri, genre, tahun keluaran dan tajuk baharu, kemudian pilih bahasa pilihan anda.',
    th: 'สำรวจข้อมูลภาพยนตร์และซีรีส์ ประเภท ปีที่ออกฉาย และเรื่องใหม่ พร้อมเลือกภาษาที่ต้องการใช้',
    ro: 'Explorează informații despre filme și seriale, genuri, ani de lansare și titluri noi, apoi alege limba preferată.',
    hu: 'Fedezd fel a filmek és sorozatok adatait, műfajait, megjelenési éveit és újdonságait, majd válaszd ki a kívánt nyelvet.',
    el: 'Εξερευνήστε πληροφορίες για ταινίες και σειρές, είδη, έτη κυκλοφορίας και νέους τίτλους και επιλέξτε τη γλώσσα σας.',
    bn: 'সিনেমা ও সিরিজের তথ্য, ধরন, মুক্তির বছর এবং নতুন শিরোনাম দেখুন, তারপর পছন্দের ভাষা বেছে নিন।',
    ur: 'فلموں اور سیریز کی معلومات، اصناف، ریلیز کے سال اور نئی پیشکشیں دیکھیں، پھر اپنی پسند کی زبان منتخب کریں۔',
    fa: 'اطلاعات فیلم‌ها و سریال‌ها، ژانرها، سال انتشار و آثار تازه را بررسی کنید و زبان دلخواه خود را انتخاب کنید.',
  };

  const HOME_SEO_DETAILS: Record<LocaleCode, string> = {
    ar: 'تعرّف على نبذة كل عمل وسنة إصداره وتصنيفاته وتقييمه عندما تكون هذه المعلومات متاحة. تساعدك صفحات اللغة على استخدام الموقع بلغتك، بينما تتيح لك صفحات العناوين الاطلاع على تفاصيل كل فيلم أو مسلسل قبل اختيار ما يناسبك.',
    en: 'Each title page presents available details such as a synopsis, release year, genres, and rating. Use the language links to browse Movyza in your preferred language, then open a title page to review its information before deciding what to explore next.',
    fr: 'Chaque fiche présente les informations disponibles, comme le synopsis, l’année de sortie, les genres et la note. Utilisez les liens linguistiques pour parcourir Movyza dans votre langue, puis consultez la fiche d’un titre pour en découvrir les détails.',
    de: 'Jede Titelseite zeigt verfügbare Angaben wie Zusammenfassung, Erscheinungsjahr, Genres und Bewertung. Über die Sprachlinks kannst du Movyza in deiner bevorzugten Sprache nutzen und anschließend die Informationen zu einem Film oder einer Serie ansehen.',
    es: 'Cada ficha incluye los datos disponibles, como sinopsis, año de estreno, géneros y valoración. Usa los enlaces de idioma para navegar por Movyza en tu lengua y consulta después la ficha de cada título para conocer sus detalles.',
    it: 'Ogni scheda mostra le informazioni disponibili, come trama, anno di uscita, generi e valutazione. Usa i collegamenti alle lingue per visitare Movyza nella tua lingua e consulta poi la scheda del titolo per conoscerne i dettagli.',
    pt: 'Cada página de título apresenta os dados disponíveis, como sinopse, ano de lançamento, gêneros e classificação. Use os links de idioma para navegar no Movyza na sua língua e consulte a ficha de cada obra para conhecer os detalhes.',
    ru: 'На странице каждого произведения указаны доступные сведения: описание, год выпуска, жанры и рейтинг. Перейдите по ссылке на нужный язык, чтобы пользоваться Movyza на удобном языке, и изучите информацию о фильме или сериале.',
    tr: 'Her yapım sayfasında özet, yayın yılı, türler ve puan gibi mevcut bilgiler bulunur. Movyza’yı tercih ettiğiniz dilde kullanmak için dil bağlantılarını seçin ve bir film ya da dizinin ayrıntılarını inceleyin.',
    hi: 'हर शीर्षक के पेज पर उपलब्ध जानकारी, जैसे सारांश, रिलीज़ वर्ष, शैली और रेटिंग दिखाई जाती है। अपनी पसंदीदा भाषा में Movyza देखने के लिए भाषा लिंक चुनें और किसी फ़िल्म या सीरीज़ के विवरण पढ़ें।',
    ja: '各作品ページでは、あらすじ、公開年、ジャンル、評価など、利用可能な情報を確認できます。言語リンクから希望する言語を選び、映画やシリーズの詳細を見て作品を探してください。',
    ko: '각 작품 페이지에서 줄거리, 공개 연도, 장르, 평점 등 제공되는 정보를 확인할 수 있습니다. 언어 링크에서 원하는 언어를 선택하고 영화나 시리즈의 상세 정보를 살펴보세요.',
    zh: '每个作品页面都会展示可用信息，例如简介、上映年份、类型和评分。使用语言链接切换到熟悉的语言，再查看电影或剧集的详细资料，帮助你了解作品。',
    nl: 'Elke titelpagina toont beschikbare gegevens zoals een samenvatting, releasejaar, genres en beoordeling. Gebruik de taallinks om Movyza in je voorkeurstaal te bekijken en lees daarna de gegevens van een film of serie.',
    sv: 'Varje titelsida visar tillgänglig information, till exempel sammanfattning, premiärår, genrer och betyg. Använd språklänkarna för att besöka Movyza på ditt språk och läs sedan detaljerna om en film eller serie.',
    da: 'Hver titelside viser tilgængelige oplysninger som resumé, udgivelsesår, genrer og bedømmelse. Brug sproglinksene til at besøge Movyza på dit foretrukne sprog, og læs derefter oplysningerne om en film eller serie.',
    no: 'Hver tittelside viser tilgjengelig informasjon som sammendrag, utgivelsesår, sjangre og vurdering. Bruk språklenkene for å besøke Movyza på språket ditt, og les deretter detaljene om en film eller serie.',
    fi: 'Jokaisella nimikesivulla näytetään saatavilla olevia tietoja, kuten tiivistelmä, julkaisuvuosi, lajityypit ja arvosana. Valitse kielilinkeistä haluamasi kieli ja tutustu elokuvan tai sarjan tietoihin.',
    pl: 'Każda strona tytułu przedstawia dostępne informacje, takie jak opis, rok premiery, gatunki i ocena. Skorzystaj z odnośników językowych, aby przeglądać Movyza w swoim języku, a następnie sprawdź szczegóły filmu lub serialu.',
    cs: 'Stránka každého titulu uvádí dostupné informace, například synopsi, rok vydání, žánry a hodnocení. Pomocí jazykových odkazů si otevřete Movyza ve svém jazyce a poté si prohlédněte podrobnosti filmu nebo seriálu.',
    uk: 'На сторінці кожного твору наведено доступні відомості: опис, рік виходу, жанри та рейтинг. Скористайтеся мовними посиланнями, щоб переглядати Movyza зручною мовою, а потім прочитайте деталі фільму чи серіалу.',
    he: 'בכל עמוד יצירה מופיעים פרטים זמינים כגון תקציר, שנת יציאה, ז׳אנרים ודירוג. השתמשו בקישורי השפה כדי לגלוש ב‑Movyza בשפה המועדפת עליכם, ואז עיינו בפרטי הסרט או הסדרה.',
    vi: 'Mỗi trang tác phẩm hiển thị thông tin hiện có như tóm tắt, năm phát hành, thể loại và điểm đánh giá. Hãy dùng liên kết ngôn ngữ để duyệt Movyza bằng ngôn ngữ bạn thích, rồi xem chi tiết phim hoặc series.',
    id: 'Setiap halaman judul menampilkan informasi yang tersedia seperti sinopsis, tahun rilis, genre, dan rating. Gunakan tautan bahasa untuk menjelajahi Movyza dalam bahasa pilihan Anda, lalu baca detail film atau serial yang ingin diketahui.',
    ms: 'Setiap halaman tajuk memaparkan maklumat yang tersedia seperti sinopsis, tahun keluaran, genre dan penilaian. Gunakan pautan bahasa untuk melayari Movyza dalam bahasa pilihan anda, kemudian semak butiran filem atau siri.',
    th: 'หน้าแต่ละเรื่องจะแสดงข้อมูลที่มี เช่น เรื่องย่อ ปีที่ออกฉาย ประเภท และคะแนน เลือกลิงก์ภาษาเพื่อใช้งาน Movyza ในภาษาที่ต้องการ แล้วอ่านรายละเอียดของภาพยนตร์หรือซีรีส์เพิ่มเติม',
    ro: 'Fiecare pagină de titlu prezintă informațiile disponibile, precum rezumatul, anul lansării, genurile și ratingul. Folosește linkurile de limbă pentru a naviga pe Movyza în limba preferată și consultă detaliile fiecărui film sau serial.',
    hu: 'Minden adatlap megjeleníti az elérhető információkat, például az ismertetőt, a megjelenés évét, a műfajokat és az értékelést. A nyelvi hivatkozásokkal a kívánt nyelven böngészhetsz, majd elolvashatod a film vagy sorozat adatait.',
    el: 'Κάθε σελίδα τίτλου παρουσιάζει τις διαθέσιμες πληροφορίες, όπως σύνοψη, έτος κυκλοφορίας, είδη και βαθμολογία. Χρησιμοποιήστε τους συνδέσμους γλώσσας για να περιηγηθείτε στο Movyza στη γλώσσα σας και δείτε τα στοιχεία κάθε έργου.',
    bn: 'প্রতিটি শিরোনামের পাতায় উপলভ্য তথ্য, যেমন সারাংশ, মুক্তির বছর, ধরন ও রেটিং দেখানো হয়। নিজের পছন্দের ভাষায় Movyza ব্যবহার করতে ভাষার লিংক বেছে নিন এবং সিনেমা বা সিরিজের বিস্তারিত পড়ুন।',
    ur: 'ہر عنوان کے صفحے پر دستیاب معلومات، مثلاً خلاصہ، ریلیز کا سال، اصناف اور درجہ بندی دکھائی جاتی ہے۔ اپنی پسند کی زبان میں Movyza دیکھنے کے لیے زبان کے روابط استعمال کریں اور فلم یا سیریز کی تفصیلات پڑھیں۔',
    fa: 'در صفحه هر عنوان، اطلاعات موجود مانند خلاصه، سال انتشار، ژانرها و امتیاز نمایش داده می‌شود. برای مرور Movyza به زبان دلخواه از پیوندهای زبان استفاده کنید و سپس جزئیات فیلم یا سریال را بخوانید.',
  };


  const HOME_SEO_GUIDANCE: Record<LocaleCode, string> = {
    ar: 'ابدأ بالبحث عن اسم العمل، ثم راجع صفحته لمعرفة التفاصيل المتاحة. روابط اللغة تنقلك إلى الصفحة الرئيسية باللغة التي تختارها.',
    en: 'Start by searching for a title, then open its page to review the available details. Language links take you to the homepage in your chosen language.',
    fr: 'Recherchez un titre, puis ouvrez sa fiche pour consulter les informations disponibles. Les liens linguistiques mènent à l’accueil dans la langue choisie.',
    de: 'Suche nach einem Titel und öffne seine Seite, um verfügbare Angaben zu lesen. Die Sprachlinks führen zur Startseite in deiner gewählten Sprache.',
    es: 'Busca un título y abre su ficha para consultar los datos disponibles. Los enlaces de idioma llevan a la página de inicio en la lengua elegida.',
    it: 'Cerca un titolo e apri la relativa scheda per consultare le informazioni disponibili. I link linguistici portano alla homepage nella lingua scelta.',
    pt: 'Pesquise um título e abra sua página para consultar as informações disponíveis. Os links de idioma levam à página inicial no idioma escolhido.',
    ru: 'Найдите название и откройте его страницу, чтобы изучить доступные сведения. Ссылки на языки ведут на главную страницу на выбранном языке.',
    tr: 'Bir başlık arayın ve mevcut bilgileri incelemek için sayfasını açın. Dil bağlantıları sizi seçtiğiniz dildeki ana sayfaya götürür.',
    hi: 'किसी शीर्षक को खोजें और उपलब्ध जानकारी देखने के लिए उसका पेज खोलें। भाषा लिंक आपके चुने हुए भाषा के होमपेज पर ले जाते हैं।',
    ja: '作品名を検索して詳細ページを開くと、利用可能な情報を確認できます。言語リンクは選択した言語のホームページにつながります。',
    ko: '작품명을 검색한 뒤 상세 페이지를 열어 제공되는 정보를 확인하세요. 언어 링크는 선택한 언어의 홈페이지로 연결됩니다.',
    zh: '搜索作品名称并打开详情页，即可查看可用信息。语言链接会带你前往所选语言的首页。',
    nl: 'Zoek een titel en open de pagina om beschikbare informatie te bekijken. De taallinks leiden naar de homepage in de gekozen taal.',
    sv: 'Sök efter en titel och öppna sidan för tillgänglig information. Språklänkarna leder till startsidan på det valda språket.',
    da: 'Søg efter en titel, og åbn siden for at se tilgængelige oplysninger. Sproglinksene fører til startsiden på det valgte sprog.',
    no: 'Søk etter en tittel og åpne siden for tilgjengelig informasjon. Språklenkene fører til startsiden på det valgte språket.',
    fi: 'Etsi nimike ja avaa sen sivu nähdäksesi saatavilla olevat tiedot. Kielilinkit vievät etusivulle valitsemallasi kielellä.',
    pl: 'Wyszukaj tytuł i otwórz jego stronę, aby sprawdzić dostępne informacje. Odnośniki językowe prowadzą do strony głównej w wybranym języku.',
    cs: 'Vyhledejte titul a otevřete jeho stránku, kde najdete dostupné informace. Jazykové odkazy vedou na domovskou stránku ve zvoleném jazyce.',
    uk: 'Знайдіть назву та відкрийте її сторінку, щоб переглянути доступні відомості. Мовні посилання ведуть на головну сторінку обраною мовою.',
    he: 'חפשו כותרת ופתחו את העמוד שלה כדי לעיין במידע הזמין. קישורי השפה מובילים לעמוד הבית בשפה שבחרתם.',
    vi: 'Tìm tên tác phẩm rồi mở trang chi tiết để xem thông tin hiện có. Liên kết ngôn ngữ sẽ đưa bạn đến trang chủ bằng ngôn ngữ đã chọn.',
    id: 'Cari judul dan buka halamannya untuk melihat informasi yang tersedia. Tautan bahasa mengarah ke beranda dalam bahasa pilihan Anda.',
    ms: 'Cari tajuk dan buka halamannya untuk melihat maklumat yang tersedia. Pautan bahasa membawa anda ke halaman utama dalam bahasa pilihan.',
    th: 'ค้นหาชื่อเรื่องแล้วเปิดหน้ารายละเอียดเพื่อดูข้อมูลที่มี ลิงก์ภาษาจะพาไปยังหน้าแรกในภาษาที่เลือก',
    ro: 'Caută un titlu și deschide pagina sa pentru informațiile disponibile. Linkurile de limbă duc la pagina principală în limba aleasă.',
    hu: 'Keress rá a címre, majd nyisd meg az adatlapját az elérhető információkért. A nyelvi linkek a kiválasztott nyelvű kezdőlapra vezetnek.',
    el: 'Αναζητήστε έναν τίτλο και ανοίξτε τη σελίδα του για τις διαθέσιμες πληροφορίες. Οι σύνδεσμοι γλώσσας οδηγούν στην αρχική σελίδα της επιλογής σας.',
    bn: 'শিরোনাম খুঁজে তার পাতা খুলুন এবং উপলভ্য তথ্য দেখুন। ভাষার লিংক আপনার নির্বাচিত ভাষার হোমপেজে নিয়ে যায়।',
    ur: 'عنوان تلاش کریں اور دستیاب معلومات دیکھنے کے لیے اس کا صفحہ کھولیں۔ زبان کے روابط آپ کی منتخب کردہ زبان کے ہوم پیج پر لے جاتے ہیں۔',
    fa: 'عنوان را جست‌وجو کنید و برای دیدن اطلاعات موجود صفحه آن را باز کنید. پیوندهای زبان به صفحه اصلی زبان انتخابی شما می‌روند.',
  };

  const HOME_LANGUAGE_LABEL: Record<LocaleCode, string> = {
    ar: 'اختر لغة الموقع', en: 'Choose your language', fr: 'Choisissez votre langue', de: 'Sprache auswählen',
    es: 'Elige tu idioma', it: 'Scegli la lingua', pt: 'Escolha seu idioma', ru: 'Выберите язык',
    tr: 'Dilinizi seçin', hi: 'अपनी भाषा चुनें', ja: '言語を選択', ko: '언어 선택', zh: '选择语言',
    nl: 'Kies je taal', sv: 'Välj språk', da: 'Vælg sprog', no: 'Velg språk', fi: 'Valitse kieli',
    pl: 'Wybierz język', cs: 'Vyberte jazyk', uk: 'Виберіть мову', he: 'בחרו שפה', vi: 'Chọn ngôn ngữ',
    id: 'Pilih bahasa', ms: 'Pilih bahasa', th: 'เลือกภาษา', ro: 'Alege limba', hu: 'Válassz nyelvet',
    el: 'Επιλέξτε γλώσσα', bn: 'ভাষা নির্বাচন করুন', ur: 'اپنی زبان منتخب کریں', fa: 'زبان خود را انتخاب کنید',
  };
  const languageLinks = Object.entries(LOCALES)
    .map(([code, item]) =>
      '<a href="' + origin + '/' + code + '/" hreflang="' + item.tmdb.toLowerCase() +
      '" lang="' + code + '" style="color:#fbbf24;text-decoration:none;padding:6px 9px;border:1px solid #3f3f46;border-radius:8px;font-size:13px;line-height:1.5">' +
      escapeXml(item.nativeName) + '</a>',
    )
    .join('');
  const crawlableBody = !isNoIndex && route === '/'
    ? '<section id="movyza-seo-content" dir="' + config.dir + '" aria-label="' + escapeXml(HOME_SEO[locale].title) +
      '" style="max-width:1160px;margin:28px auto 18px;padding:24px 20px;border-top:1px solid #27272a;color:#e4e4e7;font-family:inherit">' +
        '<h1 style="margin:0 0 12px;font-size:clamp(22px,3vw,32px);line-height:1.35;font-weight:700;color:#fafafa">' +
          escapeXml(HOME_SEO[locale].title) + '</h1>' +
        '<p style="max-width:900px;margin:0 0 10px;color:#a1a1aa;font-size:15px;line-height:1.9">' +
          escapeXml(HOME_SEO[locale].description) + '</p>' +
        '<p style="max-width:900px;margin:0 0 10px;color:#a1a1aa;font-size:15px;line-height:1.9">' +
          escapeXml(HOME_SEO_INTRO[locale]) + '</p>' +
        '<section style="max-width:900px;margin-top:18px">' +
          '<h2 style="margin:0 0 8px;color:#fafafa;font-size:18px;font-weight:600">' + escapeXml(HOME_SEO[locale].title) + '</h2>' +
          '<p style="margin:0 0 10px;color:#a1a1aa;font-size:15px;line-height:1.9">' + escapeXml(HOME_SEO_DETAILS[locale]) + '</p>' +
          '<p style="margin:0;color:#a1a1aa;font-size:15px;line-height:1.9">' + escapeXml(HOME_SEO_GUIDANCE[locale]) + '</p>' +
        '</section>' +
        '<nav style="margin-top:20px" aria-label="' + escapeXml(HOME_LANGUAGE_LABEL[locale]) + '">' +
          '<h2 style="margin:0 0 10px;color:#fafafa;font-size:16px;font-weight:600">' +
            escapeXml(HOME_LANGUAGE_LABEL[locale]) + '</h2>' +
          '<div style="display:flex;flex-wrap:wrap;gap:8px">' + languageLinks + '</div>' +
        '</nav>' +
      '</section>'
    : '';

  const detailContentBody = !isNoIndex && (detailMovie || detailSeries || episodeInfo)
    ? (() => {
        const labels = DETAIL_SEO_LABELS[locale];
        const isEpisodePage = Boolean(episodeInfo);
        const seriesForEpisode = episodeDetails?.seriesData;
        const episodeForPage = episodeDetails?.episodeData;
        const sourceData = isEpisodePage ? seriesForEpisode : detailSeoData;
        const castNames = (sourceData?.credits?.cast || sourceData?.aggregate_credits?.cast || [])
          .slice(0, 8).map((person: any) => String(person?.name || '').trim()).filter(Boolean);
        const genreNames = (sourceData?.genres || []).map((genre: any) => String(genre?.name || '').trim()).filter(Boolean);
        const original = String(isEpisodePage ? (seriesForEpisode?.original_name || '') : alternateTitle || '').trim();
        const releaseDate = String(isEpisodePage ? (episodeForPage?.air_date || '') : (detailSeoData?.release_date || detailSeoData?.first_air_date || '')).trim();
        const vote = Number((isEpisodePage ? episodeForPage?.vote_average : sourceData?.vote_average) || 0);
        const overview = String(isEpisodePage ? (episodeForPage?.overview || seriesForEpisode?.overview || description) : description || '').trim();
        const pageTitle = String(contentTitle).trim();
        const row = (label: string, value: string) => value
          ? '<div style="display:flex;flex-wrap:wrap;gap:8px;margin:7px 0"><dt style="font-weight:650;color:#f4f4f5">' + escapeXml(label) +
            '</dt><dd style="margin:0;color:#d4d4d8">' + escapeXml(value) + '</dd></div>'
          : '';
        const relatedHref = isEpisodePage
          ? '/' + locale + '/series/' + String(episodeInfo?.[1] || '')
          : detailMovie
            ? '/' + locale + '/movies'
            : '/' + locale + '/series';
        const relatedLabel = isEpisodePage ? labels.viewSeries : detailMovie ? labels.allMovies : labels.allSeries;
        const castBlock = castNames.length
          ? '<p style="margin:12px 0;color:#d4d4d8;line-height:1.8"><strong style="color:#f4f4f5">' + escapeXml(labels.cast) +
            ':</strong> ' + castNames.map(escapeXml).join(', ') + '</p>'
          : '';
        const genresBlock = genreNames.length ? row(labels.genres, genreNames.join(', ')) : '';
        const dateBlock = releaseDate ? row(labels.release, releaseDate) : '';
        const ratingBlock = Number.isFinite(vote) && vote > 0 ? row(labels.rating, vote.toFixed(1) + '/10') : '';
        const originalBlock = original && original !== pageTitle ? row(labels.originalTitle, original) : '';
        const runtimeMinutes = Number(isEpisodePage
          ? (episodeForPage?.runtime || seriesForEpisode?.episode_run_time?.[0] || 0)
          : detailMovie
            ? (detailSeoData?.runtime || 0)
            : (detailSeoData?.episode_run_time?.[0] || 0));
        const runtimeBlock = runtimeMinutes > 0 ? row(labels.runtime, Math.round(runtimeMinutes) + ' min') : '';
        const metadataSource = isEpisodePage ? seriesForEpisode : detailSeoData;
        const statusValue = String(metadataSource?.status || '').trim();
        const statusBlock = statusValue ? row(labels.status, statusValue) : '';
        const productionCountryNames = (metadataSource?.production_countries || [])
          .map((country: any) => String(country?.name || '').trim()).filter(Boolean);
        const countryNames = productionCountryNames.length
          ? productionCountryNames
          : (metadataSource?.origin_country || []).map((country: any) => String(country || '').trim()).filter(Boolean);
        const countriesBlock = countryNames.length ? row(labels.countries, countryNames.join(', ')) : '';
        const seasonCount = Number(metadataSource?.number_of_seasons || 0);
        const episodeCount = Number(metadataSource?.number_of_episodes || 0);
        const seasonsBlock = seasonCount > 0 ? row(labels.seasons, String(seasonCount)) : '';
        const episodeCountBlock = episodeCount > 0 ? row(labels.episodeCount, String(episodeCount)) : '';
        const networkNames = (metadataSource?.networks || [])
          .map((network: any) => String(network?.name || '').trim()).filter(Boolean);
        const networksBlock = networkNames.length ? row(labels.networks, networkNames.join(', ')) : '';
        const relatedLinkItems: string[] = [];
        if (isEpisodePage && episodeInfo && episodeDetails?.seasonData?.episodes) {
          const seasonEpisodes = [...episodeDetails.seasonData.episodes]
            .sort((a: any, b: any) => Number(a?.episode_number || 0) - Number(b?.episode_number || 0));
          const currentEpisodeIndex = seasonEpisodes.findIndex(
            (item: any) => Number(item?.episode_number || 0) === Number(episodeInfo[3]),
          );
          const adjacentEpisodes = [
            currentEpisodeIndex > 0 ? seasonEpisodes[currentEpisodeIndex - 1] : null,
            currentEpisodeIndex >= 0 ? seasonEpisodes[currentEpisodeIndex + 1] : null,
          ].filter(Boolean);
          const seriesId = Number(episodeInfo[1]);
          for (const adjacent of adjacentEpisodes as any[]) {
            const adjacentNumber = Number(adjacent?.episode_number || 0);
            const adjacentTitle = String(adjacent?.name || '').trim();
            if (!seriesId || adjacentNumber < 1 || !adjacentTitle) continue;
            relatedLinkItems.push(
              '<a href="/' + locale + '/episodes/' + seriesId + '/' + episodeDetails.seasonNumber + '/' + adjacentNumber +
              '" style="color:#fbbf24;text-decoration:underline;text-underline-offset:4px">' +
              escapeXml('S' + episodeDetails.seasonNumber + ' E' + adjacentNumber + ' — ' + adjacentTitle) + '</a>',
            );
          }
        }
        const relatedCandidates = [
          ...(metadataSource?.recommendations?.results || []),
          ...(metadataSource?.similar?.results || []),
        ];
        const relatedIds = new Set<number>([Number((detailMovie || detailSeries || episodeInfo)?.[1] || 0)]);
        const relatedRoute = detailMovie ? 'movies' : 'series';
        for (const item of relatedCandidates) {
          if (relatedLinkItems.length >= 6) break;
          const relatedId = Number(item?.id || 0);
          const relatedTitle = String(item?.title || item?.name || '').trim();
          if (!relatedId || relatedIds.has(relatedId) || !relatedTitle) continue;
          relatedIds.add(relatedId);
          relatedLinkItems.push(
            '<a href="/' + locale + '/' + relatedRoute + '/' + relatedId +
            '" style="color:#fbbf24;text-decoration:underline;text-underline-offset:4px">' +
            escapeXml(relatedTitle) + '</a>',
          );
        }
        const relatedLinksBlock = relatedLinkItems.length
          ? '<section aria-label="' + escapeXml(labels.related) +
            '" style="margin-top:18px"><h2 style="margin:0 0 10px;color:#fafafa;font-size:18px;font-weight:600">' +
            escapeXml(labels.related) + '</h2><div style="display:flex;flex-wrap:wrap;gap:12px">' +
            relatedLinkItems.join('') + '</div></section>'
          : '';
        const poster = imageUrl
          ? '<img src="' + escapeXml(imageUrl) + '" alt="' + escapeXml(pageTitle) + '" loading="lazy" decoding="async" style="width:min(100%,220px);max-height:320px;object-fit:cover;border-radius:12px;border:1px solid #3f3f46" />'
          : '';
        return '<section id="movyza-indexable-details" lang="' + locale + '" dir="' + config.dir + '" aria-label="' + escapeXml(labels.details) +
          '" style="max-width:1160px;margin:26px auto 18px;padding:24px 20px;border-top:1px solid #27272a;color:#e4e4e7;font-family:inherit">' +
          '<div style="display:flex;flex-wrap:wrap;gap:22px;align-items:flex-start">' +
          (poster ? '<figure style="margin:0;flex:0 0 180px">' + poster + '</figure>' : '') +
          '<article style="flex:1;min-width:min(100%,280px)">' +
          '<h1 style="margin:0 0 14px;font-size:clamp(22px,3vw,32px);line-height:1.35;font-weight:700;color:#fafafa">' + escapeXml(pageTitle) + '</h1>' +
          '<p style="max-width:900px;margin:0 0 14px;color:#d4d4d8;font-size:15px;line-height:1.9">' + escapeXml(overview) + '</p>' +
          castBlock +
          '<dl style="margin:12px 0;font-size:14px;line-height:1.7">' + originalBlock + genresBlock + dateBlock + ratingBlock + runtimeBlock + statusBlock + countriesBlock + seasonsBlock + episodeCountBlock + networksBlock + '</dl>' +
          '<nav aria-label="' + escapeXml(labels.related) + '" style="display:flex;flex-wrap:wrap;gap:10px;margin-top:18px">' +
          '<a href="' + escapeXml(relatedHref) + '" style="color:#fbbf24;text-decoration:underline;text-underline-offset:4px">' + escapeXml(relatedLabel) + '</a>' +
          '<a href="/' + locale + '/discover" style="color:#fbbf24;text-decoration:underline;text-underline-offset:4px">' + escapeXml(labels.discover) + '</a>' +
          '</nav>' + relatedLinksBlock + '</article></div></section>';
      })()
    : '';

  let html = await response.text();
  html = html.replace(/<html\b[^>]*>/i, htmlLang + '>');
  html = html.replace(/<title>[\s\S]*?<\/title>/i, '<title>' + escapeXml(seoTitle) + '</title>');
  html = html.replace(/<meta\s+name=["']description["'][^>]*>/i, '<meta name="description" content="' + escapeXml(metaDescription) + '" />');
  html = html.replace('</head>', injection + '</head>');
  const appendableSeoBody = [crawlableBody, detailContentBody].filter(Boolean).join('');
  if (appendableSeoBody) {
    const closingBody = /<\/body\s*>/i;
    if (closingBody.test(html)) html = html.replace(closingBody, (match) => appendableSeoBody + match);
    else html += appendableSeoBody;
  }

  const headers = new Headers(response.headers);
  headers.set('content-type', 'text/html; charset=UTF-8');
  if (url.pathname === '/') {
    // The unprefixed homepage depends on Cloudflare visitor country/language.
    // Never cache it: an old cached redirect or another visitor's localized HTML
    // must not be replayed at the root URL.
    headers.set('cache-control', 'no-store');
    headers.delete('cdn-cache-control');
    headers.delete('cloudflare-cdn-cache-control');
  } else {
    // Locale-prefixed pages are deterministic for their path and can be cached.
    headers.set('cache-control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=300');
    headers.set('cdn-cache-control', 'public, max-age=3600, stale-while-revalidate=300');
  }
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

// TMDB discovery exposes at most 500 pages per content type. Keep each sitemap
// segment to one API page so each sitemap request stays lightweight on Cloudflare Free.
const SITEMAP_DISCOVERY_PAGES = 500; // TMDB discovery pages per media type (up to 10,000 URLs).
const SITEMAP_DISCOVERY_PAGES_PER_SITEMAP = 10; // Batch ten TMDB pages into each movie/series sitemap.
// Five series per source slice; batching two slices preserves coverage of 500 popular series.
const SITEMAP_EPISODE_PAGES = 100;
const SITEMAP_EPISODE_PAGES_PER_SITEMAP = 2;
const SITEMAP_CRAWL_ORIGIN = 'https://movyza.sbs';

const buildHomepagesSitemap = (origin: string) => {
  // The submitted root sitemap intentionally contains only the public homepages:
  // the default entry point and one stable entry point for every supported locale.
  const urls: string[] = [
    `<url><loc>${escapeXml(origin + "/")}</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`,
  ];
  for (const locale of Object.keys(LOCALES) as LocaleCode[]) {
    urls.push(
      `<url><loc>${escapeXml(`${origin}/${locale}/`)}</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`,
    );
  }
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`;
};

const buildStaticSitemapSegment = (request: Request, locale: LocaleCode) => {
  const origin = SITEMAP_PUBLIC_ORIGIN;
  const routes = ['/', '/movies', '/series', '/discover', '/catalog', '/legal'];
  const localizedUrls = routes
    .map((route) =>
      `<url><loc>${escapeXml(`${origin}/${locale}${route === '/' ? '/' : route}`)}</loc><changefreq>daily</changefreq><priority>${route === '/' ? '1.0' : '0.8'}</priority></url>`
    )
    .join('');
  // Also expose the geo-localized root entry point through the primary sitemap index.
  const defaultRootUrl = locale === 'en'
    ? `<url><loc>${escapeXml(origin + '/')}</loc><changefreq>daily</changefreq><priority>1.0</priority></url>`
    : '';
  const urls = defaultRootUrl + localizedUrls;

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
    // Batch ten popular series per episode sitemap (one discovery request plus up to ten detail requests).
    // This preserves the previous 500-series coverage while halving the number of episode sitemap requests.
    if (type === 'episodes') {
      const sitemapPageCount = Math.ceil(SITEMAP_EPISODE_PAGES / SITEMAP_EPISODE_PAGES_PER_SITEMAP);
      if (page < 1 || page > sitemapPageCount) return new Response('Not found', { status: 404 });

      const sourcePageOffset = (page - 1) * SITEMAP_EPISODE_PAGES_PER_SITEMAP;
      const discoverPage = Math.floor(sourcePageOffset / 4) + 1;
      const sliceStart = (sourcePageOffset % 4) * 5;
      const discoverTarget = new URL('https://api.themoviedb.org/3/discover/tv');
      discoverTarget.searchParams.set('language', config.tmdb);
      discoverTarget.searchParams.set('region', config.region);
      discoverTarget.searchParams.set('page', String(discoverPage));
      discoverTarget.searchParams.set('sort_by', 'popularity.desc');
      discoverTarget.searchParams.set('include_adult', 'false');

      const discoverData = await fetchJson(discoverTarget);
      const seriesBatch = (discoverData?.results || []).slice(sliceStart, sliceStart + SITEMAP_EPISODE_PAGES_PER_SITEMAP * 5);

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
              `<url><loc>${escapeXml(`${origin}/${locale}/episodes/${entry.id}/${seasonNumber}/${episode}`)}</loc><changefreq>monthly</changefreq><priority>0.55</priority></url>`
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

    const sitemapPageCount = Math.ceil(SITEMAP_DISCOVERY_PAGES / SITEMAP_DISCOVERY_PAGES_PER_SITEMAP);
    if (page < 1 || page > sitemapPageCount) {
      return new Response('Not found', { status: 404 });
    }

    const tmdbType = type === 'movies' ? 'movie' : 'tv';
    const firstApiPage = (page - 1) * SITEMAP_DISCOVERY_PAGES_PER_SITEMAP + 1;
    const lastApiPage = Math.min(SITEMAP_DISCOVERY_PAGES, firstApiPage + SITEMAP_DISCOVERY_PAGES_PER_SITEMAP - 1);
    const apiPages = Array.from({ length: lastApiPage - firstApiPage + 1 }, (_, index) => firstApiPage + index);
    const pageData = await Promise.all(apiPages.map(async (apiPage) => {
      const target = new URL(`https://api.themoviedb.org/3/discover/${tmdbType}`);
      target.searchParams.set('language', config.tmdb);
      target.searchParams.set('region', config.region);
      target.searchParams.set('page', String(apiPage));
      target.searchParams.set('sort_by', 'popularity.desc');
      target.searchParams.set('include_adult', 'false');
      if (tmdbType === 'movie') target.searchParams.set('include_video', 'false');
      return fetchJson(target);
    }));
    const urls: string[] = [];

    for (const data of pageData) {
      for (const item of data?.results || []) {
        const id = Number(item?.id || 0);
        if (!id) continue;
  
        urls.push(
          `<url><loc>${escapeXml(`${origin}/${locale}/${type}/${id}`)}</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>`
        );
  
        // Watch pages are intentionally not included in sitemaps.
        // Detail pages remain the SEO entry points for each title.
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

const buildSitemapIndex = () => {
  const entries: string[] = [];

  // Every language gets its own homepage and stable category/legal URLs.
  // Full content discovery runs once in English; each detail page publishes
  // reciprocal hreflang URLs for all 33 localized information pages.
  for (const locale of Object.keys(LOCALES) as LocaleCode[]) {
    entries.push(`<sitemap><loc>${SITEMAP_PUBLIC_ORIGIN}/sitemap/${locale}/static.xml</loc></sitemap>`);
  }

  // Do not multiply thousands of dynamic sitemap requests by every language.
  // Google can discover translations through the hreflang set on each detail page.
  const contentLocale: LocaleCode = 'en';
  const discoverySitemapCount = Math.ceil(SITEMAP_DISCOVERY_PAGES / SITEMAP_DISCOVERY_PAGES_PER_SITEMAP);
  for (let page = 1; page <= discoverySitemapCount; page += 1) {
    entries.push(`<sitemap><loc>${SITEMAP_PUBLIC_ORIGIN}/sitemap/${contentLocale}/movies/${page}.xml</loc></sitemap>`);
    entries.push(`<sitemap><loc>${SITEMAP_PUBLIC_ORIGIN}/sitemap/${contentLocale}/series/${page}.xml</loc></sitemap>`);
  }
  const episodeSitemapCount = Math.ceil(SITEMAP_EPISODE_PAGES / SITEMAP_EPISODE_PAGES_PER_SITEMAP);
  for (let page = 1; page <= episodeSitemapCount; page += 1) {
    entries.push(`<sitemap><loc>${SITEMAP_PUBLIC_ORIGIN}/sitemap/${contentLocale}/episodes/${page}.xml</loc></sitemap>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.join('')}</sitemapindex>`;
};

const buildRootSitemap = () => buildSitemapIndex();

const buildRobotsTxt = () => [
  '# Movyza crawler policy',
  '# robots.txt manages crawling; it is not an access-control mechanism.',
  '',
  '# Explicit allow for GSC Wizard on-page audits; specific groups repeat sensitive-path exclusions.',
  'User-agent: GSCWizard-Bot',
  'Allow: /',
  'Disallow: /admin',
  'Disallow: /*/admin',
  'Disallow: /tmdb',
  'Disallow: /tmdb/',
  'Disallow: /api/v1/playback/resolve',
  '',
  'User-agent: *',
  'Allow: /',
  'Disallow: /admin',
  'Disallow: /*/admin',
  'Disallow: /tmdb',
  'Disallow: /tmdb/',
  'Disallow: /api/v1/playback/resolve',
  '',
  '# Public movie, series and episode-information pages are crawlable and listed in sitemaps.',
  '# Playback routes remain crawlable so Google can read their noindex directive, but are never listed in sitemaps.',
  '# Search, login, profile, history and watchlist pages are marked noindex by the application.',
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
      // Cloudflare accepts HTTP on alternate ports such as 2052, but HTTPS
      // must use the site's normal TLS port (443). Preserve only the default
      // HTTPS port when canonicalizing public requests, otherwise this creates
      // invalid URLs such as https://movyza.sbs:2052/.
      if (['80', '2052', '8080', '8880', '2082', '2086', '2095'].includes(secureUrl.port)) {
        secureUrl.port = '';
      }
      return new Response(null, {
        status: 301,
        headers: {
          Location: secureUrl.toString(),
          'Cache-Control': 'no-store',
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
          'Cache-Control': 'no-store',
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
