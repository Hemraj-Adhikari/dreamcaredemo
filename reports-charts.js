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

function renderRiskDistribution(app) {
  const el = document.getElementById("risk-distribution");
  if (!el) return;
  const { total, risk } = computeSponsoredRisk(app);
  if (!total) {
    el.innerHTML = `<p class="risk-empty">No sponsored workers on record yet.</p>`;
    return;
  }
  const pct = (n) => Math.round((n / total) * 100);
  el.innerHTML = `
    <div class="risk-bar">
      <span style="width:${pct(risk.low)}%;background:${RISK_COLORS.low}"></span>
      <span style="width:${pct(risk.medium)}%;background:${RISK_COLORS.medium}"></span>
      <span style="width:${pct(risk.high)}%;background:${RISK_COLORS.high}"></span>
    </div>
    <ul class="risk-legend">
      <li><span class="dot" style="background:${RISK_COLORS.low}"></span><span class="legend-label">Low risk — visa OK &gt;90 days</span><span class="legend-value">${risk.low} (${pct(risk.low)}%)</span></li>
      <li><span class="dot" style="background:${RISK_COLORS.medium}"></span><span class="legend-label">Medium risk — expiring ≤90 days</span><span class="legend-value">${risk.medium} (${pct(risk.medium)}%)</span></li>
      <li><span class="dot" style="background:${RISK_COLORS.high}"></span><span class="legend-label">High risk — expired</span><span class="legend-value">${risk.high} (${pct(risk.high)}%)</span></li>
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

function renderMissingDocChart(app) {
  const el = document.getElementById("missing-doc-chart");
  if (!el) return;
  const staff = app.employeesCache || [];
  const counts = Object.fromEntries(REQUIRED_DOC_TYPES.map((t) => [t, 0]));
  staff.forEach((e) => {
    const have = new Set((e.documents || []).map((d) => d.type));
    REQUIRED_DOC_TYPES.forEach((t) => { if (!have.has(t)) counts[t] += 1; });
  });
  const max = Math.max(1, ...Object.values(counts));
  if (!staff.length) {
    el.innerHTML = `<p class="risk-empty">No staff records yet.</p>`;
    return;
  }
  el.innerHTML = `<div class="doc-bars">${REQUIRED_DOC_TYPES.map((t) => {
    const n = counts[t];
    const pct = Math.max(n ? 4 : 0, (n / max) * 100);
    return `<div class="doc-bar-row">
      <span class="doc-bar-label">${escapeHtml(t)}</span>
      <span class="doc-bar-track"><span class="doc-bar-fill" style="width:${pct}%"></span></span>
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
  tbody.innerHTML = runs.map((r) => `
    <tr>
      <td>${r.date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</td>
      <td>${escapeHtml(r.title)}</td>
      <td><span class="pill ${r.needsAttention ? "bad" : "ok"}">${r.needsAttention ? "Needs attention" : "All OK"}</span></td>
    </tr>`).join("");
}

/* ---------------- Entry point ---------------- */
function renderReportCharts() {
  const app = window.__dcApp;
  if (!app) return;
  renderQuarterChart(app);
  renderLiveFeed(app);
  renderRiskDistribution(app);
  renderDemographicsDonut(app);
  renderMissingDocChart(app);
  renderRecentReports(app);
}

window.renderReportCharts = renderReportCharts;
// In case the Reports view is already on screen by the time this loads.
renderReportCharts();
