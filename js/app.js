let currentUser = null;
let currentRole = "viewer";
let employeesCache = [];
let currentEmployeeId = null; // null = creating new
const demoEmployeesKey = "dreams-care-demo-employees";
const demoAuditKey = "dreams-care-demo-audit";

const DAY = 86400000;
const todayStr = () => new Date().toISOString().slice(0, 10);
const wait = (ms) => new Promise((res) => setTimeout(res, ms));

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

/* ---------------- Auth ---------------- */
const authScreen = document.getElementById("auth-screen");
const appEl = document.getElementById("app");

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  const errEl = document.getElementById("login-error");
  const submitBtn = e.target.querySelector("button[type=submit]");
  errEl.textContent = "";
  errEl.style.animation = "none";

  submitBtn.classList.add("is-loading");
  await wait(450); // brief authenticating feel

  if (username !== "admin" || password !== "admin") {
    submitBtn.classList.remove("is-loading");
    void errEl.offsetWidth; // retrigger shake
    errEl.style.animation = "";
    errEl.textContent = "Use username admin and password admin.";
    return;
  }
  currentUser = { email: "admin" };
  currentRole = "admin";
  authScreen.classList.add("hidden");
  appEl.classList.remove("hidden");
  document.getElementById("current-user").textContent = "admin · admin";
  document.getElementById("delete-employee-btn").classList.remove("hidden");
  submitBtn.classList.remove("is-loading");
  await loadEmployees();
  showView("dashboard");
  positionNavIndicator();
  showToast("success", "Signed in as admin.");
});

document.getElementById("logout-btn").addEventListener("click", () => {
  currentUser = null;
  authScreen.classList.remove("hidden");
  appEl.classList.add("hidden");
  navIndicator.classList.remove("ready");
});

/* ---------------- Navigation ---------------- */
document.querySelectorAll(".nav-link").forEach((btn) => {
  btn.addEventListener("click", () => showView(btn.dataset.view));
});

async function showView(name) {
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
  if (name === "reports") {
    document.getElementById("report-title").textContent = "Select a report";
    document.getElementById("report-table").innerHTML = "";
    document.getElementById("export-csv-btn").classList.add("hidden");
    document.querySelectorAll(".report-card").forEach((c) => c.classList.remove("active"));
  }
}

document.getElementById("back-to-employees").addEventListener("click", () => showView("employees"));

/* ---------------- Data loading ---------------- */
async function loadEmployees() {
  employeesCache = JSON.parse(localStorage.getItem(demoEmployeesKey) || "[]");
}

function saveEmployees() {
  localStorage.setItem(demoEmployeesKey, JSON.stringify(employeesCache));
}

function updateEmployee(id, data) {
  const index = employeesCache.findIndex((employee) => employee.id === id);
  if (index === -1) throw new Error("Staff record not found");
  employeesCache[index] = { ...employeesCache[index], ...data };
  saveEmployees();
}

function createEmployee(data) {
  const id = crypto.randomUUID();
  employeesCache.push({ id, ...data, documents: [], trainings: [], createdAt: new Date().toISOString() });
  saveEmployees();
  return id;
}

function removeEmployee(id) {
  employeesCache = employeesCache.filter((employee) => employee.id !== id);
  saveEmployees();
}

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

