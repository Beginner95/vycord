import { create } from 'zustand';

export const VOICE_RATES = [1, 1.5, 2] as const;
type Rate = (typeof VOICE_RATES)[number];
const KEY = 'vycord.voiceRate';

function load(): Rate {
  try {
    const v = Number(localStorage.getItem(KEY));
    return (VOICE_RATES as readonly number[]).includes(v) ? (v as Rate) : 1;
  } catch {
    return 1;
  }
}

/** Скорость голосовых — одна на все пузыри, запоминается у зрителя. */
export const useVoicePlaybackStore = create<{ rate: Rate; cycle(): void }>((set, get) => ({
  rate: load(),
  cycle: () => {
    const rate = VOICE_RATES[(VOICE_RATES.indexOf(get().rate) + 1) % VOICE_RATES.length];
    set({ rate });
    try { localStorage.setItem(KEY, String(rate)); } catch { /* приватный режим — живём без памяти */ }
  },
}));
