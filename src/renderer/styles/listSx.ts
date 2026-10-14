import { alpha, type SxProps, type Theme } from '@mui/material';

/**
 * Shared chrome for the virtualised library lists. Everything here derives from the
 * active theme, so a custom or light palette carries through.
 */

export const listHeaderSx: SxProps<Theme> = {
  display: 'flex',
  width: '100%',
  pl: '14px',
  fontWeight: 500,
  color: 'text.primary',
  bgcolor: theme => theme.palette.surfaces.listHeader,
};

/** Tile card in the folder grids. */
export const gridCardSx: SxProps<Theme> = {
  bgcolor: theme => alpha(theme.palette.text.primary, 0.03),
  border: '1px solid',
  borderColor: theme => alpha(theme.palette.text.primary, 0.07),
  transition: 'background-color 0.15s, border-color 0.15s',
  '&:hover': {
    bgcolor: theme => alpha(theme.palette.text.primary, 0.08),
    borderColor: theme => alpha(theme.palette.text.primary, 0.15),
  },
};

/**
 * Put this class on a card's outer container so descendants using
 * `revealOnCardHoverSx` (e.g. `CardHoverAction`) fade in only on hover.
 * A CSS descendant selector, not React state, so it's free to add anywhere.
 */
export const CARD_HOVER_CLASS = 'xt-hover-card';

export const revealOnCardHoverSx: SxProps<Theme> = {
  opacity: 0,
  transition: 'opacity 0.15s ease',
  [`.${CARD_HOVER_CLASS}:hover &`]: { opacity: 1 },
};

/** The glyph is the theme primary, so both fills have to clear it; theme.check.ts asserts that. */
export const artPlaceholderSx: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'primary.main',
  background: theme =>
    `linear-gradient(135deg, ${theme.palette.surfaces.artFrom} 0%, ${theme.palette.surfaces.artTo} 100%)`,
};

export const detailBannerBg = (theme: Theme) => alpha(theme.palette.text.primary, 0.04);

export const listRowSx = (index: number, interactive = true): SxProps<Theme> => {
  const striped = index % 2 !== 0;
  return {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    // Only the tinted rows read as bands, outlined on all four sides so the corners
    // close; a bottom-only border curling into the radius is what looked extruded.
    // The border stays on every row so its 1px doesn't shift alternating text sideways.
    // border: '1px solid',
    borderColor: striped ? theme => alpha(theme.palette.text.primary, 0.12) : 'transparent',
    // Unconditional: an untinted row's box is transparent, so the radius only shows
    // once something fills it (the tint, a hover, or the selection).
    borderRadius: 0.5,
    // sx outranks MUI's own .Mui-selected rule, so the selected state is restated below.
    bgcolor: striped ? theme => alpha(theme.palette.text.primary, 0.03) : 'transparent',
    ...(interactive && {
      '&:hover': { bgcolor: theme => alpha(theme.palette.text.primary, 0.08) },
      '&.Mui-selected, &.Mui-selected:hover': {
        bgcolor: theme => theme.palette.surfaces.selection,
      },
    }),
  };
};
