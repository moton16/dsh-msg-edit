window.__ModuleLoader__.load({
  id: "@local/dsh-client-ui-msg-edit",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");
    const { IconRefreshOutline16, IconEditOutline16, IconCheckOutline16, IconCloseOutline16, Tooltip } = require("@deepseek-ai/dsh-client-ui-primitives");

    // —— RPC to the msg-edit host plugin (cordis file:// plugin) ——
    const rpc = (method, args) => fetch("/api/msg-edit/" + method, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args || {}),
    }).then((r) => r.json()).catch((e) => ({ ok: false, error: { code: "ERR", message: String(e) } }));

    // —— dictionaries ——
    const NS = "msgEdit";
    const zh = {
      "regenerate": "重新生成回复",
      "editAssistant": "编辑这条回复",
      "editText": "正文",
      "editReasoning": "思考",
      "editSave": "保存",
      "editCancel": "取消",
      "editError": "保存失败",
      "regenerateError": "重新生成失败",
      "busy": "处理中…",
    };
    const en = {
      "regenerate": "Regenerate reply",
      "editAssistant": "Edit this reply",
      "editText": "Text",
      "editReasoning": "Reasoning",
      "editSave": "Save",
      "editCancel": "Cancel",
      "editError": "Save failed",
      "regenerateError": "Regenerate failed",
      "busy": "Working…",
    };

    const inlineCss = [
      ".msg-edit-actions{display:inline-flex;align-items:center;gap:6px}",
      ".msg-edit-btn{display:inline-flex;align-items:center;gap:3px;padding:1px 5px;border:1px solid transparent;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary,#999);cursor:pointer;font-size:11px}",
      ".msg-edit-btn:hover{color:var(--dsw-alias-brand-primary,#4f8cff);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4f8cff) 10%,transparent)}",
      ".msg-edit-btn:disabled{opacity:.5;cursor:default}",
      ".msg-edit-editor{display:flex;flex-direction:column;gap:6px;padding:6px 8px;border:1px solid var(--dsw-alias-border-l1,#333);border-radius:8px;background:var(--dsw-alias-bg-layer-2,#1e1e1e);min-width:280px}",
      ".msg-edit-field{display:flex;flex-direction:column;gap:2px}",
      ".msg-edit-label{font-size:10px;color:var(--dsw-alias-label-secondary,#999);text-transform:uppercase;letter-spacing:.05em}",
      ".msg-edit-textarea{resize:vertical;min-height:52px;border:1px solid var(--dsw-alias-border-l1,#333);border-radius:6px;padding:6px;background:var(--dsw-alias-bg-layer-1,#222);color:var(--dsw-alias-label-primary,#ddd);font:inherit;font-size:12px;line-height:1.5;outline:none}",
      ".msg-edit-textarea:focus{border-color:var(--dsw-alias-brand-primary,#4f8cff)}",
      ".msg-edit-editor-actions{display:flex;gap:6px;justify-content:flex-end}",
      ".msg-edit-failure{font-size:11px;color:var(--dsw-alias-state-error-primary,#e05a5a)}",
    ];

    // —— one message's actions: regenerate + edit-assistant ——
    function MsgEditActions({ messageId, sessionId, t }) {
      const [busy, setBusy] = React.useState(false);
      const [editOpen, setEditOpen] = React.useState(false);
      const [text, setText] = React.useState("");
      const [reasoning, setReasoning] = React.useState("");
      const [loading, setLoading] = React.useState(false);
      const [failure, setFailure] = React.useState(null);
      const alive = React.useRef(true);
      React.useEffect(() => () => { alive.current = false; }, []);

      const onRegenerate = React.useCallback(() => {
        if (busy) return;
        setBusy(true);
        setFailure(null);
        rpc("regenerate", { sessionId, messageId }).then((result) => {
          if (!alive.current) return;
          setBusy(false);
          if (!result.ok) setFailure(result.error?.message || t("regenerateError"));
        });
      }, [busy, sessionId, messageId, t]);

      const openEditor = React.useCallback(() => {
        setFailure(null);
        setLoading(true);
        setEditOpen(true);
        rpc("get-message", { sessionId, messageId }).then((result) => {
          if (!alive.current) return;
          setLoading(false);
          if (result.ok) {
            setText(result.text ?? "");
            setReasoning(result.reasoning ?? "");
          } else {
            setText("");
            setReasoning("");
            setFailure(result.error?.message || t("editError"));
          }
        });
      }, [sessionId, messageId, t]);

      const onSave = React.useCallback(() => {
        if (busy) return;
        const body = {};
        if (text !== undefined) body.text = text;
        if (reasoning !== undefined) body.reasoning = reasoning;
        setBusy(true);
        setFailure(null);
        rpc("rewrite-message", { sessionId, messageId, ...body }).then((result) => {
          if (!alive.current) return;
          setBusy(false);
          if (result.ok) setEditOpen(false);
          else setFailure(result.error?.message || t("editError"));
        });
      }, [busy, sessionId, messageId, text, reasoning, t]);

      return React.createElement(React.Fragment, null,
        editOpen ? React.createElement("div", { className: "msg-edit-editor" },
          React.createElement("div", { className: "msg-edit-field" },
            React.createElement("span", { className: "msg-edit-label" }, t("editReasoning")),
            React.createElement("textarea", {
              className: "msg-edit-textarea",
              value: reasoning,
              placeholder: "…",
              onChange: (e) => setReasoning(e.target.value),
            })),
          React.createElement("div", { className: "msg-edit-field" },
            React.createElement("span", { className: "msg-edit-label" }, t("editText")),
            React.createElement("textarea", {
              className: "msg-edit-textarea",
              value: text,
              placeholder: "…",
              onChange: (e) => setText(e.target.value),
            })),
          failure && React.createElement("div", { className: "msg-edit-failure", role: "status" }, failure),
          React.createElement("div", { className: "msg-edit-editor-actions" },
            React.createElement("button", {
              type: "button",
              className: "msg-edit-btn",
              disabled: busy || loading,
              onClick: () => setEditOpen(false),
            }, t("editCancel")),
            React.createElement("button", {
              type: "button",
              className: "msg-edit-btn",
              disabled: busy || loading,
              onClick: onSave,
            }, React.createElement(IconCheckOutline16, {}), busy ? t("busy") : t("editSave"))))
          : React.createElement("span", { className: "msg-edit-actions" },
              React.createElement(Tooltip, {
                label: t("editAssistant"),
                side: "bottom",
                children: React.createElement("button", {
                  type: "button",
                  className: "msg-edit-btn",
                  "aria-label": t("editAssistant"),
                  disabled: busy,
                  onClick: openEditor,
                  children: React.createElement(IconEditOutline16, {}),
                }),
              }),
              React.createElement(Tooltip, {
                label: t("regenerate"),
                side: "bottom",
                children: React.createElement("button", {
                  type: "button",
                  className: "msg-edit-btn",
                  "aria-label": t("regenerate"),
                  disabled: busy,
                  onClick: onRegenerate,
                  children: React.createElement(IconRefreshOutline16, {}),
                }),
              }),
              failure && React.createElement("span", { className: "msg-edit-failure", role: "status" }, failure)));
    }

    const inject = ["slots", "locale"];
    function apply(ctx) {
      const styleEl = document.createElement("style");
      styleEl.textContent = inlineCss.join("");
      document.head.appendChild(styleEl);
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "msg-edit:dictionaries");
      ctx.slots.inject("conversation.chat.assistant-actions", () => {
        const dispose = ctx.slots.register({
          name: "conversation.chat.assistant-actions",
          id: "msg-edit",
          order: 20,
          locale: NS,
          inject: (sessionId) => ({ sessionId }),
        }, MsgEditActions);
        return () => { dispose(); };
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
