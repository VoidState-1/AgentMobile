import {
  Annotation,
  Compartment,
  EditorSelection,
  EditorState,
  StateEffect,
  StateField,
  Transaction,
} from '@codemirror/state';
import { Decoration, EditorView, WidgetType, keymap } from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  isolateHistory,
  redo,
  redoDepth,
  undo,
  undoDepth,
} from '@codemirror/commands';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { markdownRenderer as md } from '../render';
import { safeImageData } from '../resources';
import { validateEditorState, initialEditorState } from '../../../core/documents/state';

const $ = id => document.getElementById(id);
const channel = window.__DOCUMENT_CHANNEL__;
let host = {};
const waiting = new Map();
let requestSequence = 0;
let editSequence = 0;
const languageConfig = new Compartment();
let activeSave;
let imageVersion;
const imageCache = new Map();
const LIMIT = 1024 * 1024;
const validText = text => typeof text === 'string' && text.length <= LIMIT && !text.includes('\0');
const esc = md.utils.escapeHtml;

let idSequence = 0;
const newId = prefix => `${prefix}-${Date.now().toString(36)}-${++idSequence}`;
const internal = Annotation.define();
const setRegions = StateEffect.define();
const openRegion = StateEffect.define();
const gestureEffect = StateEffect.define();

let cachedDoc;
let cachedParse;

function parseDocument(doc) {
  if (doc === cachedDoc) return cachedParse;
  const text = doc.toString();
  const offsets = [0];
  for (let index = 0; index < text.length; index++)
    if (text[index] === '\n') offsets.push(index + 1);
  const env = {};
  const tokens = md.parse(text, env);
  const blocks = [];
  let cursor = 0;
  const add = (from, to, type) => {
    const content = text.slice(from, to).replace(/\n+$/, '');
    if (content.trim()) blocks.push({ from, to: from + content.length, type });
  };
  for (const token of tokens) {
    if (
      !token.block ||
      token.level !== 0 ||
      !token.map ||
      token.type === 'inline' ||
      token.nesting === -1
    )
      continue;
    const from = offsets[token.map[0]] ?? text.length;
    const to = offsets[token.map[1]] ?? text.length;
    if (from < cursor) continue;
    if (from > cursor) add(cursor, from, 'source');
    add(from, to, token.type);
    cursor = to;
  }
  if (cursor < text.length) add(cursor, text.length, 'source');
  cachedDoc = doc;
  cachedParse = { text, env, blocks, html: new Map() };
  return cachedParse;
}

function regionAt(regions, position) {
  return (
    regions.find(region => position >= region.from && position < region.to) ||
    regions.findLast(region => position === region.to) ||
    null
  );
}
function connectRegions(regions, doc) {
  const next = regions
    .map(region => ({ ...region }))
    .sort((a, b) => a.from - b.from || a.baseFrom - b.baseFrom);
  for (let index = 1; index < next.length; index++) {
    const previous = next[index - 1];
    const region = next[index];
    const gap = doc.sliceString(previous.to, region.from);
    if (previous.to <= region.from && !gap.trim() && previous.baseTo <= region.baseFrom) {
      region.from = previous.to;
      region.baseFrom = previous.baseTo;
      region.original = app.base.slice(region.baseFrom, region.baseTo);
    }
  }
  return next;
}
function mapRegions(regions, transaction) {
  if (!transaction.docChanged) return regions;
  const changes = [];
  transaction.changes.iterChanges((from, to, fromB, toB, inserted) =>
    changes.push({ from, to, length: inserted.length }),
  );
  let next = regions.map(region => ({ ...region }));
  if (!transaction.annotation(internal)) {
    for (const change of changes) {
      const owner = regionAt(regions, change.from);
      const touched = regions.filter(region => region.from < change.to && region.to > change.from);
      if (owner) touched.push(owner);
      if (change.from < change.to) {
        const context = regionAt(regions, transaction.startState.selection.main.head);
        if (context) touched.push(context);
      }
      const ids = new Set(touched.map(region => region.id));
      if (ids.size > 1) {
        const links = new Set(
          next
            .filter(region => ids.has(region.id))
            .map(region => region.link)
            .filter(Boolean),
        );
        const link = newId('linked');
        next = next.map(region =>
          ids.has(region.id) || (region.link && links.has(region.link))
            ? { ...region, link }
            : region,
        );
      }
    }
  }
  return next.map((region, index) => {
    const boundary = (position, end) => {
      let affinity = -1;
      for (const change of changes) {
        if (change.from < position && position <= change.to) affinity = 1;
        else if (change.from === change.to && change.from === position) {
          const owner =
            transaction.annotation(internal) === 'append'
              ? regions.length
              : regions.indexOf(regionAt(regions, position));
          affinity = end ? (index >= owner ? 1 : -1) : index > owner ? 1 : -1;
        }
      }
      return transaction.changes.mapPos(position, affinity);
    };
    return { ...region, from: boundary(region.from, false), to: boundary(region.to, true) };
  });
}

