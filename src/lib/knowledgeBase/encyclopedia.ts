// Reads the structure of the MARTIALDEX encyclopedia files (data/raw/*.md — the
// source the official technique DB was parsed from) that the parser did not keep:
// sub-headings inside a category ("### 손싸움" under "스탠딩 포지션 / 그립"), the
// category's own paragraph, and the arrow flow charts ("Sprawl → Front Headlock").
// Pure: the caller passes the file text.

export interface EncyclopediaSubsection {
  title: string;
  order: number;
  bullets: string[];
}

export interface EncyclopediaSection {
  number: number | null;
  title: string;
  order: number;
  /** Paragraph text directly under the heading (before any bullet / sub-heading). */
  paragraph: string;
  bullets: string[];
  subsections: EncyclopediaSubsection[];
  flows: string[][];
}

const HEADING = /^(#{1,4})\s+(.*)$/;
const NUMBERED = /^(\d+)(?:\.(\d+))?\.?\s+(.*)$/;

const clean = (s: string) => s.replace(/\*\*/g, '').replace(/\\/g, '').trim();

export function parseEncyclopedia(md: string): EncyclopediaSection[] {
  const lines = md.split('\n');
  const sections: EncyclopediaSection[] = [];
  let sec: EncyclopediaSection | null = null;
  let sub: EncyclopediaSubsection | null = null;
  let para: string[] = [];
  let inFence = false;
  let fence: string[] = [];
  const flushPara = () => {
    if (sec && !sub && !sec.bullets.length && para.length) sec.paragraph = clean(`${sec.paragraph} ${para.join(' ')}`.replace(/\s+/g, ' '));
    para = [];
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (line.startsWith('```')) {
      if (inFence) {
        if (sec && fence.some((l) => l.includes('→'))) sec.flows.push(fence);
        fence = [];
      }
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      fence.push(line);
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      flushPara();
      const level = h[1].length;
      const title = clean(h[2]);
      const n = NUMBERED.exec(title);
      // the un-numbered H1 is the document title
      if (level === 1 && !n) continue;
      // a numbered top heading ("## 4. 싱글 레그", "# 2. 기본 움직임") opens a section; "10.1 기본 컨트롤" and un-numbered ones are sub-headings
      if (n && !n[2]) {
        sec = { number: Number(n[1]), title: clean(n[3]), order: sections.length + 1, paragraph: '', bullets: [], subsections: [], flows: [] };
        sections.push(sec);
        sub = null;
      } else if (sec) {
        sub = { title: n ? clean(n[3]) : title, order: sec.subsections.length + 1, bullets: [] };
        sec.subsections.push(sub);
      }
      continue;
    }
    const b = /^\s*[-*]\s+(.*)$/.exec(line);
    if (b && sec) {
      flushPara();
      (sub ?? sec).bullets.push(clean(b[1]));
      continue;
    }
    if (line.trim() && !/^-{3,}$/.test(line.trim())) para.push(line.trim());
    else flushPara();
  }
  flushPara();
  return sections;
}

export interface FlowEdge {
  /** Alternatives of the source node ("Sprawl / Whizzer" → ["Sprawl", "Whizzer"]). */
  from: string[];
  to: string[];
  /** The flow's first line when it is a situation, not a technique ("Opponent attacks Single"). */
  context: string;
  /** The flow block as written (the quote). */
  quote: string;
}

const nodeNames = (s: string) =>
  s
    .replace(/^[\s│├└─→]+/, '')
    .split(/\s+\/\s+|\s+or\s+/i)
    .map((x) => x.replace(/\(.*?\)/g, '').trim())
    .filter(Boolean);

/** Edges of one flow chart. A branch line ("├─ → X → Y") hangs off the last trunk node. */
export function flowEdges(block: string[]): FlowEdge[] {
  const quote = block.map((l) => l.trim()).filter(Boolean).join(' ');
  const rows = block.filter((l) => l.trim());
  if (!rows.length) return [];
  const edges: FlowEdge[] = [];
  const context = rows[0].replace(/^[\s→]+/, '').trim();
  let trunk: string[] = nodeNames(rows[0]);
  for (const row of rows.slice(1)) {
    const isBranch = /[├└]/.test(row);
    const chain = row.replace(/^[\s│├└─]+/, '').split('→').map((x) => x.trim()).filter(Boolean);
    let prev = trunk;
    for (const node of chain) {
      const names = nodeNames(node);
      if (!names.length) continue;
      edges.push({ from: prev, to: names, context, quote });
      prev = names;
    }
    if (!isBranch) trunk = prev;
  }
  return edges;
}
