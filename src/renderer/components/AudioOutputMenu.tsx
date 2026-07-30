import React, { useCallback, useEffect, useState } from 'react';
import { Menu, MenuItem, ListItemIcon, ListItemText, PopoverOrigin } from '@mui/material';
import { Icon } from '@iconify/react';
import checkmark16Regular from '@iconify/icons-fluent/checkmark-16-regular';
import { getAudioOutputDeviceId, setAudioOutputDeviceId } from '../utils/LocStoreUtil';

interface AudioOutputMenuProps {
  anchorEl: HTMLElement | null;
  open: boolean;
  /** Fired after a device is chosen or the menu is dismissed. */
  onClose: () => void;
  anchorOrigin?: PopoverOrigin;
  transformOrigin?: PopoverOrigin;
}

function deviceLabel(device: MediaDeviceInfo): string {
  if (device.label) return device.label;
  return device.deviceId === 'default' ? 'System Default' : 'Audio device';
}

/**
 * Output-device picker backed by the shared audioOutputDeviceId setting.
 * Selecting a device persists it and fires the change event that re-routes
 * playback live. Anchor it wherever it needs to open.
 */
const AudioOutputMenu: React.FC<AudioOutputMenuProps> = ({
  anchorEl,
  open,
  onClose,
  anchorOrigin = { vertical: 'top', horizontal: 'right' },
  transformOrigin = { vertical: 'bottom', horizontal: 'left' },
}) => {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [currentSinkId, setCurrentSinkId] = useState<string>(() => getAudioOutputDeviceId());

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    let cancelled = false;
    const refresh = (): void => {
      navigator.mediaDevices
        .enumerateDevices()
        .then(list => {
          if (!cancelled) setDevices(list.filter(d => d.kind === 'audiooutput'));
        })
        .catch(() => undefined);
    };
    refresh();
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener('devicechange', refresh);
    };
  }, []);

  useEffect(() => {
    if (open) setCurrentSinkId(getAudioOutputDeviceId());
  }, [open]);

  const handleSelect = useCallback(
    (deviceId: string) => {
      setAudioOutputDeviceId(deviceId);
      setCurrentSinkId(deviceId);
      onClose();
    },
    [onClose]
  );

  return (
    <Menu
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={anchorOrigin}
      transformOrigin={transformOrigin}
    >
      {devices.length === 0 ? (
        <MenuItem disabled>No output devices</MenuItem>
      ) : (
        devices.map(device => {
          // The saved sink may be gone (unplugged); fall back so a row stays selected.
          const selectedId = devices.some(d => d.deviceId === currentSinkId)
            ? currentSinkId
            : 'default';
          const selected = device.deviceId === selectedId;
          return (
            <MenuItem
              key={device.deviceId}
              selected={selected}
              onClick={() => handleSelect(device.deviceId)}
            >
              <ListItemIcon>
                {selected && <Icon icon={checkmark16Regular} width={18} />}
              </ListItemIcon>
              <ListItemText>{deviceLabel(device)}</ListItemText>
            </MenuItem>
          );
        })
      )}
    </Menu>
  );
};

export default AudioOutputMenu;
