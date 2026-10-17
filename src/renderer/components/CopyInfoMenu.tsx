import React from 'react';
import { Menu, MenuItem } from '@mui/material';
import type { QueueTrack, Track } from '../utils/store';

interface CopyInfoMenuProps {
  track: Track | QueueTrack | null;
  anchorEl: HTMLElement | null;
  onClose: () => void;
  onCopied: (_text: string) => void;
}

const CopyInfoMenu: React.FC<CopyInfoMenuProps> = ({ track, anchorEl, onClose, onCopied }) => {
  const title = (track?.Title as string) || '';
  const artist = (track?.ArtistName as string) || '';
  const options: [string, string][] = [
    ['Artist - Track', artist && title ? `${artist} - ${title}` : ''],
    ['Track', title],
    ['Artist', artist],
    ['Album', (track?.AlbumTitle as string) || ''],
  ];

  return (
    <Menu
      anchorEl={anchorEl}
      open={Boolean(anchorEl)}
      onClose={onClose}
      anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
    >
      {options.map(([label, text]) => (
        <MenuItem
          key={label}
          disabled={!text}
          onClick={() => {
            onClose();
            void navigator.clipboard.writeText(text).then(() => onCopied(text));
          }}
        >
          {label}
        </MenuItem>
      ))}
    </Menu>
  );
};

export default CopyInfoMenu;
