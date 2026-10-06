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
import { getLanguageFromPath, stripLanguagePrefix, withLanguagePrefix, Language } from './lib/i18n';


function MainApp() {
  const { direction, language } = useLanguage();
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
    const target = new URL(path, window.location.origin);
    const targetPath = getLanguageFromPath(target.pathname)
      ? target.pathname
      : withLanguagePrefix(target.pathname, language);
    const localizedPath = targetPath + target.search + target.hash;
    window.history.pushState({}, '', localizedPath);
    setCurrentPath(localizedPath);
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
    const [rawPath, queryString] = currentPath.split('?');
    const route = stripLanguagePrefix(rawPath || '/');
    const pathOnly = route.pathname;
    const searchParams = new URLSearchParams(queryString || '');

    // Direct iframe watch routes. No API request is made here.
    if (pathOnly.startsWith('/watch/')) {
      const segments = pathOnly.split('/').filter(Boolean);
      const mediaType = segments[1];
      const contentId = segments[2] || '';

      if (mediaType === 'movie' && contentId) {
        return (
          <WatchPage
            mediaType="movie"
            contentId={contentId}
            onNavigate={navigate}
          />
        );
      }

      if (
        mediaType === 'tv' &&
        contentId &&
        Number.isFinite(Number(segments[3])) &&
        Number.isFinite(Number(segments[4]))
      ) {
        return (
          <WatchPage
            mediaType="series"
            contentId={contentId}
            seasonNumber={Number(segments[3])}
            episodeNumber={Number(segments[4])}
            onNavigate={navigate}
          />
        );
      }

      return (
        <WatchPage
          mediaType="movie"
          contentId=""
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

  const isWatchPage = stripLanguagePrefix(currentPath.split('?')[0] || '/').pathname.startsWith('/watch/');

  return (
    <div className="min-h-screen bg-[#08090d] text-slate-100 flex flex-col font-sans selection:bg-amber-500/30 selection:text-amber-200">
      {/* Header: hidden when in fullscreen watch page to maximize cinematic focus */}
      {!isWatchPage && (
        <Header
          currentPath={stripLanguagePrefix(currentPath.split('?')[0] || '/').pathname}
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
          currentPath={stripLanguagePrefix(currentPath.split('?')[0] || '/').pathname}
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
