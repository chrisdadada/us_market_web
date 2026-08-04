import { useEffect, useMemo, useRef } from "react";
import { BarChart, LineChart } from "echarts/charts";
import { AriaComponent, GridComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import type { CryptoEtfFlowPayload } from "./api";

echarts.use([AriaComponent, BarChart, CanvasRenderer, GridComponent, LineChart, MarkLineComponent, TooltipComponent]);

export type CryptoEtfAssetKey = "BTC" | "ETH";
export type CryptoEtfInterval = "day" | "week" | "month";

type ChartRow = {
  label: string;
  flow: number;
  btcCumulative: number;
  ethCumulative: number;
};

function formatMoney(value: number) {
  const absolute = Math.abs(value);
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  if (absolute >= 1_000_000_000) return `${sign}$${(absolute / 1_000_000_000).toFixed(2)}B`;
  return `${sign}$${(absolute / 1_000_000).toFixed(1)}M`;
}

function weekStart(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

function periodKey(date: string, interval: CryptoEtfInterval) {
  if (interval === "month") return date.slice(0, 7);
  if (interval === "week") return weekStart(date);
  return date;
}

function buildChartRows(
  payload: CryptoEtfFlowPayload,
  asset: CryptoEtfAssetKey,
  interval: CryptoEtfInterval,
  startDate: string,
  endDate: string
) {
  const groups = new Map<string, ChartRow>();
  let btcCumulative = 0;
  let ethCumulative = 0;
  [...payload.history]
    .sort((left, right) => left.date.localeCompare(right.date))
    .forEach((row) => {
      const btcFlow = Number(row.btcFlowUsd || 0);
      const ethFlow = Number(row.ethFlowUsd || 0);
      btcCumulative += btcFlow;
      ethCumulative += ethFlow;
      if ((startDate && row.date < startDate) || (endDate && row.date > endDate)) return;
      const label = periodKey(row.date, interval);
      const existing = groups.get(label);
      const flow = asset === "BTC" ? btcFlow : ethFlow;
      groups.set(label, {
        label,
        flow: (existing?.flow || 0) + flow,
        btcCumulative,
        ethCumulative
      });
    });
  return [...groups.values()];
}

export default function CryptoEtfChart({
  payload,
  asset,
  interval,
  startDate,
  endDate
}: {
  payload: CryptoEtfFlowPayload;
  asset: CryptoEtfAssetKey;
  interval: CryptoEtfInterval;
  startDate: string;
  endDate: string;
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(
    () => buildChartRows(payload, asset, interval, startDate, endDate),
    [asset, endDate, interval, payload, startDate]
  );
  const latest = rows.at(-1);

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = echarts.init(chartRef.current, undefined, { renderer: "canvas" });
    chart.setOption({
      animation: false,
      aria: {
        enabled: true,
        description: `${asset} ETF净流量及BTC、ETH累计净流量趋势`
      },
      grid: { top: 24, right: 68, bottom: 42, left: 68 },
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(255,255,255,.98)",
        borderColor: "#ccd7e5",
        borderWidth: 1,
        padding: [9, 11],
        textStyle: { color: "#233046", fontSize: 11 },
        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(22,119,255,.05)" } },
        formatter: (value: unknown) => {
          const items = (Array.isArray(value) ? value : [value]) as Array<{ axisValue?: string; seriesName?: string; value?: number }>;
          const title = items[0]?.axisValue || "";
          const lines = items.map((item) => `${item.seriesName || ""}　${formatMoney(Number(item.value || 0))}`);
          return [title, ...lines].join("<br/>");
        }
      },
      xAxis: {
        type: "category",
        data: rows.map((row) => row.label),
        boundaryGap: true,
        axisLine: { lineStyle: { color: "#d7dee8" } },
        axisTick: { show: false },
        axisLabel: { color: "#7d8999", fontSize: 10, hideOverlap: true, margin: 12 }
      },
      yAxis: [
        {
          type: "value",
          splitNumber: 4,
          axisLabel: { color: "#7d8999", fontSize: 10, formatter: (value: number) => formatMoney(value) },
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { lineStyle: { color: "#e3e8ef", type: "solid" } }
        },
        {
          type: "value",
          axisLabel: { color: "#7d8999", fontSize: 10, formatter: (value: number) => formatMoney(value) },
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { show: false }
        }
      ],
      series: [
        {
          name: `${asset}净流量`,
          type: "bar",
          data: rows.map((row) => ({
            value: row.flow,
            itemStyle: {
              color: row.flow >= 0 ? "#16bd79" : "#ef5362",
              borderRadius: row.flow >= 0 ? [5, 5, 1, 1] : [1, 1, 5, 5]
            }
          })),
          barMaxWidth: 9,
          barMinHeight: 2,
          markLine: {
            silent: true,
            symbol: "none",
            label: { show: false },
            lineStyle: { color: "#aeb8c5", width: 1, type: "solid" },
            data: [{ yAxis: 0 }]
          }
        },
        {
          name: "BTC累计",
          type: "line",
          yAxisIndex: 1,
          data: rows.map((row) => row.btcCumulative),
          showSymbol: false,
          smooth: false,
          lineStyle: { color: "#c88a12", width: 2 },
          itemStyle: { color: "#c88a12" }
        },
        {
          name: "ETH累计",
          type: "line",
          yAxisIndex: 1,
          data: rows.map((row) => row.ethCumulative),
          showSymbol: false,
          smooth: false,
          lineStyle: { color: "#52647b", width: 1.8 },
          itemStyle: { color: "#52647b" }
        }
      ]
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(chartRef.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [asset, rows]);

  return (
    <div className="cryptoEtfChartBody">
      <div className="cryptoEtfLegend" aria-hidden="true">
        <span><i />{asset}净流量 <b className={latest && latest.flow < 0 ? "negative" : "positive"}>{formatMoney(latest?.flow || 0)}</b></span>
        <span><i className="btcLine" />BTC累计 <b>{formatMoney(latest?.btcCumulative || 0)}</b></span>
        <span><i className="ethLine" />ETH累计 <b>{formatMoney(latest?.ethCumulative || 0)}</b></span>
      </div>
      <div ref={chartRef} className="cryptoEtfChart" role="img" aria-label={`${asset} ETF资金趋势`} />
      {!rows.length ? <div className="cryptoEtfChartEmpty">所选日期范围暂无数据</div> : null}
    </div>
  );
}
