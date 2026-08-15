# dsh-msg-edit

消息编辑 / 重新生成插件（DeepSeek Harness Web）。

- **host 插件**（Cordis node 侧）：`/api/msg-edit/*` 4 条 HTTP RPC
  - `rewrite-message` — 改写单条助手回复（正文/思考），不截断后续
  - `edit-message` — 编辑用户消息，截断其后所有节点并重新生成
  - `regenerate` — 重新生成某条回复（回溯到归属的真实用户消息）
  - `get-message` — 读取助手回复当前文本（编辑预填）
- **client 插件**（`dsh.client` 声明式）：助手消息操作条注入「编辑这条回复」「重新生成回复」，编辑弹出行内编辑器（思考+正文），保存走 `rewrite-message`。

纯声明式 Cordis bundle：`dsh.bundle.patch` 指向 `cordis.patch.yml`，无安装脚本、无构建步骤、无源码补丁工具。

## 安装

### 方式 A：dsh plugin（推荐）

```bash
# 在 profile 目录内（$DSH_HOME/profiles/<profile>）
dsh plugin --profile web add @moton16/dsh-msg-edit
```

`dsh` 会从 npm 安装包，读到 `dsh.bundle.patch` 后自动把两行插件追加进 profile 的 patch 层。**手动重启 dsh web** 生效（本插件不代重启）。

### 方式 B：git 安装

```bash
dsh plugin --profile web add github:moton16/dsh-msg-edit
```

仓库内已提交预构建 `lib/`（运行时 JS），无需 `prepare`/`postinstall`；若 pnpm 提示构建授权，按提示在 profile 的 `pnpm-workspace.yaml` 中 `allowBuilds` 放行本包即可（源码可信才放行）。

### 方式 C：手动挂载（本地开发）

1. 把 `lib/` 放进 profile 依赖树（或 `pnpm link`）；
2. 在 profile 的 `cordis.patch.yml` 追加：
   ```yaml
   - insert:
       - id: msg-edit-host
         name: '@moton16/dsh-msg-edit'
       - id: ui-msg-edit
         name: '@moton16/dsh-msg-edit/client'
   ```
3. 手动重启 dsh web，浏览器 Ctrl+F5。
   或直接以本仓库的 `cordis.yml` 作为 `--patch` overlay 启动：`dsh web --profile web --patch ./cordis.yml`。

## 验证

- host：`POST /api/msg-edit/{get-message,rewrite-message,edit-message,regenerate}` 返回 HTTP 200 + `{ok:false,error:{code:'bad-request',...}}`（空参）即路由生效。
- client：助手消息悬停出现铅笔（编辑这条回复）与循环（重新生成回复）按钮；点击编辑弹出「思考/正文」行内编辑器。
- 本地复验记录：`docs/VERIFICATION.md`（插件路由 4/4、UI 按钮渲染、截图证据）。

## 已知限制（如实披露，dsh.so 审核要求）

插件本体零源码修改；但「编辑/重新生成」在事件溯源日志上追加 **surface-replace 副本事件**，dsh `0.1.0-rc.6` 的配套组件对这类事件存在以下官方未覆盖行为，**需按本机情况处理**：

1. **token-meter 重放崩溃（compact 必崩）**：`dsh-token-meter@0.1.0-rc.6` 的 `_foldEvent` 对 assistant/message 事件要求配对 step/start；replace 副本（在其所属 step 结束后追加）无配对，重放抛 `token meter: assistant/message at seq N has no matching step/start event`，导致 `/compact` 失败。官方仓库（deepseek-ai/deepseek-harness）master 尚未合入对 replace 副本的重放支持。**在官方修复前**，安装侧需对 `dsh-token-meter/lib/index.js` 的 `_foldEvent` assistant/message 分支应用一处社区修复（识别 `event.surfaceOp.op === 'replace'` 副本：跳过 step/start 配对校验、带 usage 时按当前 surface 总量更新锚点、不带 usage 时保持锚点不变；已验证 224605 事件全量重放 CLEAN）。本包为合规不附带补丁脚本，修复文本见下方「兼容补丁」小节，由安装者自行评估应用。
2. **surface 投影**：编辑后 Web 渲染管线依赖一处社区 surface 投影逻辑（replace 后 surface 状态立即反映新节点）；官方渲染器对 replace 副本的即时投影缺位，未应用该投影时，编辑结果在刷新/重放后才可见。
3. **agent-loop 去重**：编辑/重新生成后 followup 提交与日志 tail 相同的 user/message 时，官方 agent-loop 会重复 append，可能产生一次空转 turn；社区去重逻辑（tail 同 id 跳过）可消除，非崩溃级。
4. **用户消息编辑按钮**：`conversation.chat.node` keyed renderer 的 user 槽被官方 ui-conversation 独占，本插件未覆盖该 renderer，因此「用户消息行内编辑」入口不在本插件范围内（host 的 `edit-message` RPC 仍可用，可由其他 UI 调用）。

> 说明：限制 1 是功能正确性依赖（否则 compact 失败）；限制 2-4 为体验级。官方对应组件合入支持后，本插件无需改动即可解除。

## 兼容补丁（限制 1 的社区修复，供安装者评估）

文件：`node_modules/@deepseek-ai/dsh-token-meter/lib/index.js`，类 `TokenMeter` 的 `_foldEvent` 方法，`if (event.type === "assistant/message")` 分支：

- 原：`if (stepStart === void 0 || stepStart.turn !== event.data.turn || stepStart.step !== event.data.step) throw ...`
- 改：先判定 `const replaceCopy = event.surfaceOp !== void 0 && typeof event.surfaceOp === "object" && event.surfaceOp.op === "replace"`，throw 条件加 `!replaceCopy &&`；
- 锚点逻辑改三路：`replaceCopy && usage` → 以 `usageTokens(event.data.usage)` 与 `estimateHeader(nextHeader) + surface.tokens` 的较大者更新锚点（surfaceTokens 取当前 surface 总量，不重算 sourceEventSeqs）；`!replaceCopy && usage` → 原逻辑；`!replaceCopy && !usage` → 原逻辑；`replaceCopy && !usage` → 锚点不变。

## 许可 / 兼容

- MIT；作者 @moton16。
- 兼容 `@deepseek-ai/dsh-base` / `dsh-web-app` `0.1.0-rc.6`（peerDependencies 声明）。依赖 dsh 的 slot 系统（`conversation.chat.assistant-actions`）、`webServer.register`、`sessions`/`agents` 服务，这些在 rc.6 均稳定。
