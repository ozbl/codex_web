const THEME_KEY = "codex-web-theme";

const terminalThemes = {
  dark: {
    background: "#050816",
    foreground: "#e7eef9",
    cursor: "#4ade80",
    selectionBackground: "rgba(125, 211, 252, 0.22)",
  },
  light: {
    background: "#f1f6fc",
    foreground: "#102033",
    cursor: "#0f766e",
    selectionBackground: "rgba(29, 78, 216, 0.18)",
    black: "#1f2937",
    red: "#b42318",
    green: "#166534",
    yellow: "#a16207",
    blue: "#1d4ed8",
    magenta: "#a21caf",
    cyan: "#0f766e",
    white: "#64748b",
    brightBlack: "#475569",
    brightRed: "#912018",
    brightGreen: "#14532d",
    brightYellow: "#854d0e",
    brightBlue: "#1e40af",
    brightMagenta: "#86198f",
    brightCyan: "#155e75",
    brightWhite: "#0f172a",
  },
};

const workspaceTitles = {
  console: { eyebrow: "Console", title: "控制台" },
  sessions: { eyebrow: "Sessions", title: "会话" },
  connections: { eyebrow: "Connections", title: "连接" },
};

const initialTheme = loadThemePreference();
document.body.dataset.theme = initialTheme;

const term = new Terminal({
  cursorBlink: true,
  fontSize: 14,
  fontFamily: "Cascadia Code, Consolas, monospace",
  theme: terminalThemes[initialTheme],
  scrollback: 5000,
});
const fitAddon = new FitAddon.FitAddon();
term.loadAddon(fitAddon);
term.open(document.getElementById("terminal"));
fitAddon.fit();
term.focus();
configureImeSupport();

