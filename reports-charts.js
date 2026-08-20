/* ============================================================
   REPORTS — chart & graph rendering
   Purely additive: reads live app state through window.__dcApp
   (exposed at the bottom of js/app.js) and only ever writes into
   the new report-chart elements added to the Reports view. It
   never touches employeesCache/auditEntries directly, so app.js
   stays the single source of truth for data + Firestore.
   ============================================================ */

const escapeHtml = (str) => String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const RISK_COLORS = { low: "var(--sage)", medium: "var(--amber)", high: "var(--danger)" };
const STATUS_COLORS = { upToDate: "var(--sage)", expiringSoon: "var(--amber)", overdue: "var(--danger)" };
const STATUS_LABELS = { upToDate: "Up to date", expiringSoon: "Expiring soon", overdue: "Overdue" };

function relativeTime(date) {
  if (!date) return "just now";
  const diffMs = Date.now() - date.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

/* ---------------- Compliance by quarter ---------------- */
function computeQuarterData(app) {
  const items = app.collectAllTrackedItems();
  const year = new Date().getFullYear();
  const buckets = [0, 1, 2, 3].map(() => ({ upToDate: 0, expiringSoon: 0, overdue: 0 }));
  items.forEach((i) => {
    const d = new Date(i.date);
    if (Number.isNaN(d.getTime()) || d.getFullYear() !== year) return;
    const q = Math.floor(d.getMonth() / 3);
    const status = i.days < 0 ? "overdue" : i.days <= 90 ? "expiringSoon" : "upToDate";
    buckets[q][status] += 1;
  });
  return buckets;
}

function renderQuarterChart(app) {
  const legendEl = document.getElementById("quarter-legend");
  const chartEl = document.getElementById("quarter-chart");
  if (!legendEl || !chartEl) return;

  legendEl.innerHTML = Object.keys(STATUS_LABELS).map((key) =>
    `<li><span class="dot" style="background:${STATUS_COLORS[key]}"></span>${STATUS_LABELS[key]}</li>`).join("");

  const buckets = computeQuarterData(app);
  const max = Math.max(1, ...buckets.flatMap((b) => Object.values(b)));
  const hasAny = buckets.some((b) => b.upToDate + b.expiringSoon + b.overdue > 0);

  if (!hasAny) {
    chartEl.innerHTML = `<div class="bar-chart-empty">No compliance items with a ${new Date().getFullYear()} expiry date yet.</div>`;
    return;
  }

  chartEl.innerHTML = buckets.map((b, idx) => `
    <div class="bar-chart-group">
      <div class="bar-chart-bars">
        ${Object.keys(STATUS_LABELS).map((key) => {
          const val = b[key];
          const heightPct = Math.max(val ? 4 : 0, (val / max) * 100);
          return `<div class="bar-chart-bar" title="${STATUS_LABELS[key]}: ${val}" style="height:${heightPct}%;background:${STATUS_COLORS[key]}"></div>`;
        }).join("")}
      </div>
      <div class="bar-chart-label">Q${idx + 1}</div>
    </div>`).join("");
}

/* ---------------- Live activity feed ---------------- */
function renderLiveFeed(app) {
  const listEl = document.getElementById("live-feed-list");
  const emptyEl = document.getElementById("live-feed-empty");
  if (!listEl) return;
  const entries = (app.auditEntries || []).slice(0, 6);
  emptyEl?.classList.toggle("hidden", entries.length > 0);
  listEl.innerHTML = entries.map((a) => {
    const when = a.ts?.toDate ? a.ts.toDate() : null;
    const title = `${escapeHtml(a.action || "Update")}${a.employeeName ? ` — ${escapeHtml(a.employeeName)}` : ""}`;
    return `<li><span class="feed-dot" aria-hidden="true"></span><span class="feed-body"><div class="feed-title">${title}</div><div class="feed-time">${escapeHtml(a.user || "System")} · ${relativeTime(when)}</div></span></li>`;
  }).join("");
}

/* ---------------- Sponsored workers risk distribution ---------------- */
function computeSponsoredRisk(app) {
  const sponsored = (app.employeesCache || []).filter((e) => e.cosNumber);
  const risk = { low: 0, medium: 0, high: 0 };
  sponsored.forEach((e) => {
    const days = app.daysUntil(e.visaExpiry);
    if (days === null) risk.low += 1;
    else if (days < 0) risk.high += 1;
    else if (days <= 90) risk.medium += 1;
    else risk.low += 1;
  });
  return { total: sponsored.length, risk };
}

/* Fixed illustrative map points (common sponsor regions for UK care
   sector recruitment). There's no per-worker location field in the
   data model, so the live low/medium/high split is distributed across
   these points proportionally — a stylised distribution, not literal
   per-worker geodata. */
const MAP_POINTS = [
  { name: "India", x: 660, y: 175, weight: 0.24 },
  { name: "Nigeria", x: 430, y: 210, weight: 0.20 },
  { name: "Philippines", x: 730, y: 200, weight: 0.16 },
  { name: "Zimbabwe", x: 465, y: 255, weight: 0.14 },
  { name: "Nepal", x: 690, y: 165, weight: 0.12 },
  { name: "United Kingdom", x: 400, y: 95, weight: 0.08 },
  { name: "Ghana", x: 400, y: 220, weight: 0.06 },
];

function renderRiskDistribution(app) {
  const el = document.getElementById("risk-distribution");
  if (!el) return;
  const { total, risk } = computeSponsoredRisk(app);

  if (!total) {
    el.innerHTML = `<p class="risk-empty">No sponsored workers on record yet — dots will appear here once staff have a Certificate of Sponsorship.</p>`;
    return;
  }

  // Spread the live total across the fixed points by weight (simple
  // largest-remainder rounding so the counts always add up to `total`).
  const weightSum = MAP_POINTS.reduce((s, p) => s + p.weight, 0) || 1;
  const dots = MAP_POINTS.map((p) => {
    const raw = (p.weight / weightSum) * total;
    return { ...p, count: Math.floor(raw), remainder: raw - Math.floor(raw) };
  });
  let allocated = dots.reduce((s, d) => s + d.count, 0);
  dots.sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; allocated < total && i < dots.length; i++, allocated++) dots[i].count += 1;

  // Colour each dot by draining the live low/medium/high buckets,
  // worst risk first, so the colours reflect the real overall mix.
  let [high, medium, low] = [risk.high, risk.medium, risk.low];
  dots.forEach((d) => {
    for (let n = 0; n < d.count; n++) {
      if (high > 0) { high--; d.color = RISK_COLORS.high; }
      else if (medium > 0) { medium--; d.color = RISK_COLORS.medium; }
      else if (low > 0) { low--; d.color = RISK_COLORS.low; }
      else d.color = d.color || RISK_COLORS.low;
    }
  });

  const maxCount = Math.max(1, ...dots.map((d) => d.count));
  const worldSvg = `
    <svg class="world-map" viewBox="0 0 800 380" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Sponsored worker regional distribution">
      <rect x="0" y="0" width="800" height="380" class="world-ocean" />
      <g class="world-land">
        <path d="M70 70 C40 110 55 170 100 190 C150 215 210 190 230 150 C250 110 220 60 170 55 C130 50 95 45 70 70 Z"/>
        <path d="M180 220 C160 260 170 320 210 350 C240 370 270 340 265 300 C260 260 250 220 220 205 C205 198 190 205 180 220 Z"/>
        <path d="M380 60 C365 85 375 110 405 115 C430 118 445 95 435 72 C425 52 395 42 380 60 Z"/>
        <path d="M390 130 C365 170 370 240 400 280 C425 312 470 300 480 260 C490 220 480 170 460 145 C440 120 405 112 390 130 Z"/>
        <path d="M470 60 C460 100 500 130 560 140 C630 152 700 130 740 95 C760 76 730 45 680 42 C610 38 545 35 500 45 C485 48 474 50 470 60 Z"/>
        <path d="M640 260 C620 280 630 310 665 318 C700 326 730 305 722 278 C714 252 665 238 640 260 Z"/>
      </g>
      <g class="world-dots">
        ${dots.filter((d) => d.count > 0).map((d) => {
          const r = 6 + (d.count / maxCount) * 16;
          return `<g class="world-dot">
            <circle cx="${d.x}" cy="${d.y}" r="${r}" style="fill:${d.color}" fill-opacity="0.28"/>
            <circle cx="${d.x}" cy="${d.y}" r="${Math.max(4, r * 0.42)}" style="fill:${d.color}"/>
            <title>${escapeHtml(d.name)}: ${d.count} sponsored worker${d.count === 1 ? "" : "s"}</title>
          </g>`;
        }).join("")}
      </g>
    </svg>`;

  el.innerHTML = `
    ${worldSvg}
    <ul class="world-legend">
      <li><span class="dot" style="background:${RISK_COLORS.low}"></span>Low risk</li>
      <li><span class="dot" style="background:${RISK_COLORS.medium}"></span>Medium risk</li>
      <li><span class="dot" style="background:${RISK_COLORS.high}"></span>High risk</li>
    </ul>`;
}

