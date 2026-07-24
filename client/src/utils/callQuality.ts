// Уровень качества исходящего соединения участника (аплинк к SFU).
export type QualityLevel = 'good' | 'medium' | 'poor' | 'unknown';

export interface ConnectionQualityMetrics {
  level: QualityLevel;
  packetLoss: number; // проценты, 1 знак после запятой
  rtt: number;        // миллисекунды, целое
  bitrate: number;    // кбит/с, целое
}

// Пороги (см. спек VYC-48). hasData=false → 'unknown' (нет remote-inbound-rtp
// или нет аудио-трека). Иначе классификация по потерям и пингу.
export function computeQualityLevel(
  packetLossPct: number,
  rttMs: number,
  hasData: boolean,
): QualityLevel {
  if (!hasData) return 'unknown';
  if (packetLossPct >= 5 || rttMs >= 300) return 'poor';
  if (packetLossPct >= 2 || rttMs >= 150) return 'medium';
  return 'good';
}
