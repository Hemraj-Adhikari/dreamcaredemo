/* ============================================================
   PREMIUM POLISH — behaviour layer
   Pairs with css/enhance.css. Purely additive: no existing app.js
   logic is touched. Everything here is delegated + rAF-throttled so
   it stays cheap even on low-power devices, and it backs off
   entirely for prefers-reduced-motion / touch.
   ============================================================ */
(() => {
  const CARD_SELECTOR = ".stat-card, .quick-action-card, .report-card, .contact-card";
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const canHover = window.matchMedia("(hover: hover)").matches;

  /* ---------------- Staggered entrance indices ---------------- */
  // Assigns --i to each child of a live-updating grid so CSS can stagger
  // the entrance animation. Re-runs automatically whenever the grid's
  // content is re-rendered (these views use innerHTML replacement).
  function applyStagger(container) {
    if (!container) return;
    Array.from(container.children).forEach((child, i) => {
      child.style.setProperty("--i", i);
    });
  }

  function watchStagger(id) {
    const el = document.getElementById(id);
    if (!el) return;
    applyStagger(el);
    new MutationObserver(() => applyStagger(el)).observe(el, { childList: true });
  }

  ["stat-grid", "quick-actions-grid", "contact-grid", "donut-legend"].forEach(watchStagger);
  document.querySelectorAll(".report-grid").forEach(applyStagger);

  ["expiry-table", "employees-table", "all-documents-table", "documents-table", "training-table", "audit-table"]
    .forEach((id) => {
      const tbody = document.querySelector(`#${id} tbody`);
      if (!tbody) return;
      applyStagger(tbody);
      new MutationObserver(() => applyStagger(tbody)).observe(tbody, { childList: true });
    });

  /* ---------------- Flash cards when live data refreshes ---------------- */
  // The stat cards are re-rendered whenever the Firestore listener fires.
  // Re-triggering the CSS flash animation on each refresh gives a clear
  // "this just updated live" cue without needing a diff of old vs new values.
  const statGrid = document.getElementById("stat-grid");
  if (statGrid) {
    let first = true;
    new MutationObserver(() => {
      if (first) { first = false; return; } // skip the very first paint
      statGrid.querySelectorAll(".stat-card").forEach((card) => {
        card.classList.remove("flash-update");
        void card.offsetWidth; // force reflow so the animation restarts
        card.classList.add("flash-update");
      });
    }).observe(statGrid, { childList: true });
  }

  if (reduceMotion || !canHover) return; // spotlight + will-change are pure visual sugar

  /* ---------------- Cursor-following spotlight (rAF-throttled) ---------------- */
  let rafId = null;
  let targetEl = null;
  let targetX = 0;
  let targetY = 0;

  function paintSpotlight() {
    if (targetEl) {
      targetEl.style.setProperty("--mx", `${targetX}px`);
      targetEl.style.setProperty("--my", `${targetY}px`);
    }
    rafId = null;
  }

  document.addEventListener("pointermove", (e) => {
    const card = e.target.closest(CARD_SELECTOR);
    if (!card) return;
    const rect = card.getBoundingClientRect();
    targetEl = card;
    targetX = e.clientX - rect.left;
    targetY = e.clientY - rect.top;
    if (!rafId) rafId = requestAnimationFrame(paintSpotlight);
  }, { passive: true });

  /* ---------------- will-change only while actually hovered ---------------- */
  // Keeps GPU layer promotion scoped to the moment it's needed instead of
  // paying the memory cost for every card on the page all the time.
  document.addEventListener("pointerover", (e) => {
    const card = e.target.closest(CARD_SELECTOR);
    if (!card || card.contains(e.relatedTarget)) return;
    card.classList.add("is-hot");
  });
  document.addEventListener("pointerout", (e) => {
    const card = e.target.closest(CARD_SELECTOR);
    if (!card || card.contains(e.relatedTarget)) return;
    card.classList.remove("is-hot");
  });
})();
