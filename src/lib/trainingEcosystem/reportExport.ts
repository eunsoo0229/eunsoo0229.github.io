// Saving a growth report (사양 §3-5 "PDF 또는 이미지").
// - Image: the report drawn as an SVG card (text only, the brand colours) and rasterised to PNG through a canvas —
//   no html2canvas dependency, works the same in the browser, Electron and the Android WebView.
// - PDF: the browser / Electron print dialog ("PDF로 저장") with a print stylesheet that shows only the report.
// - Text: a .txt download of the same content (reportText).

import type { GrowthReport } from './growthReport';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if ((line + ' ' + word).trim().length > max) {
      if (line) out.push(line);
      line = word;
    } else line = `${line} ${word}`.trim();
  }
  if (line) out.push(line);
  return out;
}

/** The report as an SVG document (1080 px wide). Pure — testable without a DOM. */
export function reportSvg(r: GrowthReport, title: string): { svg: string; width: number; height: number } {
  const W = 1080;
  const lines: { text: string; size: number; color: string; weight?: number; gap?: number }[] = [];
  const add = (text: string, size: number, color: string, weight = 400, gap = 0) => wrap(text, Math.floor((W - 120) / (size * 0.92))).forEach((t, i) => lines.push({ text: t, size, color, weight, gap: i === 0 ? gap : 0 }));
  add('MARTIALDEX', 22, '#c4ad7c', 700);
  add(title, 40, '#f4f1ea', 700, 8);
  add(`분석 기간 ${r.period} · ${r.source === 'ai' ? 'AI 해석 (근거 인용 확인)' : '규칙 기반 해석'}`, 20, '#8c8f96', 400, 6);
  add(r.activitySummary, 24, '#e8e3d8', 400, 28);
  const sec = (h: string, xs: { text: string; facts: string[] }[]) => {
    if (!xs.length) return;
    add(h, 26, '#c4ad7c', 700, 28);
    for (const x of xs) add(`· ${x.text}  [${x.facts.join(', ')}]`, 22, '#e8e3d8', 400, 8);
  };
  sec('주요 개선 사항', r.improvements);
  sec('개선이 필요한 영역', r.needsWork);
  sec('정체 · 확인 필요', r.plateaus);
  sec('다음 주 추천 학습 목표', r.nextWeek);
  add('근거 기록', 24, '#c4ad7c', 700, 28);
  for (const f of r.facts.slice(0, 10)) add(`${f.id}. ${f.text}`, 18, '#8c8f96', 400, 6);
  if (r.notes.length) add(`※ ${r.notes.join(' ')}`, 18, '#8c8f96', 400, 18);
  let y = 72;
  const texts = lines.map((l) => {
    y += l.size * 1.45 + (l.gap ?? 0);
    return `<text x="60" y="${y}" font-size="${l.size}" font-weight="${l.weight ?? 400}" fill="${l.color}" font-family="Pretendard, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif">${esc(l.text)}</text>`;
  });
  const H = Math.ceil(y + 72);
  return {
    width: W,
    height: H,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#0a0a0b"/><rect x="24" y="24" width="${W - 48}" height="${H - 48}" fill="none" stroke="rgba(196,173,124,0.45)"/>${texts.join('')}</svg>`,
  };
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function saveReportImage(r: GrowthReport, title: string): Promise<{ ok: boolean; message: string }> {
  try {
    const { svg, width, height } = reportSvg(r, title);
    const img = new Image();
    const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('이미지 변환 실패'));
      img.src = src;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { ok: false, message: '이 기기에서는 이미지로 저장할 수 없습니다.' };
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) return { ok: false, message: '이미지를 만들지 못했습니다.' };
    download(blob, `martialdex-growth-report-${r.generatedAt.slice(0, 10)}.png`);
    return { ok: true, message: '이미지로 저장했습니다.' };
  } catch (e) {
    return { ok: false, message: `이미지로 저장하지 못했습니다: ${(e as Error).message}` };
  }
}

export function saveReportText(text: string, date: string): void {
  download(new Blob([text], { type: 'text/plain;charset=utf-8' }), `martialdex-growth-report-${date}.txt`);
}

/** Print dialog → "PDF로 저장". The page's print stylesheet hides everything except `.eco-print-area`. */
export function printReport(): void {
  document.body.classList.add('eco-printing');
  const done = () => {
    document.body.classList.remove('eco-printing');
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}