const els = {
  panelBackdrop: document.getElementById("panelBackdrop"),
  workspacePopup: document.getElementById("workspacePopup"),
  workspacePopupCloseBtn: document.getElementById("workspacePopupCloseBtn"),
  workspacePopupEyebrow: document.getElementById("workspacePopupEyebrow"),
  workspacePopupTitle: document.getElementById("workspacePopupTitle"),
  fileTreePopup: document.getElementById("fileTreePopup"),
  fileTreePopupCloseBtn: document.getElementById("fileTreePopupCloseBtn"),
  consolePanelBtn: document.getElementById("consolePanelBtn"),
  sessionsPanelBtn: document.getElementById("sessionsPanelBtn"),
  connectionsPanelBtn: document.getElementById("connectionsPanelBtn"),
  fileTreePanelBtn: document.getElementById("fileTreePanelBtn"),
  sessionsBadge: document.getElementById("sessionsBadge"),
  popupViews: Array.from(document.querySelectorAll(".popup-view")),
  newShellBtn: document.getElementById("newShellBtn"),
  tokenInput: document.getElementById("tokenInput"),
  cwdInput: document.getElementById("cwdInput"),
  browseDirBtn: document.getElementById("browseDirBtn"),
  argsInput: document.getElementById("argsInput"),
  createBtn: document.getElementById("createBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  ctrlCBtn: document.getElementById("ctrlCBtn"),
  stopBtn: document.getElementById("stopBtn"),
  configHint: document.getElementById("configHint"),
  sidebarSessionList: document.getElementById("sidebarSessionList"),
  sessionCount: document.getElementById("sessionCount"),
  sidebarSessionCount: document.getElementById("sidebarSessionCount"),
  addressList: document.getElementById("addressList"),
  sessionMetaLabel: document.getElementById("sessionMetaLabel"),
  rootDirStat: document.getElementById("rootDirStat"),
  themeToggleBtn: document.getElementById("themeToggleBtn"),
  themeToggleIcon: document.getElementById("themeToggleIcon"),
  directoryModal: document.getElementById("directoryModal"),
  closeDirModalBtn: document.getElementById("closeDirModalBtn"),
  directoryCurrentPath: document.getElementById("directoryCurrentPath"),
  directoryList: document.getElementById("directoryList"),
  dirUpBtn: document.getElementById("dirUpBtn"),
  dirSelectBtn: document.getElementById("dirSelectBtn"),
  newDirNameInput: document.getElementById("newDirNameInput"),
  createDirBtn: document.getElementById("createDirBtn"),
  fileTreeCurrentPath: document.getElementById("fileTreeCurrentPath"),
  fileTreeList: document.getElementById("fileTreeList"),
  fileTreeUpBtn: document.getElementById("fileTreeUpBtn"),
  fileTreeUseBtn: document.getElementById("fileTreeUseBtn"),
  fileTreeRefreshBtn: document.getElementById("fileTreeRefreshBtn"),
  fileTreeNewDirInput: document.getElementById("fileTreeNewDirInput"),
  fileTreeCreateDirBtn: document.getElementById("fileTreeCreateDirBtn"),
};

let config = null;
let socket = null;
let currentSessionId = null;
let currentSession = null;
let currentDirectoryBrowserPath = null;
let currentFileTreePath = null;
let currentFileTreeParent = null;
let activeWorkspaceView = "console";
let openPanel = null;
let desktopImeText = "";
let desktopImeComposing = false;
let desktopImeRecentlyHandled = false;

function setNodeText(node, value) {
  if (node) {
    node.textContent = value;
  }
}

function configureImeSupport() {
  if (!term.textarea) {
    return;
  }
  term.textarea.setAttribute("inputmode", "text");
  term.textarea.setAttribute("autocapitalize", "off");
  term.textarea.setAttribute("autocomplete", "off");
  term.textarea.setAttribute("spellcheck", "false");
  term.textarea.setAttribute("lang", "zh-CN");

  if (window.matchMedia("(pointer: coarse)").matches) {
    return;
  }

  const clearImeTextarea = () => {
    if (term.textarea) {
      term.textarea.value = "";
    }
  };

  const forwardImeText = (text) => {
    if (!text) {
      return;
    }
    desktopImeRecentlyHandled = true;
    sendTerminalInput(text);
    clearImeTextarea();
    setTimeout(() => {
      desktopImeRecentlyHandled = false;
    }, 30);
  };

  term.textarea.addEventListener("beforeinput", (event) => {
    const inputEvent = event;
    const text = inputEvent.data || "";
    const isInsert = String(inputEvent.inputType || "").startsWith("insert");
    const hasNonAscii = /[^\u0000-\u007f]/.test(text);
    if (!isInsert || !hasNonAscii) {
      return;
    }
    event.preventDefault();
    desktopImeComposing = false;
    desktopImeText = "";
    forwardImeText(text);
  }, true);

  term.textarea.addEventListener("compositionstart", () => {
    desktopImeComposing = true;
    desktopImeText = "";
  });

  term.textarea.addEventListener("compositionupdate", (event) => {
    desktopImeText = event.data || term.textarea.value || "";
  });

  term.textarea.addEventListener("compositionend", (event) => {
    desktopImeComposing = false;
    const committedText = event.data || term.textarea.value || desktopImeText;
    desktopImeText = "";
    if (!committedText) {
      return;
    }
    if (desktopImeRecentlyHandled) {
      clearImeTextarea();
      return;
    }
    if (/[^\u0000-\u007f]/.test(committedText)) {
      setTimeout(() => forwardImeText(committedText), 0);
    }
  });
}

function loadThemePreference() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") {
    return saved;
  }
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  term.options.theme = terminalThemes[theme];
  els.themeToggleIcon.className = theme === "dark" ? "fa-regular fa-sun" : "fa-regular fa-moon";
  els.themeToggleBtn.setAttribute("title", theme === "dark" ? "切到日间" : "切到夜间");
  els.themeToggleBtn.setAttribute("aria-label", theme === "dark" ? "切到日间" : "切到夜间");
  setTimeout(() => fitAddon.fit(), 60);
}

function updateTopbarTabs() {
  els.consolePanelBtn.classList.toggle("is-active", openPanel === "workspace" && activeWorkspaceView === "console");
  els.sessionsPanelBtn.classList.toggle("is-active", openPanel === "workspace" && activeWorkspaceView === "sessions");
  els.connectionsPanelBtn.classList.toggle("is-active", openPanel === "workspace" && activeWorkspaceView === "connections");
  els.fileTreePanelBtn.classList.toggle("is-active", openPanel === "filetree");
}

