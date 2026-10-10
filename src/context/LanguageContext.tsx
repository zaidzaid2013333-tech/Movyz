import React, { createContext, useContext, useState, useEffect } from 'react';
import { UI_TRANSLATIONS } from '../lib/uiTranslations';
import {
  Language,
  getCurrentLanguage,
  withLanguagePrefix,
} from '../lib/i18n';

interface Translations {
  [key: string]: Partial<Record<Language, string>>;
}

export const DICTIONARY: Translations = {
  // Brand & Navigation
  brandName: { ar: 'موفيزا', en: 'Movyza' },
  brandTagline: { ar: 'اكتشف الأفلام والمسلسلات من حول العالم', en: 'Movies & TV from Around the World' },
  home: { ar: 'الرئيسية', en: 'Home' },
  movies: { ar: 'الأفلام', en: 'Movies' },
  series: { ar: 'المسلسلات', en: 'Series' },
  discover: { ar: 'استكشاف', en: 'Discover' },
  search: { ar: 'البحث', en: 'Search' },
  watchlist: { ar: 'قائمتي', en: 'Watchlist' },
  history: { ar: 'سجل المشاهدة', en: 'History' },
  continueWatching: { ar: 'متابعة المشاهدة', en: 'Continue Watching' },
  profile: { ar: 'حسابي', en: 'Profile' },
  admin: { ar: 'الإدارة', en: 'Admin' },
  adminDashboard: { ar: 'لوحة التحكم الإدارية', en: 'Admin Dashboard' },
  login: { ar: 'تسجيل الدخول', en: 'Sign In' },
  register: { ar: 'إنشاء حساب', en: 'Register' },
  logout: { ar: 'تسجيل الخروج', en: 'Log Out' },
  
  // Hero & CTAs
  watchNow: { ar: 'مشاهدة الآن', en: 'Watch Now' },
  details: { ar: 'التفاصيل', en: 'Details' },
  addToWatchlist: { ar: 'أضف لقائمتي', en: 'Add to Watchlist' },
  inWatchlist: { ar: 'في قائمتي', en: 'In Watchlist' },
  share: { ar: 'مشاركة', en: 'Share' },
  linkCopied: { ar: 'تم نسخ الرابط بنجاح', en: 'Link copied to clipboard' },
  
  // Sections
  featured: { ar: 'مميز ومختار', en: 'Featured' },
  trendingNow: { ar: 'الأكثر تداولاً اليوم', en: 'Trending Now' },
  popularMovies: { ar: 'الأفلام الأكثر شعبية', en: 'Popular Movies' },
  featuredSeries: { ar: 'مسلسلات حصرية ومختارة', en: 'Prestige Series' },
  recentlyAdded: { ar: 'أضيف حديثاً', en: 'Recently Added' },
  exploreGenres: { ar: 'تصفح حسب التصنيف', en: 'Browse by Genre' },
  similarContent: { ar: 'أعمال مشابهة قد تعجبك', en: 'Similar Titles' },
  seasonsAndEpisodes: { ar: 'المواسم والحلقات', en: 'Seasons & Episodes' },
  castAndCrew: { ar: 'طاقم العمل والتمثيل', en: 'Cast & Crew' },
  storyOverview: { ar: 'قصة العمل', en: 'Overview' },
  director: { ar: 'المخرج', en: 'Director' },
  creator: { ar: 'المؤلف / المبتكر', en: 'Creator' },
  releaseDate: { ar: 'تاريخ العرض', en: 'Release Date' },
  runtime: { ar: 'مدة العرض', en: 'Runtime' },
  minutes: { ar: 'دقيقة', en: 'min' },
  seasons: { ar: 'مواسم', en: 'Seasons' },
  episodes: { ar: 'حلقات', en: 'Episodes' },
  season: { ar: 'الموسم', en: 'Season' },
  episode: { ar: 'الحلقة', en: 'Episode' },
  all: { ar: 'الكل', en: 'All' },
  seeAll: { ar: 'عرض الكل', en: 'View all' },
  
  // Filtering & Sorting
  filterByGenre: { ar: 'التصنيف', en: 'Genre' },
  filterByYear: { ar: 'السنة', en: 'Year' },
  filterByRating: { ar: 'التقييم الأدنى', en: 'Min Rating' },
  sortBy: { ar: 'الترتيب حسب', en: 'Sort By' },
  sortPopular: { ar: 'الأكثر شعبية', en: 'Most Popular' },
  sortRating: { ar: 'الأعلى تقييماً', en: 'Highest Rated' },
  sortNewest: { ar: 'الأحدث إصداراً', en: 'Newest Release' },
  resetFilters: { ar: 'إعادة ضبط الفلاتر', en: 'Reset Filters' },
  
  // Search
  searchPlaceholder: { ar: 'ابحث عن فيلم، مسلسل، ممثل، أو مخرج...', en: 'Search movies, series, actors, directors...' },
  recentSearches: { ar: 'عمليات البحث الأخيرة', en: 'Recent Searches' },
  noResultsFor: { ar: 'لم نتمكن من العثور على نتائج تطابق', en: 'No results found matching' },
  searchSuggestions: { ar: 'جرّب البحث بكلمات عامة أو تصفح الأقسام المقترحة.', en: 'Try general keywords or explore suggested genres.' },
  
  // Player
  playerServer: { ar: 'سيرفر التشغيل', en: 'Server' },
  playerQuality: { ar: 'الجودة', en: 'Quality' },
  nextEpisode: { ar: 'الحلقة التالية', en: 'Next Episode' },
  prevEpisode: { ar: 'الحلقة السابقة', en: 'Previous Episode' },
  selectEpisode: { ar: 'اختر حلقة', en: 'Select Episode' },
  sourceUnavailable: { ar: 'هذا المصدر غير متاح حالياً. جاري تجربة سيرفر بديل تلقائياً...', en: 'This source is currently unavailable. Trying backup server...' },
  reportBroken: { ar: 'الإبلاغ عن عطل', en: 'Report Issue' },
  reportSent: { ar: 'تم استلام بلاغك وسيقوم فريق الدعم بمراجعته فوراً', en: 'Report received and will be reviewed by support' },
  resumePlayback: { ar: 'متابعة من حيث توقفت', en: 'Resume where you left off' },
  startOver: { ar: 'البدء من البداية', en: 'Start from beginning' },
  
  // Empty & Error states
  emptyWatchlistTitle: { ar: 'قائمتك فارغة حالياً', en: 'Your Watchlist is Empty' },
  emptyWatchlistDesc: { ar: 'احفظ الأفلام والمسلسلات التي ترغب في مشاهدتها لاحقاً لتصل إليها بضغطة زر.', en: 'Save titles you want to watch later for quick one-click access.' },
  emptyHistoryTitle: { ar: 'لا يوجد سجل مشاهدة بعد', en: 'No Watch History Yet' },
  emptyHistoryDesc: { ar: 'ابدأ بمشاهدة أي عمل سينمائي وستظهر متابعة التقدم هنا تلقائياً.', en: 'Start watching any title to seamlessly resume playback from here.' },
  errorLoadingData: { ar: 'تعذر تحميل المحتوى حالياً. يرجى التحقق من اتصالك والمحاولة مجدداً.', en: 'Unable to load content right now. Please check your connection and retry.' },
  retry: { ar: 'إعادة المحاولة', en: 'Retry' },
  goHome: { ar: 'العودة للرئيسية', en: 'Back to Home' },
  
  // Auth & Profile
  welcomeBack: { ar: 'مرحباً بك مجدداً في موفيزا', en: 'Welcome back to Movyza' },
  emailAddress: { ar: 'البريد الإلكتروني', en: 'Email Address' },
  password: { ar: 'كلمة المرور', en: 'Password' },
  fullName: { ar: 'الاسم الكامل', en: 'Full Name' },
  role: { ar: 'الدور في النظام (RBAC)', en: 'System Role (RBAC)' },
  userRole: { ar: 'مستخدم عادي (USER)', en: 'Standard User (USER)' },
  adminRole: { ar: 'مشرف محتوى (ADMIN)', en: 'Content Admin (ADMIN)' },
  ownerRole: { ar: 'مالك المنصة (OWNER)', en: 'Platform Owner (OWNER)' },
  switchRoleHelp: { ar: 'يمكنك التبديل بين الأدوار لاختبار صلاحيات RBAC بالكامل.', en: 'You can switch roles to verify the full RBAC permission model.' },
  accountSettings: { ar: 'إعدادات الحساب', en: 'Account Settings' },
  appLanguage: { ar: 'لغة الواجهة', en: 'Interface Language' },
  arabic: { ar: 'العربية (RTL)', en: 'Arabic (RTL)' },
  english: { ar: 'English (LTR)', en: 'English (LTR)' },
  
  // Admin
  adminOverview: { ar: 'نظرة عامة', en: 'Overview' },
  manageMovies: { ar: 'إدارة الأفلام', en: 'Manage Movies' },
  manageSeries: { ar: 'إدارة المسلسلات', en: 'Manage Series' },
  providerAdapters: { ar: 'مزودات الفيديو والمطابقة', en: 'Video Providers & Adapters' },
  syncSystem: { ar: 'نظام المزامنة والذاكرة', en: 'Sync System & Cache' },
  auditLogs: { ar: 'سجل المراجعة والأمان', en: 'Audit Logs' },
  systemHealth: { ar: 'صحة النظام', en: 'System Health' },
  testConnection: { ar: 'فحص الاتصال', en: 'Test Ping' },
  triggerSync: { ar: 'بدء مزامنة TMDB', en: 'Trigger TMDB Sync' },
  confirmDelete: { ar: 'هل أنت متأكد من الحذف؟', en: 'Are you sure you want to delete?' },
  cancel: { ar: 'إلغاء', en: 'Cancel' },
  delete: { ar: 'حذف', en: 'Delete' },
  actionSuccess: { ar: 'تم تنفيذ الإجراء بنجاح', en: 'Action completed successfully' }
};

