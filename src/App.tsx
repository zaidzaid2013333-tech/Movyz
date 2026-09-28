import React, { useState, useEffect } from 'react';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { Header } from './components/layout/Header';
import { MobileNavigation } from './components/layout/MobileNavigation';
import { Footer } from './components/layout/Footer';
import { SurpriseMeModal } from './components/ui/SurpriseMeModal';

// Pages
import { HomePage } from './pages/HomePage';
import { MoviesPage } from './pages/MoviesPage';
import { SeriesPage } from './pages/SeriesPage';
import { MovieDetailsPage } from './pages/MovieDetailsPage';
import { SeriesDetailsPage } from './pages/SeriesDetailsPage';
import { WatchPage } from './pages/WatchPage';
import { SearchPage } from './pages/SearchPage';
import { DiscoverPage } from './pages/DiscoverPage';
import { WatchlistPage } from './pages/WatchlistPage';
import { HistoryPage } from './pages/HistoryPage';
import { ProfilePage } from './pages/ProfilePage';
import { AuthPage } from './pages/AuthPages';
import { AdminDashboard } from './pages/AdminDashboard';

import { MovyzaApi } from './services/api';
import { Movie, Series } from './types';


function AkwamIframeTestPage() {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'timeout'>('loading');
  const akwamEpisode =
    'https://akwam.ss/watch/22879/9725/the-mentalist-%D8%A7%D9%84%D9%85%D9%88%D8%B3%D9%85_%D8%A7%D9%84%D8%A7%D9%88%D9%84/%D8%A7%D9%84%D8%AD%D9%84%D9%82%D8%A9-1';

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setStatus((current) => (current === 'loading' ? 'timeout' : current));
    }, 10000);

    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div
      dir="rtl"
      style={{
        minHeight: '100vh',
        background: '#050507',
        color: '#fff',
        padding: '16px',
        boxSizing: 'border-box',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 18 }}>Akwam iframe test</h1>
        <p style={{ margin: '0 0 12px', color: '#a1a1aa', fontSize: 13 }}>
          الاختبار معزول عن مشغل Movyza. الصفحة المضمّنة هنا هي صفحة Akwam نفسها.
        </p>
        <div
          style={{
            marginBottom: 10,
            padding: '8px 10px',
            borderRadius: 8,
            background: '#111318',
            color: status === 'loaded' ? '#86efac' : status === 'timeout' ? '#fca5a5' : '#fcd34d',
            fontSize: 12,
          }}
        >
          {status === 'loaded'
            ? 'استلم الـiframe إشارة تحميل.'
            : status === 'timeout'
              ? 'الـiframe لم يعطِ إشارة تحميل خلال 10 ثوانٍ؛ قد يكون الحجب من Akwam أو من المتصفح.'
              : 'جاري تحميل صفحة Akwam داخل iframe…'}
        </div>
        <iframe
          src={akwamEpisode}
          title="Akwam playback test"
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          referrerPolicy="no-referrer"
          onLoad={() => setStatus('loaded')}
          style={{
            display: 'block',
            width: '100%',
            height: '82vh',
            minHeight: 420,
            border: 0,
            borderRadius: 12,
            background: '#000',
          }}
        />
      </div>
    </div>
  );
}

