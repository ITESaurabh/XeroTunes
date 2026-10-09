import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  IconButton,
  MenuItem,
  Select,
  Slider,
  Stack,
  Typography,
  useTheme,
} from '@mui/material';
import { Icon } from '@iconify/react';
import speakerIcon from '@iconify/icons-fluent/speaker-2-24-regular';
import speakerMuteIcon from '@iconify/icons-fluent/speaker-mute-24-regular';
import AppDialog from './AppDialog';
import SurroundSyncDialog from './SurroundSyncDialog';
import AmbionHelp from './AmbionHelp';
import {
  getSurroundSettings,
  getVolumeLevel,
  setSurroundSettings,
  VOLUME_CHANGE_EVENT,
} from '../utils/LocStoreUtil';
import * as surround from '../utils/surroundEngine';
import type { SpeakerKind, SurroundDevice, SurroundSettings } from '../../config/surround';
import { SURROUND_PRESETS } from '../../config/surroundPresets';

interface SurroundMixerDialogProps {
  open: boolean;
  onClose: () => void;
}

type Role = 'front' | 'rear';

const KINDS: Array<{ value: SpeakerKind; label: string }> = [
  { value: 'stereo', label: 'Stereo speakers' },
  { value: 'mono', label: 'Single speaker (Bluetooth box)' },
  { value: 'headphones', label: 'Headphones' },
];

const deviceLabel = (d: MediaDeviceInfo): string =>
  d.label || (d.deviceId === 'default' ? 'System Default' : d.deviceId.slice(0, 8));

const asNumber = (v: number | number[]): number => (Array.isArray(v) ? v[0] : v);

// Listener in the middle facing up; speakers sit on a ring by azimuth. A
// stereo pair is drawn as two dots ±30° around its azimuth.

const SIZE = 300;
const RING = 100;
const CENTER = SIZE / 2;
// Keeps the head clear of the LEFT/RIGHT labels.
const HEAD_W = 64;
const HEAD_H = (HEAD_W * 186.19) / 306.61;

const polar = (deg: number, r: number): [number, number] => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [CENTER + r * Math.cos(a), CENTER + r * Math.sin(a)];
};

interface Dot {
  role: Role;
  deg: number;
  level: number;
  muted: boolean;
}

interface RoomProps {
  dots: Dot[];
  selected: Role;
  labels: Record<Role, string>;
  onSelect: (_role: Role) => void;
}

