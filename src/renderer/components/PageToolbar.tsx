import React from 'react';
import { Typography, AppBar, Toolbar } from '@mui/material';

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
        <>{action ? action : null}</>
      </Toolbar>
    </AppBar>
  );
}

export default PageToolbar;
