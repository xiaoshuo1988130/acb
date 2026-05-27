import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const STORE_VERSION = 1;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function jsonRpcLine(method, params, id) {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

function parseJsonRpcLines(stdout) {
  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function formatCommand(command, args) {
  return [command, ...args].map((part) => (/\s/.test(part) ? JSON.stringify(part) : part)).join(" ");
}

function readStore() {
  const filePath = storePath();
  if (!fs.existsSync(filePath)) return { ok: true, store: { version: STORE_VERSION, packets: [] } };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: `ACB store is not a JSON object: ${filePath}` };
    }
    if (!Array.isArray(parsed.packets)) {
      return { ok: false, error: `ACB store does not contain a packets array: ${filePath}` };
    }
    return { ok: true, store: { version: parsed.version || STORE_VERSION, packets: parsed.packets } };
  } catch (error) {
    return { ok: false, error: `Cannot read ACB store ${filePath}: ${error.message}` };
  }
}

function storeError(message) {
  const error = new Error(message);
  error.code = "ACB_STORE_ERROR";
  return error;
}

function writeStore(store) {
  const filePath = storePath();
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(filePath)) {
    fs.copyFileSync(filePath, `${filePath}.bak`);
  }
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  let fd = null;
  try {
    fd = fs.openSync(tmpPath, "w");
    fs.writeFileSync(fd, `${JSON.stringify(store, null, 2)}\n`);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    if (fd !== null) fs.closeSync(fd);
    try {
      if (fs.existsSync(tmpPath)) fs.rmSync(tmpPath);
    } catch {
      // Best effort cleanup only; preserve the original store if cleanup fails.
    }
    throw error;
  }
}

function storePath() {
  if (process.env.ACB_STORE) return path.resolve(process.env.ACB_STORE);
  return path.join(os.homedir(), ".acb", "packets.json");
}

function normalizeWorkspace(workspace) {
  const resolved = path.resolve(workspace || process.cwd());
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function copyToClipboard(text) {
  const errors = [];
  for (const [cmd, args] of clipboardCandidates()) {
    const result = spawnSync(cmd, args, { input: text, encoding: "utf8" });
    if (result.status === 0) return { ok: true };
    errors.push(result.error?.message || result.stderr || `${cmd} exited ${result.status}`);
  }
  return { ok: false, error: errors.join("; ") || "no clipboard command available" };
}

function clipboardCandidates() {
  const platform = process.platform;
  if (platform === "darwin") return [["pbcopy", []]];
  if (platform === "win32") return [["clip.exe", []]];
  return [["wl-copy", []], ["xclip", ["-selection", "clipboard"]], ["xsel", ["--clipboard", "--input"]]];
}

function openFile(filePath) {
  const platform = process.platform;
  const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd.exe" : "xdg-open";
  const args = platform === "darwin"
    ? [filePath]
    : platform === "win32"
      ? ["/c", "start", "", filePath]
      : [filePath];
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status === 0) return { ok: true };
  return { ok: false, error: result.error?.message || result.stderr || `${command} exited ${result.status}` };
}

function commandExists(command) {
  const paths = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const extensions = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const dir of paths) {
    for (const ext of extensions) {
      try {
        fs.accessSync(path.join(dir, `${command}${ext}`), fs.constants.X_OK);
        return true;
      } catch {
        // Try the next PATH candidate.
      }
    }
  }
  return false;
}

export {
  STORE_VERSION,
  clipboardCandidates,
  commandExists,
  copyToClipboard,
  escapeHtml,
  formatCommand,
  jsonRpcLine,
  normalizeWorkspace,
  openFile,
  parseJsonRpcLines,
  readStore,
  storeError,
  storePath,
  writeStore,
};
