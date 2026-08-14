"use strict";

/**
 * DeepSeek Harness Desktop — Electron main process.
 *
 * Responsibilities:
 *  - Resolve a `dsh` CLI (config override -> local node_modules -> npm npx
 *    cache -> PATH -> `npx --yes` fallback).
 *  - Probe for an already-running DSH web server (default 127.0.0.1:3080) and
 *    reuse it; otherwise spawn our own `dsh web --port <n>` server.
 *  - Wait for the server to serve the DSH boot page, then load it in a native
 *    window. On quit, stop the server we started (never one we reused).
 *  - Expose a tiny IPC surface (retry / open-in-browser / server info).
 *  - `--smoke-test` mode: load the GUI, capture a screenshot to disk, print
 *    SMOKE_OK and exit (used to verify the wrapper end to end).
 */

const { app, BrowserWindow, Menu, dialog, shell, ipcMain, session } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const APP_TITLE = "DeepSeek Harness";
const DEFAULT_PORT = 3080;
const PORT_TRIES = 24; // scan 3080..3103 for a free / already-serving port
const BOOT_TIMEOUT_MS = 150 * 1000;
const PROBE_TIMEOUT_MS = 1200;

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------

function appDir() {
  if (app.isPackaged) {
    // portable exe: dir of the exe the user double-clicked (not the temp extract)
    return process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
  }
  return __dirname;
}

function loadConfig() {
  const candidates = [
    path.join(appDir(), "config.json"),
    path.join(app.getPath("userData"), "config.json"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        // strip a UTF-8 BOM if present (PS 5.1 Set-Content -Encoding UTF8 writes one)
        const raw = fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") return parsed;
      }
    } catch (err) {
      console.error(`[dsh-desktop] ignoring bad config ${p}: ${err.message}`);
    }
  }
  return {};
}

const config = loadConfig();

// ---------------------------------------------------------------------------
// toolchain resolution (node + dsh CLI)
// ---------------------------------------------------------------------------

function pathList() {
  return (process.env.PATH || "").split(path.delimiter).filter(Boolean);
}

function findOnPath(exe) {
  const exts = (process.env.PATHEXT || ".EXE;.CMD;.BAT;.PS1").split(";");
  for (const dir of pathList()) {
    for (const ext of ["", ...exts]) {
      const full = path.join(dir, exe + ext);
      try {
        fs.accessSync(full);
        return full;
      } catch {
        /* keep looking */
      }
    }
  }
  return null;
}

function resolveNode() {
  if (config.nodeBin && fs.existsSync(config.nodeBin)) return config.nodeBin;
  const onPath = findOnPath("node");
  return onPath || "node";
}

/** npm cache dir candidates for the `_npx/<hash>/node_modules/...` layout. */
function npmCacheCandidates() {
  const list = [];
  if (config.npmCache) list.push(config.npmCache);
  if (process.env.npm_config_cache) list.push(process.env.npm_config_cache);
  list.push(path.join(os.homedir(), "AppData", "Local", "npm-cache"));
  list.push(path.join(os.homedir(), ".npm", "_npx")); // direct _npx dir
  return list;
}

