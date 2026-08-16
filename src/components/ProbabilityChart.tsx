"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

export function ProbabilityChart({
  data,
  ariaLabel,
}: {
  data: Array<{ name: string; value: number; color?: string }>;
  ariaLabel: string;
}) {
  const elementRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!elementRef.current || data.length === 0) return;
    const chart = echarts.init(elementRef.current, undefined, { renderer: "canvas" });
    chart.setOption({
      animationDuration: 350,
      grid: { top: 12, right: 18, bottom: 24, left: 96 },
      tooltip: { trigger: "axis", valueFormatter: (value: number) => `${value.toFixed(2)}%` },
      xAxis: { type: "value", max: 100, axisLabel: { color: "#9aa5b5", formatter: "{value}%" }, splitLine: { lineStyle: { color: "rgba(255,255,255,.08)" } } },
      yAxis: { type: "category", data: data.map((item) => item.name), axisLabel: { color: "#dfe5ed" } },
      series: [{ type: "bar", data: data.map((item) => ({ value: item.value, itemStyle: { color: item.color ?? "#ff4655", borderRadius: [0, 5, 5, 0] } })), barMaxWidth: 24 }],
    });
    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); chart.dispose(); };
  }, [data]);

  return (
    <>
      <div ref={elementRef} className="chart-surface" role="img" aria-label={ariaLabel} />
      <details>
        <summary>查看数据表 / View data table</summary>
        <table className="chart-data-table">
          <caption className="sr-only">{ariaLabel}</caption>
          <thead><tr><th>Team</th><th>Probability</th></tr></thead>
          <tbody>{data.map((item) => <tr key={item.name}><td>{item.name}</td><td>{item.value.toFixed(2)}%</td></tr>)}</tbody>
        </table>
      </details>
    </>
  );
}
