import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useT, type TKey } from '@/i18n';
import type { ConnectionQualityMetrics, QualityLevel } from '@/utils/callQuality';

// ─── Connection Indicator ────────────────────────────────────────────────────
// Presentational signal-bars icon showing outbound (uplink) connection quality.

const QUALITY_KEY: Record<QualityLevel, TKey> = {
  good: 'call.qualityGood',
  medium: 'call.qualityMedium',
  poor: 'call.qualityPoor',
  unknown: 'call.qualityUnknown',
};

export function ConnectionIndicator({ metrics }: { metrics?: ConnectionQualityMetrics }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<
    {
      top: number; left: number; host: HTMLElement; clamped: boolean;
      // M6 T12: `left` is the tooltip's centre AFTER clamping; `anchorLeft` is
      // the indicator's centre, which clamping must not move. `arrowLeft` is the
      // difference, expressed in the tooltip's own coordinates.
      anchorLeft: number; arrowLeft: number | null;
    } | null
  >(null);

  const showTip = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Центрируем над индикатором; фиксированное позиционирование не режется
    // overflow:hidden плитки. Стрелка тултипа смотрит вниз, на индикатор.
    //
    // Портал в document.body невидим, пока какой-то элемент находится в
    // полноэкранном режиме: top layer показывает только сам fullscreen-элемент
    // и его потомков. Кнопка «на весь экран» в шапке (решение 24) делает
    // фуллскрин всей сцены, а вместе с ним — целую сетку наводимых .stage-conn,
    // поэтому цель портала выбирается заново на каждом наведении.
    const host = (document.fullscreenElement as HTMLElement | null) ?? document.body;
    const anchorLeft = r.left + r.width / 2;
    setTip({ top: r.top - 8, left: anchorLeft, host, clamped: false, anchorLeft, arrowLeft: null });
  }, []);
  const hideTip = useCallback(() => setTip(null), []);

  // Наведение — не единственный момент, когда цель портала может устареть:
  // фуллскрин можно включить (F11, кнопка в шапке) или выйти по Esc, пока
  // тултип уже открыт, и тогда он остался бы в прежнем хосте. Пересчитываем
  // хост и позицию на fullscreenchange, пока тултип на экране.
  //
  // resize здесь обязателен, а не «на всякий случай»: вьюпорт меняет размер
  // ПОСЛЕ fullscreenchange, отдельным кадром. Замерено — без этого слушателя
  // прижатие считалось по старой высоте и тултип оказывался за нижней кромкой
  // (bottom 637.3 при innerHeight 544).
  const tipOpen = tip !== null;
  useEffect(() => {
    if (!tipOpen) return;
    const reposition = () => showTip();
    document.addEventListener('fullscreenchange', reposition);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('fullscreenchange', reposition);
      window.removeEventListener('resize', reposition);
    };
  }, [tipOpen, showTip]);

  // Тултип у верхней кромки сцены уезжал за край вьюпорта (замерено: y = -46.5
  // при высоте 120.5). Прижимаем его к вьюпорту по факту измерения. Считаем
  // аналитически из РАЗМЕРА: при transform translate(-50%, -100%) края равны
  // left ± w/2 и [top - h, top], а вход анимируется трансформом — читать
  // позицию живого rect во время анимации значило бы мерить смещение анимации.
  useLayoutEffect(() => {
    if (!tip || tip.clamped) return;
    const el = tipRef.current;
    if (!el) return;
    const { width: w, height: h } = el.getBoundingClientRect();
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let { top, left } = tip;
    if (top - h < margin) top = margin + h;
    if (top > vh - margin) top = vh - margin;
    if (left - w / 2 < margin) left = margin + w / 2;
    if (left + w / 2 > vw - margin) left = vw - margin - w / 2;
    // M6 T12: the arrow is `left: 50%` in CSS, i.e. the centre of the TOOLTIP.
    // The two horizontal clamps above move the tooltip without moving the
    // indicator, so as soon as either fired the arrow pointed at empty stage
    // instead of at the chip it belongs to. Re-aim it at the anchor, in the
    // tooltip's own coordinates, and keep it clear of the tooltip's rounded
    // corners. 8px is the arrow's HALF-DIAGONAL rounded up, not half its width:
    // the square is rotate(45deg), so its rendered half-width is
    // 10 / 2 * √2 ≈ 7.07px, and anything under that lets a corner poke out.
    // Set unconditionally: with no clamping this evaluates to exactly w / 2,
    // which is what `left: 50%` already produced — one code path, not two.
    // An inline style rather than a custom property on purpose: a
    // `var(--tip-arrow-x)` would be undeclared to stylelint's
    // value-no-unknown-custom-properties, and giving it a fallback to silence
    // that is precisely what blinds M6 T13's audit gate.
    const arrowLeft = Math.min(w - 8, Math.max(8, tip.anchorLeft - (left - w / 2)));
    setTip({ ...tip, top, left, clamped: true, arrowLeft });
  }, [tip]);

  if (!metrics) return null;
  const { level, packetLoss, rtt, bitrate } = metrics;
  const label = t(QUALITY_KEY[level]);
  const ariaLabel =
    level === 'unknown'
      ? label
      : `${label} · ${t('call.qualityLoss')}: ${packetLoss}${t('call.unitPercent')} · ` +
        `${t('call.qualityPing')}: ${rtt} ${t('call.unitMs')} · ` +
        `${t('call.qualityBitrate')}: ${bitrate} ${t('call.unitKbps')}`;

  return (
    <div
      ref={ref}
      className={`stage-conn is-${level}`}
      aria-label={ariaLabel}
      onMouseEnter={showTip}
      onMouseLeave={hideTip}
    >
      <span className="stage-conn-bar" />
      <span className="stage-conn-bar" />
      <span className="stage-conn-bar" />
      {tip &&
        createPortal(
          <div
            ref={tipRef}
            className={`stage-tip is-${level}`}
            style={{ top: tip.top, left: tip.left }}
            role="tooltip"
          >
            <div className="stage-tip-head">
              <span className="stage-tip-dot" />
              <span className="stage-tip-title">{label}</span>
            </div>
            {level !== 'unknown' && (
              <div className="stage-tip-rows">
                <div className="stage-tip-row">
                  <span className="stage-tip-key">{t('call.qualityLoss')}</span>
                  <span className="stage-tip-val">{packetLoss}{t('call.unitPercent')}</span>
                </div>
                <div className="stage-tip-row">
                  <span className="stage-tip-key">{t('call.qualityPing')}</span>
                  <span className="stage-tip-val">{rtt} {t('call.unitMs')}</span>
                </div>
                <div className="stage-tip-row">
                  <span className="stage-tip-key">{t('call.qualityBitrate')}</span>
                  <span className="stage-tip-val">{bitrate} {t('call.unitKbps')}</span>
                </div>
              </div>
            )}
            <span
              className="stage-tip-arrow"
              style={tip.arrowLeft === null ? undefined : { left: tip.arrowLeft }}
            />
          </div>,
          tip.host,
        )}
    </div>
  );
}
