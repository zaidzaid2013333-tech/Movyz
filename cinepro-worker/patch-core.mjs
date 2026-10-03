import fs from 'node:fs';

const tmdbPath = new URL('./core/src/services/tmdb.service.ts', import.meta.url);
let tmdb = fs.readFileSync(tmdbPath, 'utf8');

const marker = "    private readonly cacheTTL: number\n";
const helper = [
  "    private readonly cacheTTL: number",
  "",
  "    private async tmdbFetch(url: string): Promise<Response> {",
  "        const value = this.apiKey.trim()",
  "        if (/^eyJ[A-Za-z0-9_-]+\\./.test(value)) {",
  "            return fetch(url, { headers: { Authorization: 'Bearer ' + value } })",
  "        }",
  "        const separator = url.includes('?') ? '&' : '?'",
  "        return fetch(url + separator + 'api_key=' + encodeURIComponent(value))",
  "    }",
  ""
].join("\n");
if (tmdb.includes(marker)) {
  tmdb = tmdb.replace(marker, helper);
}
tmdb = tmdb.replaceAll('await fetch(`${this.baseUrl}', 'await this.tmdbFetch(`${this.baseUrl');
tmdb = tmdb.replaceAll('?api_key=${this.apiKey}`', '`');
tmdb = tmdb.replaceAll('&api_key=${this.apiKey}`', '`');
fs.writeFileSync(tmdbPath, tmdb);

const vidzeePath = new URL('./core/src/providers/vidzee/decrypt.ts', import.meta.url);
let vidzee = fs.readFileSync(vidzeePath, 'utf8');
vidzee = vidzee.replace("            keyBytes,", "            keyBytes as unknown as BufferSource,");
vidzee = vidzee.replace("            cipherBytes", "            cipherBytes as unknown as BufferSource");
vidzee = vidzee.replace("{ name: 'AES-CBC', iv },", "{ name: 'AES-CBC', iv: iv as unknown as BufferSource },");
vidzee = vidzee.replace("                iv: n,", "                iv: n as unknown as BufferSource,");
vidzee = vidzee.replace("            i", "            i as unknown as BufferSource");
fs.writeFileSync(vidzeePath, vidzee);

console.log('CinePro compatibility patches applied');
