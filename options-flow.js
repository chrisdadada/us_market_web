const DATA_PATH = "/api/product/raw/options-flow-snapshot";

const money = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  const sign = number < 0 ? "-" : "";
  const abs = Math.abs(number);
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)} B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)} M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)} K`;
  return `${sign}$${abs.toFixed(2)}`;
};

const shortDate = (isoDate) => {
  const date = new Date(`${isoDate}T12:00:00`);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
};

const pathFromPoints = (points) => points.map((point, index) => `${index ? "L" : "M"}${point[0].toFixed(1)} ${point[1].toFixed(1)}`).join(" ");

const scale = (value, min, max, outMin, outMax) => {
  if (max === min) return (outMin + outMax) / 2;
  return outMax - ((value - min) / (max - min)) * (outMax - outMin);
};

const renderChart = (rows) => {
  const svg = document.querySelector("#flowChart");
  const width = 760;
  const topHeight = 350;
  const bottomTop = 386;
  const bottomHeight = 94;
  const pad = { left: 74, right: 70, top: 34 };
  const chartRight = width - pad.right;
  const xStep = (chartRight - pad.left) / (rows.length - 1);
  const premiumValues = rows.flatMap((row) => [row.call, row.put, row.net]);
  const premiumMin = Math.min(-100_000_000, ...premiumValues);
  const premiumMax = Math.max(20_000_000, ...premiumValues);
  const priceMin = Math.min(...rows.map((row) => row.price)) - 12;
  const priceMax = Math.max(...rows.map((row) => row.price)) + 8;
  const volumeMin = Math.min(...rows.map((row) => row.putVolume), -32000);
  const volumeMax = 0;

  const point = (row, key) => [
    pad.left + rows.indexOf(row) * xStep,
    scale(row[key], premiumMin, premiumMax, pad.top, topHeight),
  ];
  const pricePoint = (row) => [
    pad.left + rows.indexOf(row) * xStep,
    scale(row.price, priceMin, priceMax, pad.top, topHeight),
  ];
  const volumePoint = (row) => [
    pad.left + rows.indexOf(row) * xStep,
    scale(row.putVolume, volumeMin, volumeMax, bottomTop, bottomTop + bottomHeight),
  ];

  const gridLines = [-100_000_000, -80_000_000, -60_000_000, -40_000_000, -20_000_000, 0, 20_000_000]
    .map((tick) => {
      const y = scale(tick, premiumMin, premiumMax, pad.top, topHeight);
      return `<line class="chart-grid" x1="${pad.left}" x2="${chartRight}" y1="${y}" y2="${y}"></line>
        <text class="axis-label" x="18" y="${y + 5}">${money(tick).replace(".00", "")}</text>`;
    })
    .join("");

  const priceTicks = [840, 860, 880, 900, 920, 940, 960]
    .map((tick) => {
      const y = scale(tick, priceMin, priceMax, pad.top, topHeight);
      return `<text class="axis-label" x="${chartRight + 12}" y="${y + 5}">$${tick}</text>`;
    })
    .join("");

  const timeLabels = rows
    .filter((row) => ["10:00", "11:00"].includes(row.time))
    .map((row) => {
      const x = pad.left + rows.indexOf(row) * xStep;
      return `<text class="time-label" x="${x - 22}" y="504">${row.time} AM</text>`;
    })
    .join("");

  const volumePath = pathFromPoints(rows.map(volumePoint));
  const volumeArea = `${volumePath} L${chartRight} ${bottomTop + bottomHeight} L${pad.left} ${bottomTop + bottomHeight} Z`;

  svg.innerHTML = `
    <rect x="0" y="0" width="${width}" height="510" fill="transparent"></rect>
    ${gridLines}
    ${priceTicks}
    <line class="chart-grid" x1="${pad.left}" x2="${chartRight}" y1="${bottomTop}" y2="${bottomTop}"></line>
    <line class="chart-grid" x1="${pad.left}" x2="${chartRight}" y1="${bottomTop + bottomHeight}" y2="${bottomTop + bottomHeight}"></line>
    <text class="axis-label" x="34" y="${bottomTop + 7}">0</text>
    <text class="axis-label" x="26" y="${bottomTop + 38}">-10 K</text>
    <text class="axis-label" x="26" y="${bottomTop + 66}">-20 K</text>
    <text class="axis-label" x="26" y="${bottomTop + 91}">-30 K</text>
    <path class="sub-area" d="${volumeArea}"></path>
    <path class="spot-line" d="${pathFromPoints(rows.map(pricePoint))}"></path>
    <path class="call-line" d="${pathFromPoints(rows.map((row) => point(row, "call")))}"></path>
    <path class="put-line" d="${pathFromPoints(rows.map((row) => point(row, "put")))}"></path>
    ${timeLabels}
  `;
};

const renderRank = (selector, rows, color) => {
  const max = Math.max(...rows.map((row) => row.premium));
  document.querySelector(selector).innerHTML = rows
    .map((row, index) => {
      const width = Math.max(4, (row.premium / max) * 100);
      return `
        <tr>
          <td>${index + 1}</td>
          <td>${row.ticker}</td>
          <td>
            <div class="premium-bar" style="--w:${width}%; --bar-color:${color}">
              <i></i><span>${money(row.premium)}</span>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
};

const render = (payload) => {
  const { meta, summary, timeline, bullish, bearish } = payload;
  document.querySelector("#symbolPill").textContent = meta.symbol;
  document.querySelector("#datePill").textContent = shortDate(meta.tradeDate);
  document.querySelector("#expirationPill").textContent = shortDate(meta.expiration);
  document.querySelector("#headline").textContent = summary.headline;
  document.querySelector("#callMetric").textContent = money(summary.callPremium);
  document.querySelector("#putMetric").textContent = money(summary.putPremium);
  document.querySelector("#netMetric").textContent = money(summary.netDrift);
  document.querySelector("#spotMetric").textContent = `$${Number(summary.underlyingLast).toFixed(2)}`;
  document.querySelector("#chartTitle").textContent = `Net Drift (Premium) - ${meta.symbol}`;
  document.querySelector("#legendText").textContent = `Calls (${money(summary.callPremium)})   Puts (${money(summary.putPremium)})   ${meta.symbol} ($${Number(summary.underlyingLast).toFixed(2)})`;
  renderChart(timeline);
  renderRank("#bullishRows", bullish, "var(--green)");
  renderRank("#bearishRows", bearish, "var(--red)");
};

fetch(DATA_PATH)
  .then((response) => response.json())
  .then(render)
  .catch((error) => {
    document.querySelector("#headline").textContent = `数据加载失败：${error.message}`;
  });
