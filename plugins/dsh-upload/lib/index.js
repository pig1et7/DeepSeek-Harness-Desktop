/**
 * dsh-upload — host half.
 *
 * Provides:
 *  - POST /upload  : receive one file as JSON { name, mediaType, data(base64) },
 *                    store it under $DSH_HOME/uploads with a sha256 id, and
 *                    return { ok, id, name, mediaType, size, path }.
 *  - GET  /upload  : list uploaded files (id/name/mediaType/size/uploadedAt).
 *  - Agent tools: `uploaded_files` (list) and `read_uploaded_file` (read text /
 *    docx / pdf / image metadata / binary hint for the model).
 */

import { defineTool } from "@deepseek-ai/dsh-tools";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, extname } from "node:path";

export const name = "upload";
export const inject = ["webServer", "tools", "systemPrompt"];

const MAX_UPLOAD_BYTES = 64 * 1024 * 1024; // 64 MiB per file
const MAX_BODY_BYTES = 96 * 1024 * 1024; // base64 + json overhead
const READ_CAP = 60 * 1024; // max chars returned to the model

const TEXT_EXTS = new Set([
  ".txt", ".md", ".markdown", ".json", ".jsonc", ".csv", ".tsv", ".log",
  ".yml", ".yaml", ".toml", ".ini", ".xml", ".html", ".htm", ".css",
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".py", ".java", ".c",
  ".cpp", ".h", ".hpp", ".rs", ".go", ".rb", ".php", ".sh", ".bat",
  ".cmd", ".ps1", ".sql", ".gitignore", ".env", ".ini", ".conf", ".cfg"
]);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"]);

function sanitizeName(raw) {
  const base = String(raw ?? "file")
    .replace(/[\\/]/g, "_")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 200);
  return base === "" ? "file" : base;
}

function manifestPath(root) {
  return join(root, "manifest.json");
}

async function readManifest(root) {
  try {
    const raw = await readFile(manifestPath(root), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeManifest(root, entries) {
  await writeFile(manifestPath(root), JSON.stringify(entries, null, 2), "utf8");
}

async function ensureRoot() {
  const root = join(resolveDshHome(), "uploads");
  await mkdir(root, { recursive: true });
  return root;
}

// ---- image dimension sniffing (header-only, no decoder) ----

function imageSize(buf) {
  try {
    if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      // PNG: IHDR at offset 16
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), mediaType: "image/png" };
    }
    if (buf.length >= 24 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
      // JPEG: scan segments for SOF0/SOF2
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          const height = buf.readUInt16BE(i + 5);
          const width = buf.readUInt16BE(i + 7);
          return { width, height, mediaType: "image/jpeg" };
        }
        const len = buf.readUInt16BE(i + 2);
        i += 2 + len;
      }
      return { width: null, height: null, mediaType: "image/jpeg" };
    }
    if (buf.length >= 10 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8), mediaType: "image/gif" };
    }
    if (buf.length >= 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff, mediaType: "image/webp" };
    }
  } catch {
    /* fall through */
  }
  return null;
}

// ---- document text extraction ----

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
    return null; // pdfjs-dist not installed — optional enhancement
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

