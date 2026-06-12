import React from 'react';
import {
  Box,
  Button,
  Dialog,
  Grow,
  Menu,
  MenuItem,
  Theme,
  Typography,
  useMediaQuery,
} from '@mui/material';

const { ipcRenderer } = window.require('electron');

interface ImagePreviewDialogProps {
  open: boolean;
  onClose: () => void;
  imageSrc?: string | null;
  imageAlt?: string;
}

const ImagePreviewDialog: React.FC<ImagePreviewDialogProps> = ({
  open,
  onClose,
  imageSrc,
  imageAlt = 'Preview image',
}) => {
  const [resolution, setResolution] = React.useState<string>('');
  const [menuPos, setMenuPos] = React.useState<{ top: number; left: number } | null>(null);
  const isPhone = useMediaQuery((theme: Theme) => theme.breakpoints.down('md'));

  React.useEffect(() => {
    setResolution('');
  }, [imageSrc]);

  const handleContextMenu = (event: React.MouseEvent) => {
    if (!imageSrc) return;
    event.preventDefault();
    setMenuPos({ top: event.clientY, left: event.clientX });
  };

  const handleCloseMenu = () => setMenuPos(null);

  const handleSaveImage = async () => {
    handleCloseMenu();
    if (!imageSrc) return;
    try {
      await ipcRenderer.invoke('save-image', { src: imageSrc, suggestedName: imageAlt });
    } catch {
      /* ignore — user-facing failure is non-critical */
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={isPhone}
      maxWidth={false}
      // fullWidth
      scroll="paper"
      sx={{ mt: 4, zIndex: (theme: Theme) => theme.zIndex.drawer + 1 }}
      PaperProps={{
        sx: {
          flex: 1,
          m: 0,
          alignContent: 'center',
          justifyContent: 'center',
          backgroundColor: 'transparent',
          background: 'rgba(0, 0, 0, 0)',
          boxShadow: 'none',
          border: 'none',
          overflow: 'visible',
          maxWidth: '50%',
          gap: 1,
        },
      }}
      slotProps={{
        backdrop: {
          sx: {
            backgroundColor: (theme: Theme) =>
              theme.palette.mode === 'dark' ? 'rgba(0, 0, 0, 0.6)' : 'rgba(255,255,255,0.5)',
            backdropFilter: 'blur(2px)',
          },
        },
      }}
      TransitionComponent={Grow}
    >
      {imageSrc ? (
        <Box
          component="img"
          src={imageSrc}
          alt={imageAlt}
          onContextMenu={handleContextMenu}
          onLoad={event => {
            const { naturalWidth, naturalHeight } = event.currentTarget;
            if (naturalWidth > 0 && naturalHeight > 0) {
              setResolution(`${naturalWidth} x ${naturalHeight}`);
            }
          }}
          sx={{
            width: 'auto',
            height: 'auto',
            maxWidth: '100%',
            aspectRatio: '1/1',
            maxHeight: { xs: '50vh', md: '78vh' },
            objectFit: 'contain',
            display: 'block',
          }}
        />
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ p: 3 }}>
          No image available.
        </Typography>
      )}

      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <Typography
          variant="caption"
          textAlign={'center'}
          sx={{ color: 'rgba(255,255,255,0.7)', minHeight: 20 }}
        >
          {resolution}
        </Typography>
        <Button
          size="small"
          variant="text"
          onClick={onClose}
          sx={{ color: 'rgba(255,255,255,0.92)', fontWeight: 700, fontSize: '0.95rem' }}
        >
          Close
        </Button>
      </Box>

      <Menu
        open={menuPos !== null}
        onClose={handleCloseMenu}
        anchorReference="anchorPosition"
        anchorPosition={menuPos ?? undefined}
      >
        <MenuItem onClick={handleSaveImage}>Save image…</MenuItem>
      </Menu>
    </Dialog>
  );
};

export default ImagePreviewDialog;
