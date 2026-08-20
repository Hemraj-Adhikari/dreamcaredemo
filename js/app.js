import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import {
  getFirestore, collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import {
  getStorage, ref, uploadBytesResumable, getDownloadURL, deleteObject,
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-storage.js";
import { firebaseConfig } from "./firebase-config.js";

/* ---------------- Firebase ---------------- */
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const storage = getStorage(firebaseApp);
const employeesCol = collection(db, "employees");
const auditCol = collection(db, "auditLogs");

// Real Firebase Auth (email/password). Users are created in the Firebase
// Console → Authentication → Users tab; there's no self-signup here.
let currentUser = null;
let currentRole = "viewer";
let employeesCache = [];
let auditEntries = [];
let currentEmployeeId = null; // null = creating new
let currentView = "dashboard";
let activeReportType = null;
let unsubEmployees = null;
let unsubAudit = null;

const DAY = 86400000;
const todayStr = () => new Date().toISOString().slice(0, 10);
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const escapeHtml = (str) => String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------------- Toasts ---------------- */
const toastStack = document.getElementById("toast-stack");
const toastIcons = { success: "✓", error: "!", info: "i" };
function showToast(type, message, timeout = 3600) {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${toastIcons[type] || "i"}</span><span class="toast-msg"></span><button type="button" class="toast-close" aria-label="Dismiss">✕</button>`;
  el.querySelector(".toast-msg").textContent = message;
  const remove = () => {
    if (!el.isConnected) return;
    el.classList.add("leaving");
    el.addEventListener("animationend", () => el.remove(), { once: true });
  };
  el.querySelector(".toast-close").addEventListener("click", remove);
  toastStack.appendChild(el);
  if (timeout) setTimeout(remove, timeout);
  return remove;
}

/* ---------------- Confirm modal (replaces window.confirm) ---------------- */
const modalBackdrop = document.getElementById("modal-backdrop");
const modalCard = document.getElementById("modal-card");
function showConfirm({ title = "Are you sure?", body = "", confirmLabel = "Confirm", danger = true } = {}) {
  return new Promise((resolve) => {
    document.getElementById("modal-title").textContent = title;
    document.getElementById("modal-body").textContent = body;
    const confirmBtn = document.getElementById("modal-confirm");
    const cancelBtn = document.getElementById("modal-cancel");
    confirmBtn.textContent = confirmLabel;
    confirmBtn.className = danger ? "danger-btn" : "primary-btn";
    modalBackdrop.classList.remove("hidden", "leaving");

    const close = (result) => {
      modalBackdrop.classList.add("leaving");
      modalBackdrop.addEventListener("animationend", () => {
        modalBackdrop.classList.add("hidden");
        modalBackdrop.classList.remove("leaving");
      }, { once: true });
      confirmBtn.removeEventListener("click", onConfirm);
      cancelBtn.removeEventListener("click", onCancel);
      modalBackdrop.removeEventListener("click", onBackdrop);
      resolve(result);
    };
    const onConfirm = () => close(true);
    const onCancel = () => close(false);
    const onBackdrop = (e) => { if (e.target === modalBackdrop) close(false); };
    confirmBtn.addEventListener("click", onConfirm);
    cancelBtn.addEventListener("click", onCancel);
    modalBackdrop.addEventListener("click", onBackdrop);
    setTimeout(() => confirmBtn.focus(), 50);
  });
}

/* ---------------- Sync indicator ---------------- */
const syncIndicator = document.getElementById("sync-indicator");
const syncLabel = document.getElementById("sync-label");
let syncResetTimer = null;
function flashSync(label = "Saving…", doneLabel = "All changes saved") {
  clearTimeout(syncResetTimer);
  syncIndicator.classList.add("saving");
  syncLabel.textContent = label;
  syncResetTimer = setTimeout(() => {
    syncIndicator.classList.remove("saving");
    syncLabel.textContent = doneLabel;
  }, 550);
}

/* ---------------- Button ripple + micro-interactions ---------------- */
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".primary-btn, .secondary-btn, .danger-btn, .report-card, #logout-btn");
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  const ripple = document.createElement("span");
  const size = Math.max(rect.width, rect.height) * 1.2;
  ripple.className = "ripple";
  ripple.style.width = ripple.style.height = `${size}px`;
  ripple.style.left = `${e.clientX - rect.left - size / 2}px`;
  ripple.style.top = `${e.clientY - rect.top - size / 2}px`;
  btn.appendChild(ripple);
  ripple.addEventListener("animationend", () => ripple.remove());
});

/* ---------------- Count-up numbers ---------------- */
function animateCount(el, target, duration = 650) {
  const start = 0;
  const startTime = performance.now();
  function tick(now) {
    const progress = Math.min(1, (now - startTime) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(start + (target - start) * eased);
    if (progress < 1) requestAnimationFrame(tick);
    else el.textContent = target;
  }
  requestAnimationFrame(tick);
}

/* ---------------- Sliding nav indicator ---------------- */
const navIndicator = document.getElementById("nav-indicator");
function positionNavIndicator() {
  const active = document.querySelector(".nav-link.active");
  if (!active || !navIndicator) return;
  navIndicator.style.transform = `translateY(${active.offsetTop}px)`;
  navIndicator.style.height = `${active.offsetHeight}px`;
  navIndicator.classList.add("ready");
}
window.addEventListener("resize", positionNavIndicator);

/* ---------------- Sliding tab indicator ---------------- */
const tabIndicator = document.getElementById("tab-indicator");
function positionTabIndicator() {
  const active = document.querySelector(".tab-btn.active");
  if (!active || !tabIndicator) return;
  tabIndicator.style.left = `${active.offsetLeft}px`;
  tabIndicator.style.width = `${active.offsetWidth}px`;
}
window.addEventListener("resize", positionTabIndicator);

/* ---------------- Skeleton table helper ---------------- */
function renderSkeletonRows(tbody, cols, rows = 4) {
  tbody.innerHTML = "";
  for (let i = 0; i < rows; i++) {
    const tr = document.createElement("tr");
    tr.className = "skeleton-row";
    tr.innerHTML = Array.from({ length: cols }).map(() => `<td><div class="skeleton-line" style="width:${55 + Math.random() * 35}%"></div></td>`).join("");
    tbody.appendChild(tr);
  }
}

/* ---------------- Realtime data layer ---------------- */
function attachRealtimeListeners() {
  if (unsubEmployees) return Promise.resolve();
  return new Promise((resolve) => {
    let firstLoad = false;
    const settleFirstLoad = () => { if (!firstLoad) { firstLoad = true; resolve(); } };

    unsubEmployees = onSnapshot(employeesCol, (snap) => {
      employeesCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      refreshActiveView();
      settleFirstLoad();
    }, (err) => {
      console.error(err);
      showToast("error", "Lost the live connection to staff records — check Firestore rules and network.");
      settleFirstLoad();
    });

    const auditQuery = query(auditCol, orderBy("ts", "desc"));
    unsubAudit = onSnapshot(auditQuery, (snap) => {
      auditEntries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (currentView === "audit") renderAuditLog({ skeleton: false });
    }, (err) => console.error(err));
  });
}

function detachRealtimeListeners() {
  if (unsubEmployees) { unsubEmployees(); unsubEmployees = null; }
  if (unsubAudit) { unsubAudit(); unsubAudit = null; }
}

function refreshActiveView() {
  if (currentView === "dashboard") renderDashboard({ skeleton: false });
  else if (currentView === "employees") renderEmployeesTable({ skeleton: false });
  else if (currentView === "documents") renderAllDocumentsView({ skeleton: false });
  else if (currentView === "contacts") renderContactsView({ skeleton: false });
  else if (currentView === "reports") { renderReportsOverview(); if (activeReportType) runReport(activeReportType, { skeleton: false }); }
  else if (currentView === "employee-detail" && currentEmployeeId) {
    const emp = employeesCache.find((e) => e.id === currentEmployeeId);
    if (emp) { renderDocumentsTable(emp); renderTrainingTable(emp); }
  }
}

function updateEmployeeDoc(id, data) {
  flashSync("Saving…");
  return updateDoc(doc(db, "employees", id), data);
}
async function createEmployeeDoc(data) {
  flashSync("Saving…");
  const docRef = await addDoc(employeesCol, { ...data, documents: [], trainings: [], createdAt: new Date().toISOString() });
  return docRef.id;
}
function removeEmployeeDoc(id) {
  flashSync("Deleting…");
  return deleteDoc(doc(db, "employees", id));
}
async function removeStorageFile(path) {
  if (!path) return;
  try { await deleteObject(ref(storage, path)); } catch (err) { console.warn("Could not delete storage file", path, err); }
}

async function logAudit(action, employeeId, employeeName, details = "") {
  try {
    await addDoc(auditCol, {
      action, details,
      employeeId: employeeId || "",
      employeeName: employeeName || "",
      user: currentUser?.email || "unknown",
      ts: serverTimestamp(),
    });
    flashSync();
  } catch (err) {
    console.error("Could not write audit entry", err);
  }
}

/* ---------------- Auth (real Firebase email/password) ---------------- */
const authScreen = document.getElementById("auth-screen");
const appEl = document.getElementById("app");

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  const errEl = document.getElementById("login-error");
  const submitBtn = e.target.querySelector("button[type=submit]");
  errEl.textContent = "";
  errEl.style.animation = "none";

  submitBtn.classList.add("is-loading");

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    console.error(err);
    submitBtn.classList.remove("is-loading");
    void errEl.offsetWidth; // retrigger shake
    errEl.style.animation = "";
    errEl.textContent = "Invalid email or password.";
    return;
  }

  // onAuthStateChanged (below) handles showing the app once sign-in succeeds.
});

onAuthStateChanged(auth, async (user) => {
  const submitBtn = document.querySelector("#login-form button[type=submit]");
  if (user) {
    currentUser = user;
    currentRole = "admin";
    document.getElementById("current-user").textContent = user.email;
    document.getElementById("delete-employee-btn").classList.remove("hidden");

    try {
      await attachRealtimeListeners();
    } catch (err) {
      console.error(err);
    }

    authScreen.classList.add("hidden");
    appEl.classList.remove("hidden");
    if (submitBtn) submitBtn.classList.remove("is-loading");
    await showView("dashboard");
    positionNavIndicator();
    showToast("success", `Signed in as ${user.email}.`);
  } else {
    currentUser = null;
    detachRealtimeListeners();
    authScreen.classList.remove("hidden");
    appEl.classList.add("hidden");
    navIndicator.classList.remove("ready");
  }
});

document.getElementById("logout-btn").addEventListener("click", () => {
  signOut(auth).catch((err) => console.error(err));
});

/* ---------------- Navigation ---------------- */
document.querySelectorAll(".nav-link").forEach((btn) => {
  btn.addEventListener("click", () => showView(btn.dataset.view));
});

async function showView(name) {
  currentView = name;
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  const target = document.getElementById(`view-${name}`);
  // restart the entrance animation each time the view is shown
  target.classList.remove("hidden");
  target.style.animation = "none";
  void target.offsetWidth;
  target.style.animation = "";

  document.querySelectorAll(".nav-link").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  positionNavIndicator();

  if (name === "dashboard") await renderDashboard();
  if (name === "employees") await renderEmployeesTable();
  if (name === "audit") await renderAuditLog();
  if (name === "documents") await renderAllDocumentsView();
  if (name === "contacts") await renderContactsView();
  if (name === "reports") {
    document.getElementById("report-title").textContent = "Select a report";
    document.getElementById("report-table").innerHTML = "";
    document.getElementById("export-csv-btn").classList.add("hidden");
    document.querySelectorAll(".report-card").forEach((c) => c.classList.remove("active"));
    activeReportType = null;
    renderReportsOverview();
  }
}

document.getElementById("back-to-employees").addEventListener("click", () => showView("employees"));

/* ---------------- Shared helpers ---------------- */
function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.round((new Date(dateStr) - new Date(todayStr())) / DAY);
}

function statusPill(days) {
  if (days === null) return `<span class="pill neutral">Not set</span>`;
  if (days < 0) return `<span class="pill danger">Expired</span>`;
  if (days <= 90) return `<span class="pill warn">${days}d left</span>`;
  return `<span class="pill ok">OK</span>`;
}

/* ---------------- Dashboard ---------------- */
function collectExpiryItems() {
  const items = [];
  employeesCache.forEach((e) => {
    const checks = [
      ["Right to Work re-check", e.rtwExpiry],
      ["Visa / sponsorship", e.visaExpiry],
      ["Enhanced DBS", e.dbsExpiry],
    ];
    checks.forEach(([label, date]) => {
      if (date) items.push({ name: e.fullName || "(unnamed)", id: e.id, item: label, date, days: daysUntil(date) });
    });
    (e.documents || []).forEach((doc_) => {
      if (doc_.expiry) items.push({ name: e.fullName || "(unnamed)", id: e.id, item: `Document — ${doc_.type}`, date: doc_.expiry, days: daysUntil(doc_.expiry) });
    });
    (e.trainings || []).forEach((t) => {
      if (t.expiry) items.push({ name: e.fullName || "(unnamed)", id: e.id, item: `Training — ${t.name}`, date: t.expiry, days: daysUntil(t.expiry) });
    });
  });
  return items.filter((i) => i.days !== null && i.days <= 90).sort((a, b) => a.days - b.days);
}

// All tracked compliance items regardless of how far away their expiry is —
// used to build the "Compliance overview" donut (up to date / expiring soon / overdue).
function collectAllTrackedItems() {
  const items = [];
  employeesCache.forEach((e) => {
    [["Right to Work re-check", e.rtwExpiry], ["Visa / sponsorship", e.visaExpiry], ["Enhanced DBS", e.dbsExpiry]]
      .forEach(([label, date]) => { if (date) items.push({ name: e.fullName || "(unnamed)", id: e.id, item: label, date, days: daysUntil(date) }); });
    (e.documents || []).forEach((doc_) => { if (doc_.expiry) items.push({ name: e.fullName || "(unnamed)", id: e.id, item: `Document — ${doc_.type}`, date: doc_.expiry, days: daysUntil(doc_.expiry) }); });
    (e.trainings || []).forEach((t) => { if (t.expiry) items.push({ name: e.fullName || "(unnamed)", id: e.id, item: `Training — ${t.name}`, date: t.expiry, days: daysUntil(t.expiry) }); });
  });
  return items;
}

const DASHBOARD_QUICK_ACTIONS = [
  { icon: "var(--icon-plus)", title: "Add new staff", sub: "Create a staff record", action: () => openEmployee(null) },
  { icon: "var(--icon-upload2)", title: "Upload document", sub: "Add staff documents", action: () => showView("documents") },
  { icon: "var(--icon-chart)", title: "Generate report", sub: "Download reports", action: () => showView("reports") },
  { icon: "var(--icon-phone)", title: "Contact staff", sub: "Send message or call", action: () => showView("contacts") },
];

function initDashboardChrome() {
  const dateEl = document.getElementById("dashboard-date");
  if (dateEl) dateEl.textContent = new Date().toLocaleDateString("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const grid = document.getElementById("quick-actions-grid");
  if (grid && !grid.dataset.built) {
    grid.dataset.built = "1";
    grid.innerHTML = DASHBOARD_QUICK_ACTIONS.map((a, idx) => `
      <button type="button" class="quick-action-card" data-action-idx="${idx}">
        <span class="quick-action-icon"><span class="icon-mask" style="--icon-url:${a.icon}" aria-hidden="true"></span></span>
        <span>
          <div class="quick-action-title">${escapeHtml(a.title)}</div>
          <div class="quick-action-sub">${escapeHtml(a.sub)}</div>
        </span>
        <span class="card-arrow icon-mask" aria-hidden="true"></span>
      </button>`).join("");
    grid.querySelectorAll(".quick-action-card").forEach((btn) => {
      btn.addEventListener("click", () => DASHBOARD_QUICK_ACTIONS[Number(btn.dataset.actionIdx)].action());
    });
  }

  const exportBtn = document.getElementById("dashboard-export-btn");
  if (exportBtn && !exportBtn.dataset.bound) {
    exportBtn.dataset.bound = "1";
    exportBtn.addEventListener("click", () => showView("reports"));
  }
  const viewAllBtn = document.getElementById("view-all-expiring");
  if (viewAllBtn && !viewAllBtn.dataset.bound) {
    viewAllBtn.dataset.bound = "1";
    viewAllBtn.addEventListener("click", () => showView("employees"));
  }
  const manageBtn = document.getElementById("manage-staff-btn");
  if (manageBtn && !manageBtn.dataset.bound) {
    manageBtn.dataset.bound = "1";
    manageBtn.addEventListener("click", () => showView("employees"));
  }
  const bellBtn = document.getElementById("dashboard-bell-btn");
  if (bellBtn && !bellBtn.dataset.bound) {
    bellBtn.dataset.bound = "1";
    bellBtn.addEventListener("click", () => showView("employees"));
  }
}

function updateDashboardIdentity() {
  const email = currentUser?.email || "";
  const namePart = email.split("@")[0] || "there";
  const niceName = namePart.replace(/[._]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const welcomeEl = document.getElementById("dashboard-welcome");
  if (welcomeEl) welcomeEl.textContent = `Welcome back, ${niceName || "there"} 👋`;
  const initials = (namePart.match(/[a-zA-Z]/g) || ["?"]).slice(0, 2).join("").toUpperCase() || "?";
  const avatarEl = document.getElementById("dashboard-avatar");
  if (avatarEl) avatarEl.textContent = initials.length === 1 ? initials : initials.slice(0, 2);
}

const DONUT_SEGMENTS = [
  { key: "upToDate", label: "Up to date", color: "var(--sage)" },
  { key: "expiringSoon", label: "Expiring soon", color: "var(--amber)" },
  { key: "overdue", label: "Overdue", color: "var(--danger)" },
];

function renderComplianceOverview() {
  const allItems = collectAllTrackedItems();
  const counts = { upToDate: 0, expiringSoon: 0, overdue: 0 };
  allItems.forEach((i) => {
    if (i.days < 0) counts.overdue += 1;
    else if (i.days <= 90) counts.expiringSoon += 1;
    else counts.upToDate += 1;
  });
  const total = allItems.length;

  document.getElementById("donut-total").textContent = total;
  const donut = document.getElementById("compliance-donut");
  let acc = 0;
  const stops = DONUT_SEGMENTS.map((seg) => {
    const pct = total ? (counts[seg.key] / total) * 100 : 0;
    const from = acc;
    acc += pct;
    return `${seg.color} ${from}% ${acc}%`;
  }).join(", ");
  donut.style.background = total
    ? `conic-gradient(${stops})`
    : "conic-gradient(var(--line-soft) 0 100%)";

  document.getElementById("donut-legend").innerHTML = DONUT_SEGMENTS.map((seg) => {
    const count = counts[seg.key];
    const pct = total ? Math.round((count / total) * 100) : 0;
    return `<li><span class="dot" style="background:${seg.color}"></span><span class="legend-label">${seg.label}</span><span class="legend-value">${count} (${pct}%)</span></li>`;
  }).join("");

  const health = total ? Math.round(((counts.upToDate + counts.expiringSoon * 0.5) / total) * 100) : 100;
  document.getElementById("health-pct").textContent = `${health}%`;
  document.getElementById("health-ring").style.background = `conic-gradient(var(--sage) 0 ${health}%, var(--line-soft) ${health}% 100%)`;
  const note = document.getElementById("compliance-health-note");
  if (note) {
    note.textContent = counts.overdue > 0
      ? "Keep it up! Review overdue items."
      : counts.expiringSoon > 0
        ? "Looking good — a few renewals coming up."
        : "All tracked items are up to date.";
  }

  const overdueBadge = document.getElementById("notif-badge");
  if (overdueBadge) {
    overdueBadge.textContent = counts.overdue;
    overdueBadge.classList.toggle("hidden", counts.overdue === 0);
  }
}

async function renderDashboard({ skeleton = true } = {}) {
  initDashboardChrome();
  updateDashboardIdentity();

  const tbody = document.querySelector("#expiry-table tbody");
  document.getElementById("expiry-empty").classList.add("hidden");
  if (skeleton) {
    renderSkeletonRows(tbody, 4, 3);
    document.getElementById("stat-grid").innerHTML = ["", "", "warn", "danger"]
      .map((cls) => `<div class="stat-card ${cls}"><div class="num"><div class="skeleton-line" style="width:40px;height:24px"></div></div><div class="label">&nbsp;</div></div>`).join("");
    await wait(280); // gives the skeleton a moment to be visible
  }

  const total = employeesCache.length;
  const sponsored = employeesCache.filter((e) => e.cosNumber).length;
  const expiring = collectExpiryItems();
  const overdue = expiring.filter((i) => i.days < 0).length;

  const STAT_CARDS = [
    { cls: "", icon: "var(--icon-people)", target: total, label: "Total staff records", sub: "All active staff", nav: () => showView("employees") },
    { cls: "", icon: "var(--icon-idcard)", target: sponsored, label: "Sponsored workers", sub: "Currently sponsored", nav: () => openReport("sponsored") },
    { cls: "warn", icon: "var(--icon-clock)", target: expiring.length, label: "Expiring within 90 days", sub: "Action required", nav: () => openReport("visa90") },
    { cls: "danger", icon: "var(--icon-alert)", target: overdue, label: "Already overdue", sub: "Immediate attention", nav: () => openReport("visa90") },
  ];
  document.getElementById("stat-grid").innerHTML = STAT_CARDS.map((c) => `
    <div class="stat-card clickable ${c.cls}" role="button" tabindex="0">
      <div class="stat-card-top">
        <span class="stat-icon"><span class="icon-mask" style="--icon-url:${c.icon}" aria-hidden="true"></span></span>
        <span class="trend-badge"><span class="icon-mask" aria-hidden="true"></span></span>
      </div>
      <div class="num" data-target="${c.target}">0</div>
      <div class="label">${c.label}</div>
      <div class="sublabel">${c.sub}</div>
    </div>`).join("");
  document.querySelectorAll("#stat-grid .num").forEach((el) => animateCount(el, Number(el.dataset.target)));
  document.querySelectorAll("#stat-grid .stat-card").forEach((card, idx) => {
    card.addEventListener("click", () => STAT_CARDS[idx].nav());
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); STAT_CARDS[idx].nav(); }
    });
  });

  renderComplianceOverview();

  tbody.innerHTML = "";
  document.getElementById("expiry-empty").classList.toggle("hidden", expiring.length > 0);
  expiring.forEach((i, idx) => {
    const tr = document.createElement("tr");
    tr.style.animationDelay = `${idx * 25}ms`;
    tr.innerHTML = `<td><a class="row-link" data-id="${i.id}">${escapeHtml(i.name)}</a></td><td>${escapeHtml(i.item)}</td><td>${i.date}</td><td>${statusPill(i.days)}</td>`;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll(".row-link").forEach((a) => a.addEventListener("click", () => openEmployee(a.dataset.id)));
}

/* ---------------- Employees list ---------------- */
let searchDebounce = null;
document.getElementById("employee-search").addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => renderEmployeesTable({ skeleton: false }), 150);
});
document.getElementById("add-employee-btn").addEventListener("click", () => openEmployee(null));

async function renderEmployeesTable({ skeleton = true } = {}) {
  const tbody = document.querySelector("#employees-table tbody");
  if (skeleton) {
    renderSkeletonRows(tbody, 6, Math.min(4, Math.max(2, employeesCache.length)));
    await wait(200);
  }
  const q = (document.getElementById("employee-search").value || "").toLowerCase();
  tbody.innerHTML = "";
  const filtered = employeesCache
    .filter((e) => !q || [e.fullName, e.department, e.employeeId].some((v) => (v || "").toLowerCase().includes(q)))
    .sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-note">${q ? "No staff match that search." : "No staff records yet — add your first one above."}</td></tr>`;
    return;
  }

  filtered.forEach((e, idx) => {
    const rtwDays = daysUntil(e.rtwExpiry);
    const visaDays = daysUntil(e.visaExpiry);
    const tr = document.createElement("tr");
    tr.style.animationDelay = `${idx * 25}ms`;
    tr.innerHTML = `
      <td><a class="row-link" data-id="${e.id}">${escapeHtml(e.fullName || "(unnamed)")}</a></td>
      <td>${escapeHtml(e.department || "—")}</td>
      <td>${escapeHtml(e.jobTitle || "—")}</td>
      <td>${statusPill(rtwDays)}</td>
      <td>${e.visaExpiry ? `${e.visaExpiry} ${statusPill(visaDays)}` : "—"}</td>
      <td></td>`;
    tbody.appendChild(tr);
    tr.querySelector(".row-link").addEventListener("click", () => openEmployee(e.id));
  });
}

/* ---------------- Employee detail / form ---------------- */
const employeeForm = document.getElementById("employee-form");
const tabButtons = document.querySelectorAll(".tab-btn");
const tabOrder = Array.from(tabButtons).map((b) => b.dataset.tab);

function goToTab(tabName) {
  tabButtons.forEach((b) => b.classList.toggle("active", b.dataset.tab === tabName));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("hidden", p.dataset.tab !== tabName));
  positionTabIndicator();
}

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => goToTab(btn.dataset.tab));
});

