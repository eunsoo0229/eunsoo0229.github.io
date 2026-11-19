const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 40 && !document.querySelector('header, .page'); i++) await sleep(500);
// count real native speak calls made by the APP's own code (wrap the bridge, not the plugin proxy)
const calls = [];
const orig = window.Capacitor.nativePromise.bind(window.Capacitor);
window.Capacitor.nativePromise = (plugin, method, opts) => {
  if (plugin === 'NativeTts' && method === 'speak') calls.push({ text: opts.text, flush: opts.flush, at: Date.now() });
  return orig(plugin, method, opts);
};
location.hash = '#/coach/mitt';
for (let i = 0; i < 40 && !document.querySelector('[data-testid="mitt-mode-voice"]'); i++) await sleep(500);
const voiceBtn = document.querySelector('[data-testid="mitt-mode-voice"]');
const out = { voiceDisabled: voiceBtn?.disabled ?? null };
voiceBtn?.click();
const sel = document.querySelector('[data-testid="mitt-art-filter"]');
if (sel) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  setter.call(sel, 'wrestling');
  sel.dispatchEvent(new Event('change', { bubbles: true }));
}
await sleep(800);
document.querySelector('[data-testid="mitt-tab-command"]')?.click();
await sleep(1200);
out.pool = document.querySelector('[data-testid="command-pool-size"]')?.textContent ?? null;
document.querySelector('[data-testid="command-start"]')?.click();
await sleep(16000);
out.call = document.querySelector('[data-testid="command-call"]')?.textContent ?? null;
document.querySelector('[data-testid="command-stop"]')?.click();
out.calls = calls.map((c) => c.text).slice(0, 12);
out.n = calls.length;
return out;
