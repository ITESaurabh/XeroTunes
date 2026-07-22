import React, { useState, useCallback } from 'react';
import { Typography, Menu, MenuItem } from '@mui/material';
import { useNavigate } from 'react-router';

const { ipcRenderer } = window.require('electron');

interface Props {
  artistNameRaw: string | undefined | null;
  variant?: 'body2' | 'caption';
  /**
   * When true, clicking navigates to the album-artist page
   * (`/album-artists/:id`) instead of the regular track-artist page
   * (`/artists/:id`). Use this wherever the name represents an album artist,
   * e.g. the album header, since album-artist-only entities have no
   * track-level rows and would otherwise show "No tracks found".
   */
  albumArtist?: boolean;
}

const ArtistCell: React.FC<Props> = ({ artistNameRaw, variant = 'body2', albumArtist = false }) => {
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
        if (result?.id) {
          const base = albumArtist ? 'album-artists' : 'artists';
          navigate(`/main_window/${base}/${result.id}`);
        }
      } catch {
        /* ignore */
      }
    },
    [navigate, albumArtist]
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