/** Find `@deepseek-ai/dsh/lib/bin.js` inside any npx cache entry, newest first. */
function findInNpxCache() {
  const found = [];
  for (const base of npmCacheCandidates()) {
    const npxRoot = path.basename(base) === "_npx" ? base : path.join(base, "_npx");
    let entries = [];
    try {
      entries = fs.readdirSync(npxRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const bin = path.join(npxRoot, entry.name, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
      try {
        const st = fs.statSync(bin);
        if (st.isFile()) found.push({ path: bin, mtime: st.mtimeMs });
      } catch {
        /* not this one */
      }
    }
  }
  found.sort((a, b) => b.mtime - a.mtime);
  return found[0] ? found[0].path : null;
}

/**
 * Resolve a way to launch `dsh web --port N`.
 * Returns one of:
 *   { kind: "binjs", path }  -> spawn node <path> web --port N
 *   { kind: "cmd",   path }  -> spawn cmd.exe /c <path> web --port N
 *   { kind: "npx" }          -> spawn npx --yes @deepseek-ai/dsh web --port N
 */
function resolveDshCli() {
  // 1. explicit config override: a path to bin.js, or a command name/path.
  if (config.dshBin) {
    const p = path.resolve(String(config.dshBin));
    if (/bin\.js$/i.test(p) && fs.existsSync(p)) return { kind: "binjs", path: p };
    return { kind: "cmd", path: p };
  }
  // 2. app-local install (npm i @deepseek-ai/dsh inside the app folder).
  const local = path.join(__dirname, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
  if (fs.existsSync(local)) return { kind: "binjs", path: local };
  // 3. npm npx cache (this machine's `npx @deepseek-ai/dsh` install).
  const cached = findInNpxCache();
  if (cached) return { kind: "binjs", path: cached };
  // 4. `dsh` on PATH (npm-style .cmd shim -> derive bin.js, else run the shim).
  const dshCmd = findOnPath("dsh");
  if (dshCmd) {
    const derived = path.join(path.dirname(dshCmd), "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
    if (fs.existsSync(derived)) return { kind: "binjs", path: derived };
    return { kind: "cmd", path: dshCmd };
  }
  // 5. last resort: let npx fetch/run it (needs network on first use).
  return { kind: "npx" };
}

function buildServerCommand(port) {
  const cli = resolveDshCli();
  const args = ["web", "--port", String(port)];
  if (cli.kind === "binjs") return { cmd: resolveNode(), args: [cli.path, ...args], label: `node ${cli.path}` };
  if (cli.kind === "cmd") return { cmd: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", `"${cli.path}" web --port ${port}`], label: cli.path };
  return { cmd: resolveNpx() || "npx", args: ["--yes", "@deepseek-ai/dsh", ...args], label: "npx --yes @deepseek-ai/dsh" };
}

function resolveNpx() {
  if (config.npxBin && fs.existsSync(config.npxBin)) return config.npxBin;
  return findOnPath("npx");
}

// ---------------------------------------------------------------------------
// port probing
// ---------------------------------------------------------------------------

function probeHttp(port, timeoutMs = PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/", timeout: timeoutMs }, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
        if (body.length > 65536) req.destroy();
      });
      res.on("end", () => resolve({ up: true, isDsh: body.includes("__DSH_BOOT__") }));
      res.on("error", () => resolve({ up: true, isDsh: false }));
    });
    req.on("timeout", () => {
      req.destroy();
      resolve({ up: false });
    });
    req.on("error", () => resolve({ up: false }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// server lifecycle
// ---------------------------------------------------------------------------

let serverChild = null;
let serverPort = null;
let serverMode = null; // "spawn" | "reuse"
let serverLogTail = [];
let quitStarted = false;
let serverDied = false;

function serverLogFile() {
  const dir = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "server.log");
}

function appendLog(line) {
  const text = String(line).replace(/\r?\n$/, "");
  if (!text) return;
  serverLogTail.push(text);
  if (serverLogTail.length > 300) serverLogTail.shift();
  try {
    fs.appendFileSync(serverLogFile(), text + "\n");
  } catch {
    /* log dir unavailable — ignore */
  }
  console.log(`[dsh-server] ${text}`);
}

function stopServer() {
  if (serverChild && serverChild.exitCode === null) {
    const pid = serverChild.pid;
    try {
      serverChild.kill();
    } catch {
      /* already gone */
    }
    // Windows: kill the whole process tree (node may have worker threads).
    if (process.platform === "win32" && pid) {
      try {
        spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      } catch {
        /* ignore */
      }
    }
    appendLog("server stop requested");
  }
  serverChild = null;
}

function onServerExited(code, signal) {
  if (quitStarted) return;
  serverDied = true;
  const why = signal ? `signal ${signal}` : `exit code ${code}`;
  appendLog(`server process ended unexpectedly (${why})`);
  if (win && !win.isDestroyed()) {
    showError(`DeepSeek Harness 服务意外退出（${why}）`);
  }
}

/**
 * Ensure a DSH web server is reachable:
 *  - scan ports from the base; reuse an already-serving DSH instance,
 *  - else spawn our own server on the first free port and wait for boot.
 */
async function ensureServer() {
  const basePort = Number(config.port) || DEFAULT_PORT;
  const maxPort = basePort + PORT_TRIES;
  let target = null;

  for (let p = basePort; p < maxPort; p++) {
    const probe = await probeHttp(p);
    if (probe.up) {
      if (probe.isDsh) {
        target = p;
        serverMode = "reuse";
        break;
      }
      // occupied by something else — keep scanning
      continue;
    }
    target = p;
    serverMode = "spawn";
    break;
  }

  if (target === null) {
    throw new Error(`未找到可用端口（${basePort}–${maxPort - 1} 均被占用）`);
  }

  if (serverMode === "reuse") {
    serverPort = target;
    serverDied = false;
    appendLog(`reusing existing DSH server at http://127.0.0.1:${target}`);
    return;
  }

  // --- spawn our own server ---
  const command = buildServerCommand(target);
  const cwd = path.resolve(config.workspaceDir || appDir());
  fs.mkdirSync(cwd, { recursive: true });
  appendLog(`starting: ${command.label} (port ${target}, cwd ${cwd})`);

  const logFd = fs.openSync(serverLogFile(), "a");
  const child = spawn(command.cmd, command.args, {
    cwd,
    windowsHide: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
  });
  serverChild = child;
  child.on("exit", (code, signal) => {
    try {
      fs.closeSync(logFd);
    } catch {
      /* ignore */
    }
    onServerExited(code, signal);
  });
  child.on("error", (err) => {
    appendLog(`failed to spawn server: ${err.message}`);
  });

  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`服务启动失败（退出码 ${child.exitCode}），请查看日志`);
    }
    const probe = await probeHttp(target, 800);
    if (probe.up && probe.isDsh) {
      serverPort = target;
      serverDied = false;
      appendLog(`server ready at http://127.0.0.1:${target}`);
      return;
    }
    await sleep(400);
  }
  throw new Error(`服务在 ${BOOT_TIMEOUT_MS / 1000}s 内未能就绪`);
}