function openEmployee(id) {
  currentEmployeeId = id;
  employeeForm.reset();
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
  document.querySelector('.tab-panel[data-tab="basic"]').classList.remove("hidden");
  tabButtons.forEach((b) => b.classList.toggle("active", b.dataset.tab === "basic"));
  requestAnimationFrame(positionTabIndicator);
  document.getElementById("save-status").textContent = "";

  const emp = id ? employeesCache.find((e) => e.id === id) : null;
  document.getElementById("employee-detail-name").textContent = emp ? (emp.fullName || "(unnamed)") : "New staff member";
  document.getElementById("delete-employee-btn").classList.toggle("hidden", !(id && currentRole === "admin"));

  const avatarEl = document.getElementById("detail-avatar");
  const metaEl = document.getElementById("employee-detail-meta");
  const statusEl = document.getElementById("employee-detail-status");
  if (emp) {
    const initials = (emp.fullName || "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "?";
    avatarEl.textContent = initials;
    metaEl.textContent = [emp.employeeId && `ID ${emp.employeeId}`, emp.jobTitle, emp.department].filter(Boolean).join(" · ") || "No details added yet";
    const statusMap = { active: ["ok", "Active"], probation: ["warn", "On probation"], leaver: ["danger", "Leaver"] };
    const [cls, label] = statusMap[emp.status] || ["neutral", "Active"];
    statusEl.className = `pill ${cls}`;
    statusEl.textContent = label;
    statusEl.classList.remove("hidden");
  } else {
    avatarEl.textContent = "＋";
    metaEl.textContent = "Fill in the profile to create a staff record";
    statusEl.classList.add("hidden");
  }

  if (emp) {
    Object.entries(emp).forEach(([key, val]) => {
      const field = employeeForm.elements[key];
      if (field && typeof val !== "object") field.value = val;
    });
  }
  renderDocumentsTable(emp);
  renderTrainingTable(emp);
  showView("employee-detail");
}

async function persistEmployeeForm({ silent = false } = {}) {
  const statusEl = document.getElementById("save-status");
  statusEl.classList.remove("is-error");
  statusEl.innerHTML = "Saving…";
  const formData = new FormData(employeeForm);
  const data = {};
  for (const [key, val] of formData.entries()) data[key] = val;

  if (!employeeForm.reportValidity()) {
    statusEl.textContent = "";
    return false;
  }

  try {
    const isNew = !currentEmployeeId;
    if (currentEmployeeId) {
      await updateEmployeeDoc(currentEmployeeId, data);
      const idx = employeesCache.findIndex((e) => e.id === currentEmployeeId);
      if (idx !== -1) employeesCache[idx] = { ...employeesCache[idx], ...data };
      await logAudit("Updated staff record", currentEmployeeId, data.fullName);
    } else {
      currentEmployeeId = await createEmployeeDoc(data);
      employeesCache.push({ id: currentEmployeeId, ...data, documents: [], trainings: [], createdAt: new Date().toISOString() });
      await logAudit("Created staff record", currentEmployeeId, data.fullName);
    }
    statusEl.innerHTML = `<span class="status-check">✓</span> Saved`;
    document.getElementById("employee-detail-name").textContent = data.fullName || "(unnamed)";
    document.getElementById("delete-employee-btn").classList.toggle("hidden", currentRole !== "admin");
    const initials = (data.fullName || "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "?";
    document.getElementById("detail-avatar").textContent = initials;
    document.getElementById("employee-detail-meta").textContent = [data.employeeId && `ID ${data.employeeId}`, data.jobTitle, data.department].filter(Boolean).join(" · ") || "No details added yet";
    const statusMap = { active: ["ok", "Active"], probation: ["warn", "On probation"], leaver: ["danger", "Leaver"] };
    const [cls, label] = statusMap[data.status] || ["neutral", "Active"];
    const statusPillEl = document.getElementById("employee-detail-status");
    statusPillEl.className = `pill ${cls}`;
    statusPillEl.textContent = label;
    statusPillEl.classList.remove("hidden");
    if (!silent) showToast("success", isNew ? `${data.fullName || "Staff member"} added.` : `${data.fullName || "Staff record"} updated.`);
    return true;
  } catch (err) {
    console.error(err);
    statusEl.classList.add("is-error");
    statusEl.textContent = "Could not save — check your connection and Firestore rules.";
    showToast("error", "Could not save the staff record.");
    return false;
  }
}

employeeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const submitBtn = employeeForm.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  await persistEmployeeForm();
  if (submitBtn) submitBtn.disabled = false;
});

