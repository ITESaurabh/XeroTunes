import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  MenuItem,
  Select,
  Slider,
  Stack,
  Typography,
} from '@mui/material';
import { Icon } from '@iconify/react';
import playIcon from '@iconify/icons-fluent/play-24-regular';
import stopIcon from '@iconify/icons-fluent/stop-24-regular';
import micIcon from '@iconify/icons-fluent/mic-24-regular';
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
import { SURROUND_OUTPUT_ID, SurroundDevice } from '../../config/surround';

interface SurroundSyncDialogProps {
  open: boolean;
  onClose: () => void;
}

const CLICK_INTERVAL_MS = 700;
const OFFSET_RANGE = { min: -200, max: 500 };

const deviceLabel = (d: MediaDeviceInfo): string =>
  d.label || (d.deviceId === 'default' ? 'System Default' : d.deviceId.slice(0, 8));

const savedFrontId = (): string => {
  const current = getAudioOutputDeviceId();
  return current === SURROUND_OUTPUT_ID ? getSurroundSettings().front.deviceId : current;
};

/**
 * Nahimic-style sync: a click fires on the front and the rear at once and the
 * user drags the offset until the two land together. Offset > 0 delays the
 * front (rear is slow), < 0 delays the rear.
 */
const SurroundSyncDialog: React.FC<SurroundSyncDialogProps> = ({ open, onClose }) => {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [frontId, setFrontId] = useState<string>(savedFrontId);
  const [rearId, setRearId] = useState<string>(() => getSurroundSettings().rear?.deviceId ?? '');
  const [offset, setOffset] = useState<number>(() => getSurroundSettings().offsetMs);
  const [playing, setPlaying] = useState(false);
  const [listening, setListening] = useState(false);
  const [micNote, setMicNote] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const resumeMusic = useRef(false);
  const ready = !!rearId && rearId !== frontId;
  // Read by the click timer, which outlives the render that started it.
  const ids = useRef({ frontId, rearId });
  ids.current = { frontId, rearId };

  // The dialog stays mounted between opens; the mixer may have changed the
  // devices since, and a stale id sends the clicks to a device that isn't there.
  useEffect(() => {
    if (!open) return;
    const saved = getSurroundSettings();
    setFrontId(savedFrontId());
    setRearId(saved.rear?.deviceId ?? '');
    setOffset(saved.offsetMs);
    setMicNote(null);
    navigator.mediaDevices
      .enumerateDevices()
      .then(list => setDevices(list.filter(d => d.kind === 'audiooutput')))
      .catch(() => undefined);
  }, [open]);

  useEffect(() => {
    if (!ready) return;
    surround.setOffset(frontId, rearId, offset);
  }, [ready, frontId, rearId, offset]);

  // Both sinks stay fed for as long as the dialog is up: a Bluetooth rear
  // idling between clicks wakes with a different latency than it has under
  // music, which is what made a synced click still leave the track apart.
  useEffect(() => {
    if (!open || !ready) return;
    surround.testBed(frontId, rearId);
    return () => surround.testBed();
  }, [open, ready, frontId, rearId]);

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
    const fire = (): void => surround.click(ids.current.frontId, ids.current.rearId);
    fire();
    timer.current = window.setInterval(fire, CLICK_INTERVAL_MS);
    setPlaying(true);
  };

  // Opt-in: the microphone is only asked for when this button is pressed.
  const syncByMic = async (): Promise<void> => {
    setListening(true);
    setMicNote(null);
    const resume = surround.isPlaying();
    if (resume) window.dispatchEvent(new Event(PLAYBACK_TOGGLE_EVENT));
    try {
      const ms = await surround.micSync(frontId, rearId);
      if (ms === null) {
        setMicNote(
          "Couldn't hear both speakers clearly. Turn them up or bring the mic closer, then try again."
        );
      } else if (ms < OFFSET_RANGE.min || ms > OFFSET_RANGE.max) {
        setMicNote(`Measured ${ms} ms, outside what the slider covers.`);
      } else {
        setOffset(ms);
        setMicNote(`Set to ${ms} ms. Press play to check it by ear.`);
      }
    } catch {
      setMicNote('No access to the microphone.');
    } finally {
      if (resume) window.dispatchEvent(new Event(PLAYBACK_TOGGLE_EVENT));
      setListening(false);
    }
  };

  const close = (): void => {
    // The measurement has the delays zeroed until it finishes.
    if (listening) return;
    stop();
    // With music routed, the player owns the contexts and puts the saved
    // offsets back on this event; otherwise the clicks were all there was.
    if (surround.isAttached()) window.dispatchEvent(new Event(SURROUND_EVENT));
    else surround.close();
    onClose();
  };

  const done = (): void => {
    const saved = getSurroundSettings();
    // A device that isn't connected right now keeps the label it was saved with.
    const label = (id: string, was: SurroundDevice | null): string | undefined =>
      devices.find(d => d.deviceId === id)?.label ?? (was?.deviceId === id ? was.label : undefined);
    // A single Bluetooth box is the common rear; the mixer asks if it's more.
    const rear: SurroundDevice =
      saved.rear?.deviceId === rearId
        ? saved.rear
        : { deviceId: rearId, kind: 'mono', azimuthDeg: 180, volume: 100, muted: false };
    setSurroundSettings({
      ...saved,
      front: { ...saved.front, deviceId: frontId, label: label(frontId, saved.front) },
      rear: { ...rear, label: label(rearId, saved.rear) },
      offsetMs: offset,
    });
    setAudioOutputDeviceId(SURROUND_OUTPUT_ID);
    close();
  };

  return (
    <AppDialog
      open={open}
      onClose={close}
      title="Sync up your speakers"
      maxWidth="xs"
      fullWidth
      actions={
        <>
          <Button onClick={close} disabled={listening}>
            Cancel
          </Button>
          <Button variant="contained" onClick={done} disabled={!ready || listening}>
            Done
          </Button>
        </>
      }
    >
      <Stack spacing={3} alignItems="center" sx={{ textAlign: 'center', py: 1 }}>
        <Typography variant="body2" color="text.secondary">
          Press play and adjust the slider until you hear the click from both devices at the same
          time.
        </Typography>
        <Stack spacing={1.5} sx={{ width: '100%' }}>
          <Select
            size="small"
            fullWidth
            value={frontId}
            disabled={listening}
            onChange={e => setFrontId(String(e.target.value))}
          >
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
            disabled={listening}
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
          disabled={!ready || listening}
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
            disabled={listening}
            onChange={(_, v) => setOffset(Array.isArray(v) ? v[0] : v)}
            valueLabelDisplay="auto"
          />
        </Box>
        <Divider flexItem>
          <Chip
            label="OR"
            size="small"
            variant="outlined"
            sx={{ height: 20, color: 'text.secondary' }}
          />
        </Divider>
        <Stack spacing={0.5} alignItems="center">
          <Button
            size="small"
            startIcon={<Icon icon={micIcon} width={18} />}
            onClick={() => void syncByMic()}
            disabled={!ready || playing || listening}
          >
            {listening ? 'Listening…' : 'Sync with microphone'}
          </Button>
          <Typography variant="caption" color="text.secondary">
            {micNote ??
              'Plays tones and listens through your microphone for about 15 seconds. The sound is only timed on this device.'}
          </Typography>
        </Stack>
      </Stack>
    </AppDialog>
  );
};

export default SurroundSyncDialog;