// ---- HTTP route ----

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

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function makeHandler(ctx) {
  return async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const path = url.pathname.replace(/\/+$/, "") || "/upload";
    if (path !== "/upload") {
      sendJson(res, 404, { ok: false, error: "not found" });
      return;
    }
    if (req.method === "GET") {
      try {
        const root = await ensureRoot();
        const entries = await readManifest(root);
        sendJson(res, 200, { ok: true, files: entries });
      } catch (err) {
        ctx.logger.warn(`[dsh-upload] list failed: ${err.message}`);
        sendJson(res, 500, { ok: false, error: "list failed" });
      }
      return;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "method not allowed" });
      return;
    }
    try {
      const body = await readBody(req, MAX_BODY_BYTES);
      let parsed;
      try {
        parsed = JSON.parse(body.toString("utf8"));
      } catch {
        sendJson(res, 400, { ok: false, error: "invalid JSON body" });
        return;
      }
      const name = sanitizeName(parsed.name);
      const mediaType = typeof parsed.mediaType === "string" ? parsed.mediaType : "application/octet-stream";
      const data = Buffer.from(String(parsed.data ?? ""), "base64");
      if (data.byteLength === 0) {
        sendJson(res, 400, { ok: false, error: "empty file data" });
        return;
      }
      if (data.byteLength > MAX_UPLOAD_BYTES) {
        sendJson(res, 413, { ok: false, error: `file exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024} MiB limit` });
        return;
      }
      const root = await ensureRoot();
      const sha = createHash("sha256").update(data).digest("hex");
      const id = `sha256:${sha}`;
      const stored = join(root, `${sha}${extname(name)}`);
      await writeFile(stored, data);
      const entries = await readManifest(root);
      const entry = {
        id,
        name,
        mediaType,
        size: data.byteLength,
        uploadedAt: new Date().toISOString(),
        path: stored,
      };
      const index = entries.findIndex((e) => e.id === id);
      if (index >= 0) entries[index] = entry;
      else entries.push(entry);
      await writeManifest(root, entries);
      sendJson(res, 200, { ok: true, ...entry });
    } catch (err) {
      ctx.logger.warn(`[dsh-upload] upload failed: ${err.message}`);
      sendJson(res, err.code === "TOO_LARGE" ? 413 : 500, { ok: false, error: "upload failed" });
    }
  };
}

// ---- agent tools ----

async function findUpload(root, file) {
  const entries = await readManifest(root);
  const needle = String(file ?? "").trim();
  let entry = entries.find((e) => e.id === needle || e.name === needle);
  if (!entry && needle) {
    // tolerate the bare sha256 without the sha256: prefix
    entry = entries.find((e) => e.id === `sha256:${needle}`);
  }
  if (!entry && needle === "") {
    entry = entries[0];
  }
  return entry ?? null;
}

async function readUploadedFile(root, file) {
  const entry = await findUpload(root, file);
  if (!entry) {
    return { kind: "error", message: `no uploaded file matches "${file}" — call uploaded_files first` };
  }
  const abs = join(root, entry.id.slice("sha256:".length) + extname(entry.name));
  let buf;
  try {
    buf = await readFile(abs);
  } catch {
    return { kind: "error", message: `uploaded file ${entry.name} is missing on disk` };
  }
  const ext = extname(entry.name).toLowerCase();

  if (IMAGE_EXTS.has(ext)) {
    const dim = imageSize(buf);
    return {
      kind: "image",
      name: entry.name,
      size: entry.size,
      width: dim?.width ?? null,
      height: dim?.height ?? null,
      mediaType: entry.mediaType,
      hint: "This is an image file. If the model has vision capability it can be viewed by the user; otherwise describe its metadata or process it with bash.",
    };
  }

  if (ext === ".docx") {
    const text = await extractDocx(buf);
    if (text === null) return { kind: "error", message: "could not parse .docx" };
    return { kind: "text", name: entry.name, truncated: text.length > READ_CAP, content: text.slice(0, READ_CAP) };
  }

  if (ext === ".pdf") {
    const text = await extractPdf(buf);
    if (text === null || text === "") {
      return {
        kind: "binary",
        name: entry.name,
        size: entry.size,
        hint: "PDF text extraction is unavailable (pdfjs-dist missing or the PDF has no extractable text). Use bash tooling (e.g. pdftotext) or ask the user to paste the content.",
      };
    }
    return { kind: "text", name: entry.name, truncated: text.length > READ_CAP, content: text.slice(0, READ_CAP) };
  }

  if (TEXT_EXTS.has(ext)) {
    const text = buf.toString("utf8").replace(/^\uFEFF/, "");
    return { kind: "text", name: entry.name, truncated: text.length > READ_CAP, content: text.slice(0, READ_CAP) };
  }

  return {
    kind: "binary",
    name: entry.name,
    size: entry.size,
    mediaType: entry.mediaType,
    hint: "Binary file. The agent cannot read its content directly; try text extraction via bash or ask the user to provide text.",
  };
}