function MainApp() {
  const { direction } = useLanguage();
  const { user, isAdmin } = useAuth();
  const { isSurpriseOpen, closeSurprise } = useTheme();

  // URL route parsing with fallback
  const [currentPath, setCurrentPath] = useState<string>(() => {
    return window.location.pathname + window.location.search || '/';
  });

  const [watchlistIds, setWatchlistIds] = useState<string[]>([]);

  // Keep path in sync with browser navigation (Back/Forward)
  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname + window.location.search || '/');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Watchlist belongs to the authenticated account; guests keep an empty local UI state.
  useEffect(() => {
    let active = true;
    if (!user) {
      setWatchlistIds([]);
      return () => { active = false; };
    }

    MovyzaApi.getWatchlist()
      .then((res) => {
        if (active) setWatchlistIds(res.data.map((item) => item.contentId));
      })
      .catch(() => {
        if (active) setWatchlistIds([]);
      });

    return () => { active = false; };
  }, [user?.id]);

  const navigate = (path: string) => {
    window.history.pushState({}, '', path);
    setCurrentPath(path);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleToggleWatchlist = async (item: Movie | Series) => {
    if (!user) {
      navigate('/login');
      return;
    }

    if (watchlistIds.includes(item.id)) {
      setWatchlistIds((prev) => prev.filter((id) => id !== item.id));
      await MovyzaApi.removeFromWatchlist(item.id);
    } else {
      setWatchlistIds((prev) => [...prev, item.id]);
      await MovyzaApi.addToWatchlist({
        userId: user.id,
        contentId: item.id,
        contentType: item.type,
        title: item.title,
        titleEn: item.titleEn,
        posterUrl: item.posterUrl,
        year: item.type === 'movie' ? item.year : item.startYear,
        rating: item.rating,
        genres: item.genres.map((g) => g.name),
      });
    }
  };

  // Route dispatcher
  const renderCurrentRoute = () => {
    const [pathOnly, queryString] = currentPath.split('?');
    const searchParams = new URLSearchParams(queryString || '');

    // Watch route
    if (pathOnly.startsWith('/watch/')) {
      const contentId = pathOnly.replace('/watch/', '');
      const season = searchParams.get('season') ? Number(searchParams.get('season')) : undefined;
      const episode = searchParams.get('episode') ? Number(searchParams.get('episode')) : undefined;
      return (
        <WatchPage
          contentId={contentId}
          seasonParam={season}
          episodeParam={episode}
          onNavigate={navigate}
        />
      );
    }

    // Movie Details route
    if (pathOnly.startsWith('/movies/')) {
      const movieId = pathOnly.replace('/movies/', '');
      return (
        <MovieDetailsPage
          movieId={movieId}
          onNavigate={navigate}
          watchlist={watchlistIds}
          onToggleWatchlist={handleToggleWatchlist}
        />
      );
    }

    // Series Details route
    if (pathOnly.startsWith('/series/')) {
      const seriesId = pathOnly.replace('/series/', '');
      return (
        <SeriesDetailsPage
          seriesId={seriesId}
          onNavigate={navigate}
          watchlist={watchlistIds}
          onToggleWatchlist={handleToggleWatchlist}
        />
      );
    }

    // Catalog routes
    if (pathOnly === '/movies') {
      const genreId = searchParams.get('genre') ? Number(searchParams.get('genre')) : undefined;
      return (
        <MoviesPage
          onNavigate={navigate}
          watchlist={watchlistIds}
          onToggleWatchlist={handleToggleWatchlist}
          initialGenreId={genreId}
        />
      );
    }

    if (pathOnly === '/series') {
      const genreId = searchParams.get('genre') ? Number(searchParams.get('genre')) : undefined;
      return (
        <SeriesPage
          onNavigate={navigate}
          watchlist={watchlistIds}
          onToggleWatchlist={handleToggleWatchlist}
          initialGenreId={genreId}
        />
      );
    }

    // Search route
    if (pathOnly === '/search') {
      return (
        <SearchPage
          onNavigate={navigate}
          watchlist={watchlistIds}
          onToggleWatchlist={handleToggleWatchlist}
        />
      );
    }

    // Discover route
    if (pathOnly === '/discover') {
      return (
        <DiscoverPage
          onNavigate={navigate}
          watchlist={watchlistIds}
          onToggleWatchlist={handleToggleWatchlist}
        />
      );
    }

    // Watchlist route
    if (pathOnly === '/watchlist') {
      return (
        <WatchlistPage
          onNavigate={navigate}
          watchlist={watchlistIds}
          onToggleWatchlist={handleToggleWatchlist}
        />
      );
    }

    // History route
    if (pathOnly === '/history') {
      return <HistoryPage onNavigate={navigate} />;
    }

    // Profile route
    if (pathOnly === '/profile') {
      return <ProfilePage onNavigate={navigate} watchlistCount={watchlistIds.length} />;
    }

    // Auth routes
    if (pathOnly === '/login') {
      return <AuthPage mode="login" onNavigate={navigate} />;
    }
    if (pathOnly === '/register') {
      return <AuthPage mode="register" onNavigate={navigate} />;
    }
    if (pathOnly === '/forgot-password') {
      return <AuthPage mode="forgot" onNavigate={navigate} />;
    }

    // Admin route
    if (pathOnly === '/admin') {
      if (!isAdmin) {
        return (
          <HomePage
            onNavigate={navigate}
            watchlist={watchlistIds}
            onToggleWatchlist={handleToggleWatchlist}
          />
        );
      }
      return <AdminDashboard onNavigate={navigate} />;
    }

    // Default Home
    return (
      <HomePage
        onNavigate={navigate}
        watchlist={watchlistIds}
        onToggleWatchlist={handleToggleWatchlist}
      />
    );
  };

  const isWatchPage = currentPath.startsWith('/watch/');

  return (
    <div className="min-h-screen bg-[#08090d] text-slate-100 flex flex-col font-sans selection:bg-amber-500/30 selection:text-amber-200">
      {/* Header: hidden when in fullscreen watch page to maximize cinematic focus */}
      {!isWatchPage && (
        <Header
          currentPath={currentPath.split('?')[0]}
          onNavigate={navigate}
          watchlistCount={watchlistIds.length}
        />
      )}

      {/* Main Content */}
      <main className="flex-1 w-full min-w-0 overflow-x-clip">{renderCurrentRoute()}</main>

      {/* Footer: hidden on watch page */}
      {!isWatchPage && <Footer onNavigate={navigate} />}

      {/* Mobile Ergonomic Bottom Tab Navigation: hidden on watch page */}
      {!isWatchPage && (
        <MobileNavigation
          currentPath={currentPath.split('?')[0]}
          onNavigate={navigate}
        />
      )}

      {/* Surprise Me Random Cinema Picker Modal */}
      <SurpriseMeModal
        isOpen={isSurpriseOpen}
        onClose={closeSurprise}
        onNavigate={navigate}
      />
    </div>
  );
}

export default function App() {
  if (window.location.pathname === '/akwam-iframe-test') {
    return <AkwamIframeTestPage />;
  }

  return (
    <LanguageProvider>
      <AuthProvider>
        <ThemeProvider>
          <MainApp />
        </ThemeProvider>
      </AuthProvider>
    </LanguageProvider>
  );
}
