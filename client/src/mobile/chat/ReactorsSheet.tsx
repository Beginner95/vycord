import { BottomSheet } from '@/mobile/sheets/BottomSheet';
import { useT } from '@/i18n';
import { resolveUploadUrl } from '@/services/api';
import type { MemberWithUser, Reaction } from '@/types';
import './QuickReactions.css';

/** Кто поставил реакцию — мобильная замена тултипа (long-press по пилюле). */
export function ReactorsSheet({ reaction, members, onClose }: { reaction: Reaction | null; members: MemberWithUser[]; onClose: () => void }) {
  const t = useT();
  if (!reaction) return null;
  const byId = new Map(members.map((m) => [m.user_id, m.username]));
  return (
    <BottomSheet open onClose={onClose} title={t('chat.reactionsTitle')}>
      <div className="reactors-sheet-head">
        {reaction.sticker
          ? <img className="reactors-sheet-sticker" src={resolveUploadUrl(reaction.sticker.image_url)} alt={reaction.sticker.name} />
          : <span className="reactors-sheet-emoji">{reaction.emoji ?? reaction.key}</span>}
      </div>
      <ul className="reactors-sheet-list">
        {(reaction.user_ids ?? []).filter((id) => byId.has(id)).map((id) => (
          <li key={id} className="reactors-sheet-item">{byId.get(id)}</li>
        ))}
      </ul>
    </BottomSheet>
  );
}
