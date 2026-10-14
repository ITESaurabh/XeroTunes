import React from 'react';
import {
  Box,
  Dialog,
  DialogContent,
  Stack,
  Typography,
  Grow,
  useMediaQuery,
  Theme,
  SxProps,
} from '@mui/material';
import FloatingScrollbar from './FloatingScrollbar';

interface AppDialogProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  headerAction?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  maxWidth?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  fullWidth?: boolean;
  fullScreenOnMobile?: boolean;
  scroll?: 'paper' | 'body';
  dividers?: boolean;
  contentSx?: SxProps<Theme>;
  onEntered?: () => void;
}

const AppDialog: React.FC<AppDialogProps> = ({
  open,
  onClose,
  title,
  headerAction,
  actions,
  children,
  maxWidth = 'sm',
  fullWidth = true,
  fullScreenOnMobile = true,
  scroll = 'paper',
  dividers = true,
  contentSx,
  onEntered,
}) => {
  const isPhone = useMediaQuery((theme: Theme) => theme.breakpoints.down('md'));
  const contentRef = React.useRef<HTMLDivElement>(null);
  // Grow's scale skews the rail's measurements and nothing re-measures after it.
  const [entered, setEntered] = React.useState(false);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={maxWidth}
      fullWidth={fullWidth}
      fullScreen={fullScreenOnMobile ? isPhone : false}
      scroll={scroll}
      onClick={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      sx={{ mt: 4, zIndex: (theme: Theme) => theme.zIndex.drawer + 1 }}
      PaperProps={{
        sx: {
          flex: 1,
          border: (theme: Theme) => `1px solid ${theme.palette.surfaces.glassBorder}`,
        },
      }}
      slotProps={{
        backdrop: {
          sx: {
            backgroundColor: (theme: Theme) => theme.palette.surfaces.scrim,
            backdropFilter: 'blur(2px)',
          },
        },
      }}
      TransitionComponent={Grow}
      TransitionProps={{
        onEntered: () => {
          setEntered(true);
          onEntered?.();
        },
        onExit: () => setEntered(false),
      }}
    >
      {(title || headerAction) && (
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{
            pt: 1.5,
            px: 1.5,
            backgroundColor: (theme: Theme) => theme.palette.background.paper,
          }}
        >
          <Typography variant="body1" sx={{ fontWeight: 600, pl: 0.5, fontSize: 18 }}>
            {title}
          </Typography>
          {headerAction}
        </Stack>
      )}

      {entered && <FloatingScrollbar targetRef={contentRef} />}
      <DialogContent
        ref={contentRef}
        dividers={dividers}
        sx={{
          backgroundColor: (theme: Theme) => theme.palette.background.paper,
          borderColor: (theme: Theme) => theme.palette.surfaces.glassBorder,
          borderTop: 'none',
          p: 2,
          scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
          ...contentSx,
        }}
      >
        {children}
      </DialogContent>

      {actions && (
        <Box
          sx={{
            p: 1.5,
            display: 'grid',
            gridAutoFlow: 'column',
            gridAutoColumns: '1fr',
            gap: 1,
            backgroundColor: (theme: Theme) => theme.palette.surfaces.listHeader,
            '& .MuiButton-root': { width: '100%' },
          }}
        >
          {actions}
        </Box>
      )}
    </Dialog>
  );
};

export default AppDialog;
