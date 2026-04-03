/**
 * ============================================================
 *  FLOWORKOS™ Smart Module Loader
 *  Master index for all FLOWORKOS™ smart modules
 * ============================================================
 *  This file loads all FLOWORKOS smart modules and wires them
 *  into the Flowork brain engine via window.* globals.
 *
 *  Load order matters! Dependencies must load first.
 * ============================================================
 *
 *  STATUS: Phase 2 Complete (16 modules converted)
 *
 *  ┌──────────────────────────────────────────┐
 *  │  ALL CONVERTED (JS - Active)             │
 *  ├──────────────────────────────────────────┤
 *  │  ✅ config/FLOWORKOS_env_loader.js       │
 *  │  ✅ security/FLOWORKOS_redaction.js      │
 *  │  ✅ security/FLOWORKOS_tool_policy.js    │
 *  │  ✅ agent/FLOWORKOS_model_failover.js    │
 *  │  ✅ agent/FLOWORKOS_loop_detector.js     │
 *  │  ✅ agent/FLOWORKOS_compaction.js        │
 *  │  ✅ agent/FLOWORKOS_usage_tracking.js    │
 *  │  ✅ context/FLOWORKOS_context_guard.js   │
 *  │  ✅ voice/FLOWORKOS_voice_tts.js         │
 *  │  ✅ media/FLOWORKOS_media_pipeline.js    │
 *  │  ✅ mcp/FLOWORKOS_mcp_client.js          │
 *  │  ✅ sessions/FLOWORKOS_session_manager.js│
 *  │  ✅ skills/FLOWORKOS_skills_manager.js   │
 *  │  ✅ subagents/FLOWORKOS_subagent_manager │
 *  │  ✅ gateway/FLOWORKOS_gateway.js         │
 *  └──────────────────────────────────────────┘
 *
 *  USAGE IN ai-builder.html:
 *  <script src="brain/smart/FLOWORKOS_smart_loader.js"></script>
 *
 *  Then access via:
 *    window.FLOWORKOS_ModelFailover.runWithModelFailover(...)
 *    window.FLOWORKOS_LoopDetector.detectToolCallLoop(...)
 *    window.FLOWORKOS_Compaction.compactMessages(...)
 *    window.FLOWORKOS_ToolPolicy.evaluatePolicy(...)
 *    window.FLOWORKOS_UsageTracking.recordUsage(...)
 *    window.FLOWORKOS_ContextGuard.check(...)
 *    window.FLOWORKOS_Redaction.redact(...)
 *    window.FLOWORKOS_MCP.connectSSE(...)
 *    window.FLOWORKOS_Sessions.createSession(...)
 *    window.FLOWORKOS_Skills.listSkills(...)
 *    window.FLOWORKOS_SubAgents.spawnSubagent(...)
 *    window.FLOWORKOS_Gateway.sendOutbound(...)
 */

