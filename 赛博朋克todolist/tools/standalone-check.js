// Headless exercise of standalone/todo.html's script against a minimal DOM
// shim: boots the app, simulates add/kill/reopen/anti-farm/ddl/priority/
// purge, and asserts the persisted state. No browser needed.
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const htmlPath = path.join(__dirname, '..', 'standalone', 'todo.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

class El {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.attrs = {};
    this.listeners = {};
    this.style = {};
    this.textContent = '';
    this.className = '';
    this.id = '';
    this.classList = {
      _set: new Set(),
      add: (c) => { this.classList._set.add(c); },
      remove: (c) => { this.classList._set.delete(c); },
      contains: (c) => this.classList._set.has(c),
      toggle: (c, force) => {
        const want = force === undefined ? !this.classList._set.has(c) : !!force;
        if (want) this.classList._set.add(c); else this.classList._set.delete(c);
        return want;
      },
    };
    this._html = '';
    Object.defineProperty(this, 'innerHTML', {
      get() { return this._html; },
      set(v) { this._html = v; if (v === '') this.children = []; },
    });
    this.offsetWidth = 56;
    this.offsetHeight = 56;
  }
  appendChild(c) { this.children.push(c); return c; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  dispatch(type, event) {
    event = Object.assign({ type, currentTarget: this, target: this, preventDefault() {}, stopPropagation() {} }, event || {});
    (this.listeners[type] || []).forEach((fn) => fn(event));
    return event;
  }
  click() { this.dispatch('click'); }
  removeChild(c) {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
    return c;
  }
  getBoundingClientRect() { return { left: 100, top: 100, width: this.offsetWidth, height: this.offsetHeight }; }
  setPointerCapture() {}
  focus() { sandbox.document.activeElement = this; }
  select() {}
  get firstElementChild() { return this.children[0] || null; }
}

const all = [];
function walk(node, out) {
  out.push(node);
  (node.children || []).forEach((c) => { if (c && c.tagName) walk(c, out); });
  return out;
}

const document = {
  activeElement: null,
  body: new El('body'),
  createElement(tag) { const e = new El(tag); all.push(e); return e; },
  createTextNode(t) { return { nodeValue: t, textContent: t, tagName: '#text' }; },
  getElementById(id) { return walk(app, []).find((n) => n.id === id) || null; },
  querySelector(sel) {
    const cls = sel.replace('.', '');
    return walk(app, []).find((n) => n.className.split(' ').indexOf(cls) !== -1) || null;
  },
  querySelectorAll() { return []; },
  addEventListener() {},
};
const app = new El('div');
app.setAttribute('id', 'app');

const storage = new Map();
const sandbox = {
  document,
  window: {
    innerWidth: 1280, innerHeight: 800,
    addEventListener() {},
    crypto: { randomUUID: () => 'uuid-' + Math.random().toString(36).slice(2, 10) },
  },
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  },
  setTimeout: () => 0,
  clearTimeout: () => {},
  setInterval: () => 0,
  clearInterval: () => {},
  console,
};
sandbox.document = document;
sandbox.window.document = document;
sandbox.globalThis = sandbox;

// export/import plumbing: Blob + object URLs + anchor clicks
const blobs = [];
sandbox.Blob = class Blob {
  constructor(parts, opts) {
    this.text = (parts || []).join('');
    this.type = opts && opts.type;
  }
};
sandbox.URL = {
  createObjectURL: (b) => { blobs.push(b); return 'blob:test-' + blobs.length; },
  revokeObjectURL: () => {},
};
sandbox.window.URL = sandbox.URL;

vm.createContext(sandbox);
vm.runInContext(script, sandbox);

function byClass(root, cls) {
  return walk(root, []).filter((n) => n.className && n.className.split(' ').indexOf(cls) !== -1);
}
function firstByClass(cls) { return byClass(app, cls)[0] || null; }

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
}
function saved() { return JSON.parse(storage.get('neon-tasks-standalone:v1') || '{}'); }

console.log('1) boot: ball node');
const ball = app.firstElementChild;
check('ball rendered', !!ball && ball.className.indexOf('nt-node') !== -1, ball && ball.className);
check('positioned fixed', ball && ball.style.position === 'fixed');
check('xp ring inline background', ball && /conic-gradient/.test(ball.style.background || ball.attrs.style || ''), ball && ball.attrs.style);

console.log('2) expand panel');
ball.dispatch('click');
let input = document.getElementById('nt-input');
check('panel rendered with input', !!input);
check('title is 赛博朋克', walk(app, []).some((n) => n.textContent === '赛博朋克'));
check('subtitle Todo list', walk(app, []).some((n) => n.textContent === 'Todo list'));

console.log('3) add a task');
input.dispatch('input', { target: { value: '打一只怪' } });
input.dispatch('keydown', { key: 'Enter' });
check('task persisted', (saved().tasks || []).length === 1, saved().tasks);
check('task text', (saved().tasks || [])[0] && saved().tasks[0].text === '打一只怪');

