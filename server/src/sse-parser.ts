// UI-T4：SSE 帧解析（仅供记账旁路）——透传本身是字节级的，不经过这里。
// 帧格式（契约 §4）：`id:`/`event:`/`data:` 行 + 空行分帧；": ping" 是注释行（每 15s 心跳，
// 不是事件）。网关固定 \n\n 分帧（与 engine-gateway sseFrame 同源），不做 \r\n 泛化。
export interface SseEvent {
  type: string;
  payload: unknown;
}

export class SseFrameParser {
  private buf = "";

  /** 喂入一个透传 chunk，返回其中完整帧解析出的事件（跨 chunk 断帧留在缓冲）。 */
  feed(chunk: Buffer | string): SseEvent[] {
    this.buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    const out: SseEvent[] = [];
    let idx: number;
    while ((idx = this.buf.indexOf("\n\n")) >= 0) {
      const frame = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 2);
      const ev = parseFrame(frame);
      if (ev) out.push(ev);
    }
    return out;
  }
}

function parseFrame(frame: string): SseEvent | null {
  let type = "";
  let data = "";
  for (const line of frame.split("\n")) {
    if (line.startsWith(":")) return null; // 注释行帧（心跳）：无事件——网关只发纯注释帧
    if (line.startsWith("event:")) type = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!type) return null;
  try {
    return { type, payload: JSON.parse(data || "null") };
  } catch {
    return null; // 非 JSON data 不记账（透传不受影响）
  }
}
