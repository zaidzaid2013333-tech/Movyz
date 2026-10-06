import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
 define:{'import.meta.env.VITE_MOVYZ_BUILD_ID':JSON.stringify(process.env.MOVYZ_BUILD_ID||'dev')},
 plugins:[react(),tailwindcss(),VitePWA({registerType:'autoUpdate',selfDestroying:true,injectRegister:null,includeAssets:['favicon.ico','pwa-icon.svg'],manifest:{name:'MOVYZA - منصة السينما والدراما',short_name:'MOVYZA',description:'منصة سينمائية عربية تعتمد TMDB كمصدر الكاتالوج',theme_color:'#07090e',background_color:'#07090e',display:'standalone',orientation:'portrait',start_url:'/',icons:[{src:'/pwa-icon.svg',sizes:'192x192 512x512',type:'image/svg+xml',purpose:'any maskable'}]}}),],
 resolve:{alias:{'@':path.resolve(__dirname,'.')}},
});
