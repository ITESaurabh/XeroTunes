import React, { useEffect, useRef, useState } from 'react';
import { keyframes, styled } from '@mui/material/styles';

// On a record change the old label fades as the new one comes in.
const LABEL_FADE_S = 0.9;
const fadeIn = keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });
const fadeOut = keyframes({ from: { opacity: 1 }, to: { opacity: 0 } });
const Label = styled('img', { shouldForwardProp: prop => prop !== 'leaving' })<{
  leaving?: boolean;
}>(({ leaving }) => ({
  position: 'absolute',
  inset: 0,
  display: 'block',
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  animation: `${leaving ? fadeOut : fadeIn} ${LABEL_FADE_S}s ease both`,
}));

// Platter inertia: seconds to reach ~63% of the speed change.
const SPIN_UP_TAU = 0.6;
const SPIN_DOWN_TAU = 1.4;

export interface VinylDiscProps {
  spin?: boolean;
  /** Seconds per revolution. */
  spinVelocity?: number;
  sheenIntensity?: number;
  /** Distance between groove rings, px. */
  grooveSpacing?: number;
  cover?: string | null;
  /** Cover diameter as % of the disc. */
  coverArea?: number;
  /** Colour of the blank label under the cover. */
  labelColor?: string;
  /**
   * Makes the record grabbable. `hold` when a hand lands, `move` as it drags
   * (`seconds` of groove passed, `rate` × motor speed), `release` on letting go.
   */
  onScratch?: (_e: { phase: 'hold' | 'move' | 'release'; seconds?: number; rate?: number }) => void;
}

const layer: React.CSSProperties = { position: 'absolute', inset: 0, borderRadius: '50%' };

/**
 * Fills its (square) container; everything inside is %-based so it works from
 * mini-player size up. Lighting stays fixed while grooves and cover rotate.
 */
