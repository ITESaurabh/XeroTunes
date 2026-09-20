import React, { useEffect, useRef, useState } from 'react';
import { Box, Button, IconButton, MenuItem, Select, Slider, Stack, Typography } from '@mui/material';
import { Icon } from '@iconify/react';
import playIcon from '@iconify/icons-fluent/play-24-regular';
import stopIcon from '@iconify/icons-fluent/stop-24-regular';
import AppDialog from './AppDialog';
import {
  getAudioOutputDeviceId,
  getSurroundSettings,
  setAudioOutputDeviceId,
  setSurroundSettings,
  SURROUND_EVENT,
  PLAYBACK_TOGGLE_EVENT,
} from '../utils/LocStoreUtil';
import * as surround from '../utils/surroundEngine';
import { SURROUND_OUTPUT_ID, SurroundDevice } from '../../config/app_settings';

interface SurroundSyncDialogProps {
  open: boolean;
  onClose: () => void;
}

const CLICK_INTERVAL_MS = 700;
const OFFSET_RANGE = { min: -200, max: 500 };

const deviceLabel = (d: MediaDeviceInfo): string =>
  d.label || (d.deviceId === 'default' ? 'System Default' : d.deviceId.slice(0, 8));

/**
 * Nahimic-style sync: a click fires on the front and the rear at once and the
 * user drags the offset until the two land together. Offset > 0 delays the
 * front (rear is slow), < 0 delays the rear.
 */
const SurroundSyncDialog: React.FC<SurroundSyncDialogProps> = ({ open, onClose }) => {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [frontId, setFrontId] = useState<string>(() => {
    const current = getAudioOutputDeviceId();
    return current === SURROUND_OUTPUT_ID ? getSurroundSettings().front.deviceId : current;
  });
  const [rearId, setRearId] = useState<string>(() => getSurroundSettings().rear?.deviceId ?? '');
  const [offset, setOffset] = useState<number>(() => getSurroundSettings().offsetMs);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | null>(null);
  const resumeMusic = useRef(false);

  useEffect(() => {
    if (!open) return;
    navigator.mediaDevices
      .enumerateDevices()
      .then(list => setDevices(list.filter(d => d.kind === 'audiooutput')))
      .catch(() => undefined);
  }, [open]);

  useEffect(() => {
    if (!rearId || rearId === frontId) return;
    surround.setDelay(frontId, offset);
    surround.setDelay(rearId, -offset);
  }, [frontId, rearId, offset]);

  const stop = (): void => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    setPlaying(false);
    if (resumeMusic.current) window.dispatchEvent(new Event(PLAYBACK_TOGGLE_EVENT));
    resumeMusic.current = false;
  };

  useEffect(() => () => window.clearInterval(timer.current ?? undefined), []);

  const toggle = (): void => {
    if (playing) return stop();
    if (surround.isPlaying()) {
      window.dispatchEvent(new Event(PLAYBACK_TOGGLE_EVENT));
      resumeMusic.current = true;
    }
    const fire = (): void => surround.click([frontId, rearId]);
    fire();
    timer.current = window.setInterval(fire, CLICK_INTERVAL_MS);
    setPlaying(true);
  };

  const close = (): void => {
    stop();
    // With music routed, the player owns the contexts and puts the saved
    // offsets back on this event; otherwise the clicks were all there was.
    if (surround.isAttached()) window.dispatchEvent(new Event(SURROUND_EVENT));
    else surround.close();
    onClose();
  };

  const done = (): void => {
    const saved = getSurroundSettings();
    // A single Bluetooth box is the common rear; the mixer asks if it's more.
    const rear: SurroundDevice =
      saved.rear?.deviceId === rearId
        ? saved.rear
        : { deviceId: rearId, kind: 'mono', azimuthDeg: 180, volume: 100, muted: false };
    setSurroundSettings({
      ...saved,
      front: { ...saved.front, deviceId: frontId },
      rear,
      offsetMs: offset,
    });
    setAudioOutputDeviceId(SURROUND_OUTPUT_ID);
    close();
  };

  const ready = !!rearId && rearId !== frontId;

  return (
    <AppDialog
      open={open}
      onClose={close}
      title="Sync up your speakers"
      maxWidth="xs"
      fullWidth
      actions={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="contained" onClick={done} disabled={!ready}>
            Done
          </Button>
        </>
      }
    >
      <Stack spacing={3} alignItems="center" sx={{ textAlign: 'center', py: 1 }}>
        <Typography variant="body2" color="text.secondary">
          Press play and adjust the slider until you hear the click from both devices at the
          same time. Arrow keys nudge by 1 ms.
        </Typography>
        <Stack spacing={1.5} sx={{ width: '100%' }}>
          <Select size="small" fullWidth value={frontId} onChange={e => setFrontId(String(e.target.value))}>
            {devices.map(d => (
              <MenuItem key={d.deviceId} value={d.deviceId}>
                Front: {deviceLabel(d)}
              </MenuItem>
            ))}
          </Select>
          <Select
            size="small"
            fullWidth
            displayEmpty
            value={rearId}
            onChange={e => setRearId(String(e.target.value))}
          >
            <MenuItem value="" disabled>
              Choose the rear device
            </MenuItem>
            {devices
              .filter(d => d.deviceId !== frontId)
              .map(d => (
                <MenuItem key={d.deviceId} value={d.deviceId}>
                  Rear: {deviceLabel(d)}
                </MenuItem>
              ))}
          </Select>
        </Stack>
        <IconButton
          size="large"
          onClick={toggle}
          disabled={!ready}
          sx={{ border: 1, borderColor: 'divider', width: 64, height: 64 }}
          aria-label={playing ? 'stop' : 'play'}
        >
          <Icon icon={playing ? stopIcon : playIcon} width={32} />
        </IconButton>
        <Box sx={{ width: '100%', px: 2 }}>
          <Typography variant="overline">
            Delay {offset > 0 ? '+' : ''}
            {offset} ms
          </Typography>
          <Slider
            value={offset}
            min={OFFSET_RANGE.min}
            max={OFFSET_RANGE.max}
            step={1}
            onChange={(_, v) => setOffset(Array.isArray(v) ? v[0] : v)}
            valueLabelDisplay="auto"
          />
          <Typography variant="caption" color="text.secondary">
            Rear lags behind: drag right. Rear is ahead: drag left.
          </Typography>
        </Box>
      </Stack>
    </AppDialog>
  );
};

export default SurroundSyncDialog;
