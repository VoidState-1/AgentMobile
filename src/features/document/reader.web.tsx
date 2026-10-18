import { useEffect, useMemo, useRef } from 'react';
import { Linking } from 'react-native';
import { useWorkbenchTheme } from '@/shared/theme';
import { markdownRenderer } from './render';
import { safeImageData, externalLink } from './resources';
import type { MarkdownReaderProps } from './reader';
import './markdown.css';

export function MarkdownReader({
  content,
  tone = 'text',
  loadImage,
  imageVersion,
}: MarkdownReaderProps) {
  const theme = useWorkbenchTheme();
  const node = useRef<HTMLDivElement>(null);
  const html = useMemo(() => markdownRenderer.render(content), [content]);
  useEffect(() => {
    const root = node.current;
    if (!root) return;
    let current = true;
    root.innerHTML = html;
    for (const placeholder of root.querySelectorAll<HTMLElement>('[data-image-target]')) {
      const target = placeholder.dataset.imageTarget!;
      void (loadImage ? loadImage(target) : Promise.reject(new Error('图片不可用')))
        .then(uri => {
          if (!current || !placeholder.isConnected) return;
          if (!safeImageData(uri)) throw new Error('图片不可用');
          const image = document.createElement('img');
          image.alt = placeholder.dataset.alt || '图片';
          image.src = uri;
          image.onerror = () => {
            image.replaceWith(placeholder);
            placeholder.querySelector('small')!.textContent = '图片不可用';
          };
          placeholder.replaceWith(image);
        })
        .catch(() => {
          if (current) placeholder.querySelector('small')!.textContent = '图片不可用';
        });
    }
    return () => {
      current = false;
    };
  }, [html, loadImage, imageVersion]);
  const variables: Record<string, string> = {};
  for (const [key, value] of Object.entries(theme))
    if (typeof value === 'string')
      variables['--' + key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase())] = value;
  return (
    <div
      ref={node}
      className="markdown"
      style={{ ...variables, color: theme[tone], width: '100%', fontSize: 14, lineHeight: '25px' }}
      onClick={event => {
        const link = (event.target as HTMLElement).closest('a');
        if (link) {
          event.preventDefault();
          if (externalLink(link.href)) void Linking.openURL(link.href);
        }
      }}
    />
  );
}
