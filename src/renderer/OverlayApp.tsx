import React, { useState, useEffect, useRef } from 'react';
import { alpha, createTheme } from '@mui/material';
import { DEFAULT_AA } from '../config/constants';
import { getBaseTheme } from '../config/theme';
import { getActiveTheme, getThemeSettings } from './utils/LocStoreUtil';

const { ipcRenderer } = window.require('electron');

interface TrackData {
  title: string;
  artist: string;
  album: string;
  albumArt: string | null;
  queueIndex: number;
  queueTotal: number;
  status: 'new-track' | 'playing' | 'paused';
}

/**
 * The overlay renders plain DOM, not MUI components, so it builds the palette itself
 * rather than mounting a ThemeProvider it would never read from.
 */
const useOverlayPalette = () => {
  const settings = getThemeSettings();
  const mode =
    settings.mode === 1
      ? 'light'
      : settings.mode === 2
        ? 'dark'
        : window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';
  return createTheme(getBaseTheme(mode, getActiveTheme())).palette;
};

const OverlayApp: React.FC = () => {
  const [track, setTrack] = useState<TrackData | null>(null);
  const [visible, setVisible] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const palette = useOverlayPalette();

  useEffect(() => {
    const handler = (_: Electron.IpcRendererEvent, data: TrackData) => {
      // First paint in hidden state, then transition in on the next two frames
      setTrack(data);
      setVisible(false);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setVisible(true);
          if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
          hideTimerRef.current = setTimeout(() => {
            setVisible(false);
            // After exit animation, tell main to hide the window
            setTimeout(() => ipcRenderer.send('hide-overlay'), 450);
          }, 3200);
        });
      });
    };

    ipcRenderer.on('show-overlay', handler);
    return () => {
      ipcRenderer.removeListener('show-overlay', handler);
    };
  }, []);

  const albumArtSrc = track?.albumArt
    ? `file:///${track.albumArt.replace(/\\/g, '/')}`
    : DEFAULT_AA;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          bottom: 10,
          right: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: alpha(palette.background.default, 0.9),
          border: `1px solid ${alpha(palette.text.primary, 0.1)}`,
          borderRadius: 12,
          boxShadow: '0 2px 10px rgba(0,0,0,0.85)',
          padding: '8px 14px 8px 8px',
          /* Slide-in from the right edge */
          transform: visible ? 'translateX(0)' : 'translateX(calc(100% + 20px))',
          opacity: visible ? 1 : 0,
          transition: 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease',
          backdropFilter: 'blur(40px) saturate(180%)',
          WebkitBackdropFilter: 'blur(40px) saturate(180%)',
        }}
      >
        {/* Album Art */}
        <img
          src={albumArtSrc}
          alt="album"
          style={{
            width: 52,
            height: 52,
            borderRadius: 8,
            objectFit: 'cover',
            flexShrink: 0,
            border: `1px solid ${alpha(palette.text.primary, 0.12)}`,
          }}
        />

        {/* Track info */}
        <div style={{ minWidth: 0, flex: 1 }}>
          {/* Badge row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginBottom: 3,
            }}
          >
            {track && track.queueTotal > 0 && (
              <span
                style={{
                  color: palette.text.secondary,
                  fontSize: 10,
                  lineHeight: 1,
                }}
              >
                {track.queueIndex + 1} of {track.queueTotal}
              </span>
            )}
            <span
              style={{
                background:
                  track?.status === 'paused'
                    ? alpha(palette.text.primary, 0.15)
                    : track?.status === 'playing'
                      ? palette.surfaces.positive
                      : palette.surfaces.accent,
                borderRadius: 4,
                padding: '2px 6px',
                fontSize: 9,
                fontWeight: 700,
                color: track?.status === 'paused' ? palette.text.primary : palette.common.white,
                letterSpacing: 0.5,
                textTransform: 'uppercase',
                lineHeight: 1,
              }}
            >
              {track?.status === 'paused'
                ? '⏸ Paused'
                : track?.status === 'playing'
                  ? '▶ Playing'
                  : 'Now Playing'}
            </span>
          </div>

          {/* Title */}
          <div
            style={{
              color: palette.text.primary,
              fontWeight: 600,
              fontSize: 13,
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
              lineHeight: 1.35,
              maxWidth: '200px',
            }}
          >
            {track?.title || '—'}
          </div>

          {/* Artist */}
          {track?.artist && (
            <div
              style={{
                color: palette.text.secondary,
                fontSize: 11,
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
                lineHeight: 1.3,
                maxWidth: '200px',
              }}
            >
              {track.artist}
            </div>
          )}

          {/* Album */}
          {track?.album && (
            <div
              style={{
                color: palette.surfaces.accent,
                fontSize: 11,
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
                lineHeight: 1.3,
                maxWidth: '200px',
              }}
            >
              {track.album}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default OverlayApp;
