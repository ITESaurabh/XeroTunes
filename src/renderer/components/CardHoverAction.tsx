import React from 'react';
import { alpha, IconButton } from '@mui/material';
import { Icon, IconifyIcon } from '@iconify/react';
import { revealOnCardHoverSx } from '../styles/listSx';

export type CardCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

const CORNER_OFFSET = 10;

// Plain coordinates, not SxProps<Theme>: that type's array/function members
// can't be spread into a bare sx object literal without TS complaining.
const CORNER_POSITION: Record<CardCorner, { top?: number; right?: number; bottom?: number; left?: number }> = {
  'top-left': { top: CORNER_OFFSET, left: CORNER_OFFSET },
  'top-right': { top: CORNER_OFFSET, right: CORNER_OFFSET },
  'bottom-left': { bottom: CORNER_OFFSET, left: CORNER_OFFSET },
  'bottom-right': { bottom: CORNER_OFFSET, right: CORNER_OFFSET },
};

interface CardHoverActionProps {
  icon: IconifyIcon | string;
  ariaLabel: string;
  onActivate: () => void;
  disabled?: boolean;
  /** @default 'top-right' */
  corner?: CardCorner;
  iconWidth?: number;
  /** Skip the hover-reveal and always render visible, e.g. a touch layout with no hover. */
  alwaysVisible?: boolean;
}

/**
 * Icon-button overlay pinned to a corner of a card's artwork, hidden until
 * the card (marked with CARD_HOVER_CLASS) is hovered. The building block for
 * any per-card hover action — a new action is a new icon/corner/onActivate,
 * not a new component. Multiple actions sharing one corner is the caller's
 * layout to arrange, not this component's concern.
 */
const CardHoverAction: React.FC<CardHoverActionProps> = ({
  icon,
  ariaLabel,
  onActivate,
  disabled,
  corner = 'top-right',
  iconWidth = 24,
  alwaysVisible = false,
}) => (
  <IconButton
    size="small"
    title={ariaLabel}
    aria-label={ariaLabel}
    disabled={disabled}
    onMouseDown={e => e.stopPropagation()}
    onClick={e => {
      e.stopPropagation();
      onActivate();
    }}
    sx={{
      position: 'absolute',
      ...CORNER_POSITION[corner],
      padding: 1,
      color: 'common.white',
      bgcolor: theme => alpha(theme.palette.common.black, 0.45),
      '&:hover': { bgcolor: theme => alpha(theme.palette.common.black, 0.65) },
      ...(alwaysVisible ? {} : revealOnCardHoverSx),
    }}
  >
    <Icon icon={icon} width={iconWidth} />
  </IconButton>
);

export default CardHoverAction;