function updateBackdrop() {
  els.panelBackdrop.classList.toggle("hidden", !openPanel);
}

function closePanels() {
  openPanel = null;
  els.workspacePopup.classList.add("hidden");
  els.workspacePopup.setAttribute("aria-hidden", "true");
  els.fileTreePopup.classList.add("hidden");
  els.fileTreePopup.setAttribute("aria-hidden", "true");
  updateTopbarTabs();
  updateBackdrop();
  setTimeout(() => fitAddon.fit(), 40);
}

function openWorkspacePanel(view) {
  activeWorkspaceView = view;
  const heading = workspaceTitles[view];
  setNodeText(els.workspacePopupEyebrow, heading.eyebrow);
  setNodeText(els.workspacePopupTitle, heading.title);
  for (const panel of els.popupViews) {
    panel.classList.toggle("hidden", panel.dataset.viewPanel !== view);
  }
  openPanel = "workspace";
  els.fileTreePopup.classList.add("hidden");
  els.fileTreePopup.setAttribute("aria-hidden", "true");
  els.workspacePopup.classList.remove("hidden");
  els.workspacePopup.setAttribute("aria-hidden", "false");
  updateTopbarTabs();
  updateBackdrop();
}

function openFileTreePanel() {
  openPanel = "filetree";
  els.workspacePopup.classList.add("hidden");
  els.workspacePopup.setAttribute("aria-hidden", "true");
  els.fileTreePopup.classList.remove("hidden");
  els.fileTreePopup.setAttribute("aria-hidden", "false");
  updateTopbarTabs();
  updateBackdrop();
}

function getToken() {
  return els.tokenInput.value.trim();
}

function setStatus(text) {
  const sessionPrefix = currentSession ? currentSession.id.slice(0, 8) : "未连接";
  setNodeText(els.sessionMetaLabel, `${sessionPrefix} · ${text}`);
}

function apiHeaders() {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) {
    headers["x-codex-token"] = token;
  }
  return headers;
}

function setActiveSession(session) {
  currentSession = session || null;
  currentSessionId = session?.id || null;
  if (session) {
    setStatus(session.status === "running" ? "运行中" : `已退出 (${session.exitCode ?? "-"})`);
    if (session.cwd) {
      els.cwdInput.value = session.cwd;
      loadFileTree(session.cwd).catch((error) => {
        printSystemLine(`文件树刷新失败: ${error.message}`);
      });
    }
  } else {
    setStatus("空闲");
  }
  els.ctrlCBtn.disabled = !session || session.status !== "running";
  els.stopBtn.disabled = !session;
}

async function requestJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...apiHeaders(),
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      message = body.error || message;
    } catch {}
    throw new Error(message);
  }

  if (res.status === 204) {
    return null;
  }
  return res.json();
}

function printSystemLine(text) {
  const color = document.body.dataset.theme === "light" ? 30 : 36;
  term.writeln(`\r\n\x1b[${color}m${text}\x1b[0m`);
}

function quotePowerShell(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildCodexCommand() {
  const cwd = els.cwdInput.value.trim();
  const defaultArgs = (config?.defaultArgs || "").trim().split(/\s+/).filter(Boolean);
  const args = els.argsInput.value.trim().split(/\s+/).filter(Boolean);
  const commandParts = [];

  if (cwd) {
    commandParts.push(`Set-Location -LiteralPath ${quotePowerShell(cwd)}`);
  }

  const codexArgs = [...defaultArgs, ...args].map(quotePowerShell).join(" ");
  commandParts.push(`codex ${codexArgs}`.trim());
  return commandParts.join("; ");
}

function canReuseCurrentSession() {
  return Boolean(
    currentSession &&
      currentSession.status === "running" &&
      currentSession.autoStartCodex === false &&
      socket &&
      socket.readyState === WebSocket.OPEN
  );
}

function sendTerminalInput(data) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "input", data }));
  }
}