const app = { base: '', mode: 'blocks', saving: false };
const permissionEffect = StateEffect.define();
const permissionField = StateField.define({
  create: () => !!host.readonly,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(permissionEffect)) return effect.value;
    return value;
  },
});
const regionField = StateField.define({
  create: () => [],
  update(regions, transaction) {
    let next = mapRegions(regions, transaction);
    for (const effect of transaction.effects) {
      if (effect.is(setRegions)) next = effect.value;
      else if (effect.is(openRegion))
        next = connectRegions([...next, effect.value], transaction.newDoc);
    }
    return next;
  },
});
function sourceRanges(doc, regions) {
  const groups = [];
  for (const region of regions) {
    const previous = groups.at(-1);
    if (previous && previous.to === region.from) previous.to = region.to;
    else groups.push({ from: region.from, to: region.to, first: region });
  }
  return groups.map(group => {
    let from = group.from;
    if (app.mode !== 'full') {
      const first = group.first;
      // A following region owns the joining separators for save/undo purposes.
      // Once disconnected, only expose its own source, not those separators.
      let prefix = /^(?:[\t ]*\n)+/.exec(first.original)?.[0] ?? '';
      if (first.baseFrom === first.baseTo && !first.original && from > 0) {
        const preceding = doc.sliceString(Math.max(0, from - 2), from);
        prefix = preceding.endsWith('\n\n') ? '' : preceding.endsWith('\n') ? '\n' : '\n\n';
      }
      const maxBreaks = prefix.split('\n').length - 1;
      const current = doc.sliceString(from, first.to);
      let breaks = 0;
      for (const match of current.matchAll(/[\t ]*\n/gy)) {
        if (breaks++ >= maxBreaks) break;
        from += match[0].length;
      }
    }
    return { from, to: group.to };
  });
}
const sourceField = StateField.define({
  create: state => sourceRanges(state.doc, state.field(regionField)),
  update(value, transaction) {
    const regions = transaction.state.field(regionField);
    return transaction.docChanged || regions !== transaction.startState.field(regionField)
      ? sourceRanges(transaction.newDoc, regions)
      : value;
  },
});
const swipeField = StateField.define({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(gestureEffect)) return effect.value;
    return transaction.docChanged ? null : value;
  },
});

function closedIntervals(regions, length) {
  const result = [];
  let cursor = 0;
  for (const region of regions) {
    if (cursor < region.from) result.push({ from: cursor, to: region.from });
    cursor = Math.max(cursor, region.to);
  }
  if (cursor < length) result.push({ from: cursor, to: length });
  return result;
}
function lockedHtml(doc, from, to) {
  if (host.language === 'plain')
    return `<article class="read-block plain-source" data-from="${from}" data-to="${to}"><pre data-testid="file-plain-preview">${esc(doc.sliceString(from, to))}</pre></article>`;
  const parsed = parseDocument(doc);
  const parts = [];
  const cacheKey = `${from}:${to}`;
  if (parsed.html.has(cacheKey)) return parsed.html.get(cacheKey);
  for (const block of parsed.blocks) {
    const start = Math.max(from, block.from);
    const end = Math.min(to, block.to);
    if (end <= start) continue;
    const raw = parsed.text.slice(start, end);
    const html = md.render(raw, { references: parsed.env.references });
    parts.push(
      `<article class="read-block markdown" data-from="${start}" data-to="${end}">${html || `<div class="source-note">${esc(raw)}</div>`}</article>`,
    );
  }
  const result = parts.join('');
  parsed.html.set(cacheKey, result);
  return result;
}
class ReadingWidget extends WidgetType {
  constructor(html) {
    super();
    this.html = html;
  }
  eq(other) {
    return this.html === other.html;
  }
  toDOM() {
    const node = document.createElement('div');
    node.className = 'reading-fragment';
    node.contentEditable = 'false';
    node.innerHTML = this.html;
    return node;
  }
  ignoreEvent() {
    return true;
  }
}
function decorations(state) {
  if (app.mode === 'full') return Decoration.none;
  const regions = state.field(regionField);
  const sources = state.field(sourceField);
  const ranges = [];
  for (const locked of closedIntervals(sources, state.doc.length)) {
    ranges.push(
      Decoration.replace({
        widget: new ReadingWidget(lockedHtml(state.doc, locked.from, locked.to)),
        block: true,
        reading: true,
        // Only active source boundaries need a text line. At document edges,
        // inclusive replacement prevents CodeMirror adding phantom caret lines.
        inclusiveStart: !sources.some(source => source.to === locked.from),
        inclusiveEnd: !sources.some(source => source.from === locked.to),
      }).range(locked.from, locked.to),
    );
  }
  const swipe = state.field(swipeField);
  let previousLine = -1;
  for (const source of sources) {
    const first = state.doc.lineAt(source.from);
    const last = state.doc.lineAt(source.to);
    for (let number = first.number; number <= last.number; number++) {
      const line = state.doc.line(number);
      if (line.from === previousLine) continue;
      previousLine = line.from;
      // Permission ranges include joining newlines. A boundary at the end of
      // this line does not give the next region ownership of its text.
      const owners = regions.filter(
        item => Math.max(item.from, line.from, source.from) < Math.min(item.to, line.to, source.to),
      );
      if (!owners.length) {
        const owner = regionAt(regions, Math.max(source.from, Math.min(line.from, source.to)));
        if (owner) owners.push(owner);
      }
      if (!owners.length) continue;
      const top = number === first.number;
      const bottom = number === last.number;
      const moving = swipe && owners.length === 1 && owners[0].id === swipe.id;
      const className = `unlocked-line${top ? ' region-top' : ''}${bottom ? ' region-bottom' : ''}${app.mode === 'full' ? ' full-source-line' : ''}`;
      ranges.push(
        Decoration.line({
          attributes: {
            class: className,
            'data-open-ids': owners.map(item => item.id).join(' '),
            ...(moving ? { style: `transform:translateX(${swipe.dx}px)` } : {}),
          },
        }).range(line.from),
      );
      // Two regions can share a physical line after a cross-block deletion.
      // Keep their hit targets and moving text separate without splitting the
      // CodeMirror document or changing the line's layout.
      if (owners.length > 1 && line.length) {
        for (const owner of owners) {
          const from = Math.max(line.from, owner.from);
          const to = Math.min(line.to, owner.to);
          if (from >= to) continue;
          ranges.push(
            Decoration.mark({
              attributes: {
                'data-source-region': owner.id,
                ...(swipe?.id === owner.id
                  ? { style: `position:relative;left:${swipe.dx}px` }
                  : {}),
              },
            }).range(from, to),
          );
        }
      }
    }
  }
  return Decoration.set(ranges, true);
}
const presentationField = StateField.define({
  create: decorations,
  update(value, transaction) {
    return transaction.docChanged ||
      transaction.effects.some(
        effect => effect.is(setRegions) || effect.is(openRegion) || effect.is(gestureEffect),
      )
      ? decorations(transaction.state)
      : value;
  },
  provide: field => EditorView.decorations.from(field),
});

