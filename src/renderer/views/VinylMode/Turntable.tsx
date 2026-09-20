import React, { useContext, useEffect, useRef, useState } from 'react';
import VinylLogo from 'svg-react-loader?name=VinylLogo!../../../assets/svgs/vinyl-logo.svg';
import { store } from '../../utils/store';
import {
  getVolumeLevel,
  PLAYBACK_SCRATCH_EVENT,
  type ScratchDetail,
  PLAYBACK_TICK_EVENT,
  PLAYBACK_TOGGLE_EVENT,
  VOLUME_CHANGE_EVENT,
} from '../../utils/LocStoreUtil';
import VinylDisc from './VinylDisc';
import { DEFAULT_AA } from '../../../config/constants';

const captionStyle: React.CSSProperties = {
  font: "600 10px/1 Georgia, 'Times New Roman', serif",
  letterSpacing: 2,
  color: '#6a6b72',
};

// Arm angles, solved from the pivot geometry below: stylus on the lead-in groove
// (r≈250 of the 260 disc) and just outside the label (r≈140). Groove pitch is
// constant, so the angle runs linearly with elapsed time between them.
const ARM_PARK = -6;
const ARM_START = 9.5;
const ARM_END = 26.5;
const SWING_S = 1.6;
const LIFT_S = 0.45;

// 140×480 box with the pivot at (100, 48); the whole assembly rotates around it.
function Tonearm({
  angle,
  lifted,
  dragging,
  pivotRef,
  onGrab,
}: {
  angle: number;
  lifted: boolean;
  /** Follows the pointer directly: no easing. */
  dragging: boolean;
  pivotRef: React.RefObject<HTMLDivElement>;
  onGrab: (_e: React.PointerEvent) => void;
}) {
  return (
    <div style={{ position: 'relative', width: 140, height: 480 }}>
      <div ref={pivotRef} style={{ position: 'absolute', left: 100, top: 48, width: 0, height: 0 }}>
        {/* housing, under everything; its shadow is thrown as far as the arm's */}
        <div
          style={{
            position: 'absolute',
            left: -25,
            top: -25,
            width: 50,
            height: 50,
            borderRadius: '50%',
            background:
              'radial-gradient(circle at 35% 30%, #d8d9de 0%, #a9aab0 45%, #6a6b72 80%, #55555c 100%)',
            boxShadow:
              '7px 11px 14px rgba(0,0,0,.4), 0 2px 3px rgba(0,0,0,.3), inset 0 1px 1px rgba(255,255,255,.7), inset 0 -3px 5px rgba(0,0,0,.35)',
          }}
        />
        <div
          onPointerDown={onGrab}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: 0,
            height: 0,
            transformOrigin: '0 0',
            transform: `rotate(${angle}deg)`,
            transition: dragging ? 'none' : `transform ${SWING_S}s cubic-bezier(.45,0,.2,1)`,
            cursor: dragging ? 'grabbing' : 'grab',
            touchAction: 'none',
          }}
        >
          {/* lift: seen from above only the shadow moves */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: 0,
              height: 0,
              filter: lifted
                ? 'drop-shadow(14px 22px 8px rgba(0,0,0,.26))'
                : 'drop-shadow(7px 11px 5px rgba(0,0,0,.3))',
              transition: `filter ${LIFT_S}s ease`,
            }}
          >
            {/* rear stub */}
            <div
              style={{
                position: 'absolute',
                left: -3,
                top: -40,
                width: 6,
                height: 40,
                borderRadius: 3,
                background: 'linear-gradient(90deg,#8e8f95,#e8e9ee 45%,#7c7d84)',
              }}
            />
            {/* counterweight */}
            <div
              style={{
                position: 'absolute',
                left: -10,
                top: -58,
                width: 20,
                height: 36,
                borderRadius: 5,
                background: 'linear-gradient(90deg,#26262a,#55555c 45%,#1d1d21)',
                boxShadow: '0 2px 5px rgba(0,0,0,.4)',
              }}
            />
            {/* arm tube */}
            <div
              style={{
                position: 'absolute',
                left: -3,
                top: 0,
                width: 6,
                height: 352,
                borderRadius: 3,
                background: 'linear-gradient(90deg,#8e8f95,#e8e9ee 45%,#7c7d84)',
              }}
            />
            {/* headshell, offset like a real cartridge */}
            <div
              style={{
                position: 'absolute',
                left: -11,
                top: 346,
                width: 22,
                height: 42,
                transform: 'rotate(18deg)',
                transformOrigin: '50% 0',
                borderRadius: '3px 3px 6px 6px',
                background: 'linear-gradient(90deg,#9a9ba1,#e4e5ea 45%,#84858c)',
                boxShadow: 'inset 0 1px 1px rgba(255,255,255,.5)',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: 4,
                  bottom: -5,
                  width: 14,
                  height: 10,
                  borderRadius: 2,
                  background: 'linear-gradient(90deg,#141416,#3a3a40 50%,#101012)',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: 9,
                  bottom: -9,
                  width: 4,
                  height: 6,
                  borderRadius: 1,
                  background: '#d9dade',
                }}
              />
            </div>
          </div>
        </div>
        {/* ball; painted over the arm */}
        <div
          style={{
            position: 'absolute',
            zIndex: 1,
            left: -18,
            top: -18,
            width: 36,
            height: 36,
            borderRadius: '50%',
            background:
              'radial-gradient(circle at 35% 30%, #f2f2f5 0%, #b9bac0 35%, #6a6b72 70%, #3a3b40 100%)',
            boxShadow: '3px 5px 8px rgba(0,0,0,.5), inset 0 -2px 4px rgba(0,0,0,.35)',
          }}
        />
      </div>
    </div>
  );
}

