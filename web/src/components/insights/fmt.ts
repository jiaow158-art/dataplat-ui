// P1-1 高管阅读金额格式（纯展示，不改 API 原始值）：>=1 亿优先亿（2 位小数），其余万（1 位）
export const fmtWanSmart = (wan: number | null | undefined): string => {
  if (wan == null || !Number.isFinite(wan)) return "—";
  if (Math.abs(wan) >= 10000) return `${(wan / 10000).toFixed(2)} 亿`; // 负值同规则亿化（review nit 2）
  return `${wan.toLocaleString("zh-CN", { maximumFractionDigits: 1 })} 万`;
};