let view;
let saveTimer;
let toastTimer;
let layoutAnchor = null;
let lastProtectionNotice = 0;

function blockTop(position) {
  for (const block of view.contentDOM.querySelectorAll('.read-block')) {
    if (Number(block.dataset.from) <= position && position < Number(block.dataset.to))
      return block.getBoundingClientRect().top;
  }
  const { node } = view.domAtPos(position, 1);
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  return element.closest('.cm-line')?.getBoundingClientRect().top ?? null;
}
function captureBlockAnchor(region) {
  // Joining separators belong to the following edit permission range, but its
  // visual anchor starts at its own content, not at the previous block's end.
  const text = view.state.doc.sliceString(region.from, region.to);
  const prefix = /^(?:[\t ]*\n)+/.exec(text)?.[0].length ?? 0;
  const position = region.from + prefix;
  const top = blockTop(position);
  return top === null ? null : { position, top };
}
function anchoredEffects(effects, anchor) {
  layoutAnchor = anchor;
  return anchor ? [...effects, EditorView.scrollIntoView(anchor.position)] : effects;
}
function sourcePosition(sources, position, direction = 0) {
  if (sources.some(source => position >= source.from && position <= source.to)) return position;
  const before = sources.findLast(source => source.to < position);
  const after = sources.find(source => source.from > position);
  if (!before) return sources[0].from;
  if (!after) return sources.at(-1).to;
  if (direction < 0) return before.to;
  if (direction > 0) return after.from;
  return position - before.to <= after.from - position ? before.to : after.from;
}
function confineSelection(state, previous = state.selection) {
  const sources = state.field(sourceField);
  if (!sources.length) return state.selection;
  const ranges = state.selection.ranges.map((range, index) => {
    const old = previous.ranges[index] ?? previous.main;
    const head = sourcePosition(sources, range.head, Math.sign(range.head - old.head));
    const anchor = range.empty ? head : sourcePosition(sources, range.anchor);
    const source = sources.find(source => head >= source.from && head <= source.to);
    // At a widget boundary, measure the caret from the source side. Otherwise
    // ArrowUp can use the preceding preview widget's top as its starting point.
    const assoc = head === source.from ? 1 : head === source.to ? -1 : range.assoc;
    return anchor === head
      ? EditorSelection.cursor(head, assoc, range.bidiLevel ?? undefined, range.goalColumn)
      : EditorSelection.range(anchor, head, range.goalColumn, range.bidiLevel ?? undefined, assoc);
  });
  const selection = EditorSelection.create(ranges, state.selection.mainIndex);
  return selection.eq(state.selection, true) ? state.selection : selection;
}
function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => {
    $('toast').hidden = true;
  }, 1800);
}
function protect(transaction) {
  if (!transaction.docChanged) return transaction;
  if (transaction.startState.field(permissionField) && !transaction.annotation(internal)) return [];
  const regions = transaction.startState.field(sourceField);
  let allowed = validText(transaction.newDoc.toString());
  if (transaction.annotation(internal) && allowed) return transaction;
  transaction.changes.iterChanges((from, to) => {
    if (from === to) {
      if (!regions.some(region => from >= region.from && from <= region.to)) allowed = false;
      return;
    }
    let cursor = from;
    for (const region of regions) {
      if (region.to <= cursor) continue;
      if (region.from > cursor) break;
      cursor = Math.max(cursor, region.to);
      if (cursor >= to) break;
    }
    if (cursor < to) allowed = false;
  });
  if (allowed) return transaction;
  if (Date.now() - lastProtectionNotice > 1800) {
    lastProtectionNotice = Date.now();
    queueMicrotask(() => toast('正文尚未打开，修改已停止在编辑边界'));
  }
  return [];
}
const editorTheme = EditorView.theme({
  '&': { backgroundColor: 'var(--surface)', color: 'var(--text)', fontSize: '16px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--document-font)', lineHeight: '26px', overflow: 'visible' },
  '.cm-content': { padding: '0', caretColor: 'var(--accent)', minHeight: '0' },
  '.cm-content[contenteditable="false"]': { caretColor: 'transparent' },
  '.cm-line': { padding: '0 max(12px, calc((100% - 760px) / 2))', lineHeight: '26px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--selection)',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-gutters': { display: 'none' },
});
function createEditor(text, regions, selection) {
  layoutAnchor = null;
  const position = Math.max(0, Math.min(text.length, selection?.head ?? 0));
  let state = EditorState.create({
    doc: text,
    selection: EditorSelection.range(
      Math.max(0, Math.min(text.length, selection?.anchor ?? position)),
      position,
    ),
    extensions: [
      regionField.init(() => regions),
      sourceField,
      permissionField,
      swipeField,
      presentationField,
      history(),
      keymap.of([
        {
          key: 'Mod-s',
          run: () => {
            saveCurrent();
            return true;
          },
        },
        {
          key: 'Mod-Enter',
          run: () => {
            saveCurrent();
            return true;
          },
        },
        {
          key: 'Escape',
          run: () => {
            discardCurrent();
            return true;
          },
        },
        ...historyKeymap,
        ...defaultKeymap,
      ]),
      languageConfig.of(host.language === 'markdown' ? markdown() : []),
      syntaxHighlighting(defaultHighlightStyle),
      EditorView.lineWrapping,
      editorTheme,
      EditorView.editable.compute(
        [sourceField, permissionField],
        state => state.field(sourceField).length > 0 && !state.field(permissionField),
      ),
      EditorState.readOnly.compute(
        [sourceField, permissionField],
        state => !state.field(sourceField).length || state.field(permissionField),
      ),
      EditorView.atomicRanges.of(editor =>
        editor.state
          .field(presentationField)
          .update({ filter: (from, to, value) => !!value.spec.reading }),
      ),
      EditorState.transactionFilter.of(protect),
      EditorView.contentAttributes.of({
        'aria-label': '正文',
        spellcheck: 'false',
        autocapitalize: 'off',
      }),
      EditorView.scrollMargins.of(() => ({
        top: $('header').offsetHeight + 8,
        bottom: $('edit-dock').hidden
          ? 8
          : $('edit-dock').offsetHeight +
            Math.max(0, innerHeight - (window.visualViewport?.height || innerHeight)) +
            8,
      })),
      EditorView.scrollHandler.of((editor, range) => {
        const anchor = layoutAnchor;
        layoutAnchor = null;
        if (!anchor || range.head !== anchor.position) return false;
        // Run after CodeMirror has measured the replacement layout. Handling
        // this scroll target also bypasses its old widget-height scroll anchor.
        const top = blockTop(anchor.position);
        if (top !== null) window.scrollBy({ top: top - anchor.top, left: 0, behavior: 'instant' });
        return true;
      }),
      EditorView.updateListener.of(update => {
        if (
          update.docChanged ||
          update.selectionSet ||
          update.transactions.some(transaction =>
            transaction.effects.some(effect => effect.is(openRegion) || effect.is(setRegions)),
          )
        ) {
          updateChrome();
          persistSoon();
        }
      }),
    ],
  });
  const selectionInSource = confineSelection(state);
  if (selectionInSource !== state.selection)
    state = state.update({ selection: selectionInSource, filter: false }).state;
  if (view) view.setState(state);
  else
    view = new EditorView({
      state,
      parent: $('editor-host'),
      dispatchTransactions(transactions, editor) {
        // History transactions can opt out of CodeMirror filters; the final dispatch gate still protects locked text.
        if (transactions.some(transaction => protect(transaction) !== transaction)) return;
        const state = transactions.at(-1)?.state;
        if (!state) return;
        const previous = transactions.reduce(
          (selection, transaction) => selection.map(transaction.changes),
          editor.state.selection,
        );
        const selection = confineSelection(state, previous);
        if (selection !== state.selection) {
          // Apply the correction before the DOM is updated, including history
          // transactions that bypass filters. Override an invalid key-command
          // scroll target at the same time, so the page cannot jump to it.
          transactions = [
            ...transactions,
            state.update({
              selection,
              scrollIntoView: transactions.some(transaction => transaction.scrollIntoView),
              annotations: Transaction.addToHistory.of(false),
              filter: false,
            }),
          ];
        }
        editor.update(transactions);
      },
    });
  updateChrome();
}
const regions = () => view.state.field(regionField);
const workingText = () => view.state.doc.toString();
const dirty = region => view.state.doc.sliceString(region.from, region.to) !== region.original;
function anyDirty() {
  return regions().some(dirty);
}
function selectionRegion() {
  return regionAt(regions(), view.state.selection.main.head);
}
function related(region) {
  return regions().filter(
    item => item.id === region.id || (region.link && item.link === region.link),
  );
}

function checkpoint(text) {
  app.base = text;
}
function basePosition(position) {
  let delta = 0;
  for (const region of regions()) {
    if (region.to <= position) delta += region.to - region.from - (region.baseTo - region.baseFrom);
    else break;
  }
  return position - delta;
}
function openBlock(from, to, top = blockTop(from)) {
  if (app.mode !== 'blocks' || host.readonly || app.saving || view.composing) return;
  if (regions().some(region => from < region.to && to > region.from)) return;
  const baseFrom = basePosition(from);
  const baseTo = basePosition(to);
  const region = {
    id: newId('block'),
    from,
    to,
    baseFrom,
    baseTo,
    original: app.base.slice(baseFrom, baseTo),
  };
  const anchor = top === null ? null : { position: from, top };
  view.dispatch({
    effects: anchoredEffects([openRegion.of(region)], anchor),
    selection: EditorSelection.cursor(from),
    annotations: [Transaction.addToHistory.of(false), isolateHistory.of('full')],
  });
  view.focus();
  persistNow();
}
function closeSelection(next, targets, anchor = captureBlockAnchor(targets[0])) {
  const targetIds = new Set(targets.map(region => region.id));
  const current = selectionRegion();
  const closesSelection = current && targetIds.has(current.id);
  const selection = closesSelection
    ? EditorSelection.cursor(anchor?.position ?? current.from)
    : view.state.selection;
  if (!next.length || closesSelection) view.contentDOM.blur();
  view.dispatch({
    effects: anchoredEffects([setRegions.of(next), gestureEffect.of(null)], anchor),
    selection,
    annotations: [Transaction.addToHistory.of(false), isolateHistory.of('full')],
  });
  updateChrome();
  persistNow();
}
async function saveRegions(targets) {
  if (host.readonly || app.saving) return false;
  if (!targets.length) return true;
  if (view.composing) {
    toast('请先确认输入法中的文字');
    return false;
  }
  const patches = targets
    .map(region => ({ ...region, insert: view.state.doc.sliceString(region.from, region.to) }))
    .sort((a, b) => a.baseFrom - b.baseFrom);
  if (patches.some(patch => app.base.slice(patch.baseFrom, patch.baseTo) !== patch.original)) {
    toast('保存基线已变化，草稿已保留');
    return false;
  }
  let base = app.base;
  for (const patch of patches.slice().reverse())
    base = base.slice(0, patch.baseFrom) + patch.insert + base.slice(patch.baseTo);
  if (!validText(base)) {
    toast('单独保存后文件超限，请一起保存修改或缩短内容');
    return false;
  }
  const targetIds = new Set(targets.map(region => region.id));
  const remaining = regions()
    .filter(region => !targetIds.has(region.id))
    .map(region => {
      const delta = patches.reduce(
        (sum, patch) =>
          sum +
          (patch.baseTo < region.baseFrom ||
          (patch.baseTo === region.baseFrom &&
            (patch.baseFrom !== patch.baseTo || patch.from <= region.from))
            ? patch.insert.length - (patch.baseTo - patch.baseFrom)
            : 0),
        0,
      );
      return { ...region, baseFrom: region.baseFrom + delta, baseTo: region.baseTo + delta };
    });
  app.saving = true;
  updatePermission();
  try {
    activeSave = requestHost('save', {
      text: base,
      snapshot: snapshot(),
      nextState: {
        ...snapshot(),
        base,
        regions: remaining,
        mode: app.mode === 'full' ? 'blocks' : app.mode,
      },
    });
    await activeSave;
  } catch (error) {
    toast(error.message || '保存失败，草稿已保留');
    return false;
  } finally {
    activeSave = undefined;
    app.saving = false;
    updatePermission();
  }
  checkpoint(base);
  if (app.mode === 'full') app.mode = 'blocks';
  closeSelection(remaining, targets);
  return true;
}
async function saveCurrent(region = selectionRegion()) {
  if (!region) return;
  const targets = related(region);
  if (await saveRegions(targets)) toast(targets.length > 1 ? '跨块修改已保存' : '已保存');
}
function discardRegions(targets) {
  if (host.readonly || app.saving) return false;
  if (!targets.length) return true;
  if (view.composing) {
    toast('请先确认输入法中的文字');
    return false;
  }
  const changes = [];
  for (const target of targets.slice().sort((a, b) => a.from - b.from || a.baseFrom - b.baseFrom)) {
    const previous = changes.at(-1);
    if (previous && previous.to === target.from) {
      previous.to = target.to;
      previous.insert += target.original;
    } else changes.push({ from: target.from, to: target.to, insert: target.original });
  }
  const ids = new Set(targets.map(region => region.id));
  if (
    view.state.doc.length +
      changes.reduce((sum, change) => sum + change.insert.length - (change.to - change.from), 0) >
    LIMIT
  ) {
    toast('恢复后内容超限，请先保存或缩短其他草稿');
    return false;
  }
  if (app.mode === 'full') app.mode = 'blocks';
  const anchor = captureBlockAnchor(targets[0]);
  const current = selectionRegion();
  const closesSelection = current && ids.has(current.id);
  const changeSet = view.state.changes(changes);
  if (anchor) {
    const target = targets[0];
    const prefix = /^(?:[\t ]*\n)+/.exec(target.original)?.[0].length ?? 0;
    anchor.position = changeSet.mapPos(target.from, -1) + prefix;
  }
  if (!regions().some(region => !ids.has(region.id)) || closesSelection) view.contentDOM.blur();
  view.dispatch({
    changes: changeSet,
    annotations: [
      internal.of('restore'),
      Transaction.addToHistory.of(false),
      isolateHistory.of('full'),
    ],
  });
  const next = regions().filter(region => !ids.has(region.id));
  view.dispatch({
    effects: anchoredEffects([setRegions.of(next), gestureEffect.of(null)], anchor),
    selection: closesSelection
      ? EditorSelection.cursor(anchor?.position ?? changeSet.mapPos(current.from, -1))
      : view.state.selection,
    annotations: Transaction.addToHistory.of(false),
  });
  updateChrome();
  persistNow();
  return true;
}
function discardCurrent(region = selectionRegion()) {
  if (!region) return;
  const targets = related(region);
  if (discardRegions(targets)) toast(targets.length > 1 ? '已放弃跨块修改' : '已放弃当前修改');
}
async function switchMode(mode) {
  if (mode === app.mode || host.readonly || app.saving || view.composing) return;
  if (anyDirty()) {
    post({ type: 'mode', mode });
    return;
  }
  // Change mode and regions in one transaction. Emitting a temporary full
  // mode with no region would violate the host's snapshot contract.
  app.mode = mode;
  const next = initialEditorState(workingText(), mode === 'full');
  view.dispatch({
    effects: setRegions.of(next.regions),
    selection: EditorSelection.cursor(next.regions[0]?.from ?? 0),
    annotations: [Transaction.addToHistory.of(false), isolateHistory.of('full')],
  });
  if (mode === 'blocks') view.contentDOM.blur();
  updateChrome();
  persistNow();
}
function appendParagraph() {
  if (app.mode !== 'blocks' || view.composing) return;
  const last = regions().at(-1);
  if (last && last.to === view.state.doc.length && !view.state.doc.sliceString(last.from).trim()) {
    view.dispatch({ selection: { anchor: last.to }, scrollIntoView: true });
    view.focus();
    return;
  }
  const from = view.state.doc.length;
  const prefix =
    from === 0 || workingText().endsWith('\n\n')
      ? ''
      : workingText().endsWith('\n')
        ? '\n'
        : '\n\n';
  if (from + prefix.length > LIMIT) {
    toast('文件已达到原型大小限制');
    return;
  }
  const region = {
    id: newId('block'),
    from,
    to: from + prefix.length,
    baseFrom: app.base.length,
    baseTo: app.base.length,
    original: '',
  };
  view.dispatch({
    changes: { from, insert: prefix },
    effects: openRegion.of(region),
    selection: { anchor: region.to },
    annotations: [internal.of('append'), Transaction.addToHistory.of(false)],
  });
  view.focus();
  persistNow();
}

function updateChrome() {
  if (!view) return;
  $('edit-dock').hidden = !regions().length || !!host.readonly;
  $('full-actions').hidden = app.mode !== 'full';
  $('add-block').hidden = app.mode !== 'blocks' || host.language === 'plain' || !!host.readonly;
  $('empty-state').hidden = !!workingText().trim() || !!regions().length;
  $('mode-blocks').setAttribute('aria-selected', String(app.mode === 'blocks'));
  $('mode-full').setAttribute('aria-selected', String(app.mode === 'full'));
  document.body.dataset.mode = app.mode;
  $('undo').disabled =
    !regions().length ||
    !undoDepth(view.state) ||
    !!host.readonly ||
    !!host.inputLocked ||
    app.saving;
  $('redo').disabled =
    !regions().length ||
    !redoDepth(view.state) ||
    !!host.readonly ||
    !!host.inputLocked ||
    app.saving;
  queueMicrotask(hydrateImages);
}
function snapshot() {
  return {
    base: app.base,
    text: workingText(),
    regions: regions(),
    mode: app.mode,
    selection: view.state.selection.main.toJSON(),
  };
}
function persistSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, 25);
}
function persistNow() {
  if (!view) return;
  clearTimeout(saveTimer);
  post({ type: 'change', sequence: ++editSequence, snapshot: snapshot() });
  updateChrome();
}
function historyAction(forward) {
  if (regions().length) (forward ? redo : undo)(view);
}
function format(kind) {
  if (host.readonly || app.saving) return;
  if (!regions().length) return;
  const range = view.state.selection.main;
  const selected = view.state.doc.sliceString(range.from, range.to);
  let insert;
  let from = range.from;
  let to = range.to;
  let anchor;
  if (kind === 'bold') {
    insert = `**${selected || '文字'}**`;
    anchor = from + 2;
  } else if (kind === 'code') {
    insert = `\`${selected || '代码'}\``;
    anchor = from + 1;
  } else if (kind === 'link') {
    insert = `[${selected || '链接文字'}](https://)`;
    anchor = from + 1;
  } else {
    from = view.state.doc.lineAt(range.from).from;
    insert = view.state.doc
      .sliceString(from, to)
      .split('\n')
      .map(line => `${kind === 'list' ? '- ' : '> '}${line}`)
      .join('\n');
    anchor = from + insert.length;
  }
  view.dispatch({
    changes: { from, to, insert },
    selection: EditorSelection.cursor(anchor),
    scrollIntoView: true,
    annotations: Transaction.userEvent.of('input'),
  });
  view.focus();
}

