import React from 'react';
import { styled } from '@mui/material/styles';

/**
 * The raw-text stage: paste lyrics in, clean them up, one line per row.
 *
 * Deliberately a bare textarea rather than a rich editor. Everything the studio
 * needs from this tab is the line breaks, and anything cleverer would have to
 * defend its formatting against a paste from a lyrics site.
 */
const Area = styled('textarea')(({ theme }) => ({
  flex: 1,
  width: '100%',
  minHeight: 0,
  resize: 'none',
  padding: '24px 28px',
  borderRadius: 12,
  border: `1px solid ${theme.palette.surfaces.glassBorder}`,
  backgroundColor: theme.palette.surfaces.elevated,
  color: theme.palette.text.primary,
  fontFamily: theme.typography.fontFamily,
  fontSize: '1.4rem',
  lineHeight: 1.7,
  outline: 'none',
  '&:focus': { borderColor: theme.palette.primary.main },
  '&::placeholder': { opacity: 0.35 },
}));

export interface EditorProps {
  value: string;
  onChange: (_next: string) => void;
}

export default function Editor({ value, onChange }: EditorProps) {
  return (
    <Area
      value={value}
      onChange={e => onChange(e.target.value)}
      spellCheck={false}
      autoComplete="off"
      placeholder="Paste or type the lyrics, one line per row…"
      aria-label="Lyrics"
    />
  );
}
