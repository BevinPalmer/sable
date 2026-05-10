/* Sable — Photoshop UXP conversational retouching panel */

const { app, core, action, constants } = require("photoshop");
const { batchPlay } = action;
const shell = require("uxp").shell;

const JWT_KEY = "oryvn_token";
/** Live backend (must match manifest.json network.domains). */
const API_BASE = "https://oryvn-backend-production.up.railway.app";

let authToken = "";
let creditsBalance = 0;
let isBusy = false;
/** @type {{ toolName: string, intensity: number, timestamp: number }[]} */
let sessionLog = [];
let lastAppliedLayerNames = [];
let lastGroupMeta = null;

function apiUrl(path) {
  return `${String(API_BASE).replace(/\/$/, "")}${path}`;
}

async function register(email, password) {
  const res = await fetch(apiUrl("/auth/register"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: String(email || "")
        .trim()
        .toLowerCase(),
      password
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || data.error || "Registration failed");
  }
  return data;
}

async function login(email, password) {
  const res = await fetch(apiUrl("/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: String(email || "")
        .trim()
        .toLowerCase(),
      password
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Login failed");
  }
  return data;
}

async function getCredits() {
  if (!authToken) return;
  const res = await fetch(apiUrl("/user/credits"), { headers: getAuthHeaders() });
  if (res.status === 401) {
    authToken = "";
    localStorage.removeItem(JWT_KEY);
    localStorage.removeItem("sable_jwt");
    showSetup();
    return;
  }
  if (!res.ok) return;
  const data = await res.json();
  creditsBalance = Number(data.credits) || 0;
  updateCreditsDisplay();
}

async function sendMessage(prompt, sessionLogForApi) {
  const res = await fetch(apiUrl("/retouch"), {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ prompt, sessionLog: sessionLogForApi })
  });
  if (res.status === 401) {
    throw new Error("AUTH");
  }
  if (res.status === 402) {
    throw new Error("CREDITS");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const data = await res.json();
  if (!data || typeof data !== "object") throw new Error("bad shape");
  return data;
}

function getAuthHeaders() {
  return {
    Authorization: `Bearer ${authToken}`,
    "Content-Type": "application/json"
  };
}

function setSetupError(msg) {
  const el = document.getElementById("setup-error");
  if (el) el.textContent = msg || "";
}

function updateCreditsDisplay() {
  const el = document.getElementById("header-credits-num");
  if (el) el.textContent = String(Math.max(0, Number(creditsBalance) || 0));
}

async function onSignIn() {
  setSetupError("");
  const email = document.getElementById("setup-email").value.trim();
  const password = document.getElementById("setup-password").value;
  if (!email || !password) {
    setSetupError("Enter email and password.");
    return;
  }
  try {
    const data = await login(email, password);
    authToken = data.token;
    creditsBalance = Number(data.credits) || 0;
    localStorage.setItem(JWT_KEY, authToken);
    updateCreditsDisplay();
    showMain();
    await getCredits();
  } catch (e) {
    setSetupError(e.message || "Network error.");
    console.error(e);
  }
}

async function onRegister() {
  setSetupError("");
  const email = document.getElementById("setup-email").value.trim();
  const password = document.getElementById("setup-password").value;
  if (!email || !password) {
    setSetupError("Enter email and password.");
    return;
  }
  if (password.length < 8) {
    setSetupError("Password must be at least 8 characters.");
    return;
  }
  try {
    const data = await register(email, password);
    authToken = data.token;
    creditsBalance = Number(data.credits) || 0;
    localStorage.setItem(JWT_KEY, authToken);
    updateCreditsDisplay();
    showMain();
    await getCredits();
  } catch (e) {
    setSetupError(e.message || "Network error.");
    console.error(e);
  }
}

function onSignOut() {
  authToken = "";
  creditsBalance = 0;
  localStorage.removeItem(JWT_KEY);
  localStorage.removeItem("sable_jwt");
  closeBuyCreditsPanel();
  closeHeaderMenu();
  showSetup();
  const pw = document.getElementById("setup-password");
  if (pw) pw.value = "";
  setSetupError("");
}

function toggleHeaderMenu() {
  const dd = document.getElementById("header-menu-dropdown");
  if (!dd) return;
  dd.classList.toggle("hidden");
}

function closeHeaderMenu() {
  const dd = document.getElementById("header-menu-dropdown");
  if (dd) dd.classList.add("hidden");
}

