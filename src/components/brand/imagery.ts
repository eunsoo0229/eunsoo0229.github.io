// Brand imagery. Two sets:
//  - redesign/*: renders of MARTIALDEX's own 3D fighter model posed by the project's motion-capture
//    clips (.devtools/render-brand-images.mjs) — discipline plates, auth, banners;
//  - ko/*: the KO-style key visuals the user supplied (2026-11-16) for the Home cover and the four
//    platform categories (GYM / MARKET / COMMUNITY / AI COACH).
//  - arts/*: one bout photo per discipline, supplied by the user (2026-11-17, "무술 사진" folder) — the
//    discipline cards and technique headers. The old per-art renders in redesign/ stay for reference.
import heroStrike from '../../assets/brand/redesign/hero-strike.webp';
import heroGuard from '../../assets/brand/redesign/hero-guard.webp';
import artBoxing from '../../assets/brand/redesign/art-boxing.webp';
import artStriking from '../../assets/brand/redesign/art-striking.webp';
import artWrestling from '../../assets/brand/redesign/art-wrestling.webp';
import artGrappling from '../../assets/brand/redesign/art-grappling.webp';
import coachStudy from '../../assets/brand/redesign/coach-study.webp';
import gymFloor from '../../assets/brand/redesign/gym-floor.webp';
import authPortrait from '../../assets/brand/redesign/auth-portrait.webp';
import communityClinch from '../../assets/brand/redesign/community-clinch.webp';
import koHero from '../../assets/brand/ko/hero-fighter.webp';
import koGym from '../../assets/brand/ko/gym.webp';
import koMarket from '../../assets/brand/ko/market.webp';
import koCommunity from '../../assets/brand/ko/community.webp';
import koCoach from '../../assets/brand/ko/ai-coach.webp';
import photoBoxing from '../../assets/brand/arts/boxing.webp';
import photoKickboxing from '../../assets/brand/arts/kickboxing.webp';
import photoMuaythai from '../../assets/brand/arts/muay-thai.webp';
import photoTaekwondo from '../../assets/brand/arts/taekwondo.webp';
import photoKarate from '../../assets/brand/arts/karate.webp';
import photoWrestling from '../../assets/brand/arts/wrestling.webp';
import photoJudo from '../../assets/brand/arts/judo.webp';
import photoSambo from '../../assets/brand/arts/sambo.webp';
import photoBjj from '../../assets/brand/arts/bjj.webp';
import photoMma from '../../assets/brand/arts/mma.webp';

export const IMAGERY = {
  heroStrike, heroGuard, artBoxing, artStriking, artWrestling, artGrappling, coachStudy, gymFloor, authPortrait, communityClinch,
  koHero, koGym, koMarket, koCommunity, koCoach };

/** One photo per discipline (16:9). */
const BY_ART: Record<string, string> = {
  boxing: photoBoxing,
  kickboxing: photoKickboxing,
  'muay-thai': photoMuaythai,
  taekwondo: photoTaekwondo,
  karate: photoKarate,
  wrestling: photoWrestling,
  judo: photoJudo,
  sambo: photoSambo,
  bjj: photoBjj,
  'mixed-martial-arts': photoMma,
};

/** Where the action sits horizontally in each photo (0% = left edge, 100% = right) — the portrait discipline
 * card shows about a third of the frame, so it is centred on the strike/throw instead of empty arena. */
const FOCUS_X: Record<string, number> = {
  boxing: 42,
  kickboxing: 18,
  'muay-thai': 18,
  taekwondo: 34,
  karate: 46,
  wrestling: 50,
  judo: 60,
  sambo: 45,
  bjj: 58,
  'mixed-martial-arts': 30,
};

export function artFocusX(artId: string): number {
  return FOCUS_X[artId] ?? 50;
}

export function artImage(artId: string): string {
  return BY_ART[artId] ?? heroGuard;
}
