import React, { useState, useCallback } from 'react';
import { Typography, Menu, MenuItem } from '@mui/material';
import { useNavigate } from 'react-router';

const { ipcRenderer } = window.require('electron');

interface Props {
  artistNameRaw: string | undefined | null;
  variant?: 'body2' | 'caption';
}

const ArtistCell: React.FC<Props> = ({ artistNameRaw, variant = 'body2' }) => {
  const navigate = useNavigate();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const artistNames = React.useMemo(
    () =>
      (artistNameRaw || '')
        .split(',')
        .map(n => n.trim())
        .filter(Boolean),
    [artistNameRaw]
  );

  const displayText = artistNames.join(', ');

  const navigateToArtist = useCallback(
    async (name: string) => {
      try {
        const result = await ipcRenderer.invoke('find-artist-by-name', { name });
        if (result?.id) navigate(`/main_window/artists/${result.id}`);
      } catch {
        /* ignore */
      }
    },
    [navigate]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLSpanElement>) => {
      e.stopPropagation();
      if (!artistNames.length) return;
      if (artistNames.length === 1) {
        navigateToArtist(artistNames[0]);
      } else {
        setAnchorEl(e.currentTarget);
      }
    },
    [artistNames, navigateToArtist]
  );

  const handleClose = useCallback(() => setAnchorEl(null), []);

  const handleMenuItemClick = useCallback(
    (name: string) => {
      setAnchorEl(null);
      navigateToArtist(name);
    },
    [navigateToArtist]
  );

  if (!artistNames.length) {
    return (
      <Typography variant={variant} noWrap>
        {displayText}
      </Typography>
    );
  }

  return (
    <>
      <Typography
        variant={variant}
        noWrap
        data-nav-cell="true"
        onMouseDown={e => e.stopPropagation()}
        onClick={handleClick}
        sx={{
          cursor: 'pointer',
          display: 'block',
          '&:hover': { textDecoration: 'underline', color: 'primary.main' },
        }}
      >
        {displayText}
      </Typography>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleClose}
        onClick={e => e.stopPropagation()}
      >
        {artistNames.map(name => (
          <MenuItem
            key={name}
            onClick={e => {
              e.stopPropagation();
              handleMenuItemClick(name);
            }}
          >
            {name}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
};

export default ArtistCell;
