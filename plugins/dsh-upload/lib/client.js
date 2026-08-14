// dsh-upload — client half (browser).
// Adds an upload button to the composer tool row (conversation.input.left).
// Picks files, POSTs them as base64 JSON to /upload, and on success appends
// a machine-readable marker to the draft so the agent can read the file.
// Hand-written module loader bundle (no build step required).

window.__ModuleLoader__.load({
  id: "dsh-upload",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    let react = require("react");
    let { useState, useRef, useCallback } = react;
    let { jsx } = require("react/jsx-runtime");

    var MAX_BYTES = 64 * 1024 * 1024;

    function readFileAsBase64(file) {
      return new Promise((resolve, reject) => {
        var reader = new FileReader();
        reader.onload = function () {
          var text = String(reader.result);
          resolve(text.slice(text.indexOf(",") + 1));
        };
        reader.onerror = function () { reject(reader.error); };
        reader.readAsDataURL(file);
      });
    }

    function uploadFile(file) {
      return readFileAsBase64(file).then(function (data) {
        return fetch("/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: file.name,
            mediaType: file.type || "application/octet-stream",
            data: data,
          }),
        }).then(function (res) {
          return res.json().catch(function () { return { ok: false, error: "bad response" }; });
        });
      });
    }

    var buttonStyle = {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: 28,
      height: 28,
      borderRadius: 8,
      border: "1px solid transparent",
      background: "transparent",
      color: "var(--dsw-alias-label-secondary, #8fa1c4)",
      cursor: "pointer",
      fontSize: 15,
      lineHeight: 1,
      flex: "none",
      padding: 0,
    };

    function UploadButton(props) {
      var useInput = props.useInput;
      var inputActions = props.inputActions;
      var inputRef = useRef(null);
      var timerRef = useRef(null);
      var [busy, setBusy] = useState(false);
      var [error, setError] = useState(null);
      var [done, setDone] = useState(null);

      var flashHint = useCallback(function (setter, text) {
        setter(text);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(function () { setter(null); }, 2500);
      }, []);

      var draft = useInput ? useInput(function (s) { return s ? s.text || "" : ""; }) : "";
      var draftRef = useRef(draft);
      draftRef.current = draft;

      var onFiles = useCallback(function (fileList) {
        var files = Array.prototype.slice.call(fileList || []);
        if (files.length === 0) return;
        if (timerRef.current) clearTimeout(timerRef.current);
        setError(null);
        setDone(null);
        setBusy(true);
        var chain = Promise.resolve();
        var uploaded = [];
        var failed = null;
        files.forEach(function (file) {
          chain = chain.then(function () {
            if (file.size > MAX_BYTES) {
              failed = file.name + " exceeds 64 MiB";
              return;
            }
            return uploadFile(file).then(function (res) {
              if (res && res.ok) uploaded.push(res);
              else failed = (res && res.error) || ("upload failed: " + file.name);
            });
          });
        });
        chain.then(function () {
          setBusy(false);
          if (uploaded.length > 0 && inputActions && inputActions.setDraft) {
            var marks = uploaded.map(function (r) {
              return "[上传附件: " + r.name + " (id: " + r.id + ")]";
            }).join("\n");
            var cur = draftRef.current || "";
            inputActions.setDraft(cur ? cur + "\n" + marks : marks);
            flashHint(setDone, uploaded.map(function (r) { return r.name; }).join(", "));
          }
          if (failed) flashHint(setError, failed);
        });
      }, [inputActions, flashHint]);

      var onPick = useCallback(function (ev) {
        onFiles(ev.target.files);
        ev.target.value = "";
      }, [onFiles]);

      var onDrop = useCallback(function (ev) {
        ev.preventDefault();
        onFiles(ev.dataTransfer && ev.dataTransfer.files);
      }, [onFiles]);

      var onDragOver = useCallback(function (ev) {
        ev.preventDefault();
      }, []);

      return jsx("span", {
        style: { display: "inline-flex", alignItems: "center", position: "relative" },
        "data-upload": "",
        onDrop: onDrop,
        onDragOver: onDragOver,
        title: "上传文件（图片 / Word / PDF / 文本等）",
        children: [
          jsx("button", {
            type: "button",
            "data-upload-button": "",
            style: buttonStyle,
            disabled: busy,
            onClick: function () { if (inputRef.current) inputRef.current.click(); },
            children: busy ? "⏳" : "📎",
          }),
          jsx("input", {
            ref: inputRef,
            type: "file",
            multiple: true,
            style: { display: "none" },
            onChange: onPick,
            "data-upload-input": "",
          }),
          error ? jsx("span", {
            "data-upload-error": "",
            style: { position: "absolute", top: "calc(100% + 6px)", right: 0, background: "var(--dsw-specific-input-major, #1a2236)", border: "1px solid var(--dsw-alias-border-l2-darkmode-thin, #2a3550)", borderRadius: 8, padding: "4px 8px", fontSize: 12, color: "var(--dsw-alias-state-error-primary, #ff7a7a)", whiteSpace: "nowrap", zIndex: 30 },
            children: error,
          }) : null,
          done ? jsx("span", {
            "data-upload-done": "",
            style: { position: "absolute", top: "calc(100% + 6px)", right: 0, background: "var(--dsw-specific-input-major, #1a2236)", border: "1px solid var(--dsw-alias-border-l2-darkmode-thin, #2a3550)", borderRadius: 8, padding: "4px 8px", fontSize: 12, color: "var(--dsw-alias-state-success-primary, #7ad9a0)", whiteSpace: "nowrap", zIndex: 30 },
            children: "已上传: " + done,
          }) : null,
        ],
      });
    }

    var inject = ["slots"];

    function apply(ctx) {
      ctx.slots.inject("conversation.input.left", function () {
        return ctx.slots.register({
          name: "conversation.input.left",
          id: "upload-button",
          inject: function () { return {}; },
        }, UploadButton);
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