/* ---------------- Staff demographics donut ---------------- */
const DEMOGRAPHIC_SEGMENTS = [
  { key: "active", label: "Active", color: "var(--sage)" },
  { key: "probation", label: "Probation", color: "var(--amber)" },
  { key: "leaver", label: "Leaver", color: "var(--danger)" },
];

function renderDemographicsDonut(app) {
  const donut = document.getElementById("demographics-donut");
  const legend = document.getElementById("demographics-legend");
  const totalEl = document.getElementById("demographics-total");
  if (!donut || !legend || !totalEl) return;

  const staff = app.employeesCache || [];
  const counts = { active: 0, probation: 0, leaver: 0 };
  staff.forEach((e) => {
    const key = counts[e.status] !== undefined ? e.status : "active";
    counts[key] += 1;
  });
  const total = staff.length;
  totalEl.textContent = total;

  let acc = 0;
  const stops = DEMOGRAPHIC_SEGMENTS.map((seg) => {
    const pct = total ? (counts[seg.key] / total) * 100 : 0;
    const from = acc;
    acc += pct;
    return `${seg.color} ${from}% ${acc}%`;
  }).join(", ");
  donut.style.background = total ? `conic-gradient(${stops})` : "conic-gradient(var(--line-soft) 0 100%)";

  legend.innerHTML = DEMOGRAPHIC_SEGMENTS.map((seg) => {
    const count = counts[seg.key];
    const pct = total ? Math.round((count / total) * 100) : 0;
    return `<li><span class="dot" style="background:${seg.color}"></span><span class="legend-label">${seg.label}</span><span class="legend-value">${count} (${pct}%)</span></li>`;
  }).join("");
}

