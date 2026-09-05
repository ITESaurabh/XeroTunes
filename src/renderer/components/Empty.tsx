import React, { useMemo } from 'react';
import { Box, Stack, Typography } from '@mui/material';

import reiJudgy from '../../assets/mascot/rei-judgy.png';

// `{page}` is replaced with the page name; taglines without it work anywhere.
const TAGLINES = [
  'Rei-chan is disappointed with your empty looking {page}',
  'Why not add something here?',
  'Page looks empty... like my stomach',
  'The page is so boring you have to see me like this..',
  "There's nothing here.. Why?",
  'I sat through all of {page} and found nothing',
  'You dragged me here to look at {page}? Nothing is here 🙄',
  'Not a single song? Sad :-(',
  'This is where the music was supposed to be?',
];

export interface EmptyProps {
  /** Page name, substituted into taglines. */
  page: string;
  /** What the user can do about it. */
  hint?: React.ReactNode;
  /** Action rendered under the hint. */
  children?: React.ReactNode;
}

function Empty({ page, hint, children }: EmptyProps) {
  const tagline = useMemo(
    () => TAGLINES[Math.floor(Math.random() * TAGLINES.length)].replace('{page}', page),
    [page]
  );

  return (
    <Stack
      alignItems="center"
      justifyContent="center"
      spacing={1}
      sx={{ flex: 1, minHeight: 0, p: 4, pb: 28, textAlign: 'center' }}
    >
      <Box
        component="img"
        src={reiJudgy}
        alt=""
        sx={{
          height: { xs: 220, sm: 320 },
          maxWidth: '100%',
          objectFit: 'contain',
          pointerEvents: 'none',
          userSelect: 'none',
          opacity: 0.9,
        }}
      />
      <Typography variant="h6" sx={{ lineHeight: 1.3 }}>
        {tagline}
      </Typography>
      {hint && (
        <Typography variant="body2" color="text.secondary">
          {hint}
        </Typography>
      )}
      {children}
    </Stack>
  );
}

export default Empty;
