/**
 * ECharts options for the Quality Report's charts. Plain data in, plain option
 * out, with no React or DOM, so a script can render one to SVG in Node.
 */
import type { EChartsCoreOption } from 'echarts/core';
import { Hct, TonalPalette, argbFromHex, hexFromArgb } from '@material/material-color-utilities';

/** Theme colours a chart needs, resolved from the MUI palette by the caller. */
export interface ChartColors {
  paper: string;
  /** Hex; colour scales are built on its hue. */
  primary: string;
  dark: boolean;
  text: string;
  /** Axis labels. */
  ink: string;
  divider: string;
  /** Translucent tint for marked regions. */
  faint: string;
  /** Clipping, and the out-of-phase half of the correlation chart. */
  error: string;
  /** Bits a file never uses. */
  warning: string;
}

/** The measurement the report has picked out; its chart marks it. */
export type Focus =
  | 'cutoff'
  | 'clipping'
  | 'peak'
  | 'loudness'
  | 'dynamicRange'
  | 'length'
  | 'silence'
  | 'channels'
  | 'dcOffset';

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const kHz = (hz: number, digits = 1) => `${(hz / 1000).toFixed(digits)} kHz`;
const dbOf = (v: number) => 20 * Math.log10(Math.max(Math.abs(v), 1e-6));

/** Tick spacing in whole minutes or half minutes, about six ticks per track. */
const timeStep = (duration: number) => [15, 30, 60, 120, 300].find(t => duration / t <= 6) ?? 600;

const root = {
  backgroundColor: 'transparent',
  animation: false,
  textStyle: { fontFamily: 'Roboto, sans-serif' },
};
const bare = { axisLine: { show: false }, axisTick: { show: false } };

function styles(c: ChartColors) {
  return {
    axisText: { color: c.ink, fontSize: 11 },
    // A halo in the surface colour keeps labels readable over the plot.
    label: {
      color: c.text,
      fontWeight: 600,
      fontSize: 12,
      textBorderColor: c.paper,
      textBorderWidth: 3,
    },
    tooltip: {
      confine: true,
      backgroundColor: c.paper,
      borderColor: c.divider,
      textStyle: { color: c.text, fontSize: 12 },
      axisPointer: { lineStyle: { color: c.ink } },
    },
    splitLine: { lineStyle: { color: c.divider } },
    marker: {
      silent: true,
      symbol: 'none',
      lineStyle: { color: c.text, type: 'dashed', width: 1.5 },
    },
  };
}

function timeAxis(duration: number, c: ChartColors) {
  return {
    type: 'value',
    min: 0,
    max: duration,
    interval: timeStep(duration),
    ...bare,
    splitLine: { show: false },
    axisLabel: { ...styles(c).axisText, showMaxLabel: false, formatter: (v: number) => mmss(v) },
  };
}

function zoomControls(c: ChartColors, filterMode: 'filter' | 'none') {
  return [
    // Ctrl+wheel zooms; a plain wheel has to keep scrolling the dialog.
    {
      type: 'inside',
      xAxisIndex: 0,
      filterMode,
      zoomOnMouseWheel: 'ctrl',
      moveOnMouseWheel: false,
      moveOnMouseMove: false,
    },
    {
      type: 'slider',
      xAxisIndex: 0,
      filterMode,
      height: 18,
      left: 40,
      right: 12,
      bottom: 30,
      showDetail: false,
      showDataShadow: false,
      brushSelect: false,
      borderColor: c.divider,
      fillerColor: c.faint,
      textStyle: styles(c).axisText,
    },
  ];
}

/** A line of text centred above the plot, for a mark that has no place on it. */
function note(text: string | null, c: ChartColors) {
  return text
    ? [
        {
          type: 'text',
          left: 'center',
          top: 4,
          silent: true,
          style: {
            text,
            fill: c.text,
            font: '600 12px Roboto, sans-serif',
            stroke: c.paper,
            lineWidth: 3,
          },
        },
      ]
    : [];
}

/**
 * Sequential colours on the primary's hue, quiet to loud, spread over nearly
 * the whole lightness range so neighbouring levels stay apart. Quiet sinks into
 * the surface: towards black on a dark theme, towards white on a light one.
 */
