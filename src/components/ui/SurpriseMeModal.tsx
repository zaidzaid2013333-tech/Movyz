import React, { useState, useEffect } from 'react';
import { X, Dices, Play, RefreshCw, Star, Info } from 'lucide-react';
import { Movie, Series, Genre } from '../../types';
import { MovyzaApi } from '../../services/api';
import { useLanguage } from '../../context/LanguageContext';

interface SurpriseMeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (path: string) => void;
}

export const SurpriseMeModal: React.FC<SurpriseMeModalProps> = ({
  isOpen,
  onClose,
  onNavigate,
}) => {
  const { language, t } = useLanguage();
  const [allMedia, setAllMedia] = useState<(Movie | Series)[]>([]);
  const [genres, setGenres] = useState<Genre[]>([]);
  const [selectedGenreId, setSelectedGenreId] = useState<number | 'all'>('all');
  const [pickedItem, setPickedItem] = useState<Movie | Series | null>(null);
  const [isSpinning, setIsSpinning] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    Promise.all([
      MovyzaApi.getMovies(),
      MovyzaApi.getSeries(),
      MovyzaApi.getGenres(),
    ]).then(([moviesRes, seriesRes, genresRes]) => {
      const combined = [...moviesRes.data, ...seriesRes.data];
      setAllMedia(combined);
      setGenres(genresRes.data);
      rollRandom(combined, selectedGenreId);
    });
  }, [isOpen]);

  const rollRandom = (pool = allMedia, genreId = selectedGenreId) => {
    setIsSpinning(true);

    const filtered =
      genreId === 'all'
        ? pool
        : pool.filter((item) => item.genres.some((g) => g.id === genreId));

    const finalPool = filtered.length > 0 ? filtered : pool;

    setTimeout(() => {
      const random = finalPool[Math.floor(Math.random() * finalPool.length)];
      setPickedItem(random || null);
      setIsSpinning(false);
    }, 400);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-3xl bg-[#090b10] border border-white/10 shadow-2xl overflow-hidden p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Dices className={`w-5 h-5 ${isSpinning ? 'animate-spin' : ''}`} />
            </div>
            <div>
              <h3 className="text-base font-bold font-cinema-title text-white">
                {language === 'ar' ? 'اختر لي عملاً عشوائياً' : 'Surprise Me!'}
              </h3>
              <p className="text-xs text-slate-400">
                {language === 'ar' ? 'محتار ماذا تشاهد؟ دعنا نقترح عليك عملاً مميزاً.' : 'Indecisive? Let us pick a top title for you.'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Genre Selector */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-300">
            {language === 'ar' ? 'التصنيف المفضل:' : 'Preferred Genre:'}
          </label>
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
            <button
              onClick={() => {
                setSelectedGenreId('all');
                rollRandom(allMedia, 'all');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0 cursor-pointer ${
                selectedGenreId === 'all'
                  ? 'bg-amber-500 text-slate-950 font-bold'
                  : 'bg-white/[0.04] text-slate-300 hover:text-white border border-white/10'
              }`}
            >
              {language === 'ar' ? 'أي نوع' : 'Any'}
            </button>
            {genres.slice(0, 6).map((g) => (
              <button
                key={g.id}
                onClick={() => {
                  setSelectedGenreId(g.id);
                  rollRandom(allMedia, g.id);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0 cursor-pointer ${
                  selectedGenreId === g.id
                    ? 'bg-amber-500 text-slate-950 font-bold'
                    : 'bg-white/[0.04] text-slate-300 hover:text-white border border-white/10'
                }`}
              >
                {language === 'ar' ? g.name : g.nameEn}
              </button>
            ))}
          </div>
        </div>

        {/* Result Card */}
        {pickedItem && (
          <div className="relative rounded-2xl overflow-hidden bg-slate-900 border border-white/10 shadow-lg">
            <div className="relative aspect-video w-full overflow-hidden">
              <img
                src={pickedItem.backdropUrl || pickedItem.posterUrl}
                alt={pickedItem.titleEn || pickedItem.title}
                referrerPolicy="no-referrer"
                className={`w-full h-full object-cover transition-opacity duration-300 ${
                  isSpinning ? 'opacity-30' : 'opacity-100'
                }`}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-transparent" />

              <div className="absolute bottom-3 inset-x-3 space-y-1">
                <div className="flex items-center gap-2 text-xs font-mono">
                  <span className="flex items-center gap-1 font-bold text-amber-400">
                    <Star className="w-3.5 h-3.5 fill-amber-400" />
                    <span>{pickedItem.rating.toFixed(1)}</span>
                  </span>
                  <span className="text-slate-400">·</span>
                  <span className="text-slate-300">
                    {pickedItem.type === 'movie' ? (pickedItem as Movie).year : (pickedItem as Series).startYear}
                  </span>
                  <span className="text-slate-400">·</span>
                  <span className="text-amber-300 font-semibold">
                    {pickedItem.type === 'movie'
                      ? `${(pickedItem as Movie).runtime} دقيقة`
                      : `${(pickedItem as Series).seasonsCount} مواسم`}
                  </span>
                </div>
                <h4 className="text-base sm:text-lg font-bold font-cinema-title text-white">
                  {pickedItem.titleEn || pickedItem.title}
                </h4>
              </div>
            </div>

            <div className="p-4 space-y-3">
              <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed">
                {language === 'ar' ? pickedItem.overview : pickedItem.overviewEn}
              </p>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => {
                    onClose();
                    onNavigate(`/watch/${pickedItem.id}`);
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-amber-500/20"
                >
                  <Play className="w-4 h-4 fill-slate-950" />
                  <span>{t('watchNow')}</span>
                </button>

                <button
                  onClick={() => {
                    onClose();
                    onNavigate(pickedItem.type === 'movie' ? `/movies/${pickedItem.id}` : `/series/${pickedItem.id}`);
                  }}
                  className="px-3.5 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Info className="w-4 h-4 text-slate-400" />
                  <span>{t('details')}</span>
                </button>

                <button
                  onClick={() => rollRandom()}
                  disabled={isSpinning}
                  className="p-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-amber-400 transition-colors cursor-pointer"
                  title={language === 'ar' ? 'اقتراح آخر' : 'Roll Again'}
                >
                  <RefreshCw className={`w-4 h-4 ${isSpinning ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
