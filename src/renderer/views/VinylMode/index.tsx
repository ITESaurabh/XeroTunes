import React, { useContext, useState } from 'react';
import { useMediaQuery } from '@mui/material';
import { useNavigate } from 'react-router';
import { Icon, IconifyIcon } from '@iconify/react';
import arrowLeftIcon from '@iconify/icons-fluent/arrow-left-16-filled';
import minimizeIcon from '@iconify/icons-fluent/subtract-16-filled';
import maximizeIcon from '@iconify/icons-fluent/maximize-16-filled';
import restoreIcon from '@iconify/icons-fluent/square-multiple-16-filled';
import closeIcon from '@iconify/icons-fluent/dismiss-16-filled';
import os from 'os';
import { OS_MAC } from '../../../config/constants';
import { sendMessageToNode } from '../../../main/utils/renProcess';
import { store } from '../../utils/store';
import Turntable from './Turntable';
import Catalogue from './Catalogue';
import chevronUpIcon from '@iconify/icons-fluent/chevron-up-16-filled';

const TRAY_HANDLE = 56;

const caption: React.CSSProperties = {
  font: "600 10px/1 Georgia, 'Times New Roman', serif",
  letterSpacing: 2,
  color: '#6a6b72',
  textTransform: 'uppercase',
  textShadow: '0 1px 0 rgba(255,255,255,.75)',
};

// Not in React's CSSProperties; Electron reads it off the inline style all the same.
const appRegion = (v: 'drag' | 'no-drag') => ({ WebkitAppRegion: v }) as React.CSSProperties;

function MetalButton({
  icon,
  label,
  onClick,
  hot,
}: {
  icon: IconifyIcon;
  label: string;
  onClick: () => void;
  /** Heats to the label orange on hover. */
  hot?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const lit = hot && hover;
  return (
    <button
      type="button"
      className="vm-key"
      aria-label={label}
      title={label}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        width: 22,
        height: 22,
        padding: 0,
        border: 'none',
        borderRadius: '50%',
        cursor: 'default',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: lit ? '#fff' : '#1c1c20',
        background: lit
          ? 'radial-gradient(circle at 35% 30%, #ff7a35, #c93f09 80%)'
          : `radial-gradient(circle at 35% 30%, #f2f2f5 0%, ${hover ? '#d8d9de' : '#b9bac0'} 60%, #8e8f95 100%)`,
        boxShadow: '0 1px 3px rgba(0,0,0,.35), inset 0 1px 1px rgba(255,255,255,.8)',
        transition: 'background .12s ease',
      }}
    >
      <Icon icon={icon} width={12} />
    </button>
  );
}

export default function VinylMode() {
  const { state } = useContext(store);
  const navigate = useNavigate();
  const isPhone = useMediaQuery(({ breakpoints }) => breakpoints.down('md'));
  const isMac = os.type() === OS_MAC;
  // Narrow window: the catalogue is a tray that slides up over the deck.
  const [trayOpen, setTrayOpen] = useState(false);

  return (
    <div style={{ height: '100%', position: 'relative' }}>
      {/* window chrome; macOS draws its own traffic lights on the left */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingLeft: isMac ? 76 : 10,
          paddingRight: 10,
          zIndex: 2,
          ...appRegion(state.isFullScreen ? 'no-drag' : 'drag'),
        }}
      >
        <div style={appRegion('no-drag')}>
          <MetalButton icon={arrowLeftIcon} label="Back to library" onClick={() => navigate(-1)} />
        </div>
        {!isMac && !state.isFullScreen && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, ...appRegion('no-drag') }}>
            <MetalButton
              icon={minimizeIcon}
              label="Minimize"
              onClick={() => sendMessageToNode('minimize', null)}
            />
            <MetalButton
              icon={state.isMaximized ? restoreIcon : maximizeIcon}
              label={state.isMaximized ? 'Restore' : 'Maximize'}
              onClick={() => sendMessageToNode('maximize', null)}
            />
            <MetalButton
              icon={closeIcon}
              label="Close"
              hot
              onClick={() => sendMessageToNode('closeWindow', null)}
            />
          </div>
        )}
      </div>

      <div
        style={{
          height: '100%',
          display: 'flex',
          background: 'radial-gradient(ellipse at 30% 38%, #f7f7f8 0%, #ececef 50%, #d2d2d7 100%)',
        }}
      >
        <div
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            // Leave the tray's handle clear of the turntable.
            paddingBottom: isPhone ? TRAY_HANDLE : 0,
            // The tonearm's own z-index stays inside the deck, under the tray.
            isolation: 'isolate',
          }}
        >
          <Turntable />
        </div>
        {!isPhone && (
          <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
            <Catalogue />
          </div>
        )}
      </div>

      {isPhone && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: '84%',
            display: 'flex',
            flexDirection: 'column',
            borderRadius: '18px 18px 0 0',
            background: 'linear-gradient(180deg, #e8e9ee, #d5d6db 60%, #cfd0d5)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,.8), 0 -10px 30px rgba(0,0,0,.28)',
            transform: trayOpen ? 'none' : `translateY(calc(100% - ${TRAY_HANDLE}px))`,
            transition: 'transform .45s cubic-bezier(.3,.7,.2,1)',
            zIndex: 4,
          }}
        >
          <button
            type="button"
            onClick={() => setTrayOpen(o => !o)}
            aria-expanded={trayOpen}
            style={{
              position: 'relative',
              height: TRAY_HANDLE,
              flex: 'none',
              border: 'none',
              background: 'none',
              padding: '0 20px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
            }}
          >
            <span style={caption}>Catalogue</span>
            {/* centred regardless of the caption's width */}
            <span
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                width: 44,
                height: 5,
                borderRadius: 3,
                background: 'linear-gradient(180deg,#f4f4f6,#a9aab0)',
                boxShadow: '0 1px 2px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.9)',
              }}
            />
            <Icon
              icon={chevronUpIcon}
              width={14}
              style={{
                color: '#3a3a40',
                transform: trayOpen ? 'rotate(180deg)' : 'none',
                transition: 'transform .3s',
              }}
            />
          </button>
          <div style={{ flex: 1, minHeight: 0 }}>
            <Catalogue compact />
          </div>
        </div>
      )}
    </div>
  );
}
