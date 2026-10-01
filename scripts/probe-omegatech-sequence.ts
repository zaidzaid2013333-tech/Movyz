const base='https://api.omegatech.app';
const steps=[
  {action:'search',query:'Inception'},
  {action:'content',url:'https://akwam.ss/movie/562/inception-1'}
];
for(const step of steps){
 const u=new URL('/api/movie/Akwam',base); for(const [k,v] of Object.entries(step)) u.searchParams.set(k,v);
 const r=await fetch(u); const b=await r.text(); console.log(JSON.stringify({step,status:r.status,body:b.slice(0,5000)}));
}
const c=new URL('/api/movie/Akwam',base); c.searchParams.set('action','content'); c.searchParams.set('url','https://akwam.ss/movie/562/inception-1');
const cb=await (await fetch(c)).json();
const urls=[];
const visit=(x,d=0)=>{if(d>8||x==null)return;if(typeof x==='string'){if(/^https?:\/\//.test(x))urls.push(x);return;} if(Array.isArray(x)){for(const v of x)visit(v,d+1);return;} if(typeof x==='object')for(const v of Object.values(x))visit(v,d+1)};
visit(cb);
for(const u0 of [...new Set(urls)].slice(0,15)) console.log(JSON.stringify({candidate:u0}));