function updateCurrentSessionCwd(cwd) {
  if (!currentSession) {
    return;
  }
  currentSession.cwd = cwd;
}

function syncShellCwd(cwd) {
  if (!cwd || !canReuseCurrentSession()) {
    return;
  }
  sendTerminalInput(`Set-Location -LiteralPath ${quotePowerShell(cwd)}\r`);
  updateCurrentSessionCwd(cwd);
}

function openDirectoryModal() {
  els.directoryModal.classList.remove("hidden");
  els.directoryModal.setAttribute("aria-hidden", "false");
  els.newDirNameInput.value = "";
}

function closeDirectoryModal() {
  els.directoryModal.classList.add("hidden");
  els.directoryModal.setAttribute("aria-hidden", "true");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatFileSize(size) {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

async function fetchDirectoryPayload(targetPath) {
  const url = new URL("/api/directories", window.location.origin);
  if (targetPath) {
    url.searchParams.set("path", targetPath);
  }
  return requestJson(`${url.pathname}${url.search}`);
}

function renderDirectoryItems(container, payload, { includeFiles, onDirectoryClick }) {
  container.innerHTML = "";

  if (payload.directories.length === 0 && (!includeFiles || payload.files.length === 0)) {
    const empty = document.createElement("div");
    empty.className = "file-tree-empty";
    setNodeText(empty, "当前目录为空。");
    container.appendChild(empty);
    return;
  }

  for (const directory of payload.directories) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "file-tree-item file-tree-folder ghost";
    item.innerHTML = `
      <div class="file-tree-main">
        <div class="directory-name-row">
          <i class="fa-regular fa-folder" aria-hidden="true"></i>
          <strong>${escapeHtml(directory.name)}</strong>
        </div>
        <small>${escapeHtml(directory.path)}</small>
      </div>
      <i class="fa-solid fa-chevron-right nav-icon" aria-hidden="true"></i>
    `;
    item.addEventListener("click", () => onDirectoryClick(directory.path));
    container.appendChild(item);
  }

  if (!includeFiles) {
    return;
  }

  for (const file of payload.files) {
    const item = document.createElement("div");
    item.className = "file-tree-item file-tree-file";
    item.innerHTML = `
      <div class="file-tree-main">
        <div class="directory-name-row">
          <i class="fa-regular fa-file-lines" aria-hidden="true"></i>
          <strong>${escapeHtml(file.name)}</strong>
        </div>
        <small>${formatFileSize(file.size)}</small>
      </div>
    `;
    container.appendChild(item);
  }
}

async function loadDirectories(targetPath) {
  const payload = await fetchDirectoryPayload(targetPath);
  currentDirectoryBrowserPath = payload.current;
  setNodeText(els.directoryCurrentPath, payload.current);
  els.dirUpBtn.disabled = !payload.parent;
  renderDirectoryItems(els.directoryList, payload, {
    includeFiles: false,
    onDirectoryClick: (path) => {
      loadDirectories(path).catch((error) => printSystemLine(`目录读取失败: ${error.message}`));
    },
  });
  return payload;
}

async function loadFileTree(targetPath) {
  const payload = await fetchDirectoryPayload(targetPath || els.cwdInput.value.trim() || config.defaultCwd);
  currentFileTreePath = payload.current;
  currentFileTreeParent = payload.parent;
  els.cwdInput.value = payload.current;
  setNodeText(els.fileTreeCurrentPath, payload.current);
  els.fileTreeUpBtn.disabled = !payload.parent;
  renderDirectoryItems(els.fileTreeList, payload, {
    includeFiles: true,
    onDirectoryClick: (path) => {
      loadFileTree(path).catch((error) => printSystemLine(`文件树切换失败: ${error.message}`));
    },
  });
  return payload;
}

function renderAddresses(addresses) {
  els.addressList.innerHTML = "";

  const list = addresses.length ? addresses : [`127.0.0.1:${config.port}`];
  for (const address of list) {
    const item = document.createElement("div");
    item.className = "address-item";
    setNodeText(
      item,
      address.includes(":") && !address.includes(".")
        ? `http://${address}`
        : address.startsWith("127.0.0.1")
          ? `http://${address}`
          : `http://${address}:${config.port}`
    );
    els.addressList.appendChild(item);
  }
}

function renderSessions(sessions) {
  setNodeText(els.sessionCount, String(sessions.length));
  setNodeText(els.sidebarSessionCount, String(sessions.length));
  setNodeText(els.sessionsBadge, String(sessions.length));
  els.sidebarSessionList.innerHTML = "";

  if (sessions.length === 0) {
    const empty = document.createElement("div");
    empty.className = "session-card";
    empty.innerHTML = `<div class="session-meta">当前没有活动会话。打开页面时会自动连到一个 PowerShell 会话。</div>`;
    els.sidebarSessionList.appendChild(empty);
    return;
  }

  for (const session of sessions) {
    const card = document.createElement("div");
    card.className = "session-card";
    card.innerHTML = `
      <div class="session-title">
        <strong>${session.id.slice(0, 8)}</strong>
        <span class="pill">${session.status}</span>
      </div>
      <div class="session-meta">目录: ${session.cwd}</div>
      <div class="session-meta">模式: ${session.autoStartCodex ? "Codex" : "PowerShell"}</div>
      <div class="session-meta">参数: ${session.args.join(" ") || "(无)"}</div>
      <div class="session-meta">客户端: ${session.clients} · 创建: ${new Date(session.createdAt).toLocaleString()}</div>
      <div class="actions">
        <button class="attach-btn" type="button">
          <i class="fa-solid fa-plug" aria-hidden="true"></i>
          <span>连接</span>
        </button>
        <button class="ghost terminate-btn" type="button">
          <i class="fa-solid fa-trash-can" aria-hidden="true"></i>
          <span>关闭</span>
        </button>
      </div>
    `;
    card.querySelector(".attach-btn").addEventListener("click", () => {
      attachSession(session);
      closePanels();
    });
    card.querySelector(".terminate-btn").addEventListener("click", async () => {
      try {
        await requestJson(`/api/sessions/${session.id}`, { method: "DELETE" });
        if (currentSessionId === session.id) {
          disconnectSocket();
          term.clear();
          setActiveSession(null);
        }
        await loadSessions();
      } catch (error) {
        printSystemLine(`关闭失败: ${error.message}`);
      }
    });
    els.sidebarSessionList.appendChild(card);
  }
}

function disconnectSocket() {
  if (socket) {
    socket.onopen = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.onmessage = null;
    socket.close();
    socket = null;
  }
}

function attachSession(session) {
  disconnectSocket();
  setActiveSession(session);
  term.clear();
  printSystemLine(`连接会话 ${session.id}`);

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = new URL(`${protocol}//${location.host}/ws`);
  wsUrl.searchParams.set("sessionId", session.id);
  const token = getToken();
  if (token) {
    wsUrl.searchParams.set("token", token);
  }

  socket = new WebSocket(wsUrl);
  socket.onopen = () => {
    fitAddon.fit();
    term.focus();
    socket.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
  };
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "output") {
      term.write(message.data);
    } else if (message.type === "ready") {
      setActiveSession(message.session);
    } else if (message.type === "exit") {
      setStatus(`已退出 (${message.exitCode ?? "-"})`);
      els.ctrlCBtn.disabled = true;
      printSystemLine(`会话已退出，退出码 ${message.exitCode ?? "-"}`);
      loadSessions().catch((error) => printSystemLine(`刷新失败: ${error.message}`));
    }
  };
  socket.onclose = () => {
    socket = null;
  };
  socket.onerror = () => {
    printSystemLine("WebSocket 连接失败");
  };
}

