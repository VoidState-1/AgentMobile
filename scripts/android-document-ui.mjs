import { adb, dump, nodes, sleep } from './android-ui.mjs';

/** Read DOM geometry over debug-only WebView CDP, then send real Android touch input. */
export async function documentEvaluate(expression) {
  const pid = (await adb('shell', 'pidof', 'com.agentmobile.app')).trim().split(' ')[0];
  const port = (
    await adb('forward', 'tcp:0', 'localabstract:webview_devtools_remote_' + pid)
  ).trim();
  let socket;
  try {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    if (!targets.length) throw new Error('文件 WebView 尚未就绪');
    socket = new WebSocket(targets[0].webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WebView CDP 响应超时')), 10000);
      socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (message.id !== 1) return;
        clearTimeout(timer);
        if (message.result?.exceptionDetails || message.error)
          reject(new Error(JSON.stringify(message)));
        else resolve(message.result.result.value);
      });
    });
    socket.send(
      JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true },
      }),
    );
    return await result;
  } finally {
    socket?.close();
    await adb('forward', '--remove', 'tcp:' + port);
  }
}
export async function tapDocument(label) {
  let result;
  const deadline = Date.now() + 15000;
  while (!result && Date.now() < deadline) {
    result = await documentEvaluate(
      `(() => { if(document.body.dataset.kind!=='editor')return null; const element = [...document.querySelectorAll('button,[aria-label]')].find(element => element.getAttribute('aria-label') === ${JSON.stringify(label)} || element.textContent.trim() === ${JSON.stringify(label)}); if (!element) return null; const rect=element.getBoundingClientRect(); return {x:(rect.left+rect.right)/2,y:(rect.top+rect.bottom)/2,width:innerWidth}; })()`,
    ).catch(() => undefined);
    if (!result) await sleep(200);
  }
  if (!result) throw new Error('文件控件不存在：' + label);
  const native = nodes(await dump()).find(node => node.class === 'android.webkit.WebView');
  if (!native) throw new Error('原生 WebView 不存在');
  const [left, top, right] = [...native.bounds.matchAll(/\d+/g)].map(match => Number(match[0]));
  const scale = (right - left) / result.width;
  await adb(
    'shell',
    'input',
    'tap',
    String(Math.round(left + result.x * scale)),
    String(Math.round(top + result.y * scale)),
  );
}
export async function swipeDocumentBlock(direction) {
  const rect = await documentEvaluate(
    `(() => { const element=document.querySelector('.read-block') || document.querySelector('.unlocked-line');if(!element)return null;const rect=element.getBoundingClientRect();return {x:rect.left+rect.width*.6,y:rect.top+Math.min(20,rect.height/2),width:innerWidth}; })()`,
  );
  if (!rect) throw new Error('滑动目标不存在');
  const native = nodes(await dump()).find(node => node.class === 'android.webkit.WebView');
  const [left, top, right] = [...native.bounds.matchAll(/\d+/g)].map(match => Number(match[0]));
  const scale = (right - left) / rect.width;
  const x = Math.round(left + rect.x * scale),
    y = Math.round(top + rect.y * scale);
  await adb(
    'shell',
    'input',
    'swipe',
    String(x),
    String(y),
    String(Math.round(x + (direction === 'left' ? -85 : 85) * scale)),
    String(y),
    '180',
  );
}
