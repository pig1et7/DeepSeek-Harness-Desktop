/**
 * dsh-file-preview — host half.
 *
 * Watches tool completions (write/edit) and keeps a ring buffer of the files
 * the agent touched together with their diff data (same source the official
 * diff cards use). Serves three endpoints on the webServer:
 *
 *   GET /preview/files            -> recent touched files (newest first)
 *   GET /preview/content?path=    -> file content (text / image / docx / pdf)
 *   GET /preview/diff?path=       -> last recorded diff for a file
 *
 * All endpoints return JSON. Paths are absolute; this is a local single-user
 * tool bound to 127.0.0.1, and every path shown comes from tool results that
 * already passed the filesystem sandbox.
 */

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";

export const name = "file-preview";
export const inject = ["webServer"];

const MAX_RECENT = 80; // ring buffer size
const MAX_TEXT = 120 * 1024; // content preview cap (chars)
const MAX_BODY_BYTES = 2 * 1024 * 1024;

// Persistence: the recent-file ring survives restarts via DSH_HOME.
async function recentFile() {
  return join(resolveDshHome(), "plugins", "file-preview-recent.json");
}
let saveTimer = null;

async function loadRecent() {
  try {
    const raw = await readFile(await recentFile(), "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const e of parsed) {
        if (e && typeof e.path === "string") recent.set(e.path, e);
      }
    }
  } catch {
    /* no prior state */
  }
}

function scheduleSave() {
  // short debounce (500ms) so bursts of edits write once; a killed process
  // right after the last edit can still lose a tail record, so keep it tight.
  if (saveTimer !== null) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    recentFile()
      .then((path) => writeFile(path, JSON.stringify(Array.from(recent.values())), "utf8"))
      .catch((err) => console.error("[file-preview] persist recent failed:", err.message));
  }, 500);
}

const TEXT_EXTS = new Set([
  ".txt", ".md", ".markdown", ".json", ".jsonc", ".csv", ".tsv", ".log",
  ".yml", ".yaml", ".toml", ".ini", ".xml", ".html", ".htm", ".css",
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".py", ".java", ".c",
  ".cpp", ".h", ".hpp", ".rs", ".go", ".rb", ".php", ".sh", ".bat",
  ".cmd", ".ps1", ".sql", ".gitignore", ".env", ".conf", ".cfg", ".lock",
]);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico"]);
const WRITE_TOOLS = new Set(["write", "edit", "create_file", "str_replace_editor"]);
const MUTATION_TOOLS = new Set(["write", "edit", "create_file", "str_replace_editor", "delete_file"]);

const recent = new Map(); // path -> { path, updatedAt, diffs, plus, minus }

// ---- diff helpers (records are the tool's own diff cards) ----

function countDiffLines(diffs) {
  let plus = 0;
  let minus = 0;
  if (!Array.isArray(diffs)) return { plus, minus };
  for (const d of diffs) {
    if (!d || typeof d !== "object") continue;
    const oldLines = Array.isArray(d.oldLines) ? d.oldLines : [];
    const newLines = Array.isArray(d.newLines) ? d.newLines : [];
    plus += newLines.filter((l) => typeof l === "string").length;
    minus += oldLines.filter((l) => typeof l === "string").length;
  }
  return { plus, minus };
}

/**
 * Build a synthetic single-hunk diff for replace-style edits (str_replace
 * passes old_string/new_string in the args) and whole-file writes where the
 * old content is unavailable.
 */
function syntheticDiff(args) {
  const oldStr = typeof args.old_string === "string" ? args.old_string : null;
  const newStr = typeof args.new_string === "string" ? args.new_string
    : typeof args.content === "string" ? args.content : null;
  if (oldStr === null || newStr === null) return null;
  const split = (s) => (s === "" ? [""] : s.replace(/\r\n/g, "\n").split("\n"));
  const oldLines = split(oldStr);
  const newLines = split(newStr);
  // make the hunk readable: pad the shorter side so +/- pairs align per row
  const max = Math.max(oldLines.length, newLines.length);
  while (oldLines.length < max) oldLines.push("");
  while (newLines.length < max) newLines.push("");
  return [{ oldLines, newLines, title: "replace" }];
}