// Vertical drag, 1px = 1 unit; the indicator sweeps 270°.
function VolumeKnob({ volume, onChange }: { volume: number; onChange: (_v: number) => void }) {
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startV = volume;
    const move = (ev: PointerEvent) =>
      onChange(Math.max(0, Math.min(100, Math.round(startV + (startY - ev.clientY)))));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <div
        onPointerDown={onPointerDown}
        role="slider"
        aria-label="Volume"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={volume}
        style={{
          position: 'relative',
          width: 84,
          height: 84,
          borderRadius: '50%',
          cursor: 'grab',
          touchAction: 'none',
          background:
            'conic-gradient(from 200deg, #d8d9de, #8e8f95 25%, #e8e9ee 50%, #7c7d84 75%, #d8d9de)',
          boxShadow:
            '0 6px 14px rgba(0,0,0,.35), inset 0 2px 3px rgba(255,255,255,.6), inset 0 -3px 6px rgba(0,0,0,.35)',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 10,
            borderRadius: '50%',
            background: 'radial-gradient(circle at 40% 32%, #3a3a40, #1c1c20 70%)',
            boxShadow: 'inset 0 1px 2px rgba(255,255,255,.15)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            inset: 10,
            borderRadius: '50%',
            transform: `rotate(${-135 + volume * 2.7}deg)`,
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: 5,
              width: 4,
              height: 15,
              marginLeft: -2,
              borderRadius: 2,
              background: '#f2f2f5',
              boxShadow: '0 0 4px rgba(255,255,255,.35)',
            }}
          />
        </div>
      </div>
      <div style={captionStyle}>VOLUME</div>
    </div>
  );
}

function ToneSwitch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={on}
        aria-label={on ? 'Pause' : 'Play'}
        style={{
          position: 'relative',
          width: 64,
          height: 96,
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          borderRadius: 10,
          background: 'linear-gradient(180deg,#e6e7eb,#b9bac0)',
          boxShadow:
            '0 6px 14px rgba(0,0,0,.3), inset 0 1px 2px rgba(255,255,255,.7), inset 0 -2px 4px rgba(0,0,0,.25)',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: 12,
            bottom: 12,
            width: 26,
            transform: 'translateX(-50%)',
            borderRadius: 6,
            background: 'linear-gradient(180deg,#2a2a2e,#141416)',
            boxShadow: 'inset 0 2px 5px rgba(0,0,0,.8)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: '50%',
            width: 34,
            height: 26,
            transform: 'translateX(-50%)',
            top: on ? 14 : 56,
            transition: 'top .25s ease',
            borderRadius: 5,
            background: 'linear-gradient(180deg,#f4f4f6,#a9aab0)',
            boxShadow: '0 3px 6px rgba(0,0,0,.45), inset 0 1px 1px rgba(255,255,255,.8)',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: 7,
              right: 7,
              top: 11,
              height: 3,
              borderRadius: 2,
              background: 'rgba(0,0,0,.25)',
            }}
          />
        </div>
      </button>
      <div style={captionStyle}>TONE</div>
    </div>
  );
}

// Envelope of the 520 disc plus the parts hanging off its corners.
const SCENE_W = 660;
const SCENE_H = 620;

