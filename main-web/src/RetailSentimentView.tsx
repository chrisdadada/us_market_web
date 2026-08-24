import { lazy, Suspense, useEffect, useState } from "react";
import { api, type RetailSentimentPayload } from "./api";
import type { RetailSentimentMetric } from "./RetailSentimentChart";

const RetailSentimentChart = lazy(() => import("./RetailSentimentChart"));

function marginMoney(value: number) {
  return `${(value / 1_000_000).toFixed(2)} 万亿美元`;
}

export default function RetailSentimentView() {
  const [payload, setPayload] = useState<RetailSentimentPayload | null>(null);
  const [metric, setMetric] = useState<RetailSentimentMetric>("options");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [requestId, setRequestId] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    api.retailSentiment()
      .then((data) => {
        if (alive) setPayload(data);
      })
      .catch(() => {
        if (alive) setError("散户情绪数据暂不可用");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [requestId]);

  if (loading) return <div className="retailSentimentState">加载中</div>;
  if (error || !payload?.options || !payload?.survey || !payload?.margin) {
    return <div className="retailSentimentState"><span>{error || "散户情绪数据暂不可用"}</span><button type="button" onClick={() => setRequestId((value) => value + 1)}>重新加载</button></div>;
  }

  const optionsUp = payload.options.callSharePct >= 50;
  const surveyBearish = payload.survey.bearishPct > payload.survey.bullishPct;
  const marginChange = payload.margin.changePct;
  const cards: Array<{
    key: RetailSentimentMetric;
    title: string;
    state: string;
    description: string;
    value: string;
    meta: string;
    tone: "positive" | "negative" | "neutral";
  }> = [
    {
      key: "options",
      title: "期权交易",
      state: optionsUp ? "看涨占优" : "看跌占优",
      description: optionsUp ? "看涨成交量高于看跌" : "看跌成交量高于看涨",
      value: `${payload.options.callSharePct.toFixed(1)}%`,
      meta: `看涨成交占比 · ${payload.options.date}`,
      tone: optionsUp ? "positive" : "negative"
    },
    {
      key: "survey",
      title: "散户调查",
      state: surveyBearish ? "偏谨慎" : payload.survey.bullishPct > payload.survey.bearishPct ? "偏乐观" : "分歧不大",
      description: surveyBearish ? "看空人数多于看多" : payload.survey.bullishPct > payload.survey.bearishPct ? "看多人数多于看空" : "看多与看空人数接近",
      value: `${(surveyBearish ? payload.survey.bearishPct : payload.survey.bullishPct).toFixed(1)}%`,
      meta: `${surveyBearish ? "看空" : "看多"}占比 · ${payload.survey.date}`,
      tone: surveyBearish ? "negative" : "positive"
    },
    {
      key: "margin",
      title: "融资杠杆",
      state: marginChange < 0 ? "回落" : marginChange > 0 ? "增加" : "持平",
      description: marginChange < 0 ? "融资余额较上月下降" : marginChange > 0 ? "融资余额较上月增加" : "融资余额与上月持平",
      value: `${marginChange > 0 ? "+" : ""}${marginChange.toFixed(1)}%`,
      meta: `${marginMoney(payload.margin.balanceUsdMillions)} · ${payload.margin.date}`,
      tone: marginChange < 0 ? "negative" : marginChange > 0 ? "positive" : "neutral"
    }
  ];
  const selected = cards.find((card) => card.key === metric) || cards[0];
  const chartDescription = metric === "options"
    ? "看涨期权成交占比"
    : metric === "survey"
      ? "看多与看空人数占比"
      : "客户证券融资余额";

  return (
    <div className="retailSentimentView">
      <section className="retailSentimentSummary">
        <span>当前信号</span>
        <strong>{optionsUp ? "期权交易偏向看涨" : "期权交易偏向看跌"}，散户调查{surveyBearish ? "偏谨慎" : "偏乐观"}，融资余额{marginChange < 0 ? "较上月回落" : marginChange > 0 ? "较上月增加" : "与上月持平"}。</strong>
        <small>数据截至 {payload.asOf}</small>
      </section>

      <section className="retailSentimentCards" aria-label="散户情绪指标">
        {cards.map((card) => (
          <button type="button" key={card.key} className={metric === card.key ? "active" : ""} aria-pressed={metric === card.key} onClick={() => setMetric(card.key)}>
            <span><strong>{card.title}</strong><b className={card.tone}>{card.state}</b></span>
            <small>{card.description}</small>
            <em className={card.tone}>{card.value}</em>
            <i>{card.meta}</i>
          </button>
        ))}
      </section>

      <section className="retailSentimentTrend">
        <header><div><strong>{selected.title}趋势</strong><span>{chartDescription}</span></div><b className={selected.tone}>{selected.state}</b></header>
        <Suspense fallback={<div className="retailSentimentChartLoading">加载图表</div>}>
          <RetailSentimentChart payload={payload} metric={metric} />
        </Suspense>
      </section>
    </div>
  );
}
