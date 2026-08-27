import { useState, useEffect, useRef } from 'react';

export function useMicLevel(stream: MediaStream | null, isMuted: boolean): number {
  const [level, setLevel] = useState(0);
  const rafRef = useRef(0);
  // Tracked as an explicit dependency below because the SFU reuses and mutates
  // the same MediaStream object as a participant's tracks arrive (audio and
  // video ontrack fire separately, order not guaranteed) — the object
  // reference alone doesn't change when it gains an audio track later, so
  // recomputing this count on every render is what lets the effect re-run.
  const audioTrackCount = stream?.getAudioTracks().length ?? 0;

  useEffect(() => {
    // createMediaStreamSource throws InvalidStateError on a stream with no
    // audio track yet — wait until one is actually present.
    if (!stream || isMuted || audioTrackCount === 0) {
      setLevel(0);
      return;
    }

    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);

    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      setLevel(avg / 128);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      source.disconnect();
      ctx.close();
    };
  }, [stream, isMuted, audioTrackCount]);

  return level;
}
