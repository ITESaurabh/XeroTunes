import React from 'react';
import { alpha, styled, Switch, SwitchProps } from '@mui/material';

const EASE = 'cubic-bezier(.2, 0, 0, 1)';

/** Use instead of MUI's Switch so every toggle in the app matches. */
const XTSwitch = styled((props: SwitchProps) => <Switch disableRipple {...props} />)(({
  theme,
}) => {
  const on = theme.palette.primary.main;
  return {
    width: 52,
    height: 32,
    padding: 0,
    // The hover ring is wider than the track.
    overflow: 'visible',
    '&:has(.Mui-disabled)': {
      opacity: 0.4,
    },
    '& .MuiSwitch-switchBase': {
      // A 40px ring centred on the 32px-tall track, as in Material 3.
      top: -4,
      left: -4,
      width: 40,
      height: 40,
      padding: 0,
      transition: `transform 300ms ${EASE}`,
      // MUI's 300%-wide input would spill clicks onto neighbours, like the "Set up" button in Settings.
      '& .MuiSwitch-input': {
        left: 0,
        width: 56,
        // 44px tall for touch, centred on the base.
        top: -2,
        height: 44,
        // Cancels out the base's transform. Jumping instead pokes 20px out mid-toggle and scrolls the dialog.
        transition: `left 300ms ${EASE}`,
      },
      '&:hover': {
        backgroundColor: alpha(theme.palette.text.primary, 0.08),
      },
      '&:active .MuiSwitch-thumb': {
        width: 28,
        height: 28,
      },
      '&.Mui-checked': {
        transform: 'translateX(20px)',
        '& .MuiSwitch-input': {
          left: -16,
        },
        '&:hover': {
          backgroundColor: alpha(on, 0.08),
        },
        '& .MuiSwitch-thumb': {
          width: 24,
          height: 24,
          background: 'linear-gradient(180deg, rgba(255,255,255,.98), rgba(255,255,255,.78))',
          boxShadow: '0 2px 6px rgba(0,0,0,.3), inset 0 0 0 .5px rgba(255,255,255,.6)',
        },
        '&:active .MuiSwitch-thumb': {
          width: 28,
          height: 28,
        },
        '& + .MuiSwitch-track': {
          backgroundColor: alpha(on, 0.55),
          borderColor: alpha(on, 0.75),
          boxShadow: `inset 0 1px 0 rgba(255,255,255,.25), 0 0 16px ${alpha(on, 0.45)}`,
          opacity: 1,
        },
      },
      '&.Mui-disabled + .MuiSwitch-track': {
        opacity: 1,
      },
      '&.Mui-focusVisible + .MuiSwitch-track': {
        outline: `2px solid ${on}`,
        outlineOffset: 3,
      },
    },
    '& .MuiSwitch-thumb': {
      width: 16,
      height: 16,
      background: alpha(theme.palette.text.primary, 0.55),
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,.35)',
      transition: `width 250ms ${EASE}, height 250ms ${EASE}, box-shadow 200ms`,
    },
    '& .MuiSwitch-track': {
      boxSizing: 'border-box',
      borderRadius: 16,
      border: `2px solid ${alpha(theme.palette.text.primary, 0.3)}`,
      backgroundColor: theme.palette.surfaces.glass,
      backdropFilter: 'blur(10px) saturate(1.5)',
      boxShadow: 'inset 0 1px 0 rgba(255,255,255,.1), inset 0 -1px 2px rgba(0,0,0,.15)',
      opacity: 1,
      transition: theme.transitions.create(['background-color', 'border-color', 'box-shadow'], {
        duration: 300,
      }),
    },
  };
});

export default XTSwitch;