function extractDiffData(result, args) {
  // result shape is defensive: official tools carry a `card:"diff"` result
  // view with { diffs, locations }; str_replace_editor presents a generic
  // `kind:"edit"` card (locations only), and unknown shapes fall back to args.
  const value = result && typeof result === "object" ? result.value ?? result : null;
  const view = value && typeof value === "object" ? value.resultView ?? null : null;
  let diffs = view && Array.isArray(view.diffs) ? view.diffs : null;
  const paths = [];
  if (view && Array.isArray(view.locations)) {
    for (const loc of view.locations) {
      if (loc && typeof loc.path === "string") paths.push(loc.path);
    }
  }
  if (diffs === null && view && view.card === "generic" && view.kind === "edit") {
    diffs = syntheticDiff(args);
  }
  if (diffs === null) diffs = syntheticDiff(args);
  return { diffs, paths };
}

function recordToolResult(exec, result) {
  if (!exec || typeof exec.name !== "string") return;
  const name = exec.name;
  if (WRITE_TOOLS.has(name) === false) return;
  const failed = !result || result === null || result.ok === false || result.error !== undefined;
  if (failed) return;
  const args = exec.arguments && typeof exec.arguments === "object" ? exec.arguments : {};
  const { diffs, paths } = extractDiffData(result, args);
  const argPath = args.file_path ?? args.path;
  const allPaths = paths.length > 0 ? paths : typeof argPath === "string" ? [argPath] : [];
  if (allPaths.length === 0) return;
  const { plus, minus } = countDiffLines(diffs);
  const now = Date.now();
  for (const p of allPaths) {
    recent.set(p, { path: p, updatedAt: now, diffs: diffs ? diffs.slice(0, 30) : null, plus, minus });
  }
  // ring-buffer cap: drop oldest entries
  while (recent.size > MAX_RECENT) {
    let oldest = null;
    for (const entry of recent.values()) {
      if (oldest === null || entry.updatedAt < oldest.updatedAt) oldest = entry;
    }
    if (oldest) recent.delete(oldest.path);
    else break;
  }
  scheduleSave(); // persist (debounced) so restarts keep the history
}

// ---- content preview ----

function readJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function readBody(req, cap) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > cap) {
      const err = new Error("body too large");
      err.code = "TOO_LARGE";
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function imageSize(buf) {
  try {
    if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), mediaType: "image/png" };
    }
    if (buf.length >= 24 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5), mediaType: "image/jpeg" };
        }
        i += 2 + buf.readUInt16BE(i + 2);
      }
      return { width: null, height: null, mediaType: "image/jpeg" };
    }
    if (buf.length >= 10 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8), mediaType: "image/gif" };
    }
  } catch { /* fall through */ }
  return null;
}

