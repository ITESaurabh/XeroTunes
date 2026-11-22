import React from 'react';
import { Box, Button, Link, Stack, Typography } from '@mui/material';
import AppDialog from './AppDialog';
import changelog from '../../../CHANGELOG.md';
import { latestReleases, parseChangelog, parseInline } from '../utils/changelog';
import { useIpc } from '../state/ipc';

const ALL = parseChangelog(changelog);
const SHOWN_RELEASES = 5;

interface ChangelogDialogProps {
  open: boolean;
  onClose: () => void;
  /** Stable users never ran the betas. */
  stableOnly?: boolean;
}

const ChangelogDialog: React.FC<ChangelogDialogProps> = ({ open, onClose, stableOnly = false }) => {
  const { sendEventToMainProcess } = useIpc();
  const blocks = latestReleases(ALL, SHOWN_RELEASES, stableOnly);

  const inline = (text: string) =>
    parseInline(text).map((span, i) => {
      if (span.kind === 'code')
        return (
          <Box key={i} component="code" sx={{ fontFamily: 'monospace', fontSize: '0.95em' }}>
            {span.text}
          </Box>
        );
      if (span.kind === 'bold') return <strong key={i}>{span.text}</strong>;
      if (span.kind === 'link')
        return (
          <Link
            key={i}
            component="button"
            variant="body2"
            sx={{ verticalAlign: 'baseline' }}
            onClick={() => sendEventToMainProcess('open-external', { url: span.href })}
          >
            {span.text}
          </Link>
        );
      return span.text;
    });

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title="Changelog"
      actions={<Button onClick={onClose}>Close</Button>}
    >
      <Stack spacing={1}>
        {blocks.map((block, i) => {
          if (block.kind === 'version')
            return (
              <Typography key={i} variant="h6" sx={{ pt: i ? 2 : 0 }}>
                {block.text}
              </Typography>
            );
          if (block.kind === 'section')
            return (
              <Typography key={i} variant="subtitle2" color="text.secondary">
                {block.text}
              </Typography>
            );
          if (block.kind === 'list')
            return (
              <Box key={i} component="ul" sx={{ m: 0, pl: 2.5 }}>
                {block.items.map((item, j) => (
                  <Typography key={j} component="li" variant="body2" sx={{ py: 0.25 }}>
                    {inline(item)}
                  </Typography>
                ))}
              </Box>
            );
          return (
            <Typography key={i} variant="body2">
              {inline(block.text)}
            </Typography>
          );
        })}
      </Stack>
    </AppDialog>
  );
};

export default ChangelogDialog;