interface LanguageContextType {
  language: Language;
  direction: 'rtl' | 'ltr';
  setLanguage: (lang: Language) => void;
  toggleLanguage: () => void;
  t: (key: keyof typeof DICTIONARY) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => getCurrentLanguage());

  const direction = ['ar', 'he', 'fa', 'ur'].includes(language) ? 'rtl' : 'ltr';

  useEffect(() => {
    localStorage.setItem('movyza_lang', language);
    document.documentElement.lang = language;
    document.documentElement.dir = direction;
  }, [language, direction]);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    const nextPath = withLanguagePrefix(window.location.pathname + window.location.search, lang);
    window.location.assign(nextPath);
  };

  const toggleLanguage = () => {
    const next = language === 'ar' ? 'en' : 'ar';
    setLanguageState(next);
    const nextPath = withLanguagePrefix(window.location.pathname + window.location.search, next);
    window.location.assign(nextPath);
  };

  const t = (key: keyof typeof DICTIONARY): string => {
    const entry = DICTIONARY[key];
    if (!entry) return String(key);
    return UI_TRANSLATIONS[language]?.[String(key)] || entry[language] || entry.en || entry.ar || String(key);
  };

  return (
    <LanguageContext.Provider value={{ language, direction, setLanguage, toggleLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
