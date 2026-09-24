import { useEffect, useRef, useState } from 'react';
import { wsService } from '@/services/websocket';
import { groupCallService } from '@/services/groupCall';

export interface CallNotif {
  channelId: string;
  channelName: string;
  callerId: string;
  callerName: string;
}

// Создаём контекст сразу — он будет suspended, но Chrome разрешит resume
// после первого жеста пользователя (логин, клик по каналу и т.д.)
const _audioCtx = new AudioContext();

const _resumeAudio = () => { _audioCtx.resume().catch(() => {}); };
document.addEventListener('click',    _resumeAudio, { capture: true, passive: true });
document.addEventListener('keydown',  _resumeAudio, { capture: true, passive: true });
document.addEventListener('touchend', _resumeAudio, { capture: true, passive: true });

async function playRingOnce(): Promise<void> {
  try {
    if (_audioCtx.state !== 'running') {
      await _audioCtx.resume();
    }
    const state: string = _audioCtx.state;
    if (state !== 'running') return; // жест ещё не был — пропускаем
    const gain = _audioCtx.createGain();
    gain.connect(_audioCtx.destination);
    const t = _audioCtx.currentTime;

    const playTone = (freq: number, offset: number) => {
      const osc = _audioCtx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.gain.setValueAtTime(0, t + offset);
      gain.gain.linearRampToValueAtTime(0.25, t + offset + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, t + offset + 0.35);
      osc.start(t + offset);
      osc.stop(t + offset + 0.36);
    };

    playTone(880,  0);
    playTone(1174, 0.18);
  } catch {
    // ignore
  }
}

function startCallRingtone(): () => void {
  void playRingOnce();
  const interval = window.setInterval(() => { void playRingOnce(); }, 2000);
  return () => window.clearInterval(interval);
}

export function useCallRing(currentServerId: string | null, userId: string | null) {
  const [callNotif, setCallNotif] = useState<CallNotif | null>(null);
  const stopRingtoneRef = useRef<(() => void) | null>(null);
  const callNotifRef = useRef<CallNotif | null>(null);
  useEffect(() => { callNotifRef.current = callNotif; }, [callNotif]);
  useEffect(() => () => { stopRingtoneRef.current?.(); }, []);

  useEffect(() => {
    const unsubscribe = wsService.on('voice_call_ring', (payload) => {
      const p = payload as Record<string, unknown>;
      const alreadyInThatCall =
        groupCallService.isInGroupCallState &&
        groupCallService.currentRoomIdState === p.channel_id;
      if (p.server_id === currentServerId && p.caller_id !== userId && !alreadyInThatCall) {
        stopRingtoneRef.current?.();
        setCallNotif({
          channelId: p.channel_id as string,
          channelName: p.channel_name as string,
          callerId: p.caller_id as string,
          callerName: p.caller_name as string,
        });
        stopRingtoneRef.current = startCallRingtone();
      }
    });
    return () => unsubscribe();
  }, [currentServerId, userId]);

  useEffect(() => {
    const unsubscribe = wsService.on('voice_call_cancel', (payload) => {
      const p = payload as Record<string, unknown>;
      if (callNotifRef.current?.channelId === p.channel_id) {
        stopRingtoneRef.current?.();
        stopRingtoneRef.current = null;
        setCallNotif(null);
      }
    });
    return () => unsubscribe();
  }, []);

  const dismiss = () => {
    stopRingtoneRef.current?.();
    stopRingtoneRef.current = null;
    setCallNotif(null);
  };

  return { callNotif, dismiss };
}
