import React, { useCallback, useEffect, useState } from 'react';
import {
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Divider,
  CircularProgress,
  PopoverOrigin,
} from '@mui/material';
import { Icon } from '@iconify/react';
import tv24Regular from '@iconify/icons-fluent/tv-24-regular';
import checkmark16Regular from '@iconify/icons-fluent/checkmark-16-regular';
import castOff24Regular from '@iconify/icons-fluent/cast-multiple-24-regular';
import type { CastDevice } from '../../main/modules/Cast';

const { ipcRenderer } = window.require('electron');

interface CastDeviceMenuProps {
  anchorEl: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  onSelect: (_device: CastDevice) => void;
  onStopCasting: () => void;
  connectedDeviceId: string | null;
  anchorOrigin?: PopoverOrigin;
  transformOrigin?: PopoverOrigin;
}

/** Chromecast device picker; PlayBar owns the actual cast session. */
const CastDeviceMenu: React.FC<CastDeviceMenuProps> = ({
  anchorEl,
  open,
  onClose,
  onSelect,
  onStopCasting,
  connectedDeviceId,
  anchorOrigin = { vertical: 'top', horizontal: 'right' },
  transformOrigin = { vertical: 'bottom', horizontal: 'left' },
}) => {
  const [devices, setDevices] = useState<CastDevice[]>([]);

  useEffect(() => {
    const handler = (_e: unknown, list: CastDevice[]) => setDevices(list);
    ipcRenderer.on('cast-devices', handler);
    return () => {
      ipcRenderer.removeListener('cast-devices', handler);
    };
  }, []);

  // Browse only while open, so we aren't holding an mDNS socket the whole session.
  useEffect(() => {
    if (open) {
      ipcRenderer.send('cast-start-discovery');
    } else {
      ipcRenderer.send('cast-stop-discovery');
    }
  }, [open]);

  const handleSelect = useCallback(
    (device: CastDevice) => {
      onSelect(device);
      onClose();
    },
    [onSelect, onClose]
  );

  const handleStop = useCallback(() => {
    onStopCasting();
    onClose();
  }, [onStopCasting, onClose]);

  return (
    <Menu
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={anchorOrigin}
      transformOrigin={transformOrigin}
    >
      {devices.length === 0 ? (
        <MenuItem disabled>
          <ListItemIcon>
            <CircularProgress size={16} />
          </ListItemIcon>
          <ListItemText>Searching for devices…</ListItemText>
        </MenuItem>
      ) : (
        devices.map(device => {
          const selected = device.id === connectedDeviceId;
          return (
            <MenuItem key={device.id} selected={selected} onClick={() => handleSelect(device)}>
              <ListItemIcon>
                <Icon icon={tv24Regular} width={20} />
              </ListItemIcon>
              <ListItemText primary={device.name} secondary={device.host} />
              {selected && <Icon icon={checkmark16Regular} width={18} style={{ marginLeft: 8 }} />}
            </MenuItem>
          );
        })
      )}
      {connectedDeviceId && <Divider />}
      {connectedDeviceId && (
        <MenuItem onClick={handleStop}>
          <ListItemIcon>
            <Icon icon={castOff24Regular} width={20} />
          </ListItemIcon>
          <ListItemText>Stop casting</ListItemText>
        </MenuItem>
      )}
    </Menu>
  );
};

export default CastDeviceMenu;
