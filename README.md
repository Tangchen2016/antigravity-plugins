# Antigravity Plugins

用于独立版 Google Antigravity App 的插件。

## Context Usage

`plugins/desktop-context/` 收录了上游 [antigravity-desktop-context](https://github.com/dimitr-io/antigravity-desktop-context) 的原版源码、资源与测试，版本固定在 [`8f7e92b`](https://github.com/dimitr-io/antigravity-desktop-context/tree/8f7e92b007543ec4346337b6f92e7bb5515e3e54)，遵循 [MIT 许可证](plugins/desktop-context/LICENSE)。

面板为英文，包含模型名称、上下文占用图、分类用量、检查点、上下文文件及复制文本报告功能。百分比以模型的原生上下文窗口为分母。

### 安装

Antigravity App 需要能在 `PATH` 上找到 Python 3.10 或更新版本。在仓库根目录执行：

```bash
mkdir -p ~/.gemini/config/plugins
cp -R plugins/desktop-context ~/.gemini/config/plugins/
```

打开 **个性化定制 → 已安装**，查看 **Context Usage**。在会话右侧打开 **概览 → 扩展 → Context Usage**。如果界面仍显示旧插件，关闭旧标签页后重新进入「已安装」。

详细说明与测试命令见 [上游 README](plugins/desktop-context/README.md)。
