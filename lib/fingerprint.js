import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const WATCH_FILE_LIMIT = 200;

function readWatchFingerprint(workspace, watchPaths = []) {
  const paths = uniqueStrings([
    ...readWatchConfigPaths(workspace),
    ...watchPaths,
  ]);
  if (!paths.length) return { ok: true, fingerprint: null };
  return createWorkspaceFingerprint(workspace, paths);
}

function watchConfigPath(workspace) {
  return path.join(workspace, ".acb", "watch");
}

function createWorkspaceFingerprint(workspace, watchPaths) {
  const paths = uniqueStrings(watchPaths);
  const entries = [];
  for (const watchPath of paths) {
    const resolved = path.resolve(workspace, watchPath);
    if (!isPathInside(workspace, resolved)) {
      return { ok: false, error: `--watch path must stay inside workspace: ${watchPath}` };
    }
    const collected = collectFingerprintEntries(workspace, watchPath, resolved);
    if (!collected.ok) return collected;
    entries.push(...collected.entries);
    if (entries.length > WATCH_FILE_LIMIT) {
      return { ok: false, error: `--watch captured more than ${WATCH_FILE_LIMIT} files. Use narrower paths.` };
    }
  }
  return {
    ok: true,
    fingerprint: {
      version: 1,
      algorithm: "sha256",
      created_at: new Date().toISOString(),
      watch_paths: paths,
      file_count: entries.filter((entry) => entry.type === "file").length,
      entries: dedupeFingerprintEntries(entries),
    },
  };
}

function fingerprintSummary(fingerprint) {
  return {
    version: fingerprint.version || 1,
    algorithm: fingerprint.algorithm || "sha256",
    created_at: fingerprint.created_at || null,
    watch_paths: Array.isArray(fingerprint.watch_paths) ? fingerprint.watch_paths : [],
    file_count: Number.isInteger(fingerprint.file_count) ? fingerprint.file_count : 0,
    entries: Array.isArray(fingerprint.entries) ? fingerprint.entries : [],
  };
}

function readWatchConfigPaths(workspace) {
  const filePath = watchConfigPath(workspace);
  if (!fs.existsSync(filePath)) return [];
  try {
    return fs.readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
  } catch {
    return [];
  }
}

function collectFingerprintEntries(workspace, watchPath, resolved) {
  if (!fs.existsSync(resolved)) {
    return {
      ok: true,
      entries: [{ path: normalizeWatchPath(workspace, resolved, watchPath), type: "missing" }],
    };
  }
  let stat;
  try {
    const real = fs.realpathSync.native(resolved);
    if (!isPathInside(workspace, real)) {
      return { ok: false, error: `--watch path resolves outside workspace: ${watchPath}` };
    }
    stat = fs.statSync(real);
    resolved = real;
  } catch (error) {
    return { ok: false, error: `Cannot inspect --watch path ${watchPath}: ${error.message}` };
  }

  if (stat.isFile()) return { ok: true, entries: [fingerprintFile(workspace, resolved, stat)] };
  if (!stat.isDirectory()) {
    return {
      ok: true,
      entries: [{
        path: normalizeWatchPath(workspace, resolved, watchPath),
        type: "other",
        size: stat.size,
        mtime_ms: Math.trunc(stat.mtimeMs),
      }],
    };
  }

  const entries = [];
  for (const filePath of listFingerprintFiles(resolved)) {
    const fileStat = fs.statSync(filePath);
    entries.push(fingerprintFile(workspace, filePath, fileStat));
    if (entries.length > WATCH_FILE_LIMIT) break;
  }
  if (!entries.length) {
    entries.push({
      path: normalizeWatchPath(workspace, resolved, watchPath),
      type: "directory",
      file_count: 0,
    });
  }
  return { ok: true, entries };
}

function listFingerprintFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    const children = fs.readdirSync(current, { withFileTypes: true })
      .filter((entry) => ![".git", "node_modules", ".DS_Store"].includes(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of children) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(child);
      else if (entry.isFile()) files.push(child);
      if (files.length > WATCH_FILE_LIMIT) return files;
    }
  }
  return files.sort();
}

function fingerprintFile(workspace, filePath, stat) {
  return {
    path: normalizeWatchPath(workspace, filePath),
    type: "file",
    size: stat.size,
    mtime_ms: Math.trunc(stat.mtimeMs),
    sha256: crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex"),
  };
}

function normalizeWatchPath(workspace, filePath, fallback = null) {
  const relative = path.relative(workspace, filePath).split(path.sep).join("/");
  if (relative && !relative.startsWith("..")) return relative || ".";
  return String(fallback || filePath).split(path.sep).join("/");
}

function dedupeFingerprintEntries(entries) {
  const seen = new Map();
  for (const entry of entries) seen.set(entry.path, entry);
  return [...seen.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function isPathInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))];
}

export {
  createWorkspaceFingerprint,
  fingerprintSummary,
  readWatchFingerprint,
  watchConfigPath,
};