function closeBuyCreditsPanel() {
  const el = document.getElementById("buy-credits-inline");
  if (el) el.remove();
}

async function startCheckoutForPack(pack) {
  try {
    const res = await fetch(apiUrl("/stripe/create-checkout"), {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ pack })
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      onSignOut();
      return;
    }
    if (!res.ok || !data.url) {
      appendSableMessage(data.error || "Checkout could not start.", []);
      return;
    }
    await shell.openExternal(data.url);
    closeBuyCreditsPanel();
    closeHeaderMenu();
  } catch (e) {
    console.error(e);
    appendSableMessage("Could not open checkout.", []);
  }
}

function showBuyCreditsPanel() {
  closeBuyCreditsPanel();
  closeHeaderMenu();
  const root = getChatRoot();
  const wrap = document.createElement("div");
  wrap.id = "buy-credits-inline";
  wrap.className = "buy-credits-block";
  wrap.innerHTML = `
    <div class="buy-credits-title">Credit packs</div>
    <div class="buy-credits-cards">
      <button type="button" class="pack-card" data-pack="starter">
        <div><strong>Starter</strong><span>$9 · 300 retouches</span></div>
      </button>
      <button type="button" class="pack-card" data-pack="pro">
        <div><strong>Pro</strong><span>$19 · 800 retouches</span></div>
      </button>
      <button type="button" class="pack-card" data-pack="studio">
        <div><strong>Studio</strong><span>$39 · 2000 retouches</span></div>
      </button>
    </div>
    <button type="button" class="buy-credits-close" data-close-buy>Close</button>
  `;
  root.appendChild(wrap);
  wrap.querySelector("[data-close-buy]").addEventListener("click", closeBuyCreditsPanel);
  wrap.querySelectorAll("[data-pack]").forEach(btn => {
    btn.addEventListener("click", () => startCheckoutForPack(btn.getAttribute("data-pack")));
  });
  scrollChat();
}

function appendOutOfCreditsMessage() {
  appendDividerIfNeeded();
  const wrap = document.createElement("div");
  wrap.className = "msg-row msg-sable-wrap";
  wrap.innerHTML =
    '<div class="msg-sable-label">ORYVN</div>' +
    '<div class="msg-sable-bubble">You\'re out of retouches. Visit oryvnai.com to top up.</div>' +
    '<button type="button" class="btn-inline-buy" data-buy-credits>Buy credits</button>';
  getChatRoot().appendChild(wrap);
  const b = wrap.querySelector("[data-buy-credits]");
  if (b) b.addEventListener("click", () => showBuyCreditsPanel());
  scrollChat();
}

document.addEventListener("DOMContentLoaded", () => {
  authToken = localStorage.getItem(JWT_KEY) || localStorage.getItem("sable_jwt") || "";
  if (authToken) {
    localStorage.setItem(JWT_KEY, authToken);
    showMain();
    getCredits().catch(() => {});
  } else {
    showSetup();
  }

  document.getElementById("sign-in-btn").addEventListener("click", onSignIn);
  document.getElementById("register-btn").addEventListener("click", onRegister);
  document.getElementById("setup-password").addEventListener("keydown", e => {
    if (e.key === "Enter") onSignIn();
  });

  document.getElementById("send-btn").addEventListener("click", onSend);
  document.getElementById("prompt-input").addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  });
  document.getElementById("prompt-input").addEventListener("input", autoGrowTextarea);

  document.getElementById("menu-btn").addEventListener("click", e => {
    e.stopPropagation();
    toggleHeaderMenu();
  });
  document.getElementById("header-menu-dropdown").addEventListener("click", e => e.stopPropagation());
  document.getElementById("menu-buy-btn").addEventListener("click", () => showBuyCreditsPanel());
  document.getElementById("menu-signout-btn").addEventListener("click", onSignOut);

  document.addEventListener("mousedown", e => {
    if (e.target.closest && (e.target.closest("#menu-btn") || e.target.closest("#header-menu-dropdown"))) {
      return;
    }
    closeHeaderMenu();
  });

  getChatRoot().addEventListener("click", e => {
    const buy = e.target.closest("[data-buy-credits]");
    if (buy) {
      e.preventDefault();
      showBuyCreditsPanel();
    }
  });

  setInterval(() => {
    if (!document.getElementById("main-view").classList.contains("hidden")) {
      updateFilename();
    }
  }, 1500);
});

