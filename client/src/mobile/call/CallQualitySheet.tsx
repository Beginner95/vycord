import { BottomSheet } from '@/mobile/sheets/BottomSheet';
import type { ConnectionQualityMetrics, QualityLevel } from '@/utils/callQuality';
import { useT, type TKey } from '@/i18n';
import './CallQualitySheet.css';

const QUALITY_KEY: Record<QualityLevel, TKey> = {
  good: 'call.qualityGood',
  medium: 'call.qualityMedium',
  poor: 'call.qualityPoor',
  unknown: 'call.qualityUnknown',
};

interface CallQualitySheetProps {
  open: boolean;
  onClose: () => void;
  metrics?: ConnectionQualityMetrics;
}

/** Та же таблица строк (потери/пинг/битрейт), что десктопный тултип
 *  `ConnectionIndicator` — только в `BottomSheet`, а не в поповере-тултипе. */
export function CallQualitySheet({ open, onClose, metrics }: CallQualitySheetProps) {
  const t = useT();
  return (
    <BottomSheet open={open} onClose={onClose} title={t('call.qualityDetails')}>
      {metrics ? (
        <div className="call-quality-sheet-body">
          <div className="call-quality-sheet-level">{t(QUALITY_KEY[metrics.level])}</div>
          {metrics.level !== 'unknown' && (
            <div className="call-quality-sheet-rows">
              <div className="call-quality-sheet-row">
                <span>{t('call.qualityLoss')}</span>
                <span>{metrics.packetLoss}{t('call.unitPercent')}</span>
              </div>
              <div className="call-quality-sheet-row">
                <span>{t('call.qualityPing')}</span>
                <span>{metrics.rtt} {t('call.unitMs')}</span>
              </div>
              <div className="call-quality-sheet-row">
                <span>{t('call.qualityBitrate')}</span>
                <span>{metrics.bitrate} {t('call.unitKbps')}</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="call-quality-sheet-level">{t('call.qualityUnknown')}</div>
      )}
    </BottomSheet>
  );
}
