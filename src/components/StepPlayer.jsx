import React, { useState, useEffect, useCallback, useRef } from 'react';
import './StepPlayer.css';

export default function StepPlayer({
  steps,
  currentStep,
  onStep,
  label
}) {
  const [playing, setPlaying] = useState(false);
  const timer = useRef(null);

  const SPEED_MAP = {
    0.25: 2000,
    0.5: 1400,
    0.75: 900,
    1: 600
  };

  const [speedKey, setSpeedKey] = useState(0.25);
  const total = steps?.length || 0;

  const stop = useCallback(() => {
    setPlaying(false);
    clearInterval(timer.current);
  }, []);

  const play = useCallback(() => {
    if (currentStep >= total - 1) onStep(0);
    setPlaying(true);
  }, [currentStep, total, onStep]);

  useEffect(() => {
    if (!playing) return;

    timer.current = setInterval(() => {
      onStep((prev) => {
        if (prev >= total - 1) {
          stop();
          return prev;
        }
        return prev + 1;
      });
    }, SPEED_MAP[speedKey]);

    return () => clearInterval(timer.current);
  }, [playing, speedKey, total, stop, onStep]);

  if (!steps?.length) return null;

  return (
    <div className="sp-wrap">
      <div className="sp-strip">
        <div className="sp-strip-left">
          <div className="sp-label">Build Progress</div>
          <div className="sp-counter">
            {currentStep + 1} / {total}
          </div>
        </div>

        <div className="sp-controls">
          <button
            className="sp-btn"
            onClick={() => {
              stop();
              onStep(0);
            }}
            title="First step"
            type="button"
          >
            ⏮
          </button>

          <button
            className="sp-btn"
            onClick={() => {
              stop();
              onStep(Math.max(0, currentStep - 1));
            }}
            title="Previous step"
            type="button"
          >
            ◀
          </button>

          <button
            className={`sp-btn sp-play-btn ${playing ? 'sp-playing' : ''}`}
            onClick={playing ? stop : play}
            title={playing ? 'Pause' : 'Play'}
            type="button"
          >
            {playing ? '⏸' : '▶'}
          </button>

          <button
            className="sp-btn"
            onClick={() => {
              stop();
              onStep(Math.min(total - 1, currentStep + 1));
            }}
            title="Next step"
            type="button"
          >
            ▶
          </button>

          <button
            className="sp-btn"
            onClick={() => {
              stop();
              onStep(total - 1);
            }}
            title="Last step"
            type="button"
          >
            ⏭
          </button>

          <div className="sp-speed">
            <select
              className="sp-speed-sel"
              value={speedKey}
              onChange={(e) => setSpeedKey(Number(e.target.value))}
            >
              <option value={0.25}>0.25×</option>
              <option value={0.5}>0.5×</option>
              <option value={0.75}>0.75×</option>
              <option value={1}>1×</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}