export default function VinylDisc({
  spin = false,
  spinVelocity = 8.6,
  sheenIntensity = 0.5,
  grooveSpacing = 4,
  cover,
  coverArea = 50,
  labelColor = '#ff7a35',
  onScratch,
}: VinylDiscProps) {
  const gap = grooveSpacing;
  const rootRef = useRef<HTMLDivElement>(null);
  const [held, setHeld] = useState(false);

  const [labels, setLabels] = useState<{ cur: string | null; prev: string | null }>({
    cur: cover ?? null,
    prev: null,
  });
  useEffect(() => {
    setLabels(l => (l.cur === (cover ?? null) ? l : { cur: cover ?? null, prev: l.cur }));
    const t = setTimeout(() => setLabels(l => ({ ...l, prev: null })), LABEL_FADE_S * 1000);
    return () => clearTimeout(t);
  }, [cover]);
  const grooveRef = useRef<HTMLDivElement>(null);
  const coverRef = useRef<HTMLDivElement>(null);
  const angleRef = useRef(0);
  const speedRef = useRef(0); // deg/s

  // rAF rather than a CSS animation so the platter spins up and coasts down
  // like a motor. Only transforms change, so it stays on the compositor.
  useEffect(() => {
    if (held) return;
    const target = spin ? 360 / spinVelocity : 0;
    const tau = spin ? SPIN_UP_TAU : SPIN_DOWN_TAU;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      speedRef.current += (target - speedRef.current) * (1 - Math.exp(-dt / tau));
      if (!spin && speedRef.current < 0.5) speedRef.current = 0;
      angleRef.current = (angleRef.current + speedRef.current * dt) % 360;
      const t = `rotate(${angleRef.current}deg)`;
      if (grooveRef.current) grooveRef.current.style.transform = t;
      if (coverRef.current) coverRef.current.style.transform = t;
      if (spin || speedRef.current > 0) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [spin, spinVelocity, held]);

  // The platter follows the pointer's angle about the spindle; each move
  // reports how much groove went past and how fast.
  const grab = (e: React.PointerEvent) => {
    if (!onScratch || e.button !== 0) return;
    e.preventDefault();
    const r = rootRef.current?.getBoundingClientRect();
    if (!r) return;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const angleAt = (ev: { clientX: number; clientY: number }) =>
      (Math.atan2(ev.clientY - cy, ev.clientX - cx) * 180) / Math.PI;
    const motor = 360 / spinVelocity;
    let lastAngle = angleAt(e);
    let lastTime = performance.now();
    let idle: ReturnType<typeof setTimeout> | null = null;
    setHeld(true);
    speedRef.current = 0;
    onScratch({ phase: 'hold' });
    const move = (ev: PointerEvent) => {
      const a = angleAt(ev);
      let delta = a - lastAngle;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      const now = performance.now();
      const dt = Math.max(1, now - lastTime) / 1000;
      lastAngle = a;
      lastTime = now;
      angleRef.current = (angleRef.current + delta + 360) % 360;
      const t = `rotate(${angleRef.current}deg)`;
      if (grooveRef.current) grooveRef.current.style.transform = t;
      if (coverRef.current) coverRef.current.style.transform = t;
      onScratch({ phase: 'move', seconds: (delta / 360) * spinVelocity, rate: delta / dt / motor });
      // The hand stopping sends no event of its own.
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => onScratch({ phase: 'move', seconds: 0, rate: 0 }), 80);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (idle) clearTimeout(idle);
      setHeld(false);
      onScratch({ phase: 'release' });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const grooveMask = `repeating-radial-gradient(circle at 50% 50%, #000 0px, #000 1.5px, transparent 1.5px, transparent ${gap}px)`;

  return (
    <div
      ref={rootRef}
      onPointerDown={grab}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        cursor: onScratch ? (held ? 'grabbing' : 'grab') : undefined,
        touchAction: 'none',
      }}
    >
      {/* shadows: soft ambient plus a short throw to the lower right; anything
          longer reads as floating rather than lying on the platter */}
      <div
        style={{
          position: 'absolute',
          inset: '-1%',
          borderRadius: '50%',
          background: 'rgba(15,15,20,.28)',
          filter: 'blur(10px)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: '1.5%',
          right: '-2.5%',
          top: '2%',
          bottom: '-3%',
          borderRadius: '50%',
          background: 'rgba(0,0,0,.42)',
          filter: 'blur(4px)',
        }}
      />
      {/* disc base */}
      <div
        style={{
          ...layer,
          background:
            'radial-gradient(circle at 38% 30%, #313136 0%, #1f1f23 22%, #131316 48%, #0a0a0c 78%, #050506 100%)',
          boxShadow: 'inset 0 1px 1px rgba(255,255,255,.18), inset 0 -1px 2px rgba(0,0,0,.9)',
        }}
      />
      {/* grooves + faint streaks (spin) */}
      <div ref={grooveRef} style={{ ...layer, inset: '1%', willChange: 'transform' }}>
        <div
          style={{
            ...layer,
            filter: 'blur(.4px)',
            background: `repeating-radial-gradient(circle at 50% 50%, rgba(255,255,255,.02) 0px, rgba(255,255,255,.02) 1px, rgba(0,0,0,0) 1px, rgba(0,0,0,0) ${gap}px), repeating-radial-gradient(circle at 50% 50%, rgba(255,255,255,.055) 0px, rgba(255,255,255,.055) 2px, rgba(0,0,0,0) 2px, rgba(0,0,0,0) ${Math.max(24, gap * 9)}px)`,
          }}
        />
        <div
          style={{
            ...layer,
            background:
              'conic-gradient(from 20deg at 50% 50%, rgba(255,255,255,0) 0deg, rgba(255,255,255,.05) 28deg, rgba(255,255,255,0) 60deg, rgba(255,255,255,0) 128deg, rgba(255,255,255,.035) 158deg, rgba(255,255,255,0) 198deg, rgba(255,255,255,0) 272deg, rgba(255,255,255,.055) 300deg, rgba(255,255,255,0) 334deg)',
          }}
        />
      </div>
      {/* broad gloss */}
      <div
        style={{
          ...layer,
          inset: '1%',
          opacity: 0.16 * sheenIntensity,
          background:
            'conic-gradient(from 0deg at 50% 50%, rgba(255,255,255,0) 55deg, rgba(255,255,255,.55) 115deg, rgba(255,255,255,.8) 145deg, rgba(255,255,255,.25) 195deg, rgba(255,255,255,0) 235deg, rgba(255,255,255,0) 275deg, rgba(255,255,255,.45) 315deg, rgba(255,255,255,.12) 345deg, rgba(255,255,255,0) 360deg)',
          filter: 'blur(5px)',
        }}
      />
      {/* sheen, masked so light only lands on the groove ridges */}
      <div
        style={{
          ...layer,
          inset: '1%',
          opacity: Math.min(1, 0.9 * sheenIntensity),
          background:
            'conic-gradient(from 0deg at 50% 50%, rgba(255,255,255,0) 55deg, rgba(255,255,255,.6) 115deg, rgba(255,255,255,.95) 145deg, rgba(255,255,255,.3) 195deg, rgba(255,255,255,0) 235deg, rgba(255,255,255,0) 272deg, rgba(255,255,255,.55) 315deg, rgba(255,255,255,.15) 345deg, rgba(255,255,255,0) 360deg)',
          WebkitMaskImage: grooveMask,
          maskImage: grooveMask,
        }}
      />
      {/* rim */}
      <div
        style={{
          ...layer,
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.06), inset 0 0 8px rgba(0,0,0,.55)',
        }}
      />
      {/* label / cover (spin) */}
      <div
        ref={coverRef}
        style={{ ...layer, inset: `${(100 - coverArea) / 2}%`, willChange: 'transform' }}
      >
        <div
          style={{
            ...layer,
            background: `radial-gradient(circle at 42% 34%, ${labelColor} 0%, ${labelColor} 45%, color-mix(in srgb, ${labelColor}, #000 25%) 100%)`,
            boxShadow:
              '0 0 0 1px rgba(0,0,0,.55), 0 1px 4px rgba(0,0,0,.45), inset 0 1px 2px rgba(255,255,255,.28), inset 0 -2px 5px rgba(0,0,0,.22)',
          }}
        />
        {/* transparent art (the default label) sits on black, not the orange */}
        <div style={{ ...layer, overflow: 'hidden', background: labels.cur ? '#1c1c20' : 'none' }}>
          {labels.prev && (
            <Label key={`out-${labels.prev}`} src={labels.prev} alt="" draggable={false} leaving />
          )}
          {labels.cur && <Label key={labels.cur} src={labels.cur} alt="" draggable={false} />}
        </div>
        <div
          style={{
            ...layer,
            pointerEvents: 'none',
            boxShadow:
              '0 0 0 1px rgba(0,0,0,.55), inset 0 1px 2px rgba(255,255,255,.28), inset 0 -3px 8px rgba(0,0,0,.3)',
            background:
              'radial-gradient(circle at 42% 30%, rgba(255,255,255,.14) 0%, rgba(255,255,255,0) 55%)',
          }}
        />
      </div>
      {/* spindle */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: '2.5%',
          height: '2.5%',
          transform: 'translate(-50%,-50%)',
          borderRadius: '50%',
          background:
            'radial-gradient(circle at 35% 30%, #ffffff 0%, #cfd0d4 32%, #85868c 62%, #3f4045 100%)',
          boxShadow: '0 0 0 3px rgba(10,10,10,.55), 0 2px 4px rgba(0,0,0,.6)',
        }}
      />
    </div>
  );
}
