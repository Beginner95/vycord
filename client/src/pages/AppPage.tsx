import { usePaletteHotkey } from '@/hooks/usePaletteHotkey';
import { useIsMobile } from '@/mobile/breakpoint';
import { MobileShell } from '@/mobile/MobileShell';
import { useAppController } from './app/useAppController';
import { DesktopShell } from './app/DesktopShell';

/** Контроллер живёт выше развилки: смена оболочки на ресайзе не должна
 *  переподписывать WS и перезагружать серверы (спека §1). */
export function AppPage() {
  usePaletteHotkey();
  const isMobile = useIsMobile();
  const c = useAppController({ autoOpenChannel: !isMobile });
  return isMobile ? <MobileShell c={c} /> : <DesktopShell c={c} />;
}