export function levelRamp(primary: string, dark: boolean): string[] {
  const hct = Hct.fromInt(argbFromHex(primary));
  // A pastel primary would leave the middle of the ramp nearly grey.
  const palette = TonalPalette.fromHueAndChroma(hct.hue, Math.max(hct.chroma, 48));
  const [quiet, loud] = dark ? [4, 97] : [99, 8];
  return Array.from({ length: 9 }, (_, i) =>
    hexFromArgb(palette.tone(quiet + ((loud - quiet) * i) / 8))
  );
}

export interface SpectrumInput {
  /** dB per band relative to 1-2 kHz. */
  spectrum: number[];
  bandHz: number;
  nyquist: number;
  cutoffHz: number | null;
}

// Ticks count up from the minimum, so it sits on a multiple of the 20 dB step.
const SPECTRUM_DB = [-100, 10] as const;
/** How far below the loudest bin the report's spectrum reaches. */
const SPECTRUM_RANGE_DB = 100;

const dbText = (v: number) => (v < 0 ? `−${-v}` : `${v}`);

/** The report's spectrum, in Audacity's terms: absolute dB per bin. */
export function spectrumOption(
  s: { db: number[]; binHz: number; nyquist: number; cutoffHz: number | null },
  focus: Focus | null,
  c: ChartColors
): EChartsCoreOption {
  const { axisText, label, tooltip, splitLine, marker } = styles(c);
  const hz = (i: number) => i * s.binHz;
  // Fitted to the track as Audacity fits its plot; quieter bins sit on the floor.
  const top = Math.ceil(Math.max(...s.db) / 20) * 20;
  const bottom = top - SPECTRUM_RANGE_DB;
  return {
    ...root,
    grid: { left: 48, right: 12, top: 24, bottom: 24 },
    xAxis: {
      type: 'value',
      min: 0,
      max: s.nyquist,
      interval: 5000,
      ...bare,
      splitLine: { show: false },
      axisLabel: {
        ...axisText,
        showMaxLabel: false,
        formatter: (v: number) => (v ? `${v / 1000} kHz` : '0'),
      },
    },
    yAxis: {
      type: 'value',
      min: bottom,
      max: top,
      interval: 20,
      ...bare,
      splitLine,
      axisLabel: {
        ...axisText,
        showMinLabel: false,
        formatter: (v: number) => (v === top ? `${dbText(v)} dB` : dbText(v)),
      },
    },
    tooltip: {
      ...tooltip,
      trigger: 'axis',
      formatter: (p: { dataIndex: number }[]) => {
        const i = p[0]?.dataIndex;
        return i == null ? '' : `${kHz(hz(i), 2)} · ${s.db[i].toFixed(1)} dB`;
      },
    },
    graphic: note(
      focus === 'cutoff' && s.cutoffHz == null
        ? 'No cutoff: content runs to the top of the range'
        : null,
      c
    ),
    series: [
      {
        type: 'line',
        data: s.db.map((db, i) => [hz(i), Math.max(bottom, db)]),
        showSymbol: false,
        lineStyle: { color: c.primary, width: 1.5 },
        itemStyle: { color: c.primary },
        areaStyle: { color: c.primary, opacity: 0.16, origin: 'start' },
        emphasis: { disabled: true },
        // Shaded and labelled: faint clipping splatter above a cutoff
        // otherwise reads as "goes up to 20 kHz".
        ...(s.cutoffHz != null && {
          markLine: {
            ...marker,
            label: {
              ...label,
              position: 'end',
              align: 'right',
              formatter: `Cutoff ${kHz(s.cutoffHz)}`,
            },
            data: [{ xAxis: s.cutoffHz }],
          },
          markArea: {
            silent: true,
            itemStyle: { color: c.text, opacity: focus === 'cutoff' ? 0.14 : 0.05 },
            data: [[{ xAxis: s.cutoffHz }, { xAxis: s.nyquist }]],
          },
        }),
      },
    ],
  };
}

/**
 * Two files' spectra on one chart, each cutoff a dashed line in its series'
 * colour. The first is drawn in ink, the second in the primary colour.
 */