document.getElementById("save-next-btn").addEventListener("click", async () => {
  const btn = document.getElementById("save-next-btn");
  btn.disabled = true;
  const ok = await persistEmployeeForm({ silent: true });
  btn.disabled = false;
  if (!ok) return;
  const activeTab = document.querySelector(".tab-btn.active")?.dataset.tab || "basic";
  const nextIdx = (tabOrder.indexOf(activeTab) + 1) % tabOrder.length;
  goToTab(tabOrder[nextIdx]);
  const nextLabel = document.querySelector(`.tab-btn[data-tab="${tabOrder[nextIdx]}"]`)?.textContent || "next section";
  showToast("success", `Saved — now on ${nextLabel}.`, 2200);
});

document.getElementById("delete-employee-btn").addEventListener("click", async () => {
  if (!currentEmployeeId) return;
  const name = employeeForm.elements.fullName.value;
  const ok = await showConfirm({
    title: "Delete this staff record?",
    body: `${name || "This staff member"}'s profile, documents and training history will be permanently removed. This cannot be undone.`,
    confirmLabel: "Delete record",
  });
  if (!ok) return;
  flashSync("Deleting…");
  const emp = employeesCache.find((e) => e.id === currentEmployeeId);
  try {
    for (const d of emp?.documents || []) {
      await removeStorageFile(d.storagePath); // best-effort cleanup, doesn't block the delete
    }
    await removeEmployeeDoc(currentEmployeeId);
    employeesCache = employeesCache.filter((e) => e.id !== currentEmployeeId);
    await logAudit("Deleted staff record", currentEmployeeId, name);
    showToast("success", `${name || "Staff record"} deleted.`);
    await showView("employees");
  } catch (err) {
    console.error(err);
    showToast("error", "Could not delete the staff record.");
  }
});

