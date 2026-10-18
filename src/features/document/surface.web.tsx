import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { DocumentSurfaceHandle, DocumentSurfaceProps } from './surface.types';

export const DocumentSurface = forwardRef<DocumentSurfaceHandle, DocumentSurfaceProps>(
  function DocumentSurface(props, ref) {
    const frame = useRef<HTMLIFrameElement>(null);
    const handlers = useRef(props);
    handlers.current = props;
    useImperativeHandle(
      ref,
      () => ({
        post(message) {
          frame.current?.contentWindow?.postMessage(message, '*');
        },
      }),
      [],
    );
    useEffect(() => {
      const receive = (event: MessageEvent) => {
        if (event.source === frame.current?.contentWindow) handlers.current.onMessage(event.data);
      };
      window.addEventListener('message', receive);
      return () => window.removeEventListener('message', receive);
    }, []);
    return (
      <iframe
        ref={frame}
        title="文件内容"
        data-testid="document-surface"
        sandbox="allow-scripts"
        srcDoc={props.html}
        onLoad={() =>
          frame.current?.contentWindow?.postMessage({ channel: props.channel, type: 'ping' }, '*')
        }
        onError={() => props.onError('编辑器加载失败，请重试。')}
        style={{
          width: '100%',
          height: props.height ?? '100%',
          flex: props.height === undefined ? 1 : undefined,
          minHeight: 0,
          border: 0,
          display: 'block',
        }}
      />
    );
  },
);
