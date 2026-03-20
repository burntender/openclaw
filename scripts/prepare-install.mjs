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

const configureGitHooks = () => {
  if (!canRun("git", ["rev-parse", "--is-inside-work-tree"])) {
    return;
  }

  spawnSync("git", ["config", "core.hooksPath", "git-hooks"], {
    cwd: repoRoot,
    stdio: "ignore",
  });
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

  const hasDistEntry = (await exists("dist/entry.js")) || (await exists("dist/entry.mjs"));
  const hasPluginSdkEntry = await exists("dist/plugin-sdk/index.js");
  return !(hasDistEntry && hasPluginSdkEntry);
};

configureGitHooks();

if (await shouldBuild()) {
  const pnpm = resolvePnpmInvocation();
  if (!pnpm) {
    console.error(
      "openclaw prepare: build output is missing, but neither pnpm nor corepack is available.",
    );
    console.error("Install pnpm or enable corepack, then rerun the install.");
    process.exit(1);
  }

  console.log("openclaw prepare: dist output missing, running build steps...");
  run(pnpm.command, [...pnpm.prefixArgs, "build"]);
  run(pnpm.command, [...pnpm.prefixArgs, "ui:build"]);
}
