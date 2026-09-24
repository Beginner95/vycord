import type { Channel } from '@/types';
import type { MobileNav } from '@/mobile/nav/useMobileNav';
import type { AppController } from '@/pages/app/useAppController';

export interface ScreenCtx {
  c: AppController;
  nav: MobileNav;
  joinVoice: (channel: Channel) => void; // вход + экран звонка
}
