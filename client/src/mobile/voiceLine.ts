export interface VoiceLineParts {
  names: string[];
  /** Сколько участников не поместилось в names. */
  extra: number;
}

/** «Аня, Борис +1 в голосе» (спека §5.2, §5.3) — чистая часть без i18n:
 *  строку собирает компонент через mobile.voiceLine / mobile.voiceMore. */
export function voiceLineParts(
  ids: readonly string[],
  nameOf: (id: string) => string,
  max = 2,
): VoiceLineParts | null {
  if (ids.length === 0) return null;
  return { names: ids.slice(0, max).map(nameOf), extra: Math.max(0, ids.length - max) };
}
