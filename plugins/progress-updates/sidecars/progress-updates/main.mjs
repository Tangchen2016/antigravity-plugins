import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Response, SidecarApp } from 'sidecar_sdk';

const rulesPath = fileURLToPath(new URL('../../rules/AGENTS.md', import.meta.url));
const pagePath = new URL('./index.html', import.meta.url);

const MODES = [
  {
    id: 'chat-concise',
    title: '方案 A · 聊天极简 TodoList（推荐）',
    badge: '默认',
    summary: '多步骤任务动手前发 1 次编号清单，常规排查静默执行，仅在关键节点发 1 行（≤30 字）紧凑进度，克制省 Token。',
    rule: `<!-- progress-updates-mode: chat-concise -->
# 沟通与执行节奏

## 1. 按节点克制播报（减少冗余与 Token 消耗）
- **简单 / 单步任务**：直接执行并回复，无需每步播报。
- **多步骤任务（≥ 3 个子任务）**：
  - **动手前发 1 次清单**：用 \`>\` 引用块列出编号 Todo（如 \`0/3\`），仅发这一次。
  - **常规排查允许静默**：连续读文件、查代码或探测时**不要**每调一次工具就播报，优先合并并行调用减少轮次。
  - **仅在节点发单行进度**：每完成一个子任务时，或连续静默调用 4~5 轮工具仍未到下一节点时，补发 **1 行**进度。
- **字数硬限制**：单条进度播报控制在 **1 行、≤ 30 字**，只写阶段结论与下一步，不复述命令参数、中间试错或 UI 已展示的工具名。

## 2. 视觉分层
- **过程播报**：统一用 \`>\` 引用块：
  - 动手前清单（仅 1 次）：
    \`\`\`markdown
    > **进展（0/3）｜**按以下顺序推进：
    > - [ ] 1. 定位根因
    > - [ ] 2. 接入修改
    > - [ ] 3. 测试验证
    \`\`\`
  - 节点单行更新：\`> **进展（1/3）｜**已定位根因，下一步接入修改。\`
- **最终回复**：正常正文排版，简明呈现结论、改动与验证结果。

## 3. 自主推进，仅在关键节点暂停
- 常规小决策直接推进；仅在**方向分叉/高返工风险**、**高风险或不可逆操作**、或**遇到预期外阻塞**时暂停确认。
`,
  },
  {
    id: 'artifact-board',
    title: '方案 B · 右侧 Artifact 原地看板',
    badge: '原地更新',
    summary: '多步骤任务在右侧 Artifacts 面板原地维护 task.md，常规排查静默执行，仅在节点发 1 行（≤30 字）同步。',
    rule: `<!-- progress-updates-mode: artifact-board -->
# 沟通与执行节奏

## 1. Artifact 原地看板 + 节点单行进度
- **简单 / 单步任务**：直接执行并回复，不创建 Artifact。
- **多步骤任务（≥ 3 个子任务）**：
  - **原地维护 \`task.md\`**：动手前在 Artifact 目录创建 \`task.md\`（\`UserFacing: true\`）；每完成一个子任务用 \`edit_file\` 原地勾选 \`[x]\`。
  - **常规排查允许静默**：连续调工具时不逐轮播报，优先并行调用；仅在完成子任务或连续 4~5 轮无进展时，在聊天区发 **1 行**同步。
- **字数硬限制**：单条播报 **1 行、≤ 30 字**，不复述中间试错与工具细节。

## 2. 视觉分层
- **过程播报**：单行 \`>\` 引用块，如 \`> **进展（2/4）｜**已完成修改并更新 [task.md](file:///path/to/task.md)，下一步测试。\`
- **最终回复**：正常正文排版，简明呈现结论、改动与验证结果。

## 3. 自主推进，仅在关键节点暂停
- 常规小决策直接推进；仅在**方向分叉/高返工风险**、**高风险或不可逆操作**、或**遇到预期外阻塞**时暂停确认。
`,
  },
  {
    id: 'milestone-only',
    title: '经典模式 · 纯里程碑简短播报',
    badge: '极简',
    summary: '不拆 TodoList，常规操作静默执行，仅在关键里程碑发 1 行（≤30 字）简短同步。',
    rule: `<!-- progress-updates-mode: milestone-only -->
# 沟通与执行节奏

## 1. 纯里程碑极简播报
- **常规操作静默执行**：不拆 TodoList，不对每次工具调用逐轮播报，优先并行调用减少轮次。
- **仅在关键节点同步**：仅在复杂任务动手前、定位根因、完成修改、或连续 4~5 轮工具无节点变化时，发 **1 行**简短进展。
- **字数硬限制**：单条播报 **1 行、≤ 30 字**，不加 \`进展｜\` 前缀，不复述工具细节。

## 2. 视觉分层
- **过程播报**：单行 \`>\` 引用块，如 \`> 已定位根因，下一步接入修复并验证。\`
- **最终回复**：正常正文排版，简明收尾。

## 3. 自主推进，仅在关键节点暂停
- 常规小决策直接推进；仅在**方向分叉/高返工风险**、**高风险或不可逆操作**、或**遇到预期外阻塞**时暂停确认。
`,
  },
];

function detectActiveMode() {
  try {
    const content = readFileSync(rulesPath, 'utf8');
    const m = content.match(/<!--\s*progress-updates-mode:\s*([a-z-]+)\s*-->/);
    if (m && MODES.some((item) => item.id === m[1])) return m[1];
  } catch { /* fallback */ }
  return 'chat-concise';
}

function getState() {
  return {
    activeMode: detectActiveMode(),
    modes: MODES.map(({ id, title, badge, summary }) => ({ id, title, badge, summary })),
  };
}

const app = new SidecarApp();
app.page('/', () => new Response(readFileSync(pagePath, 'utf8'), { contentType: 'text/html; charset=utf-8' }));

app.api('/api/state', () => getState());
app.api('/api/set-mode', ({ mode } = {}) => {
  const target = MODES.find((m) => m.id === mode);
  if (!target) return { error: '未知的播报模式。' };
  mkdirSync(dirname(rulesPath), { recursive: true });
  writeFileSync(rulesPath, target.rule, 'utf8');
  return getState();
});

app.run();
