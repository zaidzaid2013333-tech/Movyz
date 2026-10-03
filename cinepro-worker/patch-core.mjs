import fs from 'node:fs';

const tmdbPath = new URL('./node_modules/@omss/framework/dist/services/tmdb.service.js', import.meta.url);
let tmdb = fs.readFileSync(tmdbPath, 'utf8');

const tmdbHelper = [
  "const tmdbFetch = (credential, url) => {",
  "  const value = String(credential || '').trim()",
  "  if (value.startsWith('eyJ') && value.split('.').length >= 3) return fetch(url, { headers: { Authorization: 'Bearer ' + value } })",
  "  const separator = url.includes('?') ? '&' : '?'",
  "  return fetch(url + separator + 'api_key=' + encodeURIComponent(value))",
  "}",
  ""
].join("\n");
if (!tmdb.includes('const tmdbFetch =')) {
  tmdb = tmdb.replace('export class TMDBService', tmdbHelper + "\nexport class TMDBService");
}
tmdb = tmdb.replaceAll('fetch(`${this.baseUrl}', 'tmdbFetch(this.apiKey, `${this.baseUrl');
tmdb = tmdb.replaceAll('?api_key=${this.apiKey}`', '`');
tmdb = tmdb.replaceAll('&api_key=${this.apiKey}`', '`');
fs.writeFileSync(tmdbPath, tmdb);
const vidzeePath = new URL('./core/src/providers/vidzee/decrypt.ts', import.meta.url);
let vidzee = fs.readFileSync(vidzeePath, 'utf8');
vidzee = vidzee.replace("            keyBytes,", "            keyBytes as unknown as BufferSource,");
vidzee = vidzee.replace("            cipherBytes", "            cipherBytes as unknown as BufferSource");
vidzee = vidzee.replace("{ name: 'AES-CBC', iv },", "{ name: 'AES-CBC', iv: iv as unknown as BufferSource },");
vidzee = vidzee.replace("                iv: n,", "                iv: n as unknown as BufferSource,");
vidzee = vidzee.replace("            i,", "            i as unknown as BufferSource,");
fs.writeFileSync(vidzeePath, vidzee);

console.log('CinePro compatibility patches applied');