function showSetup() {
  document.getElementById("setup-view").classList.remove("hidden");
  document.getElementById("main-view").classList.add("hidden");
}

function showMain() {
  document.getElementById("setup-view").classList.add("hidden");
  document.getElementById("main-view").classList.remove("hidden");
  updateCreditsDisplay();
  updateFilename();
}

function updateFilename() {
  const el = document.getElementById("header-filename");
  if (!app.activeDocument) {
    el.textContent = "No document";
    el.style.color = "#3a3a3e";
    return;
  }
  el.textContent = app.activeDocument.name || "Untitled";
  el.style.color = "#3a3a3e";
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function autoGrowTextarea() {
  const ta = document.getElementById("prompt-input");
  ta.style.height = "auto";
  ta.style.height = Math.min(ta.scrollHeight, 80) + "px";
}

function isUndoIntent(text) {
  const t = String(text || "").trim().toLowerCase();
  return /^(undo|undo that)[.!?\s]*$/i.test(t);
}

function inferIntensity(op) {
  const t = op.type;
  if (t === "brightness_contrast") {
    const v = (Math.abs(op.brightness || 0) + Math.abs(op.contrast || 0)) / 2;
    return Math.min(100, Math.round(v));
  }
  if (t === "vibrance") {
    return Math.min(100, Math.round(Math.abs(op.vibrance || 0) + Math.abs(op.saturation || 0) / 2));
  }
  if (t === "hue_saturation") {
    const adj = op.adjustments && op.adjustments[0];
    if (!adj) return 50;
    return Math.min(
      100,
      Math.round((Math.abs(adj.hue || 0) + Math.abs(adj.saturation || 0) + Math.abs(adj.lightness || 0)) / 3)
    );
  }
  if (t === "color_balance") {
    const flat = [op.shadows, op.midtones, op.highlights]
      .flat()
      .filter(n => typeof n === "number");
    if (!flat.length) return 50;
    const avg = flat.reduce((a, b) => a + Math.abs(b), 0) / flat.length;
    return Math.min(100, Math.round(avg));
  }
  if (t === "selective_color" && Array.isArray(op.colors)) {
    let sum = 0;
    let n = 0;
    op.colors.forEach(c => {
      ["cyan", "magenta", "yellow", "black"].forEach(k => {
        if (typeof c[k] === "number") {
          sum += Math.abs(c[k]);
          n++;
        }
      });
    });
    return n ? Math.min(100, Math.round(sum / n)) : 50;
  }
  if (t === "curves") return 55;
  if (t === "dodge_burn") return 50;
  return 50;
}

function isSkinOp(op) {
  if (op.type === "dodge_burn") return true;
  if (op.type === "selective_color") {
    const n = String(op.name || "").toLowerCase();
    return /skin|lip|face|pore|complexion|redness|blemish/i.test(n);
  }
  return false;
}

function recordSessionFromOperations(ops) {
  const now = Date.now();
  (ops || []).forEach(op => {
    if (!op || !op.type) return;
    sessionLog.push({
      toolName: op.name || op.type,
      intensity: inferIntensity(op),
      timestamp: now
    });
  });
}

function getChatRoot() {
  return document.getElementById("chat-area");
}

function appendDividerIfNeeded() {
  const chat = getChatRoot();
  if (chat.children.length === 0) return;
  const d = document.createElement("div");
  d.className = "exchange-divider";
  chat.appendChild(d);
}

function appendUserMessage(text) {
  appendDividerIfNeeded();
  const row = document.createElement("div");
  row.className = "msg-row msg-user-wrap";
  row.innerHTML = `<div class="msg-user-text">${escapeHtml(text)}</div>`;
  getChatRoot().appendChild(row);
  scrollChat();
}

function appendSableMessage(message, chips) {
  const wrap = document.createElement("div");
  wrap.className = "msg-row msg-sable-wrap";
  let html = `<div class="msg-sable-label">ORYVN</div><div class="msg-sable-bubble">${escapeHtml(message)}</div>`;
  if (chips && chips.length) {
    html += '<div class="chips">';
    chips.forEach(c => {
      const cls = c.tone === "skin" ? "chip chip--skin" : "chip chip--grade";
      html += `<span class="${cls}">${escapeHtml(c.label)}</span>`;
    });
    html += "</div>";
  }
  wrap.innerHTML = html;
  getChatRoot().appendChild(wrap);
  scrollChat();
}

function appendInfoMessage(message, stats) {
  const wrap = document.createElement("div");
  wrap.className = "msg-row msg-sable-wrap";
  let html = `<div class="msg-sable-label">ORYVN</div><div class="msg-sable-bubble">${escapeHtml(message)}</div>`;
  if (Array.isArray(stats) && stats.length) {
    html += '<div class="stats-block">';
    stats.forEach(s => {
      const name = String(s.name || "—");
      const val = Math.max(0, Math.min(100, Number(s.value) || 0));
      html += `<div class="stat-row"><span class="stat-name">${escapeHtml(name)}</span><div class="stat-bar-track"><div class="stat-bar-fill" style="width:${val}%"></div></div><span class="stat-val">${val}</span></div>`;
    });
    html += "</div>";
  }
  wrap.innerHTML = html;
  getChatRoot().appendChild(wrap);
  scrollChat();
}

function scrollChat() {
  const c = getChatRoot();
  c.scrollTop = c.scrollHeight;
}

function chipsFromOperations(ops) {
  return (ops || []).map(op => ({
    tone: isSkinOp(op) ? "skin" : "grade",
    label: op.name || op.type
  }));
}

async function undoLastApplied() {
  if (!app.activeDocument) return;
  try {
    await core.executeAsModal(async () => {
      if (lastGroupMeta && lastGroupMeta.id) {
        await deleteLayerById(lastGroupMeta.id);
        return;
      }
      const doc = app.activeDocument;
      const layers = doc.layers;
      for (const name of [...lastAppliedLayerNames].reverse()) {
        for (const layer of layers) {
          if (layer.name === name) {
            await layer.delete();
            break;
          }
        }
      }
    }, { commandName: "Sable Undo" });
  } catch (e) {
    console.error(e);
  }
  lastAppliedLayerNames = [];
  lastGroupMeta = null;
}

async function onSend() {
  if (isBusy) return;
  const ta = document.getElementById("prompt-input");
  const text = ta.value.trim();
  if (!text) return;

  if (!authToken) {
    showSetup();
    return;
  }

  if (isUndoIntent(text)) {
    ta.value = "";
    ta.style.height = "auto";
    appendUserMessage(text);
    await undoLastApplied();
    appendSableMessage("Undid the last batch of layers.", []);
    return;
  }

  ta.value = "";
  ta.style.height = "auto";
  appendUserMessage(text);
  isBusy = true;
  document.getElementById("send-btn").disabled = true;
  document.getElementById("prompt-input").disabled = true;

  try {
    let data;
    try {
      const sessionSlice = sessionLog.slice(-5).map(e => ({
        toolName: e.toolName,
        intensity: e.intensity,
        timestamp: e.timestamp
      }));
      data = await sendMessage(text, sessionSlice);
    } catch (e) {
      if (String(e.message) === "AUTH") throw e;
      if (String(e.message) === "CREDITS") {
        appendOutOfCreditsMessage();
        await getCredits().catch(() => {});
        return;
      }
      if (e instanceof SyntaxError) {
        appendSableMessage("I need a clean JSON reply — try asking again in one short sentence.", []);
        return;
      }
      throw e;
    }
    await getCredits();
    const action = String(data.action || "chat").toLowerCase();
    const msg = data.message != null ? String(data.message) : "";

    if (action === "retouch") {
      const ops = Array.isArray(data.operations) ? data.operations : [];
      if (!app.activeDocument) {
        appendSableMessage("No document open — open an image first.", []);
        return;
      }
      let ok = false;
      try {
        ok = await applyOperations(ops, text);
      } catch (e) {
        if (String(e && e.message) === "CMYK") {
          appendSableMessage(
            "This document is CMYK. Convert it to RGB first (Image → Mode → RGB Color), then try again.",
            []
          );
          return;
        }
        throw e;
      }
      if (ok) {
        recordSessionFromOperations(ops);
        appendSableMessage(msg || "Applied adjustments.", chipsFromOperations(ops));
      } else {
        appendSableMessage("Couldn't apply those adjustments. Try a simpler ask.", []);
      }
      return;
    }
    if (action === "info") {
      let stats = Array.isArray(data.stats) ? data.stats : [];
      if (!stats.length && sessionLog.length) {
        stats = sessionLog.slice(-12).map(e => ({ name: e.toolName, value: e.intensity }));
      }
      appendInfoMessage(msg || "Here’s what I have.", stats);
      return;
    }
    if (action === "preset") {
      appendSableMessage(msg || "Preset saved.", []);
      return;
    }
    appendSableMessage(msg || "—", []);
  } catch (e) {
    if (String(e.message) === "AUTH") {
      authToken = "";
      localStorage.removeItem(JWT_KEY);
      localStorage.removeItem("sable_jwt");
      showSetup();
      setSetupError("Session expired — sign in again.");
      return;
    }
    appendSableMessage("Something went wrong. Try again or shorten your request.", []);
    console.error(e);
  } finally {
    isBusy = false;
    document.getElementById("send-btn").disabled = false;
    document.getElementById("prompt-input").disabled = false;
  }
}

// ── Photoshop apply ────────────────────────────────────────────

function coerceLayerId(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\d+$/.test(v)) return parseInt(v, 10);
  return null;
}

