import { MAX_AUDIT_DETAIL } from "../../shared/contracts.ts";

export type MappedEvent =
  | { kind: "delta"; text: string }
  | { kind: "action-start"; id: string; tool: string; inputSummary: string; at: string }
  | { kind: "action-end"; id: string; ok: boolean; outputSummary: string; at: string };

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function clip(text: string, max = MAX_AUDIT_DETAIL): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > max ? `${single.slice(0, max)}…` : single;
}

/** 把工具参数压成一句可读摘要，绝不落完整文件内容。 */
export function summarizeToolInput(tool: string, args: unknown): string {
  const input = asRecord(args);
  switch (tool) {
    case "bash": {
      const command = str(input.command) ?? str(input.cmd) ?? "";
      return clip(command || "(no command)");
    }
    case "read":
    case "write":
    case "edit":
    case "find":
    case "grep": {
      const target = str(input.path) ?? str(input.pattern) ?? str(input.query) ?? "";
      return clip(target || "(no path)");
    }
    default: {
      const json = JSON.stringify(args ?? {});
      return clip(json);
    }
  }
}

/** 结果摘要：退出码 / 行数 / 前若干字符。兼容 pi 的 {content:[{text}]} 与扁平对象两种形状。 */
export function summarizeToolOutput(result: unknown): string {
  const output = asRecord(result);
  const details = asRecord(output.details);
  const contentText = Array.isArray(output.content)
    ? output.content
        .map((block) => asRecord(block))
        .map((block) => str(block.text) ?? "")
        .filter(Boolean)
        .join("\n")
    : "";
  const exitCode = output.exitCode ?? details.exitCode ?? output.exit_code ?? output.code ?? details.code;
  const stdout =
    str(output.stdout) ?? str(output.output) ?? str(output.text) ?? str(output.content) ?? contentText;
  const lines = stdout ? stdout.split("\n").length : 0;
  const parts: string[] = [];
  if (typeof exitCode === "number") parts.push(`exit=${exitCode}`);
  if (lines > 0) parts.push(`lines=${lines}`);
  if (stdout) parts.push(clip(stdout, 80));
  return clip(parts.join(" ") || "(no output)");
}

/** 只认 pi 的 SDK 事件；未知形状返回 null，不猜测。 */
export function mapSessionEvent(event: unknown): MappedEvent | null {
  const outer = asRecord(event);
  const type = str(outer.type);
  if (!type) return null;
  const at = new Date().toISOString();

  if (type === "message_update") {
    const inner = asRecord(outer.assistantMessageEvent);
    if (str(inner.type) === "text_delta") {
      const delta = str(inner.delta);
      if (delta) return { kind: "delta", text: delta };
    }
    return null;
  }

  if (type === "tool_execution_start") {
    const tool = str(outer.toolName) ?? str(outer.name) ?? "tool";
    const id = str(outer.toolCallId) ?? str(outer.id) ?? `t_${Date.now()}`;
    const args = outer.args ?? outer.input ?? outer.arguments ?? {};
    return { kind: "action-start", id, tool, inputSummary: summarizeToolInput(tool, args), at };
  }

  if (type === "tool_execution_end") {
    const id = str(outer.toolCallId) ?? str(outer.id) ?? "";
    const isError = outer.isError === true || outer.error !== undefined;
    const result = outer.result ?? outer.output ?? outer.error ?? {};
    return { kind: "action-end", id, ok: !isError, outputSummary: summarizeToolOutput(result), at };
  }

  return null;
}