export function spectrumCompareOption(
  files: [{ name: string; s: SpectrumInput }, { name: string; s: SpectrumInput }],
  c: ChartColors
): EChartsCoreOption {
  const { axisText, tooltip, splitLine } = styles(c);
  // A 96 kHz file would push the audible range into the left half.
  const top = Math.min(Math.max(files[0].s.nyquist, files[1].s.nyquist), 24000);
  const colours = [c.ink, c.primary];
  const clamp = (db: number) => Math.min(SPECTRUM_DB[1], Math.max(SPECTRUM_DB[0], db));
  return {
    ...root,
    grid: { left: 40, right: 12, top: 30, bottom: 24 },
    legend: {
      top: 0,
      right: 0,
      icon: 'roundRect',
      itemWidth: 10,
      itemHeight: 10,
      textStyle: axisText,
    },
    xAxis: {
      type: 'value',
      min: 0,
      max: top,
      interval: 5000,
      ...bare,
      splitLine: { show: false },
      axisLabel: {
        ...axisText,
        showMaxLabel: false,
        formatter: (v: number) => (v ? `${v / 1000} kHz` : '0'),
      },
    },
    yAxis: {
      type: 'value',
      min: SPECTRUM_DB[0],
      max: SPECTRUM_DB[1],
      interval: 20,
      ...bare,
      splitLine,
      axisLabel: {
        ...axisText,
        showMinLabel: false,
        showMaxLabel: false,
        formatter: (v: number) => (v === 0 ? '0 dB' : `−${-v}`),
      },
    },
    tooltip: {
      ...tooltip,
      trigger: 'axis',
      formatter: (p: { seriesName: string; value: number[] }[]) =>
        p.length
          ? [
              kHz(p[0].value[0], 2),
              ...p.map(x => `${x.seriesName}: ${x.value[1].toFixed(1)} dB`),
            ].join('<br/>')
          : '',
    },
    series: files.map(({ name, s }, k) => ({
      type: 'line',
      name,
      data: s.spectrum.map((db, i) => [(i + 0.5) * s.bandHz, clamp(db)]),
      showSymbol: false,
      lineStyle: { color: colours[k], width: 2 },
      itemStyle: { color: colours[k] },
      emphasis: { disabled: true },
      ...(s.cutoffHz != null && {
        markLine: {
          silent: true,
          symbol: 'none',
          label: { show: false },
          lineStyle: { color: colours[k], type: 'dashed', width: 1.5 },
          data: [{ xAxis: s.cutoffHz }],
        },
      }),
    })),
  };
}

export interface WaveformInput {
  /** Columns spread over `duration`; NaN past the decoded end. */
  peakMax: number[];
  peakMin: number[];
  rms: number[];
  clipped: boolean[];
  /** The header's duration. */
  duration: number;
  decodedS: number;
  silenceStartS: number;
  silenceEndS: number;
  peakDb: number;
  lufs: number;
  dynamicRange: number;
  dcOffsetPct: number;
  /** Null where clipping can't be measured; missing on reports from before it was. */
  clipPpm?: number | null;
}

