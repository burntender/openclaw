#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const exists = async (relativePath) => {
  try {
    await access(path.join(repoRoot, relativePath));
    return true;
  } catch {
    return false;
  }
};

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

const canRun = (command, args = ["--version"]) =>
  spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "ignore",
  }).status === 0;

const isGitWorktree = () => canRun("git", ["rev-parse", "--is-inside-work-tree"]);

const configureGitHooks = () => {
  if (!isGitWorktree()) {
    return false;
  }

  spawnSync("git", ["config", "core.hooksPath", "git-hooks"], {
    cwd: repoRoot,
    stdio: "ignore",
  });

  return true;
};

const resolvePnpmInvocation = () => {
  if (canRun("pnpm")) {
    return { command: "pnpm", prefixArgs: [] };
  }
  if (canRun("corepack")) {
    return { command: "corepack", prefixArgs: ["pnpm"] };
  }
  return null;
};

const shouldBuild = async () => {
  if (process.env.OPENCLAW_SKIP_PREPARE_BUILD === "1") {
    return false;
  }

  const hasSourceEntry = await exists("src/entry.ts");
  if (!hasSourceEntry) {
    return false;
  }

  // Git/GitHub installs should rebuild even if dist exists, because the checked-in
  // bundle may be stale or built with a different environment than the current source.
  if (isGitWorktree()) {
    return true;
  }

  const hasDistEntry = (await exists("dist/entry.js")) || (await exists("dist/entry.mjs"));
  const hasPluginSdkEntry = await exists("dist/plugin-sdk/index.js");
  return !(hasDistEntry && hasPluginSdkEntry);
};

const inGitWorktree = configureGitHooks();

if (await shouldBuild()) {
  const pnpm = resolvePnpmInvocation();
  if (!pnpm) {
    console.error(
      "openclaw prepare: build output is missing, but neither pnpm nor corepack is available.",
    );
    console.error("Install pnpm or enable corepack, then rerun the install.");
    process.exit(1);
  }

  console.log(
    inGitWorktree
      ? "openclaw prepare: git install detected, rebuilding minimal runtime bundle..."
      : "openclaw prepare: dist output missing, running minimal runtime build...",
  );
  run(pnpm.command, [...pnpm.prefixArgs, "canvas:a2ui:bundle"]);
  run(pnpm.command, [...pnpm.prefixArgs, "build:docker"]);
}
