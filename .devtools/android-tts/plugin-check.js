const P = window.Capacitor?.Plugins?.NativeTts;
const out = { url: location.href, webSpeech: 'speechSynthesis' in window, platform: window.Capacitor?.getPlatform?.(), plugin: !!P };
if (!P) return out;
for (let i = 0; i < 20; i++) { out.avail = await P.isAvailable(); if (out.avail.available) break; await new Promise((r) => setTimeout(r, 300)); }
const starts = [];
const h = await P.addListener('start', (e) => starts.push({ id: e.id, t: Date.now() }));
const t0 = Date.now();
const r = await P.speak({ text: '잽, 크로스, 훅', id: 'qa1', rate: 1, flush: true });
out.speak = { result: r, ms: Date.now() - t0, started: starts.map((s) => ({ id: s.id, after: s.t - t0 })) };
const p1 = P.speak({ text: '이 문장은 길게 이어지는 안내 문장입니다. 중간에 끊겨야 합니다.', id: 'qa2', rate: 1, flush: true });
await new Promise((r) => setTimeout(r, 400));
const r3 = await P.speak({ text: '스프롤', id: 'qa3', rate: 1, flush: true });
out.interrupt = { first: await p1, second: r3 };
await h.remove();
return out;
