import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';

/** Shared by the DOM reader and the isolated editor/WebView. No network HTML. */
export const markdownRenderer = new MarkdownIt({ html: false, linkify: false, breaks: false }).use(
  taskLists,
  { enabled: false },
);

function nodeSignature(node: ChildNode): string {
  if (node.nodeType !== Node.ELEMENT_NODE) return node.textContent ?? '';
  const element = node as HTMLElement;
  if (element instanceof HTMLImageElement && element.dataset.target)
    return `image:${element.dataset.target}:${element.alt}`;
  if (element.hasAttribute('data-image-target'))
    return `image:${element.dataset.imageTarget}:${element.dataset.alt || ''}`;
  return element.outerHTML;
}

function compatibleNodes(current: ChildNode, next: ChildNode): boolean {
  if (current.nodeType !== next.nodeType) return false;
  if (current.nodeType !== Node.ELEMENT_NODE) return true;
  const left = current as HTMLElement;
  const right = next as HTMLElement;
  if (
    left instanceof HTMLImageElement &&
    left.dataset.target &&
    right.hasAttribute('data-image-target')
  )
    return left.dataset.target === right.dataset.imageTarget;
  if (left.tagName !== right.tagName || left.attributes.length !== right.attributes.length)
    return false;
  return [...left.attributes].every(
    attribute => right.getAttribute(attribute.name) === attribute.value,
  );
}

export function stableMarkdownRange(
  previous: readonly string[],
  next: readonly string[],
): { prefix: number; suffix: number } {
  let prefix = 0;
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix])
    prefix++;
  let suffix = 0;
  while (
    suffix < previous.length - prefix &&
    suffix < next.length - prefix &&
    previous[previous.length - suffix - 1] === next[next.length - suffix - 1]
  )
    suffix++;
  return { prefix, suffix };
}

function patchChildren(current: Node, next: Node): void {
  const previous = [...current.childNodes];
  const incoming = [...next.childNodes];
  const { prefix, suffix } = stableMarkdownRange(
    previous.map(nodeSignature),
    incoming.map(nodeSignature),
  );
  const anchor = suffix ? previous[previous.length - suffix] : null;
  const oldMiddle = previous.slice(prefix, previous.length - suffix);
  const newMiddle = incoming.slice(prefix, incoming.length - suffix);
  const shared = Math.min(oldMiddle.length, newMiddle.length);
  for (let index = 0; index < shared; index++) {
    const oldNode = oldMiddle[index];
    const newNode = newMiddle[index];
    if (compatibleNodes(oldNode, newNode)) {
      if (oldNode.nodeType === Node.TEXT_NODE) oldNode.nodeValue = newNode.nodeValue;
      else if (
        oldNode.nodeType === Node.ELEMENT_NODE &&
        !(
          (oldNode as HTMLElement) instanceof HTMLImageElement &&
          (oldNode as HTMLElement).dataset.target
        )
      )
        patchChildren(oldNode, newNode);
    } else current.replaceChild(newNode, oldNode);
  }
  for (const node of oldMiddle.slice(shared)) current.removeChild(node);
  for (const node of newMiddle.slice(shared)) current.insertBefore(node, anchor);
}

/** Patch Markdown DOM in place so streamed text updates preserve stable blocks. */
export function reconcileMarkdown(root: HTMLElement, html: string): void {
  const template = root.ownerDocument.createElement('template');
  template.innerHTML = html;
  patchChildren(root, template.content);
}

const md = markdownRenderer;
const esc = md.utils.escapeHtml;
md.renderer.rules.table_open = () => '<div class="table-scroll"><table>';
md.renderer.rules.table_close = () => '</table></div>';
md.renderer.rules.image = (tokens, index) => {
  const token = tokens[index];
  return `<span class="image-placeholder" role="img" aria-label="${esc(token.content || '图片')}" data-image-target="${esc(String(token.attrGet('src') || ''))}" data-alt="${esc(token.content || '图片')}">图片 · ${esc(token.content || '未命名图片')}<small>正在读取项目图片…</small></span>`;
};