async function renderDashboard() {
  const tbody = document.querySelector("#expiry-table tbody");
  document.getElementById("expiry-empty").classList.add("hidden");
  renderSkeletonRows(tbody, 4, 3);
  document.getElementById("stat-grid").innerHTML = ["", "", "warn", "danger"]
    .map((cls) => `<div class="stat-card ${cls}"><div class="num"><div class="skeleton-line" style="width:40px;height:24px"></div></div><div class="label">&nbsp;</div></div>`).join("");

  await wait(280); // simulated live fetch, gives the skeleton a moment to be visible

  const total = employeesCache.length;
  const sponsored = employeesCache.filter((e) => e.cosNumber).length;
  const expiring = collectExpiryItems();
  const overdue = expiring.filter((i) => i.days < 0).length;

  document.getElementById("stat-grid").innerHTML = `
    <div class="stat-card"><div class="num" data-target="${total}">0</div><div class="label">Total staff records</div></div>
    <div class="stat-card"><div class="num" data-target="${sponsored}">0</div><div class="label">Sponsored workers</div></div>
    <div class="stat-card warn"><div class="num" data-target="${expiring.length}">0</div><div class="label">Expiring within 90 days</div></div>
    <div class="stat-card danger"><div class="num" data-target="${overdue}">0</div><div class="label">Already overdue</div></div>
  `;
  document.querySelectorAll("#stat-grid .num").forEach((el) => animateCount(el, Number(el.dataset.target)));

  tbody.innerHTML = "";
  document.getElementById("expiry-empty").classList.toggle("hidden", expiring.length > 0);
  expiring.forEach((i, idx) => {
    const tr = document.createElement("tr");
    tr.style.animationDelay = `${idx * 25}ms`;
    tr.innerHTML = `<td><a class="row-link" data-id="${i.id}">${i.name}</a></td><td>${i.item}</td><td>${i.date}</td><td>${statusPill(i.days)}</td>`;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll(".row-link").forEach((a) => a.addEventListener("click", () => openEmployee(a.dataset.id)));
}

/* ---------------- Employees list ---------------- */
let searchDebounce = null;
document.getElementById("employee-search").addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(renderEmployeesTable, 150);
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
        <td><a class="row-link" data-id="${e.id}">${e.fullName || "(unnamed)"}</a></td>
        <td>${e.department || "—"}</td>
        <td>${e.jobTitle || "—"}</td>
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
  flashSync("Saving…");
  const formData = new FormData(employeeForm);
  const data = {};
  for (const [key, val] of formData.entries()) data[key] = val;

  if (!employeeForm.reportValidity()) {
    statusEl.textContent = "";
    return false;
  }

  await wait(250); // brief write delay so the saving state is visible

  try {
    const isNew = !currentEmployeeId;
    if (currentEmployeeId) {
      updateEmployee(currentEmployeeId, data);
      await logAudit("Updated staff record", currentEmployeeId, data.fullName);
    } else {
      currentEmployeeId = createEmployee(data);
      await logAudit("Created staff record", currentEmployeeId, data.fullName);
    }
    await loadEmployees();
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
  submitBtn.disabled = true;
  await persistEmployeeForm();
  submitBtn.disabled = false;
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
  removeEmployee(currentEmployeeId);
  await logAudit("Deleted staff record", currentEmployeeId, name);
  await loadEmployees();
  showToast("success", `${name || "Staff record"} deleted.`);
  await showView("employees");
});

/* ---------------- Documents tab ---------------- */
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
    tr.innerHTML = `<td>${d.type}</td><td><a href="${d.url}" target="_blank" rel="noopener">${d.fileName}</a></td><td>${d.expiry ? `${d.expiry} ${statusPill(daysUntil(d.expiry))}` : "—"}</td><td>${d.uploadedAt || "—"}</td><td><button type="button" class="secondary-btn" data-idx="${idx}">Remove</button></td>`;
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
      updateEmployee(currentEmployeeId, { documents: docs });
      await logAudit("Removed document", currentEmployeeId, `${removed.type} — ${removed.fileName}`);
      await loadEmployees();
      renderDocumentsTable(employeesCache.find((e) => e.id === currentEmployeeId));
      showToast("info", `${removed.type} removed.`);
    });
  });
}

