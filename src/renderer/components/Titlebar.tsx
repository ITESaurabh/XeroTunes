import { memo, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  styled,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
  Drawer,
} from '@mui/material';
import { useNavigate, useLocation, useNavigationType } from 'react-router';
import { Theme } from '@mui/material/styles';
import ButtonBase, { ButtonBaseProps } from '@mui/material/ButtonBase';
import { sendMessageToNode } from '../../main/utils/renProcess';
import { OS_WINDOWS, APP_NAME, APP_EDITION, OS_MAC } from '../../config/constants';
import arrowleftIcon from '@iconify/icons-fluent/arrow-left-20-filled';
import minimizeIcon from '@iconify/icons-fluent/minimize-16-regular';
import maximizeIcon from '@iconify/icons-fluent/maximize-16-regular';
import restoreIcon from '@iconify/icons-fluent/square-multiple-16-regular';
import restoreKdeIcon from '@iconify/icons-fluent/diamond-16-regular';
import closeIcon from '@iconify/icons-fluent/dismiss-16-regular';
import chevronDownIcon from '@iconify/icons-fluent/chevron-down-16-regular';
import chevronUpIcon from '@iconify/icons-fluent/chevron-up-16-regular';
import menuIcon from '@iconify/icons-fluent/line-horizontal-3-20-filled';
import AppIcon from 'svg-react-loader?name=AppIcon!../../img/logo.svg';
import { Icon } from '@iconify/react';
import { store } from '../utils/store';
import MainDrawer from './MainDrawer';
import { TitleBarStyle } from '../../config/app_settings';
import GnomeCloseIcon from 'svg-react-loader?name=GnomeCloseIcon!../../assets/icons/gnome-close.svg';
import GnomeMinimizeIcon from 'svg-react-loader?name=GnomeMinimizeIcon!../../assets/icons/gnome-minimize.svg';
import GnomeResizeIcon from 'svg-react-loader?name=GnomeResizeIcon!../../assets/icons/gnome-resize.svg';

import os from 'os';

interface NavButtonsProps extends ButtonBaseProps {
  closeButton?: boolean;
}

const NavButtons = styled(ButtonBase, {
  shouldForwardProp: prop => prop !== 'closeButton',
})<NavButtonsProps>(({ theme, closeButton }) => ({
  height: '100%',
  width: '46px',
  transition: 'background-color 0.1s ease-in-out',
  cursor: 'default',
  '&:hover': {
    backgroundColor: closeButton
      ? theme.palette.error.main
      : theme.palette.mode === 'dark'
        ? 'rgba(255, 255, 255, 0.05)'
        : 'rgba(0, 0, 0, 0.05)',
  },
}));

const KdeButton = styled(ButtonBase, {
  shouldForwardProp: prop => prop !== 'closeButton',
})<NavButtonsProps>(({ theme, closeButton }) => ({
  height: 20,
  width: 20,
  padding: 2,
  borderRadius: '50%',
  transition: 'background-color 0.1s ease-in-out',
  cursor: 'default',
  '&:hover': {
    backgroundColor: closeButton
      ? theme.palette.error.main
      : theme.palette.mode === 'dark'
        ? 'rgba(255, 255, 255, 0.12)'
        : 'rgba(0, 0, 0, 0.1)',
  },
}));

function resolveEffectiveStyle(style: TitleBarStyle, currOs: string): TitleBarStyle {
  if (style === 'default') {
    if (currOs === OS_MAC) return 'mac';
    if (currOs === OS_WINDOWS) return 'windows';
    return 'linux-gnome';
  }
  if (style === 'mac' && currOs !== OS_MAC) return 'mac-fake';
  return style;
}

const circleSx = (bgColor: string, hoverFilter: string, size = 12) => ({
  borderRadius: '50%',
  width: size,
  height: size,
  bgcolor: bgColor,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  transition: 'filter 0.1s',
  cursor: 'default',
  '&:hover': { filter: hoverFilter },
});

