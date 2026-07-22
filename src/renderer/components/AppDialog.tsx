import React from 'react';
import {
  Dialog,
  DialogContent,
  Stack,
  Typography,
  Grow,
  useMediaQuery,
  Theme,
  SxProps,
} from '@mui/material';

interface AppDialogProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  headerAction?: React.ReactNode;
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

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={maxWidth}
      fullWidth={fullWidth}
      fullScreen={fullScreenOnMobile ? isPhone : false}
      scroll={scroll}
      sx={{ mt: 4, zIndex: (theme: Theme) => theme.zIndex.drawer + 1 }}
      PaperProps={{ sx: { flex: 1 } }}
      slotProps={{
        backdrop: {
          sx: {
            backgroundColor: (theme: Theme) =>
              theme.palette.mode === 'dark' ? 'rgba(0, 0, 0, 0.5)' : 'rgba(255,255,255,0.5)',
            backdropFilter: 'blur(2px)',
          },
        },
      }}
      TransitionComponent={Grow}
      TransitionProps={{ onEntered }}
    >
      {(title || headerAction) && (
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{
            p: 1.5,
            backgroundColor: (theme: Theme) => theme.palette.background.paper,
          }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 700, pl: 1 }}>
            {title}
          </Typography>
          {headerAction}
        </Stack>
      )}

      <DialogContent
        dividers={dividers}
        sx={{
          backgroundColor: (theme: Theme) => theme.palette.background.paper,
          p: 2,
          ...contentSx,
        }}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
};

export default AppDialog;