async function extractDocx(buf) {
  const { unzipSync, strFromU8 } = await import("fflate");
  const files = unzipSync(new Uint8Array(buf));
  const xml = files["word/document.xml"];
  if (!xml) return null;
  const text = strFromU8(xml);
  return text
    .replace(/<w:tab[^>]*\/>/g, "\t")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractPdf(buf) {
  let getDocument;
  try {
    ({ getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs"));
  } catch {
    return null;
  }
  try {
    const doc = await getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
    const parts = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      parts.push(content.items.map((item) => (typeof item.str === "string" ? item.str : "")).join(" "));
    }
    await doc.destroy().catch(() => {});
    return parts.join("\n").replace(/\s+\n/g, "\n").trim() || null;
  } catch {
    return null;
  }
}

async function previewContent(path, ctx) {
  const { readFile, stat } = await import("node:fs/promises");
  let st;
  try {
    st = await stat(path);
  } catch {
    return { kind: "error", message: "file not found" };
  }
  if (!st.isFile()) return { kind: "error", message: "not a regular file" };
  if (st.size > 50 * 1024 * 1024) return { kind: "error", message: "file too large to preview (>50MiB)" };
  const buf = await readFile(path);
  const lower = path.toLowerCase();
  const name = path.split(/[\\/]/).pop() || path;

  if (IMAGE_EXTS.has(lower.match(/\.[a-z0-9]+$/)?.[0] ?? "")) {
    const dim = imageSize(buf);
    return {
      kind: "image",
      name,
      size: buf.byteLength,
      width: dim?.width ?? null,
      height: dim?.height ?? null,
      dataUrl: `data:image/${(dim?.mediaType ?? "png").split("/")[1] || "png"};base64,${buf.toString("base64")}`,
    };
  }
  if (lower.endsWith(".docx")) {
    const text = await extractDocx(buf);
    if (text === null) return { kind: "error", message: "could not parse .docx" };
    return { kind: "text", name, truncated: text.length > MAX_TEXT, content: text.slice(0, MAX_TEXT) };
  }
  if (lower.endsWith(".pdf")) {
    const text = await extractPdf(buf);
    if (text === null || text === "") {
      return { kind: "binary", name, size: buf.byteLength, hint: "PDF 文本提取不可用（扫描件或缺少依赖）" };
    }
    return { kind: "text", name, truncated: text.length > MAX_TEXT, content: text.slice(0, MAX_TEXT) };
  }
  const ext = lower.match(/\.[a-z0-9]+$/)?.[0] ?? "";
  if (TEXT_EXTS.has(ext)) {
    const text = buf.toString("utf8").replace(/^\uFEFF/, "");
    return { kind: "text", name, truncated: text.length > MAX_TEXT, content: text.slice(0, MAX_TEXT) };
  }
  return { kind: "binary", name, size: buf.byteLength, hint: "二进制文件，无法直接预览文本" };
}

function makeHandler(ctx) {
  return async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const pathname = url.pathname.replace(/\/+$/, "") || "/preview";
    const send = (status, payload) => readJson(res, status, payload);
    try {
      if (pathname === "/preview/files" || pathname === "/preview") {
        if (req.method !== "GET") return send(405, { ok: false, error: "method not allowed" });
        const list = Array.from(recent.values())
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map((e) => ({
            path: e.path,
            name: (e.path.split(/[\\/]/).pop() || e.path),
            updatedAt: e.updatedAt,
            plus: e.plus,
            minus: e.minus,
            hasDiff: Array.isArray(e.diffs) && e.diffs.length > 0,
          }));
        return send(200, { ok: true, files: list });
      }
      if (pathname === "/preview/content") {
        if (req.method !== "GET") return send(405, { ok: false, error: "method not allowed" });
        const p = url.searchParams.get("path");
        if (!p) return send(400, { ok: false, error: "missing path" });
        const result = await previewContent(p, ctx);
        return send(200, { ok: result.kind !== "error", ...result });
      }
      if (pathname === "/preview/diff") {
        if (req.method !== "GET") return send(405, { ok: false, error: "method not allowed" });
        const p = url.searchParams.get("path");
        if (!p) return send(400, { ok: false, error: "missing path" });
        const entry = recent.get(p);
        if (!entry || !Array.isArray(entry.diffs)) return send(404, { ok: false, error: "no diff recorded for this file" });
        return send(200, { ok: true, path: p, diffs: entry.diffs, plus: entry.plus, minus: entry.minus });
      }
      if (pathname === "/preview/clear") {
        if (req.method !== "POST") return send(405, { ok: false, error: "method not allowed" });
        await readBody(req, MAX_BODY_BYTES);
        recent.clear();
        return send(200, { ok: true });
      }
      return send(404, { ok: false, error: "not found" });
    } catch (err) {
      ctx.logger.warn(`[file-preview] ${pathname} failed: ${err.message}`);
      return send(500, { ok: false, error: "preview failed" });
    }
  };
}

export function apply(ctx) {
  ctx.on("tools/result", (exec, result) => {
    try {
      recordToolResult(exec, result);
    } catch (err) {
      ctx.logger.warn(`[file-preview] record failed: ${err.message}`);
    }
  });
  loadRecent().catch((err) => ctx.logger.warn(`[file-preview] load recent failed: ${err.message}`));
  ctx.effect(() => ctx.webServer.register({
    kind: "prefixes",
    path: "/preview",
    handler: makeHandler(ctx),
  }), "dsh-file-preview: route");
}

// test surface
export { recordToolResult, previewContent, extractDocx, extractPdf, imageSize };
export function debugRecent() {
  return Array.from(recent.values()).map((e) => ({ path: e.path, diffs: e.diffs, plus: e.plus, minus: e.minus }));
}