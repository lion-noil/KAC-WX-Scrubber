// src/hooks/usePlaybackController.js
import { useEffect, useRef, useState } from "react";

export function usePlaybackController({ max = 1, stepMs = 100 }) {
  const [pkt, setPkt] = useState(1);
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    // maxPkt 변경되면 현재 pkt를 범위 안으로
    setPkt((p) => Math.max(1, Math.min(p, max || 1)));
  }, [max]);

  const clearTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const play = () => {
    if (playing || !max) return;
    setPlaying(true);
    clearTimer();
    timerRef.current = setInterval(() => {
      setPkt((cur) => (cur >= (max || 1) ? 1 : cur + 1));
    }, Math.max(30, stepMs));
  };

  const pause = () => {
    clearTimer();
    setPlaying(false);
  };

  const toggle = () => (playing ? pause() : play());

  const next = () => {
    pause();
    setPkt((p) => (p >= (max || 1) ? 1 : p + 1));
  };

  const prev = () => {
    pause();
    setPkt((p) => (p <= 1 ? max || 1 : p - 1));
  };

  useEffect(() => () => clearTimer(), []);

  return {
    pkt,
    setPkt,
    playing,
    play,
    pause,
    toggle,
    next,
    prev,
  };
}
