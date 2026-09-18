// dataplat-ui BFF 入口 —— T1 骨架：env + /api/health。
// 完整职责（登录/反代/SSE/报告）按 spec §2 与 T8 契约逐任务补齐。
import express from "express";

const PORT = Number(process.env.PORT ?? 58090);

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[bff] listening on http://127.0.0.1:${PORT}`);
});