const Room: React.FC<RoomProps> = ({ dots, selected, labels, onSelect }) => {
  const theme = useTheme();
  const accent = theme.palette.primary.main;
  const dim = theme.palette.text.secondary;
  const ticks = Array.from({ length: 36 }, (_, i) => i * 10);
  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ display: 'block' }}>
      <circle cx={CENTER} cy={CENTER} r={RING + 14} fill="none" stroke={dim} strokeOpacity={0.25} />
      {ticks.map(t => {
        const major = t % 90 === 0;
        const [x1, y1] = polar(t, RING + 14);
        const [x2, y2] = polar(t, RING + (major ? 4 : 9));
        return (
          <line key={t} x1={x1} y1={y1} x2={x2} y2={y2} stroke={dim} strokeOpacity={major ? 0.8 : 0.35} />
        );
      })}
      {(
        [
          ['FRONT', 0],
          ['RIGHT', 90],
          ['REAR', 180],
          ['LEFT', 270],
        ] as Array<[string, number]>
      ).map(([text, deg]) => {
        const [x, y] = polar(deg, RING - 26);
        return (
          <text
            key={text}
            x={x}
            y={y}
            fill={dim}
            fontSize={9}
            letterSpacing={1.5}
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {text}
          </text>
        );
      })}
      <svg
        x={CENTER - HEAD_W / 2}
        y={CENTER - HEAD_H / 2}
        width={HEAD_W}
        height={HEAD_H}
        viewBox="0 0 306.61 186.19"
        color={theme.palette.text.primary}
        fillRule="evenodd"
      >
        <path
          fill="currentColor"
          fillOpacity={0.2}
          d="M153.3 33.8c84.67,0 153.31,27.05 153.31,60.42 0,33.38 -68.64,60.43 -153.31,60.43 -84.66,0 -153.3,-27.05 -153.3,-60.43 0,-33.37 68.64,-60.42 153.3,-60.42z"
        />
        <path
          fill="currentColor"
          d="M153.3 33.8c84.67,0 153.31,27.05 153.31,60.42 0,33.38 -68.64,60.43 -153.31,60.43 -84.66,0 -153.3,-27.05 -153.3,-60.43 0,-33.37 68.64,-60.42 153.3,-60.42zm107.39 20.31c-27.44,-10.81 -65.4,-17.5 -107.39,-17.5 -41.98,0 -79.94,6.69 -107.38,17.5 -26.63,10.5 -43.11,24.7 -43.11,40.11 0,15.42 16.48,29.62 43.11,40.12 27.44,10.81 65.4,17.5 107.38,17.5 41.99,0 79.95,-6.69 107.39,-17.5 26.63,-10.5 43.11,-24.7 43.11,-40.12 0,-15.41 -16.48,-29.61 -43.11,-40.11z"
        />
        <path
          fill="#929294"
          stroke="currentColor"
          strokeWidth={2.81}
          strokeLinecap="square"
          d="M77.34 99.34c-0.23,-38.64 25.41,-68.53 60.49,-77.85 12.21,-3.31 7.6,-19.78 20.75,-20.08 13.16,-0.31 8.34,14.16 22.74,20.85 32.91,10.02 57.12,38.24 57.86,75.27 12.13,0.22 11.79,25.48 -1.74,22.09 -7.78,36.64 -39.27,64.4 -77.48,65.17 -38.57,0.77 -71.39,-26.21 -80.28,-63.04 -13.34,1.25 -13.87,-20.43 -2.34,-22.41z"
        />
        <g stroke="currentColor" strokeWidth={0.7}>
          <ellipse fill="#FEFEFE" cx={121.82} cy={24.84} rx={29.25} ry={20.08} />
          <ellipse fill="#2B2A29" cx={116.94} cy={28.42} rx={17.32} ry={9.68} />
          <ellipse fill="#FEFEFE" cx={192.15} cy={28.28} rx={29.25} ry={20.08} />
          <ellipse fill="#2B2A29" cx={192.13} cy={19.43} rx={17.32} ry={9.68} />
        </g>
      </svg>
      {dots.map((d, i) => {
        const [x, y] = polar(d.deg, RING);
        const r = 7 + 9 * d.level;
        const active = d.role === selected;
        return (
          <g key={i} onClick={() => onSelect(d.role)} style={{ cursor: 'pointer' }}>
            <circle cx={x} cy={y} r={r + 6} fill={accent} fillOpacity={active ? 0.18 : 0} />
            <circle
              cx={x}
              cy={y}
              r={r}
              fill={d.muted ? 'none' : accent}
              fillOpacity={0.35 + 0.65 * d.level}
              stroke={accent}
              strokeWidth={active ? 2 : 1}
            />
          </g>
        );
      })}
      {(['front', 'rear'] as Role[]).map(role => {
        const mine = dots.filter(x => x.role === role);
        if (!mine.length) return null;
        // A stereo pair's dots straddle its azimuth; label the azimuth, not one dot.
        const deg = mine.reduce((s, x) => s + x.deg, 0) / mine.length;
        const [x, y] = polar(deg, RING + 30);
        return (
          <text
            key={role}
            x={x}
            y={y}
            fill={role === selected ? accent : dim}
            fontSize={10}
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {labels[role]}
          </text>
        );
      })}
    </svg>
  );
};