/* ---------------- Documents tab (per staff member) ---------------- */
function renderDocumentsTable(emp) {
  const tbody = document.querySelector("#documents-table tbody");
  tbody.innerHTML = "";
  if (!(emp?.documents || []).length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-note">No documents uploaded yet.</td></tr>`;
    return;
  }
  (emp?.documents || []).forEach((d, idx) => {
    const tr = document.createElement("tr");
    tr.style.animationDelay = `${idx * 25}ms`;
    tr.innerHTML = `<td>${escapeHtml(d.type)}</td><td><a href="${d.url}" target="_blank" rel="noopener">${escapeHtml(d.fileName)}</a></td><td>${d.expiry ? `${d.expiry} ${statusPill(daysUntil(d.expiry))}` : "—"}</td><td>${d.uploadedAt || "—"}</td><td><button type="button" class="secondary-btn" data-idx="${idx}">Remove</button></td>`;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll("button[data-idx]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = btn.closest("tr");
      const emp2 = employeesCache.find((e) => e.id === currentEmployeeId);
      const docs = [...(emp2.documents || [])];
      const [removed] = docs.splice(Number(btn.dataset.idx), 1);
      row.classList.add("row-exit");
      await new Promise((res) => row.addEventListener("animationend", res, { once: true }));
      try {
        await removeStorageFile(removed.storagePath);
        await updateEmployeeDoc(currentEmployeeId, { documents: docs });
        emp2.documents = docs;
        await logAudit("Removed document", currentEmployeeId, `${removed.type} — ${removed.fileName}`);
        renderDocumentsTable(employeesCache.find((e) => e.id === currentEmployeeId));
        showToast("info", `${removed.type} removed.`);
      } catch (err) {
        console.error(err);
        showToast("error", "Could not remove the document.");
      }
    });
  });
}

