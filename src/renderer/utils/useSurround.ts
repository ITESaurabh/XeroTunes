import { MutableRefObject, RefObject, useEffect, useState } from 'react';
import * as surround from './surroundEngine';
import { SURROUND_OUTPUT_ID } from '../../config/surround';
import {
  AUDIO_OUTPUT_DEVICE_EVENT,
  SURROUND_EVENT,
  getAudioOutputDeviceId,
  getSurroundBeta,
  getSurroundSettings,
  healSurroundDeviceIds,
} from './LocStoreUtil';

/** Sets `activeRef` while surroundEngine plays the element, which PlayBar then keeps muted. */
export function useSurround(
  audioRef: RefObject<HTMLAudioElement>,
  songPath: string | null,
  castingRef: MutableRefObject<boolean>,
  muteVolumeRef: MutableRefObject<boolean>,
  activeRef: MutableRefObject<boolean>
): { on: boolean; mixerOpen: boolean; setMixerOpen: (_open: boolean) => void } {
  const [on, setOn] = useState(false);
  const [mixerOpen, setMixerOpen] = useState(false);

  useEffect(() => {
    const heal = (): void => {
      if (!getSurroundBeta()) return;
      navigator.mediaDevices
        .enumerateDevices()
        .then(healSurroundDeviceIds)
        .catch(() => undefined);
    };
    heal();
    navigator.mediaDevices.addEventListener('devicechange', heal);
    return () => navigator.mediaDevices.removeEventListener('devicechange', heal);
  }, []);

  // Depends on songPath because the element mounts with the first track.
  useEffect(() => {
    const apply = (): void => {
      const audio = audioRef.current;
      const settings = getSurroundSettings();
      const next =
        !!audio &&
        !!settings.rear &&
        getAudioOutputDeviceId() === SURROUND_OUTPUT_ID &&
        !castingRef.current;
      activeRef.current = next;
      setOn(next);
      if (next) surround.attach(audio, settings);
      else surround.detach();
      if (audio && !castingRef.current) audio.muted = next || muteVolumeRef.current;
    };
    apply();
    window.addEventListener(SURROUND_EVENT, apply);
    window.addEventListener(AUDIO_OUTPUT_DEVICE_EVENT, apply);
    return () => {
      window.removeEventListener(SURROUND_EVENT, apply);
      window.removeEventListener(AUDIO_OUTPUT_DEVICE_EVENT, apply);
    };
  }, [songPath]);

  return { on, mixerOpen, setMixerOpen };
}
