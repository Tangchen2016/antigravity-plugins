const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REV_FILES = [
    'src/preload_runtime.js',
    'src/main_patches.js',
    'src/asar_patcher.js'
];

function computeRuntimeRev(runtimeDir) {
    const hash = crypto.createHash('sha256');
    for (const rel of REV_FILES) {
        const full = path.join(runtimeDir, rel);
        hash.update(rel);
        hash.update('\0');
        if (fs.existsSync(full)) {
            hash.update(fs.readFileSync(full));
        }
        hash.update('\0');
    }
    return hash.digest('hex').slice(0, 12);
}

function formatRuntimeRevMarker(rev) {
    return `/* AGY_RUNTIME_REV:${rev} */`;
}

function extractRuntimeRev(preloadContent) {
    if (!preloadContent || typeof preloadContent !== 'string') return null;
    const m = preloadContent.match(/\/\*\s*AGY_RUNTIME_REV:([a-f0-9]{8,64})\s*\*\//i);
    return m ? m[1].toLowerCase() : null;
}

module.exports = {
    computeRuntimeRev,
    formatRuntimeRevMarker,
    extractRuntimeRev
};
