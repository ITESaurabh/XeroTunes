import React, { useRef } from 'react';
import { alpha, Box, useTheme } from '@mui/material';
import { KnobDrag, dragTurn } from '../utils/knobDrag';

interface XTKnobProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  /** Diameter in px. */
  size?: number;
  disabled?: boolean;
  onChange: (_value: number) => void;
  /** Fires when a drag ends or a key press changes the value. */
  onChangeCommitted?: (_value: number) => void;
  'aria-label': string;
  getAriaValueText?: (_value: number) => string;
}

const START_DEG = -135;
const SWEEP_DEG = 270;

interface Drag extends KnobDrag {
  /** Unrounded, so small moves add up across steps. */
  raw: number;
}

const polar = (r: number, deg: number): [number, number] => {
  const rad = (deg * Math.PI) / 180;
  return [50 + r * Math.sin(rad), 50 - r * Math.cos(rad)];
};

const arc = (r: number, from: number, to: number): string => {
  const [x0, y0] = polar(r, from);
  const [x1, y1] = polar(r, to);
  return `M${x0} ${y0}A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1} ${y1}`;
};

/**
 * Rotary control in the same glass material as XTSwitch and XTFader. Drag up or right, or circle
 * clockwise, to turn it up. A triple click or tap resets it to `min`.
 */
const XTKnob: React.FC<XTKnobProps> = ({
  value,
  min = 0,
  max = 100,
  step = 1,
  size = 56,
  disabled = false,
  onChange,
  onChangeCommitted,
  getAriaValueText,
  ...aria
}) => {
  const theme = useTheme();
  const drag = useRef<Drag | null>(null);

  const clamp = (v: number): number => Math.min(max, Math.max(min, Math.round(v / step) * step));
  const accent = disabled ? theme.palette.action.disabled : theme.palette.primary.main;
  const angle = START_DEG + ((value - min) / (max - min)) * SWEEP_DEG;
  const [dotX, dotY] = polar(22, angle);

  const jumpTo = (next: number): void => {
    if (next === value) return;
    onChange(next);
    onChangeCommitted?.(next);
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    const page = (max - min) / 5;
    const deltas: Record<string, number> = {
      ArrowUp: step,
      ArrowRight: step,
      ArrowDown: -step,
      ArrowLeft: -step,
      PageUp: page,
      PageDown: -page,
    };
    let next: number;
    if (e.key === 'Home') next = min;
    else if (e.key === 'End') next = max;
    else if (e.key in deltas) next = clamp(value + deltas[e.key]);
    else return;
    e.preventDefault();
    jumpTo(next);
  };

  return (
    <Box
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={getAriaValueText?.(value)}
      aria-disabled={disabled || undefined}
      {...aria}
      onClick={e => {
        if (e.detail === 3) jumpTo(min);
      }}
      onPointerDown={e => {
        e.preventDefault();
        e.currentTarget.focus();
        e.currentTarget.setPointerCapture(e.pointerId);
        const box = e.currentTarget.getBoundingClientRect();
        drag.current = {
          cx: box.left + box.width / 2,
          cy: box.top + box.height / 2,
          x: e.clientX,
          y: e.clientY,
          raw: value,
        };
      }}
      onPointerMove={e => {
        const d = drag.current;
        if (!d) return;
        const turned = dragTurn(d, e.clientX, e.clientY);
        d.x = e.clientX;
        d.y = e.clientY;
        d.raw = Math.min(max, Math.max(min, d.raw + turned * (max - min)));
        const next = clamp(d.raw);
        if (next !== value) onChange(next);
      }}
      onLostPointerCapture={() => {
        if (!drag.current) return;
        drag.current = null;
        onChangeCommitted?.(value);
      }}
      onKeyDown={handleKeyDown}
      sx={{
        position: 'relative',
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: '50%',
        touchAction: 'none',
        outline: 'none',
        pointerEvents: disabled ? 'none' : undefined,
        '&:focus-visible': {
          outline: `2px solid ${theme.palette.primary.main}`,
          outlineOffset: 4,
        },
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          inset: '17%',
          borderRadius: '50%',
          background: `linear-gradient(160deg, rgba(255,255,255,.14), transparent 55%), ${theme.palette.surfaces.glass}`,
          border: `1px solid ${theme.palette.surfaces.glassBorder}`,
          backdropFilter: 'blur(10px) saturate(1.5)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,.12), 0 4px 10px rgba(0,0,0,.25)',
        }}
      />
      <svg
        viewBox="0 0 100 100"
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          overflow: 'visible',
        }}
      >
        <g fill="none" strokeLinecap="round">
          <path
            d={arc(44, START_DEG, START_DEG + SWEEP_DEG)}
            stroke={alpha(theme.palette.text.primary, 0.14)}
            strokeWidth={6}
          />
          {value > min && (
            <>
              <path d={arc(44, START_DEG, angle)} stroke={accent} strokeWidth={12} opacity={0.22} />
              <path d={arc(44, START_DEG, angle)} stroke={accent} strokeWidth={6} />
            </>
          )}
        </g>
        <circle cx={dotX} cy={dotY + 1} r={4.8} fill="rgba(0,0,0,.3)" />
        <circle cx={dotX} cy={dotY} r={4.5} fill="#fff" />
      </svg>
    </Box>
  );
};

export default XTKnob;
