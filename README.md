# Antigravity Plugins

用于独立版 Google Antigravity App 的插件。

## 上下文用量

在当前会话的右侧面板显示已用 token、会话有效上限、占用比例和可用空间。明细取自 Antigravity 本地服务。面板打开时每 5 秒刷新，切到后台时暂停请求。

### 安装

在仓库根目录执行下面的命令，把插件目录复制到 Antigravity 的全局插件目录。项目内安装也可以把插件放到项目的 `.agents/plugins/` 下。

```bash
mkdir -p ~/.gemini/config/plugins
cp -R plugins/context-usage ~/.gemini/config/plugins/
```

重启 Antigravity App，打开 **Customizations → Installed**，找到并启用 **上下文用量**。进入一个会话，从右侧面板的新标签页或 Overview 打开 **上下文用量**。

如需卸载，先在 App 中禁用插件，再移除 `~/.gemini/config/plugins/context-usage` 目录。

### 数据口径

插件使用 App 提供的 Sidecar SDK 和 Node 运行时。统计来自当前会话在本地语言服务的 `contextWindowUsage`，无需安装其他运行时或配置 API Key。服务没有返回统计时，面板显示等待状态。

占用百分比使用本地服务返回的有效上下文上限。该接口由 Antigravity App 内部使用，新版本可能调整字段或行为。实现时参考了 [AGY UsageHUD 对接口的记录](https://github.com/ba-lison/agy-usage-hud)。
