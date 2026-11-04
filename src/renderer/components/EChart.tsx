/**
 * Mounts an ECharts option. Only the pieces registered below are bundled, so a
 * chart that needs another series or component type adds it to the use() list.
 */
import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { Box } from '@mui/material';
import * as echarts from 'echarts/core';
import { BarChart, CustomChart, HeatmapChart, LineChart, ScatterChart } from 'echarts/charts';
import {
  DataZoomComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  BarChart,
  CustomChart,
  HeatmapChart,
  LineChart,
  ScatterChart,
  DataZoomComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

export default function EChart({
  option,
  height,
}: {
  option: echarts.EChartsCoreOption;
  height: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const c = echarts.init(el);
    chart.current = c;
    // Resizing inside the callback changes layout while the browser is still
    // delivering size changes, which Chromium reports as "ResizeObserver loop
    // completed with undelivered notifications".
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => c.resize());
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
      // zrender paints a heatmap's cells in 15 ms slices, one per frame, and the
      // next slice runs even after dispose, throwing "reading 'layerStack'".
      // StrictMode's mount-unmount-mount always hits it. clear() repaints the
      // empty chart synchronously, and that new paint makes the queued slice bail.
      c.clear();
      c.dispose();
      chart.current = null;
    };
  }, []);

  // notMerge: the new option replaces the old outright, so a cutoff line from
  // the previous track can't linger in the merged result.
  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <Box ref={ref} sx={{ width: '100%', height }} />;
}