document.getElementById("doc-upload-btn").addEventListener("click", async () => {
  if (!currentEmployeeId) { showToast("error", "Save the staff record before uploading documents."); return; }
  const file = document.getElementById("doc-file-input").files[0];
  if (!file) { showToast("error", "Choose a file first."); return; }
  const type = document.getElementById("doc-type-select").value;
  const expiry = document.getElementById("doc-expiry-input").value;
  const uploadBtn = document.getElementById("doc-upload-btn");
  const progressWrap = document.getElementById("upload-progress");
  const progressBar = document.getElementById("upload-progress-bar");
  try {
    uploadBtn.disabled = true;
    progressWrap.classList.remove("hidden");
    progressBar.style.width = "0%";
    for (const pct of [18, 42, 68, 90]) {
      progressBar.style.width = `${pct}%`;
      await wait(90);
    }
    const reader = new FileReader();
    reader.onload = async () => {
      progressBar.style.width = "100%";
      await wait(150);
      const emp = employeesCache.find((e) => e.id === currentEmployeeId);
      const docs = [...(emp.documents || []), { type, fileName: file.name, url: reader.result, expiry, uploadedAt: todayStr(), uploadedBy: currentUser.email }];
      updateEmployee(currentEmployeeId, { documents: docs });
      await logAudit("Uploaded document", currentEmployeeId, `${type} — ${file.name}`);
      renderDocumentsTable(employeesCache.find((e) => e.id === currentEmployeeId));
      document.getElementById("doc-file-input").value = "";
      document.getElementById("doc-expiry-input").value = "";
      progressWrap.classList.add("hidden");
      uploadBtn.disabled = false;
      showToast("success", `${file.name} uploaded.`);
    };
    reader.readAsDataURL(file);
  } catch (err) {
    console.error(err);
    progressWrap.classList.add("hidden");
    uploadBtn.disabled = false;
    showToast("error", "Could not save the document in this browser.");
  }
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
    tr.innerHTML = `<td>${t.name}</td><td>${t.date || "—"}</td><td>${t.expiry ? `${t.expiry} ${statusPill(daysUntil(t.expiry))}` : "—"}</td><td><button type="button" class="secondary-btn" data-idx="${idx}">Remove</button></td>`;
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
      updateEmployee(currentEmployeeId, { trainings });
      await loadEmployees();
      renderTrainingTable(employeesCache.find((e) => e.id === currentEmployeeId));
      showToast("info", `${removed?.name || "Training record"} removed.`);
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
  updateEmployee(currentEmployeeId, { trainings });
  await logAudit("Added training record", currentEmployeeId, name);
  await loadEmployees();
  renderTrainingTable(employeesCache.find((e) => e.id === currentEmployeeId));
  document.getElementById("training-name-input").value = "";
  document.getElementById("training-date-input").value = "";
  document.getElementById("training-expiry-input").value = "";
  showToast("success", `${name} added.`);
});

/* ---------------- Audit log ---------------- */
async function logAudit(action, employeeId, employeeName) {
  const entries = JSON.parse(localStorage.getItem(demoAuditKey) || "[]");
  entries.unshift({ action, employeeId, employeeName: employeeName || "", user: currentUser?.email || "unknown", ts: new Date().toISOString() });
  localStorage.setItem(demoAuditKey, JSON.stringify(entries));
  flashSync();
}

async function renderAuditLog() {
  const tbody = document.querySelector("#audit-table tbody");
  renderSkeletonRows(tbody, 5, 4);
  await wait(220);
  const entries = JSON.parse(localStorage.getItem(demoAuditKey) || "[]");
  tbody.innerHTML = "";
  entries.forEach((a, idx) => {
    const tr = document.createElement("tr");
    tr.style.animationDelay = `${idx * 20}ms`;
    tr.innerHTML = `<td>${new Date(a.ts).toLocaleString()}</td><td>${a.user}</td><td>${a.action}</td><td>${a.employeeName || "—"}</td><td>${a.details || ""}</td>`;
    tbody.appendChild(tr);
  });
  if (!entries.length) tbody.innerHTML = `<tr><td colspan="5" class="empty-note">No audit entries yet — actions you take will show up here.</td></tr>`;
}

/* ---------------- Reports ---------------- */
document.querySelectorAll(".report-card").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".report-card").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    runReport(btn.dataset.report);
  });
});

let currentReportRows = [];
let currentReportHeaders = [];

async function runReport(type) {
  const titleEl = document.getElementById("report-title");
  const table = document.getElementById("report-table");
  document.getElementById("export-csv-btn").classList.add("hidden");
  titleEl.textContent = "Loading report…";
  table.innerHTML = `<tbody>${Array.from({ length: 3 }).map(() => `<tr class="skeleton-row"><td><div class="skeleton-line" style="width:70%"></div></td><td><div class="skeleton-line" style="width:50%"></div></td><td><div class="skeleton-line" style="width:60%"></div></td></tr>`).join("")}</tbody>`;
  await wait(220);
  document.getElementById("export-csv-btn").classList.remove("hidden");

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

  const { title, headers, rows } = builders[type]();
  titleEl.textContent = title;
  currentReportHeaders = headers;
  currentReportRows = rows;
  table.querySelector("thead")?.remove();
  table.innerHTML = `<thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${
    rows.length
      ? rows.map((r, idx) => `<tr style="animation-delay:${idx * 20}ms">${r.map((c) => `<td>${c ?? "—"}</td>`).join("")}</tr>`).join("")
      : `<tr><td colspan="${headers.length}" class="empty-note">No matching records.</td></tr>`
  }</tbody>`;
  showToast("info", `${title}: ${rows.length} record${rows.length === 1 ? "" : "s"} found.`, 2400);
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
});