export function waveformOption(
  w: WaveformInput,
  focus: Focus | null,
  c: ChartColors
): EChartsCoreOption {
  const { axisText, label, tooltip, splitLine, marker } = styles(c);
  const cols = w.peakMax.length;
  const colS = w.duration / cols;
  const t = (i: number) => (i + 0.5) * colS;
  const dc = w.dcOffsetPct / 100;
  // Under an annotation the waveform dims, so the marked part stands out.
  const dim = focus ? 0.45 : 1;

  // ECharts has no band series: a band is an invisible lower line plus a
  // stacked series of the band's height, whose area fills down to that line.
  const band = (
    name: string,
    low: (i: number) => number,
    high: (i: number) => number,
    opacity: number
  ) => {
    const points = (f: (i: number) => number) =>
      Array.from({ length: cols }, (_, i) => [t(i), Number.isNaN(w.peakMax[i]) ? null : f(i)]);
    const shared = {
      type: 'line',
      stack: name,
      stackStrategy: 'all',
      showSymbol: false,
      lineStyle: { width: 0 },
      emphasis: { disabled: true },
    };
    return [
      { ...shared, data: points(low) },
      {
        ...shared,
        name,
        data: points(i => high(i) - low(i)),
        itemStyle: { color: c.primary, opacity },
        areaStyle: { color: c.primary, opacity: opacity * dim },
      },
    ];
  };

  const runs: [number, number][] = [];
  w.clipped.forEach((hit, i) => {
    if (!hit) return;
    if (w.clipped[i - 1]) runs[runs.length - 1][1] = i;
    else runs.push([i, i]);
  });
  // Padded by a column each side: one column is about a pixel wide.
  const tick = focus === 'clipping' ? 0.12 : 0.06;
  const clipMarks = runs.flatMap(([a, b]) => {
    const [x0, x1] = [t(a) - colS, t(b) + colS];
    return [
      [
        { xAxis: x0, yAxis: 1 - tick },
        { xAxis: x1, yAxis: 1 },
      ],
      [
        { xAxis: x0, yAxis: -1 },
        { xAxis: x1, yAxis: -1 + tick },
      ],
    ];
  });

  const musicEnd = w.decodedS - w.silenceEndS;
  const truncated = w.decodedS < w.duration - 1;
  const quiet = focus === 'silence' ? 0.16 : 0.05;
  const regions: [number, number, string, number][] = [];
  if (w.silenceStartS >= 1)
    regions.push([0, w.silenceStartS, `${Math.round(w.silenceStartS)} s silence`, quiet]);
  if (w.silenceEndS >= 1)
    regions.push([musicEnd, w.decodedS, `${Math.round(w.silenceEndS)} s silence`, quiet]);
  if (truncated)
    regions.push([w.decodedS, w.duration, `Missing ${mmss(w.duration - w.decodedS)}`, 0.12]);

  const peakA = 10 ** (w.peakDb / 20);
  const level = (a: number, text: string, mirror = true): object[] => [
    { yAxis: a, label: { formatter: text } },
    ...(mirror ? [{ yAxis: -a, label: { show: false } }] : []),
  ];
  const lines: object[] =
    focus === 'peak'
      ? level(peakA, `Peak ${w.peakDb.toFixed(1)} dBFS`)
      : focus === 'loudness'
        ? level(10 ** (w.lufs / 20), `Average ${w.lufs.toFixed(1)} LUFS`)
        : focus === 'dynamicRange'
          ? [
              ...level(peakA, 'Peaks', false),
              ...level(
                10 ** ((w.peakDb - w.dynamicRange) / 20),
                `RMS of the loud parts, ${w.dynamicRange} dB lower`,
                false
              ),
            ]
          : focus === 'dcOffset'
            ? level(
                dc,
                `Centre ${dc >= 0 ? '+' : '−'}${Math.abs(w.dcOffsetPct).toFixed(2)}% off zero`,
                false
              )
            : focus === 'length'
              ? [{ xAxis: w.decodedS, label: { show: false } }]
              : [];

  const noteText =
    focus === 'clipping'
      ? w.clipPpm === undefined
        ? 'Analyse again to measure clipping'
        : w.clipPpm === null
          ? "Clipping can't be measured in a lossy or resampled file"
          : runs.length
            ? `Clipping in ${runs.length} place${runs.length === 1 ? '' : 's'}`
            : 'No clipping found'
      : focus === 'silence' && w.silenceStartS < 1 && w.silenceEndS < 1
        ? 'No silence at the start or end'
        : focus === 'length'
          ? `Audio ends at ${mmss(w.decodedS)}${truncated ? `; the file says ${mmss(w.duration)}` : ''}`
          : null;

  return {
    ...root,
    grid: { left: 40, right: 12, top: 24, bottom: 76 },
    xAxis: timeAxis(w.duration, c),
    yAxis: {
      type: 'value',
      min: -1,
      max: 1,
      interval: 0.5,
      ...bare,
      splitLine,
      axisLabel: {
        ...axisText,
        formatter: (v: number) => (v === 1 ? '0 dB' : v === 0.5 ? '−6' : v === 0 ? '−∞' : ''),
      },
    },
    tooltip: {
      ...tooltip,
      trigger: 'axis',
      formatter: (p: { dataIndex: number }[]) => {
        const i = p[0]?.dataIndex;
        if (i == null) return '';
        const at = mmss(t(i));
        if (Number.isNaN(w.peakMax[i])) return `${at} · past the end of the audio`;
        const peak = Math.max(Math.abs(w.peakMax[i] - dc), Math.abs(w.peakMin[i] - dc));
        if (peak < 1e-4) return `${at} · silence`;
        return `${at} · peak ${dbOf(peak).toFixed(1)} dB · RMS ${dbOf(w.rms[i]).toFixed(1)} dB${
          w.clipped[i] ? ' · clipped' : ''
        }`;
      },
    },
    legend: {
      left: 0,
      bottom: 0,
      icon: 'roundRect',
      itemWidth: 10,
      itemHeight: 10,
      textStyle: axisText,
      data: [{ name: 'Peak', itemStyle: { opacity: 0.35 } }, 'RMS', 'Clipped'],
    },
    dataZoom: zoomControls(c, 'none'),
    graphic: note(noteText, c),
    series: [
      ...band(
        'Peak',
        i => w.peakMin[i],
        i => w.peakMax[i],
        0.35
      ),
      ...band(
        'RMS',
        i => dc - w.rms[i],
        i => dc + w.rms[i],
        1
      ),
      // Empty series that carry marks: the legend toggles the clip marks with
      // their own entry, and the regions and focus lines stay put.
      {
        type: 'line',
        name: 'Clipped',
        data: [],
        itemStyle: { color: c.error },
        markArea: { silent: true, itemStyle: { color: c.error }, data: clipMarks },
      },
      {
        type: 'line',
        data: [],
        markArea: {
          silent: true,
          label: { ...label, position: 'insideTop' },
          // Under about 8% of the track the label won't fit and spills off the
          // edge; the shading and the tooltip still show the region.
          data: regions.map(([from, to, name, opacity]) => [
            {
              xAxis: from,
              name,
              itemStyle: { color: c.text, opacity },
              label: { show: to - from >= w.duration * 0.08 },
            },
            { xAxis: to },
          ]),
        },
        markLine: { ...marker, label: { ...label, position: 'insideStartTop' }, data: lines },
      },
    ],
  };
}

