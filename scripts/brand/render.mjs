import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { pip } from './pip.mjs';
// Regenerates the Pip app icons and the share image. Playwright is not a project dependency: run with
//   npx --yes playwright@1.56.0 install chromium && node scripts/brand/render.mjs
// Writes into the current directory; copy the PNGs to public/icons/ and public/og.png.
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const render = async (html, w, h, out) => {
  const p = await (await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })).newPage();
  await p.setContent(`<!doctype html><html><head><style>html,body{margin:0;background:transparent}</style></head><body>${html}</body></html>`);
  await p.waitForTimeout(150);
  await p.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
};
// App icon: Pip big and close on the brand blue, cropped at the feet so the face carries the icon at 48px.
// The maskable version keeps the face inside the central 80% safe zone.
const icon = (size, maskable) => {
  const scale = maskable ? 0.92 : 1.08;
  const top = maskable ? size * 0.04 : size * -0.02;
  return `<div style="width:${size}px;height:${size}px;border-radius:${maskable ? 0 : size * 0.22}px;background:linear-gradient(160deg,#4d8bf0 0%,#2e6fe8 55%,#1f4fb8 100%);position:relative;overflow:hidden">
    <div style="position:absolute;inset:0;background:radial-gradient(circle at 50% 28%,rgba(255,255,255,.34) 0,rgba(255,255,255,0) 56%)"></div>
    <div style="position:absolute;left:50%;top:${top}px;transform:translateX(-50%);filter:drop-shadow(0 ${size * 0.03}px ${size * 0.06}px rgba(10,30,80,.35))">${pip(size * scale, { mood: 'wave', flower: false })}</div></div>`;
};
for (const [size, name, maskable] of [[192, 'nutrienttrack-192.png', false], [512, 'nutrienttrack-512.png', false], [192, 'nutrienttrack-192-maskable.png', true], [512, 'nutrienttrack-512-maskable.png', true], [180, 'apple-touch-icon.png', true]]) {
  await render(icon(size, maskable), size, size, name);
}
// Share image 1200x630
const og = `<div style="width:1200px;height:630px;background:linear-gradient(135deg,#effaf2 0%,#ffffff 55%,#eaf1fe 100%);font-family:'IBM Plex Sans',Inter,system-ui,sans-serif;display:flex;align-items:center;padding:0 90px;box-sizing:border-box;gap:60px;position:relative;overflow:hidden">
  <div style="position:absolute;right:-80px;top:-120px;width:620px;height:620px;border-radius:50%;background:radial-gradient(circle,#cdeed7 0,rgba(205,238,215,0) 70%)"></div>
  <div style="flex:1 1 auto;position:relative">
    <div style="display:inline-flex;align-items:center;gap:12px;font-weight:700;font-size:30px;color:#101828"><span style="display:grid;place-items:center;width:44px;height:44px;border-radius:12px;background:#2e6fe8;color:#fff;font-size:24px">N</span>NutrientTrack</div>
    <h1 style="margin:28px 0 18px;font-size:64px;line-height:1.08;letter-spacing:-.02em;color:#101828;max-width:640px">Free calorie tracking that stays on your phone.</h1>
    <p style="margin:0;font-size:30px;line-height:1.35;color:#475467">No ads, no account, barcode scanner included.<br>Your diary never leaves your device.</p>
    <p style="margin:34px 0 0;font-size:28px;font-weight:700;color:#2e6fe8">nutrienttrack.com</p>
  </div>
  <div style="flex:0 0 auto;position:relative;filter:drop-shadow(0 18px 30px rgba(16,24,40,.18))">${pip(330, { mood: 'wave', flower: true })}</div>
</div>`;
await render(og, 1200, 630, 'og.png');
await b.close();
