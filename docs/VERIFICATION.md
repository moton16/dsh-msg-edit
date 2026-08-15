# VERIFICATION — 2026-08-15 msg-edit 插件化清理（撤销旧补丁，迁移至官方 dsh.client 插件）

日期：2026-08-15
任务：将「消息编辑/重新生成」从源码补丁彻底迁移到官方 dsh.client 声明式插件。
阶段 A（本会话复验，已完成）：插件已加载生效；阶段 B（本记录）：撤销 3 个可撤销旧补丁。

## 改动文件（4，均为 dsh 安装树 E:\softwares\dsh-cli\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\）

| 文件 | 处置 |
|---|---|
| dsh-host-apiproxy\lib\index.js | 外科摘除 session.rewriteMessage / session.editMessage / session.regenerate（schema+方法+RPC_MAP）；保留 image-vision 降级集成 |
| dsh-client-connection\lib\client.js | 整文件还原为原始版（3 个 RPC 方法全部移除） |
| dsh-client-ui-conversation\lib\client.js | 移除旧「重新生成/编辑助手回复」按钮与行内编辑器；保留用户消息编辑（onEdit/beginEdit/pendingEdit）；onEdit 的提交链路改接 host 插件路由 /api/msg-edit/edit-message |
| dsh-client-ui-conversation\lib\types\client\locales.d.ts | 仅保留 'message.edit'，移除 6 个未用键 |

保留（不动）：dsh-client-runtime（surface 投影）、dsh-agent-loop（append 去重）。

## 哈希

| 文件 | 清理前 SHA256(前16) | 清理后 SHA256(前16) | 备份路径 |
|---|---|---|---|
| dsh-host-apiproxy\lib\index.js | BDBA766A359D1C61 | 2871BBCD9FBBCA68 | cleanup-backups-20260815\dsh-host-apiproxy_lib_index.js |
| dsh-client-connection\lib\client.js | 6AC7A06DF75BD87A | 45FDCF6F5CD77216（=原始版） | cleanup-backups-20260815\dsh-client-connection_lib_client.js |
| dsh-client-ui-conversation\lib\client.js | E766AF5442810A9D | BDE198BE7BAFE673 | cleanup-backups-20260815\dsh-client-ui-conversation_lib_client.js |
| dsh-client-ui-conversation\lib\types\client\locales.d.ts | 237E8B3BA870F5A4 | E0724F34B3D6E7CD（=原始版+message.edit） | cleanup-backups-20260815\dsh-client-ui-conversation_lib_types_client_locales.d.ts |

## 验证命令与结果

### BASELINE（清理前）
- `node --check` 4 个文件：apiproxy 0 / client-connection 0 / client-ui 0 / locales(非JS跳过) —— 通过
- client-connection == patched 副本（SHA256 一致）；client-runtime / client-ui / agent-loop == patched（保留项在位）
- 插件路由实测：POST /api/msg-edit/{get-message,rewrite-message,edit-message,regenerate} 均 HTTP 200 + 结构化 JSON

### MODIFIED（清理后）
1. `node --check dsh-host-apiproxy\lib\index.js` → exit 0
2. `node --check dsh-client-connection\lib\client.js` → exit 0
3. `node --check dsh-client-ui-conversation\lib\client.js` → exit 0
4. client-connection 与 client-connection.edit2.orig 哈希一致（match=True），残留 RPC 标记 count=0
5. apiproxy 残留标记（rewriteMessage|editMessage|regenerate|session.*）→ 0 条；image-vision（degradeImageParts / mcp__image-vision__read_image）仍在（行 955/957/2875）
6. client-ui 残留引用（regenerateAction|editAction|regenerateSeq|setEditing(移除块内)|onEditAssistant 调用|session.regenerate|session.rewriteMessage|message.editAssistant|message.regenerate）→ 0 条（剩余 setEditing 命中为 queue-dock 另一组件，无关）
7. client-ui 保留功能在位：beginEdit（1440）/ pendingEdit（1339）/ fetch("/api/msg-edit/edit-message")（1462）/ onEdit handler（9812）/ message.edit 键（zh 5934 / en 6100）
8. locales.d.ts 终态 = 原始版 + 仅 'message.edit'（zh/en 各一），6 个未用键已移除
9. 全树扫描 session.(editMessage|rewriteMessage|regenerate)( 调用方（排除 client-connection）→ 0 条

### ROLLBACK（副本回滚测试）
- 命令：bash ROLLBACK-cleanup.sh <TEST_ROOT>（TEST_ROOT=rollback-cleanup-test/ 副本树）
- 结果：4 文件从备份还原，与备份哈希一致，node --check 全过 —— PASS
- 注：Windows 本机可用 `wsl bash` 或手动按脚本逻辑执行；核心为 cp 备份→目标 + node --check

## 生效要求
清理改动需**用户手动重启 dsh web** 后生效（本流程不代重启）。重启后预期：
- 助手操作条仅剩插件提供的「编辑这条回复」「重新生成回复」各一个（旧补丁重复按钮消失）
- 用户消息编辑（铅笔）继续可用，走 /api/msg-edit/edit-message
- host 插件 4 条路由与 MCP/工作台等其余插件不受影响