term.onData((data) => {
  if (desktopImeComposing || desktopImeRecentlyHandled) {
    return;
  }
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "input", data }));
  }
});

document.getElementById("terminal").addEventListener("click", () => {
  term.focus();
});

window.addEventListener("resize", () => {
  closePanels();
  fitAddon.fit();
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
  }
});

async function loadConfig() {
  config = await requestJson("/api/config");
  els.cwdInput.value = config.defaultCwd;
  els.argsInput.value = "";
  setNodeText(els.rootDirStat, config.rootDir);
  setNodeText(els.configHint, `允许根目录: ${config.rootDir}。默认会自动附加参数: ${config.defaultArgs || "(无)"}`);
  renderAddresses(config.addresses || []);
  await loadFileTree(config.defaultCwd);
}

async function loadSessions() {
  const sessions = await requestJson("/api/sessions");
  renderSessions(sessions);
  if (currentSessionId) {
    const matched = sessions.find((session) => session.id === currentSessionId);
    if (!matched) {
      setActiveSession(null);
      disconnectSocket();
    }
  }
  return sessions;
}

async function createShellSession() {
  return requestJson("/api/sessions", {
    method: "POST",
    body: JSON.stringify({
      cwd: els.cwdInput.value.trim(),
      args: "",
      autoStartCodex: false,
    }),
  });
}