/**
 * The spectrogram's colours cover this many dB below the track's loudest cell,
 * so a quiet master still uses the whole ramp.
 */
const SPECTROGRAM_SPAN_DB = 60;

export interface SpectrogramInput {
  /** dB per band, slice-major; NaN past the decoded end. */
  db: Float32Array;
  slices: number;
  bands: number;
  bandHz: number;
  /** Seconds the slices span: the header's duration. */
  duration: number;
  decodedS: number;
  cutoffHz: number | null;
}

function spectrogramRange(db: Float32Array): readonly [number, number] {
  let loudest = -Infinity;
  for (const v of db) if (v > loudest) loudest = v;
  const top = Number.isFinite(loudest) ? Math.ceil(loudest / 5) * 5 : 0;
  return [top - SPECTROGRAM_SPAN_DB, top];
}

/**
 * The spectrogram as RGBA pixels, `scale` per cell side so stretching it to the
 * plot keeps crisp cell edges. Top row is the highest band; cells past the
 * decoded end stay transparent.
 */
export function spectrogramPixels(s: SpectrogramInput, c: ChartColors, scale = 4) {
  const [lo, hi] = spectrogramRange(s.db);
  const stops = levelRamp(c.primary, c.dark).map(hex => {
    const n = parseInt(hex.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  });
  const width = s.slices * scale;
  const height = s.bands * scale;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let x = 0; x < s.slices; x++) {
    for (let y = 0; y < s.bands; y++) {
      const v = s.db[x * s.bands + y];
      if (Number.isNaN(v)) continue;
      // Linear in RGB between stops, the way the visualMap legend draws them.
      const pos = Math.min(1, Math.max(0, (v - lo) / (hi - lo))) * (stops.length - 1);
      const i = Math.min(stops.length - 2, Math.floor(pos));
      const rgb = stops[i].map((ch, j) => ch + (stops[i + 1][j] - ch) * (pos - i));
      for (let dy = 0; dy < scale; dy++) {
        const row = (s.bands - 1 - y) * scale + dy;
        for (let dx = 0; dx < scale; dx++) {
          const o = (row * width + x * scale + dx) * 4;
          pixels.set(rgb, o);
          pixels[o + 3] = 255;
        }
      }
    }
  }
  return { pixels, width, height };
}

