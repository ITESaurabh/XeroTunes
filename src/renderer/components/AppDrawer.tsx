import MuiDrawer from '@mui/material/Drawer';
import { styled, Theme } from '@mui/material/styles';

/** Width of the app's left rail, shared by every screen that has one. */
export const DRAWER_WIDTH = 320;

/**
 * The left rail: permanent on desktop, collapsing to an icon strip when closed,
 * and a temporary sheet on phones.
 *
 * Shared rather than per-screen so a takeover like Lyric Studio, which swaps the
 * navigation for a rail of its own, still sits at the same width and answers the
 * title bar's menu button the same way.
 *
 * The paper is left unstyled here: how far it clears the fixed title bar depends
 * on whether the caller has already padded for it.
 *
 * For the `permanent` variant only. The paper is `position: relative` so it sits
 * in the page flow, which stops a `temporary` modal rendering anywhere visible;
 * the phone sheet is a plain `Drawer`, as the title bar's menu uses.
 */
const AppDrawer = styled(MuiDrawer, { shouldForwardProp: prop => prop !== 'open' })(
  ({ theme, open }: { theme: Theme; open?: boolean }) => ({
    '& .MuiDrawer-paper': {
      position: 'relative',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      width: DRAWER_WIDTH,
      transition: theme.transitions.create('width', {
        easing: theme.transitions.easing.sharp,
        duration: theme.transitions.duration.enteringScreen,
      }),
      boxSizing: 'border-box',
      ...(!open && {
        overflowX: 'hidden',
        transition: theme.transitions.create('width', {
          easing: theme.transitions.easing.sharp,
          duration: theme.transitions.duration.leavingScreen,
        }),
        width: theme.spacing(7),
        [theme.breakpoints.up('sm')]: {
          width: theme.spacing(9),
        },
      }),
    },
  })
);

export default AppDrawer;