/* ---------------- Missing documents by type ---------------- */
const REQUIRED_DOC_TYPES = ["Passport", "Employment contract", "DBS certificate", "Proof of address"];
const DOC_TYPE_COLORS = ["var(--sage)", "var(--amber)", "var(--danger)", "var(--ink-faint)"];

function renderMissingDocChart(app) {
  const el = document.getElementById("missing-doc-chart");
  const legendEl = document.getElementById("missing-doc-legend");
  if (!el) return;
  const staff = app.employeesCache || [];
  const counts = Object.fromEntries(REQUIRED_DOC_TYPES.map((t) => [t, 0]));
  staff.forEach((e) => {
    const have = new Set((e.documents || []).map((d) => d.type));
    REQUIRED_DOC_TYPES.forEach((t) => { if (!have.has(t)) counts[t] += 1; });
  });
  const max = Math.max(1, ...Object.values(counts));

  if (legendEl) {
    legendEl.innerHTML = REQUIRED_DOC_TYPES.map((t, idx) =>
      `<li><span class="dot" style="background:${DOC_TYPE_COLORS[idx]}"></span>${escapeHtml(t)}</li>`).join("");
  }

  if (!staff.length) {
    el.innerHTML = `<p class="risk-empty">No staff records yet.</p>`;
    return;
  }
  el.innerHTML = `<div class="doc-bars">${REQUIRED_DOC_TYPES.map((t, idx) => {
    const n = counts[t];
    const pct = Math.max(n ? 4 : 0, (n / max) * 100);
    return `<div class="doc-bar-row">
      <span class="doc-bar-label">${escapeHtml(t)}</span>
      <span class="doc-bar-track"><span class="doc-bar-fill" style="width:${pct}%;background:${DOC_TYPE_COLORS[idx]}"></span></span>
      <span class="doc-bar-count">${n}</span>
    </div>`;
  }).join("")}</div>`;
}

/* ---------------- Recent reports ---------------- */
function renderRecentReports(app) {
  const tbody = document.querySelector("#recent-reports-table tbody");
  const emptyEl = document.getElementById("recent-reports-empty");
  if (!tbody) return;
  const runs = app.reportRunLog || [];
  emptyEl?.classList.toggle("hidden", runs.length > 0);
  tbody.innerHTML = runs.map((r, idx) => `
    <tr>
      <td>${r.date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</td>
      <td>${escapeHtml(r.title)}</td>
      <td><span class="pill ${r.needsAttention ? "warn" : "ok"}">${r.needsAttention ? "Needs attention" : "All OK"}</span></td>
      <td>
        <button type="button" class="row-icon-btn" data-recent-idx="${idx}" title="Re-run &amp; export ${escapeHtml(r.title)}">
          <span class="icon-mask" style="--icon-url:var(--icon-chart)" aria-hidden="true"></span>
        </button>
        <button type="button" class="row-icon-btn" data-recent-idx="${idx}" title="Re-run &amp; export ${escapeHtml(r.title)}">
          <span class="icon-mask" style="--icon-url:var(--icon-download)" aria-hidden="true"></span>
        </button>
      </td>
    </tr>`).join("");
  tbody.querySelectorAll(".row-icon-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const run = runs[Number(btn.dataset.recentIdx)];
      if (run?.type) app.openReport(run.type);
    });
  });
}