function extractNewLayerId(result) {
  const r = result && result[0] ? result[0] : null;
  if (!r) return null;
  const id =
    r.new?._id ??
    r.new?._value ??
    r.layerID ??
    r.layerId ??
    r.ID ??
    r.id ??
    null;
  return coerceLayerId(id);
}

function findLayerById(container, targetId) {
  if (!container || !container.layers || targetId == null) return null;
  const tid = coerceLayerId(targetId);
  for (let i = 0; i < container.layers.length; i++) {
    const layer = container.layers[i];
    if (coerceLayerId(layer.id) === tid) return layer;
    if (layer.layers && layer.layers.length > 0) {
      const inner = findLayerById(layer, targetId);
      if (inner) return inner;
    }
  }
  return null;
}

async function moveLayerIntoGroup(layerId, groupId) {
  if (!layerId || !groupId || layerId === groupId) return;
  const doc = app.activeDocument;
  const src = findLayerById(doc, layerId);
  const dest = findLayerById(doc, groupId);
  if (src && dest && dest.layers) {
    try {
      await src.move(dest, constants.ElementPlacement.PLACEINSIDE);
      return;
    } catch (e) {
      console.warn("Sable: DOM move failed", e);
    }
  }
  try {
    await batchPlay(
      [
        {
          _obj: "move",
          _target: [{ _ref: "layer", _id: layerId }],
          to: { _ref: "layer", _id: groupId },
          adjustment: false
        }
      ],
      { synchronousExecution: false, modalBehavior: "execute" }
    );
  } catch (e2) {
    console.warn("Sable: batchPlay move failed", e2);
  }
}

