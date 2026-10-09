import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
 define:{'import.meta.env.VITE_MOVYZ_BUILD_ID':JSON.stringify(process.env.MOVYZ_BUILD_ID||process.env.VITE_MOVYZ_BUILD_ID||'dev')},
 plugins:[react(),tailwindcss(),VitePWA({registerType:'autoUpdate',selfDestroying:true,filename:'movyza-pwa-sw.js',injectRegister:null,includeAssets:['favicon.png','pwa-icon.svg'],manifest:{name:'Movyza - Free Movies & TV Series',short_name:'Movyza',description:'Watch movies and TV series for free on Movyza. Explore films, series, and new releases online.',theme_color:'#07090e',background_color:'#07090e',display:'standalone',orientation:'portrait',start_url:'/',icons:[{src:'/pwa-icon.svg',sizes:'192x192 512x512',type:'image/svg+xml',purpose:'any maskable'}]}}),],
 resolve:{alias:{'@':path.resolve(__dirname,'.')}},
});
