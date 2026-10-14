import React, { useState } from 'react';
import { Box, Button, Radio, Typography, alpha, styled } from '@mui/material';
import AppDialog from '../../components/AppDialog';

export type SaveTarget = 'sidecar' | 'embed';

const Choice = styled(Box, {
  shouldForwardProp: prop => prop !== 'selected',
})<{ selected: boolean }>(({ theme, selected }) => ({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: 16,
  borderRadius: 12,
  cursor: 'pointer',
  border: `1px solid ${
    selected ? theme.palette.primary.main : theme.palette.surfaces.glassBorder
  }`,
  backgroundColor: selected ? theme.palette.surfaces.selection : 'transparent',
  '&[aria-disabled="true"]': {
    cursor: 'not-allowed',
    opacity: 0.45,
    backgroundColor: alpha(theme.palette.text.primary, 0.02),
  },
}));

export interface SaveDialogProps {
  open: boolean;
  /** Where the sidecar would land, shown so the user knows what appears on disk. */
  sidecarPath: string;
  /** False for a container taglib cannot write; the embed choice is then refused. */
  canEmbed: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (_target: SaveTarget) => void;
}

export default function SaveDialog({
  open,
  sidecarPath,
  canEmbed,
  saving,
  onClose,
  onSave,
}: SaveDialogProps) {
  const [target, setTarget] = useState<SaveTarget>('sidecar');
  const effective = canEmbed ? target : 'sidecar';

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title="Save Lyrics as"
      maxWidth="sm"
      actions={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="contained" onClick={() => onSave(effective)} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      {/* Side by side so the two read as alternatives, not as a list to work
          down. One column on a phone, where they would be too narrow. */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
          gap: 1.5,
        }}
      >
        <Choice selected={effective === 'sidecar'} onClick={() => setTarget('sidecar')}>
          <Radio checked={effective === 'sidecar'} size="small" sx={{ alignSelf: 'flex-start' }} />
          <Typography fontWeight={600}>.lrc file</Typography>
          <Typography variant="body2" sx={{ opacity: 0.65 }}>
            Written next to the track. Works for every format, and the player reads it before
            anything embedded.
          </Typography>
          <Typography variant="caption" sx={{ opacity: 0.5, mt: 'auto', wordBreak: 'break-all' }}>
            {sidecarPath}
          </Typography>
        </Choice>

        <Choice
          selected={effective === 'embed'}
          aria-disabled={!canEmbed}
          onClick={() => canEmbed && setTarget('embed')}
        >
          <Radio
            checked={effective === 'embed'}
            size="small"
            disabled={!canEmbed}
            sx={{ alignSelf: 'flex-start' }}
          />
          <Typography fontWeight={600}>Embed in the file</Typography>
          <Typography variant="body2" sx={{ opacity: 0.65 }}>
            Stored in the track&apos;s own tags, so the lyrics travel with the file when you copy it
            elsewhere.
          </Typography>
          {!canEmbed && (
            <Typography variant="caption" color="warning.main" sx={{ mt: 'auto' }}>
              This file&apos;s format cannot be tagged.
            </Typography>
          )}
        </Choice>
      </Box>
    </AppDialog>
  );
}