let gesture = null;
let suppressClick = 0;
function hitOpenRegion(event) {
  const line = event.target.closest('.cm-line.unlocked-line');
  if (!line || !view.contentDOM.contains(line)) return null;
  const source = event.target.closest('[data-source-region]');
  if (source) return regions().find(region => region.id === source.dataset.sourceRegion) ?? null;
  const ids = line.dataset.openIds.split(' ');
  const owners = regions().filter(region => ids.includes(region.id));
  if (owners.length === 1) return owners[0];
  const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
  // Resolve shared-line padding only among this actual DOM line's owners.
  // Never fall back to the old caret or a separator-owned neighboring block.
  return position === null ? null : regionAt(owners, position);
}
$('editor-host').addEventListener(
  'pointerdown',
  event => {
    suppressClick = 0;
    if (
      app.mode !== 'blocks' ||
      host.readonly ||
      app.saving ||
      view.composing ||
      event.button !== 0 ||
      !event.isPrimary ||
      event.target.closest('a, button, input')
    )
      return;
    const reading = event.target.closest('.read-block');
    const region = reading ? null : hitOpenRegion(event);
    if (!reading && !region) return;
    gesture = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      reading,
      from: reading ? Number(reading.dataset.from) : region.from,
      to: reading ? Number(reading.dataset.to) : region.to,
      regionId: region?.id,
      doc: view.state.doc,
      dx: 0,
      locked: false,
      started: performance.now(),
    };
  },
  true,
);
$('editor-host').addEventListener(
  'pointermove',
  event => {
    const g = gesture;
    if (!g || event.pointerId !== g.id) return;
    if (g.doc !== view.state.doc || (g.reading && !g.reading.isConnected)) {
      endGesture({ type: 'pointercancel', pointerId: g.id });
      return;
    }
    const dx = event.clientX - g.x;
    const dy = event.clientY - g.y;
    if (!g.locked) {
      if (
        (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx) * 0.8) ||
        (g.reading && dx > 15) ||
        performance.now() - g.started > 450
      ) {
        gesture = null;
        return;
      }
      if (Math.abs(dx) < 14 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
      g.locked = true;
      $('editor-host').setPointerCapture(event.pointerId);
    }
    event.preventDefault();
    g.dx = Math.max(-96, Math.min(96, dx));
    if (g.reading) g.reading.style.transform = `translateX(${g.dx}px)`;
    else
      view.dispatch({
        effects: gestureEffect.of({ id: g.regionId, dx: g.dx }),
        annotations: Transaction.addToHistory.of(false),
      });
  },
  { passive: false },
);
function endGesture(event) {
  const g = gesture;
  if (!g || event.pointerId !== g.id) return;
  gesture = null;
  if (g.reading) g.reading.style.transform = '';
  else if (g.locked)
    view.dispatch({
      effects: gestureEffect.of(null),
      annotations: Transaction.addToHistory.of(false),
    });
  if (g.locked) {
    suppressClick = performance.now() + 400;
    if ($('editor-host').hasPointerCapture(g.id)) $('editor-host').releasePointerCapture(g.id);
  }
  if (event.type !== 'pointerup' || Math.abs(g.dx) < 64 || g.doc !== view.state.doc) return;
  if (g.reading) {
    if (g.reading.isConnected) openBlock(g.from, g.to, g.reading.getBoundingClientRect().top);
  } else {
    const region = regions().find(item => item.id === g.regionId);
    if (!region) return;
    if (g.dx > 0) saveCurrent(region);
    else discardCurrent(region);
  }
}
$('editor-host').addEventListener('pointerup', endGesture);
$('editor-host').addEventListener('pointercancel', endGesture);
$('editor-host').addEventListener('lostpointercapture', event => {
  // Touch starts with implicit capture on the paragraph. Transferring that
  // capture to the host must not cancel the gesture via the bubbled old event.
  if (event.target === $('editor-host') && !$('editor-host').hasPointerCapture(event.pointerId))
    endGesture(event);
});
$('editor-host').addEventListener(
  'click',
  event => {
    if (performance.now() < suppressClick) event.preventDefault();
  },
  true,
);