// ---------------------------------------------------------------------------
// window / UI
// ---------------------------------------------------------------------------

let win = null;
const smokeMode = process.argv.includes("--smoke-test");
const smokePortArg = process.argv.find((a) => a.startsWith("--smoke-port="));
const smokePort = smokePortArg ? Number(smokePortArg.split("=")[1]) : null;
const smokeOut = (() => {
  const i = process.argv.findIndex((a) => a.startsWith("--smoke-out="));
  return i >= 0 ? process.argv[i].split("=")[1] : null;
})();

function iconPath() {
  // app.getAppPath() is the asar in packaged mode; __dirname in dev
  const png = path.join(app.getAppPath(), "assets", "icon.png");
  return fs.existsSync(png) ? png : undefined;
}

function serverUrl() {
  return `http://127.0.0.1:${serverPort}`;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    show: false,
    backgroundColor: "#0a0e1a",
    title: APP_TITLE,
    icon: iconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  win.loadFile("loading.html");

  if (!smokeMode) {
    win.once("ready-to-show", () => win.show());
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  win.on("closed", () => {
    win = null;
  });
}

function showError(message) {
  if (!win || win.isDestroyed()) return;
  win.loadFile("error.html", { query: { message: encodeURIComponent(message) } });
}

async function boot() {
  createWindow();
  await runServerAndLoad();
}

async function runServerAndLoad() {
  if (win && !win.isDestroyed()) {
    try {
      win.loadFile("loading.html");
    } catch {
      /* ignore */
    }
  }
  try {
    if (smokePort) config.port = smokePort; // smoke-mode override
    await ensureServer();
    if (win && !win.isDestroyed()) {
      await win.loadURL(serverUrl());
    }
    if (smokeMode) {
      await runSmokeCheck();
    }
  } catch (err) {
    appendLog(`boot error: ${err.message}`);
    showError(err.message);
  }
}

async function runSmokeCheck() {
  try {
    const wc = win ? win.webContents : null;
    if (!wc) throw new Error("no window");
    // wait for the DSH boot marker AND meaningful page content, then settle.
    let got = false;
    for (let i = 0; i < 80; i++) {
      const state = await wc
        .executeJavaScript(`(() => {
          const b = document.body;
          const len = b ? (b.innerText || "").trim().length : 0;
          const boot = !!window.__DSH_BOOT__ || !!document.querySelector('#app, [data-dsh], .dsh-app');
          return { boot, len, title: document.title };
        })()`)
        .catch(() => ({ boot: false, len: 0, title: "" }));
      if (state.boot && state.len > 50) {
        got = true;
        console.log(`SMOKE_DIAG boot=1 len=${state.len} title=${JSON.stringify(state.title)}`);
        break;
      }
      await sleep(500);
    }
    if (!got) await sleep(4000); // still capture whatever rendered
    else await sleep(1500);
    const image = await wc.capturePage();
    const outPath = path.resolve(smokeOut || path.join(appDir(), "smoke.png"));
    fs.writeFileSync(outPath, image.toPNG());
    console.log(`SMOKE_OK mode=${serverMode} port=${serverPort} shot=${outPath}`);
    if (serverMode === "spawn") stopServer(); // app.exit() skips before-quit
    app.exit(0);
  } catch (err) {
    console.error(`SMOKE_FAIL ${err.message}`);
    app.exit(1);
  }
}

// ---------------------------------------------------------------------------
// menu / IPC
// ---------------------------------------------------------------------------

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "应用",
      submenu: [
        { label: "重启 Harness 服务", click: () => { if (serverMode === "spawn") stopServer(); runServerAndLoad(); } },
        { label: "在系统浏览器中打开", click: () => shell.openExternal(`http://127.0.0.1:${serverPort || DEFAULT_PORT}`) },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit", label: "退出" },
      ],
    },
    {
      label: "视图",
      submenu: [
        { role: "reload", label: "重新加载" },
        { role: "forceReload", label: "强制重新加载" },
        { role: "toggleDevTools", label: "开发者工具" },
        { type: "separator" },
        { role: "resetZoom", label: "实际大小" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "全屏" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc() {
  ipcMain.on("dsh:retry", () => {
    serverDied = false;
    runServerAndLoad();
  });
  ipcMain.handle("dsh:server-info", () => ({
    port: serverPort,
    mode: serverMode,
    url: serverPort ? serverUrl() : null,
    logTail: serverLogTail.slice(-40),
  }));
  ipcMain.handle("dsh:open-external", (_e, url) => {
    if (typeof url === "string" && /^https?:/i.test(url)) shell.openExternal(url);
  });
}

// ---------------------------------------------------------------------------
// app lifecycle
// ---------------------------------------------------------------------------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    app.setAppUserModelId("com.dsh.desktop");
    session.defaultSession.on("will-download", (event, item) => {
      const defaultPath = path.join(app.getPath("downloads"), item.getFilename());
      if (win) {
        dialog
          .showSaveDialog(win, { defaultPath })
          .then((r) => {
            if (!r.canceled && r.filePath) item.setSavePath(r.filePath);
          })
          .catch(() => {});
      } else {
        item.setSavePath(defaultPath);
      }
    });
    buildMenu();
    registerIpc();
    boot();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    quitStarted = true;
    if (serverMode === "spawn") stopServer();
  });

  app.on("will-quit", () => {
    quitStarted = true;
    if (serverMode === "spawn") stopServer();
  });
}
