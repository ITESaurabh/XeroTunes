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
  // An album cover's embedded original; `capped` when the preview is a scaled-down copy.
  const [original, setOriginal] = React.useState<{
    width: number;
    height: number;
    capped: boolean;
  } | null>(null);
  const [menuPos, setMenuPos] = React.useState<{ top: number; left: number } | null>(null);
  const isPhone = useMediaQuery((theme: Theme) => theme.breakpoints.down('md'));

  React.useEffect(() => {
    setResolution('');
  }, [imageSrc]);

  React.useEffect(() => {
    setOriginal(null);
    if (!open || !imageSrc) return;
    let cancelled = false;
    ipcRenderer
      .invoke('get-original-cover', { src: imageSrc })
      .then((info: typeof original) => {
        if (!cancelled) setOriginal(info);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, imageSrc]);

  const handleContextMenu = (event: React.MouseEvent) => {
    if (!imageSrc) return;
    event.preventDefault();
    setMenuPos({ top: event.clientY, left: event.clientX });
  };

  const handleCloseMenu = () => setMenuPos(null);

  const handleSaveImage = async (saveOriginal: boolean) => {
    handleCloseMenu();
    if (!imageSrc) return;
    try {
      await ipcRenderer.invoke('save-image', {
        src: imageSrc,
        suggestedName: imageAlt,
        original: saveOriginal,
      });
    } catch {
      /* ignore: non-critical for the user */
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={isPhone}
      maxWidth={false}
      scroll="paper"
      sx={{ mt: 4, zIndex: (theme: Theme) => theme.zIndex.drawer + 1 }}
      PaperProps={{
        onClick: onClose,
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
          maxWidth: { xs: '92vw', md: '50%' },
          gap: 1,
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
    >
      {imageSrc ? (
        <Box
          component="img"
          src={imageSrc}
          alt={imageAlt}
          onClick={e => e.stopPropagation()}
          onContextMenu={handleContextMenu}
          onLoad={event => {
            const { naturalWidth, naturalHeight } = event.currentTarget;
            if (naturalWidth > 0 && naturalHeight > 0) {
              setResolution(`${naturalWidth} x ${naturalHeight}`);
            }
          }}
          sx={{
            alignSelf: 'center',
            width: 'auto',
            height: 'auto',
            maxWidth: '100%',
            maxHeight: { xs: '50vh', md: '78vh' },
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
          sx={{ color: 'text.secondary', minHeight: 20 }}
        >
          {resolution}
          {resolution && original?.capped && ` (original ${original.width} x ${original.height})`}
        </Typography>
        <Button
          size="small"
          variant="text"
          onClick={onClose}
          sx={{ color: 'text.primary', fontWeight: 700, fontSize: '0.95rem' }}
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
        {original?.capped ? (
          [
            <MenuItem key="original" onClick={() => handleSaveImage(true)}>
              Save original ({original.width} x {original.height})…
            </MenuItem>,
            <MenuItem key="shown" onClick={() => handleSaveImage(false)}>
              Save as shown ({resolution})…
            </MenuItem>,
          ]
        ) : (
          // Same size either way, so save the embedded original: a PNG stays a PNG.
          <MenuItem onClick={() => handleSaveImage(!!original)}>Save image…</MenuItem>
        )}
      </Menu>
    </Dialog>
  );
};

export default ImagePreviewDialog;
