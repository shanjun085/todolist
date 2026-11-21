// Copies the canonical standalone client into the Tauri frontend slot.
// The Tauri app has no build step; its frontendDist is a plain folder.
'use strict';
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'standalone', 'todo.html');
const destDir = path.join(__dirname, '..', 'tauri', 'src');
fs.mkdirSync(destDir, { recursive: true });
const html = fs.readFileSync(src, 'utf8');
fs.writeFileSync(path.join(destDir, 'index.html'), html);
console.log('synced ' + src + ' -> tauri/src/index.html (' + html.length + ' bytes)');