document.getElementById("doc-upload-btn").addEventListener("click", () => {
  if (!currentEmployeeId) { showToast("error", "Save the staff record before uploading documents."); return; }
  const file = document.getElementById("doc-file-input").files[0];
  if (!file) { showToast("error", "Choose a file first."); return; }
  const type = document.getElementById("doc-type-select").value;
  const expiry = document.getElementById("doc-expiry-input").value;
  const uploadBtn = document.getElementById("doc-upload-btn");
  const progressWrap = document.getElementById("upload-progress");
  const progressBar = document.getElementById("upload-progress-bar");

  uploadBtn.disabled = true;
  progressWrap.classList.remove("hidden");
  progressBar.style.width = "0%";

  const storagePath = `documents/${currentEmployeeId}/${Date.now()}_${file.name}`;
  const fileRef = ref(storage, storagePath);
  const task = uploadBytesResumable(fileRef, file);

  task.on("state_changed", (snap) => {
    const pct = snap.totalBytes ? Math.round((snap.bytesTransferred / snap.totalBytes) * 100) : 0;
    progressBar.style.width = `${pct}%`;
  }, (err) => {
    console.error(err);
    progressWrap.classList.add("hidden");
    uploadBtn.disabled = false;
    showToast("error", "Upload failed — check your Storage rules and network.");
  }, async () => {
    try {
      const url = await getDownloadURL(fileRef);
      const emp = employeesCache.find((e) => e.id === currentEmployeeId);
      const docs = [...(emp?.documents || []), { type, fileName: file.name, url, storagePath, expiry, uploadedAt: todayStr(), uploadedBy: currentUser.email }];
      await updateEmployeeDoc(currentEmployeeId, { documents: docs });
      if (emp) emp.documents = docs;
      await logAudit("Uploaded document", currentEmployeeId, `${type} — ${file.name}`);
      renderDocumentsTable(employeesCache.find((e) => e.id === currentEmployeeId));
      document.getElementById("doc-file-input").value = "";
      document.getElementById("doc-expiry-input").value = "";
      progressWrap.classList.add("hidden");
      uploadBtn.disabled = false;
      showToast("success", `${file.name} uploaded.`);
    } catch (err) {
      console.error(err);
      progressWrap.classList.add("hidden");
      uploadBtn.disabled = false;
      showToast("error", "Uploaded the file but could not save its details. Please retry.");
    }
  });
});