async function createGroupLayerSection(name) {
  const result = await batchPlay(
    [
      {
        _obj: "make",
        _target: [{ _ref: "layerSection" }],
        using: { _obj: "layerSection", name: name || "Sable" }
      }
    ],
    { synchronousExecution: false, modalBehavior: "execute" }
  );
  return extractNewLayerId(result);
}

async function deleteLayerById(layerId) {
  if (!layerId) return;
  await batchPlay(
    [{ _obj: "delete", _target: [{ _ref: "layer", _id: layerId }] }],
    { synchronousExecution: false, modalBehavior: "execute" }
  );
}

function buildGroupName(userHint, operations) {
  const base = "Sable";
  const hint =
    (operations && operations[0] && String(operations[0].name || "").trim()) ||
    String(userHint || "").trim();
  const cleaned = hint.replace(/\s+/g, " ").trim();
  const short = cleaned.length > 34 ? cleaned.slice(0, 34).replace(/\s+\S*$/, "") + "…" : cleaned;
  return short ? `${base} — ${short}` : base;
}

async function getActiveDocumentModeSafe() {
  if (!app.activeDocument) return null;
  const docId = app.activeDocument.id;
  const res = await batchPlay(
    [
      {
        _obj: "get",
        _target: [{ _ref: "document", _id: docId }],
        _options: { dialogOptions: "dontDisplay" }
      }
    ],
    { synchronousExecution: true, modalBehavior: "fail" }
  );
  return res?.[0]?.mode?._value || res?.[0]?.mode || null;
}