function renderEntryLine(e) {
  const size = e.size >= 1024 * 1024 ? `${(e.size / 1024 / 1024).toFixed(1)} MiB` : `${Math.max(1, Math.round(e.size / 1024))} KiB`;
  return `- ${e.name}  (${size}, ${e.mediaType}, uploaded ${e.uploadedAt})\n  id: ${e.id}`;
}

// ---- plugin entry ----

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: "prefixes",
    path: "/upload",
    handler: makeHandler(ctx),
  }), "dsh-upload: route");

  ctx.tools.register(defineTool({
    name: "uploaded_files",
    description: "List files the user uploaded through the Web GUI upload button (images, Word, PDF, text, etc.).",
    parameters: {},
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          files: {
            type: "array",
            required: true,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                id: { type: "string", required: true },
                name: { type: "string", required: true },
                mediaType: { type: "string", required: true },
                size: { type: "number", required: true },
                uploadedAt: { type: "string", required: true },
              },
            },
          },
        },
      },
      render: (args, value) => [{
        type: "text",
        text: value.files.length === 0
          ? "No uploaded files yet."
          : `Uploaded files:\n${value.files.map(renderEntryLine).join("\n")}`,
      }],
    },
    execute: async () => {
      const root = await ensureRoot();
      const entries = await readManifest(root);
      return {
        files: entries.map((e) => ({
          id: e.id,
          name: e.name,
          mediaType: e.mediaType,
          size: e.size,
          uploadedAt: e.uploadedAt,
        })),
      };
    },
  }));

  ctx.tools.register(defineTool({
    name: "read_uploaded_file",
    description: "Read an uploaded file by its id (e.g. sha256:...) or name. Returns text content for text files, extracted text for .docx/.pdf, image metadata for images, and a hint for other binaries.",
    parameters: {
      file: {
        type: "string",
        required: true,
        description: "Upload id (sha256:...) or file name, from the uploaded_files tool.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", required: true },
          name: { type: "string" },
          content: { type: "string" },
          truncated: { type: "boolean" },
          width: { type: "number" },
          height: { type: "number" },
          size: { type: "number" },
          mediaType: { type: "string" },
          hint: { type: "string" },
          message: { type: "string" },
        },
      },
      render: (args, value) => {
        if (value.kind === "error") return [{ type: "text", text: value.message }];
        if (value.kind === "image") {
          const dim = value.width && value.height ? `${value.width}x${value.height}` : "unknown dimensions";
          return [{
            type: "text",
            text: `Image "${value.name}" (${dim}, ${value.size} bytes). ${value.hint ?? ""}`,
          }];
        }
        if (value.kind === "text") {
          return [{
            type: "text",
            text: `Content of uploaded file "${value.name}":\n${value.content}${value.truncated ? "\n... (truncated)" : ""}`,
          }];
        }
        return [{
          type: "text",
          text: `Binary file "${value.name}" (${value.size} bytes, ${value.mediaType ?? "unknown"}). ${value.hint ?? ""}`,
        }];
      },
    },
    execute: async (args) => {
      const root = await ensureRoot();
      return readUploadedFile(root, args.file);
    },
  }));

  ctx.systemPrompt.section({
    name: "tool:upload",
    order: 300,
    text: "When the user mentions an uploaded attachment (usually shown as [上传附件: name (id: ...)] in the conversation), use the uploaded_files and read_uploaded_file tools to list and read the uploaded file before answering.",
  });
}

// Test/extension surface: pure helpers exported for direct verification.
export { extractDocx, extractPdf, imageSize, readUploadedFile, findUpload };
