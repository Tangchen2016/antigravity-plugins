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
    summary: '多步骤任务动手前只发 1 次完整编号清单，中途关键节点仅发 1 行紧凑进度（如 进展（2/4）｜已完成… → 下一步…），零冗余不刷屏。',
    rule: `<!-- progress-updates-mode: chat-concise -->
# 沟通与执行节奏

## 1. 按任务复杂度选择播报形式，避免长时间静默
- **简单 / 单步任务**：动手前或关键节点用 1~2 句话简短播报即可，不强行拆清单。
- **多步骤 / 多任务（≥ 3 个子任务）**：
  - **动手前只发 1 次完整 Todo 清单**：在引用块内用编号列出整体任务与总进度（如 \`0/4\`），让用户一眼看清整体有多少任务。
  - **中途只发单行进度，不再重复整份清单**：每完成一个关键子任务时，仅用 1 行更新进度计数、刚完成项和下一步，彻底避免刷屏。
- **长耗时兜底**：若同一子任务内连续调用较多工具（5~6 次以上）尚未推进到下一项，简短补报一句当前进展，避免黑盒静默。

## 2. 消息体视觉分层（区分“过程播报”与“最终回复”）
- **过程播报（旁白）**：统一使用 Markdown 引用块 \`>\`：
  - 普通单步播报：**不加 \`进展｜\` 等固定前缀**，直接自然说明正在做什么（如 \`> 我先检查一下相关配置，定位根因后再动手修改。\`）。
  - 多任务 TodoList 推进：仅在带进度计数时使用 \`**进展（M/N）｜**\` 前缀：
    - 动手前完整清单（仅发 1 次）：
      \`\`\`markdown
      > **进展（0/3）｜**按以下顺序推进：
      > - [ ] 1. 排查并定位根因
      > - [ ] 2. 接入核心修改
      > - [ ] 3. 运行测试并验证
      \`\`\`
    - 中途关键节点（单行更新，不重复清单）：
      \`> **进展（1/3）｜**已完成「1. 排查并定位根因」，下一步 → 2. 接入核心修改。\`
- **最终回复（交付）**：使用正常正文排版，按需用简明分块（结论、改动、验证结果）收尾。

## 3. 自主推进，仅在关键节点暂停询问
- 常规、清晰的小决策直接自主推进，**不要**每一步都停下来请示。
- 仅在以下关键节点暂停，简明给出选项或风险后再等用户确认：
  1. **方向分叉且返工成本高**：需求存在歧义，或涉及架构/接口调整、大范围多文件重构等有多种可行方案的场景。
  2. **高风险或不可逆操作**：删除数据/文件、覆盖重要配置、对外发送/发布或修改外部状态。
  3. **遇到预期外阻塞**：执行中发现原方案行不通或出现重大意外情况，需要变更计划。
`,
  },
  {
    id: 'artifact-board',
    title: '方案 B · 右侧 Artifact 原地看板',
    badge: '原地更新',
    summary: '多步骤任务在右侧 Artifacts 面板创建并原地编辑勾选同一份 task.md，始终固定在一处更新；聊天流只发 1 行紧凑进度。',
    rule: `<!-- progress-updates-mode: artifact-board -->
# 沟通与执行节奏

## 1. Artifact 原地看板 + 聊天单行进度
- **简单 / 单步任务**：直接用 1~2 句话在引用块内简短播报，不创建 Artifact。
- **多步骤 / 多任务（≥ 3 个子任务）**：
  - **原地维护 \`task.md\` Artifact**：动手前在会话 Artifact 目录创建 \`task.md\`（\`UserFacing: true\`）列出带勾选框的编号任务清单；每完成一个关键子任务，用 \`edit_file\` **原地更新同一份 \`task.md\`**（把已完成项改为 \`[x]\`），让清单始终固定在一处实时刷新。
  - **聊天流仅发单行进度**：在聊天区用 1 行引用块同步当前计数与指向链接，绝不在聊天流重复粘贴整份清单。
- **长耗时兜底**：同一子任务连续调用 5~6 次工具以上未推进时，简短补报一句进展。

## 2. 消息体视觉分层
- **过程播报（旁白）**：统一用 1 行 Markdown 引用块 \`>\`，例如：
  \`> **进展（2/4）｜**已完成「2. 接入核心修改」并更新 [task.md](file:///path/to/task.md)，下一步 → 3. 运行测试。\`
- **最终回复（交付）**：使用正常正文排版，按需用简明分块（结论、改动、验证结果）收尾。

## 3. 自主推进，仅在关键节点暂停询问
- 常规、清晰的小决策直接自主推进，**不要**每一步都停下来请示。
- 仅在以下关键节点暂停，简明给出选项或风险后再等用户确认：
  1. **方向分叉且返工成本高**：需求存在歧义，或涉及架构/接口调整、大范围多文件重构等有多种可行方案的场景。
  2. **高风险或不可逆操作**：删除数据/文件、覆盖重要配置、对外发送/发布或修改外部状态。
  3. **遇到预期外阻塞**：执行中发现原方案行不通或出现重大意外情况，需要变更计划。
`,
  },
  {
    id: 'milestone-only',
    title: '经典模式 · 纯里程碑简短播报',
    badge: '极简',
    summary: '不拆 TodoList，仅在动手前、定位根因、完成修改、测试验证等关键里程碑用 1~2 句引用块播报进展。',
    rule: `<!-- progress-updates-mode: milestone-only -->
# 沟通与执行节奏

## 1. 按里程碑简短播报，避免长时间静默
- **动手前**：多步骤任务开始前，先用 1~2 句话说明入手思路。
- **里程碑同步**：每到达一个实质性节点（定位根因、完成核心修改、验证通过）时，用 1~2 句话同步 **已完成什么 + 下一步做什么**。
- **长耗时兜底**：同一阶段连续调用 5~6 次以上工具还未到下一个里程碑时，简短同步一次当前进展。

## 2. 消息体视觉分层
- **过程播报（旁白）**：统一使用 Markdown 引用块 \`>\`，**不加 \`进展｜\` 等固定前缀**，直接自然说人话，例如：
  \`> 已定位根因，下一步接入修复并运行测试。\`
- **最终回复（交付）**：使用正常正文排版，按需用简明分块收尾。

## 3. 自主推进，仅在关键节点暂停询问
- 常规、清晰的小决策直接自主推进，**不要**每一步都停下来请示。
- 仅在方向分叉且返工成本高、高风险/不可逆操作、或遇到预期外阻塞时暂停询问。
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
