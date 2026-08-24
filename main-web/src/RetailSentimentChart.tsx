import { useEffect, useMemo, useRef } from "react";
import { LineChart } from "echarts/charts";
import { AriaComponent, GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import type { RetailSentimentPayload } from "./api";

echarts.use([AriaComponent, CanvasRenderer, GridComponent, LegendComponent, LineChart, TooltipComponent]);

export type RetailSentimentMetric = "options" | "survey" | "margin";

function marginValue(value: number) {
  return `${(value / 1_000_000).toFixed(2)}万亿`;
}

export default function RetailSentimentChart({
  payload,
  metric
}: {
  payload: RetailSentimentPayload;
  metric: RetailSentimentMetric;
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  const config = useMemo(() => {
    if (metric === "survey") {
      return {
        dates: payload.survey.history.map((row) => row.date),
        series: [
          { name: "看多", color: "#16a36f", values: payload.survey.history.map((row) => row.bullishPct) },
          { name: "看空", color: "#ef5362", values: payload.survey.history.map((row) => row.bearishPct) }
        ],
        percent: true
      };
    }
    if (metric === "margin") {
      return {
        dates: payload.margin.history.map((row) => row.date),
        series: [{ name: "融资余额", color: "#1677e8", values: payload.margin.history.map((row) => row.balanceUsdMillions) }],
        percent: false
      };
    }
    return {
      dates: payload.options.history.map((row) => row.date),
      series: [{ name: "看涨成交占比", color: "#1677e8", values: payload.options.history.map((row) => row.callSharePct) }],
      percent: true
    };
  }, [metric, payload]);

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = echarts.init(chartRef.current, undefined, { renderer: "canvas" });
    const display = (value: number) => config.percent ? `${value.toFixed(1)}%` : marginValue(value);
    chart.setOption({
      animation: false,
      aria: { enabled: true, description: `${config.series.map((item) => item.name).join("和")}趋势` },
      grid: { top: config.series.length > 1 ? 42 : 22, right: 24, bottom: 38, left: 58 },
      legend: config.series.length > 1 ? {
        top: 8,
        left: 58,
        icon: "roundRect",
        itemWidth: 14,
        itemHeight: 3,
        textStyle: { color: "#65748a", fontSize: 11 }
      } : undefined,
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(255,255,255,.98)",
        borderColor: "#ccd7e5",
        borderWidth: 1,
        padding: [9, 11],
        textStyle: { color: "#233046", fontSize: 11 },
        formatter: (value: unknown) => {
          const items = (Array.isArray(value) ? value : [value]) as Array<{ axisValue?: string; marker?: string; seriesName?: string; value?: number }>;
          return [items[0]?.axisValue || "", ...items.map((item) => `${item.marker || ""}${item.seriesName || ""}　${display(Number(item.value || 0))}`)].join("<br/>");
        }
      },
      xAxis: {
        type: "category",
        data: config.dates,
        boundaryGap: false,
        axisLine: { lineStyle: { color: "#d7dee8" } },
        axisTick: { show: false },
        axisLabel: { color: "#7d8999", fontSize: 10, hideOverlap: true, margin: 11 }
      },
      yAxis: {
        type: "value",
        scale: true,
        splitNumber: 4,
        axisLabel: { color: "#7d8999", fontSize: 10, formatter: (value: number) => display(value) },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: "#e3e8ef" } }
      },
      series: config.series.map((item) => ({
        name: item.name,
        type: "line",
        data: item.values,
        showSymbol: false,
        lineStyle: { color: item.color, width: 2 },
        itemStyle: { color: item.color },
        emphasis: { focus: "series" }
      }))
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(chartRef.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [config]);

  return <div ref={chartRef} className="retailSentimentChart" role="img" aria-label="散户情绪趋势" />;
}
