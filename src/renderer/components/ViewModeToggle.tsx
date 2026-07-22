import React, { useState, useCallback } from 'react';
import {
  Box,
  IconButton,
  Tooltip,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import { Icon } from '@iconify/react';
import gridViewIcon from '@iconify/icons-fluent/grid-24-regular';
import listViewIcon from '@iconify/icons-fluent/apps-list-24-regular';
import sizeIcon from '@iconify/icons-fluent/resize-24-regular';
import checkIcon from '@iconify/icons-fluent/checkmark-24-regular';
import { GridSize, ViewMode } from '../../config/app_settings';

interface ViewModeToggleProps {
  viewMode: ViewMode;
  gridSize: GridSize;
  onChangeViewMode: (mode: ViewMode) => void;
  onChangeGridSize: (size: GridSize) => void;
}

const SIZE_OPTIONS: ReadonlyArray<{ value: GridSize; label: string }> = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
];

const ViewModeToggle: React.FC<ViewModeToggleProps> = ({
  viewMode,
  gridSize,
  onChangeViewMode,
  onChangeGridSize,
}) => {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const handleOpen = useCallback((e: React.MouseEvent<HTMLElement>) => {
    setAnchor(e.currentTarget);
  }, []);
  const handleClose = useCallback(() => setAnchor(null), []);

  const handlePickSize = useCallback(
    (size: GridSize) => {
      onChangeGridSize(size);
      setAnchor(null);
    },
    [onChangeGridSize]
  );

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Tooltip title="List view">
        <IconButton
          size="small"
          onClick={() => onChangeViewMode('list')}
          color={viewMode === 'list' ? 'primary' : 'default'}
          aria-label="List view"
          aria-pressed={viewMode === 'list'}
        >
          <Icon icon={listViewIcon} height="1.2rem" />
        </IconButton>
      </Tooltip>
      <Tooltip title="Grid view">
        <IconButton
          size="small"
          onClick={() => onChangeViewMode('grid')}
          color={viewMode === 'grid' ? 'primary' : 'default'}
          aria-label="Grid view"
          aria-pressed={viewMode === 'grid'}
        >
          <Icon icon={gridViewIcon} height="1.2rem" />
        </IconButton>
      </Tooltip>
      {viewMode === 'grid' && (
        <>
          <Tooltip title="Grid size">
            <IconButton
              size="small"
              onClick={handleOpen}
              aria-label="Grid size"
              aria-haspopup="menu"
              aria-expanded={anchor ? 'true' : undefined}
            >
              <Icon icon={sizeIcon} height="1.2rem" />
            </IconButton>
          </Tooltip>
          <Menu anchorEl={anchor} open={!!anchor} onClose={handleClose}>
            {SIZE_OPTIONS.map(opt => (
              <MenuItem
                key={opt.value}
                selected={gridSize === opt.value}
                onClick={() => handlePickSize(opt.value)}
                dense
              >
                <ListItemIcon sx={{ minWidth: 28 }}>
                  {gridSize === opt.value && <Icon icon={checkIcon} height="1rem" />}
                </ListItemIcon>
                <ListItemText>{opt.label}</ListItemText>
              </MenuItem>
            ))}
          </Menu>
        </>
      )}
    </Box>
  );
};

export default ViewModeToggle;

export const GRID_MIN_PX: Record<GridSize, number> = {
  small: 110,
  medium: 150,
  large: 200,
};

export const GRID_GAP: Record<GridSize, number> = {
  small: 1,
  medium: 1.5,
  large: 2,
};

export const GRID_ICON_REM: Record<GridSize, string> = {
  small: '2rem',
  medium: '3rem',
  large: '4rem',
};