const Titlebar = memo(() => {
  const currOs = os.type();
  const isPhone = useMediaQuery(({ breakpoints }: Theme) => breakpoints.down('md'));
  const theme = useTheme();
  const { state, dispatch } = useContext(store);
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();

  const effectiveStyle = useMemo(
    () => resolveEffectiveStyle(state.titleBarStyle, currOs),
    [state.titleBarStyle, currOs]
  );

  const hasRightControls = effectiveStyle === 'windows' || effectiveStyle === 'linux-kde';

  const inactiveChromeSx = {
    opacity: state.isWindowFocused ? 1 : 0.75,
    transition: state.isWindowFocused ? 'opacity 0.05s ease-out' : 'opacity 0.3s ease-out',
  };

  // Track how many PUSH entries are in our in-app history stack.
  const [navDepth, setNavDepth] = useState(0);
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (navigationType === 'PUSH') {
      setNavDepth(d => d + 1);
    } else if (navigationType === 'POP') {
      setNavDepth(d => Math.max(0, d - 1));
    }
  }, [location.key]);

  const canGoBack = navDepth > 0;

  const toggleDrawer = () => {
    dispatch({ type: 'SET_MENU_EXPANDED', payload: !state.isMenuExpanded });
  };

  return (
    <>
      {isPhone && (
        <Drawer
          open={state.isMenuExpanded}
          PaperProps={{
            style: {
              paddingTop: '32px',
              width: '100%',
              maxWidth: 320,
              backgroundColor:
                theme.palette.mode === 'dark'
                  ? theme.palette.common.black
                  : theme.palette.common.white,
              overflow: 'hidden',
              borderRight: 'none',
            },
          }}
          onClose={() => dispatch({ type: 'SET_MENU_EXPANDED', payload: false })}
        >
          <MainDrawer tempDrawer />
        </Drawer>
      )}
      <Box
        className={hasRightControls ? 'title-bar title-bar_windows' : 'title-bar title-bar_unix'}
        sx={{
          bgcolor: theme.palette.mode === 'light' ? '#f4f1f9' : '#201e23',
          height: '32px',
          pl: effectiveStyle === 'mac' ? 8.5 : 0,
        }}
      >
        <div className="tb-controls">
          {/* macOS fake traffic lights */}
          {effectiveStyle === 'mac-fake' && (
            <div className="traffic-light" style={inactiveChromeSx}>
              <div onClick={() => sendMessageToNode('closeWindow', null)} className="close-unix">
                close
              </div>
              <div onClick={() => sendMessageToNode('minimize', null)} className="mini-unix">
                minimise
              </div>
              <div onClick={() => sendMessageToNode('maximize', null)} className="res-unix">
                resize
              </div>
            </div>
          )}
          <Stack
            display={'flex'}
            alignItems={'center'}
            direction={'row'}
            sx={{ '-webkit-app-region': 'no-drag', ...inactiveChromeSx }}
            ml={'0.5rem'}
          >
            <Button
              disabled={!canGoBack}
              onClick={() => navigate(-1)}
              sx={{ minWidth: '2.5rem', borderRadius: '0.4rem' }}
              size="small"
            >
              <Icon icon={arrowleftIcon} height="1.4em" />
            </Button>
            {isPhone && (
              <Button
                onClick={toggleDrawer}
                sx={{ minWidth: '2.5rem', borderRadius: '0.4rem' }}
                size="small"
              >
                <Icon icon={menuIcon} height="1.4em" />
              </Button>
            )}
          </Stack>
        </div>

        <Stack
          display={'flex'}
          alignItems={'center'}
          direction={'row'}
          spacing={'0.5rem'}
          ml={1}
          sx={inactiveChromeSx}
        >
          <AppIcon width={18} height={18} />
          <Typography
            sx={{
              color:
                theme.palette.mode === 'light'
                  ? 'var(--M3-sys-light-primary, #9B2E99)'
                  : 'var(--M3-sys-dark-primary, #FFAAF4)',
              fontFamily: 'Roboto',
              fontSize: '14px',
              fontStyle: 'normal',
              fontWeight: '500',
              lineHeight: 'normal',
            }}
          >
            {APP_NAME}
          </Typography>
          <Typography
            sx={{
              color:
                theme.palette.mode === 'light'
                  ? 'var(--Light-Fill-Color-Text-Secondary, rgba(0, 0, 0, 0.61))'
                  : theme.palette.text.secondary,
              fontFamily: 'Roboto',
              fontSize: '12px',
              fontStyle: 'normal',
              fontWeight: '400',
              lineHeight: '16px',
            }}
          >
            {APP_EDITION}
          </Typography>
        </Stack>

        <Box flexGrow={1} />

        {/* Windows style controls */}
        {effectiveStyle === 'windows' && (
          <Box sx={{ '-webkit-app-region': 'no-drag', height: '100%', ...inactiveChromeSx }}>
            <NavButtons onClick={() => sendMessageToNode('minimize', null)}>
              <Icon icon={minimizeIcon} />
            </NavButtons>
            <NavButtons onClick={() => sendMessageToNode('maximize', null)}>
              <Icon icon={state.isMaximized ? restoreIcon : maximizeIcon} />
            </NavButtons>
            <NavButtons closeButton onClick={() => sendMessageToNode('closeWindow', null)}>
              <Icon icon={closeIcon} />
            </NavButtons>
          </Box>
        )}
        {/* GNOME style controls — dark circles with always-visible icons */}
        {effectiveStyle === 'linux-gnome' && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              mr: 0.28,
              gap: 1.6,
              '-webkit-app-region': 'no-drag',
              ...inactiveChromeSx,
            }}
          >
            <Box
              onClick={() => sendMessageToNode('minimize', null)}
              sx={circleSx('#38383C', 'brightness(1.4)', 24)}
            >
              <GnomeMinimizeIcon
                width={15}
                height={14}
                viewBox="0 0 16 16"
                style={{ filter: 'brightness(0) invert(1)' }}
              />
            </Box>
            <Box
              onClick={() => sendMessageToNode('maximize', null)}
              sx={circleSx('#38383C', 'brightness(1.4)', 24)}
            >
              <GnomeResizeIcon
                width={11}
                height={13}
                viewBox="0 0 16 16"
                style={{ filter: 'brightness(0) invert(1)' }}
              />
            </Box>
            <Box
              onClick={() => sendMessageToNode('closeWindow', null)}
              sx={circleSx('#38383C', 'brightness(1.25)', 24)}
              mr={1}
            >
              <GnomeCloseIcon
                width={15}
                height={15}
                viewBox="0 0 16 16"
                style={{ filter: 'brightness(0) invert(1)' }}
              />
            </Box>
          </Box>
        )}
        {/* KDE Plasma Breeze style — compact flat buttons, chevron icons */}
        {effectiveStyle === 'linux-kde' && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              '-webkit-app-region': 'no-drag',
              pr: 1,
              gap: '14px',
              ...inactiveChromeSx,
            }}
          >
            <KdeButton onClick={() => sendMessageToNode('minimize', null)}>
              <Icon icon={chevronDownIcon} width={16} />
            </KdeButton>
            <KdeButton onClick={() => sendMessageToNode('maximize', null)}>
              <Icon icon={state.isMaximized ? restoreKdeIcon : chevronUpIcon} width={16} />
            </KdeButton>
            <KdeButton closeButton onClick={() => sendMessageToNode('closeWindow', null)}>
              <Icon icon={closeIcon} width={16} />
            </KdeButton>
          </Box>
        )}
      </Box>
    </>
  );
});

Titlebar.displayName = 'Titlebar';

export default Titlebar;
