// 提交前扫描：阻止私密/测试信息进入公开仓库。
// 用法：
//   node scripts/secret-scan.mjs            扫描暂存区（pre-commit 钩子调用）
//   node scripts/secret-scan.mjs --all      扫描所有已跟踪文件
//   node scripts/secret-scan.mjs --range HEAD~1..HEAD
//
// 规则分两类：
//   1. 内置通用规则（密钥前缀、私网地址、域名、主机路径等），对所有项目通用。
//   2. 本地私密值：.git/info/private-patterns.txt（不进版本库，一行一个正则或字面量）。
// 某一行确实需要放行时，在该行加注释标记 secret-scan: allow。

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const GIT = "git";

const RULES = [
  { name: "API key (sk-...)", re: /\bsk-[A-Za-z0-9_-]{16,}/g },
  { name: "Tailscale auth key", re: /\btskey-[a-z]+-[A-Za-z0-9]{10,}/g },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}/g },
  { name: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "private key block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: "JWT", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./g },
  { name: "private IPv4", re: /\b(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b(?!\/)/g },
  { name: "tailnet host", re: /\b[a-z0-9-]+\.ts\.net\b/gi },
  { name: "NAS volume path", re: /\/volume\d+\//g },
  { name: "Windows user path", re: /[A-Za-z]:\\\\?Users\\\\?[A-Za-z0-9._-]+/g },
  { name: "docker bridge gateway", re: /\b172\.17\.0\.1\b/g },
];

function git(args, options = {}) {
  return execFileSync(GIT, args, { encoding: options.encoding ?? "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
}

function repoRoot() {
  return git(["rev-parse", "--show-toplevel"]).trim();
}

function gitDir() {
  return git(["rev-parse", "--absolute-git-dir"]).trim();
}

function loadLocalPatterns() {
  const file = join(gitDir(), "info", "private-patterns.txt");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      try {
        return { name: `local pattern (${line.slice(0, 24)})`, re: new RegExp(line, "g") };
      } catch {
        return { name: `local literal (${line.slice(0, 24)})`, re: new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g") };
      }
    });
}

function stagedFiles() {
  return git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]).split(/\r?\n/).filter(Boolean);
}

function trackedFiles() {
  return git(["ls-files"]).split(/\r?\n/).filter(Boolean);
}

function rangeFiles(range) {
  return git(["diff", "--name-only", "--diff-filter=ACMR", range]).split(/\r?\n/).filter(Boolean);
}

function readStaged(file) {
  return git(["show", `:${file}`]);
}

function readWorking(file) {
  try {
    return readFileSync(join(repoRoot(), file), "utf8");
  } catch {
    return "";
  }
}

const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|mp4|mp3|woff2?|ttf|otf|exe|dll|so|dylib)$/i;

// 文档里常见的占位/示例地址，不算私密信息。
const IGNORED_MATCHES = new Set(["10.0.0.0", "192.168.0.0", "172.16.0.0", "0.0.0.0"]);

// 官方 CLI 与 Agent 集成托管、不由本项目编写的文件：内容含大量文档示例地址，且我们不会往里写私密值。
const VENDOR_PATHS = [/^\.agents\/skills\//, /^\.specify\/(templates|scripts|extensions|workflows|integrations)\//];

function scan(files, read, rules) {
  const findings = [];
  for (const file of files) {
    if (BINARY_EXT.test(file)) continue;
    if (VENDOR_PATHS.some((pattern) => pattern.test(file.replace(/\\/g, "/")))) continue;
    let text;
    try {
      text = read(file);
    } catch {
      continue;
    }
    if (!text || text.includes("\u0000")) continue;
    if (text.length > 2_000_000) continue;
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (line.includes("secret-scan: allow")) return;
      for (const rule of rules) {
        rule.re.lastIndex = 0;
        const match = rule.re.exec(line);
        if (match && !IGNORED_MATCHES.has(match[0])) {
          findings.push({ file, line: index + 1, rule: rule.name, sample: match[0].slice(0, 60) });
          break;
        }
      }
    });
  }
  return findings;
}

function main() {
  const mode = process.argv[2] ?? "--staged";
  const rules = [...RULES, ...loadLocalPatterns()];

  let files;
  let reader;
  if (mode === "--all") {
    files = trackedFiles();
    reader = readWorking;
  } else if (mode === "--range") {
    const range = process.argv[3];
    if (!range) {
      console.error("用法：node scripts/secret-scan.mjs --range <git-range>");
      process.exit(2);
    }
    files = rangeFiles(range);
    reader = readWorking;
  } else {
    files = stagedFiles();
    reader = readStaged;
  }

  if (files.length === 0) {
    console.log("secret-scan: 没有需要扫描的文件");
    return;
  }

  const findings = scan(files, reader, rules);
  if (findings.length === 0) {
    console.log(`secret-scan: 通过（${files.length} 个文件）`);
    return;
  }

  console.error("secret-scan: 发现疑似私密信息，提交已阻止");
  console.error("");
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.line}  [${finding.rule}]  ${finding.sample}`);
  }
  console.error("");
  console.error("处理方式：改成占位符（如 <LAN_IP>、<TAILNET_HOST>、<REDACTED_KEY>），");
  console.error("或把该取值写入 .git/info/private-patterns.txt 便于本地继续拦截。");
  console.error("确认是误报时，在该行加注释标记 secret-scan: allow。");
  process.exit(1);
}

main();
