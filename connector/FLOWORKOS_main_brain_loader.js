/**
 * ============================================================
 *  FLOWORKOS Main Brain Loader (for index.html)
 * ============================================================
 *  brain/ EXISTS   -> DEV  -> load from brain/ folder
 *  brain/ MISSING  -> PROD -> extract brain.zip, load from _brain_runtime/
 *
 *  This loader handles the 6 UI scripts needed by index.html:
 *  core_ui, bot_manager, grid_profiles, farm_tutorial,
 *  tab_manager, nav_webview
 * ============================================================
 */

(function () {
  var fs, path;
  try {
    fs = require('fs');
    path = require('path');
  } catch (e) { return; }

  // ─── Resolve ENGINE root ───
  // In Electron renderer: __dirname = directory of the HTML file (ENGINE/)
  var ENGINE_ROOT;
  if (fs.existsSync(path.join(__dirname, 'connector'))) {
    ENGINE_ROOT = __dirname;
  } else {
    ENGINE_ROOT = path.resolve(__dirname, '..');
  }

  var BRAIN_DIR = path.join(ENGINE_ROOT, 'brain');
  var BRAIN_ZIP = path.join(ENGINE_ROOT, 'brain.zip');
  var RUNTIME_DIR = path.join(ENGINE_ROOT, '_brain_runtime');

  var brainExists = false;
  try { brainExists = fs.existsSync(BRAIN_DIR) && fs.statSync(BRAIN_DIR).isDirectory(); } catch(e) {}
  var zipExists = false;
  try { zipExists = fs.existsSync(BRAIN_ZIP); } catch(e) {}

  // Scripts used by index.html
  var SCRIPTS = [
    'core_ui.js',
    'bot_manager.js',
    'grid_profiles.js',
    'farm_tutorial.js',
    'tab_manager.js',
    'nav_webview.js',
  ];

  var _mode = 'none';
  var _scriptBase = '';

  if (brainExists) {
    _mode = 'source';
    _scriptBase = './brain/';
    console.log('[MainBrainLoader] DEV MODE — loading from brain/');
  } else if (zipExists) {
    _mode = 'zip';
    console.log('[MainBrainLoader] PROD MODE — extracting brain.zip ...');

    try {
      var _require = window.originalNodeRequire || require;
      var AdmZip;
      try {
        AdmZip = _require('adm-zip');
      } catch (e1) {
        try {
          AdmZip = _require(path.join(ENGINE_ROOT, 'node_modules', 'adm-zip'));
        } catch (e2) {
          throw new Error('adm-zip not found');
        }
      }

      // Only extract if _brain_runtime doesn't already have our files
      var needsExtract = !fs.existsSync(path.join(RUNTIME_DIR, SCRIPTS[0]));
      if (needsExtract) {
        try {
          if (fs.existsSync(RUNTIME_DIR)) fs.rmSync(RUNTIME_DIR, { recursive: true, force: true });
        } catch(e) {}
        fs.mkdirSync(RUNTIME_DIR, { recursive: true });

        var zip = new AdmZip(BRAIN_ZIP);
        zip.extractAllTo(RUNTIME_DIR, true);
        console.log('[MainBrainLoader] Extracted brain.zip to _brain_runtime/');
      } else {
        console.log('[MainBrainLoader] Using existing _brain_runtime/');
      }

      _scriptBase = 'file:///' + RUNTIME_DIR.replace(/\\/g, '/') + '/';
    } catch (e) {
      console.error('[MainBrainLoader] ZIP extract FAILED: ' + e.message);
    }
  } else {
    console.error('[MainBrainLoader] FATAL: No brain/ and no brain.zip!');
  }

  // Inject scripts
  if (_scriptBase) {
    for (var i = 0; i < SCRIPTS.length; i++) {
      var src = _scriptBase + SCRIPTS[i];
      document.write('<scr' + 'ipt src="' + src + '"></scr' + 'ipt>');
    }
    console.log('[MainBrainLoader] ' + SCRIPTS.length + ' scripts injected (' + _mode + ' mode)');
  }
})();
