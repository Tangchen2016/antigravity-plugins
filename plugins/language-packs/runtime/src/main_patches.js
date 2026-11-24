function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanJsContent(content, signatureStart, signatureEnd) {
    const regex = new RegExp("(?:\\r?\\n;)?\\r?\\n?" + escapeRegExp(signatureStart) + "[\\s\\S]*?" + escapeRegExp(signatureEnd), "g");
    return content.replace(regex, "");
}

function cleanMenuJsContent(content) {
    content = content.replace(/\n?\s*\/\* --- MENU TRANSLATION START --- \*\/[\s\S]*?\/\* --- MENU TRANSLATION END --- \*\//g, '');
    const startMark = "// ==========================================\n    // Antigravity Native Menu Chinese Translation";
    const endMark = "translateMenu(menu.items);";
    const startIdx = content.indexOf(startMark);
    const endIdx = content.indexOf(endMark);
    if (startIdx !== -1 && endIdx !== -1 && startIdx < endIdx) {
        return content.substring(0, startIdx) + content.substring(endIdx + endMark.length);
    }
    return content;
}

function cleanTrayJsContent(content) {
    content = content.replace(/\n\s*\/\* --- TRAY TRANSLATION START --- \*\/[\s\S]*?\/\* --- TRAY TRANSLATION END --- \*\//g, '');
    content = content.replace(/\n\s*\/\* --- TRAY DOUBLE CLICK START --- \*\/[\s\S]*?\/\* --- TRAY DOUBLE CLICK END --- \*\//g, '');
    content = content.replace(/\n\s*\/\* --- TRAY INSERT TRANSLATION START --- \*\/[\s\S]*?\/\* --- TRAY INSERT TRANSLATION END --- \*\//g, '');
    content = content.replace(/\/\* --- TRAY COUNT START:([A-Za-z0-9+/=]+) --- \*\/[\s\S]*?\/\* --- TRAY COUNT END --- \*\//g, (_m, b64) => Buffer.from(b64, 'base64').toString('utf8'));
    return content;
}

function cleanUtilsJsContent(content) {
    return content.replace(/\n?\s*\/\* --- SIDECAR TRANSLATION START --- \*\/[\s\S]*?\/\* --- SIDECAR TRANSLATION END --- \*\//g, '');
}

function patchUtilsJs(utilsContent, signatureStart, signatureEnd, dictionaryConfig) {
    console.log(`[修改] 正在向 utils.js 注入伴生面板 (Sidecar) 汉化钩子...`);
    const cleaned = cleanUtilsJsContent(utilsContent);
    const targetStr = "hubContents.on('will-navigate', guardExternalNavigation);";
    const idx = cleaned.indexOf(targetStr);
    if (idx === -1) {
        console.warn(`[警告] 未能在 utils.js 中找到 Sidecar 钩子插入点。`);
        return cleaned;
    }

    const dictionaryHook = dictionaryConfig ? `
    if (typeof isLocalHubTopFrame === 'function' && hubContents.ipc?.handle) {
        const readDictionary = (${dictionaryConfig.loadDictionary.toString()});
        const dictionaryDirectory = ${JSON.stringify(dictionaryConfig.directory)};
        const dictionaryBrand = ${JSON.stringify(dictionaryConfig.brandTitleMode)};
        let dictionaryRevision = 0;
        let previousDictionaryJson;
        hubContents.ipc.handle('ag-cn:dictionary', (event, knownRevision) => {
            if (event.sender !== hubContents || !isLocalHubTopFrame(event)) return null;
            try {
                const dictionary = readDictionary(require('fs'), require('path'), dictionaryDirectory, dictionaryBrand);
                const json = JSON.stringify(dictionary);
                if (json !== previousDictionaryJson) {
                    previousDictionaryJson = json;
                    dictionaryRevision++;
                }
                return knownRevision === dictionaryRevision ? null : { revision: dictionaryRevision, dictionary };
            } catch (_err) {
                // Editors can leave a file temporarily incomplete. Keep the previous snapshot.
                return null;
            }
        });
    }` : '';

    const sidecarHookJs = `/* --- SIDECAR TRANSLATION START --- */${dictionaryHook}
    const getSidecarLocalizationScript = () => {
        const preloadFile = typeof path_1 !== 'undefined' && path_1 && path_1.default
            ? path_1.default.join(__dirname, 'preload.js')
            : require('path').join(__dirname, 'preload.js');
        const cacheKey = '__agSidecarLocalizationScript:' + preloadFile;
        if (typeof globalThis[cacheKey] === 'string') {
            return globalThis[cacheKey];
        }
        try {
            const fsMod = typeof fs !== 'undefined' && fs && typeof fs.readFileSync === 'function' ? fs : require('fs');
            const preloadSrc = fsMod.readFileSync(preloadFile, 'utf8');
            const sIdx = preloadSrc.indexOf(${JSON.stringify(signatureStart)});
            const eIdx = sIdx !== -1 ? preloadSrc.indexOf(${JSON.stringify(signatureEnd)}, sIdx + ${signatureStart.length}) : -1;
            if (sIdx !== -1 && eIdx !== -1 && sIdx < eIdx) {
                const extracted = preloadSrc.slice(sIdx, eIdx + ${signatureEnd.length});
                globalThis[cacheKey] = extracted;
                return extracted;
            }
        } catch (_err) {}
        return '';
    };
    const resolveSidecarSubframe = (event, frameProcessId, frameRoutingId) => {
        if (event && event.frame) return event.frame;
        if (typeof frameProcessId === 'number' && typeof frameRoutingId === 'number') {
            return electron_1.webFrameMain?.fromId?.(frameProcessId, frameRoutingId) ?? null;
        }
        return null;
    };
    const checkSidecarIframeInHub = (targetUrl) => {
        try {
            const target = new URL(targetUrl);
            const iframes = document.querySelectorAll('iframe[data-testid="sidecar-iframe"]');
            for (const el of iframes) {
                const raw = el.getAttribute('src') || el.src || '';
                if (!raw) continue;
                const u = new URL(raw, location.href);
                if (u.origin !== target.origin) continue;
                const baseDir = u.pathname.slice(0, u.pathname.lastIndexOf('/') + 1);
                if (u.origin !== location.origin || target.pathname === u.pathname || target.pathname.startsWith(baseDir)) {
                    return true;
                }
            }
        } catch (_e) {}
        return false;
    };
    const injectSidecarSubframe = (frame) => {
        try {
            if (!frame || frame.isDestroyed?.() || win.isDestroyed?.() || hubContents.isDestroyed?.()) return;
            const mainFrame = hubContents.mainFrame;
            if (!mainFrame || frame === mainFrame || frame.parent !== mainFrame) return;
            const frameUrl = String(frame.url || '');
            if (!/^(?:https?|plugin):\\/\\//i.test(frameUrl)) return;
            const frameOrigin = String(frame.origin || '');
            if (!frameOrigin || frameOrigin === 'null') return;
            const script = getSidecarLocalizationScript();
            if (!script) return;
            const checkExpr = '(' + checkSidecarIframeInHub.toString() + ')(' + JSON.stringify(frameUrl) + ')';
            Promise.resolve(mainFrame.executeJavaScript(checkExpr))
                .then((isSidecar) => {
                    if (!isSidecar) return;
                    if (frame.isDestroyed?.() || win.isDestroyed?.() || hubContents.isDestroyed?.()) return;
                    return frame.executeJavaScript(script);
                })
                .catch(() => undefined);
        } catch (_err) {}
    };
    const onSidecarFrameNavigate = (event, _url, _httpResponseCode, _httpStatusText, isMainFrame, frameProcessId, frameRoutingId) => {
        if (isMainFrame) return;
        injectSidecarSubframe(resolveSidecarSubframe(event, frameProcessId, frameRoutingId));
    };
    const onSidecarFrameFinishLoad = (event, isMainFrame, frameProcessId, frameRoutingId) => {
        if (isMainFrame) return;
        injectSidecarSubframe(resolveSidecarSubframe(event, frameProcessId, frameRoutingId));
    };
    hubContents.on('did-frame-navigate', onSidecarFrameNavigate);
    hubContents.on('did-frame-finish-load', onSidecarFrameFinishLoad);
    win.on('closed', () => {
        hubContents.off?.('did-frame-navigate', onSidecarFrameNavigate);
        hubContents.off?.('did-frame-finish-load', onSidecarFrameFinishLoad);
    });
    /* --- SIDECAR TRANSLATION END --- */`;

    console.log(`[修改] 伴生面板 (Sidecar) 汉化钩子注入成功！`);
    return cleaned.substring(0, idx) + sidecarHookJs + "\n    " + cleaned.substring(idx);
}

function patchPreloadJs(content, translationJs, signatureStart, signatureEnd) {
    console.log(`[修改] 正在向 preload.js 注入汉化代码...`);
    const cleanedContent = cleanJsContent(content, signatureStart, signatureEnd);
    const newContent = cleanedContent + "\n;\n" + translationJs;
    console.log(`[修改] 注入成功！`);
    return newContent;
}

function patchMenuJs(menuContent, useTw) {
    console.log(`[修改] 正在向 menu.js 注入菜单汉化代码...`);
    const menuCleaned = cleanMenuJsContent(menuContent);

    const menuTranslationJs = `
    /* --- MENU TRANSLATION START --- */
    // ==========================================
    // Antigravity Native Menu Chinese Translation
    // ==========================================
    const translations = ${useTw ? `{
        'File': '檔案',
        'Edit': '編輯',
        'View': '檢視',
        'Window': '視窗',
        'Help': '說明',
        'New Window': '開新視窗',
        'Create Project': '建立專案',
        'Command Palette': '命令選擇區',
        'Docs': '說明文件',
        'Check for Updates': '檢查更新',
        'Checking for Updates...': '正在檢查更新...',
        'Downloading Update...': '正在下載更新...',
        'Restart to Update': '重新啟動以更新',
        'Toggle Developer Tools': '切換開發人員工具',
        'Undo': '復原',
        'Redo': '重做',
        'Cut': '剪下',
        'Copy': '複製',
        'Paste': '貼上',
        'Select All': '全選',
        'Minimize': '最小化',
        'Maximize': '最大化',
        'Close': '關閉',
        'Zoom': '縮放',
        'Reset Zoom': '重設縮放',
        'Actual Size': '實際大小',
        'Zoom In': '放大',
        'Zoom Out': '縮小',
        'Toggle Full Screen': '切換全螢幕',
        'Toggle Between Light/Dark Themes': '切換淺色/深色佈景主題',
        'Split Terminal': '分割終端機',
        'Split Conversation Horizontally': '水平分割對話',
        'Split Conversation Vertically': '垂直分割對話',
        'Split': '分割',
        'Split Right': '向右分割',
        'Split Down': '向下分割',
        'Replace With New': '替換為新對話',
        'Show in File Explorer': '在檔案總管中顯示',
        'Reveal in Finder': '在 Finder 中顯示',
        'Find in conversation': '在對話中尋找',
        'Connect to WSL': '連線至 WSL',
        'Reopen Locally': '在本機重新開啟',
        'About Antigravity': '關於 Antigravity',
        'Settings...': '設定...',
        'Preferences...': '偏好設定...',
        'Services': '服務',
        'Hide Antigravity': '隱藏 Antigravity',
        'Hide Others': '隱藏其他',
        'Show All': '顯示全部',
        'Quit Antigravity': '結束 Antigravity',
        'Quit': '結束',
        'Paste and Match Style': '貼上並符合樣式',
        'Delete': '刪除',
        'Bring All to Front': '將此程式所有視窗移至最前',
        'Close Window': '關閉視窗',
        'Version': '版本'
    }` : `{
        'File': '文件',
        'Edit': '编辑',
        'View': '视图',
        'Window': '窗口',
        'Help': '帮助',
        'New Window': '新建窗口',
        'Create Project': '创建项目',
        'Command Palette': '命令面板',
        'Docs': '文档',
        'Check for Updates': '检查更新',
        'Checking for Updates...': '正在检查更新...',
        'Downloading Update...': '正在下载更新...',
        'Restart to Update': '重启以更新',
        'Toggle Developer Tools': '切换开发者工具',
        'Undo': '撤销',
        'Redo': '重做',
        'Cut': '剪切',
        'Copy': '复制',
        'Paste': '粘贴',
        'Select All': '全选',
        'Minimize': '最小化',
        'Maximize': '最大化',
        'Close': '关闭',
        'Zoom': '缩放',
        'Reset Zoom': '重置缩放',
        'Actual Size': '实际大小',
        'Zoom In': '放大',
        'Zoom Out': '缩小',
        'Toggle Full Screen': '切换全屏',
        'Toggle Between Light/Dark Themes': '切换浅色/深色主题',
        'Split Terminal': '拆分终端',
        'Split Conversation Horizontally': '水平拆分会话',
        'Split Conversation Vertically': '垂直拆分会话',
        'Split': '拆分',
        'Split Right': '向右拆分',
        'Split Down': '向下拆分',
        'Replace With New': '替换为新会话',
        'Show in File Explorer': '在文件资源管理器中显示',
        'Reveal in Finder': '在访达中显示',
        'Find in conversation': '在会话中查找',
        'Connect to WSL': '连接到 WSL',
        'Reopen Locally': '在本地重新打开',
        'About Antigravity': '关于 Antigravity',
        'Settings...': '设置...',
        'Preferences...': '首选项...',
        'Services': '服务',
        'Hide Antigravity': '隐藏 Antigravity',
        'Hide Others': '隐藏其他',
        'Show All': '全部显示',
        'Quit Antigravity': '退出 Antigravity',
        'Quit': '退出',
        'Paste and Match Style': '粘贴并匹配样式',
        'Delete': '删除',
        'Bring All to Front': '前置全部窗口',
        'Close Window': '关闭窗口',
        'Version': '版本'
    }`};
    function translateMenu(items) {
        for (const item of items) {
            let label = item.label || '';
            let mnemonic = '';
            let cleanLabel = label;
            const m = label.match(/&([a-zA-Z])/);
            if (m) {
                mnemonic = "(&" + m[1] + ")";
                cleanLabel = label.replace('&', '');
            }
            if (!item._origLabel) item._origLabel = label;
            if (!item._origCleanLabel) item._origCleanLabel = cleanLabel;
            if (translations[cleanLabel]) {
                item.label = translations[cleanLabel] + mnemonic;
            } else if (translations[label]) {
                item.label = translations[label];
            } else if (/^Version\\s*([\\d\\.]*)$/i.test(cleanLabel)) {
                item.label = cleanLabel.replace(/^Version\\s*([\\d\\.]*)$/i, (match, v) => v ? "版本 " + v : "版本");
            }
            if (item.submenu && item.submenu.items) {
                translateMenu(item.submenu.items);
            }
        }
    }
    if (menu && Array.isArray(menu.items) && !menu.items._cnFindHooked) {
        menu.items._cnFindHooked = true;
        const origFind = menu.items.find.bind(menu.items);
        menu.items.find = function(pred, thisArg) {
            return origFind((it, idx, arr) => {
                if (pred.call(thisArg, it, idx, arr)) return true;
                if (it && it._origLabel && pred.call(thisArg, { ...it, label: it._origLabel }, idx, arr)) return true;
                if (it && it._origCleanLabel && pred.call(thisArg, { ...it, label: it._origCleanLabel }, idx, arr)) return true;
                return false;
            });
        };
    }
    if (!electron_1.Menu._cnHooked) {
        electron_1.Menu._cnHooked = true;
        const origSetAppMenu = electron_1.Menu.setApplicationMenu.bind(electron_1.Menu);
        electron_1.Menu.setApplicationMenu = function(m) {
            if (m && m.items) translateMenu(m.items);
            return origSetAppMenu(m);
        };
    }
    translateMenu(menu.items);
    /* --- MENU TRANSLATION END --- */`;

    const targetStr = "electron_1.Menu.setApplicationMenu(menu);";
    const idx = menuCleaned.indexOf(targetStr);
    if (idx !== -1) {
        console.log(`[修改] 菜单汉化注入成功！`);
        return menuCleaned.substring(0, idx) + menuTranslationJs + "\n    " + menuCleaned.substring(idx);
    } else {
        console.warn(`[警告] 未能在 menu.js 中找到设定的插入点。`);
        return menuCleaned;
    }
}

function patchTrayJs(trayContent, useTw) {
    console.log(`[修改] 正在向 tray.js 注入任务栏菜单汉化...`);
    let trayCleaned = cleanTrayJsContent(trayContent);
    const trayTranslationsJson = JSON.stringify(useTw ? {
        'No agents running': '無執行中的代理',
        'Open Antigravity': '開啟 Antigravity',
        'Connect to WSL': '連線至 WSL',
        'Reopen Locally': '在本機重新開啟',
        'Quit': '結束'
    } : {
        'No agents running': '无运行中的智能体',
        'Open Antigravity': '打开 Antigravity',
        'Connect to WSL': '连接到 WSL',
        'Reopen Locally': '在本地重新打开',
        'Quit': '退出'
    });
    const openPrefix = useTw ? '開啟 ' : '打开 ';

    const targetCreate = /function\s+createTray\s*\(([^)]*)\)\s*\{/;
    const replacementCreate = (match, args) => `function createTray(${args}) {
    /* --- TRAY TRANSLATION START --- */
    const translations = ${trayTranslationsJson};
    for (const item of actions) {
        if (!item || !item.label) continue;
        if (translations[item.label]) {
            item.label = translations[item.label];
        } else if (item.label.startsWith('Open ')) {
            item.label = ${JSON.stringify(openPrefix)} + item.label.slice(5);
        }
    }
    /* --- TRAY TRANSLATION END --- */`;

    let trayPatched = trayCleaned.replace(targetCreate, replacementCreate);
    if (trayPatched === trayCleaned) {
        console.warn(`[警告] 未能在 tray.js 中找到 createTray 函数插入点。`);
    }

    const dblClickTarget = /tray\.setContextMenu\(contextMenu\);/;
    const dblClickReplacement = `tray.setContextMenu(contextMenu);
    /* --- TRAY DOUBLE CLICK START --- */
    const openAction = actions.find(item => item && typeof item.click === 'function' && !['Quit', '退出', '結束'].includes(item.label));
    if (openAction) {
        tray.on('double-click', () => {
            const wins = electron_1.BrowserWindow.getAllWindows();
            if (wins.length > 0 && wins[0].isMinimized()) {
                wins[0].restore();
            }
            openAction.click();
        });
    }
    /* --- TRAY DOUBLE CLICK END --- */`;
    trayPatched = trayPatched.replace(dblClickTarget, dblClickReplacement);

    const countRegex = /countItem\.label\s*=\s*\([^;]{0,300}' running';/g;
    const replacementCount = useTw
        ? "countItem.label = count > 0 ? `${count} 個代理執行中` : '無執行中的代理';"
        : "countItem.label = count > 0 ? `${count} 个智能体运行中` : '无运行中的智能体';";
    trayPatched = trayPatched.replace(countRegex, (match) =>
        `/* --- TRAY COUNT START:${Buffer.from(match, 'utf8').toString('base64')} --- */ ${replacementCount} /* --- TRAY COUNT END --- */`
    );

    const targetInsert = /function\s+insertTrayMenuItem\s*\(\s*position\s*,\s*options\s*\)\s*\{/;
    const replacementInsert = `function insertTrayMenuItem(position, options) {
    /* --- TRAY INSERT TRANSLATION START --- */
    const insertTranslations = ${trayTranslationsJson};
    if (options && options.label) {
        if (insertTranslations[options.label]) {
            options = { ...options, label: insertTranslations[options.label] };
        } else if (options.label.startsWith('Open ')) {
            options = { ...options, label: ${JSON.stringify(openPrefix)} + options.label.slice(5) };
        }
    }
    /* --- TRAY INSERT TRANSLATION END --- */`;
    trayPatched = trayPatched.replace(targetInsert, replacementInsert);

    console.log(`[修改] 任务栏菜单汉化注入成功！`);
    return trayPatched;
}

function patchLoadingOverlayJs(loadingContent, useTw) {
    console.log(`[修改] 正在向 loadingOverlay.js 注入加载页汉化...`);
    const replacementText = useTw
        ? '<div class="text">正在載入 Antigravity…</div>'
        : '<div class="text">正在加载 Antigravity…</div>';

    const out = loadingContent
        .replace('<div class="text">Loading Antigravity</div>', replacementText)
        .replace('<div class="text">反重力引擎已啟動，正在努力擺脫地心引力...</div>', replacementText)
        .replace('<div class="text">反重力引擎已启动，正在努力摆脱地心引力...</div>', replacementText);

    console.log(`[修改] 加载页汉化注入成功！`);
    return out;
}

function patchUpdaterJs(updaterContent, useTw) {
    console.log(`[修改] 正在向 updater.js 注入更新弹窗汉化...`);
    const targetOptions = `                title: 'Check for Updates',
                message: 'No updates available',
                buttons: ['OK'],`;
    const replacementOptions = useTw
        ? `                title: '檢查更新',
                message: '目前沒有可用的更新',
                buttons: ['好'],`
        : `                title: '检查更新',
                message: '暂无可用更新',
                buttons: ['确定'],`;

    const out = updaterContent
        .replace(targetOptions, replacementOptions)
        .replace('MenuUpdateStep["CheckForUpdates"] = "Check for Updates";', `MenuUpdateStep["CheckForUpdates"] = ${useTw ? '"檢查更新"' : '"检查更新"'};`)
        .replace('MenuUpdateStep["CheckingForUpdates"] = "Checking for Updates...";', `MenuUpdateStep["CheckingForUpdates"] = ${useTw ? '"正在檢查更新..."' : '"正在检查更新..."'};`)
        .replace('MenuUpdateStep["DownloadingUpdate"] = "Downloading Update...";', `MenuUpdateStep["DownloadingUpdate"] = ${useTw ? '"正在下載更新..."' : '"正在下载更新..."'};`)
        .replace('MenuUpdateStep["RestartToUpdate"] = "Restart to Update";', `MenuUpdateStep["RestartToUpdate"] = ${useTw ? '"重新啟動以更新"' : '"重启以更新"'};`);
    console.log(`[修改] 更新弹窗汉化注入成功！`);
    return out;
}

const MAIN_PROCESS_TEXT_TABLES = {
    'dist/main.js': [
        ["buttons: ['Cancel', 'Quit'],", "buttons: ['取消', '退出'],", "buttons: ['取消', '結束'],"],
        ["title: 'Confirm Quit',", "title: '确认退出',", "title: '確認結束',"],
        ["message: 'Are you sure you want to quit?',", "message: '确定要退出吗？',", "message: '確定要結束嗎？',"],
        ["detail: 'There may be agents or background tasks running.',", "detail: '当前可能有智能体或后台任务正在运行。',", "detail: '目前可能有代理或背景任務正在執行。',"],
        ["label: 'New Window',", "label: '新建窗口',", "label: '開新視窗',"],
        ["showErrorBox('Binary not found', msg)", "showErrorBox('未找到可执行文件', msg)", "showErrorBox('找不到可執行檔', msg)"],
        ["showErrorBox('WSL setup failed', msg)", "showErrorBox('WSL 初始化失败', msg)", "showErrorBox('WSL 設定失敗', msg)"],
        ["showErrorBox('Startup failed', msg)", "showErrorBox('启动失败', msg)", "showErrorBox('啟動失敗', msg)"],
        ["title: 'WSL distro not found',", "title: '未找到 WSL 发行版',", "title: '找不到 WSL 發行版',"],
        ['message: `The WSL distro "${WSL_DISTRO}" is no longer installed.`,', 'message: `WSL 发行版 "${WSL_DISTRO}" 已不再安装。`,', 'message: `WSL 發行版 "${WSL_DISTRO}" 已未安裝。`,'],
        ["detail: 'Antigravity opened on Windows instead.',", "detail: 'Antigravity 已改为在 Windows 上打开。',", "detail: 'Antigravity 已改為在 Windows 上開啟。',"]
    ],
    'dist/ipcHandlers.js': [
        ["showErrorBox('Cannot open folder', t.error)", "showErrorBox('无法打开文件夹', t.error)", "showErrorBox('無法開啟資料夾', t.error)"],
        ["message: 'Folder is on the Windows filesystem',", "message: '文件夹位于 Windows 文件系统中',", "message: '資料夾位於 Windows 檔案系統中',"],
        ["title: 'Open workspace',", "title: '打开工作区',", "title: '開啟工作區',"],
        ["title: 'Open workspaces',", "title: '打开工作区',", "title: '開啟工作區',"],
        ["title: 'Select Download Folder',", "title: '选择下载文件夹',", "title: '選取下載資料夾',"]
    ],
    'dist/remote/remoteManager.js': [
        ["title: 'Choose an SSH config file',", "title: '选择 SSH 配置文件',", "title: '選取 SSH 設定檔',"],
        ["buttons: ['Stop Server', 'Cancel'],", "buttons: ['停止服务', '取消'],", "buttons: ['停止伺服器', '取消'],"],
        ["title: 'Stop SSH server',", "title: '停止 SSH 服务器',", "title: '停止 SSH 伺服器',"],
        ["message: `Stop the Antigravity server on ${entry.label}?`,", "message: `停止 ${entry.label} 上的 Antigravity 服务？`,", "message: `要停止 ${entry.label} 上的 Antigravity 伺服器嗎？`,"],
        ["'Agents running on this host will stop and its window will close. '", "'此主机上运行的智能体将停止，其窗口也将关闭。'", "'此主機上執行的代理將會停止，視窗也會關閉。'"],
        ["'The server starts again the next time you connect.'", "'下次连接时将重新启动服务。'", "'下次連線時會重新啟動伺服器。'"],
        ["message: `Not connected to ${label}`,", "message: `尚未连接到 ${label}`,", "message: `尚未連線至 ${label}`,"],
        ["detail: 'Reconnect first, then stop its server.',", "detail: '请先重新连接，然后再停止其服务。',", "detail: '請先重新連線，再停止其伺服器。',"],
        ["title: 'SSH connection failed',", "title: 'SSH 连接失败',", "title: 'SSH 連線失敗',"],
        ["buttons: ['Sign In', 'Cancel'],", "buttons: ['登录', '取消'],", "buttons: ['登入', '取消'],"],
        ["title: 'Sign in',", "title: '登录',", "title: '登入',"],
        ["message: `Sign in to your organization for ${entry.label}?`,", "message: `是否登录 ${entry.label} 所在的组织？`,", "message: `是否登入 ${entry.label} 的組織？`,"],
        ["'Continue only if you just chose to sign in with your organization '", "'仅当您刚才主动选择通过组织登录时才继续。'", "'僅在您剛才選擇透過組織登入時才繼續。'"],
        ["`in this window. ${entry.label} will get access to your `", "`继续后，${entry.label} 将获得访问权限，可访问您的`", "`繼續後，${entry.label} 將取得權限，可存取您的`"],
        ['"organization\'s Google Cloud account.\\n"', '"所属组织的 Google Cloud 账户。\\n"', '"所屬組織的 Google Cloud 帳戶。\\n"'],
        ["`Workforce pool: ${names[1]}  Provider: ${names[2]}`", "`Workforce 池：${names[1]}  提供方：${names[2]}`", "`Workforce 集區：${names[1]}  提供者：${names[2]}`"],
        ["`Identity provider: ${provider}`", "`身份提供方：${provider}`", "`身分提供者：${provider}`"]
    ],
    'dist/remote/sshPrompts.js': [
        ["const TOUCH_TITLE = 'Touch your security key';", "const TOUCH_TITLE = '请轻触您的安全密钥';", "const TOUCH_TITLE = '請輕觸您的安全金鑰';"],
        ["buttons: confirm ? ['Yes', 'No'] : ['Cancel'],", "buttons: confirm ? ['是', '否'] : ['取消'],", "buttons: confirm ? ['是', '否'] : ['取消'],"],
        [">Asked again: your last answer may not have worked.<", ">再次询问：您上次的回答可能未生效。<", ">再次詢問：您上次的回答可能無效。<"],
        [">That's too long.<", ">输入内容过长。<", ">輸入內容過長。<"],
        ['<button id="cancel" class="secondary">Cancel</button><button id="continue" class="primary">Continue</button>', '<button id="cancel" class="secondary">取消</button><button id="continue" class="primary">继续</button>', '<button id="cancel" class="secondary">取消</button><button id="continue" class="primary">繼續</button>']
    ],
    'dist/deviceChooser.js': [
        ["hid: 'HID device',", "hid: 'HID 设备',", "hid: 'HID 裝置',"],
        ["usb: 'USB device',", "usb: 'USB 设备',", "usb: 'USB 裝置',"],
        ["serial: 'serial port',", "serial: '串口设备',", "serial: '序列埠裝置',"],
        ["'Unknown device'", "'未知设备'", "'未知裝置'"],
        ["title: 'Connect a device',", "title: '连接设备',", "title: '連線裝置',"],
        ["message: `${origin} wants to connect to a ${KIND_NOUNS[kind]}`,", "message: `${origin} 请求连接到 ${KIND_NOUNS[kind]}`,", "message: `${origin} 想要連線至 ${KIND_NOUNS[kind]}`,"],
        ["? 'Select a device:'", "? '请选择设备：'", "? '請選取裝置：'"],
        [": 'No compatible devices found.',", ": '未找到兼容设备。',", ": '找不到相容的裝置。',"],
        ["buttons: [...snapshot.map(({ label }) => label), 'Cancel'],", "buttons: [...snapshot.map(({ label }) => label), '取消'],", "buttons: [...snapshot.map(({ label }) => label), '取消'],"]
    ],
    'dist/webauthn.js': [
        ["details.relyingPartyId || 'this site'", "details.relyingPartyId || '当前站点'", "details.relyingPartyId || '目前網站'"],
        ["title: 'Choose a Passkey',", "title: '选择通行密钥 (Passkey)',", "title: '選擇通行金鑰 (Passkey)',"],
        ["message: `Sign in to ${rpLabel}`,", "message: `登录 ${rpLabel}`,", "message: `登入 ${rpLabel}`,"],
        ["detail: 'Select a passkey account to continue:',", "detail: '请选择一个通行密钥账户以继续：',", "detail: '請選取通行金鑰帳戶以繼續：',"],
        ["buttons: [...accountLabels, 'Cancel'],", "buttons: [...accountLabels, '取消'],", "buttons: [...accountLabels, '取消'],"]
    ],
    'dist/webviewPopupSecurity.js': [
        ["insecure: 'Not secure',", "insecure: '不安全',", "insecure: '不安全',"],
        ["dangerous: '⚠ Not secure',", "dangerous: '⚠ 不安全',", "dangerous: '⚠ 不安全',"],
        ["'Your connection to this site is not secure',", "'您与此网站的连接不安全',", "'您與此網站的連線不安全',"],
        ["'You should not enter any sensitive information on this site (for '", "'请勿在此网站输入任何敏感信息（例如'", "'請勿在此網站輸入任何機密資訊（例如'"],
        ["'example, passwords or credit cards), because it could be stolen by '", "'密码或信用卡信息），因为这些信息可能会被'", "'密碼或信用卡號碼），因為這些資訊可能會遭'"],
        ["'attackers.',", "'攻击者窃取。',", "'攻擊者竊取。',"],
        ["'Connection is secure',", "'连接安全',", "'連線安全',"],
        ["'Your information (for example, passwords or credit card numbers) is '", "'您的信息（例如密码或信用卡号）在发送至此网站时'", "'您的資訊（例如密碼或信用卡號碼）傳送至此網站時'"],
        ["'private when it is sent to this site.',", "'会受到私密保护。',", "'均為私密傳輸。',"],
        ["['Connection security information is not available for this page']", "['无法获取此页面的连接安全信息']", "['無法取得此頁面的連線安全資訊']"],
        [": 'unknown'", ": '未知'", ": '未知'"],
        ["'Certificate is valid' : 'Certificate details'", "'证书有效' : '证书详情'", "'憑證有效' : '憑證詳細資料'"],
        ["`Error: ${state.certificateError}`", "`错误：${state.certificateError}`", "`錯誤：${state.certificateError}`"],
        ["`Issued to: ${certificate.subjectName}`", "`颁发给：${certificate.subjectName}`", "`核發給：${certificate.subjectName}`"],
        ["`Issued by: ${certificate.issuer}`", "`颁发者：${certificate.issuer}`", "`核發者：${certificate.issuer}`"],
        ["`Valid from: ${formatDate(certificate.validFromMs)}`", "`生效时间：${formatDate(certificate.validFromMs)}`", "`有效起始日期：${formatDate(certificate.validFromMs)}`"],
        ["`Valid until: ${formatDate(certificate.validToMs)}`", "`过期时间：${formatDate(certificate.validToMs)}`", "`有效截止日期：${formatDate(certificate.validToMs)}`"],
        ["`Protocol: ${certificate.protocol}`", "`协议：${certificate.protocol}`", "`通訊協定：${certificate.protocol}`"],
        ["(state.url || 'This page')", "(state.url || '当前页面')", "(state.url || '目前頁面')"],
        ["label: 'Connection info…',", "label: '连接信息…',", "label: '連線資訊…',"],
        ["title: 'Connection info',", "title: '连接信息',", "title: '連線資訊',"],
        ["buttons: ['OK'],", "buttons: ['确定'],", "buttons: ['確定'],"]
    ],
    'dist/provisionSplash.js': [
        ["<div>Setting up WSL: ${escapeHtml(distro)}</div>", "<div>正在初始化 WSL：${escapeHtml(distro)}</div>", "<div>正在設定 WSL：${escapeHtml(distro)}</div>"]
    ],
    'dist/ideInstall/wizardHtml.js': [
        ["<title>Welcome to Antigravity</title>", "<title>欢迎使用 Antigravity</title>", "<title>歡迎使用 Antigravity</title>"],
        [">Setting up…</div>", ">正在初始化…</div>", ">正在設定…</div>"],
        ["<h1>Welcome to the new Antigravity!</h1>", "<h1>欢迎使用全新 Antigravity！</h1>", "<h1>歡迎使用全新 Antigravity！</h1>"],
        ["<p>Antigravity has been redesigned to put agents first with new capabilities. If you'd still like a code editor, you can download it as a separate app named <b>Antigravity IDE</b>.</p>", "<p>Antigravity 已全面重构，以智能体为核心并带来全新能力。如果您仍需要代码编辑器，可以将其作为独立应用下载，名称为 <b>Antigravity IDE</b>。</p>", "<p>Antigravity 已全面重新設計，以代理為核心並帶來全新功能。如果您仍需要程式碼編輯器，可以將其作為獨立應用程式下載，名稱為 <b>Antigravity IDE</b>。</p>"],
        ["<span>Download the Antigravity IDE</span>", "<span>下载 Antigravity IDE</span>", "<span>下載 Antigravity IDE</span>"],
        ['<button class="btn-primary" id="btn-skip">Explore the new Antigravity</button>', '<button class="btn-primary" id="btn-skip">开始探索全新 Antigravity</button>', '<button class="btn-primary" id="btn-skip">開始探索全新 Antigravity</button>']
    ],
    'dist/remote/disconnectedPage.js': [
        ["reconnect: 'Reconnect',", "reconnect: '重新连接',", "reconnect: '重新連線',"],
        ["stop: 'Stop Server',", "stop: '停止服务',", "stop: '停止伺服器',"],
        ["close: 'Close',", "close: '关闭',", "close: '關閉',"],
        ["? 'Restarting…'", "? '正在重启…'", "? '正在重新啟動…'"],
        ["? 'Reconnecting…'", "? '正在重新连接…'", "? '正在重新連線…'"],
        [": 'Disconnected';", ": '连接已断开';", ": '連線已中斷';"],
        ["? `Restarting the Antigravity server on ${host}…`", "? `正在重启 ${host} 上的 Antigravity 服务…`", "? `正在重新啟動 ${host} 上的 Antigravity 伺服器…`"],
        ["? `Reconnecting to ${host}…`", "? `正在重新连接到 ${host}…`", "? `正在重新連線至 ${host}…`"],
        [": `Disconnected from ${host}`;", ": `已与 ${host} 断开连接`;", ": `已與 ${host} 中斷連線`;"],
        ["? 'This window opens it again once it has started.'", "? '服务启动后，此窗口会自动重新打开。'", "? '伺服器啟動後，此視窗會自動重新開啟。'"],
        ["? `Its server on ${host} stopped, and its agents with it.`", "? `${host} 上的服务已停止，其上的智能体也随之停止。`", "? `${host} 上的伺服器已停止，其上的代理也隨之停止。`"],
        [": `Agents keep running on ${host}.`", ": `智能体仍在 ${host} 上继续运行。`", ": `代理仍在 ${host} 上繼續執行。`"],
        ["? `Its agents on ${host} stopped with it.`", "? `${host} 上的智能体也随之停止。`", "? `${host} 上的代理也隨之停止。`"],
        [": `Agents keep running on ${host} unless its server stopped.`;", ": `除非服务端已停止，否则智能体仍会在 ${host} 上继续运行。`;", ": `除非伺服器已停止，否則代理仍會在 ${host} 上繼續執行。`;"]
    ],
    'dist/remote/signInCallback.js': [
        ["const SIGNED_IN = page('You have successfully authenticated.', 'You can close this tab and return to Antigravity.');", "const SIGNED_IN = page('身份验证成功', '您可以关闭此标签页并返回 Antigravity。');", "const SIGNED_IN = page('驗證成功', '您可以關閉此分頁並返回 Antigravity。');"],
        ["return page(\"Sign-in didn't finish\", `Antigravity couldn't reach ${host} to finish signing in. ` +\n        'Sign in again from Antigravity.');", "return page('登录未完成', `Antigravity 无法连接到 ${host} 以完成登录。请从 Antigravity 重新发起登录。`);", "return page('登入未完成', `Antigravity 無法連線至 ${host} 以完成登入。請從 Antigravity 重新登入。`);"],
        ["return page(\"Sign-in didn't finish\", 'This sign-in came back from another server than the sign-in page you ' +\n        `agreed to, so Antigravity didn't pass it on to ${host}.`);", "return page('登录未完成', `此登录响应来自与您确认的登录页面不同的服务器，因此 Antigravity 未将其传递给 ${host}。`);", "return page('登入未完成', `此登入回應來自與您確認的登入頁面不同的伺服器，因此 Antigravity 未將其傳遞給 ${host}。`);"],
        ["return page(\"Sign-in didn't finish\", `Antigravity on ${host} couldn't finish signing in (HTTP ${status}). ` +\n        'Sign in again from Antigravity.');", "return page('登录未完成', `${host} 上的 Antigravity 无法完成登录（HTTP ${status}）。请从 Antigravity 重新发起登录。`);", "return page('登入未完成', `${host} 上的 Antigravity 無法完成登入（HTTP ${status}）。請從 Antigravity 重新登入。`);"]
    ],
    'dist/cablev2.js': [
        ["<title>Passkeys</title>", "<title>通行密钥 (Passkeys)</title>", "<title>通行金鑰 (Passkeys)</title>"],
        ['<h1 class="sheet-title">Passkeys</h1>', '<h1 class="sheet-title">通行密钥 (Passkeys)</h1>', '<h1 class="sheet-title">通行金鑰 (Passkeys)</h1>'],
        ['<p class="mechanism-header">Use your phone or tablet</p>', '<p class="mechanism-header">使用手机或平板电脑</p>', '<p class="mechanism-header">使用手機或平板電腦</p>'],
        ['<p id="status" class="mechanism-desc">Scan this QR code with the camera on the device that has your passkey for ${safeRpId}</p>', '<p id="status" class="mechanism-desc">请使用保存有 ${safeRpId} 通行密钥的设备相机扫描此二维码</p>', '<p id="status" class="mechanism-desc">請使用存有 ${safeRpId} 通行金鑰的裝置相機掃描此 QR 碼</p>'],
        ['<button type="button" class="cancel-btn" onclick="window.close()">Cancel</button>', '<button type="button" class="cancel-btn" onclick="window.close()">取消</button>', '<button type="button" class="cancel-btn" onclick="window.close()">取消</button>'],
        ["title: 'Passkeys',", "title: '通行密钥 (Passkeys)',", "title: '通行金鑰 (Passkeys)',"]
    ],
    'dist/remote/sshArgs.js': [
        ["yes: 'SSH authentication failed. Check your password, code or keys, then try again.',", "yes: 'SSH 身份验证失败。请检查您的密码、验证码或密钥后重试。',", "yes: 'SSH 驗證失敗。請檢查您的密碼、驗證碼或金鑰後再試一次。',"],
        ["onReconnect: 'SSH authentication failed. Click Reconnect to sign in again.',", "onReconnect: 'SSH 身份验证失败。请点击“重新连接”再次登录。',", "onReconnect: 'SSH 驗證失敗。請按一下「重新連線」再次登入。',"],
        ['no: "SSH authentication failed. Antigravity can\'t answer password or code prompts on Windows yet: set up key-based login with ssh-agent, then try again.",', 'no: "SSH 身份验证失败。Windows 暂不支持响应密码或验证码提示：请先通过 ssh-agent 配置密钥登录，然后重试。",', 'no: "SSH 驗證失敗。Windows 尚未支援回應密碼或驗證碼提示：請先透過 ssh-agent 設定金鑰登入，然後再試一次。",'],
        ['return "That SSH host isn\'t valid. Enter an alias from your SSH config or a host like user@host or user@host:2222.";', 'return "该 SSH 主机格式无效。请输入 SSH 配置文件中的别名，或使用 user@host、user@host:2222 格式。";', 'return "該 SSH 主機格式無效。請輸入 SSH 設定檔中的別名，或使用 user@host、user@host:2222 格式。";'],
        ['? "The host\'s SSH key is unknown or has changed. Save it with ssh in a terminal. If it changed, ask the host\'s owner first: the connection may be intercepted."', '? "该主机的 SSH 密钥未知或已变更。请先在终端中使用 ssh 保存该密钥。若密钥发生变更，请先向主机所有者确认，连接可能遭到拦截。"', '? "該主機的 SSH 金鑰未知或已變更。請先在終端機中使用 ssh 儲存該金鑰。若金鑰發生變更，請先向主機擁有者確認，連線可能遭到攔截。"'],
        [': "The host\'s SSH key has changed or isn\'t trusted. If it changed, ask the host\'s owner first: the connection may be intercepted.";', ': "该主机的 SSH 密钥已变更或不受信任。若密钥发生变更，请先向主机所有者确认，连接可能遭到拦截。";', ': "該主機的 SSH 金鑰已變更或不受信任。若金鑰發生變更，請先向主機擁有者確認，連線可能遭到攔截。";'],
        ["return `Couldn't connect to the SSH host. Check its name, your network and ssh config (e.g. a ProxyCommand), and that ssh to it works in a terminal${prompts === 'no' ? ' without a prompt' : ''}.`;", "return `无法连接到 SSH 主机。请检查主机名、网络与 ssh 配置（如 ProxyCommand），并确认在终端中可正常通过 ssh 连接${prompts === 'no' ? '（无需交互提示）' : ''}。`;", "return `無法連線至 SSH 主機。請檢查主機名稱、網路與 ssh 設定（例如 ProxyCommand），並確認在終端機中可正常透過 ssh 連線${prompts === 'no' ? '（無需互動提示）' : ''}。`;"],
        ["return 'SSH port forwarding failed. Make sure the server allows TCP forwarding (AllowTcpForwarding) for your account, then try again.';", "return 'SSH 端口转发失败。请确认服务器允许您的账户使用 TCP 转发 (AllowTcpForwarding)，然后重试。';", "return 'SSH 連接埠轉發失敗。請確認伺服器允許您的帳戶使用 TCP 轉發 (AllowTcpForwarding)，然後再試一次。';"],
        ["return `The SSH host isn't supported. ${exports.LINUX_HOST_NEEDED} Windows and macOS hosts aren't supported yet.`;", "return `不支持该 SSH 主机。${exports.LINUX_HOST_NEEDED} 暂不支持 Windows 和 macOS 主机。`;", "return `不支援該 SSH 主機。${exports.LINUX_HOST_NEEDED} 尚未支援 Windows 與 macOS 主機。`;"],
        ["return 'Another host that shares your home directory runs the Antigravity server. Connect to that host, or connect again and choose Take Over.';", "return '另一台共享您主目录的主机正在运行 Antigravity 服务。请连接到该主机，或重新连接并选择“接管”。';", "return '另一台共用您家目錄的主機正在執行 Antigravity 伺服器。請連線至該主機，或重新連線並選擇「接管」。';"],
        ['return "Couldn\'t install the Antigravity server on the SSH host. Make sure it has free disk space, and that it or this computer can download from the internet.";', 'return "无法在 SSH 主机上安装 Antigravity 服务。请确认磁盘空间充足，且远程主机或本机可以访问互联网下载。";', 'return "無法在 SSH 主機上安裝 Antigravity 伺服器。請確認磁碟空間充足，且遠端主機或本機可以存取網際網路下載。";'],
        ["return `The Antigravity server failed to start on the SSH host. See its log in ~/${types_1.REMOTE_INSTALL_ROOT}/data on that host.`;", "return `SSH 主机上的 Antigravity 服务启动失败。请查看该主机 ~/${types_1.REMOTE_INSTALL_ROOT}/data 中的日志。`;", "return `SSH 主機上的 Antigravity 伺服器啟動失敗。請查看該主機 ~/${types_1.REMOTE_INSTALL_ROOT}/data 中的日誌。`;"],
        ["return 'The Antigravity server on the SSH host stopped. Reconnect to start it again.';", "return 'SSH 主机上的 Antigravity 服务已停止。请重新连接以再次启动。';", "return 'SSH 主機上的 Antigravity 伺服器已停止。請重新連線以再次啟動。';"],
        ["return 'The SSH connection closed. Check your network connection, then reconnect.';", "return 'SSH 连接已关闭。请检查网络连接后重新连接。';", "return 'SSH 連線已關閉。請檢查網路連線後重新連線。';"],
        ["return 'The connection was cancelled.';", "return '连接已取消。';", "return '連線已取消。';"],
        ['return "Couldn\'t connect to the SSH host. Try ssh to it in a terminal, and see the Antigravity log for details.";', 'return "无法连接到 SSH 主机。请尝试在终端中使用 ssh 连接，并查看 Antigravity 日志了解详情。";', 'return "無法連線至 SSH 主機。請嘗試在終端機中使用 ssh 連線，並查看 Antigravity 日誌以了解詳細資訊。";']
    ],
    'dist/remote/sshErrorText.js': [
        ["return `Error code: ${err.code}\\nLogs: ${logPath()}`;", "return `错误代码：${err.code}\\n日志：${logPath()}`;", "return `錯誤代碼：${err.code}\\n日誌：${logPath()}`;"],
        ["return err.reportedByRemote ? `${label} reported: ${text}` : text;", "return err.reportedByRemote ? `${label} 报告：${text}` : text;", "return err.reportedByRemote ? `${label} 回報：${text}` : text;"],
        [": 'The connection was closed before it finished.';", ": '连接在完成前已关闭。';", ": '連線在完成前已關閉。';"],
        ["return pointsToLog ? `${text}\\nLogs: ${logPath()}` : text;", "return pointsToLog ? `${text}\\n日志：${logPath()}` : text;", "return pointsToLog ? `${text}\\n日誌：${logPath()}` : text;"]
    ],
    'dist/wsl.js': [
        ['error: `This folder belongs to the WSL distro "${unc[1]}", but this window is connected to "${distro}".`,', 'error: `此文件夹属于 WSL 发行版 "${unc[1]}"，但当前窗口连接的是 "${distro}"。`,', 'error: `此資料夾屬於 WSL 發行版 "${unc[1]}"，但目前視窗連線的是 "${distro}"。`,'],
        ["warning: 'This folder is on the Windows filesystem. Accessing it from WSL (via /mnt) can be slow — for best performance keep projects inside the WSL filesystem.',", "warning: '此文件夹位于 Windows 文件系统中。从 WSL（通过 /mnt）访问可能会较慢——为获得最佳性能，建议将项目保存在 WSL 文件系统内。',", "warning: '此資料夾位於 Windows 檔案系統中。從 WSL（透過 /mnt）存取可能會較慢——為獲得最佳效能，建議將專案儲存在 WSL 檔案系統內。',"],
        ["return { error: `This location cannot be opened in WSL: ${winPath}` };", "return { error: `无法在 WSL 中打开此位置：${winPath}` };", "return { error: `無法在 WSL 中開啟此位置：${winPath}` };"],
        ["onStatus?.('Downloading the Antigravity binary\\u2026');", "onStatus?.('正在下载 Antigravity 二进制文件…');", "onStatus?.('正在下載 Antigravity 二進位檔案…');"],
        ["onStatus?.(`Installing into ${distro}\\u2026`);", "onStatus?.(`正在安装到 ${distro}…`);", "onStatus?.(`正在安裝到 ${distro}…`);"]
    ],
    'dist/computer/hud.js': [
        ["<title>AGY Desktop HUD</title>", "<title>AGY 桌面控制浮窗</title>", "<title>AGY 桌面控制浮窗</title>"],
        ['<button id="stop">Stop</button><button id="resume" title="Let agents use this Mac again. The stopped task does not restart.">Allow again</button>', '<button id="stop">停止</button><button id="resume" title="重新允许智能体使用此 Mac。已停止的任务不会自动重启。">重新允许</button>', '<button id="stop">停止</button><button id="resume" title="重新允許代理使用此 Mac。已停止的任務不會自動重新啟動。">重新允許</button>'],
        ["end.textContent = 'Stopped';", "end.textContent = '已停止';", "end.textContent = '已停止';"],
        ["end.textContent = 'Stop';", "end.textContent = '停止';", "end.textContent = '停止';"],
        ["title: 'AGY Desktop HUD',", "title: 'AGY 桌面控制浮窗',", "title: 'AGY 桌面控制浮窗',"]
    ]
};

const MAIN_PROCESS_PATCH_TARGETS = Object.keys(MAIN_PROCESS_TEXT_TABLES);

function patchMainProcessModule(relPath, content, useTw) {
    const pairs = MAIN_PROCESS_TEXT_TABLES[relPath];
    if (!pairs) return content;
    let out = content;
    let hitCount = 0;
    for (const [needle, sc, tc] of pairs) {
        const replacement = useTw ? tc : sc;
        if (out.includes(needle)) {
            out = out.split(needle).join(replacement);
            hitCount++;
        }
    }
    if (hitCount > 0) {
        console.log(`[修改] 已向 ${relPath} 注入原生弹窗/界面汉化（${hitCount} 处）`);
    }
    return out;
}

module.exports = {
    patchPreloadJs,
    patchUtilsJs,
    patchMenuJs,
    patchTrayJs,
    patchLoadingOverlayJs,
    patchUpdaterJs,
    patchMainProcessModule,
    MAIN_PROCESS_PATCH_TARGETS
};
