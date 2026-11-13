const hts8542 = new Map([
  ["854231", { name: "Processors and controllers", color: "#285b7d" }],
  ["854232", { name: "Memory chips", color: "#6b5081" }],
  ["854233", { name: "Amplifiers", color: "#884b26" }],
  ["854239", { name: "Other integrated circuits", color: "#2f6654" }],
  ["854290", { name: "Integrated-circuit parts", color: "#85455b" }]
]);

const baselineYear = 2019;
const originLimit = 6;
const pct = d3.format(".1%");
const usd = d3.format("$,d");
const pp = d3.format("+.1f");
const compactNumber = d3.format("~s");
const shortUsd = value => "$" + compactNumber(value).replace("G", "B");

async function loadCensusImports() {
  const response = await fetch("data/process-data.csv");
  if (!response.ok) {
    throw new Error("Could not open data/process-data.csv (HTTP " + response.status +
      "). Run prepare-data.ipynb and serve mid-submission.");
  }

  const imports = d3.csvParse(await response.text(), (row, i) => {
    const year = Number(row.year);
    const value = Number(row.import_value_usd);

    if (!/^\d{4}$/.test(row.year) || !hts8542.has(row.product_code) ||
        !/^\d{4}$/.test(row.origin_code) || !row.origin?.trim() ||
        !/^\d+$/.test(row.import_value_usd) || !Number.isSafeInteger(value)) {
      throw new Error("Check line " + (i + 2) + " of data/process-data.csv.");
    }

    const name = row.origin === "KOREA, SOUTH" ? "South Korea" :
      row.origin.toLowerCase().replace(/\b[a-z]/g, letter => letter.toUpperCase());

    return { year, hts: row.product_code, origin: row.origin_code, name, value };
  });

  const originNames = new Map(imports.map(row => [row.origin, row.name]));
  const byYearHts = d3.rollup(imports, rows => {
    const originValue = new Map(rows.map(row => [row.origin, row.value]));
    if (originValue.size !== rows.length) {
      throw new Error("Duplicate origin for " + rows[0].year + " HTS " + rows[0].hts + ".");
    }

    // Origins outside the top six still contribute to the U.S. total.
    const usValue = d3.sum(rows, row => row.value);
    const ranked = rows.filter(row => row.value > 0)
      .sort((a, b) => b.value - a.value || d3.ascending(a.origin, b.origin));

    return {
      usValue,
      ranked,
      originValue,
      topThreeShare: d3.sum(ranked.slice(0, 3), row => row.value) / usValue
    };
  }, row => row.year, row => row.hts);

  const years = [...byYearHts.keys()].sort(d3.ascending);
  if (years[0] !== baselineYear || years.some((year, i) => year !== baselineYear + i)) {
    throw new Error("The CSV needs consecutive calendar years starting in 2019.");
  }

  for (const year of years) {
    for (const [hts, product] of hts8542) {
      const block = byYearHts.get(year).get(hts);
      if (!block || block.ranked.length < originLimit) {
        throw new Error(year + " " + product.name + " has fewer than six recorded positive origins.");
      }
    }
  }

  const latestYear = years.at(-1);
  const openingView = { year: latestYear, hts: "854231", origin: null, metric: "share" };
  const tradeView = { ...openingView };
  const yearMenu = d3.select("#year");
  const htsMenu = d3.select("#product");
  const chartTooltip = document.querySelector("#chart-tooltip");

  function showChartTooltip(event, detail) {
    if (event.pointerType === "touch") return;

    chartTooltip.textContent = detail;
    chartTooltip.hidden = false;
    moveChartTooltip(event);
  }

  function moveChartTooltip(event) {
    if (chartTooltip.hidden) return;

    const { clientX: x, clientY: y } = event;
    const { clientWidth, clientHeight } = document.documentElement;
    const gap = 12;
    const edge = 8;
    const width = chartTooltip.offsetWidth;
    const height = chartTooltip.offsetHeight;
    const left = x + gap + width <= clientWidth - edge ? x + gap : x - gap - width;
    const top = y + gap + height <= clientHeight - edge ? y + gap : y - gap - height;

    chartTooltip.style.left = Math.max(edge, left) + "px";
    chartTooltip.style.top = Math.max(edge, top) + "px";
  }

  function hideChartTooltip() {
    chartTooltip.hidden = true;
  }

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") hideChartTooltip();
  });
  window.addEventListener("scroll", hideChartTooltip, { capture: true, passive: true });

  yearMenu.selectAll("option").data(years).join("option")
    .attr("value", year => year).text(year => year);
  htsMenu.selectAll("option").data([...hts8542]).join("option")
    .attr("value", ([hts]) => hts).text(([, product]) => product.name);

  yearMenu.on("change", event => {
    tradeView.year = Number(event.target.value);
    refreshTradeViews();
  });

  htsMenu.on("change", event => {
    tradeView.hts = event.target.value;
    refreshTradeViews();
  });

  d3.selectAll("[data-metric]").on("click", event => {
    tradeView.metric = event.currentTarget.dataset.metric;
    refreshTradeViews();
  });

  d3.select("#reset").on("click", () => {
    Object.assign(tradeView, openingView);
    refreshTradeViews();
  });

  function refreshTradeViews() {
    hideChartTooltip();
    const block = byYearHts.get(tradeView.year).get(tradeView.hts);
    const leaders = block.ranked.slice(0, originLimit);
    const previousOrigin = tradeView.origin;
    const focus = leaders.find(row => row.origin === previousOrigin) ?? leaders[0];
    tradeView.origin = focus.origin;

    d3.select("#origin-notice").text(previousOrigin && previousOrigin !== focus.origin
      ? originNames.get(previousOrigin) + " is outside this top six. Showing " + focus.name + "."
      : "");
    yearMenu.property("value", tradeView.year);
    htsMenu.property("value", tradeView.hts);
    d3.select("#dashboard").style("--product-color", hts8542.get(tradeView.hts).color);
    d3.selectAll("[data-metric]").attr("aria-pressed", function () {
      return this.dataset.metric === tradeView.metric;
    });

    updateOriginRanking(leaders, block.usValue);
    updateImportHistory();
    updateOriginProductMix();
  }

  function updateOriginRanking(leaders, usValue) {
    const baselineOnly = tradeView.year === baselineYear;
    const base = byYearHts.get(baselineYear).get(tradeView.hts);
    const coverage = d3.sum(leaders, row => row.value) / usValue;
    d3.select("#rank-context").text(hts8542.get(tradeView.hts).name + " · Top six in " +
      tradeView.year + " account for " + pct(coverage) + " of U.S. import value");
    d3.select("#rank-legend").text(baselineOnly
      ? "○ " + baselineYear + " baseline"
      : "○ " + baselineYear + " · ● " + tradeView.year + " · pp = percentage points");

    // Use the same origin's 2019 record, even if it ranked below sixth then.
    const comparison = leaders.map(row => {
      const oldValue = base.originValue.get(row.origin);
      const oldShare = oldValue == null ? null : oldValue / base.usValue;
      const share = row.value / usValue;
      let change = "No " + baselineYear + " record";

      if (oldShare !== null) {
        const points = 100 * (share - oldShare);
        if (points === 0) change = "0.0 pp";
        else if (Math.abs(points) < .05) change = (points > 0 ? "+" : "−") + "<0.1 pp";
        else change = pp(points) + " pp";
      }

      const current = tradeView.year + ": " + pct(share) + " (" + usd(row.value) + ")";
      const baseline = baselineYear + ": " +
        (oldShare === null ? "no record" : pct(oldShare) + " (" + usd(oldValue) + ")");

      const detail = [row.name];
      if (!baselineOnly) detail.push(baseline);
      detail.push(current);
      if (!baselineOnly && oldShare !== null) {
        detail.push(change.replace(" pp", " percentage points"));
      }

      let rowLabel = pct(share);
      if (!baselineOnly) {
        if (oldShare !== null) rowLabel = pct(oldShare) + " to " + rowLabel;
        rowLabel += " (" + change + ")";
      }

      return { ...row, oldShare, share, rowLabel, detail };
    });

    const focus = comparison.find(row => row.origin === tradeView.origin);
    const rankDetail = d3.select("#rank-detail").text(focus.detail.join(" · "));
    const width = document.querySelector("#rank-axis").clientWidth;
    const shareX = d3.scaleLinear([0, 1], [18, Math.max(18, width - 18)]);

    d3.select("#rank-axis").attr("class", "axis").selectAll("g").data([null]).join("g")
      .call(d3.axisBottom(shareX).tickValues([0, .25, .5, .75, 1]).tickFormat(d3.format(".0%")));

    const rows = d3.select("#ranking").selectAll("button").data(comparison, row => row.origin)
      .join(enter => {
        const button = enter.append("button").attr("type", "button").attr("class", "chart-row");
        button.append("span").attr("class", "row-name");
        button.append("span").attr("class", "row-number");
        button.append("svg").attr("height", 24).attr("aria-hidden", "true");
        return button;
      });

    rows.attr("aria-pressed", row => row.origin === tradeView.origin)
      .attr("aria-label", row => row.detail.join(" · "))
      .on("click", (_, row) => {
        tradeView.origin = row.origin;
        refreshTradeViews();
      })
      .on("pointerenter", (event, row) => showChartTooltip(event, row.detail.join("\n")))
      .on("pointermove", moveChartTooltip)
      .on("pointerleave pointercancel", hideChartTooltip)
      .on("focus", (_, row) => rankDetail.text(row.detail.join(" · ")))
      .on("blur", () => rankDetail.text(focus.detail.join(" · ")));

    rows.select(".row-name").text((row, i) => (i + 1) + ". " + row.name);
    rows.select(".row-number").text(row => row.rowLabel);

    rows.select("svg").each(function (row) {
      const track = d3.select(this);
      track.selectAll("*").remove();
      const currentX = shareX(row.share);
      let currentY = 12;

      if (!baselineOnly && row.oldShare !== null) {
        const baselineX = shareX(row.oldShare);
        const gap = currentX - baselineX;
        const room = Math.abs(gap) - 14;
        const dotsOverlap = Math.abs(gap) < 12;
        if (dotsOverlap) currentY = 18;

        if (room >= 6) {
          const direction = Math.sign(gap);
          const tail = baselineX + 7 * direction;
          const tip = currentX - 7 * direction;
          const headLength = Math.min(10, room / 2);
          const headBase = tip - headLength * direction;
          const headHalfHeight = Math.min(6, headLength);

          const points = [
            [tail, 10], [headBase, 10],
            [headBase, 12 - headHalfHeight], [tip, 12],
            [headBase, 12 + headHalfHeight], [headBase, 14],
            [tail, 14]
          ];

          track.append("polygon")
            .attr("points", points.map(point => point.join(",")).join(" "))
            .attr("fill", direction > 0 ? "#1764a3" : "#a94708");
        }

        track.append("circle").attr("class", "baseline-dot")
          .attr("cx", baselineX).attr("cy", dotsOverlap ? 6 : 12).attr("r", 5);
      }

      track.append("circle").attr("class", baselineOnly ? "baseline-dot" : "current-dot")
        .attr("cx", currentX).attr("cy", currentY).attr("r", 5);
    });
  }

  function updateImportHistory() {
    const shareMode = tradeView.metric === "share";
    const origin = originNames.get(tradeView.origin);
    const reference = shareMode ? "Top three origins each year" : "All origins";
    const format = shareMode ? pct : usd;

    const history = years.map(year => {
      const block = byYearHts.get(year).get(tradeView.hts);
      const value = block.originValue.get(tradeView.origin);
      // The three origins behind the concentration line can change each year.
      return {
        year,
        total: shareMode ? block.topThreeShare : block.usValue,
        focus: value == null ? null : (shareMode ? value / block.usValue : value)
      };
    });

    const plot = document.querySelector("#history-plot");
    const width = plot.clientWidth;
    if (width < 100) return;

    const height = plot.clientHeight;
    const left = 54;
    const right = 12;
    const bottom = height - 34;
    const x = d3.scaleBand(years, [left, width - right]);
    const yearX = year => x(year) + x.bandwidth() / 2;
    const y = d3.scaleLinear([0, shareMode ? 1 : d3.max(history, row => row.total)], [bottom, 12]);
    if (!shareMode) y.nice(4);

    const svg = d3.select("#history-svg").attr("width", width).attr("height", height);
    svg.selectAll("*").remove();
    svg.append("g").attr("class", "axis history-grid").attr("transform", "translate(" + left + ",0)")
      .call(d3.axisLeft(y).ticks(4).tickSize(left + right - width)
        .tickFormat(shareMode ? d3.format(".0%") : shortUsd));

    svg.append("line").attr("class", "year-guide")
      .attr("x1", yearX(tradeView.year)).attr("x2", yearX(tradeView.year))
      .attr("y1", 12).attr("y2", bottom);

    for (const key of ["total", "focus"]) {
      const layer = svg.append("g").attr("class", "history-series history-" + key);
      const line = d3.line().defined(row => row[key] !== null)
        .x(row => yearX(row.year)).y(row => y(row[key]));

      layer.append("path").datum(history).attr("d", line);
      layer.selectAll("circle").data(history.filter(row => row[key] !== null)).join("circle")
        .attr("cx", row => yearX(row.year)).attr("cy", row => y(row[key])).attr("r", 3);
    }

    d3.select("#history-context").text(hts8542.get(tradeView.hts).name + " · " +
      (shareMode ? "Share of U.S. import value" : "Nominal U.S. dollars"));
    d3.select("#history-reference").text(reference);
    d3.select("#history-origin").text(origin);

    const describe = row => row.year + " · " + reference + ": " + format(row.total) +
      " · " + origin + ": " + (row.focus === null ? "No record" : format(row.focus));
    const selectedYear = history.find(row => row.year === tradeView.year);
    const historyDetail = d3.select("#history-detail").text(describe(selectedYear));

    d3.select("#history-years").style("left", left + "px").style("right", right + "px")
      .selectAll("button").data(history, row => row.year).join("button")
      .attr("type", "button").attr("aria-pressed", row => row.year === tradeView.year)
      .attr("aria-label", describe)
      .text(row => width < 420 ? "’" + String(row.year).slice(-2) : row.year)
      .on("click", (_, row) => {
        tradeView.year = row.year;
        refreshTradeViews();
      })
      .on("pointerenter focus", (_, row) => historyDetail.text(describe(row)))
      .on("pointerleave blur", () => historyDetail.text(describe(selectedYear)));
  }

  function updateOriginProductMix() {
    const byHts = byYearHts.get(tradeView.year);
    const mix = [...hts8542].map(([hts, product]) => ({
      hts, ...product, value: byHts.get(hts).originValue.get(tradeView.origin)
    }));

    // The mix divides by one origin's total across the five HTS products.
    const originTotal = d3.sum(mix, row => row.value);
    d3.select("#mix-context").text(tradeView.year + " · " + originNames.get(tradeView.origin) +
      " · Share of this origin’s HTS 8542 value");

    const shareLabel = row => row.value == null ? "No record" : pct(row.value / originTotal);
    const describe = row => row.value == null ? [row.name, "No record"] :
      [row.name, usd(row.value), shareLabel(row)];
    const selectedProduct = mix.find(row => row.hts === tradeView.hts);
    const summary = describe(selectedProduct).join(" · ") + " · " + usd(originTotal) + " total";
    const mixDetail = d3.select("#mix-detail").text(summary);

    const rows = d3.select("#mix").selectAll("button").data(mix, row => row.hts)
      .join(enter => {
        const button = enter.append("button").attr("type", "button").attr("class", "chart-row");
        button.append("span").attr("class", "row-name");
        button.append("span").attr("class", "row-number");
        button.append("span").attr("class", "mix-track").attr("aria-hidden", "true")
          .append("span").attr("class", "mix-fill");
        return button;
      });

    rows.attr("aria-pressed", row => row.hts === tradeView.hts)
      .attr("aria-label", row => describe(row).join(" · "))
      .on("click", (_, row) => {
        tradeView.hts = row.hts;
        refreshTradeViews();
      })
      .on("pointerenter", (event, row) => showChartTooltip(event, describe(row).join("\n")))
      .on("pointermove", moveChartTooltip)
      .on("pointerleave pointercancel", hideChartTooltip)
      .on("focus", (_, row) => mixDetail.text(describe(row).join(" · ")))
      .on("blur", () => mixDetail.text(summary));

    rows.select(".row-name").text(row => row.name);
    rows.select(".row-number").text(shareLabel);
    rows.select(".mix-fill").style("--product-color", row => row.color)
      .style("width", row => 100 * ((row.value ?? 0) / originTotal) + "%");
  }

  d3.select("#year-span").text(baselineYear + "–" + latestYear);
  d3.select("#dashboard").property("hidden", false);
  refreshTradeViews();
  d3.select("#load-message").property("hidden", true);

  const resize = new ResizeObserver(refreshTradeViews);
  resize.observe(document.querySelector("#history-plot"));
  resize.observe(document.querySelector("#rank-axis"));
}

loadCensusImports().catch(error => {
  console.error(error);
  d3.select("#dashboard").property("hidden", true);
  d3.select("#load-message").property("hidden", false).text(error.message);
});
