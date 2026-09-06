import React from 'react';
import { Box, Typography, AppBar, Toolbar } from '@mui/material';

/**
 * Portal target for a page's table controls. LibraryTable is a sibling of this
 * component, not a child, so it reaches the title row through the DOM rather
 * than by threading a toolbar prop through every view.
 */
export const TABLE_ACTIONS_SLOT_ID = 'xt-page-toolbar-actions';

function PageToolbar({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <AppBar
      position="sticky"
      color="transparent"
      sx={{
        borderRadius: 10,
        zIndex: 0,
        backgroundColor: theme =>
          theme.palette.mode === 'dark'
            ? theme.palette.surfaces.elevated
            : theme.palette.background.paper,
      }}
      elevation={0}
    >
      <Toolbar sx={{ py: '1rem', px: '2rem', justifyContent: 'space-between' }} disableGutters>
        <Typography
          variant="h4"
          sx={{
            fontFamily: 'Roboto',
            fontStyle: 'normal',
            fontWeight: '400',
            lineHeight: 'normal',
          }}
        >
          {title}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box id={TABLE_ACTIONS_SLOT_ID} sx={{ display: 'flex', alignItems: 'center' }} />
          {action}
        </Box>
      </Toolbar>
    </AppBar>
  );
}

export default PageToolbar;
