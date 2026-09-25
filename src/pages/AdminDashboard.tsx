import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { Movie, Series, ProviderHealth, AuditLog } from '../types';
import { MovyzaApi } from '../services/api';
import {
  Shield,
  Film,
  Tv,
  Server,
  RefreshCw,
  Activity,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Layers,
  Search,
  ExternalLink,
  Check,
  X,
} from 'lucide-react';

interface AdminDashboardProps {
  onNavigate: (path: string) => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ onNavigate }) => {
  const { user, role, isAdmin, isOwner } = useAuth();
  const { language, t } = useLanguage();

  const [activeTab, setActiveTab] = useState<'overview' | 'movies' | 'series' | 'providers' | 'sync' | 'audit'>('overview');
  const [stats, setStats] = useState<{
    totalMovies: number;
    totalSeries: number;
    totalEpisodes: number;
    activeProviders: number;
    streamHealthPct: number;
    dailyStreamRequests: number;
  } | null>(null);

  const [movies, setMovies] = useState<Movie[]>([]);
  const [seriesList, setSeriesList] = useState<Series[]>([]);
  const [providers, setProviders] = useState<ProviderHealth[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [syncJobs, setSyncJobs] = useState<Array<{
    id: string; provider: string; jobType: string; status: string; pages: number | null;
    moviesSynced: number; seriesSynced: number; seasonsSynced: number; episodesSynced: number;
    error: string; startedAt: string; finishedAt: string; createdAt: string;
  }>>([]);
  const [searchTerm, setSearchTerm] = useState('');

  // Delete modal state
  const [deleteCandidate, setDeleteCandidate] = useState<{ id: string; title: string } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isEpisodeSyncing, setIsEpisodeSyncing] = useState(false);

  const loadAdminData = async () => {
    const [statsRes, moviesRes, seriesRes, provRes, logsRes, jobsRes] = await Promise.all([
      MovyzaApi.getAdminStats(),
      MovyzaApi.getMovies(),
      MovyzaApi.getSeries(),
      MovyzaApi.getAdminProviders(),
      MovyzaApi.getAdminAuditLogs(),
      MovyzaApi.getAdminSyncJobs(),
    ]);

    setStats(statsRes.data);
    setMovies(moviesRes.data);
    setSeriesList(seriesRes.data);
    setProviders(provRes.data);
    setAuditLogs(logsRes.data);
    setSyncJobs(jobsRes.data);
  };

  useEffect(() => {
    loadAdminData();
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleTestProvider = async (providerId: string) => {
    try {
      const res = await MovyzaApi.testProvider(providerId);
      setProviders((prev) => prev.map((p) => (p.id === providerId ? res.data : p)));
      showToast(`تم فحص المزود بنجاح (زمن الاستجابة: ${res.data.latencyMs}ms)`);
    } catch {
      showToast('تعذر فحص المزود حالياً');
    }
  };

  const handleTriggerSync = async () => {
    setIsSyncing(true);
    try {
      const res = await MovyzaApi.triggerTmdbSync();
      showToast(res.data.message);
      await loadAdminData();
    } catch {
      showToast('تعذر تنفيذ مزامنة TMDB');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleToggleProvider = async (provider: ProviderHealth) => {
    try {
      await MovyzaApi.setProviderEnabled(provider.id, !provider.enabled);
      showToast(provider.enabled ? 'تم تعطيل المزود' : 'تم تفعيل المزود');
      await loadAdminData();
    } catch {
      showToast('تعذر تغيير حالة المزود');
    }
  };

  const handleEpisodeSync = async () => {
    setIsEpisodeSyncing(true);
    try {
      const res = await MovyzaApi.syncTmdbEpisodes(10);
      showToast(res.data.message);
      await loadAdminData();
    } catch {
      showToast('تعذر مزامنة الحلقات حالياً');
    } finally {
      setIsEpisodeSyncing(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteCandidate) return;
    await MovyzaApi.deleteMovie(deleteCandidate.id);
    setMovies((prev) => prev.filter((m) => m.id !== deleteCandidate.id));
    setDeleteCandidate(null);
    showToast(t('actionSuccess'));
  };

  if (!isAdmin) {
    return (
      <div className="max-w-md mx-auto py-20 px-4 text-center space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto">
          <Shield className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-white">غير مصرح بالدخول</h2>
        <p className="text-xs text-slate-400">
          تتطلب لوحة التحكم الإدارية صلاحيات المشرف (ADMIN) أو المالك (OWNER).
          يمنح الدور من الخادم فقط ولا يمكن تغييره من واجهة المستخدم.
        </p>
        <button
          onClick={() => onNavigate('/profile')}
          className="px-6 py-2.5 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs cursor-pointer"
        >
          العودة إلى الملف الشخصي
        </button>
      </div>
    );
  }

  const tabs = [
    { id: 'overview' as const, label: t('adminOverview'), icon: Activity },
    { id: 'movies' as const, label: t('manageMovies'), icon: Film },
    { id: 'series' as const, label: t('manageSeries'), icon: Tv },
    { id: 'providers' as const, label: t('providerAdapters'), icon: Server },
    { id: 'sync' as const, label: t('syncSystem'), icon: RefreshCw },
    { id: 'audit' as const, label: t('auditLogs'), icon: Clock },
  ];

  const filteredMovies = movies.filter((m) =>
    m.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    m.titleEn.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 animate-in fade-in duration-200">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-amber-500 text-slate-950 font-bold px-4 py-2 rounded-xl shadow-2xl text-xs flex items-center gap-2">
          <Check className="w-4 h-4" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Admin Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/[0.08] pb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
              {t('adminDashboard')}
            </h1>
            <p className="text-xs text-slate-400">
              مركز العمليات ومطابقة المزودات وإدارة المحتوى وسجلات الأمان
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">المستخدم النشط:</span>
          <span className="px-2.5 py-1 rounded-lg bg-white/[0.06] border border-white/[0.1] text-xs font-mono text-amber-400">
            {user?.email} ({role})
          </span>
        </div>
      </div>

      {/* Admin Tabs */}
      <div className="touch-scroll-x no-scrollbar flex items-center gap-2 p-1.5 bg-white/[0.02] border border-white/[0.06] rounded-2xl">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`min-h-[40px] px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all whitespace-nowrap cursor-pointer ${
                isActive
                  ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                  : 'text-slate-400 hover:text-white hover:bg-white/[0.05]'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab: Overview Metrics */}
      {activeTab === 'overview' && stats && (
        <div className="space-y-8 animate-in fade-in">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.06] space-y-1">
              <span className="text-xs text-slate-400">إجمالي الأفلام</span>
              <p className="text-2xl sm:text-3xl font-black text-white font-mono tabular-nums">
                {stats.totalMovies}
              </p>
              <span className="text-[11px] text-amber-400">جاهزة للبث المباشر</span>
            </div>

            <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.06] space-y-1">
              <span className="text-xs text-slate-400">إجمالي المسلسلات</span>
              <p className="text-2xl sm:text-3xl font-black text-white font-mono tabular-nums">
                {stats.totalSeries}
              </p>
              <span className="text-[11px] text-amber-400">{stats.totalEpisodes} حلقة مفهرسة</span>
            </div>

            <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.06] space-y-1">
              <span className="text-xs text-slate-400">صحة السيرفرات</span>
              <p className="text-2xl sm:text-3xl font-black text-emerald-400 font-mono tabular-nums">
                {stats.streamHealthPct}%
              </p>
              <span className="text-[11px] text-slate-400">4 مزودات نشطة</span>
            </div>

            <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.06] space-y-1">
              <span className="text-xs text-slate-400">طلبات البث اليومية</span>
              <p className="text-2xl sm:text-3xl font-black text-white font-mono tabular-nums">
                {stats.dailyStreamRequests.toLocaleString()}
              </p>
              <span className="text-[11px] text-emerald-400">Akamai CDN متوازن</span>
            </div>
          </div>

          {/* Quick Actions & System Health Overview */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="p-6 rounded-3xl bg-white/[0.02] border border-white/[0.06] space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Server className="w-4 h-4 text-amber-400" />
                <span>المزودات ومحرك المطابقة الذكي (Provider Matching)</span>
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                يعرض هذا القسم المزودات المسجلة في النظام، وحالة المحولات الخاصة بها، وعدد مصادر التشغيل الفعلية المحفوظة.
              </p>
              <button
                onClick={() => setActiveTab('providers')}
                className="px-4 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-xs font-semibold text-slate-200 transition-colors cursor-pointer"
              >
                عرض تفاصيل المزودات
              </button>
            </div>

            <div className="p-6 rounded-3xl bg-white/[0.02] border border-white/[0.06] space-y-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-amber-400" />
                <span>مزامنة TMDB والذاكرة المؤقتة (Metadata Pipeline)</span>
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                جلب البيانات الوصفية، طواقم التمثيل، والبوسترات الرسمية بدقة عالية وتخزينها في قاعدة بيانات موفيزا المحلية.
              </p>
              <button
                onClick={handleTriggerSync}
                disabled={isSyncing}
                className="px-4 py-2 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs hover:bg-amber-400 transition-colors cursor-pointer disabled:opacity-50"
              >
                {isSyncing ? 'جاري المزامنة...' : t('triggerSync')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Movies Management */}
      {activeTab === 'movies' && (
        <div className="space-y-4 animate-in fade-in">
          <div className="flex items-center justify-between gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute rtl:right-3 ltr:left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="بحث في قائمة الأفلام..."
                className="w-full h-10 rtl:pr-9 rtl:pl-4 ltr:pl-9 ltr:pr-4 bg-white/[0.04] border border-white/[0.1] rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
              />
            </div>
            <span className="text-xs text-slate-400 tabular-nums">
              {filteredMovies.length} فيلم
            </span>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-white/[0.08]">
            <table className="w-full text-start text-xs">
              <thead className="bg-white/[0.03] text-slate-400 border-b border-white/[0.08]">
                <tr>
                  <th className="py-3 px-4 text-start">الفيلم</th>
                  <th className="py-3 px-4 text-start">السنة</th>
                  <th className="py-3 px-4 text-start">التقييم</th>
                  <th className="py-3 px-4 text-start">السيرفرات</th>
                  <th className="py-3 px-4 text-start">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filteredMovies.map((movie) => (
                  <tr key={movie.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <img
                          src={movie.posterUrl}
                          alt={movie.title}
                          referrerPolicy="no-referrer"
                          className="w-8 h-12 object-cover rounded-lg shrink-0"
                        />
                        <div>
                          <p className="font-bold text-white">{movie.title}</p>
                          <p className="text-[11px] text-slate-400">{movie.titleEn}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono">{movie.year}</td>
                    <td className="py-3 px-4 text-amber-400 font-bold font-mono">
                      ★ {movie.rating.toFixed(1)}
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-slate-300 font-mono">
                        {movie.sources.length} سيرفرات
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => onNavigate(`/movies/${movie.id}`)}
                          className="p-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-slate-300 hover:text-white"
                          title="عرض الفيلم"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() =>
                            setDeleteCandidate({ id: movie.id, title: movie.title })
                          }
                          className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400"
                          title="حذف من المنصة"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab: Video Providers & Adapters (PDF Sections 10-12) */}
      {activeTab === 'providers' && (
        <div className="space-y-6 animate-in fade-in">
          <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
            <strong>طبقة المحولات (Provider Adapters):</strong> عزل التوافق التقني للمزودين عن الواجهة وتقديم مصادر موحدة (Normalized Sources) للمشغل بدون تسريب هويات المزودين الداخلية للمستخدم.
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {providers.map((prov) => (
              <div
                key={prov.id}
                className="p-5 rounded-2xl bg-white/[0.02] border border-white/[0.06] space-y-4"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-white">{prov.name}</h4>
                    <p className="text-[11px] font-mono text-slate-400">{prov.adapterName}</p>
                  </div>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                      prov.status === 'healthy'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-amber-500/20 text-amber-400'
                    }`}
                  >
                    {prov.status === 'healthy' ? 'نشط وسريع' : 'بطء مؤقت'}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center text-xs py-2 bg-white/[0.02] rounded-xl">
                  <div>
                    <span className="text-[10px] text-slate-500 block">الاستجابة</span>
                    <span className="font-mono font-bold text-white tabular-nums">
                      {prov.latencyMs} ms
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 block">نسبة النجاح</span>
                    <span className="font-mono font-bold text-emerald-400 tabular-nums">
                      {prov.successRate}%
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 block">المصادر النشطة</span>
                    <span className="font-mono font-bold text-white tabular-nums">
                      {prov.activeSources}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-[10px] text-slate-400">
                    آخر فحص: {prov.lastChecked}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleTestProvider(prov.id)}
                      className="px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs font-semibold text-slate-200 transition-colors cursor-pointer"
                    >
                      {t('testConnection')}
                    </button>
                    {isOwner && (
                      <button
                        onClick={() => handleToggleProvider(prov)}
                        className="px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs font-semibold text-slate-200 transition-colors cursor-pointer"
                      >
                        {prov.enabled ? 'تعطيل' : 'تفعيل'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab: Sync System & Cache */}
      {activeTab === 'sync' && (
        <div className="space-y-6 animate-in fade-in">
          <div className="p-6 rounded-3xl bg-white/[0.02] border border-white/[0.06] space-y-4">
            <h3 className="text-base font-bold text-white">
              سجل مزامنة البيانات الوصفية
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed max-w-2xl">
              كل عملية مزامنة تسجل حالة البدء والنجاح أو الفشل وعدد الأفلام والمسلسلات والمواسم والحلقات التي عولجت. التنفيذ الحالي محمي بالتعامل مع الأخطاء وإعادة المحاولة مع TMDB.
            </p>
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleTriggerSync}
                disabled={isSyncing}
                className="px-5 py-2.5 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs hover:bg-amber-400 transition-colors cursor-pointer disabled:opacity-50"
              >
                {isSyncing ? 'جاري الفحص والمزامنة...' : 'مزامنة الكتالوج الآن'}
              </button>
              <button
                onClick={handleEpisodeSync}
                disabled={isEpisodeSyncing}
                className="px-4 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-xs font-medium text-slate-300 transition-colors cursor-pointer disabled:opacity-50"
              >
                {isEpisodeSyncing ? 'جاري مزامنة الحلقات...' : 'مزامنة المواسم والحلقات'}
              </button>

              <button
                onClick={() => {
                  showToast('المحتوى الحالي يقرأ من قاعدة البيانات؛ لا يوجد كاش محلي وهمي.');
                }}
                className="px-4 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-xs font-medium text-slate-300 transition-colors cursor-pointer"
              >
                حالة الكاش
              </button>
            </div>
          {syncJobs.length > 0 && (
            <div className="rounded-2xl border border-white/[0.08] overflow-x-auto">
              <table className="w-full text-xs text-start">
                <thead className="bg-white/[0.03] text-slate-400">
                  <tr>
                    <th className="py-3 px-4 text-start">النوع</th>
                    <th className="py-3 px-4 text-start">الحالة</th>
                    <th className="py-3 px-4 text-start">النتائج</th>
                    <th className="py-3 px-4 text-start">التاريخ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {syncJobs.slice(0, 10).map((job) => (
                    <tr key={job.id}>
                      <td className="py-3 px-4 font-medium text-white">{job.provider} / {job.jobType}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-1 rounded-lg ${job.status === 'succeeded' ? 'bg-emerald-500/10 text-emerald-400' : job.status === 'failed' ? 'bg-rose-500/10 text-rose-400' : 'bg-amber-500/10 text-amber-400'}`}>
                          {job.status}
                        </span>
                        {job.error && <p className="mt-1 text-[10px] text-rose-400 max-w-xs">{job.error}</p>}
                      </td>
                      <td className="py-3 px-4 text-slate-300">
                        {job.moviesSynced} أفلام · {job.seriesSynced} مسلسلات · {job.episodesSynced} حلقات
                      </td>
                      <td className="py-3 px-4 text-slate-500 font-mono">{job.finishedAt || job.startedAt || job.createdAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          </div>
        </div>
      )}

      {/* Tab: Audit Logs (Section 13) */}
      {activeTab === 'audit' && (
        <div className="space-y-4 animate-in fade-in">
          <div className="overflow-x-auto rounded-2xl border border-white/[0.08]">
            <table className="w-full text-start text-xs">
              <thead className="bg-white/[0.03] text-slate-400 border-b border-white/[0.08]">
                <tr>
                  <th className="py-3 px-4 text-start">الوقت والتاريخ</th>
                  <th className="py-3 px-4 text-start">المستخدم</th>
                  <th className="py-3 px-4 text-start">الإجراء</th>
                  <th className="py-3 px-4 text-start">الهدف</th>
                  <th className="py-3 px-4 text-start">عنوان IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-white/[0.02]">
                    <td className="py-3 px-4 font-mono text-slate-400">{log.timestamp}</td>
                    <td className="py-3 px-4 font-medium text-white">{log.userEmail}</td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 font-semibold">
                        {language === 'ar' ? log.action : log.actionEn}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-300">{log.target}</td>
                    <td className="py-3 px-4 font-mono text-slate-500">{log.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Confirmation Dialog for Destructive Action (Requirement 24) */}
      {deleteCandidate && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-[#0f121a] border border-white/[0.1] rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-2xl">
            <div className="flex items-center gap-3 text-rose-400">
              <AlertTriangle className="w-6 h-6" />
              <h3 className="text-base font-bold text-white">{t('confirmDelete')}</h3>
            </div>
            <p className="text-xs text-slate-300">
              هل أنت متأكد من رغبتك في حذف عمل «{deleteCandidate.title}»؟ هذا الإجراء لا يمكن التراجع عنه وسيتم تسجيله في سجل الأمان.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setDeleteCandidate(null)}
                className="px-4 py-2 rounded-xl bg-white/[0.06] text-slate-300 text-xs font-semibold hover:bg-white/[0.1] cursor-pointer"
              >
                {t('cancel')}
              </button>
              <button
                onClick={handleDeleteConfirm}
                className="px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-400 text-white font-bold text-xs shadow-lg shadow-rose-500/20 cursor-pointer"
              >
                {t('delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
