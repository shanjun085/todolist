// Static verification for the Tauri shell: config schema sanity, icon container
// integrity, and frontend parity with the canonical standalone client.
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const t = (p) => path.join(root, p);
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, extra === undefined ? '' : JSON.stringify(extra)); }
};

console.log('1) tauri.conf.json');
const conf = JSON.parse(fs.readFileSync(t('tauri/src-tauri/tauri.conf.json'), 'utf8'));
check('identifier', conf.identifier === 'com.neontasks.client', conf.identifier);
check('frontendDist', conf.build.frontendDist === '../src', conf.build.frontendDist);
check('windows delegated to main.rs', Array.isArray(conf.app.windows) && conf.app.windows.length === 0);
check('csp null (inline single-file app)', conf.app.security.csp === null);
check('icons listed', Array.isArray(conf.bundle.icon) && conf.bundle.icon.includes('icons/icon.ico'));

console.log('2) capabilities');
const cap = JSON.parse(fs.readFileSync(t('tauri/src-tauri/capabilities/default.json'), 'utf8'));
check('capability window', cap.windows[0] === 'main', cap.windows);
check('core default', cap.permissions.includes('core:default'), cap.permissions);

console.log('3) Cargo manifest + entry point');
const cargo = fs.readFileSync(t('tauri/src-tauri/Cargo.toml'), 'utf8');
check('crate name', /name\s*=\s*"neon-tasks"/.test(cargo));
check('tauri 2', /tauri\s*=\s*\{\s*version\s*=\s*"2"/.test(cargo));
const mainRs = fs.readFileSync(t('tauri/src-tauri/src/main.rs'), 'utf8');
check('entry uses generate_context', mainRs.includes('tauri::generate_context!()'));
check('window built in setup (label main)', mainRs.includes('"main"') && mainRs.includes('WebviewWindowBuilder'));
check('window title', mainRs.includes('赛博朋克 · Todo list'));
check('window size 420x800', mainRs.includes('420.0') && mainRs.includes('800.0'));
check('data dir override', mainRs.includes('NEON_TASKS_DATA_DIR') && mainRs.includes('app_local_data_dir()'));

console.log('4) ICO container');
const ico = fs.readFileSync(t('tauri/src-tauri/icons/icon.ico'));
check('ico magic', ico.readUInt16LE(0) === 0 && ico.readUInt16LE(2) === 1, [ico.readUInt16LE(0), ico.readUInt16LE(2)]);
const count = ico.readUInt16LE(4);
check('ico entries', count === 6, count);
let ok = true;
for (let i = 0; i < count; i++) {
  const off = 6 + 16 * i;
  const size = ico[off] === 0 ? 256 : ico[off];
  const bytes = ico.readUInt32LE(off + 8);
  const start = ico.readUInt32LE(off + 12);
  const png = ico.subarray(start, start + bytes);
  const sigOk = png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47;
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
  if (!sigOk || w !== size || h !== size) { ok = false; console.log('    bad entry', i, size, w, h, sigOk); }
}
check('ico payloads are valid PNGs of matching size', ok);
for (const f of ['32x32.png', '128x128.png', '128x128@2x.png', 'icon.png']) {
  const png = fs.readFileSync(t('tauri/src-tauri/icons/' + f));
  check('png ' + f, png[0] === 0x89 && png[1] === 0x50, png.length);
}

console.log('5) frontend parity');
const src = fs.readFileSync(t('standalone/todo.html'));
const dist = fs.readFileSync(t('tauri/src/index.html'));
check('index.html identical to todo.html', src.equals(dist), [src.length, dist.length]);
check('dist index exists at frontendDist root', fs.existsSync(t('tauri/src/index.html')));

console.log('6) JS syntax of the shipped page');
const html = src.toString('utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
try {
  new Function(script);
  check('inline script parses', true);
} catch (e) {
  check('inline script parses', false, e.message);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
