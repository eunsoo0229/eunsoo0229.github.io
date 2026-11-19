// 작은 화면 가림 검사 — 브라우저(qa-android-small-screens) · Android WebView(qa-android-emulator-small) 공용.
// 페이지 안에서 실행된다(외부 변수 참조 없음): page.evaluate(inspect) 또는 `(${inspect})()` 문자열로 주입.
export // runs inside the page: returns a list of problems on the current screen
function inspect() {
  const vw = window.innerWidth, vh = window.innerHeight;
  const out = [];
  const desc = (el) => {
    const t = (el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || el.title || '').trim().replace(/\s+/g, ' ').slice(0, 28);
    const cls = typeof el.className === 'string' ? el.className.split(' ').filter(Boolean).slice(0, 2).join('.') : '';
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${t ? ` "${t}"` : ''}`;
  };
  const visible = (el) => {
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none' || parseFloat(s.opacity) < 0.05) return false;
    // content of a collapsed <details> keeps a layout box in Chrome but is not rendered
    const d = el.closest('details:not([open])');
    if (d && !el.closest('summary')) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 6 && r.height >= 6;
  };
  const scrollerX = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/(auto|scroll)/.test(s.overflowX) && p.scrollWidth > p.clientWidth + 1) return p;
    }
    return null;
  };
  const clippedBy = (el) => {
    // an ancestor with overflow hidden/clip that cuts the element off (not a scroller)
    const r = el.getBoundingClientRect();
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/(hidden|clip)/.test(s.overflowX + s.overflowY)) {
        const pr = p.getBoundingClientRect();
        if (r.right > pr.right + 2 || r.left < pr.left - 2 || (/(hidden|clip)/.test(s.overflowY) && (r.bottom > pr.bottom + 2 || r.top < pr.top - 2))) return p;
      }
    }
    return null;
  };
  if (document.documentElement.scrollWidth > vw + 1) out.push(`가로 스크롤 ${document.documentElement.scrollWidth}px > ${vw}px`);

  const fixedOf = (el) => {
    for (let p = el; p && p !== document.documentElement; p = p.parentElement) {
      const pos = getComputedStyle(p).position;
      if (pos === 'fixed' || pos === 'sticky') return p;
    }
    return null;
  };
  const inModal = (el) => !!el.closest('.modal-overlay, [role="dialog"], .shorts');
  const modalOpen = !!document.querySelector('.modal-overlay, [role="dialog"][aria-modal="true"]');

  const controls = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab]')]
    .filter((el) => visible(el) && !el.closest('[aria-hidden="true"]') && (modalOpen ? inModal(el) : true));
  for (const el of controls) {
    const fixedSelf = fixedOf(el);
    let r = el.getBoundingClientRect();
    const sx = scrollerX(el);
    // horizontal: off-screen and not reachable by a horizontal scroller
    if (!sx && (r.left < -1 || r.right > vw + 1)) { out.push(`화면 밖(가로) ${desc(el)} [${Math.round(r.left)}..${Math.round(r.right)}]`); continue; }
    const cb = clippedBy(el);
    if (cb && !sx) { out.push(`부모에 잘림 ${desc(el)} ← ${desc(cb)}`); continue; }
    if (sx) continue;
    if (!fixedSelf) {
      // bring it into view the way a user would, then see what is on top of it
      const docTop = r.top + window.scrollY;
      window.scrollTo(0, Math.max(0, docTop - vh / 2 + r.height / 2));
      r = el.getBoundingClientRect();
    } else if (r.top >= vh || r.bottom <= 0) {
      out.push(`고정 요소가 화면 밖 ${desc(el)} [top ${Math.round(r.top)}]`);
      continue;
    }
    // sample a few points; a control counts as covered only if most of it is unreachable
    const pts = [[0.5, 0.5], [0.2, 0.5], [0.8, 0.5]];
    let hit = 0, coverer = null;
    for (const [fx, fy] of pts) {
      const x = r.left + r.width * fx, y = r.top + r.height * fy;
      if (x < 0 || x >= vw || y < 0 || y >= vh) continue;
      const top = document.elementFromPoint(x, y);
      if (!top || el === top || el.contains(top) || top.contains(el) || (el.labels && [...el.labels].some((l) => l.contains(top)))) hit++;
      else coverer = coverer || top;
    }
    if (hit === 0) {
      const inV = r.bottom > 0 && r.top < vh;
      out.push(inV ? `가려짐 ${desc(el)} ← ${coverer ? desc(fixedOf(coverer) || coverer) : '?'}` : `도달 불가(스크롤 끝에서도 화면 밖) ${desc(el)}`);
    }
  }
  window.scrollTo(0, 0);

  // clipped text (no ellipsis) in visible leaf-ish elements
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (!el.childNodes.length || el.children.length > 3) continue;
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!hasText || !visible(el) || el.closest('[aria-hidden="true"], svg, canvas, textarea, input')) continue;
    if (modalOpen && !inModal(el)) continue;
    const s = getComputedStyle(el);
    if (s.textOverflow === 'ellipsis' || parseInt(s.webkitLineClamp || '0', 10) > 0) continue;
    const hx = /(hidden|clip)/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 2;
    const hy = /(hidden|clip)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 3;
    if (hx || hy) {
      const k = desc(el);
      if (!seen.has(k)) { seen.add(k); out.push(`글자 잘림 ${k} (${hx ? `w ${el.scrollWidth}/${el.clientWidth}` : ''}${hy ? ` h ${el.scrollHeight}/${el.clientHeight}` : ''})`); }
    }
  }

  // fixed chrome must not eat most of the screen
  let fixedH = 0;
  for (const el of document.querySelectorAll('body *')) {
    const s = getComputedStyle(el);
    if (s.position !== 'fixed' || !visible(el) || inModal(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width > vw * 0.6 && r.height < vh * 0.9) fixedH += Math.min(r.bottom, vh) - Math.max(r.top, 0);
  }
  if (fixedH > vh * 0.3) out.push(`고정 바가 화면의 ${Math.round((fixedH / vh) * 100)}% 차지`);
  return out;
}
