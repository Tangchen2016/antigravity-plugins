import { randomUUID } from 'node:crypto';
import {
  accessSync,
  constants,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const locales = ['zh-CN', 'zh-TW'];
// The hot loader reads dictionaries alphabetically. Its format is a flat map of strings.
const activeFile = 'zzzz.antigravity-language-packs.json';
const localeKey = '@antigravity-language-packs/locale';

export class PackError extends Error {}

function dictionaryFrom(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new PackError('词库必须是以原文为键、译文为值的 JSON 对象。');
  }

  const dictionary = Object.create(null);
  for (const [key, value] of Object.entries(input)) {
    const original = key.replace(/\s+/g, ' ').trim()
      .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...');
    if (!original || original === localeKey || typeof value !== 'string') {
      throw new PackError('请检查词库。原文不能为空，所有译文都必须是字符串。');
    }
    dictionary[original] = value;
  }
  if (!Object.keys(dictionary).length) throw new PackError('词库至少需要一条翻译。');
  return dictionary;
}

function readFile(path) {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile()) throw new PackError('词库路径已被其他文件占用。');
    return { data: JSON.parse(readFileSync(path, 'utf8')), mtime: stat.mtime };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) throw new PackError('词库文件不是有效的 JSON。');
    throw error;
  }
}

function writeFile(path, data) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    renameSync(temporary, path);
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* preserve the original error */ }
    throw error;
  }
}

export function createPackManager({ directory, dataDirectory, bundledDirectory }) {
  const overlay = join(directory, activeFile);

  function directoryProblem() {
    try {
      mkdirSync(directory, { recursive: true });
      if (!statSync(directory).isDirectory()) return '词库监听路径已被非目录文件占用。';
      accessSync(directory, constants.R_OK | constants.W_OK);
      return null;
    } catch {
      return '无法访问词库监听目录，请检查目录权限。';
    }
  }

  function requireDirectory() {
    const problem = directoryProblem();
    if (problem) throw new PackError(problem);
  }

  function readActive() {
    const file = readFile(overlay);
    if (!file) return null;
    const { [localeKey]: locale, ...dictionary } = file.data || {};
    if (!locales.includes(locale)) {
      throw new PackError('热更新目录里的语言包文件不属于此扩展，请检查后重试。');
    }
    return { locale, dictionary: dictionaryFrom(dictionary) };
  }

  function readPack(locale) {
    if (!locales.includes(locale)) throw new PackError('请选择简体中文或繁體中文。');
    const imported = readFile(join(dataDirectory, `${locale}.json`));
    const file = imported || readFile(join(bundledDirectory, `${locale}.json`));
    if (!file) throw new PackError('扩展缺少随附词库，请重新安装语言包扩展。');
    return { dictionary: dictionaryFrom(file.data), source: imported ? 'imported' : 'bundled', updatedAt: imported?.mtime.toISOString() ?? null };
  }

  function state() {
    let problem = directoryProblem();
    let active = null;
    if (!problem) {
      try { active = readActive(); }
      catch (error) {
        if (!(error instanceof PackError)) throw error;
        problem = error.message;
      }
    }

    return {
      activeLocale: active?.locale ?? null,
      ready: !problem,
      message: problem ?? undefined,
      packs: locales.map((locale) => {
        const { dictionary, source, updatedAt } = readPack(locale);
        return {
          locale,
          entries: Object.keys(dictionary).length,
          source,
          updatedAt,
          needsApply: active?.locale === locale && JSON.stringify(active.dictionary) !== JSON.stringify(dictionary),
        };
      }),
    };
  }

  return {
    state,

    activate(locale) {
      requireDirectory();
      readActive();
      const { dictionary } = readPack(locale);
      writeFile(overlay, { ...dictionary, [localeKey]: locale });
      return state();
    },

    deactivate() {
      requireDirectory();
      if (readActive()) unlinkSync(overlay);
      return state();
    },

    update(locale, input) {
      requireDirectory();
      if (!locales.includes(locale)) throw new PackError('请选择简体中文或繁體中文。');
      const dictionary = dictionaryFrom(input);
      const active = readActive();
      mkdirSync(dataDirectory, { recursive: true });
      const destination = join(dataDirectory, `${locale}.json`);
      writeFile(destination, dictionary);
      if (active?.locale === locale) {
        try {
          writeFile(overlay, { ...dictionary, [localeKey]: locale });
        } catch {
          throw new PackError('新版词库已保存，应用失败。请重新应用语言包。');
        }
      }
      return state();
    },

    reset(locale) {
      requireDirectory();
      const active = readActive();
      if (locale) {
        if (!locales.includes(locale)) throw new PackError('请选择简体中文或繁體中文。');
        const imported = join(dataDirectory, `${locale}.json`);
        if (readFile(imported)) unlinkSync(imported);
        if (active?.locale === locale) {
          const { dictionary } = readPack(locale);
          writeFile(overlay, { ...dictionary, [localeKey]: locale });
        }
        return state();
      }
      if (active) unlinkSync(overlay);
      for (const item of locales) {
        const imported = join(dataDirectory, `${item}.json`);
        if (readFile(imported)) unlinkSync(imported);
      }
      return state();
    },
  };
}
