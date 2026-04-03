/**
 * ============================================================
 *  FLOWORKOS Brain Compiler v6 — Full Binary Encoding
 * ============================================================
 *  Encodes ALL files inside brain/ into unreadable binary:
 *
 *  1. .js files  → V8 Bytecode (.jsc) via vm.Script
 *  2. If V8 fails → XOR binary encode (.jsc)
 *  3. ALL other files (.ts, .tsx, .json, .md, etc.)
 *     → XOR binary encode (same extension, unreadable content)
 *
 *  At runtime, main.js extracts + decodes everything back.
 *
 *  Usage:
 *    node scripts/compile_brain.js           (compile + zip)
 *    node scripts/compile_brain.js --clean   (remove zip)
 *    node scripts/compile_brain.js --list    (list files)
 * ============================================================
 */

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var AdmZip = require('adm-zip');

var ENGINE_ROOT = path.resolve(__dirname, '..');
var BRAIN_DIR = path.join(ENGINE_ROOT, 'brain');
var OUTPUT_ZIP = path.join(ENGINE_ROOT, 'brain.zip');

// ── Encoding Key (embedded in engine, not in zip) ──
var ENCODE_KEY = Buffer.from('FLOWORKOS_BRAIN_ENGINE_KEY_2026_SECURE');
// Magic header to identify encoded files
var MAGIC = Buffer.from([0xF1, 0x0A, 0xC5, 0x15]);

// ── Directories to skip ──
var SKIP_DIRS = [
  'node_modules',
  '.git',
  '_brain_runtime',
  '_brain_compiled',
];

var SKIP_FILES = [
  'bun.lockb',
  'package-lock.json',
];

// Skip extensions (artifacts from previous compilation)
var SKIP_EXTS = ['.jsc'];

// These 6 scripts run in index.html (nodeIntegration: false)
// They must stay as plain .js — can't use require/bytenode
var PLAIN_JS_FILES = [
  'core_ui.js',
  'bot_manager.js',
  'grid_profiles.js',
  'farm_tutorial.js',
  'tab_manager.js',
  'nav_webview.js',
];

// ── XOR Encode/Decode (symmetric) ──
function xorEncode(buf) {
  var result = Buffer.alloc(buf.length + MAGIC.length);
  // Prepend magic header
  MAGIC.copy(result, 0);
  // XOR the content
  for (var i = 0; i < buf.length; i++) {
    result[i + MAGIC.length] = buf[i] ^ ENCODE_KEY[i % ENCODE_KEY.length];
  }
  return result;
}

// ── V8 Bytecode Compile ──
function compileToV8(source, filename) {
  try {
    var wrapped = '(function(exports,require,module,__filename,__dirname){' + source + '\n})';
    var script = new vm.Script(wrapped, { filename: filename, produceCachedData: true });
    var bytecode = script.createCachedData();
    if (bytecode && bytecode.length > 0) return bytecode;
    return null;
  } catch (e) {
    return null;
  }
}

// ── Clean mode ──
if (process.argv.includes('--clean')) {
  console.log('[Clean] Removing brain.zip ...');
  if (fs.existsSync(OUTPUT_ZIP)) { fs.unlinkSync(OUTPUT_ZIP); console.log('[Clean] Done.'); }
  else { console.log('[Clean] brain.zip not found.'); }
  process.exit(0);
}

// ── Check brain/ ──
if (!fs.existsSync(BRAIN_DIR)) {
  console.error('[ERROR] brain/ folder not found at: ' + BRAIN_DIR);
  process.exit(1);
}

// ── Scan recursively ──
function scanDir(dir, relBase) {
  var files = [];
  var entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (e) { return files; }

  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    if (entry.isDirectory() && SKIP_DIRS.indexOf(entry.name) >= 0) continue;
    var fullPath = path.join(dir, entry.name);
    var relPath = relBase ? relBase + '/' + entry.name : entry.name;
    if (entry.isDirectory()) {
      files = files.concat(scanDir(fullPath, relPath));
    } else {
      if (SKIP_FILES.indexOf(entry.name) >= 0) continue;
      try {
        var stat = fs.statSync(fullPath);
        files.push({ fullPath: fullPath, relPath: relPath, size: stat.size, name: entry.name });
      } catch (e) { }
    }
  }
  return files;
}

