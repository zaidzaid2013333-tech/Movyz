import React, { createContext, useContext, useState, useEffect } from 'react';

type ThemeMode = 'cinema' | 'oled';

interface ThemeContextType {
  theme: ThemeMode;
  toggleTheme: () => void;
  setTheme: (theme: ThemeMode) => void;
  canInstallPwa: boolean;
  installPwa: () => Promise<boolean>;
  isSurpriseOpen: boolean;
  openSurprise: () => void;
  closeSurprise: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    try {
      const saved = localStorage.getItem('movyza_theme');
      return (saved as ThemeMode) || 'cinema';
    } catch {
      return 'cinema';
    }
  });

  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [canInstallPwa, setCanInstallPwa] = useState(false);
  const [isSurpriseOpen, setIsSurpriseOpen] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'oled') {
      root.classList.add('oled-theme');
    } else {
      root.classList.remove('oled-theme');
    }
    localStorage.setItem('movyza_theme', theme);
  }, [theme]);

  // Listen for PWA beforeinstallprompt
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
      setCanInstallPwa(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const installPwa = async (): Promise<boolean> => {
    if (!installPrompt) return false;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') {
      setCanInstallPwa(false);
      setInstallPrompt(null);
      return true;
    }
    return false;
  };

  const setTheme = (newTheme: ThemeMode) => {
    setThemeState(newTheme);
  };

  const toggleTheme = () => {
    setThemeState((prev) => (prev === 'cinema' ? 'oled' : 'cinema'));
  };

  return (
    <ThemeContext.Provider
      value={{
        theme,
        toggleTheme,
        setTheme,
        canInstallPwa,
        installPwa,
        isSurpriseOpen,
        openSurprise: () => setIsSurpriseOpen(true),
        closeSurprise: () => setIsSurpriseOpen(false),
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
