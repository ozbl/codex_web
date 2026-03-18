const express = require("express");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const pty = require("node-pty");
const { v4: uuidv4 } = require("uuid");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

function staticNoCache(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
}

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number.parseInt(process.env.PORT || "3100", 10);
const SESSION_TTL_MS = Number.parseInt(
  process.env.SESSION_TTL_MS || String(12 * 60 * 60 * 1000),
  10,
);
const ACCESS_TOKEN = process.env.CODEX_WEB_TOKEN || "";
const ROOT_DIR = path.resolve(process.env.CODEX_ALLOWED_ROOT || process.cwd());
const DEFAULT_CWD = path.resolve(process.env.CODEX_DEFAULT_CWD || ROOT_DIR);
const DEFAULT_CODEX_ARGS = parseArgString(
  process.env.CODEX_DEFAULT_ARGS || "--no-alt-screen",
);
const MAX_SESSIONS = Number.parseInt(process.env.MAX_SESSIONS || "8", 10);

const sessions = new Map();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public"), { setHeaders: staticNoCache }));
app.use(
  "/vendor/xterm",
  express.static(path.join(__dirname, "node_modules", "@xterm", "xterm"), { setHeaders: staticNoCache }),
);
app.use(
  "/vendor/xterm-addon-fit",
  express.static(path.join(__dirname, "node_modules", "@xterm", "addon-fit"), { setHeaders: staticNoCache }),
);
app.use(
  "/vendor/fontawesome",
  express.static(path.join(__dirname, "node_modules", "@fortawesome", "fontawesome-free"), { setHeaders: staticNoCache }),
);

function parseArgString(input) {
  const source = String(input || "").trim();
  if (!source) {
    return [];
  }

  const result = [];
  const regex = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|[^\s]+/g;
  let match;
  while ((match = regex.exec(source)) !== null) {
    const token = match[1] ?? match[2] ?? match[0];
    result.push(token.replace(/\\(["'])/g, "$1"));
  }
  return result;
}

function isWithinRoot(targetPath) {
  const resolved = path.resolve(targetPath);
  const relative = path.relative(ROOT_DIR, resolved);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeRequestedPath(targetPath) {
  return path.resolve(targetPath || ROOT_DIR);
}

function getDirectoryPayload(targetPath) {
  const resolved = normalizeRequestedPath(targetPath);
  if (!isWithinRoot(resolved)) {
    throw new Error(`Directory must stay inside ${ROOT_DIR}`);
  }

  const dirEntries = fs
    .readdirSync(resolved, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      path: path.join(resolved, entry.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));

  const fileEntries = fs
    .readdirSync(resolved, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const filePath = path.join(resolved, entry.name);
      const stats = fs.statSync(filePath);
      return {
        name: entry.name,
        path: filePath,
        size: stats.size,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));

  const parentPath = resolved === ROOT_DIR ? null : path.dirname(resolved);
  return {
    root: ROOT_DIR,
    current: resolved,
    parent: parentPath && isWithinRoot(parentPath) ? parentPath : null,
    directories: dirEntries,
    files: fileEntries,
  };
}

function validateDirectoryName(name) {
  const normalized = String(name || "").trim();
  if (!normalized) {
    throw new Error("Folder name is required");
  }
  if (normalized === "." || normalized === "..") {
    throw new Error("Invalid folder name");
  }
  if (/[<>:"/\\|?*\u0000-\u001f]/.test(normalized)) {
    throw new Error("Folder name contains invalid characters");
  }
  return normalized;
}

function createDirectory(targetPath, name) {
  const resolved = normalizeRequestedPath(targetPath);
  if (!isWithinRoot(resolved)) {
    throw new Error(`Directory must stay inside ${ROOT_DIR}`);
  }

  const folderName = validateDirectoryName(name);
  const newPath = path.join(resolved, folderName);
  if (!isWithinRoot(newPath)) {
    throw new Error(`Directory must stay inside ${ROOT_DIR}`);
  }
  if (fs.existsSync(newPath)) {
    throw new Error("Folder already exists");
  }

  fs.mkdirSync(newPath, { recursive: false });
  return {
    name: folderName,
    path: newPath,
  };
}

function shellQuoteSingle(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function startCodexInsideShell(terminal, cwd, args) {
  if (process.platform === "win32") {
    const command = `Set-Location -LiteralPath ${shellQuoteSingle(cwd)}; codex ${args
      .map(shellQuoteSingle)
      .join(" ")}`.trim();
    setTimeout(() => {
      terminal.write(`${command}\r`);
    }, 80);
    return;
  }

  const escapedArgs = args
    .map((arg) => `'${String(arg).replace(/'/g, `'\\''`)}'`)
    .join(" ");
  const command = `cd '${cwd.replace(/'/g, `'\\''`)}' && codex ${escapedArgs}`.trim();
  setTimeout(() => {
    terminal.write(`${command}\n`);
  }, 80);
}

function validateToken(req) {
  if (!ACCESS_TOKEN) {
    return true;
  }
  const headerToken = req.headers["x-codex-token"];
  const queryToken = req.query.token;
  return headerToken === ACCESS_TOKEN || queryToken === ACCESS_TOKEN;
}

function authGuard(req, res, next) {
  if (validateToken(req)) {
    next();
    return;
  }
  res.status(401).json({ error: "Unauthorized" });
}

function makePublicConfig() {
  return {
    host: HOST,
    port: PORT,
    rootDir: ROOT_DIR,
    defaultCwd: DEFAULT_CWD,
    defaultArgs: DEFAULT_CODEX_ARGS.join(" "),
    tokenRequired: Boolean(ACCESS_TOKEN),
    maxSessions: MAX_SESSIONS,
    addresses: getLocalAddresses(),
  };
}

function getLocalAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        addresses.push(entry.address);
      }
    }
  }
  return [...new Set(addresses)];
}

function publicSession(session) {
  return {
    id: session.id,
    cwd: session.cwd,
    args: session.args,
    autoStartCodex: session.autoStartCodex,
    createdAt: session.createdAt,
    endedAt: session.endedAt,
    exitCode: session.exitCode,
    status: session.status,
    clients: session.clients.size,
  };
}

function cleanupSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) {
    return;
  }

  for (const client of session.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.close(1000, "Session ended");
    }
  }

  try {
    session.pty.kill();
  } catch {}

  sessions.delete(sessionId);
}

