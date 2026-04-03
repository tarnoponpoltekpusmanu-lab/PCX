/**
 * ============================================================
 *  FLOWORKOS™ Tool Policy Engine
 *  FLOWORKOS™ native tool security engine
 * ============================================================
 *  Logic: Enforce security policies on tool execution:
 *  - Allowlist/blocklist per tool
 *  - Before-tool-call hooks (validation before execution)
 *  - Path policy (restrict file access to workspace only)
 *  - Dangerous command detection (rm -rf, format, etc.)
 *  - Rate limiting per tool
 * ============================================================
 */

(function () {
  'use strict';

  // ── Default Policy ─────────────────────────────────────────
  const DEFAULT_POLICY = {
    // Tools that are always allowed
    allowlist: [
      'read_file', 'list_files', 'search_files', 'get_file_info',
      'kb_search', 'memory_search', 'tools_search',
      'recall_knowledge',
    ],

    // Tools that require explicit approval
    requireApproval: [
      'run_command', 'execute_command', 'shell',
      'delete_file', 'remove_file',
    ],

    // Tools that are always blocked
    blocklist: [],

    // Dangerous command patterns (for run_command type tools)
    dangerousCommands: [
      /\brm\s+-rf\s+[\/\\]/i,                   // rm -rf /
      /\bformat\s+[a-z]:/i,                      // format C:
      /\bdel\s+\/[sq]\s+[a-z]:\\(?:windows|system)/i, // del /s /q C:\Windows
      /\bmkfs\b/i,                                // mkfs (format disk)
      /\bdd\s+if=/i,                              // dd (disk destroyer)
      /\b(?:shutdown|reboot|restart)\s+(?:\/s|\/r|-h|-r)/i, // Shutdown/reboot
      /\breg\s+delete\b/i,                        // Registry delete
      /\bnet\s+user\s+\w+\s+\/delete/i,          // Delete user account
      /\bnpm\s+publish\b/i,                       // Publish to npm
      /\bgit\s+push\s+[-\w]*\s*--force/i,        // Force push
      /\bdrop\s+(?:database|table)\b/i,           // SQL drop
      /\btruncate\s+table\b/i,                    // SQL truncate
    ],

    // Path restrictions
    pathPolicy: {
      enabled: true,
      allowedPaths: [],    // Will be populated with workspace paths
      blockedPaths: [
        'C:\\Windows',
        'C:\\Program Files',
        '/etc', '/usr', '/bin', '/sbin',
        '/System', '/Library',
      ],
    },

    // Rate limiting
    rateLimits: {
      enabled: false,
      maxCallsPerMinute: 60,
      maxCallsPerTool: 20,     // Per tool per minute
    },
  };

  // ── State ──────────────────────────────────────────────────
  let _policy = { ...DEFAULT_POLICY };
  const _toolCallCounts = new Map();   // tool → { count, windowStart }
  const _beforeCallHooks = [];         // Array of hook functions
  const _afterCallHooks = [];          // Array of hook functions

  // ── Policy Configuration ───────────────────────────────────

  /**
   * Update the active policy
   */
  function setPolicy(policy) {
    _policy = { ...DEFAULT_POLICY, ...policy };
    if (policy.pathPolicy) {
      _policy.pathPolicy = { ...DEFAULT_POLICY.pathPolicy, ...policy.pathPolicy };
    }
    console.log('[FLOWORKOS ToolPolicy] Policy updated');
  }

  function getPolicy() {
    return { ..._policy };
  }

  /**
   * Add workspace paths to allowed paths
   */
  function addAllowedPaths(...paths) {
    for (const p of paths) {
      if (p && !_policy.pathPolicy.allowedPaths.includes(p)) {
        _policy.pathPolicy.allowedPaths.push(p);
      }
    }
  }

  // ── Hooks ──────────────────────────────────────────────────

  /**
   * Register a before-tool-call hook
   * @param {Function} hook - async (toolName, params) => { allow: boolean, reason?: string }
   */
  function addBeforeCallHook(hook) {
    if (typeof hook === 'function') _beforeCallHooks.push(hook);
  }

  function addAfterCallHook(hook) {
    if (typeof hook === 'function') _afterCallHooks.push(hook);
  }

  // ── Policy Evaluation ──────────────────────────────────────

  /**
   * Evaluate whether a tool call should be allowed
   *
   * @param {string} toolName - The tool being called
   * @param {Object} params - Tool parameters
   * @returns {{ allowed: boolean, reason?: string, requireApproval?: boolean, warnings: string[] }}
   */
  function evaluatePolicy(toolName, params) {
    const warnings = [];

    // 1. Check blocklist
    if (_policy.blocklist.includes(toolName)) {
      return { allowed: false, reason: `Tool "${toolName}" is blocked by policy`, warnings };
    }

    // 2. Check allowlist (always allowed)
    const isAllowlisted = _policy.allowlist.includes(toolName);

    // 3. Check if approval required
    const needsApproval = _policy.requireApproval.includes(toolName);

    // 4. Dangerous command check
    if (_isCommandTool(toolName)) {
      const cmdString = _extractCommandString(params);
      if (cmdString) {
        const dangerCheck = checkDangerousCommand(cmdString);
        if (dangerCheck.isDangerous) {
          return {
            allowed: false,
            reason: `🚨 DANGEROUS COMMAND BLOCKED: ${dangerCheck.pattern}\nCommand: ${cmdString.slice(0, 200)}`,
            warnings: dangerCheck.warnings,
          };
        }
        if (dangerCheck.warnings.length > 0) {
          warnings.push(...dangerCheck.warnings);
        }
      }
    }

    // 5. Path policy check
    if (_policy.pathPolicy.enabled && _isFileAccessTool(toolName)) {
      const pathCheck = checkPathPolicy(params);
      if (!pathCheck.allowed) {
        return {
          allowed: false,
          reason: pathCheck.reason,
          warnings,
        };
      }
    }

    // 6. Rate limiting
    if (_policy.rateLimits.enabled) {
      const rateCheck = checkRateLimit(toolName);
      if (!rateCheck.allowed) {
        return {
          allowed: false,
          reason: rateCheck.reason,
          warnings,
        };
      }
    }

    return {
      allowed: true,
      requireApproval: needsApproval && !isAllowlisted,
      warnings,
    };
  }

  /**
   * Run the full policy pipeline (sync evaluation + async hooks)
   */
  async function evaluatePolicyPipeline(toolName, params) {
    // Static policy first
    const staticResult = evaluatePolicy(toolName, params);
    if (!staticResult.allowed) return staticResult;

    // Run before-call hooks
    for (const hook of _beforeCallHooks) {
      try {
        const hookResult = await hook(toolName, params);
        if (hookResult && !hookResult.allow) {
          return {
            allowed: false,
            reason: hookResult.reason || 'Blocked by before-call hook',
            warnings: staticResult.warnings,
          };
        }
      } catch (err) {
        console.warn(`[FLOWORKOS ToolPolicy] Hook error: ${err.message}`);
      }
    }

    return staticResult;
  }

  // ── Dangerous Command Detection ────────────────────────────

  function checkDangerousCommand(command) {
    const warnings = [];
    let isDangerous = false;
    let matchedPattern = '';

    for (const pattern of _policy.dangerousCommands) {
      if (pattern.test(command)) {
        isDangerous = true;
        matchedPattern = pattern.toString();
        warnings.push(`Matched dangerous pattern: ${matchedPattern}`);
      }
    }

    // Additional heuristic checks
    if (/\bsudo\b/.test(command)) {
      warnings.push('Command uses sudo (elevated privileges)');
    }
    if (/\|.*\bxargs\b.*\brm\b/.test(command)) {
      warnings.push('Piped deletion detected (xargs rm)');
    }
    if (/>\s*\/dev\/sd[a-z]/.test(command)) {
      warnings.push('Direct write to block device detected');
    }

    return { isDangerous, pattern: matchedPattern, warnings };
  }

  // ── Path Policy ────────────────────────────────────────────

  function checkPathPolicy(params) {
    const paths = _extractPaths(params);
    if (paths.length === 0) return { allowed: true };

    for (const path of paths) {
      const normalizedPath = path.replace(/\\/g, '/').toLowerCase();

      // Check blocked paths
      for (const blocked of _policy.pathPolicy.blockedPaths) {
        const normalizedBlocked = blocked.replace(/\\/g, '/').toLowerCase();
        if (normalizedPath.startsWith(normalizedBlocked)) {
          return {
            allowed: false,
            reason: `🚫 PATH BLOCKED: "${path}" is in a protected directory (${blocked})`,
          };
        }
      }

      // If allowedPaths is configured, check whitelist
      if (_policy.pathPolicy.allowedPaths.length > 0) {
        const isAllowed = _policy.pathPolicy.allowedPaths.some(allowed => {
          const normalizedAllowed = allowed.replace(/\\/g, '/').toLowerCase();
          return normalizedPath.startsWith(normalizedAllowed);
        });
        if (!isAllowed) {
          return {
            allowed: false,
            reason: `🚫 PATH OUTSIDE WORKSPACE: "${path}" is not in any allowed directory`,
          };
        }
      }
    }

    return { allowed: true };
  }

  // ── Rate Limiting ──────────────────────────────────────────

  function checkRateLimit(toolName) {
    const now = Date.now();
    const windowMs = 60_000; // 1 minute window

    let entry = _toolCallCounts.get(toolName);
    if (!entry || now - entry.windowStart > windowMs) {
      entry = { count: 0, windowStart: now };
      _toolCallCounts.set(toolName, entry);
    }

    entry.count++;

    if (entry.count > _policy.rateLimits.maxCallsPerTool) {
      return {
        allowed: false,
        reason: `Rate limit exceeded for "${toolName}": ${entry.count}/${_policy.rateLimits.maxCallsPerTool} calls/minute`,
      };
    }

    return { allowed: true };
  }

  // ── Helpers ────────────────────────────────────────────────

  function _isCommandTool(toolName) {
    return ['run_command', 'execute_command', 'shell', 'bash', 'exec', 'terminal'].includes(toolName);
  }

  function _isFileAccessTool(toolName) {
    return ['write_files', 'read_file', 'delete_file', 'create_file', 'edit_file',
            'move_file', 'copy_file', 'mkdir', 'rmdir', 'write_to_file'].includes(toolName);
  }

  function _extractCommandString(params) {
    if (typeof params === 'string') return params;
    if (!params || typeof params !== 'object') return null;
    return params.command || params.cmd || params.script || params.code || params.input || null;
  }

  function _extractPaths(params) {
    if (!params || typeof params !== 'object') return [];
    const paths = [];
    const keys = ['path', 'file', 'filepath', 'filename', 'directory', 'dir', 'target', 'source', 'destination'];
    for (const key of keys) {
      if (typeof params[key] === 'string') paths.push(params[key]);
    }
    // Check files array
    if (Array.isArray(params.files)) {
      for (const f of params.files) {
        if (typeof f === 'string') paths.push(f);
        if (f && typeof f.path === 'string') paths.push(f.path);
      }
    }
    return paths;
  }

  // ── Register to Window ─────────────────────────────────────
  window.FLOWORKOS_ToolPolicy = {
    evaluatePolicy,
    evaluatePolicyPipeline,
    checkDangerousCommand,
    checkPathPolicy,
    checkRateLimit,
    setPolicy,
    getPolicy,
    addAllowedPaths,
    addBeforeCallHook,
    addAfterCallHook,
    DEFAULT_POLICY,
  };

  console.log('[FLOWORKOS] ✅ Tool Policy Engine loaded');
})();
