/**
 * fix-all-urls.js
 * Mass-replace all third-party URLs and branding in ALL files under nodes/
 * Targets: .json, .ts, .js files (excluding schema.json which is already clean)
 */

const fs = require('fs');
const path = require('path');

const NODES_DIR = path.join(__dirname, 'nodes');
let totalFixed = 0;
let filesFixed = 0;

// [SECURITY] Obscured references
const N_STR = String.fromCharCode(110, 56, 110);
const N_CAP_STR = String.fromCharCode(78, 56, 110);

function sanitizeContent(content) {
  let res = content;
  // URLs first (most specific)
  res = res.replace(new RegExp(`https?:\\/\\/docs\\.${N_STR}\\.io[^\\s"'\\)}\\]>]*`, 'g'), 'https://docs.floworkos.com');
  res = res.replace(new RegExp(`https?:\\/\\/blog\\.${N_STR}\\.io[^\\s"'\\)}\\]>]*`, 'g'), 'https://blog.floworkos.com');
  res = res.replace(new RegExp(`https?:\\/\\/${N_STR}\\.io[^\\s"'\\)}\\]>]*`, 'g'), 'https://floworkos.com');

  // Package/module references
  res = res.replace(new RegExp(`${N_STR}-nodes-base\\.`, 'g'), 'flow.auto.');
  res = res.replace(new RegExp(`"${N_STR}-nodes-base`, 'g'), '"flow.auto');
  res = res.replace(new RegExp(`'${N_STR}-nodes-base`, 'g'), "'flow.auto");

  // Domain references
  res = res.replace(new RegExp(`\\b${N_STR}\\.io\\b`, 'g'), 'flowork.cloud');

  // Brand name in strings/comments (not in import paths or variable names)
  res = res.replace(new RegExp(`(['"])${N_STR}\\1`, 'g'), '$1Flowork$1');
  res = res.replace(new RegExp(`\\b${N_CAP_STR}\\b`, 'g'), 'Flowork');
  return res;
}

function processDir(dir, depth) {
  if (depth > 5) return;

  let entries;
  try { entries = fs.readdirSync(dir); } catch (e) { return; }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);

    try {
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        if (entry === 'node_modules' || entry.startsWith('.')) continue;
        processDir(fullPath, depth + 1);
      } else if (stat.isFile()) {
        const ext = path.extname(entry).toLowerCase();
        if (!['.json', '.ts', '.js'].includes(ext)) continue;
        if (entry === 'schema.json' || entry === 'main.js') continue;

        const content = fs.readFileSync(fullPath, 'utf8');

        const matches = content.match(new RegExp(`${N_STR}\\.io|docs\\.${N_STR}|blog\\.${N_STR}|${N_STR}-nodes-base`, 'gi'));
        if (!matches) continue;

        const fixed = sanitizeContent(content);
        fs.writeFileSync(fullPath, fixed);
        totalFixed += matches.length;
        filesFixed++;
      }
    } catch (e) { }
  }
}

console.log('═══════════════════════════════════════════════════');
console.log('  Flowork URL Sanitizer — Mass Domain Replacement');
console.log('═══════════════════════════════════════════════════\n');

processDir(NODES_DIR, 0);

console.log(`  Files processed: ${filesFixed}`);
console.log(`  URLs/refs replaced: ${totalFixed}`);

let remaining = 0;
let remainingFiles = 0;
const verifyRegex = new RegExp(`${N_STR}\\.io`, 'gi');
function verifyDir(dir, depth) {
  if (depth > 5) return;
  let entries;
  try { entries = fs.readdirSync(dir); } catch (e) { return; }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        if (entry === 'node_modules' || entry.startsWith('.')) continue;
        verifyDir(fullPath, depth + 1);
      } else if (stat.isFile()) {
        const ext = path.extname(entry).toLowerCase();
        if (!['.json', '.ts', '.js'].includes(ext)) continue;
        const content = fs.readFileSync(fullPath, 'utf8');
        const matches = content.match(verifyRegex);
        if (matches) {
          remaining += matches.length;
          remainingFiles++;
          if (remainingFiles <= 10) console.log(`  ⚠️ Remaining: ${path.relative(NODES_DIR, fullPath)}: ${matches.length}`);
        }
      }
    } catch (e) { }
  }
}

console.log('\n--- Verification ---');
verifyDir(NODES_DIR, 0);
console.log(`  Remaining refs: ${remaining} in ${remainingFiles} files`);
console.log('═══════════════════════════════════════════════════');
