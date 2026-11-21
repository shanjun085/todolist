// Real-browser regression check (Chrome/Edge headless). Guards the things the
// DOM shim cannot see: box geometry and the 1s updateLive tick.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'standalone/todo.html'), 'utf8');
const now = Date.now();
const seed = {
  tasks: [
    { id: 't1', text: '重构任务面板的手感', done: false, priority: 2, createdAt: now - 7200e3, completedAt: null, due: now + 3600e3, killed: false },
    { id: 't2', text: '把 DDL 提醒写成脉冲', done: false, priority: 1, createdAt: now - 5400e3, completedAt: null, due: now - 1200e3, killed: false },
    { id: 't3', text: '导出 JSON 备份', done: true, priority: 3, createdAt: now - 86400e3, completedAt: now - 3600e3, due: null, killed: true },
  ],
  player: { xp: 265, level: 2, combo: 3, comboAt: now - 20e3, best: 5, totalDone: 9 },
  ui: { expanded: true, pos: { x: 24, y: 24 }, muted: false },
};
const inject = '<script>try{localStorage.setItem("neon-tasks-standalone:v1",' + JSON.stringify(JSON.stringify(seed)) + ')}catch(e){}</script>\n';
const probe = '<script>setTimeout(function(){' +
  'var g=document.querySelector(".nt-glass"),p=document.querySelector(".nt-panel");' +
  'var pr=p.getBoundingClientRect(), gr=g.getBoundingClientRect();' +
  'var rows=[].map.call(document.querySelectorAll(".nt-row"),function(r){' +
  'var d=r.querySelector(".nt-due");var cs=getComputedStyle(d);' +
  'return {cls:r.className,due:d.getAttribute("data-due"),txt:d.textContent,over:d.classList.contains("over"),none:d.classList.contains("none"),color:cs.color};});' +
  'var btn=[].map.call(document.querySelectorAll(".nt-data"),function(b){return b.textContent.replace(/\\s+/g,"");});' +
  'document.title="DBG "+JSON.stringify({iw:innerWidth,ih:innerHeight,panel:{l:pr.left,t:pr.top,r:pr.right,b:pr.bottom,w:pr.width,h:pr.height},' +
  'glass:{t:gr.top,b:gr.bottom},rows:rows,buttons:btn,notice:!!document.querySelector(".nt-notice")});},1200);</script>\n';
const out = path.join(root, 'tools/preview');
fs.mkdirSync(out, { recursive: true });
const page = html.replace('<script>\n(function', inject + '<script>\n(function').replace('</body>', probe + '</body>');
const file = path.join(out, 'browser-check.html');
fs.writeFileSync(file, page);

const browsers = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const exe = browsers.find((p) => fs.existsSync(p));
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
};
if (!exe) {
  console.log('SKIP: no Chrome/Edge found, browser check not run');
  process.exit(0);
}
const dom = execFileSync(exe, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
  '--window-size=520,900', '--virtual-time-budget=3000', '--dump-dom',
  'file:///' + file.replace(/\\/g, '/'),
], { encoding: 'utf8', timeout: 60000 });
const m = dom.match(/DBG (\{[\s\S]*?\})<\/title>/);
if (!m) {
  console.log('FAIL: probe did not run (page may have thrown)');
  process.exit(1);
}
const info = JSON.parse(m[1]);

console.log('1) layout');
check('panel inside viewport horizontally', info.panel.l >= 0 && info.panel.r <= info.iw + 0.5, { l: info.panel.l, r: info.panel.r, iw: info.iw });
check('panel inside viewport vertically', info.panel.t >= 0 && info.panel.b <= info.ih + 0.5, { t: info.panel.t, b: info.panel.b, ih: info.ih });
check('data row is inside the glass card', info.glass.b >= info.panel.b - 2, { glassBottom: info.glass.b, panelBottom: info.panel.b });

console.log('2) rows after the 1s updateLive tick');
const active = info.rows.filter((r) => r.cls.indexOf('done') === -1);
const done = info.rows.filter((r) => r.cls.indexOf('done') !== -1);
check('3 rows rendered', info.rows.length === 3, info.rows.length);
check('null-due done task shows 无截止', done.length === 1 && done[0].due === '' && done[0].txt === '无截止', done);
check('null-due chip not marked overdue', done.length === 1 && done[0].over === false && done[0].none === true, done);
check('overdue active task still reads 逾期', active.some((r) => r.over && /逾期/.test(r.txt)), active.map((r) => r.txt));
check('future task reads a positive countdown', active.some((r) => !r.over && /^\d+[mh]$/.test(r.txt)), active.map((r) => r.txt));

console.log('3) export/import controls');
check('export + import buttons exist', info.buttons.length === 2 && info.buttons[0].indexOf('导出') !== -1 && info.buttons[1].indexOf('导入') !== -1, info.buttons);
check('no notice on clean boot', info.notice === false);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