/* ---------------- Reports topbar chrome (date / export / bell / avatar) ---------------- */
function initReportsChrome() {
  const dateEl = document.getElementById("reports-date");
  const dashDateEl = document.getElementById("dashboard-date");
  if (dateEl) dateEl.textContent = dashDateEl?.textContent || new Date().toLocaleDateString("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const avatarEl = document.getElementById("reports-avatar");
  const dashAvatarEl = document.getElementById("dashboard-avatar");
  if (avatarEl) avatarEl.textContent = dashAvatarEl?.textContent || "--";

  const badgeEl = document.getElementById("reports-notif-badge");
  const dashBadgeEl = document.getElementById("notif-badge");
  if (badgeEl && dashBadgeEl) {
    badgeEl.textContent = dashBadgeEl.textContent;
    badgeEl.classList.toggle("hidden", dashBadgeEl.classList.contains("hidden"));
  }

  const exportBtn = document.getElementById("reports-export-btn");
  if (exportBtn && !exportBtn.dataset.bound) {
    exportBtn.dataset.bound = "1";
    exportBtn.addEventListener("click", () => document.getElementById("export-csv-btn")?.click());
  }
  const bellBtn = document.getElementById("reports-bell-btn");
  if (bellBtn && !bellBtn.dataset.bound) {
    bellBtn.dataset.bound = "1";
    bellBtn.addEventListener("click", () => window.__dcApp?.showView("dashboard"));
  }

  const toggle = document.getElementById("map-mode-toggle");
  if (toggle && !toggle.dataset.bound) {
    toggle.dataset.bound = "1";
    toggle.querySelectorAll(".controls-toggle-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        toggle.querySelectorAll(".controls-toggle-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
      });
    });
  }
}

/* ---------------- Reports quick actions row ---------------- */
const REPORTS_QUICK_ACTIONS = [
  { icon: "var(--icon-chart)", title: "Generate report", sub: "Download detailed reports", action: (app) => app.openReport("staffList") },
  { icon: "var(--icon-upload2)", title: "Export data", sub: "Export to CSV or Excel", action: () => document.getElementById("export-csv-btn")?.click() },
  { icon: "var(--icon-calendar)", title: "Schedule report", sub: "Automate & schedule", action: (app) => app.showToast("info", "Scheduled reports aren't set up yet — export a CSV for now.") },
  { icon: "var(--icon-info)", title: "Custom report", sub: "Create custom reports", action: (app) => app.showView("reports") },
  { icon: "var(--icon-bell)", title: "Share report", sub: "Share with team", action: (app) => app.showToast("info", "Sharing isn't wired up yet — export the CSV and send it on.") },
];

function initReportsQuickActions(app) {
  const grid = document.getElementById("reports-quick-actions-grid");
  if (!grid || grid.dataset.built) return;
  grid.dataset.built = "1";
  grid.innerHTML = REPORTS_QUICK_ACTIONS.map((a, idx) => `
    <button type="button" class="quick-action-card" data-action-idx="${idx}">
      <span class="quick-action-icon"><span class="icon-mask" style="--icon-url:${a.icon}" aria-hidden="true"></span></span>
      <span>
        <div class="quick-action-title">${escapeHtml(a.title)}</div>
        <div class="quick-action-sub">${escapeHtml(a.sub)}</div>
      </span>
      <span class="card-arrow icon-mask" aria-hidden="true"></span>
    </button>`).join("");
  grid.querySelectorAll(".quick-action-card").forEach((btn) => {
    btn.addEventListener("click", () => REPORTS_QUICK_ACTIONS[Number(btn.dataset.actionIdx)].action(app));
  });
}

/* ---------------- Entry point ---------------- */
function renderReportCharts() {
  const app = window.__dcApp;
  if (!app) return;
  // Each section is isolated: if one throws (e.g. unexpected data shape),
  // it's logged to the console and the rest of the page still renders,
  // instead of one bad section blanking out every panel below it.
  const steps = [
    ["reports chrome", () => initReportsChrome()],
    ["quick actions", () => initReportsQuickActions(app)],
    ["quarter chart", () => renderQuarterChart(app)],
    ["live feed", () => renderLiveFeed(app)],
    ["risk distribution / map", () => renderRiskDistribution(app)],
    ["demographics donut", () => renderDemographicsDonut(app)],
    ["missing doc chart", () => renderMissingDocChart(app)],
    ["recent reports", () => renderRecentReports(app)],
  ];
  steps.forEach(([label, fn]) => {
    try { fn(); }
    catch (err) { console.error(`[reports-charts] ${label} failed:`, err); }
  });
}

window.renderReportCharts = renderReportCharts;
// In case the Reports view is already on screen by the time this loads.
renderReportCharts();
