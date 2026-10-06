type ExecutionContextLike={waitUntil(promise:Promise<unknown>):void};
type Env={ASSETS:{fetch(request:Request):Promise<Response>};TMDB_API_READ_ACCESS_TOKEN?:string};
const noCache=(r:Response)=>{const h=new Headers(r.headers);h.set('Cache-Control','no-store');return new Response(r.body,{status:r.status,statusText:r.statusText,headers:h});};
export default {async fetch(request:Request,env:Env,_ctx:ExecutionContextLike){const u=new URL(request.url);
 if(u.pathname.startsWith('/tmdb/')){
  const token=env.TMDB_API_READ_ACCESS_TOKEN?.trim(); if(!token)return new Response(JSON.stringify({status_message:'TMDB is not configured'}),{status:503,headers:{'content-type':'application/json'}});
  const target='https://api.themoviedb.org/3/'+u.pathname.slice('/tmdb/'.length)+u.search;
  const upstream=await fetch(target,{headers:{Authorization:'Bearer '+token,accept:'application/json'}});
  const headers=new Headers(upstream.headers); headers.set('Cache-Control','public, max-age=120, s-maxage=900');
  return new Response(upstream.body,{status:upstream.status,statusText:upstream.statusText,headers});
 }
 const asset=await env.ASSETS.fetch(request);
 const u2=new URL(request.url); if(request.method==='GET'&&(u2.pathname==='/'||u2.pathname.endsWith('.html')))return noCache(asset);
 return asset;
}};