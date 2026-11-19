import { techniqueNameInArt } from '../techniqueCanonical';
import { motionClipsFor } from '../motion3d/catalog';
import type { TurnPlan } from './router';
import type { TechniquePreview } from './types';

// When the chat shows a 3D demo — decided here by code, never by the model. A preview is attached only for
// techniques the router resolved from the DB (plan.techniques), and only when the learner wants to SEE a movement
// (or a posture/motion explanation is asked for). A technique without a clip is listed with clipId null so the UI
// can say so — another technique's animation is never shown in its place.

const SHOW = /(보여|시연|3\s?d|3디|애니메이션|모션)/i;
const VISUAL = /(동작|움직임|자세|폼|어떻게\s?(치|쳐|차|던지|던져|하는|해)|궤도|궤적|준비\s?동작|회복|회수|차이)/;
const ELIGIBLE = new Set(['technique', 'compare', 'lesson_question', 'general', 'related', 'review']);
const MAX_ITEMS = 2;

export function wantsPreview(text: string): { want: boolean; open: boolean } {
  const show = SHOW.test(text);
  return { want: show || VISUAL.test(text), open: show };
}

export function previewFor(plan: Pick<TurnPlan, 'intent' | 'techniques' | 'art'>, text: string, lessonTechniqueId?: string): TechniquePreview | undefined {
  if (!ELIGIBLE.has(plan.intent)) return undefined;
  const { want, open } = wantsPreview(text);
  if (!want) return undefined;
  const seen = new Set<string>();
  const techniques = plan.techniques.filter((t) => !seen.has(t.id) && seen.add(t.id));
  // in a lesson, "보여줘" with no technique named means the technique being taught
  const ids = techniques.length ? techniques.map((t) => t.id) : lessonTechniqueId ? [lessonTechniqueId] : [];
  if (!ids.length) return undefined;
  const items = ids.slice(0, MAX_ITEMS).map((id) => {
    const t = techniques.find((x) => x.id === id);
    const clip = motionClipsFor(id)[0];
    const n = t ? techniqueNameInArt(t, plan.art ?? t.martialArt) : null;
    return { techniqueId: id, name: n ? n.koreanName || n.name : id, clipId: clip?.clipId ?? null };
  });
  return { items, open };
}
