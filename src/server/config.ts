import fs from "node:fs";
import path from "node:path";

export interface Config {
  port: number;
  dataDir: string;
  workDir: string;
  piHome: string;
  sessionDir: string;
  dbPath: string;
  staticDir: string;
  provider: string;
  modelId: string;
  baseUrl: string;
  apiKey: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`缺少必需的环境变量：${name}`);
  }
  return value.trim();
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

export function loadConfig(): Config {
  const dataDir = optional("DATA_DIR", "/data");
  const workDir = optional("WORK_DIR", "/workspace");
  const piHome = optional("PI_HOME", path.join(dataDir, "pi"));

  return {
    port: Number(optional("PORT", "8080")),
    dataDir,
    workDir,
    piHome,
    sessionDir: optional("SESSION_DIR", path.join(dataDir, "sessions")),
    dbPath: optional("DB_PATH", path.join(dataDir, "mypi.db")),
    staticDir: optional("STATIC_DIR", path.resolve(import.meta.dirname, "../client")),
    provider: optional("PI_PROVIDER", "magpie"),
    modelId: required("PI_MODEL"),
    baseUrl: required("PI_BASE_URL"),
    apiKey: required("PI_API_KEY"),
  };
}

export function ensureDirectories(config: Config): void {
  for (const dir of [config.dataDir, config.workDir, config.piHome, config.sessionDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * 把网关配置写成 pi 的 models.json。密钥只以 `${PI_API_KEY}` 引用形式落盘，
 * 真正的值始终留在进程环境变量里。
 */
export function writeModelsJson(config: Config): string {
  const file = path.join(config.piHome, "models.json");
  const content = {
    providers: {
      [config.provider]: {
        baseUrl: config.baseUrl,
        api: "openai-completions",
        apiKey: "${PI_API_KEY}",
        models: [{ id: config.modelId }],
      },
    },
  };
  fs.writeFileSync(file, `${JSON.stringify(content, null, 2)}\n`, { mode: 0o600 });
  return file;
}
