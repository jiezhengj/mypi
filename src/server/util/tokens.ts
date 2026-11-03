import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_BYTES = 32;
const PREFIX_CHARS = 8;

/** 生成设备令牌明文：32 字节随机数的 base64url 编码。只在签发时展示一次。 */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** 落盘只存哈希。 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** 前 8 位用于界面辨认，不可用于认证。 */
export function tokenPrefix(token: string): string {
  return token.slice(0, PREFIX_CHARS);
}

/** 定长比较，避免按字符提前返回带来的时序差异。 */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

/** 从 Authorization 头里取出 Bearer 令牌；格式不对返回 null。 */
export function parseBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match || !match[1]) return null;
  const token = match[1].trim();
  return token.length > 0 ? token : null;
}
