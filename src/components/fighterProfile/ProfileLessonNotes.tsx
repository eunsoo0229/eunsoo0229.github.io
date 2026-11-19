import { Glyph } from '../Icon';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { Technique } from '../../types';
import { lessonProfileNotes } from '../../lib/fighterProfile/personalize';

/** 내 파이터 프로필 반영 — profile-based notes for this lesson (both coaches). Renders nothing when none apply. */
export default function ProfileLessonNotes({ martialArt, technique, topic }: { martialArt?: string | null; technique?: Technique | null; topic?: string | null }) {
  const notes = useMemo(() => lessonProfileNotes({ martialArt, technique, topic }), [martialArt, technique?.id, topic]);
  if (!notes.length) return null;
  return (
    <div className="fp-lesson-notes" data-testid="profile-lesson-notes">
      <strong><Glyph set="ai" name="fighter-profile" /> 내 파이터 프로필 반영</strong>
      <ul>
        {notes.map((n) => (
          <li key={n.text}>{n.text}</li>
        ))}
      </ul>
      <Link to="/fighter-profile" className="fp-lesson-notes__link">
        프로필 보기·고치기
      </Link>
    </div>
  );
}