async function applyOperations(operations, userHint) {
  lastAppliedLayerNames = [];
  lastGroupMeta = null;
  const ops = Array.isArray(operations) ? operations : [];
  if (!ops.length) return false;
  if (!app.activeDocument) return false;

  const mode = await getActiveDocumentModeSafe().catch(() => null);
  if (mode && String(mode).toLowerCase().includes("cmyk")) {
    throw new Error("CMYK");
  }

  const groupName = buildGroupName(userHint, ops);
  let any = false;

  await core.executeAsModal(async () => {
    const groupId = await createGroupLayerSection(groupName);
    if (groupId) {
      lastGroupMeta = { id: groupId, name: groupName };
    }
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      try {
        const lid = await applyOperation(op);
        lastAppliedLayerNames.push(op.name || op.type);
        any = true;
        if (groupId && lid && lid !== groupId) {
          await moveLayerIntoGroup(lid, groupId);
        }
      } catch (err) {
        console.error("Sable apply op", op && op.type, err);
      }
    }
  }, { commandName: "Sable" });

  if (!any) {
    lastAppliedLayerNames = [];
    lastGroupMeta = null;
  }
  return any;
}

async function applyOperation(op) {
  switch (op.type) {
    case "curves":
      return applyCurves(op);
    case "hue_saturation":
      return applyHueSaturation(op);
    case "brightness_contrast":
      return applyBrightnessContrast(op);
    case "vibrance":
      return applyVibrance(op);
    case "color_balance":
      return applyColorBalance(op);
    case "selective_color":
      return applySelectiveColor(op);
    case "dodge_burn":
      return applyDodgeBurn(op);
    default:
      throw new Error(`Unknown op: ${op.type}`);
  }
}

async function applyCurves(op) {
  const channelMap = { RGB: "composite", Red: "red", Green: "green", Blue: "blue" };
  const adjustment = (op.channels || [{ channel: "RGB", points: [[0, 0], [128, 128], [255, 255]] }]).map(
    ch => ({
      _obj: "curvesAdjustment",
      channel: {
        _ref: "channel",
        _enum: "channel",
        _value: channelMap[ch.channel] || "composite"
      },
      curve: ch.points.map(([h, v]) => ({ _obj: "paint", horizontal: h, vertical: v }))
    })
  );
  const result = await batchPlay(
    [
      {
        _obj: "make",
        _target: [{ _ref: "adjustmentLayer" }],
        using: {
          _obj: "adjustmentLayer",
          name: op.name || "Curves",
          type: { _obj: "curves", adjustment }
        }
      }
    ],
    { synchronousExecution: false, modalBehavior: "execute" }
  );
  return extractNewLayerId(result);
}

async function applyHueSaturation(op) {
  const adjustments = op.adjustments || [{ range: "all", hue: 0, saturation: 0, lightness: 0 }];
  const allAdj = adjustments.find(a => a.range === "all") || {};
  const descriptor = {
    _obj: "hueSaturation",
    colorize: false,
    preset: "Custom",
    hue: allAdj.hue || 0,
    saturation: allAdj.saturation || 0,
    lightness: allAdj.lightness || 0
  };
  const rangeMap = {
    reds: { _enum: "hueSatAdjustmentV2", _value: "reds" },
    yellows: { _enum: "hueSatAdjustmentV2", _value: "yellows" },
    greens: { _enum: "hueSatAdjustmentV2", _value: "greens" },
    cyans: { _enum: "hueSatAdjustmentV2", _value: "cyans" },
    blues: { _enum: "hueSatAdjustmentV2", _value: "blues" },
    magentas: { _enum: "hueSatAdjustmentV2", _value: "magentas" }
  };
  const rangeAdjustments = adjustments.filter(a => a.range !== "all");
  if (rangeAdjustments.length > 0) {
    descriptor.hueSatAdjustmentV2 = rangeAdjustments.map(a => ({
      _obj: "hueSatAdjustmentV2",
      enable: true,
      localRange: rangeMap[a.range] || rangeMap.reds,
      beginRamp: 0,
      beginSustain: 0,
      endSustain: 60,
      endRamp: 90,
      localHue: a.hue || 0,
      localSaturation: a.saturation || 0,
      localLightness: a.lightness || 0
    }));
  }
  const result = await batchPlay(
    [
      {
        _obj: "make",
        _target: [{ _ref: "adjustmentLayer" }],
        using: {
          _obj: "adjustmentLayer",
          name: op.name || "Hue/Saturation",
          type: descriptor
        }
      }
    ],
    { synchronousExecution: false, modalBehavior: "execute" }
  );
  return extractNewLayerId(result);
}

