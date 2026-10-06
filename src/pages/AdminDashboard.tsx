import React,{useEffect,useState}from'react';
import { Database, ExternalLink, ShieldCheck } from 'lucide-react';
import { MovyzaApi } from '../services/api';
import { useLanguage } from '../context/LanguageContext';

export const AdminDashboard:React.FC<{onNavigate:(path:string)=>void}>=({onNavigate})=>{
 const {language}=useLanguage(); const [stats,setStats]=useState<any>(null); const [error,setError]=useState('');
 useEffect(()=>{MovyzaApi.getAdminStats().then(r=>setStats(r.data)).catch(e=>setError(e.message||'Failed'));},[]);
 return <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 space-y-6">
  <div className="flex items-center gap-3"><ShieldCheck className="w-6 h-6 text-amber-400"/><div><h1 className="text-2xl font-bold text-white">{language==='ar'?'لوحة المشرف':'Admin'}</h1><p className="text-xs text-slate-400">{language==='ar'?'الوضع الجديد: TMDB + Supabase + Cloudflare فقط':'New architecture: TMDB + Supabase + Cloudflare only'}</p></div></div>
  {error&&<div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-300">{error}</div>}
  {stats&&<div className="grid grid-cols-2 md:grid-cols-4 gap-3">{[['Movies',stats.totalMovies],['Series',stats.totalSeries],['Episodes','TMDB live'],['Providers',0]].map(([label,value])=><div key={String(label)} className="rounded-2xl bg-[#0d1017] border border-white/10 p-5"><p className="text-xs text-slate-500">{String(label)}</p><p className="mt-2 text-2xl font-black text-white">{String(value)}</p></div>)}</div>}
  <div className="rounded-2xl bg-[#0d1017] border border-white/10 p-5 space-y-3">
   <div className="flex items-center gap-2 text-white font-semibold"><Database className="w-4 h-4 text-amber-400"/>{language==='ar'?'الكتالوج مصدره TMDB مباشرة':'Catalog is sourced directly from TMDB'}</div>
   <p className="text-sm text-slate-400 leading-7">{language==='ar'?'لا توجد الآن طبقة مزامنة أو backend مخصص أو providers. Supabase يحتفظ بالحسابات وقائمة المشاهدة والتاريخ فقط، وCloudflare يقدّم الواجهة ووكيل TMDB الآمن.':'There is no custom sync backend or provider layer. Supabase stores accounts, watchlist and history; Cloudflare serves the app and securely proxies TMDB.'}</p>
   <button onClick={()=>onNavigate('/')} className="inline-flex items-center gap-2 text-amber-400 text-sm font-bold">{language==='ar'?'العودة للرئيسية':'Back home'}<ExternalLink className="w-4 h-4"/></button>
  </div>
 </div>;
};