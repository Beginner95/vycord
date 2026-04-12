/**
 * Audio Notification Service
 * Uses Web Audio API to generate notification sounds — no external files needed.
 */

type NotificationType = 'message' | 'call_incoming' | 'call_accepted' | 'call_ended' | 'call_busy';

interface AudioSettings {
  messageSound: boolean;
  callSound: boolean;
  volume: number; // 0–1
}

const DEFAULT_SETTINGS: AudioSettings = {
  messageSound: true,
  callSound: true,
  volume: 0.5,
};

const SETTINGS_KEY = 'vycord_audio_settings';

class AudioService {
  private ctx: AudioContext | null = null;
  private settings: AudioSettings;
  private ringtoneGain: GainNode | null = null;
  private isRinging = false;

  constructor() {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      try {
        this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
      } catch {
        this.settings = DEFAULT_SETTINGS;
      }
    } else {
      this.settings = DEFAULT_SETTINGS;
    }
  }

  private getAudioContext(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  /**
   * Play a short "pop" sound for incoming messages.
   * Two-tone ascending chime (C6 → E6).
   */
  playMessage(): void {
    if (!this.settings.messageSound) return;
    const ctx = this.getAudioContext();
    const vol = this.settings.volume * 0.3;

    this.playTone(ctx, 1046.5, 0, 0.08, vol);  // C6
    this.playTone(ctx, 1318.5, 0.08, 0.12, vol); // E6
  }

  /**
   * Play ringtone for incoming calls.
   * Classic ring pattern: alternating 440Hz + 480Hz, repeated.
   */
  startRingtone(): void {
    if (this.isRinging) return;
    this.isRinging = true;

    const ctx = this.getAudioContext();
    const vol = this.settings.volume * 0.4;

    this.ringtoneGain = ctx.createGain();
    this.ringtoneGain.gain.value = vol;
    this.ringtoneGain.connect(ctx.destination);

    this.playRingPattern();
  }

  private playRingPattern(): void {
    if (!this.isRinging || !this.ringtoneGain) return;
    const ctx = this.getAudioContext();

    // First tone: 440 Hz
    this.playTone(ctx, 440, 0, 0.4, this.settings.volume * 0.3);
    // Second tone: 480 Hz (slight delay, classic ring)
    this.playTone(ctx, 480, 0.02, 0.4, this.settings.volume * 0.3);

    // Repeat after 1.2s pause
    setTimeout(() => {
      if (this.isRinging) {
        this.playRingPattern();
      }
    }, 1200);
  }

  /**
   * Stop the call ringtone.
   */
  stopRingtone(): void {
    this.isRinging = false;
    if (this.ringtoneGain) {
      this.ringtoneGain.gain.linearRampToValueAtTime(0, this.getAudioContext().currentTime + 0.1);
      this.ringtoneGain = null;
    }
  }

  /**
   * Play a soft "click" for call accepted.
   * Single ascending tone.
   */
  playCallAccepted(): void {
    if (!this.settings.callSound) return;
    const ctx = this.getAudioContext();
    const vol = this.settings.volume * 0.3;

    this.playTone(ctx, 523.25, 0, 0.15, vol);  // C5
    this.playTone(ctx, 659.25, 0.1, 0.2, vol);  // E5
  }

  /**
   * Play a descending tone for call ended.
   */
  playCallEnded(): void {
    if (!this.settings.callSound) return;
    const ctx = this.getAudioContext();
    const vol = this.settings.volume * 0.3;

    this.playTone(ctx, 659.25, 0, 0.15, vol);  // E5
    this.playTone(ctx, 523.25, 0.1, 0.25, vol); // C5
  }

  /**
   * Play a busy tone (fast beeps).
   */
  playBusy(): void {
    if (!this.settings.callSound) return;
    const ctx = this.getAudioContext();
    const vol = this.settings.volume * 0.25;

    this.playTone(ctx, 480, 0, 0.15, vol);
    this.playTone(ctx, 480, 0.25, 0.15, vol);
  }

  /**
   * Helper: play a single tone.
   */
  private playTone(
    ctx: AudioContext,
    frequency: number,
    startTime: number,
    duration: number,
    volume: number,
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, ctx.currentTime + startTime);

    gain.gain.setValueAtTime(0, ctx.currentTime + startTime);
    gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + startTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime + startTime);
    osc.stop(ctx.currentTime + startTime + duration + 0.05);
  }

  // ── Settings ──

  getSettings(): AudioSettings {
    return { ...this.settings };
  }

  updateSettings(updates: Partial<AudioSettings>): void {
    this.settings = { ...this.settings, ...updates };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
  }

  setVolume(volume: number): void {
    this.settings.volume = Math.max(0, Math.min(1, volume));
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
  }
}

export const audioService = new AudioService();
export type { NotificationType, AudioSettings };
