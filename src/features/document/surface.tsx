import { forwardRef, useImperativeHandle, useRef } from 'react';
import { WebView } from 'react-native-webview';
import type { DocumentSurfaceHandle, DocumentSurfaceProps } from './surface.types';

export const DocumentSurface = forwardRef<DocumentSurfaceHandle, DocumentSurfaceProps>(
  function DocumentSurface(props, ref) {
    const webview = useRef<WebView>(null);
    useImperativeHandle(
      ref,
      () => ({
        post(message) {
          webview.current?.injectJavaScript(
            `window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(JSON.stringify(message))}}));true;`,
          );
        },
      }),
      [],
    );
    return (
      <WebView
        ref={webview}
        source={{ html: props.html, baseUrl: 'https://editor.agentmobile.invalid/' }}
        style={
          props.height === undefined
            ? { flex: 1, backgroundColor: 'transparent' }
            : { height: props.height, backgroundColor: 'transparent' }
        }
        originWhitelist={['about:blank', 'https://editor.agentmobile.invalid']}
        onShouldStartLoadWithRequest={request =>
          request.url === 'about:blank' || request.url === 'https://editor.agentmobile.invalid/'
        }
        onMessage={event => {
          try {
            props.onMessage(JSON.parse(event.nativeEvent.data));
          } catch {
            props.onError('编辑器消息无效，文件尚未修改。');
          }
        }}
        onError={() => props.onError('编辑器加载失败，请重试。')}
        onContentProcessDidTerminate={() => props.onError('编辑器进程已停止，草稿已保留，请重试。')}
        onRenderProcessGone={() => props.onError('编辑器进程已停止，草稿已保留，请重试。')}
        javaScriptEnabled
        webviewDebuggingEnabled={__DEV__}
        domStorageEnabled={false}
        allowFileAccess={false}
        allowUniversalAccessFromFileURLs={false}
        mixedContentMode="never"
        javaScriptCanOpenWindowsAutomatically={false}
        setSupportMultipleWindows={false}
        scrollEnabled={props.height === undefined}
        nestedScrollEnabled={props.height === undefined}
        keyboardDisplayRequiresUserAction={false}
        hideKeyboardAccessoryView
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
      />
    );
  },
);
