// 赛博朋克 — floating cyberpunk task folder for the Harness Web UI.
//
// Client half of @local/neon-tasks. A draggable glass folder whose collapsed
// form is a round node; expanded it is a stacked folder of liquid-glass cards
// with a metallic rim. Palette: hot pink #00ff88, gray #757575, yellow #ffff00.
//
// Game layer: every completion drops XP (priority-scaled, combo-multiplied),
// level-ups fire a toast and a fanfare, deadlines (DDL) put pressure on the
// board, and the completion blips and level melody are synthesized with
// WebAudio (no assets, mute toggle persisted beside the UI chrome).
//
// State is written through to the host route /api/neon-tasks/state (durable,
// survives restarts) with a localStorage fallback when the host is unreachable.
window.__ModuleLoader__.load({
  id: '@local/neon-tasks',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = '@local/neon-tasks';
    const STATE_KEY = 'neon-tasks:state:v2';
    const LEGACY_STATE_KEY = 'neon-tasks:state:v1';
    const UI_KEY = 'neon-tasks:ui:v1';
    const API = '/api/neon-tasks/state';
    const MAX_TASKS = 500;

    // XP economy: base drop per priority, level cost grows linearly, and a
    // combo window rewards chaining kills.
    const XP_BASE = [10, 15, 25, 40];
    const LEVEL_STEP = 120;
    const COMBO_WINDOW = 120000;
    const COMBO_STEP = 0.25;
    const COMBO_MAX = 2;

    const STRINGS = {
      en: {
        title: 'Neon tasks',
        headerTitle: '赛博朋克',
        headerSub: 'Todo list',
        headerSubEn: 'COLOR SCHEME SHARING',
        inputPlaceholder: 'add a task…',
        openLabel: 'open',
        doneLabel: 'done',
        createdLabel: 'created',
        dueLabel: 'due',
        overdue: 'overdue',
        ddlNone: 'no ddl',
        ddl2h: '+2h',
        ddlTonight: 'tonight',
        ddlTomorrow: 'tomorrow',
        ddlCycles: 'set deadline',
        all: 'all', active: 'active', done: 'done',
        emptyActive: 'no open tasks right now',
        emptyAll: 'nothing here yet — add your first task',
        emptyDone: 'nothing archived yet',
        purge: 'purge done',
        purgeConfirm: 'confirm?',
        syncOk: 'sync ok',
        syncLocal: 'local only',
        syncLoading: 'syncing…',
        prio0: 'no priority', prio1: 'priority 1', prio2: 'priority 2', prio3: 'priority 3',
        markDone: 'mark done',
        markOpen: 'mark not done',
        edit: 'edit task',
        editPlaceholder: 'task text',
        remove: 'delete task',
        collapse: 'collapse',
        progress: 'progress',
        completion: 'completion',
        taskCount: 'task count',
        level: 'level',
        xp: 'xp',
        combo: 'combo',
        soundOn: 'sound on',
        soundOff: 'sound off',
        levelUp: 'level up',
        xpGain: 'xp gained',
      },
      zh: {
        title: '霓虹任务',
        headerTitle: '赛博朋克',
        headerSub: 'Todo list',
        headerSubEn: 'COLOR SCHEME SHARING',
        inputPlaceholder: '添加任务…',
        openLabel: '待办',
        doneLabel: '完成',
        createdLabel: '创建',
        dueLabel: '截止',
        overdue: '已逾期',
        ddlNone: '无截止',
        ddl2h: '2小时',
        ddlTonight: '今晚',
        ddlTomorrow: '明天',
        ddlCycles: '设置截止时间',
        all: '全部', active: '待办', done: '完成',
        emptyActive: '暂无待办任务',
        emptyAll: '还没有任务，添加第一条吧',
        emptyDone: '还没有已完成的任务',
        purge: '清空已完成',
        purgeConfirm: '确认清除？',
        syncOk: '已同步',
        syncLocal: '仅本地',
        syncLoading: '同步中…',
        prio0: '无优先级', prio1: '优先级 1', prio2: '优先级 2', prio3: '优先级 3',
        markDone: '标记完成',
        markOpen: '标记为待办',
        edit: '编辑任务',
        editPlaceholder: '任务内容',
        remove: '删除任务',
        collapse: '收起',
        progress: '进度',
        completion: '完成度',
        taskCount: '任务数量',
        level: '等级',
        xp: '经验',
        combo: '连击',
        soundOn: '音效开',
        soundOff: '音效关',
        levelUp: '升级',
        xpGain: '获得经验',
      },
    };

    // ---------- helpers ----------

    function readJSON(key) {
      try { return JSON.parse(window.localStorage.getItem(key)); } catch (e) { return null; }
    }
    function writeJSON(key, value) {
      try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
    }

    function newId() {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
      return 't-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    }

    function clockText(d) {
      const p = function (n) { return String(n).padStart(2, '0'); };
      return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    }

    function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

    function emptyState() {
      return { updatedAt: 0, tasks: [], player: { xp: 0, level: 1, combo: 0, comboAt: 0, best: 0, totalDone: 0 } };
    }

    function isValidTask(x) {
      return !!x && typeof x === 'object'
        && typeof x.id === 'string'
        && typeof x.text === 'string'
        && typeof x.done === 'boolean'
        && [0, 1, 2, 3].indexOf(x.priority) !== -1
        && typeof x.createdAt === 'number'
        && (x.completedAt === null || typeof x.completedAt === 'number')
        && (x.due === undefined || x.due === null || typeof x.due === 'number')
        && (x.killed === undefined || typeof x.killed === 'boolean');
    }

    function sanitizePlayer(raw) {
      const fallback = { xp: 0, level: 1, combo: 0, comboAt: 0, best: 0, totalDone: 0 };
      if (!raw || typeof raw !== 'object') return fallback;
      const num = function (v, d) { return typeof v === 'number' && isFinite(v) ? v : d; };
      return {
        xp: Math.max(0, num(raw.xp, 0)),
        level: Math.max(1, Math.floor(num(raw.level, 1))),
        combo: Math.max(0, Math.floor(num(raw.combo, 0))),
        comboAt: Math.max(0, num(raw.comboAt, 0)),
        best: Math.max(0, Math.floor(num(raw.best, 0))),
        totalDone: Math.max(0, Math.floor(num(raw.totalDone, 0))),
      };
    }

    function sanitizeState(raw) {
      if (!raw || typeof raw !== 'object' || typeof raw.updatedAt !== 'number' || !Array.isArray(raw.tasks)) return emptyState();
      return {
        updatedAt: raw.updatedAt,
        tasks: raw.tasks.filter(isValidTask).map(function (x) {
          return Object.assign({}, x, { due: typeof x.due === 'number' ? x.due : null });
        }),
        player: sanitizePlayer(raw.player),
      };
    }

    // -------- xp economy --------

    function levelThreshold(level) { return LEVEL_STEP * level; }

    function comboMultiplier(combo) {
      return Math.min(1 + COMBO_STEP * Math.max(0, combo - 1), COMBO_MAX);
    }

    function xpForTask(priority, combo) {
      return Math.round(XP_BASE[priority] * comboMultiplier(combo));
    }

    // Apply one kill's xp; returns { player, gained, leveled }.
    function applyKill(player, priority, now) {
      const chained = now - player.comboAt <= COMBO_WINDOW;
      const combo = chained ? player.combo + 1 : 1;
      const gained = xpForTask(priority, combo);
      let xp = player.xp + gained;
      let level = player.level;
      let leveled = false;
      while (xp >= levelThreshold(level)) {
        xp -= levelThreshold(level);
        level++;
        leveled = true;
      }
      return {
        player: {
          xp: xp,
          level: level,
          combo: combo,
          comboAt: now,
          best: Math.max(player.best, combo),
          totalDone: player.totalDone + 1,
        },
        gained: gained,
        leveled: leveled,
      };
    }

    // -------- deadline presets --------

    function tonight(now) {
      const d = new Date(now);
      d.setHours(21, 0, 0, 0);
      if (d.getTime() <= now) d.setDate(d.getDate() + 1);
      return d.getTime();
    }
    function tomorrow(now) {
      const d = new Date(tonight(now));
      d.setDate(d.getDate() + 1);
      return d.getTime();
    }

    // Cycle index per task: 0 none, 1 +2h, 2 tonight, 3 tomorrow.
    // Classify by bucket, not by exact equality: a "+2h" deadline assigned at
    // 10:00 must still advance to "tonight" when the chip is clicked at 10:30,
    // so any deadline inside the next two hours counts as the +2h bucket.
    function nextDue(current, now) {
      const night = tonight(now);
      const tom = tomorrow(now);
      if (current === null) return now + 2 * 3600000;
      if (Math.abs(current - night) < 60000) return tom;
      if (current > now && current <= now + 2 * 3600000 + 60000) return night;
      return null;
    }

    function dueText(due, now, t) {
      if (due === null) return t('ddlNone');
      const diff = due - now;
      if (diff < 0) {
        const late = -diff;
        const h = Math.floor(late / 3600000);
        if (h >= 24) return t('overdue') + ' ' + Math.floor(h / 24) + 'd';
        if (h >= 1) return t('overdue') + ' ' + h + 'h';
        return t('overdue') + ' ' + Math.max(1, Math.floor(late / 60000)) + 'm';
      }
      const h = Math.floor(diff / 3600000);
      if (h >= 24) return Math.floor(h / 24) + 'd';
      if (h >= 1) return h + 'h';
      return Math.max(1, Math.floor(diff / 60000)) + 'm';
    }

    // -------- sound: synthesized, no assets --------

    let audioCtx = null;
    function audio() {
      if (audioCtx === null) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        audioCtx = new AC();
      }
      if (audioCtx.state === 'suspended') audioCtx.resume();
      return audioCtx;
    }
    function tone(freq, at, dur, type, peak) {
      const ac = audio();
      if (!ac) return;
      const t0 = ac.currentTime + at;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }
    function playKill(combo) {
      const pitch = Math.min(1 + 0.12 * Math.max(0, combo - 1), 1.7);
      tone(760 * pitch, 0, 0.09, 'triangle', 0.10);
      tone(1140 * pitch, 0.055, 0.14, 'sine', 0.08);
    }
    function playLevelUp() {
      [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) {
        tone(f, i * 0.085, 0.2, 'triangle', 0.09);
        tone(f * 2, i * 0.085, 0.12, 'sine', 0.04);
      });
    }
    function playUnmute() {
      tone(880, 0, 0.08, 'sine', 0.07);
      tone(1320, 0.07, 0.1, 'sine', 0.06);
    }

    // ---------- presentational pieces ----------

    function ProgressBar(props) {
      const pct = props.total === 0 ? 0 : Math.round((props.done / props.total) * 100);
      return h('div', { className: 'nt-progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct, 'aria-label': props.label },
        h('div', { className: 'nt-progress-track' },
          h('div', { className: 'nt-progress-fill', style: { width: pct + '%' } })),
        h('span', { className: 'nt-progress-num' }, pct + '%')
      );
    }

    function CheckGlyph() {
      return h('svg', { width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': true, style: { display: 'block' } },
        h('path', { d: 'M2.2 6.4 L4.9 9.1 L9.8 2.9', fill: 'none', stroke: '#ffff00', strokeWidth: 2, strokeLinecap: 'square', strokeLinejoin: 'miter' })
      );
    }

    function PriorityTag(props) {
      const label = props.value === 0 ? '--' : 'P' + props.value;
      const name = props.t('prio' + props.value);
      return h('button', {
        type: 'button',
        className: 'nt-prio nt-prio-' + props.value,
        onClick: props.onCycle,
        title: name,
        'aria-label': name + ' · ' + props.taskText,
      }, label);
    }

    function DueChip(props) {
      return h('button', {
        type: 'button',
        className: 'nt-due' + (props.overdue ? ' nt-due-over' : '') + (props.due === null ? ' nt-due-none' : ''),
        title: props.t('ddlCycles') + ' · ' + props.t('dueLabel'),
        'aria-label': props.t('ddlCycles') + ' · ' + props.text,
        onClick: props.onCycle,
      }, props.text);
    }

    function TaskRow(props) {
      const t = props.t;
      const task = props.task;
      const isEditing = props.editing;
      const done = task.done;
      const overdue = !done && task.due !== null && task.due < props.now;

      const editInputRef = React.useRef(null);
      React.useEffect(function () {
        if (isEditing && editInputRef.current) {
          editInputRef.current.focus();
          editInputRef.current.select();
        }
      }, [isEditing]);

      const commitEdit = React.useCallback(function () {
        const value = props.editDraft.trim();
        if (value === '') { props.onCancelEdit(); return; }
        props.onCommitEdit(task.id, value);
      }, [props, task.id]);

      const onEditKey = function (e) {
        if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); props.onCancelEdit(); }
      };

      const textEl = isEditing
        ? h('input', {
          ref: editInputRef,
          className: 'nt-edit',
          value: props.editDraft,
          onChange: function (e) { props.onEditDraft(e.target.value); },
          onKeyDown: onEditKey,
          onBlur: commitEdit,
          'aria-label': t('editPlaceholder'),
        })
        : h('span', { className: 'nt-text' }, task.text);

      const created = new Date(task.createdAt);
      const stamp = done && task.completedAt
        ? t('doneLabel') + ' ' + clockText(new Date(task.completedAt))
        : '+' + clockText(created);

      return h('li', {
        className: 'nt-row' + (done ? ' nt-row-done' : '') + (overdue ? ' nt-row-over' : '') + (props.justDone ? ' nt-row-pop' : ''),
        role: 'listitem',
      },
        h('button', {
          type: 'button',
          className: 'nt-check',
          role: 'checkbox',
          'aria-checked': done,
          'aria-label': done ? t('markOpen') : t('markDone'),
          onClick: function () { props.onToggle(task.id); },
        }, done ? h(CheckGlyph) : null),
        h('div', { className: 'nt-main' },
          textEl,
          h('span', { className: 'nt-stamp', title: t('createdLabel') + ' +' + clockText(created) }, stamp)
        ),
        h(DueChip, {
          due: task.due,
          text: dueText(task.due, props.now, t),
          overdue: overdue,
          t: t,
          onCycle: function () { props.onCycleDue(task.id); },
        }),
        h(PriorityTag, { value: task.priority, onCycle: function () { props.onCyclePriority(task.id); }, t: t, taskText: task.text }),
        h('div', { className: 'nt-actions' },
          h('button', { type: 'button', className: 'nt-iconbtn', 'aria-label': t('edit'), title: t('edit'), onClick: function () { props.onStartEdit(task.id); } }, '\u270e'),
          h('button', { type: 'button', className: 'nt-iconbtn nt-iconbtn-del', 'aria-label': t('remove'), title: t('remove'), onClick: function () { props.onRemove(task.id); } }, '\u00d7')
        ),
        props.justDone && props.gained > 0 ? h('span', { className: 'nt-xpfloat', 'aria-hidden': true }, '+' + props.gained + ' XP') : null
      );
    }

    // ---------- main widget ----------

    function App(props) {
      const t = props.t;
      const locale = props.locale;

      const [, force] = React.useReducer(function (x) { return x + 1; }, 0);
      React.useEffect(function () {
        if (locale && typeof locale.subscribe === 'function') return locale.subscribe(function () { force(); });
        return undefined;
      }, [locale]);

      // Boot once: prefer the durable host copy; keep the local copy when it
      // is newer (e.g. the app was used while the host route was down).
      const bootRef = React.useRef(null);
      if (bootRef.current === null) {
        let local = readJSON(STATE_KEY);
        if (!local) local = readJSON(LEGACY_STATE_KEY);
        const ui = readJSON(UI_KEY) || {};
        bootRef.current = {
          local: sanitizeState(local),
          expanded: !!ui.expanded,
          pos: (ui.pos && typeof ui.pos.x === 'number' && typeof ui.pos.y === 'number') ? ui.pos : null,
          muted: !!ui.muted,
        };
      }
      const boot = bootRef.current;

      const [tasks, setTasks] = React.useState(boot.local.tasks);
      const [player, setPlayer] = React.useState(boot.local.player);
      const [filter, setFilter] = React.useState('all');
      const [input, setInput] = React.useState('');
      const [inputError, setInputError] = React.useState(false);
      const [ddlPick, setDdlPick] = React.useState(0);
      const [expanded, setExpanded] = React.useState(boot.expanded);
      const [pos, setPos] = React.useState(boot.pos);
      const [sync, setSync] = React.useState('loading');
      const [clock, setClock] = React.useState(function () { return clockText(new Date()); });
      const [purgeArmed, setPurgeArmed] = React.useState(false);
      const [editingId, setEditingId] = React.useState(null);
      const [editDraft, setEditDraft] = React.useState('');
      const [justDone, setJustDone] = React.useState(null);
      const [gained, setGained] = React.useState(0);
      const [levelToast, setLevelToast] = React.useState(null);
      const [muted, setMuted] = React.useState(boot.muted);
      const [now, setNow] = React.useState(function () { return Date.now(); });

      const rootRef = React.useRef(null);
      const inputRef = React.useRef(null);
      const dragStateRef = React.useRef(null);
      const dragMovedRef = React.useRef(false);
      const purgeTimerRef = React.useRef(null);
      const firstRenderRef = React.useRef(true);
      const mutatedRef = React.useRef(false);
      const skipPushRef = React.useRef(false);
      const expandedByUserRef = React.useRef(false);
      const mutedRef = React.useRef(muted);
      const toastTimerRef = React.useRef(null);
      const justDoneTimerRef = React.useRef(null);
      mutedRef.current = muted;

      // Boot fetch from the host route.
      React.useEffect(function () {
        let dead = false;
        const ctl = new AbortController();
        const timer = setTimeout(function () { ctl.abort(); }, 4000);
        fetch(API, { signal: ctl.signal, headers: { accept: 'application/json' } })
          .then(function (r) { if (!r.ok) throw new Error('status ' + r.status); return r.json(); })
          .then(function (server) {
            clearTimeout(timer);
            if (dead) return;
            if (!server || typeof server.updatedAt !== 'number' || !Array.isArray(server.tasks)) throw new Error('bad payload');
            if (!mutatedRef.current && server.updatedAt >= boot.local.updatedAt) {
              skipPushRef.current = true;
              setTasks(server.tasks.map(function (x) { return Object.assign({}, x, { due: typeof x.due === 'number' ? x.due : null }); }));
              setPlayer(sanitizePlayer(server.player));
            }
            setSync('ok');
          })
          .catch(function () {
            clearTimeout(timer);
            if (dead) return;
            setSync('local');
          });
        return function () { dead = true; ctl.abort(); clearTimeout(timer); };
      }, [boot.local.updatedAt]);

      // One-second tick drives the clock and deadline countdowns.
      React.useEffect(function () {
        const id = setInterval(function () {
          setClock(clockText(new Date()));
          setNow(Date.now());
        }, 1000);
        return function () { clearInterval(id); };
      }, []);

      // Persist: local mirror always; debounced write-through to the host.
      React.useEffect(function () {
        if (firstRenderRef.current) { firstRenderRef.current = false; return; }
        const state = { updatedAt: Date.now(), tasks: tasks, player: player };
        writeJSON(STATE_KEY, state);
        if (skipPushRef.current) { skipPushRef.current = false; return; }
        const id = setTimeout(function () {
          fetch(API, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(state),
          })
            .then(function (r) { setSync(r.ok ? 'ok' : 'local'); })
            .catch(function () { setSync('local'); });
        }, 300);
        return function () { clearTimeout(id); };
      }, [tasks, player]);

      // Persist UI chrome.
      React.useEffect(function () {
        writeJSON(UI_KEY, { expanded: expanded, pos: pos, muted: muted });
      }, [expanded, pos, muted]);

      // Focus the entry line when the user opens the panel (not on reload).
      React.useEffect(function () {
        if (expanded && expandedByUserRef.current) {
          expandedByUserRef.current = false;
          if (inputRef.current) inputRef.current.focus();
        }
      }, [expanded]);

      // Timers owned by the plugin's lifetime.
      React.useEffect(function () {
        return function () {
          if (purgeTimerRef.current) clearTimeout(purgeTimerRef.current);
          if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
          if (justDoneTimerRef.current) clearTimeout(justDoneTimerRef.current);
        };
      }, []);

      const active = tasks.filter(function (x) { return !x.done; }).sort(function (a, b) {
        const ao = a.due !== null && a.due < now ? 0 : 1;
        const bo = b.due !== null && b.due < now ? 0 : 1;
        return (ao - bo) || (b.priority - a.priority) || (a.createdAt - b.createdAt);
      });
      const done = tasks.filter(function (x) { return x.done; }).sort(function (a, b) {
        return ((b.completedAt || 0) - (a.completedAt || 0)) || (a.createdAt - b.createdAt);
      });
      const visible = filter === 'all' ? active.concat(done) : (filter === 'active' ? active : done);
      const overdueCount = active.filter(function (x) { return x.due !== null && x.due < now; }).length;

      // -------- mutations --------

      function addTask() {
        const text = input.trim();
        if (text === '') {
          setInputError(true);
          setTimeout(function () { setInputError(false); }, 320);
          return;
        }
        if (tasks.length >= MAX_TASKS) return;
        mutatedRef.current = true;
        const due = ddlPick === 1 ? now + 2 * 3600000 : ddlPick === 2 ? tonight(now) : ddlPick === 3 ? tomorrow(now) : null;
        setTasks(function (xs) {
          return xs.concat([{ id: newId(), text: text, done: false, priority: 0, createdAt: Date.now(), completedAt: null, due: due, killed: false }]);
        });
        setInput('');
        setDdlPick(0);
        setFilter(function (f) { return f === 'done' ? 'all' : f; });
        if (inputRef.current) inputRef.current.focus();
      }

      function toggleTask(id) {
        mutatedRef.current = true;
        const task = tasks.find(function (x) { return x.id === id; });
        if (!task) return;
        if (task.done) {
          // Re-opening a task only undoes the checkbox; xp already dropped.
          setTasks(function (xs) {
            return xs.map(function (x) { return x.id === id ? Object.assign({}, x, { done: false, completedAt: null }) : x; });
          });
          return;
        }
        const firstKill = !task.killed;
        const nowMs = Date.now();
        let result = null;
        setTasks(function (xs) {
          return xs.map(function (x) {
            if (x.id !== id) return x;
            return Object.assign({}, x, { done: true, completedAt: nowMs, killed: true });
          });
        });
        if (firstKill) {
          result = applyKill(player, task.priority, nowMs);
          setPlayer(result.player);
        }
        setJustDone(id);
        setGained(result === null ? 0 : result.gained);
        if (!mutedRef.current) playKill(result === null ? 1 : result.player.combo);
        if (justDoneTimerRef.current) clearTimeout(justDoneTimerRef.current);
        justDoneTimerRef.current = setTimeout(function () { setJustDone(function (cur) { return cur === id ? null : cur; }); }, 900);
        if (result !== null && result.leveled) {
          setLevelToast({ level: result.player.level, at: nowMs });
          if (!mutedRef.current) playLevelUp();
          if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
          toastTimerRef.current = setTimeout(function () { setLevelToast(null); }, 1900);
        }
      }

      function cyclePriority(id) {
        mutatedRef.current = true;
        setTasks(function (xs) {
          return xs.map(function (x) {
            if (x.id !== id) return x;
            return Object.assign({}, x, { priority: (x.priority + 1) % 4 });
          });
        });
      }

      function cycleDue(id) {
        mutatedRef.current = true;
        setTasks(function (xs) {
          return xs.map(function (x) {
            if (x.id !== id) return x;
            return Object.assign({}, x, { due: nextDue(x.due, Date.now()) });
          });
        });
      }

      function removeTask(id) {
        mutatedRef.current = true;
        setEditingId(function (e) { return e === id ? null : e; });
        setTasks(function (xs) { return xs.filter(function (x) { return x.id !== id; }); });
      }

      function startEdit(id) {
        const task = tasks.find(function (x) { return x.id === id; });
        if (!task) return;
        setEditingId(id);
        setEditDraft(task.text);
      }

      function commitEdit(id, value) {
        mutatedRef.current = true;
        setTasks(function (xs) {
          return xs.map(function (x) { return x.id === id ? Object.assign({}, x, { text: value }) : x; });
        });
        setEditingId(null);
      }

      function cancelEdit() { setEditingId(null); }

      function purgeDone() {
        if (!purgeArmed) {
          setPurgeArmed(true);
          purgeTimerRef.current = setTimeout(function () { setPurgeArmed(false); }, 3200);
          return;
        }
        if (purgeTimerRef.current) clearTimeout(purgeTimerRef.current);
        setPurgeArmed(false);
        mutatedRef.current = true;
        setTasks(function (xs) { return xs.filter(function (x) { return !x.done; }); });
      }

      function toggleMute() {
        const next = !muted;
        setMuted(next);
        if (!next) playUnmute();
      }

      // -------- drag / collapse --------
      function onDragDown(e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        dragMovedRef.current = false;
        const r = rootRef.current;
        if (!r) return;
        const rect = r.getBoundingClientRect();
        dragStateRef.current = { sx: e.clientX, sy: e.clientY, bx: rect.left, by: rect.top };
        if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId);
      }
      function onDragMove(e) {
        const st = dragStateRef.current;
        if (!st) return;
        const dx = e.clientX - st.sx;
        const dy = e.clientY - st.sy;
        if (Math.abs(dx) + Math.abs(dy) > 4) dragMovedRef.current = true;
        const r = rootRef.current;
        if (!r) return;
        const w = r.offsetWidth || 0;
        const hh = r.offsetHeight || 0;
        const minY = expanded ? 19 : 8;
        setPos({
          x: clamp(st.bx + dx, 8, Math.max(8, window.innerWidth - w - 8)),
          y: clamp(st.by + dy, minY, Math.max(minY, window.innerHeight - hh - 8)),
        });
      }
      function onDragUp() { dragStateRef.current = null; }
      function clickToggle() {
        if (dragMovedRef.current) return;
        setExpanded(function (v) {
          if (!v) expandedByUserRef.current = true;
          return !v;
        });
      }
      function onKeyToggle(e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); clickToggle(); }
      }

      React.useLayoutEffect(function () {
        if (pos && rootRef.current) {
          const r = rootRef.current.getBoundingClientRect();
          const minY = expanded ? 19 : 8;
          const x = clamp(pos.x, 8, Math.max(8, window.innerWidth - r.width - 8));
          const y = clamp(pos.y, minY, Math.max(minY, window.innerHeight - r.height - 8));
          if (x !== pos.x || y !== pos.y) setPos({ x: x, y: y });
        }
      }, [expanded]);

      const dragProps = { onPointerDown: onDragDown, onPointerMove: onDragMove, onPointerUp: onDragUp, onPointerCancel: onDragUp };

      const openCount = active.length;
      const doneCount = done.length;
      const total = tasks.length;
      const syncText = sync === 'ok' ? t('syncOk') : sync === 'local' ? t('syncLocal') : t('syncLoading');
      const syncClass = sync === 'ok' ? 'nt-sync-ok' : 'nt-sync-warn';
      const xpNeed = levelThreshold(player.level);
      const xpPct = Math.min(100, Math.round((player.xp / xpNeed) * 100));
      const comboLive = player.combo > 1 && now - player.comboAt <= COMBO_WINDOW;
      const mult = comboLive ? comboMultiplier(player.combo) : 1;

      function collapsedView() {
        // The open circle is a HUD token, not a candy ball: a conic XP ring
        // wraps a dark glass core. Saturation lives in the ring only.
        const ringPct = Math.max(2, xpPct); // keep a hairline of progress visible at 0
        return h('div', Object.assign({
          ref: rootRef,
          className: 'nt-root nt-node' + (overdueCount > 0 ? ' nt-node-alarm' : ''),
          role: 'button',
          tabIndex: 0,
          onClick: clickToggle,
          onKeyDown: onKeyToggle,
          'aria-label': t('title') + ' · ' + openCount + ' ' + t('openLabel') + (overdueCount > 0 ? ' · ' + overdueCount + ' ' + t('overdue') : ''),
          'aria-expanded': expanded,
          style: {
            background: 'conic-gradient(from -90deg, #00ff88 0% ' + ringPct + '%, rgba(117,117,117,.3) ' + ringPct + '% 100%)',
          },
        }, dragProps),
          h('div', { className: 'nt-node-core' },
            h('span', { className: 'nt-node-count' + (overdueCount > 0 ? ' nt-node-count-alarm' : '') }, String(openCount)),
            h('span', { className: 'nt-node-label' + (overdueCount > 0 ? ' nt-node-label-on' : '') }, overdueCount > 0 ? '!' : '')
          )
        );
      }

      function expandedView() {
        const emptyText = filter === 'all' ? t('emptyAll') : filter === 'active' ? t('emptyActive') : t('emptyDone');
        return h('div', {
          ref: rootRef,
          className: 'nt-root nt-panel',
          role: 'region',
          'aria-label': t('title'),
        },
          h('div', { className: 'nt-back nt-back-1', 'aria-hidden': true }),
          h('div', { className: 'nt-back nt-back-2', 'aria-hidden': true }),
          h('div', { className: 'nt-tab', 'aria-hidden': true },
            h('span', { className: 'nt-tab-lv' }, 'LV ' + player.level),
            h('span', { className: 'nt-tab-dot nt-tab-dot-y' }),
            h('span', { className: 'nt-tab-dot nt-tab-dot-r' })
          ),
          h('div', { className: 'nt-metal' },
            h('div', { className: 'nt-glass' },
              h('div', Object.assign({ className: 'nt-head', onClick: clickToggle }, dragProps),
                h('div', { className: 'nt-headtext' },
                  h('span', { className: 'nt-title' }, t('headerTitle')),
                  h('span', { className: 'nt-sub' },
                    h('span', { className: 'nt-sub-en' }, t('headerSub')),
                    h('span', { className: 'nt-sub-sep', 'aria-hidden': true }, '·'),
                    h('span', { className: 'nt-sub-en nt-sub-track' }, t('headerSubEn'))
                  )
                ),
                h('span', { className: 'nt-spacer' }),
                comboLive ? h('span', { className: 'nt-combo', title: t('combo') + ' ×' + mult.toFixed(2) }, '×' + mult.toFixed(2)) : null,
                h('span', { className: 'nt-cursor', 'aria-hidden': true }),
                h('button', {
                  type: 'button',
                  className: 'nt-iconbtn nt-headbtn',
                  'aria-label': t('collapse'),
                  onClick: function (e) { e.stopPropagation(); setExpanded(false); },
                }, '\u2212')
              ),
              // xp bar: the level progress is the pulse of the widget
              h('div', { className: 'nt-xpline', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': xpNeed, 'aria-valuenow': player.xp, 'aria-label': t('level') + ' ' + player.level + ' · ' + t('xp') + ' ' + player.xp + '/' + xpNeed },
                h('div', { className: 'nt-xpbar' },
                  h('div', { className: 'nt-xpfill', style: { width: xpPct + '%' } })),
                h('span', { className: 'nt-xpnum', 'aria-hidden': true }, player.xp + '/' + xpNeed)
              ),
              h('div', { className: 'nt-statusline' },
                h('span', null, t('openLabel').toUpperCase() + ' ' + openCount + ' · ' + t('doneLabel').toUpperCase() + ' ' + doneCount + (player.best > 1 ? ' · BEST ×' + player.best : '')),
                h('span', { className: 'nt-spacer' }),
                h('span', { className: syncClass }, syncText),
                h('span', { className: 'nt-clock', 'aria-hidden': true }, clock)
              ),
              h('div', { className: 'nt-entry' + (inputError ? ' nt-entry-err' : '') },
                h('span', { className: 'nt-prompt', 'aria-hidden': true }, '+'),
                h('input', {
                  ref: inputRef,
                  className: 'nt-input',
                  value: input,
                  placeholder: t('inputPlaceholder'),
                  'aria-label': t('inputPlaceholder'),
                  onChange: function (e) { setInput(e.target.value); },
                  onKeyDown: function (e) { if (e.key === 'Enter') { e.preventDefault(); addTask(); } },
                  maxLength: 400,
                })
              ),
              h('div', { className: 'nt-ddlpick', role: 'group', 'aria-label': t('ddlCycles') },
                [t('ddlNone'), t('ddl2h'), t('ddlTonight'), t('ddlTomorrow')].map(function (label, i) {
                  return h('button', {
                    key: label,
                    type: 'button',
                    'aria-pressed': ddlPick === i,
                    className: 'nt-ddlchip' + (ddlPick === i ? ' nt-ddlchip-on' : ''),
                    onClick: function () { setDdlPick(i); },
                  }, label);
                })
              ),
              h('div', { className: 'nt-filters', role: 'group', 'aria-label': 'filter' },
                [['all', t('all')], ['active', t('active')], ['done', t('done')]].map(function (pair) {
                  return h('button', {
                    key: pair[0],
                    type: 'button',
                    'aria-pressed': filter === pair[0],
                    className: 'nt-filter' + (filter === pair[0] ? ' nt-filter-on' : ''),
                    onClick: function () { setFilter(pair[0]); },
                  }, pair[1].toUpperCase());
                })
              ),
              h('ul', { className: 'nt-list', role: 'list', 'aria-label': t('taskCount') + ': ' + total },
                visible.length === 0
                  ? h('li', { className: 'nt-empty', role: 'listitem' }, h('span', { className: 'nt-empty-txt' }, emptyText), h('span', { className: 'nt-cursor', 'aria-hidden': true }))
                  : visible.map(function (task) {
                    return h(TaskRow, {
                      key: task.id,
                      task: task,
                      t: t,
                      now: now,
                      editing: editingId === task.id,
                      editDraft: editDraft,
                      justDone: justDone === task.id,
                      gained: gained,
                      onToggle: toggleTask,
                      onCyclePriority: cyclePriority,
                      onCycleDue: cycleDue,
                      onRemove: removeTask,
                      onStartEdit: startEdit,
                      onCommitEdit: commitEdit,
                      onCancelEdit: cancelEdit,
                      onEditDraft: setEditDraft,
                    });
                  })
              ),
              h('div', { className: 'nt-foot' },
                h(ProgressBar, { total: total, done: doneCount, label: t('completion') }),
                h('button', {
                  type: 'button',
                  className: 'nt-sound',
                  'aria-pressed': !muted,
                  'aria-label': muted ? t('soundOff') : t('soundOn'),
                  title: muted ? t('soundOff') : t('soundOn'),
                  onClick: toggleMute,
                }, '\u266a'),
                h('button', {
                  type: 'button',
                  className: 'nt-purge' + (purgeArmed ? ' nt-purge-armed' : ''),
                  disabled: doneCount === 0 && !purgeArmed,
                  onClick: purgeDone,
                }, purgeArmed ? t('purgeConfirm') : t('purge'))
              )
            )
          ),
          levelToast !== null ? h('div', { className: 'nt-levelup', role: 'status', 'aria-live': 'assertive' },
            h('span', { className: 'nt-levelup-k' }, t('levelUp')),
            h('span', { className: 'nt-levelup-lv' }, 'LV ' + levelToast.level)
          ) : null
        );
      }

      return h(React.Fragment, null,
        h('style', null, CSS),
        h('div', {
          className: 'nt-anchor',
          style: pos ? { left: pos.x, top: pos.y } : { right: 24, bottom: 84 },
        }, expanded ? expandedView() : collapsedView())
      );
    }

    const CSS = [
      // ---- palette & base ----
      // Strict scheme: #00ff88 spring green / #757575 gray / #ffff00 yellow.
      // Depth comes from shading the green hue and translucent white glass;
      // shadows use deep forest neutral, never pure black, no blue anywhere.
      '.nt-anchor{position:fixed;z-index:100000;pointer-events:auto;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","PingFang SC","Helvetica Neue","Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;line-height:1.5}',
      '.nt-root{--nt-green:#00ff88;--nt-yellow:#ffff00;--nt-gray:#757575;--nt-ink:#eef7f1;--nt-dim:#a9b8af;--nt-faint:#8b9d93;--nt-shadow:rgba(6,16,11,.55);font-size:13.5px;color:var(--nt-ink);box-sizing:border-box}',
      '.nt-root *,.nt-root *::before,.nt-root *::after{box-sizing:border-box}',
      // ---- collapsed node: HUD token (XP ring + dark glass core) ----
      // A saturated ball with a big white glint reads as chewing gum at this
      // size; the token keeps saturation in a 2.5px ring and the core dark.
      '.nt-node{position:relative;width:56px;height:56px;border-radius:50%;padding:2.5px;display:flex;cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none;box-shadow:0 8px 20px var(--nt-shadow),0 0 0 1px rgba(117,117,117,.35),0 0 16px rgba(0,255,136,.2);transition:transform .18s ease,box-shadow .18s ease}',
      '.nt-node:hover{transform:translateY(-1px) scale(1.03);box-shadow:0 10px 24px var(--nt-shadow),0 0 0 1px rgba(117,117,117,.45),0 0 22px rgba(0,255,136,.4)}',
      '.nt-node:active{cursor:grabbing}',
      '.nt-node-core{flex:1;min-width:0;border-radius:50%;position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1;overflow:hidden;background:radial-gradient(circle at 50% 30%,rgba(255,255,255,.10),rgba(255,255,255,0) 58%),linear-gradient(165deg,rgba(0,255,136,.14) 0%,rgba(14,22,17,.92) 55%,rgba(8,19,13,.96) 100%);border:1px solid rgba(117,117,117,.55);box-shadow:inset 0 1px 1px rgba(255,255,255,.35),inset 0 -5px 10px rgba(4,20,12,.6)}',
      '.nt-node-core::after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(0deg,rgba(117,117,117,.07) 0 1px,transparent 1px 3px);pointer-events:none}',
      '.nt-node-count{position:relative;z-index:1;font-size:16px;font-weight:800;color:var(--nt-green);text-shadow:0 0 10px rgba(0,255,136,.6),0 1px 0 rgba(4,20,12,.7)}',
      '.nt-node-count-alarm{color:var(--nt-yellow);text-shadow:0 0 10px rgba(255,255,0,.65),0 1px 0 rgba(4,20,12,.7)}',
      '.nt-node-label{position:relative;z-index:1;font-size:9px;line-height:1;color:var(--nt-yellow);margin-top:2px;font-weight:800;letter-spacing:.02em;text-shadow:0 0 7px rgba(255,255,0,.7)}',
      '.nt-node-label:empty{margin-top:0;height:0}',
      '.nt-node-alarm{animation:nt-alarm 1.6s ease-in-out infinite}',
      // ---- expanded: folder of stacked glass cards ----
      '.nt-panel{width:340px;max-width:calc(100vw - 24px);position:relative;animation:nt-boot .24s cubic-bezier(.2,.9,.3,1)}',
      '.nt-back{position:absolute;inset:0;border-radius:16px;border:1px solid rgba(117,117,117,.55);background:linear-gradient(160deg,rgba(0,255,136,.09) 0%,rgba(26,18,24,.9) 60%),rgba(26,18,24,.82);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);pointer-events:none;box-shadow:0 10px 24px var(--nt-shadow),inset 0 1px 0 rgba(255,255,255,.12)}',
      '.nt-back-1{transform:rotate(-1.8deg) translate(-5px,-4px);opacity:.9}',
      '.nt-back-2{transform:rotate(1.4deg) translate(5px,3px);opacity:.55}',
      // folder index tab = level badge
      '.nt-tab{position:absolute;top:-11px;left:16px;height:22px;border-radius:7px 7px 0 0;background:linear-gradient(180deg,#4dffb0 0%,#7dffc2 40%,#00ff88 70%,#08a463 100%);display:flex;align-items:center;gap:7px;padding:0 12px;z-index:6;pointer-events:none;box-shadow:0 -3px 10px rgba(0,255,136,.4),inset 0 1px 0 rgba(255,255,255,.55),inset 0 -1px 0 rgba(6,16,11,.3)}',
      '.nt-tab::after{content:"";position:absolute;left:1px;right:1px;bottom:-1px;height:1.5px;background:linear-gradient(90deg,var(--nt-gray),var(--nt-green),var(--nt-gray));opacity:.85}',
      '.nt-tab-lv{font-size:10px;font-weight:800;letter-spacing:.1em;color:#08130d}',
      '.nt-tab-dot{width:5px;height:5px;border-radius:50%;flex:none}',
      '.nt-tab-dot-y{background:var(--nt-yellow);box-shadow:0 0 5px rgba(255,255,0,.9)}',
      '.nt-tab-dot-r{background:var(--nt-gray)}',
      // metallic rim wrapping the glass
      '.nt-metal{position:relative;padding:1.5px;border-radius:16px;background:linear-gradient(150deg,var(--nt-green) 0%,rgba(0,255,136,.45) 20%,var(--nt-gray) 42%,rgba(255,255,255,.78) 50%,var(--nt-gray) 58%,rgba(255,255,0,.6) 78%,var(--nt-green) 100%);box-shadow:0 16px 38px var(--nt-shadow),0 3px 8px rgba(6,16,11,.4),0 0 22px rgba(0,255,136,.16)}',
      '.nt-glass{position:relative;border-radius:14.5px;background:linear-gradient(155deg,rgba(0,255,136,.16) 0%,rgba(255,255,255,.08) 26%,rgba(255,255,0,.05) 54%,rgba(0,255,136,.12) 100%),rgba(26,18,24,.7);backdrop-filter:blur(14px) saturate(1.25);-webkit-backdrop-filter:blur(14px) saturate(1.25);box-shadow:inset 0 1px 0 rgba(255,255,255,.34),inset 0 -1px 0 rgba(6,16,11,.5),inset 1px 0 0 rgba(255,255,255,.14),inset -1px 0 0 rgba(6,16,11,.3);overflow:hidden}',
      '.nt-glass::before{content:"";position:absolute;inset:0;pointer-events:none;z-index:1;background:linear-gradient(112deg,transparent 43%,rgba(255,255,255,.12) 48%,transparent 53%),radial-gradient(130% 70% at 10% 0%,rgba(255,255,255,.14),transparent 42%)}',
      '.nt-glass::after{content:"";position:absolute;inset:0;pointer-events:none;z-index:1;background:repeating-linear-gradient(0deg,rgba(117,117,117,.06) 0 1px,transparent 1px 3px)}',
      '.nt-head{position:relative;z-index:2;display:flex;align-items:center;gap:8px;padding:12px 14px 9px;cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none;background:linear-gradient(180deg,rgba(255,255,255,.06),transparent 70%);border-bottom:1px solid rgba(117,117,117,.3)}',
      '.nt-head:active{cursor:grabbing}',
      '.nt-headtext{display:flex;flex-direction:column;gap:1px;min-width:0}',
      // liquid-glass + metal 3D title in the Apple display face
      '.nt-title{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","PingFang SC","Helvetica Neue","Segoe UI",sans-serif;font-size:21px;font-weight:800;letter-spacing:0;line-height:1.1;background:linear-gradient(180deg,#ffffff 0%,#e6fff6 26%,#7dffc2 52%,#00ff88 74%,#b3ffdb 100%);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-stroke:.6px rgba(0,90,48,.85);filter:drop-shadow(0 1px 0 rgba(255,255,255,.34)) drop-shadow(0 2px 1px rgba(6,16,11,.45)) drop-shadow(0 0 14px rgba(0,255,136,.4))}',
      '.nt-sub{display:flex;align-items:baseline;gap:6px;margin-top:2px;line-height:1.25;min-width:0}',
      '.nt-sub-en{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue","Segoe UI",sans-serif;font-size:12px;font-weight:700;letter-spacing:.01em;color:var(--nt-yellow);text-shadow:0 0 9px rgba(255,255,0,.5),0 1px 0 rgba(6,16,11,.5)}',
      '.nt-sub-sep{font-size:11px;color:#9a9a9a}',
      '.nt-sub-track{font-size:8px;font-weight:700;letter-spacing:.22em;color:#9a9a9a;text-shadow:0 1px 0 rgba(255,255,255,.22);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
      '.nt-cursor{width:7px;height:13px;background:var(--nt-yellow);animation:nt-blink 1.1s steps(2,start) infinite;box-shadow:0 0 8px rgba(255,255,0,.8);flex:none}',
      '.nt-spacer{flex:1}',
      '.nt-combo{padding:2px 7px;border:1px solid rgba(255,255,0,.65);border-radius:7px;font-size:10px;font-weight:800;letter-spacing:.06em;color:var(--nt-yellow);background:rgba(255,255,0,.1);text-shadow:0 0 7px rgba(255,255,0,.6);animation:nt-pop .22s cubic-bezier(.2,1.4,.4,1)}',
      // xp progress lives directly under the header
      '.nt-xpline{position:relative;z-index:2;display:flex;align-items:center;gap:8px;padding:6px 14px 0}',
      '.nt-xpbar{flex:1;height:4px;border-radius:2px;background:rgba(117,117,117,.22);box-shadow:inset 0 1px 2px rgba(6,16,11,.45);overflow:hidden}',
      '.nt-xpfill{height:100%;border-radius:2px;background:linear-gradient(180deg,#b3ffdb,#00ff88);box-shadow:0 0 8px rgba(0,255,136,.6),inset 0 1px 0 rgba(255,255,255,.45);transition:width .35s ease}',
      '.nt-xpnum{font-size:9px;font-weight:700;color:var(--nt-faint);letter-spacing:.04em;font-variant-numeric:tabular-nums}',
      '.nt-statusline{position:relative;z-index:2;display:flex;align-items:center;gap:10px;padding:5px 14px 0;font-size:10px;letter-spacing:.1em;color:var(--nt-dim);border-bottom:1px solid rgba(117,117,117,.2);padding-bottom:6px;white-space:nowrap;overflow:hidden}',
      '.nt-sync-ok{color:var(--nt-green);text-shadow:0 0 6px rgba(0,255,136,.45)}',
      '.nt-sync-warn{color:var(--nt-yellow);text-shadow:0 0 6px rgba(255,255,0,.5)}',
      '.nt-clock{color:var(--nt-faint);font-variant-numeric:tabular-nums}',
      '.nt-entry{position:relative;z-index:2;display:flex;align-items:center;gap:8px;margin:11px 14px 0;padding:8px 11px;border:1px solid rgba(117,117,117,.45);border-radius:9px;background:rgba(255,255,255,.05);box-shadow:inset 0 1px 0 rgba(255,255,255,.1);transition:border-color .12s ease,box-shadow .12s ease}',
      '.nt-entry:focus-within{border-color:rgba(0,255,136,.75);box-shadow:inset 0 1px 0 rgba(255,255,255,.1),0 0 0 1px rgba(0,255,136,.25),0 0 14px rgba(0,255,136,.18)}',
      '.nt-entry-err{border-color:var(--nt-yellow);animation:nt-shake .3s ease}',
      '.nt-prompt{color:var(--nt-green);font-weight:800;text-shadow:0 0 6px rgba(0,255,136,.6)}',
      '.nt-input{flex:1;background:transparent;border:none;outline:none;color:var(--nt-ink);font:inherit;padding:0}',
      '.nt-input::placeholder{color:var(--nt-faint)}',
      // deadline quick-pick row for the next task
      '.nt-ddlpick{position:relative;z-index:2;display:flex;gap:5px;padding:8px 14px 0}',
      '.nt-ddlchip{flex:1;padding:3px 0;background:rgba(255,255,255,.04);border:1px solid rgba(117,117,117,.35);border-radius:7px;color:var(--nt-dim);font:inherit;font-size:9.5px;letter-spacing:.03em;cursor:pointer;transition:color .12s ease,border-color .12s ease,background .12s ease}',
      '.nt-ddlchip:hover{color:var(--nt-green);border-color:rgba(0,255,136,.5)}',
      '.nt-ddlchip-on{background:rgba(0,255,136,.18);border-color:var(--nt-green);color:var(--nt-ink);box-shadow:0 0 9px rgba(0,255,136,.3)}',
      '.nt-filters{position:relative;z-index:2;display:flex;gap:6px;padding:9px 14px 0}',
      '.nt-filter{flex:1;padding:4px 0;background:rgba(255,255,255,.04);border:1px solid rgba(117,117,117,.4);border-radius:8px;color:var(--nt-dim);font:inherit;font-size:10.5px;letter-spacing:.12em;cursor:pointer;transition:color .12s ease,background .12s ease,box-shadow .12s ease}',
      '.nt-filter:hover{color:var(--nt-green);border-color:rgba(0,255,136,.5)}',
      '.nt-filter-on{background:linear-gradient(180deg,#7dffc2,#00ff88);border-color:var(--nt-green);color:#08130d;font-weight:800;box-shadow:inset 0 1px 0 rgba(255,255,255,.5),0 0 12px rgba(0,255,136,.5)}',
      '.nt-list{position:relative;z-index:2;list-style:none;margin:8px 14px 0;padding:0 0 4px;max-height:min(300px,max(140px,calc(100vh - 390px)));min-height:64px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:rgba(0,255,136,.4) transparent}',
      '.nt-list::-webkit-scrollbar{width:5px}',
      '.nt-list::-webkit-scrollbar-thumb{background:rgba(0,255,136,.35);border-radius:3px}',
      '.nt-list::-webkit-scrollbar-track{background:transparent}',
      '.nt-row{position:relative;display:flex;align-items:center;gap:8px;padding:6px 2px;border-bottom:1px dashed rgba(117,117,117,.25);animation:nt-glitchin .2s cubic-bezier(.2,.9,.3,1)}',
      '.nt-row:last-child{border-bottom:none}',
      '.nt-row-done .nt-text{color:var(--nt-faint);text-decoration:line-through;text-decoration-color:var(--nt-yellow);text-decoration-thickness:1.5px}',
      '.nt-row-over{border-bottom-color:rgba(0,255,136,.35)}',
      '.nt-row-pop{animation:nt-pop .28s cubic-bezier(.2,1.5,.4,1)}',
      '.nt-check{width:17px;height:17px;flex:none;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.06);border:1.5px solid rgba(117,117,117,.75);border-radius:50%;cursor:pointer;padding:0;box-shadow:inset 0 1px 0 rgba(255,255,255,.25),inset 0 -1px 1px rgba(6,16,11,.35);transition:border-color .12s ease,box-shadow .12s ease,transform .12s ease}',
      '.nt-check:hover{border-color:var(--nt-green);box-shadow:0 0 9px rgba(0,255,136,.45);transform:scale(1.06)}',
      '.nt-check:active{transform:scale(.92)}',
      '.nt-check[aria-checked="true"]{background:linear-gradient(180deg,#4dffb0 0%,#00ff88 70%,#0a8f57 100%);border-color:#4dffb0;box-shadow:inset 0 1px 0 rgba(255,255,255,.55),0 0 10px rgba(0,255,136,.6)}',
      '.nt-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}',
      '.nt-text{font-size:13px;color:var(--nt-ink);overflow-wrap:break-word;word-break:break-word}',
      '.nt-edit{background:rgba(0,255,136,.08);border:1px solid var(--nt-green);border-radius:6px;color:var(--nt-ink);font:inherit;font-size:13px;padding:2px 6px;outline:none;width:100%}',
      '.nt-stamp{font-size:9.5px;letter-spacing:.06em;color:var(--nt-faint);font-variant-numeric:tabular-nums}',
      '.nt-due{flex:none;min-width:30px;padding:1px 5px;font:inherit;font-size:9px;font-weight:700;letter-spacing:.04em;background:rgba(255,255,255,.04);border:1px solid rgba(117,117,117,.4);border-radius:6px;color:var(--nt-faint);cursor:pointer;white-space:nowrap}',
      '.nt-due:hover{border-color:var(--nt-green);color:var(--nt-green)}',
      '.nt-due-none{opacity:.55}',
      '.nt-due-over{border-color:rgba(0,255,136,.6);color:var(--nt-green);background:rgba(0,255,136,.1);text-shadow:0 0 6px rgba(0,255,136,.5)}',
      '.nt-prio{flex:none;min-width:26px;padding:1px 5px;font:inherit;font-size:9.5px;font-weight:800;letter-spacing:.06em;background:rgba(255,255,255,.04);border:1px solid rgba(117,117,117,.4);border-radius:6px;color:var(--nt-faint);cursor:pointer}',
      '.nt-prio:hover{border-color:currentColor}',
      '.nt-prio-1{color:var(--nt-yellow);border-color:rgba(255,255,0,.55);text-shadow:0 0 6px rgba(255,255,0,.45)}',
      '.nt-prio-2{color:var(--nt-green);border-color:rgba(0,255,136,.55);text-shadow:0 0 6px rgba(0,255,136,.45)}',
      '.nt-prio-3{color:#9a9a9a;border-color:rgba(117,117,117,.7)}',
      '.nt-actions{flex:none;display:flex;gap:2px;opacity:0;transition:opacity .12s ease}',
      '.nt-row:hover .nt-actions,.nt-row:focus-within .nt-actions{opacity:1}',
      '@media (hover:none){.nt-actions{opacity:1}}',
      '.nt-iconbtn{width:22px;height:22px;display:flex;align-items:center;justify-content:center;background:transparent;border:none;border-radius:6px;color:var(--nt-dim);font-size:12px;line-height:1;cursor:pointer;padding:0}',
      '.nt-iconbtn:hover{color:var(--nt-green);background:rgba(0,255,136,.12)}',
      '.nt-iconbtn-del:hover{color:var(--nt-yellow);background:rgba(255,255,0,.12)}',
      '.nt-headbtn{font-size:13px}',
      // floating xp number over a freshly killed task
      '.nt-xpfloat{position:absolute;right:6px;top:-2px;font-size:12px;font-weight:800;letter-spacing:.04em;color:var(--nt-yellow);text-shadow:0 0 10px rgba(255,255,0,.7),0 1px 0 rgba(6,16,11,.6);pointer-events:none;animation:nt-rise .85s ease-out forwards}',
      '.nt-empty{display:flex;align-items:center;gap:8px;padding:20px 6px;justify-content:center;color:var(--nt-faint);font-size:11.5px;letter-spacing:.04em}',
      '.nt-empty-txt{text-align:center}',
      '.nt-foot{position:relative;z-index:2;display:flex;align-items:center;gap:10px;padding:9px 14px 12px;border-top:1px solid rgba(117,117,117,.28)}',
      '.nt-progress{flex:1;display:flex;align-items:center;gap:8px;min-width:0}',
      '.nt-progress-track{flex:1;height:6px;border-radius:3px;background:rgba(117,117,117,.25);box-shadow:inset 0 1px 2px rgba(6,16,11,.4);overflow:hidden}',
      '.nt-progress-fill{height:100%;border-radius:3px;background:linear-gradient(180deg,#4dffb0,var(--nt-green));box-shadow:0 0 9px rgba(0,255,136,.55),inset 0 1px 0 rgba(255,255,255,.5);transition:width .25s ease}',
      '.nt-progress-num{font-size:10.5px;color:var(--nt-dim);font-variant-numeric:tabular-nums;letter-spacing:.04em}',
      '.nt-sound{width:24px;height:22px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.04);border:1px solid rgba(117,117,117,.35);border-radius:6px;color:var(--nt-dim);font:inherit;font-size:11px;cursor:pointer;padding:0}',
      '.nt-sound:hover{color:var(--nt-yellow);border-color:rgba(255,255,0,.5)}',
      '.nt-sound[aria-pressed="true"]{color:var(--nt-yellow)}',
      '.nt-sound[aria-pressed="false"]{color:var(--nt-faint);text-decoration:line-through}',
      '.nt-purge{padding:4px 10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,0,.55);border-radius:7px;color:var(--nt-yellow);font:inherit;font-size:10px;letter-spacing:.1em;cursor:pointer;white-space:nowrap;box-shadow:inset 0 1px 0 rgba(255,255,255,.15)}',
      '.nt-purge:hover:not(:disabled){background:rgba(255,255,0,.12)}',
      '.nt-purge:disabled{opacity:.35;cursor:not-allowed}',
      '.nt-purge-armed{border-color:var(--nt-yellow);background:var(--nt-yellow);color:#08130d;font-weight:800;animation:nt-blink .5s steps(2,start) infinite}',
      // level-up overlay
      '.nt-levelup{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);z-index:9;display:flex;align-items:center;justify-content:center;gap:10px;padding:14px 0;pointer-events:none;background:linear-gradient(90deg,transparent,rgba(0,255,136,.22),transparent);animation:nt-level 1.9s ease-out forwards}',
      '.nt-levelup-k{font-size:12px;font-weight:800;letter-spacing:.3em;color:var(--nt-yellow);text-shadow:0 0 12px rgba(255,255,0,.7)}',
      '.nt-levelup-lv{font-size:26px;font-weight:800;color:#fff;text-shadow:0 0 18px rgba(0,255,136,.9),0 0 4px rgba(255,255,255,.8);letter-spacing:.02em}',
      // ---- focus & motion ----
      '.nt-root :focus-visible{outline:1.5px solid var(--nt-green);outline-offset:2px}',
      '@keyframes nt-blink{50%{opacity:0}}',
      '@keyframes nt-boot{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}',
      '@keyframes nt-glitchin{from{opacity:0;transform:translateX(-6px)}to{opacity:1;transform:none}}',
      '@keyframes nt-shake{0%,100%{transform:translateX(0)}25%{transform:translateX(-3px)}75%{transform:translateX(3px)}}',
      '@keyframes nt-pop{from{transform:scale(.92);opacity:.4}to{transform:scale(1);opacity:1}}',
      '@keyframes nt-rise{0%{opacity:0;transform:translateY(4px)}25%{opacity:1}100%{opacity:0;transform:translateY(-16px)}}',
      '@keyframes nt-alarm{0%,100%{box-shadow:0 8px 20px var(--nt-shadow),0 0 0 1px rgba(117,117,117,.35),0 0 16px rgba(0,255,136,.2)}50%{box-shadow:0 8px 20px var(--nt-shadow),0 0 0 1px rgba(117,117,117,.5),0 0 32px rgba(0,255,136,.85)}}',
      '@keyframes nt-level{0%{opacity:0;transform:translateY(-50%) scale(.8)}18%{opacity:1;transform:translateY(-50%) scale(1.04)}30%{transform:translateY(-50%) scale(1)}80%{opacity:1}100%{opacity:0}}',
      '@media (prefers-reduced-motion:reduce){.nt-root,.nt-root *{animation:none !important;transition:none !important}}',
    ].join('\n');

    return {
      inject: ['slots'],
      apply(ctx) {
        const disposers = [];
        const locale = ctx.get && ctx.get('locale');
        if (locale && typeof locale.register === 'function') {
          [['en', STRINGS.en], ['zh', STRINGS.zh], ['zh-CN', STRINGS.zh]].forEach(function (pair) {
            try { disposers.push(locale.register(NS, pair[0], pair[1])); } catch (e) { /* already registered by an earlier HMR generation */ }
          });
        }
        const t = (locale && typeof locale.bind === 'function')
          ? locale.bind(NS)
          : function (k) { return (STRINGS.zh && STRINGS.zh[k]) || k; };

        const unreg = ctx.slots.inject('shell.overlay', function () {
          return ctx.slots.register(
            { name: 'shell.overlay', id: 'neon-tasks', order: 1 },
            function Widget() { return h(App, { t: t, locale: locale }); }
          );
        });
        disposers.push(unreg);
        return function () { disposers.forEach(function (d) { if (typeof d === 'function') d(); }); };
      },
    };
  },
});
