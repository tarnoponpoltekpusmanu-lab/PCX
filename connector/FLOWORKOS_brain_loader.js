/**
 * ============================================================
 *  FLOWORKOS Smart Brain Loader v6
 * ============================================================
 *  DEV MODE  (brain/*.js exists)   → load via <script> tags
 *  PROD MODE (brain/*.jsc exists)  → load via bytenode require()
 *
 *  V8 Bytecode (.jsc) files are loaded using bytenode which
 *  registers the .jsc extension handler with Node's require().
 *
 *  ai-builder.html has nodeIntegration: true so require() works.
 * ============================================================
 */

(function () {
  var fs, path;
  var hasNodeEnv = false;
  try {
    var _req = window.originalNodeRequire || (typeof require !== 'undefined' ? require : null);
    if (_req) {
      fs = _req('fs');
      path = _req('path');
      hasNodeEnv = true;
    } else {
      console.warn('[BrainLoader] require not available - fallback to browser mode');
    }
  } catch (e) {
    console.warn('[BrainLoader] Failed to init node modules - fallback to browser mode');
  }

  // All brain scripts in exact load order (without extension)
  var SCRIPTS = [
    'agent_state',
    'agent_mode_router',
    'agent_ui',
    'agent_llm',
    'agent_memory',
    'agent_session_memory',
    'agent_tool_schemas',
    'agent_thinking',
    'agent_commands',
    'agent_voice',
    'agent_auth',
    'agent_engine',
    'smart/agent/FLOWORKOS_model_failover',
    'smart/agent/FLOWORKOS_loop_detector',
    'smart/agent/FLOWORKOS_compaction',
    'smart/agent/FLOWORKOS_usage_tracking',
    'smart/security/FLOWORKOS_tool_policy',
    'smart/security/FLOWORKOS_redaction',
    'smart/subagents/FLOWORKOS_subagent_manager',
    'smart/sessions/FLOWORKOS_session_manager',
    'smart/skills/FLOWORKOS_skills_manager',
    'smart/gateway/FLOWORKOS_gateway',
    'smart/context/FLOWORKOS_context_guard',
    'smart/mcp/FLOWORKOS_mcp_client',
    'smart/voice/FLOWORKOS_voice_tts',
    'smart/media/FLOWORKOS_media_pipeline',
    'smart/config/FLOWORKOS_env_loader',
    'brain_flowork_config',
    'brain_flowork_tool_registry',
    'brain_flowork_tool_bridge',
    'brain_flowork_llm_adapter',
    'brain_flowork_adapter',
    'brain_flowork_memory_bridge',
    'brain_flowork_self_heal',
    'brain_flowork_plan_mode',
    'brain_flowork_cost_tracker',
    'brain_flowork_analytics',
    'brain_flowork_permissions',
    'brain_flowork_features',
    'brain_flowork_review',
    'brain_flowork_agents',
    'brain_flowork_teams',
    'brain_flowork_mcp',
    'brain_flowork_plugins',
    'brain_flowork_lsp',
    'brain_flowork_voice',
    'brain_flowork_ide_bridge',
    'brain_flowork_vision',
    'brain_flowork_nas',
    'brain_flowork_swarm',
    'brain_flowork_native_dispatcher',
    'brain_flowork_extensions',
    'brain_flowork_evolution',
    'agent_fs',
    'agent_file_manager',
    'agent_builder',
  ];

  var isProd = false;
  var isDev = true; // Assume Dev if no Node

  if (hasNodeEnv) {
    // ─── Detect ENGINE_ROOT ─────────────────────────────────────────
    var ENGINE_ROOT;
    if (fs.existsSync(path.join(__dirname, 'connector'))) {
      ENGINE_ROOT = __dirname;
    } else if (fs.existsSync(path.join(__dirname, '..', 'connector'))) {
      ENGINE_ROOT = path.resolve(__dirname, '..');
    } else {
      ENGINE_ROOT = __dirname;
    }

    var brainDir = path.join(ENGINE_ROOT, 'brain');

    // ─── Detect Mode: check if .jsc files exist ─────────────────────
    var firstJsc = path.join(brainDir, SCRIPTS[0] + '.jsc');
    var firstJs  = path.join(brainDir, SCRIPTS[0] + '.js');
    isProd   = fs.existsSync(firstJsc);
    isDev    = fs.existsSync(firstJs);
  }

  var _mode = 'none';
  var _loaded = 0;
  var _errors = [];

  if (hasNodeEnv && isProd) {
    // ═══ PROD MODE: Load .jsc via bytenode ═══════════════════════
    _mode = 'bytecode';
    console.log('[BrainLoader] PROD MODE — loading V8 Bytecode (.jsc)');

    // Load bytenode to register .jsc extension handler
    try {
      var _req = window.originalNodeRequire || require;
      try { _req('bytenode'); } catch(e) {
        _req(path.join(ENGINE_ROOT, 'node_modules', 'bytenode'));
      }
    } catch(e) {
      console.error('[BrainLoader] FATAL: bytenode not available:', e.message);
      return;
    }

    for (var i = 0; i < SCRIPTS.length; i++) {
      var jscPath = path.join(brainDir, SCRIPTS[i] + '.jsc');
      var jsPath  = path.join(brainDir, SCRIPTS[i] + '.js');

      try {
        if (fs.existsSync(jscPath)) {
          // Load bytecode via require (bytenode handles .jsc)
          require(jscPath);
          _loaded++;
        } else if (fs.existsSync(jsPath)) {
          // Fallback: some files may be plain .js (failed bytecode compile)
          var code = fs.readFileSync(jsPath, 'utf8');
          var script = document.createElement('script');
          script.textContent = code;
          document.head.appendChild(script);
          _loaded++;
        } else {
          _errors.push(SCRIPTS[i] + ' — not found (.jsc or .js)');
        }
      } catch(e) {
        _errors.push(SCRIPTS[i] + ' — ' + e.message);
        console.error('[BrainLoader] Failed to load: ' + SCRIPTS[i], e.message);
      }
    }

  } else if (isDev || !hasNodeEnv) {
    // ═══ DEV MODE or BROWSER MODE: Load .js via script tags ══════════════════════
    _mode = 'source';
    console.log('[BrainLoader] DEV/BROWSER MODE — loading source (.js)');

    for (var i = 0; i < SCRIPTS.length; i++) {
      var src = './brain/' + SCRIPTS[i] + '.js';
      document.write('<scr' + 'ipt src="' + src + '"></scr' + 'ipt>');
      _loaded++;
    }

  } else {
    console.error('[BrainLoader] FATAL: No brain/ found! Neither .jsc nor .js files exist.');
    _mode = 'none';
  }

  console.log('[BrainLoader] ' + _loaded + '/' + SCRIPTS.length + ' scripts loaded (' + _mode + ' mode)');
  if (_errors.length > 0) {
    console.warn('[BrainLoader] ' + _errors.length + ' errors:');
    for (var i = 0; i < _errors.length; i++) {
      console.warn('  - ' + _errors[i]);
    }
  }

  // ─── Public API ──────────────────────────────────────────────────
  window.FLOWORKOS_BrainLoader = {
    getMode: function() { return _mode; },
    isCompiled: function() { return _mode === 'bytecode'; },
    getErrors: function() { return _errors.slice(); },
    getStats: function() {
      return { mode: _mode, loaded: _loaded, total: SCRIPTS.length, errors: _errors.length };
    },
  };
})();
