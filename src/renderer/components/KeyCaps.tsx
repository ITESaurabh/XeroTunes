import React from 'react';
import { Box, Stack, alpha } from '@mui/material';
import type { SystemStyleObject, Theme } from '@mui/system';
import { shortcutParts, type ShortcutKeys } from '../utils/useKeyboardShortcuts';

export const keyCapSx: SystemStyleObject<Theme> = {
  padding: '0.25rem 0.5rem',
  borderRadius: '0.4rem',
  border: 1,
  borderColor: (theme: Theme) => alpha(theme.palette.text.primary, 0.3),
  backgroundColor: (theme: Theme) => alpha(theme.palette.text.primary, 0.1),
};

export default function KeyCaps({ shortcut }: { shortcut: ShortcutKeys }) {
  return (
    <Stack direction="row" gap={0.5} alignItems="center" sx={{ flexShrink: 0 }}>
      {shortcutParts(shortcut).map((part, i) => (
        <React.Fragment key={part}>
          {i > 0 && (
            <Box component="span" sx={{ opacity: 0.45, fontSize: '0.75rem' }}>
              +
            </Box>
          )}
          <Box
            component="kbd"
            sx={[
              keyCapSx,
              // kbd defaults to monospace, which reads as code rather than as a key.
              { fontFamily: 'inherit', fontSize: '0.75rem', lineHeight: 1.5 },
            ]}
          >
            {part}
          </Box>
        </React.Fragment>
      ))}
    </Stack>
  );
}
