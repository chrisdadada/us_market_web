function numberValue(value) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/[,%+$x]/gi, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function bucketFor(row) {
  const score = Number(row.score || 0);
  const heat = Number(row.crowding?.score || 0);
  if (score >= 75) return heat >= 72 ? "hot" : "watch";
  return score < 55 ? "avoid" : "neutral";
}

export function strengthPageFixture(strength, url) {
  const unique = new Map();
  for (const row of strength.rows || []) {
    const existing = unique.get(row.symbol);
    if (!existing || Number(row.score || 0) > Number(existing.score || 0)) unique.set(row.symbol, row);
  }
  const allRows = [...unique.values()];
  const counts = { all: allRows.length, watch: 0, hot: 0, neutral: 0, avoid: 0 };
  allRows.forEach((row) => { counts[bucketFor(row)] += 1; });

  const bucket = String(url.searchParams.get("bucket") || "watch");
  const query = String(url.searchParams.get("q") || "").trim().toUpperCase();
  const sector = String(url.searchParams.get("sector") || "all");
  const heat = String(url.searchParams.get("heat") || "all");
  const sort = String(url.searchParams.get("sort") || "score");
  const sortValue = {
    score: (row) => Number(row.score || 0),
    return20d: (row) => numberValue(row.periods?.["20d"]),
    relative: (row) => numberValue(row.relative?.spy),
    crowding: (row) => Number(row.crowding?.score || 0),
  }[sort] || ((row) => Number(row.score || 0));
  const rows = allRows
    .filter((row) => bucket === "all" || bucketFor(row) === bucket)
    .filter((row) => !query || `${row.symbol} ${row.name || ""}`.toUpperCase().includes(query))
    .filter((row) => sector === "all" || (row.sectorProxy || row.sector) === sector)
    .filter((row) => {
      const value = Number(row.crowding?.score || 0);
      return heat === "all"
        || (heat === "normal" && value < 55)
        || (heat === "rising" && value >= 55 && value < 72)
        || (heat === "hot" && value >= 72);
    })
    .sort((a, b) => sortValue(b) - sortValue(a) || String(a.symbol).localeCompare(String(b.symbol)));
  const limit = Number(url.searchParams.get("limit") || 20);
  const offset = Number(url.searchParams.get("offset") || 0);
  return {
    ...strength,
    counts,
    sectors: [...new Set(allRows.map((row) => row.sectorProxy || row.sector).filter(Boolean))],
    rows: rows.slice(offset, offset + limit),
    total: rows.length,
    limit,
    offset,
    bucket,
  };
}