const SurroundMixerDialog: React.FC<SurroundMixerDialogProps> = ({ open, onClose }) => {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [settings, setSettings] = useState<SurroundSettings>(getSurroundSettings);
  // The front's level is the player volume; this dialog is modal, so the
  // value read on open stays current until we change it ourselves.
  const [volume, setVolume] = useState<number>(getVolumeLevel);
  const [selected, setSelected] = useState<Role>('rear');
  const [syncOpen, setSyncOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSettings(getSurroundSettings());
    setVolume(getVolumeLevel());
    navigator.mediaDevices
      .enumerateDevices()
      .then(list => setDevices(list.filter(d => d.kind === 'audiooutput')))
      .catch(() => undefined);
  }, [open]);

  const update = (next: SurroundSettings, commit: boolean): void => {
    setSettings(next);
    // Device, kind and preset changes rebuild the graph, which the player
    // does on the settings event; a level drag is applied live.
    if (commit) setSurroundSettings(next);
    else if (surround.isAttached()) surround.configure(next);
  };

  const changeVolume = (v: number): void => {
    setVolume(v);
    window.dispatchEvent(new CustomEvent(VOLUME_CHANGE_EVENT, { detail: v }));
  };

  const { front, rear, offsetMs } = settings;
  const device: SurroundDevice | null = selected === 'front' ? front : rear;
  const setDevice = (patch: Partial<SurroundDevice>, commit: boolean): void => {
    if (selected === 'front') update({ ...settings, front: { ...front, ...patch } }, commit);
    else if (rear) update({ ...settings, rear: { ...rear, ...patch } }, commit);
  };

  const dots: Dot[] = [];
  const frontLevel = volume / 100;
  if (front.kind === 'mono') dots.push({ role: 'front', deg: front.azimuthDeg, level: frontLevel, muted: false });
  else {
    dots.push({ role: 'front', deg: front.azimuthDeg - 30, level: frontLevel, muted: false });
    dots.push({ role: 'front', deg: front.azimuthDeg + 30, level: frontLevel, muted: false });
  }
  if (rear) dots.push({ role: 'rear', deg: rear.azimuthDeg, level: rear.volume / 100, muted: rear.muted });

  const delayLabel = (ms: number): string => (ms > 0 ? `+${ms} ms` : 'no delay');
  const labels: Record<Role, string> = {
    front: `Front · ${volume}% · ${delayLabel(offsetMs)}`,
    rear: rear ? `Rear · ${rear.muted ? 'muted' : `${rear.volume}%`} · ${delayLabel(-offsetMs)}` : '',
  };

  const presetKey = SURROUND_PRESETS[settings.preset] ? settings.preset : 'natural';

  return (
    <AppDialog
      open={open}
      onClose={onClose}
      title={
        <>
          Ambion mixer
          <Chip
            component="span"
            label="Beta"
            size="small"
            color="primary"
            variant="outlined"
            sx={{ height: 20, ml: 1 }}
          />
          <AmbionHelp />
        </>
      }
      maxWidth="xs"
      fullWidth
      contentSx={{ overflowX: 'hidden' }}
      actions={
        <>
          <Button onClick={() => setSyncOpen(true)}>Sync delay…</Button>
          <Button variant="contained" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ py: 1 }}>
        <Stack spacing={0.5}>
          <Select
            size="small"
            fullWidth
            value={presetKey}
            onChange={e => update({ ...settings, preset: String(e.target.value) }, true)}
          >
            {Object.entries(SURROUND_PRESETS).map(([key, p]) => (
              <MenuItem key={key} value={key}>
                {p.name}
              </MenuItem>
            ))}
          </Select>
          <Typography variant="caption" color="text.secondary">
            {surround.isDiscrete()
              ? 'This file has its own surround channels; they play as-is and the preset is off.'
              : SURROUND_PRESETS[presetKey].blurb}
          </Typography>
        </Stack>

        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <Room dots={dots} selected={selected} labels={labels} onSelect={setSelected} />
        </Box>

        {device && (
          <Stack spacing={1}>
            <Typography variant="overline">{selected === 'front' ? 'Front' : 'Rear'}</Typography>
            <Select
              size="small"
              fullWidth
              value={devices.length ? device.deviceId : ''}
              onChange={e => {
                const id = String(e.target.value);
                setDevice({ deviceId: id, label: devices.find(d => d.deviceId === id)?.label }, true);
              }}
            >
              {devices.length > 0 && !devices.some(d => d.deviceId === device.deviceId) && (
                <MenuItem value={device.deviceId} disabled>
                  {device.label ?? 'Saved device'} (not connected)
                </MenuItem>
              )}
              {devices
                .filter(d => selected === 'front' || d.deviceId !== front.deviceId)
                .map(d => (
                  <MenuItem key={d.deviceId} value={d.deviceId}>
                    {deviceLabel(d)}
                  </MenuItem>
                ))}
            </Select>
            <Select
              size="small"
              fullWidth
              value={device.kind}
              onChange={e => setDevice({ kind: e.target.value as SpeakerKind }, true)}
            >
              {KINDS.map(k => (
                <MenuItem key={k.value} value={k.value}>
                  {k.label}
                </MenuItem>
              ))}
            </Select>
            <Stack direction="row" spacing={1.5} alignItems="center">
              {selected === 'rear' ? (
                <IconButton
                  size="small"
                  aria-label={device.muted ? 'unmute' : 'mute'}
                  onClick={() => setDevice({ muted: !device.muted }, true)}
                >
                  <Icon icon={device.muted ? speakerMuteIcon : speakerIcon} width={22} />
                </IconButton>
              ) : (
                <Icon icon={speakerIcon} width={22} style={{ margin: 5 }} />
              )}
              {selected === 'front' ? (
                <Slider
                  value={volume}
                  min={0}
                  max={100}
                  onChange={(_, v) => changeVolume(asNumber(v))}
                  valueLabelDisplay="auto"
                  sx={{ flex: 1, width: 'auto' }}
                />
              ) : (
                <Slider
                  value={device.volume}
                  min={0}
                  max={100}
                  disabled={device.muted}
                  onChange={(_, v) => setDevice({ volume: asNumber(v) }, false)}
                  onChangeCommitted={(_, v) => setDevice({ volume: asNumber(v) }, true)}
                  valueLabelDisplay="auto"
                  sx={{ flex: 1, width: 'auto' }}
                />
              )}
            </Stack>
            {selected === 'front' && (
              <Typography variant="caption" color="text.secondary">
                The front's level is the player volume.
              </Typography>
            )}
          </Stack>
        )}
      </Stack>
      <SurroundSyncDialog
        open={syncOpen}
        onClose={() => {
          setSyncOpen(false);
          setSettings(getSurroundSettings());
        }}
      />
    </AppDialog>
  );
};

export default SurroundMixerDialog;