async function ensureDefaultShellSession() {
  const sessions = await loadSessions();
  if (currentSessionId) {
    const current = sessions.find((session) => session.id === currentSessionId);
    if (current) {
      attachSession(current);
      return;
    }
  }
  const runningShellSession = sessions.find(
    (session) => session.status === "running" && session.autoStartCodex === false
  );
  if (runningShellSession) {
    attachSession(runningShellSession);
    return;
  }
  const shellSession = await createShellSession();
  await loadSessions();
  attachSession(shellSession);
}

els.consolePanelBtn.addEventListener("click", () => {
  if (openPanel === "workspace" && activeWorkspaceView === "console") {
    closePanels();
  } else {
    openWorkspacePanel("console");
  }
});

els.sessionsPanelBtn.addEventListener("click", () => {
  if (openPanel === "workspace" && activeWorkspaceView === "sessions") {
    closePanels();
  } else {
    openWorkspacePanel("sessions");
  }
});

els.connectionsPanelBtn.addEventListener("click", () => {
  if (openPanel === "workspace" && activeWorkspaceView === "connections") {
    closePanels();
  } else {
    openWorkspacePanel("connections");
  }
});

els.fileTreePanelBtn.addEventListener("click", () => {
  if (openPanel === "filetree") {
    closePanels();
  } else {
    openFileTreePanel();
  }
});

els.workspacePopupCloseBtn.addEventListener("click", closePanels);
els.fileTreePopupCloseBtn.addEventListener("click", closePanels);
els.panelBackdrop.addEventListener("click", closePanels);

els.createBtn.addEventListener("click", async () => {
  try {
    if (canReuseCurrentSession()) {
      sendTerminalInput(`${buildCodexCommand()}\r`);
      printSystemLine("已在当前会话中运行 Codex。");
      closePanels();
      return;
    }
    const session = await requestJson("/api/sessions", {
      method: "POST",
      body: JSON.stringify({
        cwd: els.cwdInput.value.trim(),
        args: els.argsInput.value.trim(),
        autoStartCodex: true,
      }),
    });
    await loadSessions();
    attachSession(session);
    closePanels();
  } catch (error) {
    printSystemLine(`启动失败: ${error.message}`);
  }
});

els.newShellBtn.addEventListener("click", async () => {
  try {
    const session = await createShellSession();
    await loadSessions();
    attachSession(session);
  } catch (error) {
    printSystemLine(`新建会话失败: ${error.message}`);
  }
});

els.browseDirBtn.addEventListener("click", async () => {
  try {
    openDirectoryModal();
    await loadDirectories(els.cwdInput.value.trim() || config.defaultCwd);
  } catch (error) {
    closeDirectoryModal();
    printSystemLine(`打开目录选择器失败: ${error.message}`);
  }
});

els.refreshBtn.addEventListener("click", () => {
  loadSessions().catch((error) => printSystemLine(`刷新失败: ${error.message}`));
});

els.ctrlCBtn.addEventListener("click", () => {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "signal", signal: "ctrl_c" }));
  }
});

els.stopBtn.addEventListener("click", async () => {
  if (!currentSessionId) {
    return;
  }
  try {
    await requestJson(`/api/sessions/${currentSessionId}`, { method: "DELETE" });
    disconnectSocket();
    term.clear();
    setActiveSession(null);
    await loadSessions();
  } catch (error) {
    printSystemLine(`关闭失败: ${error.message}`);
  }
});