/* ---------------- Training tab ---------------- */
function renderTrainingTable(emp) {
  const tbody = document.querySelector("#training-table tbody");
  tbody.innerHTML = "";
  if (!(emp?.trainings || []).length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-note">No training records yet.</td></tr>`;
    return;
  }
  (emp?.trainings || []).forEach((t, idx) => {
    const tr = document.createElement("tr");
    tr.style.animationDelay = `${idx * 25}ms`;
    tr.innerHTML = `<td>${escapeHtml(t.name)}</td><td>${t.date || "—"}</td><td>${t.expiry ? `${t.expiry} ${statusPill(daysUntil(t.expiry))}` : "—"}</td><td><button type="button" class="secondary-btn" data-idx="${idx}">Remove</button></td>`;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll("button[data-idx]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = btn.closest("tr");
      const emp2 = employeesCache.find((e) => e.id === currentEmployeeId);
      const trainings = [...(emp2.trainings || [])];
      const [removed] = trainings.splice(Number(btn.dataset.idx), 1);
      row.classList.add("row-exit");
      await new Promise((res) => row.addEventListener("animationend", res, { once: true }));
      try {
        await updateEmployeeDoc(currentEmployeeId, { trainings });
        emp2.trainings = trainings;
        renderTrainingTable(employeesCache.find((e) => e.id === currentEmployeeId));
        showToast("info", `${removed?.name || "Training record"} removed.`);
      } catch (err) {
        console.error(err);
        showToast("error", "Could not remove the training record.");
      }
    });
  });
}

document.getElementById("training-add-btn").addEventListener("click", async () => {
  if (!currentEmployeeId) { showToast("error", "Save the staff record before adding training records."); return; }
  const name = document.getElementById("training-name-input").value.trim();
  if (!name) { showToast("error", "Enter a training name."); return; }
  const date = document.getElementById("training-date-input").value;
  const expiry = document.getElementById("training-expiry-input").value;
  const emp = employeesCache.find((e) => e.id === currentEmployeeId);
  const trainings = [...(emp.trainings || []), { name, date, expiry }];
  try {
    await updateEmployeeDoc(currentEmployeeId, { trainings });
    emp.trainings = trainings;
    await logAudit("Added training record", currentEmployeeId, name);
    renderTrainingTable(emp);
    document.getElementById("training-name-input").value = "";
    document.getElementById("training-date-input").value = "";
    document.getElementById("training-expiry-input").value = "";
    showToast("success", `${name} added.`);
  } catch (err) {
    console.error(err);
    showToast("error", "Could not save the training record.");
  }
});

/* ---------------- Staff documents (all staff, live) ---------------- */
let docsSearchDebounce = null;
document.getElementById("documents-search").addEventListener("input", () => {
  clearTimeout(docsSearchDebounce);
  docsSearchDebounce = setTimeout(() => renderAllDocumentsView({ skeleton: false }), 150);
});

async function renderAllDocumentsView({ skeleton = true } = {}) {
  const tbody = document.querySelector("#all-documents-table tbody");
  if (skeleton) { renderSkeletonRows(tbody, 6, 4); await wait(200); }

  const q = (document.getElementById("documents-search").value || "").toLowerCase();
  const rows = [];
  employeesCache.forEach((e) => {
    (e.documents || []).forEach((d, idx) => rows.push({ empId: e.id, empName: e.fullName || "(unnamed)", idx, ...d }));
  });
  const filtered = rows
    .filter((r) => !q || [r.empName, r.type, r.fileName].some((v) => (v || "").toLowerCase().includes(q)))
    .sort((a, b) => (b.uploadedAt || "").localeCompare(a.uploadedAt || ""));

  tbody.innerHTML = "";
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-note">${q ? "No documents match that search." : "No documents uploaded yet across any staff record."}</td></tr>`;
    return;
  }
  filtered.forEach((d, i) => {
    const tr = document.createElement("tr");
    tr.style.animationDelay = `${i * 20}ms`;
    tr.innerHTML = `
      <td><a class="row-link" data-id="${d.empId}">${escapeHtml(d.empName)}</a></td>
      <td>${escapeHtml(d.type || "—")}</td>
      <td><a href="${d.url}" target="_blank" rel="noopener">${escapeHtml(d.fileName || "file")}</a></td>
      <td>${d.expiry ? `${d.expiry} ${statusPill(daysUntil(d.expiry))}` : "—"}</td>
      <td>${d.uploadedAt || "—"}</td>
      <td><button type="button" class="secondary-btn" data-emp="${d.empId}" data-idx="${d.idx}">Remove</button></td>`;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll(".row-link").forEach((a) => a.addEventListener("click", () => openEmployee(a.dataset.id)));
  tbody.querySelectorAll("button[data-emp]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const empId = btn.dataset.emp;
      const idx = Number(btn.dataset.idx);
      const emp = employeesCache.find((e) => e.id === empId);
      if (!emp) return;
      const docs = [...(emp.documents || [])];
      const [removed] = docs.splice(idx, 1);
      try {
        await removeStorageFile(removed?.storagePath);
        await updateEmployeeDoc(empId, { documents: docs });
        emp.documents = docs;
        await logAudit("Removed document", empId, `${removed?.type || ""} — ${removed?.fileName || ""}`);
        showToast("info", `${removed?.type || "Document"} removed.`);
        renderAllDocumentsView({ skeleton: false });
        if (currentEmployeeId === empId) renderDocumentsTable(emp);
      } catch (err) {
        console.error(err);
        showToast("error", "Could not remove the document.");
      }
    });
  });
}

/* ---------------- Contact staff ---------------- */
function toWhatsAppNumber(phone) {
  if (!phone) return null;
  let digits = phone.replace(/[^\d+]/g, "");
  if (!digits) return null;
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = `44${digits.slice(1)}`; // default to UK if a local-format number was entered
  return digits;
}