async function applyBrightnessContrast(op) {
  const result = await batchPlay(
    [
      {
        _obj: "make",
        _target: [{ _ref: "adjustmentLayer" }],
        using: {
          _obj: "adjustmentLayer",
          name: op.name || "Brightness/Contrast",
          type: {
            _obj: "brightnessEvent",
            brightness: op.brightness || 0,
            contrast: op.contrast || 0,
            useLegacy: false
          }
        }
      }
    ],
    { synchronousExecution: false, modalBehavior: "execute" }
  );
  return extractNewLayerId(result);
}

async function applyVibrance(op) {
  const result = await batchPlay(
    [
      {
        _obj: "make",
        _target: [{ _ref: "adjustmentLayer" }],
        using: {
          _obj: "adjustmentLayer",
          name: op.name || "Vibrance",
          type: {
            _obj: "vibrance",
            vibrance: op.vibrance || 0,
            saturation: op.saturation || 0
          }
        }
      }
    ],
    { synchronousExecution: false, modalBehavior: "execute" }
  );
  return extractNewLayerId(result);
}

async function applyColorBalance(op) {
  const makeTone = (arr = [0, 0, 0], toneType) => ({
    _obj: "colorBalance",
    toneRange: { _enum: "toneRange", _value: toneType },
    cyanRed: arr[0] || 0,
    magentaGreen: arr[1] || 0,
    yellowBlue: arr[2] || 0,
    preserveLuminosity: true
  });
  const result = await batchPlay(
    [
      {
        _obj: "make",
        _target: [{ _ref: "adjustmentLayer" }],
        using: {
          _obj: "adjustmentLayer",
          name: op.name || "Color Balance",
          type: {
            _obj: "colorBalance",
            colorBalance: [
              makeTone(op.shadows, "shadows"),
              makeTone(op.midtones, "midtones"),
              makeTone(op.highlights, "highlights")
            ]
          }
        }
      }
    ],
    { synchronousExecution: false, modalBehavior: "execute" }
  );
  return extractNewLayerId(result);
}

async function applySelectiveColor(op) {
  if (!op.colors || !Array.isArray(op.colors) || op.colors.length === 0) {
    throw new Error("selective_color needs a non-empty colors[] array");
  }
  const colorEnumMap = {
    reds: "reds",
    yellows: "yellows",
    greens: "greens",
    cyans: "cyans",
    blues: "blues",
    magentas: "magentas",
    whites: "whites",
    neutrals: "neutrals",
    blacks: "blacks"
  };
  const colorList = op.colors.map(c => ({
    _obj: "selectiveColorAdj",
    colors: { _enum: "colors", _value: colorEnumMap[c.color] || "reds" },
    cyan: c.cyan || 0,
    magenta: c.magenta || 0,
    yellow: c.yellow || 0,
    black: c.black || 0
  }));
  const result = await batchPlay(
    [
      {
        _obj: "make",
        _target: [{ _ref: "adjustmentLayer" }],
        using: {
          _obj: "adjustmentLayer",
          name: op.name || "Selective Color",
          type: {
            _obj: "selectiveColor",
            method: { _enum: "correctionMethod", _value: "relative" },
            colorCorrection: colorList
          }
        }
      }
    ],
    { synchronousExecution: false, modalBehavior: "execute" }
  );
  return extractNewLayerId(result);
}

async function applyDodgeBurn(op) {
  const result = await batchPlay(
    [
      {
        _obj: "make",
        _target: [{ _ref: "layer" }],
        using: {
          _obj: "layer",
          name: op.name || "Dodge & Burn",
          mode: { _enum: "blendMode", _value: "softLight" },
          opacity: { _unit: "percentUnit", _value: 100 },
          fillContents: { _enum: "fillContents", _value: "gray" }
        }
      }
    ],
    { synchronousExecution: false, modalBehavior: "execute" }
  );
  await batchPlay(
    [
      {
        _obj: "fill",
        using: { _enum: "fillContents", _value: "gray" },
        opacity: { _unit: "percentUnit", _value: 100 },
        mode: { _enum: "blendMode", _value: "normal" }
      }
    ],
    { synchronousExecution: false, modalBehavior: "execute" }
  );
  return extractNewLayerId(result);
}