function post(message) {
  const envelope = { channel, ...message };
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(envelope));
  else window.parent.postMessage(envelope, '*');
}
function requestHost(type, payload) {
  const requestId = 'browser-' + ++requestSequence;
  return new Promise((resolve, reject) => {
    waiting.set(requestId, { resolve, reject });
    post({ type, requestId, ...payload });
  });
}
function updatePermission() {
  if (!view) return;
  view.dispatch({
    effects: permissionEffect.of(!!host.readonly || !!host.inputLocked || app.saving),
    annotations: Transaction.addToHistory.of(false),
  });
  if (host.readonly) view.contentDOM.blur();
  updateChrome();
}
function applyTheme(theme) {
  if (!theme) return;
  for (const [key, value] of Object.entries(theme)) {
    if (typeof value === 'string' && /^#[\da-f]{3,8}$/i.test(value))
      document.documentElement.style.setProperty(
        '--' + key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase()),
        value,
      );
  }
  document.documentElement.dataset.theme = theme.dark ? 'dark' : 'light';
}
function hydrateImages() {
  for (const placeholder of document.querySelectorAll('[data-image-target]')) {
    const target = placeholder.dataset.imageTarget;
    placeholder.removeAttribute('data-image-target');
    let result = imageCache.get(target);
    if (!result) {
      result = requestHost('image', { target }).catch(() => null);
      imageCache.set(target, result);
    }
    const version = imageVersion;
    void result.then(uri => {
      if (!placeholder.isConnected || version !== imageVersion) return;
      if (!safeImageData(uri)) {
        placeholder.querySelector('small').textContent = '图片不可用';
        return;
      }
      const image = document.createElement('img');
      image.alt = placeholder.dataset.alt;
      image.dataset.target = target;
      image.src = uri;
      image.onload = () => {
        view?.requestMeasure();
        reportHeight();
      };
      image.onerror = () => {
        image.replaceWith(placeholder);
        placeholder.querySelector('small').textContent = '图片不可用';
        reportHeight();
      };
      placeholder.replaceWith(image);
    });
  }
}
function renderReader() {
  $('reader').innerHTML = md.render(host.content || '');
  $('reader').style.color = host.tone === 'secondary' ? 'var(--secondary)' : 'var(--text)';
  hydrateImages();
  reportHeight();
}
function reportHeight() {
  if (host.kind === 'reader')
    post({ type: 'height', height: Math.ceil($('reader').getBoundingClientRect().height) });
}
function configure(value) {
  const previousImages = imageVersion;
  const previousLanguage = host.language;
  host = { ...host, ...value };
  imageVersion = host.imageVersion;
  applyTheme(host.theme);
  document.body.dataset.language = host.language || 'markdown';
  document.body.dataset.kind = host.kind;
  $('mode-blocks').textContent = host.language === 'plain' ? '原文' : '分块';
  $('mode-full').textContent = host.language === 'plain' ? '编辑' : '全文';
  if (previousImages !== imageVersion) imageCache.clear();
  if (host.kind === 'reader') renderReader();
  else {
    updatePermission();
    if (view && previousLanguage !== host.language)
      view.dispatch({
        effects: [
          languageConfig.reconfigure(host.language === 'markdown' ? markdown() : []),
          setRegions.of([...regions()]),
        ],
        annotations: Transaction.addToHistory.of(false),
      });
    if (previousImages !== imageVersion && view) {
      // Rebuild widgets after image revisions change; never keep stale data URIs.
      view.dispatch({
        effects: setRegions.of([...regions()]),
        annotations: Transaction.addToHistory.of(false),
      });
      for (const image of view.contentDOM.querySelectorAll('img')) {
        const placeholder = document.createElement('span');
        placeholder.className = 'image-placeholder';
        placeholder.dataset.imageTarget = image.dataset.target || '';
        placeholder.dataset.alt = image.alt;
        placeholder.setAttribute('role', 'img');
        placeholder.setAttribute('aria-label', image.alt);
        placeholder.innerHTML = '<small>正在读取项目图片…</small>';
        image.replaceWith(placeholder);
      }
      hydrateImages();
    }
  }
}
async function receive(message) {
  if (!message || message.channel !== channel) return;
  if (message.type === 'ping') {
    post({ type: 'ready' });
    return;
  }
  if (message.type === 'response') {
    const entry = waiting.get(message.requestId);
    if (!entry) return;
    waiting.delete(message.requestId);
    if (message.error) entry.reject(new Error(message.error));
    else entry.resolve(message.value);
    return;
  }
  if (message.type === 'init') {
    configure(message.config);
    if (host.kind !== 'reader') {
      validateEditorState(message.state);
      app.base = message.state.base;
      app.mode = message.state.mode;
      createEditor(message.state.text, message.state.regions, message.state.selection);
      persistNow();
    }
    return;
  }
  if (message.type === 'configure') {
    configure(message.config);
    return;
  }
  if (message.type !== 'command' || !view) return;
  try {
    if (activeSave) await activeSave.catch(() => {});
    if (message.command === 'save') {
      if (view.composing) throw new Error('请先确认输入法中的文字');
      if (!(await saveRegions(regions()))) throw new Error('保存失败，修改已保留');
    } else if (message.command === 'mode') await switchMode(message.mode);
    else if (message.command === 'undo') historyAction(false);
    else if (message.command === 'redo') historyAction(true);
    else if (message.command === 'discard' && !discardRegions(regions()))
      throw new Error('当前无法放弃修改，请先确认输入法中的文字。');
    persistNow();
    post({ type: 'result', requestId: message.requestId, snapshot: snapshot() });
  } catch (error) {
    post({
      type: 'result',
      requestId: message.requestId,
      error: error.message || '编辑器操作失败',
    });
  }
}
window.addEventListener('message', event => {
  if (event.source !== window.parent && !window.ReactNativeWebView) return;
  void receive(typeof event.data === 'string' ? JSON.parse(event.data) : event.data).catch(error =>
    toast(error.message),
  );
});
document.addEventListener(
  'click',
  event => {
    const link = event.target.closest('a');
    if (!link) return;
    event.preventDefault();
    event.stopPropagation();
    post({ type: 'link', url: link.getAttribute('href') });
  },
  true,
);
$('mode-blocks').onclick = () => {
  void switchMode('blocks');
};
$('mode-full').onclick = () => {
  void switchMode('full');
};
$('add-block').onclick = appendParagraph;
$('save-edit').onclick = () => {
  void saveRegions(regions());
};
$('cancel-edit').onclick = () => discardRegions(regions());
$('undo').onclick = () => {
  historyAction(false);
  persistNow();
};
$('redo').onclick = () => {
  historyAction(true);
  persistNow();
};
document.querySelectorAll('[data-format]').forEach(button => {
  button.onpointerdown = event => event.preventDefault();
  button.onclick = () => format(button.dataset.format);
});
function viewportChanged() {
  const viewport = window.visualViewport;
  const height = viewport?.height || innerHeight;
  document.documentElement.style.setProperty(
    '--keyboard-inset',
    `${Math.max(0, innerHeight - height - (viewport?.offsetTop || 0))}px`,
  );
  if (view?.hasFocus) view.requestMeasure();
}
window.visualViewport?.addEventListener('resize', viewportChanged);
window.addEventListener('resize', viewportChanged);
new ResizeObserver(reportHeight).observe($('reader'));
viewportChanged();
post({ type: 'ready' });
