// P3 层1 经营答案卡：最终 assistant answer 是回合的第一视觉（运行期间由 AnalysisStatus 占位，
// answer 一到即置顶——边界4）。白卡 + 主色小标头，压过一切过程元素。
import Markdown from "./Markdown";

export default function AnswerCard({ markdown }: { markdown: string }) {
  return (
    <div className="rounded-xl border border-ck-line bg-ck-card px-5 py-4 shadow-ck">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-ck-primary">
        <IconConclusion />
        经营分析结论
      </div>
      <Markdown source={markdown} />
    </div>
  );
}

const IconConclusion = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M2.5 8.5 6 12l7.5-8"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