/**
 * The visible spectrogram is one image, built by the caller from
 * `spectrogramPixels`. As heatmap cells, its 26k rectangles paint over several
 * frames and appear in chunks. The heatmap stays, fully transparent, so each
 * cell keeps its tooltip.
 */
export function spectrogramOption(
  s: SpectrogramInput,
  c: ChartColors,
  image: CanvasImageSource | string
): EChartsCoreOption {
  const { axisText, label, tooltip, marker } = styles(c);
  const sliceS = s.duration / s.slices;
  const range = spectrogramRange(s.db);
  const dbLabel = (v: number) => `${v > 0 ? '+' : ''}${v} dB`;
  const data: number[][] = [];
  for (let x = 0; x < s.slices; x++) {
    for (let y = 0; y < s.bands; y++) {
      const v = s.db[x * s.bands + y];
      if (!Number.isNaN(v)) data.push([x, y, Math.round(v * 10) / 10]);
    }
  }

  const step = timeStep(s.duration);
  // Label callbacks get the index within the zoomed window; the category value
  // is the real slice or band number.
  const timeTick = (v: string | number) => Math.floor((Number(v) * sliceS) / step);
  const kHzTick = (v: string | number) => Math.floor((Number(v) * s.bandHz) / 5000);
  const firstOfTick = (tickOf: (v: number) => number) => (_: number, v: string) =>
    Number(v) === 0 || tickOf(Number(v)) !== tickOf(Number(v) - 1);
  const firstMissing = Math.floor(s.decodedS / sliceS);

  return {
    ...root,
    grid: { left: 40, right: 12, top: 10, bottom: 76 },
    xAxis: {
      type: 'category',
      data: Array.from({ length: s.slices }, (_, i) => i),
      ...bare,
      axisLabel: {
        ...axisText,
        interval: firstOfTick(timeTick),
        formatter: (v: string) => mmss(timeTick(v) * step),
      },
    },
    yAxis: {
      type: 'category',
      data: Array.from({ length: s.bands }, (_, i) => i),
      ...bare,
      axisLabel: {
        ...axisText,
        interval: firstOfTick(kHzTick),
        formatter: (v: string) => (Number(v) === 0 ? '0' : `${kHzTick(v) * 5}k`),
      },
    },
    visualMap: {
      type: 'continuous',
      // Only the legend matters: the heatmap it colours is transparent.
      seriesIndex: 1,
      dimension: 2,
      min: range[0],
      max: range[1],
      orient: 'horizontal',
      left: 0,
      bottom: 0,
      itemWidth: 10,
      itemHeight: 140,
      calculable: false,
      hoverLink: false,
      text: [dbLabel(range[1]), dbLabel(range[0])],
      textStyle: axisText,
      inRange: { color: levelRamp(c.primary, c.dark) },
    },
    dataZoom: zoomControls(c, 'filter'),
    tooltip: {
      ...tooltip,
      trigger: 'item',
      formatter: (p: { data: number[] }) => {
        const [x, y, v] = p.data;
        const at = `${mmss((x + 0.5) * sliceS)} · ${kHz((y + 0.5) * s.bandHz, 2)}`;
        return v <= -100 ? `${at} · silence` : `${at} · ${v.toFixed(0)} dB`;
      },
    },
    series: [
      {
        type: 'custom',
        silent: true,
        clip: true,
        // An item per slice, so a zoomed-in window always keeps one to draw from.
        data: Array.from({ length: s.slices }, (_, i) => [i, 0]),
        renderItem: (
          p: { dataIndexInside: number },
          api: { coord: (v: number[]) => number[]; size: (v: number[]) => number[] }
        ) => {
          if (p.dataIndexInside !== 0) return null;
          const [cellW, cellH] = api.size([1, 1]);
          const [left, bottom] = api.coord([0, 0]);
          const [right, top] = api.coord([s.slices - 1, s.bands - 1]);
          return {
            type: 'image',
            style: {
              image,
              x: left - cellW / 2,
              y: top - cellH / 2,
              width: right - left + cellW,
              height: bottom - top + cellH,
            },
          };
        },
      },
      {
        type: 'heatmap',
        data,
        // Opacity 0 skips the paint but keeps the hit test.
        itemStyle: { opacity: 0 },
        emphasis: { disabled: true },
        markLine:
          s.cutoffHz == null
            ? undefined
            : {
                ...marker,
                label: {
                  ...label,
                  position: 'insideEndTop',
                  formatter: `Cutoff ${kHz(s.cutoffHz)}`,
                },
                data: [{ yAxis: Math.round(s.cutoffHz / s.bandHz) }],
              },
        markArea:
          // A header's duration can run a fraction of a second past the audio;
          // only a real gap is marked, as on the waveform.
          s.decodedS < s.duration - 1
            ? {
                silent: true,
                itemStyle: { color: c.faint },
                label: {
                  ...label,
                  position: 'insideTop',
                  formatter: `Missing ${mmss(s.duration - s.decodedS)}`,
                },
                data: [[{ xAxis: firstMissing }, { xAxis: s.slices - 1 }]],
              }
            : undefined,
      },
    ],
  };
}

