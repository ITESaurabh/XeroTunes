/** Ambion is the user-facing name for surround. */
export const AMBION_DESCRIPTION =
  'XT Ambion is our homemade surround solution That rely on at least 3 speaker setup (2 front and 1 back) to simulate ambient sound virually. Currently still in development.';

export const AMBION_OUTPUT_LABEL = 'Ambion Surround';

/** Virtual audioOutputDeviceId: play through the surround arrangement below. */
export const SURROUND_OUTPUT_ID = 'surround';

/** A single Bluetooth box sums L and R, so it must not get a stereo signal whose sides cancel. */
export type SpeakerKind = 'stereo' | 'mono' | 'headphones';

export interface SurroundDevice {
  deviceId: string;
  /** Finds the device again when Chromium hands it a new id. */
  label?: string;
  kind: SpeakerKind;
  /** Where it sits around the listener, degrees clockwise from straight ahead. */
  azimuthDeg: number;
  /** 0-100. The front ignores this; its level is the player volume. */
  volume: number;
  muted: boolean;
}

/** offsetMs > 0 delays the front so a slow (Bluetooth) rear catches up; < 0 delays the rear. */
export interface SurroundSettings {
  front: SurroundDevice;
  rear: SurroundDevice | null;
  offsetMs: number;
  /** Key into SURROUND_PRESETS. */
  preset: string;
}

export const DEFAULT_SURROUND_SETTINGS: SurroundSettings = {
  front: { deviceId: 'default', kind: 'stereo', azimuthDeg: 0, volume: 100, muted: false },
  rear: null,
  offsetMs: 0,
  preset: 'natural',
};
