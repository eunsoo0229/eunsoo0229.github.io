import Icon from '../Icon';
import type { TechniquePreview } from '../../lib/selfAi/types';
import Motion3dDemo from './Motion3dDemo';

// 3D preview inside a chat / lesson answer. Items come from selfAi/preview.ts (DB technique ids only). A technique
// without a clip is stated as such — no other technique's animation is shown in its place.
export default function ChatMotionPreview({ preview }: { preview: TechniquePreview }) {
  return (
    <div className="chat-motion-preview" data-testid="chat-motion-preview">
      {preview.items.map((it) =>
        it.clipId ? (
          <Motion3dDemo key={it.techniqueId} techniqueId={it.techniqueId} defaultOpen={preview.open && preview.items.length === 1} heading={`3D 시연 · ${it.name}`} testId="chat-motion3d-card" />
        ) : (
          <p key={it.techniqueId} className="video-status-message" data-testid="chat-motion3d-missing" data-technique={it.techniqueId}>
            <Icon name="stance" /> {it.name}: 아직 3D 시연이 없습니다.
          </p>
        ),
      )}
    </div>
  );
}
