// 启用仓库内提交钩子：把 core.hooksPath 指向 .githooks。
// 新克隆仓库后运行一次：node scripts/install-git-hooks.mjs

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const hooksDir = join(root, ".githooks");
const hook = join(hooksDir, "pre-commit");

if (!existsSync(hook)) {
  console.error(`缺少钩子文件：${hook}`);
  process.exit(1);
}

try {
  chmodSync(hook, 0o755);
} catch {
  // Windows 上可能无效，Git for Windows 会自行处理可执行位。
}

execFileSync("git", ["config", "core.hooksPath", ".githooks"], { cwd: root, stdio: "inherit" });
console.log("已启用 .githooks/pre-commit（core.hooksPath = .githooks）");
console.log("可用 node scripts/secret-scan.mjs 手动扫描暂存区。");
