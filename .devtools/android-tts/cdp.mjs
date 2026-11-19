// minimal CDP client for the Android WebView: node cdp.mjs <file-with-js-expression>
import fs from 'node:fs';
const list = await (await fetch('http://localhost:9333/json')).json();
const target = list.find((t) => t.type === 'page' && t.url.startsWith('http')) ?? list[0];
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const my = ++id;
    const on = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === my) {
        ws.removeEventListener('message', on);
        resolve(m);
      }
    };
    ws.addEventListener('message', on);
    ws.send(JSON.stringify({ id: my, method, params }));
  });
const expr = fs.readFileSync(process.argv[2], 'utf8');
const r = await send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
console.log(target.url, JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails ?? r));
ws.close();
