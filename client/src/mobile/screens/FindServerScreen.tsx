import type { Server } from '@/types';
import { useT } from '@/i18n';
import { FormScreen } from '@/mobile/components/FormScreen';
import { FindServerBody } from '@/components/FindServerBody';
import './FindServerScreen.css';

/** onDone тела — намеренно no-op. Тело зовёт его после входа и перед «создать
 *  свой», но на мобильном навигацию ведёт контроллер (событие serverOpened:
 *  MobileShell делает switchTab('servers') + push(channels)) и явный push хоста
 *  (createServer поверх findServer). nav.back() асинхронен (navigate(-1)) и
 *  гонялся бы с ними по истории: popstate пришёл бы после push и вернул бы
 *  предыдущую запись либо снял свежий стек каналов. Ручной выход один —
 *  «назад» в шапке FormScreen (onBack). */
const noop = () => {};

export function FindServerScreen({ onJoinServer, onServerJoined, onCreateServer, onBack }: {
  onJoinServer: (server: Server) => void;
  onServerJoined: (server: Server) => void;
  onCreateServer: () => void;
  onBack: () => void;
}) {
  const t = useT();
  return (
    <FormScreen title={t('server.findServer.title')} onBack={onBack}>
      <FindServerBody
        active
        onJoinServer={onJoinServer}
        onServerJoined={onServerJoined}
        onDone={noop}
        onCreateServer={onCreateServer}
      />
    </FormScreen>
  );
}
