import { spawnSync } from "node:child_process";

function readGitSnapshot(workspace) {
  const rootResult = runGit(workspace, ["rev-parse", "--show-toplevel"]);
  if (rootResult.status !== 0) {
    return { ok: false, error: `--git requires a Git workspace: ${workspace}` };
  }

  const root = rootResult.stdout.trim();
  const branch = runGit(root, ["branch", "--show-current"]).stdout.trim();
  const head = runGit(root, ["rev-parse", "--short", "HEAD"]).stdout.trim();
  const status = runGit(root, ["status", "--short"]).stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);

  return {
    ok: true,
    snapshot: {
      root,
      branch: branch || null,
      head: head || null,
      status,
    },
  };
}

function runGit(workspace, args) {
  return spawnSync("git", ["-C", workspace, ...args], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
}

export {
  readGitSnapshot,
  runGit,
};