// ── Header ──
console.log('');
console.log('============================================');
console.log('  FLOWORKOS Brain Compiler v6');
console.log('  Full Binary Encoding (V8 + XOR)');
console.log('  Package brain/ -> brain.zip');
console.log('============================================');
console.log('');

// ── Scan ──
var allFiles = scanDir(BRAIN_DIR, '');
console.log('[Scan] Found ' + allFiles.length + ' files in brain/');
console.log('[Scan] Skipped dirs: ' + SKIP_DIRS.join(', '));
console.log('');

// ── List mode ──
if (process.argv.includes('--list')) {
  for (var i = 0; i < allFiles.length; i++) {
    console.log('  ' + allFiles[i].relPath + ' (' + Math.round(allFiles[i].size / 1024 * 10) / 10 + ' KB)');
  }
  console.log('\nTotal: ' + allFiles.length + ' files');
  process.exit(0);
}

if (allFiles.length === 0) { console.error('[ERROR] No files!'); process.exit(1); }
if (fs.existsSync(OUTPUT_ZIP)) fs.unlinkSync(OUTPUT_ZIP);

// ── Create ZIP ──
console.log('[Compile] Encoding ALL files ...');
var zip = new AdmZip();

var totalSize = 0;
var stats = { v8: 0, xor: 0, plain: 0, total: 0 };
var extCount = {};

for (var i = 0; i < allFiles.length; i++) {
  var file = allFiles[i];
  var dir = path.dirname(file.relPath);
  var ext = path.extname(file.relPath).toLowerCase() || '(none)';
  var zipDir = dir === '.' ? '' : dir;
  var isPlainJS = (ext === '.js' && PLAIN_JS_FILES.indexOf(file.name) >= 0);

  totalSize += file.size;
  extCount[ext] = (extCount[ext] || 0) + 1;
  stats.total++;

  if (isPlainJS) {
    // ── index.html UI scripts: keep plain ──
    zip.addLocalFile(file.fullPath, zipDir);
    stats.plain++;
    continue;
  }

  var rawContent = fs.readFileSync(file.fullPath);

  if (ext === '.js') {
    // ── Try V8 Bytecode first ──
    var source = rawContent.toString('utf8');
    var bytecode = compileToV8(source, file.relPath);

    if (bytecode) {
      // V8 bytecode success → save as .jsc
      var jscName = file.relPath.replace(/\.js$/, '.jsc');
      zip.addFile(jscName, bytecode);
      stats.v8++;
    } else {
      // V8 failed → XOR encode, keep as .js (but content is binary)
      var encoded = xorEncode(rawContent);
      zip.addFile(file.relPath, encoded);
      stats.xor++;
    }
  } else {
    // ── Non-JS: XOR encode all ──
    var encoded = xorEncode(rawContent);
    zip.addFile(file.relPath, encoded);
    stats.xor++;
  }
}

zip.writeZip(OUTPUT_ZIP);

// ── Summary ──
var zipSize = fs.statSync(OUTPUT_ZIP).size;
var sourceMB = Math.round(totalSize / 1024 / 1024 * 10) / 10;
var zipMB = Math.round(zipSize / 1024 / 1024 * 10) / 10;
var ratio = totalSize > 0 ? Math.round(zipSize / totalSize * 100) : 0;

console.log('');
console.log('============================================');
console.log('  COMPILE RESULT');
console.log('============================================');
console.log('  Total files: ' + stats.total);
console.log('  Source size: ' + sourceMB + ' MB');
console.log('  ZIP size:    ' + zipMB + ' MB (' + ratio + '% ratio)');
console.log('  Output:      ' + OUTPUT_ZIP);
console.log('');
console.log('  Encoding:');
console.log('    V8 Bytecode (.jsc): ' + stats.v8 + ' files');
console.log('    XOR Encoded:        ' + stats.xor + ' files');
console.log('    Plain JS (UI):      ' + stats.plain + ' files');
console.log('    TOTAL ENCODED:      ' + (stats.v8 + stats.xor) + '/' + stats.total);
console.log('');
console.log('  File Breakdown:');
var exts = Object.keys(extCount).sort(function (a, b) { return extCount[b] - extCount[a]; });
for (var i = 0; i < exts.length; i++) {
  console.log('    ' + exts[i] + ': ' + extCount[exts[i]] + ' files');
}
console.log('============================================');
console.log('');
console.log('Done! brain.zip is fully encoded.');
console.log('');
