/** Известные UA-маркеры in-app браузеров (Instagram/Facebook/TikTok/WeChat/
 *  Line) — эти вебвью часто блокируют getUserMedia на уровне хост-приложения,
 *  и гость получает `denied` без объяснения причины (спека §7). */
const MARKERS = ['Instagram', 'FBAN', 'FBAV', 'TikTok', 'MicroMessenger', 'Line/'];

export function isInAppBrowser(ua: string = navigator.userAgent): boolean {
  return MARKERS.some((m) => ua.includes(m));
}