/** The turntable scene; fills its container and scales the fixed-px design to fit. */
export default function Turntable() {
  const { state } = useContext(store);
  const [volume, setVolume] = useState(getVolumeLevel);
  const sceneRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const trackId = state.track?.Id;
  const playing = state.isPlaying && trackId != null;
  const deck = (d: ScratchDetail) =>
    window.dispatchEvent(new CustomEvent(PLAYBACK_SCRATCH_EVENT, { detail: d }));

  // Decoding takes a moment, so it starts as soon as a record is on.
  const uri = state.track?.Uri as string | undefined;
  useEffect(() => {
    if (uri) deck({ phase: 'prime', uri });
  }, [uri]);

  useEffect(() => {
    const el = sceneRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setZoom(Math.min(width / SCENE_W, height / SCENE_H));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Position only arrives while playing; a paused arm just holds its groove.
  const [progress, setProgress] = useState(0);
  const draggingRef = useRef(false);
  useEffect(() => {
    setProgress(0);
    const onTick = (e: Event) => {
      if (draggingRef.current) return;
      const { position, duration } = (e as CustomEvent<{ position: number; duration: number }>)
        .detail;
      setProgress(duration > 0 ? Math.min(1, position / duration) : 0);
    };
    window.addEventListener(PLAYBACK_TICK_EVENT, onTick);
    return () => window.removeEventListener(PLAYBACK_TICK_EVENT, onTick);
  }, [trackId]);

  // The arm drops once its swing is done.
  const [down, setDown] = useState(false);
  // True when a hand has already carried the arm to its groove: no swing first.
  const byHandRef = useRef(false);
  useEffect(() => {
    setDown(false);
    if (!playing) return;
    const wait = byHandRef.current ? LIFT_S : SWING_S;
    byHandRef.current = false;
    const t = setTimeout(() => setDown(true), wait * 1000);
    return () => clearTimeout(t);
  }, [playing, trackId]);

  // Arm angle is the angle from the pivot to the pointer, 0 straight down.
  const pivotRef = useRef<HTMLDivElement>(null);
  const [handAngle, setHandAngle] = useState<number | null>(null);
  const grabArm = (e: React.PointerEvent) => {
    if (trackId == null) return;
    e.preventDefault();
    const pivot = pivotRef.current?.getBoundingClientRect();
    if (!pivot) return;
    const angleAt = (ev: { clientX: number; clientY: number }) =>
      Math.max(
        ARM_PARK,
        Math.min(
          ARM_END,
          (Math.atan2(pivot.left - ev.clientX, ev.clientY - pivot.top) * 180) / Math.PI
        )
      );
    const toProgress = (a: number) =>
      Math.max(0, Math.min(1, (a - ARM_START) / (ARM_END - ARM_START)));
    // Short of the lead-in groove the arm is clear of the record.
    const clear = (a: number) => a < ARM_START - 1.5;
    let angle = angleAt(e);
    setHandAngle(angle);
    draggingRef.current = true;
    setDown(false);
    // Lifting the needle takes the sound with it.
    deck({ phase: 'hold' });
    const move = (ev: PointerEvent) => {
      angle = angleAt(ev);
      setHandAngle(angle);
      const p = toProgress(angle);
      setProgress(p);
      // Off the record there is no groove under the needle: silence it.
      if (clear(angle)) deck({ phase: 'move', seconds: 0, rate: 0 });
      else deck({ phase: 'scrub', fraction: p });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setHandAngle(null);
      draggingRef.current = false;
      if (clear(angle)) {
        // Lifted clear: stop, and the next play starts from the lead-in.
        setProgress(0);
        deck({ phase: 'release', fraction: 0, play: false });
      } else if (!playing) {
        byHandRef.current = true;
        deck({ phase: 'release', play: true });
      } else {
        deck({ phase: 'release' });
        setTimeout(() => setDown(true), LIFT_S * 1000);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const dragging = handAngle != null;
  const armAngle =
    handAngle != null
      ? handAngle
      : playing
        ? ARM_START + (ARM_END - ARM_START) * progress
        : ARM_PARK;

  // A record with no art wears the app's default label; an empty deck shows none.
  const cover = state.track?.AlbumArt
    ? `file:///${(state.track.AlbumArt as string).replace(/\\/g, '/')}`
    : trackId != null
      ? DEFAULT_AA
      : null;

  const onVolume = (v: number) => {
    setVolume(v);
    window.dispatchEvent(new CustomEvent(VOLUME_CHANGE_EVENT, { detail: v }));
  };
  const togglePlay = () => window.dispatchEvent(new Event(PLAYBACK_TOGGLE_EVENT));

  return (
    <div
      ref={sceneRef}
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '10px 20px 10px 30px',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ position: 'relative', width: 520, height: 520, flex: 'none', zoom }}>
        <div style={{ position: 'absolute', inset: 0 }}>
          <VinylDisc spin={playing} cover={cover} onScratch={trackId == null ? undefined : deck} />
        </div>
        <div style={{ position: 'absolute', left: 442, top: -28, zIndex: 5 }}>
          <Tonearm
            angle={armAngle}
            lifted={!down}
            dragging={dragging}
            pivotRef={pivotRef}
            onGrab={grabArm}
          />
        </div>
        <div style={{ position: 'absolute', left: -62, top: -22 }}>
          <VolumeKnob volume={volume} onChange={onVolume} />
        </div>
        <div style={{ position: 'absolute', left: -52, bottom: -30 }}>
          <ToneSwitch on={playing} onToggle={togglePlay} />
        </div>
        {/* svg-react-loader drops the root attributes, so the viewBox is restated here. */}
        <VinylLogo
          viewBox="0 0 383 395"
          fill="none"
          style={{
            position: 'absolute',
            right: -56,
            bottom: -16,
            height: 66,
            width: 64,
            filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.22))',
          }}
        />
      </div>
    </div>
  );
}