function contactCardHtml(e) {
  const initials = (e.fullName || "?").trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "?";
  const phone = (e.phone || "").trim();
  const email = (e.email || "").trim();
  const waNumber = toWhatsAppNumber(phone);
  const meta = [e.jobTitle, e.department].filter(Boolean).join(" · ") || "—";
  return `
    <div class="contact-card">
      <div class="contact-card-head">
        <div class="contact-avatar">${initials}</div>
        <div>
          <div class="contact-name">${escapeHtml(e.fullName || "(unnamed)")}</div>
          <div class="contact-meta">${escapeHtml(meta)}</div>
        </div>
      </div>
      <div class="contact-detail-row ${phone ? "" : "empty"}"><span class="contact-icon">📞</span>${phone ? escapeHtml(phone) : "No phone on file"}</div>
      <div class="contact-detail-row ${email ? "" : "empty"}"><span class="contact-icon">✉</span>${email ? escapeHtml(email) : "No email on file"}</div>
      <div class="contact-actions">
        <a class="call ${phone ? "" : "disabled"}" ${phone ? `href="tel:${encodeURIComponent(phone.replace(/\s+/g, ""))}"` : 'href="#" tabindex="-1" aria-disabled="true"'}>Call</a>
        <a class="email ${email ? "" : "disabled"}" ${email ? `href="mailto:${encodeURIComponent(email)}"` : 'href="#" tabindex="-1" aria-disabled="true"'}>Email</a>
        <a class="whatsapp ${waNumber ? "" : "disabled"}" target="_blank" rel="noopener" ${waNumber ? `href="https://wa.me/${waNumber}"` : 'href="#" tabindex="-1" aria-disabled="true"'}>WhatsApp</a>
      </div>
    </div>`;
}

let contactsSearchDebounce = null;
document.getElementById("contacts-search").addEventListener("input", () => {
  clearTimeout(contactsSearchDebounce);
  contactsSearchDebounce = setTimeout(() => renderContactsView({ skeleton: false }), 150);
});

async function renderContactsView({ skeleton = true } = {}) {
  const grid = document.getElementById("contact-grid");
  const emptyEl = document.getElementById("contacts-empty");
  if (skeleton) {
    grid.innerHTML = Array.from({ length: 3 }).map(() => `<div class="contact-card"><div class="skeleton-line" style="width:60%;height:16px"></div><div class="skeleton-line" style="width:40%"></div><div class="skeleton-line" style="width:50%"></div></div>`).join("");
    await wait(180);
  }
  const q = (document.getElementById("contacts-search").value || "").toLowerCase();
  const filtered = employeesCache
    .filter((e) => !q || [e.fullName, e.department, e.jobTitle].some((v) => (v || "").toLowerCase().includes(q)))
    .sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));

  emptyEl.classList.toggle("hidden", employeesCache.length > 0);
  if (!filtered.length) {
    grid.innerHTML = q ? `<p class="empty-note">No staff match that search.</p>` : "";
    return;
  }
  grid.innerHTML = filtered.map(contactCardHtml).join("");
}

/* ---------------- Audit log ---------------- */
async function renderAuditLog({ skeleton = true } = {}) {
  const tbody = document.querySelector("#audit-table tbody");
  if (skeleton) { renderSkeletonRows(tbody, 5, 4); await wait(150); }
  tbody.innerHTML = "";
  auditEntries.forEach((a, idx) => {
    const tr = document.createElement("tr");
    tr.style.animationDelay = `${idx * 20}ms`;
    const when = a.ts?.toDate ? a.ts.toDate().toLocaleString() : "Just now";
    tr.innerHTML = `<td>${when}</td><td>${escapeHtml(a.user)}</td><td>${escapeHtml(a.action)}</td><td>${escapeHtml(a.employeeName || "—")}</td><td>${escapeHtml(a.details || "")}</td>`;
    tbody.appendChild(tr);
  });
  if (!auditEntries.length) tbody.innerHTML = `<tr><td colspan="5" class="empty-note">No audit entries yet — actions you take will show up here.</td></tr>`;
}

/* ---------------- Reports (live) ---------------- */
document.querySelectorAll(".report-card").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".report-card").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    activeReportType = btn.dataset.report;
    runReport(activeReportType);
  });
});

let currentReportRows = [];
let currentReportHeaders = [];

const REPORT_TYPES = ["visa90", "missingDocs", "sponsored", "rtwStatus", "staffList"];

function buildReport(type) {
  const builders = {
    visa90: () => ({
      title: "Visa expiry within 90 days",
      headers: ["Name", "Department", "Visa type", "Visa expiry", "Days left"],
      rows: employeesCache.filter((e) => e.visaExpiry && daysUntil(e.visaExpiry) <= 90)
        .sort((a, b) => daysUntil(a.visaExpiry) - daysUntil(b.visaExpiry))
        .map((e) => [e.fullName, e.department, e.visaType, e.visaExpiry, daysUntil(e.visaExpiry)]),
    }),
    missingDocs: () => {
      const required = ["Passport", "Employment contract", "DBS certificate", "Proof of address"];
      const rows = [];
      employeesCache.forEach((e) => {
        const have = new Set((e.documents || []).map((d) => d.type));
        const missing = required.filter((r) => !have.has(r));
        if (missing.length) rows.push([e.fullName, e.department, missing.join(", ")]);
      });
      return { title: "Missing documents", headers: ["Name", "Department", "Missing"], rows };
    },
    sponsored: () => ({
      title: "Sponsored workers",
      headers: ["Name", "CoS number", "Visa type", "Visa expiry", "SOC code", "Salary"],
      rows: employeesCache.filter((e) => e.cosNumber).map((e) => [e.fullName, e.cosNumber, e.visaType, e.visaExpiry, e.socCode, e.salary]),
    }),
    rtwStatus: () => ({
      title: "Right to Work status",
      headers: ["Name", "Check date", "Method", "Expiry", "Status"],
      rows: employeesCache.map((e) => [e.fullName, e.rtwCheckDate, e.rtwMethod, e.rtwExpiry || "No expiry (settled)", daysUntil(e.rtwExpiry) === null ? "OK" : (daysUntil(e.rtwExpiry) < 0 ? "Expired" : daysUntil(e.rtwExpiry) <= 90 ? "Due soon" : "OK")]),
    }),
    staffList: () => ({
      title: "Full staff list",
      headers: ["Name", "Employee ID", "Department", "Job title", "Status", "Start date"],
      rows: employeesCache.map((e) => [e.fullName, e.employeeId, e.department, e.jobTitle, e.status, e.startDate]),
    }),
  };
  return builders[type]();
}

