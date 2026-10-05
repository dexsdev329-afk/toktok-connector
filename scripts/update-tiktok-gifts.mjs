// Regenerates packages/core/src/gifts/tiktok-gifts-data.ts (built-in TikTok gift list).
// Source: the public gift listing https://streamtoearn.io/gifts. Only TikTok's factual data is kept
// (gift name, value in diamonds, image path on TikTok's CDN p16-webcast.tiktokcdn.com); nothing else
// from the page is copied, and images are never downloaded here (the app fetches them from TikTok).
//   node scripts/update-tiktok-gifts.mjs
import { writeFileSync } from 'node:fs';

const CDN = 'https://p16-webcast.tiktokcdn.com/img/';
const html = await (
  await fetch('https://streamtoearn.io/gifts', { headers: { 'user-agent': 'Mozilla/5.0' } })
).text();
const decode = (s) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
const slug = (name) =>
  name
    .normalize('NFKD')
    .replace(/[^ -~]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'gift';

const re =
  /<div class="gift"[^>]*>\s*<img\s+src="([^"]+)"[\s\S]*?<p class="gift-name">([\s\S]*?)<\/p>\s*<p class="gift-price">\s*([\d\s,.]+)/g;
const seen = new Set();
const rows = [];
for (const [, src, rawName, rawPrice] of html.matchAll(re)) {
  if (!src.startsWith(CDN)) continue;
  const name = decode(rawName).trim();
  const diamonds = Number(rawPrice.replace(/\D/g, '')) || 0;
  const id = `tt-${slug(name)}-${diamonds}`;
  if (!name || seen.has(id)) continue;
  seen.add(id);
  rows.push([name, diamonds, src.slice(CDN.length)]);
}
rows.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
if (rows.length < 100) throw new Error(`Only ${rows.length} gifts found: page format changed?`);
const today = new Date().toISOString().slice(0, 10);
writeFileSync(
  new URL('../packages/core/src/gifts/tiktok-gifts-data.ts', import.meta.url),
  `/**
 * Known TikTok LIVE gifts (all regions): name, value of one unit in diamonds and image path on TikTok's
 * own CDN (${CDN}<path>). Factual data published by TikTok, listed on
 * https://streamtoearn.io/gifts (snapshot of ${today}); images are never copied from that site,
 * the app downloads them from TikTok's CDN when they are first displayed.
 * Regenerate with scripts/update-tiktok-gifts.mjs.
 */
export const TIKTOK_GIFTS_DATA: readonly (readonly [name: string, diamonds: number, imagePath: string])[] = [
${rows.map((r) => `  ${JSON.stringify(r)},`).join('\n')}
];
`,
);
console.log(`${rows.length} gifts written`);
