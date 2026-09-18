// UI-T3：网关反代客户端 —— Authorization/X-User 的唯一注入点（契约 §1/§2）。
// X-User 只接受调用方传入的会话登录名（req.user），AUTH_TOKEN 只来自进程 env 读入的
// 构造参数——两者绝不接受请求侧自报值（spec §6.1 红线）。
// 网络层失败（连接拒绝/DNS 等）统一抛 GatewayUnreachableError → 调用方回 502 封闭集；
// 上游应用的 4xx（400/401/403/404/429…）原样交给调用方透传。
import { request as httpRequest, type IncomingMessage } from "node:http";

export class GatewayUnreachableError extends Error {}

export interface GatewayResponse {
  status: number;
  headers: IncomingMessage["headers"];
  body: Buffer;
}

export class GatewayClient {
  private base: string;
  private token: string;

  constructor(base: string, token: string) {
    this.base = base.replace(/\/+$/, "");
    this.token = token;
  }

  /** 统一头注入：Bearer + X-User（唯一出口，绝无第二个拼 token 的地方）。 */
  private headersFor(user: string, extra?: Record<string, string>): Record<string, string> {
    return { authorization: `Bearer ${this.token}`, "x-user": user, ...(extra ?? {}) };
  }

  /** JSON 调用（POST /api/tasks、GET /api/tasks/:id）：响应体小，读全量返回。 */
  request(
    method: string,
    path: string,
    opts: { user: string; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<GatewayResponse> {
    return new Promise((resolve, reject) => {
      const payload = opts.body === undefined ? null : Buffer.from(JSON.stringify(opts.body), "utf8");
      const headers = this.headersFor(opts.user, opts.headers);
      if (payload) {
        headers["content-type"] = "application/json";
        headers["content-length"] = String(payload.length);
      }
      const url = new URL(this.base + path);
      const rq = httpRequest(
        { hostname: url.hostname, port: url.port || 80, path: url.pathname + url.search, method, headers },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
          res.on("error", (err) => reject(new GatewayUnreachableError(err.message)));
        },
      );
      rq.on("error", (err) => reject(new GatewayUnreachableError(err.message)));
      if (payload) rq.write(payload);
      rq.end();
    });
  }

  /**
   * SSE 流调用（UI-T4：GET /api/tasks/:id/events）：拿到响应头即 resolve——body 是
   * 无界流，由调用方逐 chunk 管道消费（禁缓冲）。abort() 供客户端断开时销毁上游连接。
   */
  openStream(path: string, opts: { user: string; headers?: Record<string, string> }): Promise<{ response: IncomingMessage; abort: () => void }> {
    return new Promise((resolve, reject) => {
      const url = new URL(this.base + path);
      const rq = httpRequest(
        { hostname: url.hostname, port: url.port || 80, path: url.pathname + url.search, method: "GET", headers: this.headersFor(opts.user, opts.headers) },
        (res) => resolve({ response: res, abort: () => rq.destroy() }),
      );
      rq.on("error", (err) => reject(new GatewayUnreachableError(err.message)));
      rq.end();
    });
  }
}