export function correlationOption(
  s: { correlation: number[]; duration: number },
  c: ChartColors
): EChartsCoreOption {
  const { axisText, tooltip, splitLine } = styles(c);
  const n = s.correlation.length;
  const t = (i: number) => ((i + 0.5) / n) * s.duration;
  return {
    ...root,
    grid: { left: 40, right: 12, top: 10, bottom: 24 },
    xAxis: timeAxis(s.duration, c),
    yAxis: {
      type: 'value',
      min: -1,
      max: 1,
      interval: 1,
      ...bare,
      splitLine,
      axisLabel: {
        ...axisText,
        formatter: (v: number) => (v > 0 ? '+1' : v < 0 ? '−1' : '0'),
      },
    },
    tooltip: {
      ...tooltip,
      trigger: 'axis',
      formatter: (p: { dataIndex: number }[]) => {
        const i = p[0]?.dataIndex;
        if (i == null) return '';
        const v = s.correlation[i];
        return `${mmss(t(i))} · ${Number.isNaN(v) ? 'no audio' : `correlation ${v.toFixed(2)}`}`;
      },
    },
    series: [
      {
        type: 'line',
        // A gap (silence, or past the decoded end) breaks the line instead of joining across it.
        data: s.correlation.map((v, i) => [t(i), Number.isNaN(v) ? null : v]),
        showSymbol: false,
        lineStyle: { color: c.primary, width: 2 },
        itemStyle: { color: c.primary },
        emphasis: { disabled: true },
        markArea: {
          silent: true,
          itemStyle: { color: c.error, opacity: 0.06 },
          data: [[{ yAxis: -1 }, { yAxis: 0 }]],
        },
        markLine: {
          silent: true,
          symbol: 'none',
          // Transparent, not opacity 0: the labels inherit the line's opacity.
          lineStyle: { color: 'transparent' },
          label: axisText,
          data: [
            { yAxis: 1, label: { formatter: 'Identical', position: 'insideStartBottom' } },
            { yAxis: -1, label: { formatter: 'Out of phase', position: 'insideStartTop' } },
          ],
        },
      },
    ],
  };
}

/** Side/mid pairs, interleaved: a vertical line is mono, a wide cloud wide stereo. */
export function goniometerOption(points: number[], c: ChartColors): EChartsCoreOption {
  const d = Math.SQRT1_2;
  const xy: number[][] = [];
  for (let k = 0; k < points.length; k += 2) xy.push([points[k], points[k + 1]]);
  const guide = (from: number[], to: number[], name: string, dashed = false) => [
    { coord: from, label: { formatter: name }, lineStyle: dashed ? { type: 'dashed' } : {} },
    { coord: to },
  ];
  return {
    ...root,
    grid: { left: 18, right: 18, top: 18, bottom: 18 },
    xAxis: { type: 'value', min: -1, max: 1, show: false },
    yAxis: { type: 'value', min: -1, max: 1, show: false },
    series: [
      {
        type: 'scatter',
        data: xy,
        symbolSize: 2.5,
        silent: true,
        itemStyle: { color: c.primary, opacity: 0.45 },
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { color: c.divider, width: 1 },
          label: { ...styles(c).axisText, position: 'end' },
          data: [
            guide([0, -1], [0, 1], 'M'),
            guide([-1, 0], [1, 0], 'S'),
            guide([-d, -d], [d, d], 'R', true),
            guide([d, -d], [-d, d], 'L', true),
          ],
        },
      },
    ],
  };
}

