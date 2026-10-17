import React from 'react';
import { alpha, styled, Slider, SliderProps } from '@mui/material';

const THUMB_SHADOW = '0 2px 6px rgba(0,0,0,.3), inset 0 0 0 .5px rgba(255,255,255,.6)';

// MUI's own layout is horizontal; `.MuiSlider-vertical` rules swap the axes.
const GlassSlider = styled(Slider)(({ theme }) => {
  const accent = theme.palette.primary.main;
  return {
    '&.MuiSlider-vertical': {
      width: 8,
      padding: '0 14px',
    },
    '& .MuiSlider-rail': {
      height: 8,
      borderRadius: 4,
      opacity: 1,
      backgroundColor: theme.palette.surfaces.glass,
      backdropFilter: 'blur(8px) saturate(1.5)',
      boxShadow: `inset 0 0 0 1px ${theme.palette.surfaces.glassBorder}, inset 0 1px 2px rgba(0,0,0,.25)`,
      // MUI's track can only grow from min, so the fill is drawn here from --lo to --hi.
      '&::after': {
        content: '""',
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 'calc(var(--lo) * 100%)',
        width: 'calc((var(--hi) - var(--lo)) * 100%)',
        borderRadius: 'inherit',
        backgroundColor: alpha(accent, 0.6),
        boxShadow: `0 0 10px ${alpha(accent, 0.5)}`,
      },
    },
    '&.MuiSlider-vertical .MuiSlider-rail': {
      width: 8,
      height: '100%',
      '&::after': {
        top: 'auto',
        left: 0,
        right: 0,
        bottom: 'calc(var(--lo) * 100%)',
        width: 'auto',
        height: 'calc((var(--hi) - var(--lo)) * 100%)',
      },
    },
    '&.Mui-disabled .MuiSlider-rail::after': {
      backgroundColor: theme.palette.action.disabled,
      boxShadow: 'none',
    },
    '& .MuiSlider-thumb': {
      width: 18,
      height: 34,
      borderRadius: 9,
      background: 'linear-gradient(90deg, rgba(255,255,255,.98), rgba(255,255,255,.78))',
      boxShadow: THUMB_SHADOW,
      transition: 'box-shadow 150ms, width 150ms, height 150ms',
      '&::before': { boxShadow: 'none' },
      '&:hover': {
        boxShadow: `${THUMB_SHADOW}, 0 0 0 6px ${alpha(theme.palette.text.primary, 0.08)}`,
      },
      '&.Mui-focusVisible': {
        boxShadow: THUMB_SHADOW,
        outline: `2px solid ${accent}`,
        outlineOffset: 3,
      },
      '&.Mui-active': {
        width: 20,
        height: 38,
      },
    },
    '&.MuiSlider-vertical .MuiSlider-thumb': {
      width: 28,
      height: 14,
      borderRadius: 7,
      background: 'linear-gradient(180deg, rgba(255,255,255,.98), rgba(255,255,255,.78))',
      '&.Mui-active': {
        width: 32,
        height: 16,
      },
    },
  };
});

type XTFaderProps = Omit<SliderProps, 'value' | 'track'> & {
  value: number;
  /** Where the fill starts, and where a triple click or tap puts it back. Defaults to `min`. */
  origin?: number;
};

/** Mixer-style slider matching XTSwitch. Vertical by default; give a vertical one a height with `sx`. */
const XTFader: React.FC<XTFaderProps> = ({
  value,
  min = 0,
  max = 100,
  origin = min,
  orientation = 'vertical',
  style,
  onClick,
  ...props
}) => {
  const at = (v: number): number => (v - min) / (max - min);
  const fill = {
    '--lo': Math.min(at(value), at(origin)),
    '--hi': Math.max(at(value), at(origin)),
  } as React.CSSProperties;
  return (
    <GlassSlider
      orientation={orientation}
      track={false}
      value={value}
      min={min}
      max={max}
      style={{ ...style, ...fill }}
      onClick={e => {
        onClick?.(e);
        if (e.detail !== 3 || value === origin) return;
        props.onChange?.(e.nativeEvent, origin, 0);
        props.onChangeCommitted?.(e.nativeEvent, origin);
      }}
      {...props}
    />
  );
};

export default XTFader;