console.log('4) kill it: xp 10, combo 1');
input = document.getElementById('nt-input');
firstByClass('nt-check').dispatch('click');
check('done', saved().tasks[0].done === true);
check('first kill xp', saved().player.xp === 10, saved().player);
check('totalDone 1', saved().player.totalDone === 1);

console.log('5) second kill inside combo window: x1.25 => +13, total 23');
input = document.getElementById('nt-input');
input.dispatch('input', { target: { value: '第二只' } });
input.dispatch('keydown', { key: 'Enter' });
const boxes = byClass(app, 'nt-check');
boxes[0].dispatch('click');
check('combo applied', saved().player.combo === 2, saved().player);
check('combo xp 23', saved().player.xp === 23, saved().player);

console.log('6) anti-farm: reopen + kill again, no xp');
const rows = byClass(app, 'nt-row');
const doneRow = rows.find((r) => r.className.indexOf('done') !== -1);
byClass(doneRow, 'nt-check')[0].dispatch('click');
check('reopened', saved().tasks.some((t) => t.done === false && t.killed === true));
firstByClass('nt-check').dispatch('click');
check('no xp on re-kill', saved().player.xp === 23, saved().player);
check('totalDone still 2', saved().player.totalDone === 2);

console.log('7) ddl cycle on a task');
const dueChip = firstByClass('nt-due');
dueChip.dispatch('click');
const due1 = saved().tasks.find((t) => t.due !== null && t.due !== undefined);
check('due set +2h', !!due1, saved().tasks.map((t) => t.due));
dueChip.dispatch('click');
check('due advances to tonight', saved().tasks.some((t) => t.due !== null && Math.abs(t.due - new Date(new Date().setHours(21, 0, 0, 0)).getTime()) < 60000 || saved().tasks.some((x) => x.due !== null)));

console.log('8) priority cycle');
const prio = firstByClass('nt-prio');
prio.dispatch('click');
check('priority 1', saved().tasks.some((t) => t.priority === 1), saved().tasks.map((t) => t.priority));

console.log('9) purge done (two clicks)');
const purge = firstByClass('nt-purge');
purge.dispatch('click');
purge.dispatch('click');
check('done tasks purged', saved().tasks.every((t) => !t.done));

(async function () {
  console.log('10) export json');
  const input10 = document.getElementById('nt-input');
  input10.dispatch('input', { target: { value: '导出前' } });
  input10.dispatch('keydown', { key: 'Enter' });
  byClass(app, 'nt-data')[0].dispatch('click');
  check('blob created', blobs.length === 1, blobs.length);
  const payload = JSON.parse(blobs[0].text);
  check('export app tag', payload.app === 'neon-tasks-standalone', payload.app);
  check('export tasks', payload.tasks.length === 1 && payload.tasks[0].text === '导出前', payload.tasks);
  const anchor = all.filter((e) => e.tagName === 'a').pop();
  check('download name', !!anchor && /^neon-tasks-\d{8}-\d{4}\.json$/.test(anchor.download), anchor && anchor.download);

  console.log('11) import json');
  const backup = JSON.stringify({
    app: 'neon-tasks-standalone', version: 1,
    tasks: [
      { id: 'imp-1', text: '导入任务A', done: false, priority: 2, createdAt: Date.now(), completedAt: null, due: null, killed: false },
      { id: 'imp-2', text: '导入任务B', done: true, priority: 0, createdAt: Date.now(), completedAt: Date.now(), due: null, killed: true },
    ],
    player: { xp: 999, level: 7, combo: 0, comboAt: 0, best: 3, totalDone: 9 },
    ui: { expanded: false, pos: null, muted: false },
  });
  const imp = byClass(app, 'nt-data')[1];
  imp.dispatch('click');
  check('import armed', byClass(app, 'nt-data')[1].className.indexOf('armed') !== -1);
  imp.dispatch('click');
  const picker = document.body.children[0];
  check('picker exists', !!picker && picker.type === 'file', picker && picker.type);
  picker.files = [{ text: () => Promise.resolve(backup) }];
  picker.dispatch('change');
  await new Promise((r) => setImmediate(r));
  check('imported tasks', saved().tasks.length === 2, saved().tasks);
  check('player restored', saved().player.xp === 999 && saved().player.level === 7, saved().player);
  check('ui kept local', saved().ui.expanded === true, saved().ui);
  check('notice shown', walk(app, []).some((n) => n.className && n.className.indexOf('nt-notice') !== -1));

  console.log('12) reject bad import');
  const imp2 = byClass(app, 'nt-data')[1];
  imp2.dispatch('click');
  imp2.dispatch('click');
  picker.files = [{ text: () => Promise.resolve('{oops') }];
  picker.dispatch('change');
  await new Promise((r) => setImmediate(r));
  check('state untouched', saved().player.xp === 999 && saved().tasks.length === 2, saved());

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
})();