/* small colour-coded read-outs for report cells — pill + (for "Days left") a mini bar */
function pillHtml(variant, label) {
  return `<span class="pill ${variant}">${escapeHtml(label)}</span>`;
}
function daysLeftCell(days) {
  if (days === null || days === undefined || Number.isNaN(days)) return "—";
  const overdue = days < 0;
  const variant = overdue ? "bad" : days <= 30 ? "warn" : "ok";
  const label = overdue ? `${Math.abs(days)}d overdue` : `${days}d left`;
  const pct = overdue ? 100 : Math.round(((90 - Math.max(0, Math.min(90, days))) / 90) * 100);
  return `<span class="days-cell">${pillHtml(variant, label)}<span class="mini-bar"><span class="mini-bar-fill ${variant}" style="width:${pct}%"></span></span></span>`;
}
function rtwStatusCell(status) {
  const map = { OK: ["ok", "OK"], "Due soon": ["warn", "Due soon"], Expired: ["bad", "Expired"] };
  const [variant, label] = map[status] || ["neutral", status || "—"];
  return pillHtml(variant, label);
}
function employeeStatusCell(status) {
  const map = { active: ["ok", "Active"], probation: ["warn", "Probation"], leaver: ["bad", "Leaver"] };
  const [variant, label] = map[status] || ["neutral", status || "—"];
  return pillHtml(variant, label);
}
function missingCell(missingStr) {
  if (!missingStr) return pillHtml("ok", "Complete");
  return `<span class="pill bad">${escapeHtml(missingStr)}</span>`;
}

const REPORT_CELL_FORMATTERS = {
  visa90: { "Days left": daysLeftCell },
  missingDocs: { Missing: missingCell },
  rtwStatus: { Status: rtwStatusCell },
  staffList: { Status: employeeStatusCell },
};

/* "Compliance at a glance" strip + live counts on each report card —
   populated as soon as staff data loads, no click needed. */
function renderReportsOverview() {
  const grid = document.getElementById("reports-stat-grid");
  if (!grid) return;
  const total = employeesCache.length;
  const sponsored = employeesCache.filter((e) => e.cosNumber).length;
  const expiring = collectExpiryItems();
  const overdue = expiring.filter((i) => i.days < 0).length;

  const CARDS = [
    { cls: "", icon: "var(--icon-people)", target: total, label: "Total staff records", nav: () => showView("employees") },
    { cls: "", icon: "var(--icon-idcard)", target: sponsored, label: "Sponsored workers", nav: () => openReport("sponsored") },
    { cls: "warn", icon: "var(--icon-clock)", target: expiring.length, label: "Expiring within 90 days", nav: () => openReport("visa90") },
    { cls: "danger", icon: "var(--icon-alert)", target: overdue, label: "Already overdue", nav: () => openReport("visa90") },
  ];
  grid.innerHTML = CARDS.map((c) => `
    <div class="stat-card clickable ${c.cls}" role="button" tabindex="0">
      <div class="stat-card-top">
        <span class="stat-icon"><span class="icon-mask" style="--icon-url:${c.icon}" aria-hidden="true"></span></span>
      </div>
      <div class="num" data-target="${c.target}">0</div>
      <div class="label">${c.label}</div>
    </div>`).join("");
  grid.querySelectorAll(".num").forEach((el) => animateCount(el, Number(el.dataset.target)));
  grid.querySelectorAll(".stat-card").forEach((card, idx) => {
    card.addEventListener("click", () => CARDS[idx].nav());
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); CARDS[idx].nav(); }
    });
  });

  document.querySelectorAll(".report-card").forEach((btn) => {
    const type = btn.dataset.report;
    const countEl = btn.querySelector(".report-card-count");
    if (countEl && REPORT_TYPES.includes(type)) countEl.textContent = buildReport(type).rows.length;
  });

  if (window.renderReportCharts) window.renderReportCharts();
}

/* Jump straight to the Reports view with a specific report already selected & run. */
function openReport(type) {
  showView("reports");
  setTimeout(() => {
    const card = document.querySelector(`.report-card[data-report="${type}"]`);
    if (card) card.click();
  }, 60);
}

async function runReport(type, { skeleton = true } = {}) {
  const titleEl = document.getElementById("report-title");
  const table = document.getElementById("report-table");
  document.getElementById("export-csv-btn").classList.add("hidden");
  if (skeleton) {
    titleEl.textContent = "Loading report…";
    table.innerHTML = `<tbody>${Array.from({ length: 3 }).map(() => `<tr class="skeleton-row"><td><div class="skeleton-line" style="width:70%"></div></td><td><div class="skeleton-line" style="width:50%"></div></td><td><div class="skeleton-line" style="width:60%"></div></td></tr>`).join("")}</tbody>`;
    await wait(220);
  }
  document.getElementById("export-csv-btn").classList.remove("hidden");

  const { title, headers, rows } = buildReport(type);
  const formatters = REPORT_CELL_FORMATTERS[type] || {};
  titleEl.textContent = title;
  currentReportHeaders = headers;
  currentReportRows = rows;
  table.querySelector("thead")?.remove();
  table.innerHTML = `<thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${
    rows.length
      ? rows.map((r, idx) => `<tr style="animation-delay:${idx * 20}ms">${r.map((c, ci) => {
          const fmt = formatters[headers[ci]];
          return `<td>${fmt ? fmt(c) : escapeHtml(c ?? "—")}</td>`;
        }).join("")}</tr>`).join("")
      : `<tr><td colspan="${headers.length}" class="empty-note">No matching records.</td></tr>`
  }</tbody>`;
  if (skeleton) {
    showToast("info", `${title}: ${rows.length} record${rows.length === 1 ? "" : "s"} found.`, 2400);
    logReportRun(type, title, rows);
  }
}

/* ---------------- Recent reports (in-memory, this session) ---------------- */
const reportRunLog = [];
function logReportRun(type, title, rows) {
  const problemTypes = ["visa90", "missingDocs"];
  let needsAttention = false;
  if (problemTypes.includes(type)) needsAttention = rows.length > 0;
  else if (type === "rtwStatus") needsAttention = rows.some((r) => r[4] && r[4] !== "OK");
  reportRunLog.unshift({ date: new Date(), title, needsAttention });
  if (reportRunLog.length > 8) reportRunLog.length = 8;
  if (window.renderReportCharts) window.renderReportCharts();
}

document.getElementById("export-csv-btn").addEventListener("click", () => {
  const csv = [currentReportHeaders, ...currentReportRows]
    .map((row) => row.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `report_${todayStr()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("success", "CSV exported.");
  if (activeReportType) {
    const idx = reportRunLog.findIndex((r) => r.title === document.getElementById("report-title").textContent);
    if (idx > -1) reportRunLog[idx].date = new Date();
    if (window.renderReportCharts) window.renderReportCharts();
  }
});

/* ---------------- Bridge for js/reports-charts.js (read-only access to live app state) ---------------- */
window.__dcApp = {
  get employeesCache() { return employeesCache; },
  get auditEntries() { return auditEntries; },
  get reportRunLog() { return reportRunLog; },
  collectAllTrackedItems,
  collectExpiryItems,
  daysUntil,
  todayStr,
  escapeHtml,
  showView,
  openReport,
};