function scheduleSessionCleanup(session) {
  if (session.cleanupTimer) {
    clearTimeout(session.cleanupTimer);
  }

  session.cleanupTimer = setTimeout(() => {
    cleanupSession(session.id);
  }, SESSION_TTL_MS);
}

function createSession({ cwd, args, autoStartCodex = true }) {
  if (sessions.size >= MAX_SESSIONS) {
    throw new Error(`Too many active sessions. Limit: ${MAX_SESSIONS}`);
  }

  const resolvedCwd = path.resolve(cwd || DEFAULT_CWD);
  if (!isWithinRoot(resolvedCwd)) {
    throw new Error(`Working directory must stay inside ${ROOT_DIR}`);
  }

  const finalArgs = autoStartCodex ? [...DEFAULT_CODEX_ARGS, ...args] : [];
  const shellCommand = process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "bash";
  const shellArgs = process.platform === "win32" ? ["-NoLogo"] : ["-i"];
  const terminal = pty.spawn(shellCommand, shellArgs, {
    name: "xterm-256color",
    cols: 120,
    rows: 32,
    cwd: resolvedCwd,
    env: {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    },
  });

  const session = {
    id: uuidv4(),
    cwd: resolvedCwd,
    args: finalArgs,
    autoStartCodex,
    createdAt: new Date().toISOString(),
    endedAt: null,
    exitCode: null,
    status: "running",
    pty: terminal,
    clients: new Set(),
    resizeController: null,
    cleanupTimer: null,
  };

  terminal.onData((data) => {
    for (const client of session.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: "output", data }));
      }
    }
  });

  terminal.onExit(({ exitCode }) => {
    session.status = "exited";
    session.exitCode = exitCode;
    session.endedAt = new Date().toISOString();

    for (const client of session.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: "exit", exitCode }));
      }
    }

    scheduleSessionCleanup(session);
  });

  sessions.set(session.id, session);
  if (autoStartCodex) {
    startCodexInsideShell(terminal, resolvedCwd, finalArgs);
  }
  return session;
}

app.get("/api/config", (req, res) => {
  res.json(makePublicConfig());
});

app.get("/api/sessions", authGuard, (req, res) => {
  res.json([...sessions.values()].map(publicSession));
});

app.get("/api/directories", authGuard, (req, res) => {
  try {
    res.json(getDirectoryPayload(req.query.path));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/directories", authGuard, (req, res) => {
  try {
    const directory = createDirectory(req.body?.path, req.body?.name);
    res.status(201).json(directory);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/sessions", authGuard, (req, res) => {
  try {
    const cwd = req.body?.cwd || DEFAULT_CWD;
    const args = parseArgString(req.body?.args || "");
    const autoStartCodex = req.body?.autoStartCodex !== false;
    const session = createSession({ cwd, args, autoStartCodex });
    res.status(201).json(publicSession(session));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete("/api/sessions/:id", authGuard, (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  cleanupSession(session.id);
  res.status(204).end();
});

app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    next();
    return;
  }
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const sessionId = url.searchParams.get("sessionId");
  if (!sessionId || !sessions.has(sessionId)) {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }

  if (ACCESS_TOKEN && url.searchParams.get("token") !== ACCESS_TOKEN) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req, sessionId);
  });
});

wss.on("connection", (ws, _req, sessionId) => {
  const session = sessions.get(sessionId);
  if (!session) {
    ws.close(1008, "Session not found");
    return;
  }

  if (session.cleanupTimer) {
    clearTimeout(session.cleanupTimer);
    session.cleanupTimer = null;
  }

  session.clients.add(ws);
  if (!session.resizeController) {
    session.resizeController = ws;
  }
  ws.send(JSON.stringify({ type: "ready", session: publicSession(session) }));

  ws.on("message", (buffer) => {
    try {
      const message = JSON.parse(buffer.toString());
      if (message.type === "input") {
        session.pty.write(message.data);
      } else if (message.type === "resize") {
        if (session.resizeController === ws) {
          session.pty.resize(
            Number.parseInt(message.cols, 10) || 120,
            Number.parseInt(message.rows, 10) || 32,
          );
        }
      } else if (message.type === "signal" && message.signal === "ctrl_c") {
        session.pty.write("\u0003");
      }
    } catch {}
  });

  ws.on("close", () => {
    session.clients.delete(ws);
    if (session.resizeController === ws) {
      session.resizeController = session.clients.values().next().value || null;
    }
    if (session.clients.size === 0 && session.status !== "running") {
      scheduleSessionCleanup(session);
    }
  });
});

server.listen(PORT, HOST, () => {
  const addresses = getLocalAddresses();
  console.log(`Codex Web listening on http://127.0.0.1:${PORT}`);
  for (const address of addresses) {
    console.log(`LAN access: http://${address}:${PORT}`);
  }
  console.log(`Allowed root: ${ROOT_DIR}`);
  if (ACCESS_TOKEN) {
    console.log("Access token is enabled via CODEX_WEB_TOKEN.");
  }
});
