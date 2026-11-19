# Antigravity Plugins

用于独立版 Google Antigravity App 的插件。

## 上下文用量

`plugins/desktop-context/` 收录了上游 [antigravity-desktop-context](https://github.com/dimitr-io/antigravity-desktop-context) 的源码、资源与测试，基于 [`8f7e92b`](https://github.com/dimitr-io/antigravity-desktop-context/tree/8f7e92b007543ec4346337b6f92e7bb5515e3e54)，遵循 [MIT 许可证](plugins/desktop-context/LICENSE)。

面板以中文显示模型名称、上下文占用图、分类用量、检查点和上下文文件，并支持复制原始 CLI 格式的文本报告。将指针移到圆点上，或用 Tab 聚焦，可查看该颜色对应的用量和占比。百分比以模型的原生上下文窗口为分母。

### 安装

Antigravity App 需要能在 `PATH` 上找到 Python 3.10 或更新版本。在仓库根目录执行：

```bash
mkdir -p ~/.gemini/config/plugins
cp -R plugins/desktop-context ~/.gemini/config/plugins/
```

打开 **个性化定制 → 已安装**，查看 **上下文用量**。在会话右侧打开 **概览 → 扩展 → 上下文用量**。如果界面仍显示旧插件，关闭旧标签页后重新进入「已安装」。

详细说明与测试命令见 [上游 README](plugins/desktop-context/README.md)。

## 语言包管理

`plugins/language-packs/` 是与「上下文用量」独立的扩展。它内置简体和繁体词库，从本机 `antigravity2-cn` 的词库整理而来。

在仓库根目录复制扩展到 Antigravity 的全局插件目录：

```bash
mkdir -p ~/.gemini/config/plugins
cp -R plugins/language-packs ~/.gemini/config/plugins/
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

在仓库根目录执行：

```bash
mkdir -p ~/.gemini/config/plugins
cp -R plugins/progress-updates ~/.gemini/config/plugins/
```

无需重启或新开会话，下一轮对话即自动生效；可在 **个性化定制 → 已安装** 中随时启用或停用。
