// dsh-file-preview — client half (browser).
// 📁 button in the sidebar footer opens a left overlay panel listing files the
// agent recently wrote/edited, with per-file content preview and diff views.
// Data comes from host endpoints /preview/*.

window.__ModuleLoader__.load({
  id: "dsh-file-preview",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    let react = require("react");
    let { useState, useEffect, useCallback } = react;
    let { jsx } = require("react/jsx-runtime");
    let { createPortal } = require("react-dom");

    // h(type, props) carries children in props; our call sites use a third
    // argument for children, so route everything through this helper.
    function h(type, props, children) {
      if (arguments.length > 2) props.children = children;
      return jsx(type, props);
    }

    var POLL_MS = 4000;

    function fmtTime(ts) {
      var diff = Date.now() - ts;
      if (diff < 60 * 1000) return "刚刚";
      if (diff < 3600 * 1000) return Math.floor(diff / 60000) + " 分钟前";
      if (diff < 86400 * 1000) return Math.floor(diff / 3600000) + " 小时前";
      return Math.floor(diff / 86400000) + " 天前";
    }

    var panelStyle = {
      position: "fixed", top: 0, left: 0, bottom: 0, width: 430, maxWidth: "85vw",
      background: "#0f1526",
      borderRight: "1px solid #232c44",
      boxShadow: "0 8px 40px rgba(0,0,0,.4)",
      zIndex: 999, display: "flex", flexDirection: "column",
      fontFamily: "Segoe UI, Microsoft YaHei, sans-serif",
      fontSize: 13, color: "#dbe4f5",
    };

    function PreView(props) {
      var kind = props.kind, content = props.content, truncated = props.truncated,
        dataUrl = props.dataUrl, width = props.width, height = props.height,
        hint = props.hint, name = props.name;
      if (kind === "text") {
        return h("div", { style: { display: "flex", flexDirection: "column", flex: "auto", minHeight: 0 }, children: [
          h("pre", { key: "p", style: { margin: 0, padding: 10, fontSize: 12, lineHeight: 1.55, fontFamily: "Consolas, monospace", color: "#dbe4f5", whiteSpace: "pre", overflow: "auto" }, children: content }),
          truncated ? h("div", { key: "t", style: { padding: "6px 10px", flex: "none", color: "#5d6f92", fontSize: 12 }, children: "… 内容过长已截断" }) : null,
        ] });
      }
      if (kind === "image") {
        return h("div", { style: { padding: 12, overflow: "auto", flex: "auto", textAlign: "center" }, children: [
          h("img", { key: "i", src: dataUrl, alt: name, style: { maxWidth: "100%", maxHeight: "60vh", borderRadius: 8, display: "block", margin: "0 auto" } }),
          h("div", { key: "m", style: { marginTop: 8, color: "#5d6f92", fontSize: 12 }, children: (width && height ? width + " × " + height + " px" : "") }),
        ] });
      }
      return h("div", { style: { padding: 14, color: "#b9c8e8" }, children: hint || "无法预览" });
    }

    function DiffView(props) {
      var diffs = props.diffs;
      if (!diffs || diffs.length === 0) {
        return h("div", { style: { padding: 14, color: "#5d6f92" }, children: "无 diff 数据" });
      }
      var blocks = [];
      diffs.forEach(function (d, idx) {
        if (!d || typeof d !== "object") return;
        var oldLines = Array.isArray(d.oldLines) ? d.oldLines : [];
        var newLines = Array.isArray(d.newLines) ? d.newLines : [];
        if (d.title) {
          blocks.push(h("div", { key: "h" + idx, style: { padding: "4px 10px", background: "#141b2e", fontFamily: "Consolas, monospace", fontSize: 12 }, children: d.title }));
        }
        var max = Math.max(oldLines.length, newLines.length);
        for (var i = 0; i < max; i++) {
          var o = oldLines[i];
          var n = newLines[i];
          var isAdd = n !== undefined && n !== null && (o === undefined || o === null);
          var isDel = o !== undefined && o !== null && (n === undefined || n === null);
          var line = isAdd ? n : isDel ? o : n !== undefined ? n : o;
          var style = {
            padding: "0 10px", whiteSpace: "pre", fontFamily: "Consolas, monospace",
            fontSize: 12, lineHeight: 1.5,
            background: isAdd ? "rgba(46,160,67,.15)" : isDel ? "rgba(248,81,73,.15)" : "transparent",
            color: isAdd ? "#7ad9a0" : isDel ? "#ff9b92" : "#b9c8e8",
          };
          var text = (isAdd ? "+ " : isDel ? "- " : "  ") + String(line).replace(/\u0000.*$/, "");
          blocks.push(h("div", { key: idx + ":" + i, style: style, children: text }));
        }
      });
      return h("div", { style: { overflow: "auto", flex: "auto" }, children: blocks });
    }

    function PreviewPanel(props) {
      var onClose = props.onClose;
      var [files, setFiles] = useState([]);
      var [selected, setSelected] = useState(null);
      var [content, setContent] = useState(null);
      var [diff, setDiff] = useState(null);
      var [tab, setTab] = useState("content");
      var [loading, setLoading] = useState(false);
      var [error, setError] = useState(null);

      var refresh = useCallback(function () {
        fetch("/preview/files").then(function (r) { return r.json(); }).then(function (data) {
          if (data && data.ok) setFiles(data.files || []);
        }).catch(function () {});
      }, []);

      useEffect(function () {
        refresh();
        var timer = setInterval(refresh, POLL_MS);
        return function () { clearInterval(timer); };
      }, [refresh]);

      var openFile = useCallback(function (path) {
        setSelected({ path: path });
        setLoading(true);
        setError(null);
        setDiff(null);
        setTab("content");
        fetch("/preview/content?path=" + encodeURIComponent(path))
          .then(function (r) { return r.json(); })
          .then(function (data) {
            setContent(data);
            setLoading(false);
            if (data && data.ok) {
              fetch("/preview/diff?path=" + encodeURIComponent(path))
                .then(function (r) { return r.json(); })
                .then(function (d) { if (d && d.ok) setDiff(d); })
                .catch(function () {});
            }
          })
          .catch(function (e) { setError(String(e)); setLoading(false); });
      }, []);

      var listRows = files.map(function (f) {
        var rowSelected = selected && selected.path === f.path;
        var badge = null;
        if (f.plus + f.minus > 0) {
          badge = h("span", { style: { flex: "none", borderRadius: 6, padding: "0 5px", fontSize: 11, fontFamily: "Consolas, monospace", background: "rgba(46,160,67,.12)", color: "#7ad9a0" }, children: (f.plus > 0 ? "+" + f.plus + " " : "") + (f.minus > 0 ? "-" + f.minus : "") });
        }
        return h("div", {
          key: f.path,
          style: Object.assign({ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "7px 12px", borderRadius: 8, minWidth: 0 }, rowSelected ? { background: "#141b2e" } : {}),
          "data-preview-file": f.path,
          onClick: function () { openFile(f.path); },
        }, [
          h("span", { key: "i", style: { flex: "none", fontSize: 14 }, children: f.minus > 0 ? "✏️" : "📄" }),
          h("span", { key: "n", style: { flex: "auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: f.name }),
          badge,
          h("span", { key: "t", style: { flex: "none", color: "#5d6f92", fontSize: 11 }, children: fmtTime(f.updatedAt) }),
        ]);
      });

      var headerStyle = {
        display: "flex", alignItems: "center", gap: 8, padding: "10px 12px",
        borderBottom: "1px solid #232c44", flex: "none",
      };
      var smallBtn = {
        display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 26,
        borderRadius: 8, border: 0, background: "transparent", color: "#8fa1c4",
        cursor: "pointer", fontSize: 14, flex: "none", padding: 0,
      };
      var tabStyle = function (active) {
        return {
          border: 0, borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontSize: 12,
          background: active ? "#141b2e" : "transparent",
          color: active ? "#dbe4f5" : "#5d6f92",
        };
      };

      return h("div", { style: panelStyle, "data-file-preview-panel": "", role: "dialog" }, [
        h("div", { key: "h", style: headerStyle, children: [
          h("span", { key: "t", style: { fontSize: 14, fontWeight: 600, flex: "auto" }, children: "📁 文件预览" }),
          h("button", { key: "r", type: "button", onClick: refresh, style: smallBtn, title: "刷新", children: "⟳" }),
          h("button", { key: "c", type: "button", onClick: onClose, style: smallBtn, title: "关闭 (Esc)", "data-preview-close": "", children: "✕" }),
        ] }),
        h("div", { key: "l", style: { flex: "none", maxHeight: "38vh", overflow: "auto", borderBottom: "1px solid #232c44", padding: 6 }, children: [
          files.length === 0
            ? h("div", { style: { padding: 14, color: "#5d6f92", textAlign: "center" }, children: "暂无文件记录 —— Agent 写/改文件后会出现在这里" })
            : listRows,
        ] }),
        (selected
          ? h("div", { key: "ab", style: { display: "flex", gap: 4, padding: "6px 12px 0", flex: "none" }, children: [
              h("button", { key: "ct", type: "button", onClick: function () { setTab("content"); }, style: tabStyle(tab === "content"), children: "内容" }),
              (diff && diff.ok) ? h("button", { key: "dt", type: "button", onClick: function () { setTab("diff"); }, style: tabStyle(tab === "diff"), children: "Diff (+" + (diff.plus || 0) + " −" + (diff.minus || 0) + ")" }) : null,
            ] })
          : null),
        h("div", { key: "b", style: { flex: "auto", minHeight: 0, display: "flex", flexDirection: "column" }, children: [
          loading
            ? h("div", { style: { padding: 14, color: "#5d6f92" }, children: "加载中…" })
            : error
              ? h("div", { style: { padding: 14, color: "#ff7a7a" }, children: error })
              : !selected
                ? h("div", { style: { padding: 14, color: "#5d6f92" }, children: "点击上方文件查看内容与 diff" })
                : tab === "diff" && diff && diff.ok
                  ? h(DiffView, { diffs: diff.diffs })
                  : (content && content.ok)
                    ? h(PreView, { kind: content.kind, content: content.content, truncated: content.truncated, dataUrl: content.dataUrl, width: content.width, height: content.height, hint: content.hint, name: content.name })
                    : h("div", { style: { padding: 14, color: "#ff7a7a" }, children: (content && content.message) || "加载失败" }),
        ] }),
      ]);
    }

    function PanelToggle() {
      var [open, setOpen] = useState(false);
      useEffect(function () {
        if (!open) return undefined;
        function onKey(e) { if (e.key === "Escape") setOpen(false); }
        window.addEventListener("keydown", onKey);
        return function () { window.removeEventListener("keydown", onKey); };
      }, [open]);
      var btnStyle = {
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 28, height: 28, borderRadius: 8, border: "1px solid transparent",
        background: "transparent", color: "#8fa1c4",
        cursor: "pointer", fontSize: 15, flex: "none", padding: 0,
      };
      return h("span", { style: { display: "inline-flex" }, "data-file-preview": "", children: [
        h("button", {
          type: "button", "data-file-preview-button": "", style: btnStyle,
          title: "文件预览 / Diff",
          onClick: function () { setOpen(!open); },
          children: "📁",
        }),
        open ? createPortal(h(PreviewPanel, { onClose: function () { setOpen(false); } }), document.body) : null,
      ] });
    }

    var inject = ["slots"];

    function apply(ctx) {
      ctx.slots.inject("sidebar.footer.action", function () {
        return ctx.slots.register({
          name: "sidebar.footer.action",
          id: "file-preview-toggle",
          inject: function () { return {}; },
        }, PanelToggle);
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});