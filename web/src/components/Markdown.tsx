// UI-T6：回答正文渲染 —— react-markdown + rehype-sanitize 白名单（红线：引擎输出不可信，
// 红队 file_read 教训——存储型 XSS 必须在渲染面挡住）。默认 schema 已排除 script/事件处理器/
// style 等（GFM 的 table/del 在白名单内，input 复选框被剥除）；长 SQL/路径等由调用方走
// <pre> 文本渲染，绝不 dangerouslySetInnerHTML。
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

export default function Markdown({ source }: { source: string }) {
  return (
    <div className="md-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
