import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vite-plus/test";

const hook = ".agents/hooks/block-hook-bypass.py";

function verdict(command: string): "blocked" | "allowed" | "crashed" {
  const { status } = spawnSync(hook, {
    input: JSON.stringify({ tool_input: { command } }),
    encoding: "utf8",
  });
  if (status === 2) return "blocked";
  if (status === 0) return "allowed";
  return "crashed";
}

describe("block-hook-bypass.py", () => {
  it.each([
    "git commit --no-verify -m fix",
    "git commit -n -m fix",
    "git commit -nm fix",
    "git commit -anm fix",
    "git -C /tmp/repo commit -m fix -n",
    "pnpm check && git commit --no-verify -F msg.txt",
    "git merge --no-verify feat/x",
    "git push --no-verify origin feat/x",
    "git -c core.hooksPath=/dev/null commit -m fix",
    "git config core.hooksPath /dev/null",
    "git config --local core.hooksPath .nohooks",
    "HUSKY=0 git commit -m fix",
    "VP_GIT_HOOKS=0 git commit -m fix",
    "export VITE_GIT_HOOKS=0",
    "git add . \ngit commit -n -m fix",
    "env git commit --no-verify -m fix",
    "env -i PATH=/usr/bin git commit -n -m fix",
    "GIT_AUTHOR_DATE=now git commit --no-verify -m fix",
    "sudo -u dev git commit -n -m fix",
    "/usr/bin/git commit --no-verify -m fix",
    "git -c core.hooksPath /dev/null commit -m fix",
    'GIT_AUTHOR_NAME="First Last" git commit --no-verify -m fix',
    "export HUSKY=0",
    "(cd /tmp/repo && git commit -n -m fix)",
  ])("refuses %s", (command) => {
    expect(verdict(command)).toBe("blocked");
  });

  it.each([
    "git commit -m fix",
    "git commit -am fix",
    "git commit -uno -m fix",
    "git commit -F msg.txt",
    "git log -n 3",
    "git status -n",
    "git push -n origin feat/x",
    "git merge -n feat/x",
    "echo --no-verify",
    "grep -rn no-verify docs",
    "HUSKY=1 git commit -m fix",
    "git commit -m fix # not --no-verify",
    "git status notes/core.hooksPath.md",
    "HUSKY=01 git status",
    "legit commit -n",
    "env echo git --no-verify",
    'HUSKY="0 for debugging" git status',
    'HUSKY="0"1 git status',
    'git commit -m "explain why --no-verify is refused"',
    "git log --grep commit -n 3",
  ])("allows %s", (command) => {
    expect(verdict(command)).toBe("allowed");
  });
});
