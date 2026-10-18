import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import { validateEditorState, type TextEditorState } from '@/core/documents/state';
import { useWorkbenchTheme } from '@/shared/theme';
import { Button, T } from '@/shared/ui/primitives';
import { documentHtml } from './generated';
import { DocumentSurface } from './surface';
import type { DocumentSurfaceHandle } from './surface.types';
import { externalLink, safeImageData } from './resources';

export interface DocumentEditorHandle {
  flush(): Promise<TextEditorState>;
  save(): Promise<TextEditorState>;
  discard(): Promise<TextEditorState>;
  mode(mode: TextEditorState['mode']): Promise<TextEditorState>;
}
interface HostProps {
  kind?: 'editor' | 'reader';
  state?: TextEditorState;
  content?: string;
  tone?: 'text' | 'secondary';
  language?: 'markdown' | 'plain';
  readonly?: boolean;
  inputLocked?: boolean;
  imageVersion?: string;
  loadImage?(target: string): Promise<string>;
  onChange?(state: TextEditorState): void;
  onSave?(text: string, state: TextEditorState, nextState: TextEditorState): Promise<void>;
  onLink?(url: string): void;
  onModeRequest?(mode: TextEditorState['mode']): void;
}
type Pending = {
  resolve(state: TextEditorState): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
};

