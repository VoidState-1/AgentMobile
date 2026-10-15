import { Buffer } from 'buffer';
import type { RunView } from '@/core/runs/queries';
import { AppError } from '@/core/errors';
import type { ProjectFile } from '@/core/workspace/types';
import type { WorkbenchSheet, ActionContext, EditorSession } from './types';
import { safePath, isImage, mimeFor } from '@/core/workspace/path';
import { fileName } from '@/shared/format';

interface EditorContext extends ActionContext, EditorSession { active?: RunView; setSheet(value?: WorkbenchSheet): void; setAttachment(value?: string): void }

export function useEditorActions(context: EditorContext) {
  const { runtime, ui, action, refresh, setNotice, setConfirmation, editor, editorRef, setEditor, active, setSheet, setAttachment } = context;
  async function persistEditor(close = false) {
    const document = editorRef.current;
    if (!runtime || !document) return;
    if (active?.projectId === document.projectId) throw new Error('任务仍在运行，请停止或等待完成后保存。');
    const name = document.name.trim();
    if (!/^[^/\\]+\.(md|txt)$/i.test(name) && !document.image) throw new Error('文件名称请以 .md 或 .txt 结尾。');
    let target = document.path;
    if (document.fresh) {
      target = 'documents/' + safePath(name);
      await runtime.workspace.write(document.projectId, target, Buffer.from(document.text), null);
    } else {
      if (document.text !== document.savedText && !document.image) {
        await runtime.workspace.write(document.projectId, document.path, Buffer.from(document.text), document.revision);
      }
      if (name !== document.savedName) {
        target = document.path.slice(0, document.path.lastIndexOf('/') + 1) + safePath(name);
        const current = await runtime.workspace.read(document.projectId, document.path);
        await runtime.workspace.move(document.projectId, document.path, target, current.revision);
      }
    }
    const current = await runtime.workspace.preview(document.projectId, target);
    const saved = { ...document, path: target, revision: current.revision, fresh: false,
      savedText: document.text, name: fileName(target), savedName: fileName(target) };
    const latest = editorRef.current;
    if (latest?.identity === document.identity) {
      if (latest === document) setEditor(close ? undefined : saved);
      else {
        setEditor({ ...latest, path: target, revision: current.revision, fresh: false, savedText: document.text, savedName: fileName(target) });
        if (close) throw new AppError('CONFLICT', '保存期间又有新输入，请保存最新修改后再离开。');
      }
    }
    setNotice('文件已保存，可在 Git 面板暂存并提交。');
    await refresh(ui.projectId);
  }

  function guard(next: () => void) {
    const document = editorRef.current;
    if (document && (document.fresh || document.text !== document.savedText || document.name !== document.savedName)) {
      setConfirmation({
        title: '有尚未保存的修改', description: '离开前保存文件，或放弃这次编辑。', label: '放弃修改',
        danger: true, saveFirst: true,
        perform: async () => { setEditor(undefined); }, afterPerform: next,
      });
    } else next();
  }

  function closeEditor() { guard(() => { setEditor(undefined); }); }

  async function openFile(file: ProjectFile) {
    guard(() => {
      void action(async () => {
        if (!runtime || !ui.projectId) return;
        const value = await runtime.workspace.preview(ui.projectId, file.path);
        setEditor({ identity: Symbol('editor'), projectId: ui.projectId, path: file.path, name: fileName(file.path), savedName: fileName(file.path),
          text: value.content, savedText: value.content, revision: value.revision, image: isImage(file.path), reading: true, fresh: false });
      });
    });
  }

  function newFile() {
    if (!ui.projectId) return;
    guard(() => setEditor({ identity: Symbol('editor'), projectId: ui.projectId!, path: 'documents/untitled.md', name: 'untitled.md', savedName: '',
      text: '', savedText: '', revision: null, image: false, reading: false, fresh: true }));
  }

  async function importFile(attach = false) {
    if (!runtime || !ui.projectId) return;
    await action(async () => {
      const selection = await runtime.io.pickFile();
      if (!selection) return;
      if (!/\.(md|txt|png|jpg|jpeg|webp)$/i.test(selection.name)) throw new Error('支持 Markdown、文本和 PNG/JPEG/WebP 图片。');
      const path = (isImage(selection.name) ? 'assets/' : 'documents/') + safePath(selection.name);
      await runtime.workspace.write(ui.projectId!, path, selection.bytes, null, { message: '导入 ' + selection.name });
      setNotice('已导入 ' + selection.name); await refresh(ui.projectId);
      if (attach) { setAttachment(path); setSheet(undefined); }
    });
  }

  function deleteEditor() {
    if (!runtime || !editor || editor.fresh) return;
    const document = editor;
    setConfirmation({ title: '删除 ' + document.name + '？', description: '文件会从工作区移除，删除作为未暂存更改保留。',
      label: '删除文件', danger: true,
      perform: async () => {
        await runtime.workspace.remove(document.projectId, document.path, document.revision!);
        setEditor(undefined); await refresh(ui.projectId); setNotice('文件已删除。');
      } });
  }

  async function renameEditor(name: string) {
    if (!runtime || !editor || editor.fresh) return;
    const document = editor;
    await action(async () => {
      const targetName = safePath(name.trim());
      if (targetName.includes('/')) throw new Error('请输入文件名称，不包含文件夹路径。');
      if (document.image ? mimeFor(targetName) !== mimeFor(document.path) : !/\.(md|txt)$/i.test(targetName)) {
        throw new Error(document.image ? '请保留图片的原始格式扩展名。' : '文本文件请使用 .md 或 .txt。');
      }
      const target = document.path.slice(0, document.path.lastIndexOf('/') + 1) + targetName;
      await runtime.workspace.move(document.projectId, document.path, target, document.revision!);
      const current = await runtime.workspace.preview(document.projectId, target);
      const saved = { ...document, path: target, name: targetName, savedName: targetName, revision: current.revision };
      const latest = editorRef.current;
      if (latest?.identity === document.identity) setEditor({ ...saved, text: latest.text });
      setSheet(undefined); await refresh(ui.projectId); setNotice('文件已重命名。');
    });
  }
  return { persistEditor, guard, closeEditor, openFile, newFile, importFile, deleteEditor, renameEditor };
}