(function () {
  'use strict';

  // Track loaded modules
  const _loadedModules = [];
  const _failedModules = [];

  /**
   * Load a JS module dynamically
   */
  function loadModule(src, name) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.onload = () => {
        _loadedModules.push(name);
        resolve(name);
      };
      script.onerror = () => {
        _failedModules.push(name);
        console.warn(`[FLOWORKOS] ⚠️ Failed to load: ${name} (${src})`);
        resolve(null); // Don't reject, continue loading others
      };
      document.head.appendChild(script);
    });
  }

  /**
   * Load ALL smart modules in dependency order.
   * Load order matters! Infrastructure → Security → Intelligence → Features → Gateway
   */
  async function loadAllModules() {
    console.log('[FLOWORKOS] 🚀 Loading Smart Modules (Phase 2 — Full Body)...');
    const basePath = 'brain/smart/';

    const modules = [
      // ── Layer 0: Infrastructure (no dependencies) ──────────
      { path: 'config/FLOWORKOS_env_loader.js',             name: 'Env Loader' },

      // ── Layer 1: Security (depends on config) ──────────────
      { path: 'security/FLOWORKOS_redaction.js',            name: 'Redaction Engine' },
      { path: 'security/FLOWORKOS_tool_policy.js',          name: 'Tool Policy' },

      // ── Layer 2: Core Intelligence ─────────────────────────
      { path: 'agent/FLOWORKOS_model_failover.js',          name: 'Model Failover' },
      { path: 'agent/FLOWORKOS_loop_detector.js',           name: 'Loop Detector' },
      { path: 'agent/FLOWORKOS_compaction.js',              name: 'Smart Compaction' },
      { path: 'agent/FLOWORKOS_usage_tracking.js',          name: 'Usage Tracking' },
      { path: 'context/FLOWORKOS_context_guard.js',         name: 'Context Guard' },

      // ── Layer 3: Voice & Media ─────────────────────────────
      { path: 'voice/FLOWORKOS_voice_tts.js',               name: 'Voice TTS Engine' },
      { path: 'media/FLOWORKOS_media_pipeline.js',          name: 'Media Pipeline' },

      // ── Layer 4: Connectivity ──────────────────────────────
      { path: 'mcp/FLOWORKOS_mcp_client.js',                name: 'MCP Protocol Client' },

      // ── Layer 5: Session & State ───────────────────────────
      { path: 'sessions/FLOWORKOS_session_manager.js',      name: 'Session Manager' },
      { path: 'skills/FLOWORKOS_skills_manager.js',         name: 'Skills Manager' },

      // ── Layer 6: Agent Systems ─────────────────────────────
      { path: 'subagents/FLOWORKOS_subagent_manager.js',    name: 'SubAgent Manager' },

      // ── Layer 7: External Gateway (depends on all above) ──
      { path: 'gateway/FLOWORKOS_gateway.js',               name: 'Multi-Channel Gateway' },
    ];

    for (const mod of modules) {
      await loadModule(basePath + mod.path, mod.name);
    }

    // Wire into Flowork brain (if adapters are loaded)
    _wireIntoBrain();

    console.log(`[FLOWORKOS] ✅ Smart Modules loaded: ${_loadedModules.length}/${modules.length}`);
    if (_failedModules.length > 0) {
      console.warn(`[FLOWORKOS] ⚠️ Failed modules: ${_failedModules.join(', ')}`);
    }

    return { loaded: _loadedModules, failed: _failedModules };
  }

  /**
   * Wire loaded modules into existing brain adapters
   */
  function _wireIntoBrain() {
    // ── Tool Policy: configure workspace paths ───────────────
    if (window.FLOWORKOS_ToolPolicy) {
      const state = window._floworkState || {};
      if (state.workspacePath) {
        window.FLOWORKOS_ToolPolicy.addAllowedPaths(state.workspacePath);
      }
      window.FLOWORKOS_ToolPolicy.addAllowedPaths(
        'C:\\flowork',
        'C:\\Users'
      );
    }

    // ── Loop Detector ────────────────────────────────────────
    if (window.FLOWORKOS_LoopDetector) {
      console.log('[FLOWORKOS] Loop detector active (warn: 5, critical: 10, breaker: 15)');
    }

    // ── Usage Tracking ───────────────────────────────────────
    if (window.FLOWORKOS_UsageTracking) {
      console.log('[FLOWORKOS] Usage tracking active');
    }

    // ── Context Guard: auto-set model ────────────────────────
    if (window.FLOWORKOS_ContextGuard) {
      const currentModel = window.getConfig?.('provider') || '';
      if (currentModel) {
        window.FLOWORKOS_ContextGuard.setModel(currentModel);
      }
      console.log('[FLOWORKOS] Context guard active');
    }

    // ── Redaction: wire into tool bridge for auto-redaction ──
    if (window.FLOWORKOS_Redaction) {
      console.log('[FLOWORKOS] Payload redaction engine active');
    }

    // ── MCP Client ───────────────────────────────────────────
    if (window.FLOWORKOS_MCP) {
      console.log('[FLOWORKOS] MCP protocol client ready (SSE, WS, Virtual)');
    }

    // ── Session Manager ──────────────────────────────────────
    if (window.FLOWORKOS_Sessions) {
      console.log('[FLOWORKOS] Session persistence manager ready');
    }

    // ── Skills System ────────────────────────────────────────
    if (window.FLOWORKOS_Skills) {
      const skills = window.FLOWORKOS_Skills.listSkills?.() || [];
      console.log(`[FLOWORKOS] Skills system ready (${skills.length} installed)`);
    }

    // ── SubAgent Manager ─────────────────────────────────────
    if (window.FLOWORKOS_SubAgents) {
      console.log('[FLOWORKOS] SubAgent manager ready (depth limit: 3, orphan monitor active)');
    }

    // ── Gateway ──────────────────────────────────────────────
    if (window.FLOWORKOS_Gateway) {
      const channels = window.FLOWORKOS_Gateway.listChannels?.() || [];
      console.log(`[FLOWORKOS] Multi-channel gateway ready (${channels.length} channels)`);
    }

    // ── Media Pipeline ───────────────────────────────────────
    if (window.FLOWORKOS_MediaPipeline) {
      console.log('[FLOWORKOS] Media pipeline ready');
    }
  }

  /**
   * Get status of all module systems
   */
  function getSmartStatus() {
    const status = {
      modules: {
        loaded: _loadedModules,
        failed: _failedModules,
        total: _loadedModules.length + _failedModules.length,
      },
    };

    // Model Failover status
    if (window.FLOWORKOS_ModelFailover) {
      status.failover = window.FLOWORKOS_ModelFailover.getFailoverStatus();
    }

    // Loop Detector stats
    if (window.FLOWORKOS_LoopDetector) {
      status.loopDetector = window.FLOWORKOS_LoopDetector.getToolCallStats();
    }

    // Usage stats
    if (window.FLOWORKOS_UsageTracking) {
      status.usage = window.FLOWORKOS_UsageTracking.getSessionUsage();
      status.dailyUsage = window.FLOWORKOS_UsageTracking.getDailyUsage();
    }

    // Tool Policy
    if (window.FLOWORKOS_ToolPolicy) {
      const policy = window.FLOWORKOS_ToolPolicy.getPolicy();
      status.toolPolicy = {
        blockedTools: policy.blocklist.length,
        approvalRequired: policy.requireApproval.length,
        dangerousPatterns: policy.dangerousCommands.length,
      };
    }

    // Compaction
    if (window.FLOWORKOS_Compaction) {
      status.compaction = { ready: true };
    }

    // Context Guard
    if (window.FLOWORKOS_ContextGuard) {
      status.contextGuard = window.FLOWORKOS_ContextGuard.check();
    }

    // MCP
    if (window.FLOWORKOS_MCP) {
      status.mcp = {
        servers: window.FLOWORKOS_MCP.listServers(),
        tools: window.FLOWORKOS_MCP.listAllTools().length,
      };
    }

    // Sessions
    if (window.FLOWORKOS_Sessions) {
      const current = window.FLOWORKOS_Sessions.getCurrentSession();
      status.sessions = {
        active: !!current,
        currentId: current?.id || null,
      };
    }

    // Skills
    if (window.FLOWORKOS_Skills) {
      const skills = window.FLOWORKOS_Skills.listSkills();
      status.skills = {
        installed: skills.length,
        active: skills.filter(s => s.active).length,
      };
    }

    // SubAgents
    if (window.FLOWORKOS_SubAgents) {
      status.subAgents = {
        active: window.FLOWORKOS_SubAgents.countActiveRuns(),
      };
    }

    // Gateway
    if (window.FLOWORKOS_Gateway) {
      status.gateway = window.FLOWORKOS_Gateway.getGatewayStatus();
    }

    return status;
  }

  // ── Register Master Loader ─────────────────────────────────
  window.FLOWORKOS_Smart = {
    loadAllModules,
    getSmartStatus,
    loadModule,
    get loadedModules() { return [..._loadedModules]; },
    get failedModules() { return [..._failedModules]; },
  };

  // Auto-load if DOM is ready
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(() => loadAllModules(), 100);
  } else {
    document.addEventListener('DOMContentLoaded', () => loadAllModules());
  }

  console.log('[FLOWORKOS] 🧠 Smart Module System initialized (Phase 2 — Full Body)');
})();