// Decades plotted, down to one sample in ten million.
const HIST_DECADES = 7;

/**
 * Share of samples per bin from -1 to 1, on a log scale so a pile-up at the
 * ceiling shows. Plotted as decades above 1e-7 on a linear axis: a log axis draws
 * bars down from 1, its zero, so they hang from the top.
 */
export function histogramOption(
  s: { histogram: number[]; ceiling: boolean },
  c: ChartColors
): EChartsCoreOption {
  const { axisText, label, tooltip, splitLine } = styles(c);
  const n = s.histogram.length;
  const lo = (i: number) => -1 + (2 * i) / n;
  const edge = (i: number) => s.ceiling && (i === 0 || i === n - 1);
  return {
    ...root,
    grid: { left: 52, right: 12, top: 20, bottom: 24 },
    xAxis: {
      type: 'category',
      data: s.histogram.map((_, i) => i),
      ...bare,
      axisLabel: {
        ...axisText,
        interval: (i: number) => i === 0 || i === (n - 1) / 2 || i === n - 1,
        formatter: (_: string, i: number) => (i === 0 ? '−1' : i === n - 1 ? '+1' : '0'),
      },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: HIST_DECADES,
      interval: 1,
      ...bare,
      splitLine,
      axisLabel: {
        ...axisText,
        formatter: (v: number) =>
          v === HIST_DECADES
            ? '100%'
            : v === HIST_DECADES - 3
              ? '0.1%'
              : v === HIST_DECADES - 6
                ? '0.0001%'
                : '',
      },
    },
    tooltip: {
      ...tooltip,
      trigger: 'item',
      formatter: (p: { dataIndex: number }) => {
        const i = p.dataIndex;
        return `${lo(i).toFixed(2)} to ${lo(i + 1).toFixed(2)} · ${(s.histogram[i] * 100).toPrecision(2)}% of samples`;
      },
    },
    series: [
      {
        type: 'bar',
        barCategoryGap: '15%',
        itemStyle: { color: c.primary },
        emphasis: { disabled: true },
        data: s.histogram.map((v, i) => ({
          value: v > 0 ? Math.max(0, Math.log10(v) + HIST_DECADES) : 0,
          ...(edge(i) && {
            itemStyle: { color: c.warning },
            // Text runs inwards from its bar, or the right one runs off the chart.
            label: {
              show: true,
              position: 'top',
              align: i === 0 ? 'left' : 'right',
              formatter: 'At ceiling',
              ...label,
            },
          }),
        })),
      },
    ],
  };
}

/** Per bit, most significant first: the share of samples with it set. */
export function bitDepthOption(bitsUsed: number[], c: ChartColors): EChartsCoreOption {
  const { axisText, tooltip } = styles(c);
  const n = bitsUsed.length;
  const used = (v: number) => v > 0.001;
  return {
    ...root,
    grid: { left: 8, right: 8, top: 10, bottom: 24 },
    xAxis: {
      type: 'category',
      data: bitsUsed.map((_, i) => i),
      ...bare,
      axisLabel: {
        ...axisText,
        interval: (i: number) => i === 0 || i === n - 1,
        formatter: (_: string, i: number) => (i === 0 ? 'MSB' : 'LSB'),
      },
    },
    yAxis: { type: 'value', min: 0, max: 0.5, show: false },
    tooltip: {
      ...tooltip,
      trigger: 'item',
      formatter: (p: { dataIndex: number }) => {
        const v = bitsUsed[p.dataIndex];
        return `Bit ${p.dataIndex + 1}: ${used(v) ? `set in ${Math.round(v * 100)}% of samples` : 'never used'}`;
      },
    },
    series: [
      {
        type: 'bar',
        barCategoryGap: '20%',
        itemStyle: { color: c.primary },
        emphasis: { disabled: true },
        // An unused bit is a dashed full-height outline, so the gap reads as missing.
        data: bitsUsed.map(v =>
          used(v)
            ? v
            : {
                value: 0.5,
                itemStyle: {
                  color: 'transparent',
                  borderColor: c.warning,
                  borderType: 'dashed',
                  borderWidth: 1,
                },
              }
        ),
      },
    ],
  };
}
