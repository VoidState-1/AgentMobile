import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';

/** Shared by the DOM reader and the isolated editor/WebView. No network HTML. */
export const markdownRenderer = new MarkdownIt({ html: false, linkify: false, breaks: false }).use(
  taskLists,
  { enabled: false },
);
const md = markdownRenderer;
const esc = md.utils.escapeHtml;
md.renderer.rules.table_open = () => '<div class="table-scroll"><table>';
md.renderer.rules.table_close = () => '</table></div>';
md.renderer.rules.image = (tokens, index) => {
  const token = tokens[index];
  return `<span class="image-placeholder" role="img" aria-label="${esc(token.content || '图片')}" data-image-target="${esc(String(token.attrGet('src') || ''))}" data-alt="${esc(token.content || '图片')}">图片 · ${esc(token.content || '未命名图片')}<small>正在读取项目图片…</small></span>`;
};
