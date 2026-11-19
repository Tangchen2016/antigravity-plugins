# Antigravity Plugins

用于独立版 Google Antigravity App 的插件合集。

## 一键安装

安装全部插件：

```bash
curl -fsSL https://raw.githubusercontent.com/Tangchen2016/antigravity-plugins/main/install.sh | bash
```

> 再次运行同一条命令即可更新到最新版本；若已克隆仓库到本地，也可直接执行 `./install.sh` 或 `./install.sh <插件名>`。

## 插件列表

| 插件 | 类型 | 核心功能 | 入口 / 生效方式 | 一键安装 |
| :--- | :--- | :--- | :--- | :--- |
| **上下文用量** (`desktop-context`) | 侧边栏扩展 | 中文展示模型名称、上下文点阵图、分类 Token 占用、检查点与上下文文件，支持双向悬停联动和一键复制 CLI 文本报告 | 会话右侧 **概览 → 扩展 → 上下文用量** | `curl -fsSL https://raw.githubusercontent.com/Tangchen2016/antigravity-plugins/main/install.sh \| bash -s -- desktop-context` |
| **语言包管理** (`language-packs`) | 侧边栏扩展 | 内置简/繁体词库，支持一键切换、导入 JSON 热更新词库（约 3 秒生效）与恢复基础词库 | 会话右侧 **概览 → 扩展 → 语言包管理** | `curl -fsSL https://raw.githubusercontent.com/Tangchen2016/antigravity-plugins/main/install.sh \| bash -s -- language-packs` |
| **进度播报与节奏控制** (`progress-updates`) | 全局规则 | 让 Agent 按关键里程碑用引用块弱化播报进展，常规步骤自主推进，仅在分叉/高风险/阻塞节点暂停确认 | 下一轮对话自动生效 | `curl -fsSL https://raw.githubusercontent.com/Tangchen2016/antigravity-plugins/main/install.sh \| bash -s -- progress-updates` |

---

## 上下文用量

`plugins/desktop-context/` 提供中文上下文用量面板，显示模型名称、上下文占用图、分类用量、检查点和上下文文件，并支持复制原始 CLI 格式的文本报告。将指针移到圆点或分类行上，或用 Tab 聚焦，可双向高亮查看该分类对应的用量和占比。百分比以模型的原生上下文窗口为分母。

### 安装

Antigravity App 需要能在 `PATH` 上找到 Python 3.10 或更新版本。执行：

```bash
curl -fsSL https://raw.githubusercontent.com/Tangchen2016/antigravity-plugins/main/install.sh | bash -s -- desktop-context
```

打开 **个性化定制 → 已安装**，查看 **上下文用量**。在会话右侧打开 **概览 → 扩展 → 上下文用量**。如果界面仍显示旧插件，关闭旧标签页后重新进入「已安装」。

详细说明与测试命令见 [插件说明](plugins/desktop-context/README.md)。

## 语言包管理

`plugins/language-packs/` 是与「上下文用量」独立的扩展。它内置简体和繁体词库，从本机 `antigravity2-cn` 的词库整理而来。

### 安装

```bash
curl -fsSL https://raw.githubusercontent.com/Tangchen2016/antigravity-plugins/main/install.sh | bash -s -- language-packs
```

在会话中打开 **概览 → 扩展 → 语言包管理**。每次可启用一种语言包。用 **更新词库** 导入 JSON，格式为 `{"英文原文":"译文"}`。启用中的语言包更新后会立即写入热更新目录，主窗口通常在约 3 秒内刷新。停用语言包后会回到基础词库。

扩展依赖已经安装的 `antigravity2-cn` 词库热更新运行时。本机默认目录是 `~/Mine/antigravity2-cn/dicts`。如运行时使用其他目录，可在扩展的 `sidecar.json` 中通过 `env.ANTIGRAVITY_HOT_DICTIONARY_DIR` 设置相应绝对路径。

停用和移除扩展前，请先在管理面板停用当前语言包。语言包由扩展写成独立的词库文件，基础词库不受覆盖。切换语言包适用于主窗口的词典文案，原生菜单和硬编码文案使用当前安装的汉化版本。

## 进度播报与节奏控制

`plugins/progress-updates/` 是一个全局规则插件，用于改善模型在多步骤任务中长时间静默执行的问题：

- **里程碑播报**：在动手前、定位根因、完成核心修改、完成验证等节点用 1~3 句话同步进展，长耗时连续调用工具时兜底播报。
- **视觉分层**：过程播报统一用 `> **进展｜**...` 引用块弱化显示，与最终正文回复拉开层级。
- **关键节点才暂停**：常规小决策自主推进，仅在方向分叉且返工成本高、高风险/不可逆操作或遇到预期外阻塞时停下来确认。

### 安装

```bash
curl -fsSL https://raw.githubusercontent.com/Tangchen2016/antigravity-plugins/main/install.sh | bash -s -- progress-updates
```

无需重启或新开会话，下一轮对话即自动生效；可在 **个性化定制 → 已安装** 中随时启用或停用。