els.themeToggleBtn.addEventListener("click", () => {
  const nextTheme = document.body.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
});

els.closeDirModalBtn.addEventListener("click", closeDirectoryModal);

els.dirUpBtn.addEventListener("click", async () => {
  try {
    if (currentDirectoryBrowserPath) {
      const current = await fetchDirectoryPayload(currentDirectoryBrowserPath);
      if (current.parent) {
        await loadDirectories(current.parent);
      }
    }
  } catch (error) {
    printSystemLine(`返回上级失败: ${error.message}`);
  }
});

els.dirSelectBtn.addEventListener("click", async () => {
  if (currentDirectoryBrowserPath) {
    els.cwdInput.value = currentDirectoryBrowserPath;
    await loadFileTree(currentDirectoryBrowserPath);
    syncShellCwd(currentDirectoryBrowserPath);
  }
  closeDirectoryModal();
});

els.createDirBtn.addEventListener("click", async () => {
  const name = els.newDirNameInput.value.trim();
  if (!name) {
    printSystemLine("请输入新文件夹名称");
    return;
  }
  try {
    const created = await requestJson("/api/directories", {
      method: "POST",
      body: JSON.stringify({
        path: currentDirectoryBrowserPath,
        name,
      }),
    });
    els.newDirNameInput.value = "";
    await loadDirectories(created.path);
    await loadFileTree(created.path);
    printSystemLine(`已创建文件夹: ${created.path}`);
  } catch (error) {
    printSystemLine(`新建文件夹失败: ${error.message}`);
  }
});

els.newDirNameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    els.createDirBtn.click();
  }
});

els.directoryModal.addEventListener("click", (event) => {
  const target = event.target;
  if (target instanceof HTMLElement && target.dataset.closeModal === "true") {
    closeDirectoryModal();
  }
});

els.fileTreeUpBtn.addEventListener("click", async () => {
  if (!currentFileTreeParent) {
    return;
  }
  try {
    await loadFileTree(currentFileTreeParent);
  } catch (error) {
    printSystemLine(`文件树返回上级失败: ${error.message}`);
  }
});

els.fileTreeUseBtn.addEventListener("click", () => {
  if (currentFileTreePath) {
    els.cwdInput.value = currentFileTreePath;
    syncShellCwd(currentFileTreePath);
    closePanels();
  }
});

els.fileTreeRefreshBtn.addEventListener("click", () => {
  loadFileTree(currentFileTreePath || els.cwdInput.value.trim())
    .catch((error) => printSystemLine(`文件树刷新失败: ${error.message}`));
});

els.fileTreeCreateDirBtn.addEventListener("click", async () => {
  const name = els.fileTreeNewDirInput.value.trim();
  if (!name) {
    printSystemLine("请输入新文件夹名称");
    return;
  }
  try {
    const created = await requestJson("/api/directories", {
      method: "POST",
      body: JSON.stringify({
        path: currentFileTreePath || els.cwdInput.value.trim() || config.defaultCwd,
        name,
      }),
    });
    els.fileTreeNewDirInput.value = "";
    await loadFileTree(created.path);
    printSystemLine(`已创建文件夹: ${created.path}`);
  } catch (error) {
    printSystemLine(`新建文件夹失败: ${error.message}`);
  }
});

els.fileTreeNewDirInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    els.fileTreeCreateDirBtn.click();
  }
});

els.cwdInput.addEventListener("change", () => {
  const cwd = els.cwdInput.value.trim();
  loadFileTree(cwd)
    .then(() => syncShellCwd(cwd))
    .catch((error) => printSystemLine(`文件树刷新失败: ${error.message}`));
});

(async () => {
  try {
    applyTheme(initialTheme);
    closePanels();
    await loadConfig();
    await ensureDefaultShellSession();
    printSystemLine("准备就绪。顶部按钮可打开控制台、会话、连接和文件树弹窗。");
  } catch (error) {
    printSystemLine(`初始化失败: ${error.message}`);
  }
})();
