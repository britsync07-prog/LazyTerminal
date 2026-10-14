const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const srcRenderer = path.join(root, 'src', 'renderer');
const distRenderer = path.join(root, 'dist', 'renderer');

fs.mkdirSync(distRenderer, { recursive: true });

// Copy HTML and CSS
fs.copyFileSync(path.join(srcRenderer, 'index.html'), path.join(distRenderer, 'index.html'));
fs.copyFileSync(path.join(srcRenderer, 'styles.css'), path.join(distRenderer, 'styles.css'));

// Copy vendor files
const srcVendor = path.join(srcRenderer, 'vendor');
const distVendor = path.join(distRenderer, 'vendor');
fs.mkdirSync(distVendor, { recursive: true });

for (const file of fs.readdirSync(srcVendor)) {
  fs.copyFileSync(path.join(srcVendor, file), path.join(distVendor, file));
}

console.log('[Desktop Build] Copied assets to dist/renderer cleanly.');