export const DocumentHost = forwardRef<DocumentEditorHandle, HostProps>(
  function DocumentHost(props, ref) {
    const theme = useWorkbenchTheme();
    const surface = useRef<DocumentSurfaceHandle>(null);
    const callbacks = useRef(props);
    callbacks.current = props;
    const [epoch, setEpoch] = useState(0);
    const [error, setError] = useState('');
    const [height, setHeight] = useState(26);
    const sequence = useRef(0);
    const pending = useRef(new Map<string, Pending>());
    const channel = useMemo(
      () => `document-${Date.now()}-${Math.random().toString(36).slice(2)}-${epoch}`,
      [epoch],
    );
    const transport = useMemo(() => ({ channel, ready: false, lastEdit: 0 }), [channel]);
    const html = useMemo(
      () =>
        documentHtml.replace(
          '<script>',
          `<script>window.__DOCUMENT_CHANNEL__=${JSON.stringify(channel)};`,
        ),
      [channel],
    );
    const config = {
      kind: props.kind || 'editor',
      content: props.content,
      tone: props.tone,
      language: props.language || 'markdown',
      readonly: !!props.readonly,
      inputLocked: !!props.inputLocked,
      imageVersion: props.imageVersion,
      theme,
    };
    const configRef = useRef(config);
    configRef.current = config;
    const post = (message: object) =>
      surface.current?.post({ channel: transport.channel, ...message });
    const fail = (message: string) => {
      transport.ready = false;
      setError(message);
      for (const request of pending.current.values()) {
        clearTimeout(request.timer);
        request.reject(new Error(message));
      }
      pending.current.clear();
    };
    useEffect(() => {
      if (transport.ready) post({ type: 'configure', config });
      // State is synchronized through commands, never echoed over newer browser input.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      props.readonly,
      props.inputLocked,
      props.content,
      props.tone,
      props.language,
      props.imageVersion,
      theme,
    ]);
    useEffect(
      () => () => {
        for (const request of pending.current.values()) {
          clearTimeout(request.timer);
          request.reject(new Error('编辑器已关闭，操作未完成。'));
        }
        pending.current.clear();
      },
      [],
    );
    useImperativeHandle(ref, () => {
      const command = (command: string, extra?: object) =>
        new Promise<TextEditorState>((resolve, reject) => {
          if (!transport.ready) {
            reject(new Error('编辑器尚未就绪，请稍后重试。'));
            return;
          }
          const requestId = 'host-' + ++sequence.current;
          const timer = setTimeout(() => {
            pending.current.delete(requestId);
            reject(new Error('编辑器响应超时，草稿已保留，请重试。'));
          }, 30000);
          pending.current.set(requestId, { resolve, reject, timer });
          post({ type: 'command', requestId, command, ...extra });
        });
      return {
        flush: () => command('flush'),
        save: () => command('save'),
        discard: () => command('discard'),
        mode: mode => command('mode', { mode }),
      };
    });
    const receive = async (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      const message = value as Record<string, unknown>;
      if (message.channel !== channel) return;
      if (message.type === 'ready') {
        if (transport.ready) return;
        transport.ready = true;
        post({ type: 'init', config: configRef.current, state: callbacks.current.state });
      } else if (
        message.type === 'change' &&
        typeof message.sequence === 'number' &&
        Number.isSafeInteger(message.sequence) &&
        message.sequence > transport.lastEdit
      ) {
        validateEditorState(message.snapshot);
        transport.lastEdit = message.sequence;
        callbacks.current.onChange?.(message.snapshot);
      } else if (message.type === 'result' && typeof message.requestId === 'string') {
        const request = pending.current.get(message.requestId);
        if (!request) return;
        pending.current.delete(message.requestId);
        clearTimeout(request.timer);
        if (typeof message.error === 'string') request.reject(new Error(message.error));
        else {
          validateEditorState(message.snapshot);
          callbacks.current.onChange?.(message.snapshot);
          request.resolve(message.snapshot);
        }
      } else if (message.type === 'save' && typeof message.requestId === 'string') {
        try {
          validateEditorState(message.snapshot);
          validateEditorState(message.nextState);
          if (typeof message.text !== 'string' || !callbacks.current.onSave)
            throw new Error('当前内容不能保存。');
          callbacks.current.onChange?.(message.snapshot);
          await callbacks.current.onSave(message.text, message.snapshot, message.nextState);
          post({ type: 'response', requestId: message.requestId, value: true });
        } catch (error) {
          post({
            type: 'response',
            requestId: message.requestId,
            error: error instanceof Error ? error.message : '保存失败，草稿已保留。',
          });
        }
      } else if (
        message.type === 'mode' &&
        (message.mode === 'blocks' || message.mode === 'full')
      ) {
        callbacks.current.onModeRequest?.(message.mode);
      } else if (message.type === 'image' && typeof message.requestId === 'string') {
        try {
          if (
            typeof message.target !== 'string' ||
            message.target.length > 4096 ||
            !callbacks.current.loadImage
          )
            throw new Error('图片不可用');
          const uri = await callbacks.current.loadImage(message.target);
          if (!safeImageData(uri)) throw new Error('图片不可用');
          post({ type: 'response', requestId: message.requestId, value: uri });
        } catch {
          post({ type: 'response', requestId: message.requestId, error: '图片不可用' });
        }
      } else if (message.type === 'link' && typeof message.url === 'string') {
        if (callbacks.current.onLink) callbacks.current.onLink(message.url);
        else if (externalLink(message.url)) await Linking.openURL(message.url);
      } else if (
        message.type === 'height' &&
        configRef.current.kind === 'reader' &&
        typeof message.height === 'number' &&
        Number.isFinite(message.height)
      ) {
        setHeight(Math.max(1, Math.min(200000, message.height)));
      }
    };
    return (
      <View style={{ flex: props.kind === 'reader' ? undefined : 1, minHeight: 0 }}>
        {error ? (
          <View style={{ padding: 12, gap: 8 }}>
            <T tone="danger">{error}</T>
            <Button
              label="重新加载编辑器"
              onPress={() => {
                transport.ready = false;
                transport.lastEdit = 0;
                setError('');
                setEpoch(value => value + 1);
              }}
            />
          </View>
        ) : (
          <DocumentSurface
            key={channel}
            ref={surface}
            html={html}
            channel={channel}
            height={props.kind === 'reader' ? height : undefined}
            onMessage={message => {
              void receive(message).catch(error =>
                fail(error instanceof Error ? error.message : '编辑器状态无效'),
              );
            }}
            onError={fail}
          />
        )}
      </View>
    );
  },
);
