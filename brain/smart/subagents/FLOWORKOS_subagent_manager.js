/**
 * ============================================================
 *  FLOWORKOS™ Sub-Agent Manager
 *  FLOWORKOS™ native sub-agent lifecycle manager
 * ============================================================
 *  Logic: Allow the main AI agent to spawn child agents for
 *  parallel sub-tasks. Features:
 *  - Spawn child agents with isolated context
 *  - Depth limiting (prevent infinite spawning)
 *  - Task delegation with auto-announce on completion
 *  - Kill/steer running sub-agents
 *  - Orphan recovery (detect abandoned children)
 * ============================================================
 */

(function () {
  'use strict';

  // ── Constants ──────────────────────────────────────────────
  const MAX_SPAWN_DEPTH = 3;           // Max nesting: main → child → grandchild
  const MAX_CHILDREN_PER_AGENT = 5;    // Max concurrent children
  const RUN_TIMEOUT_DEFAULT_SEC = 120; // 2 min default timeout per child
  const ORPHAN_CHECK_INTERVAL_MS = 30_000; // Check for orphans every 30s
  const MAX_STEER_MSG_CHARS = 4000;

  // ── Registry ───────────────────────────────────────────────
  const _runs = new Map();   // runId → SubagentRun
  const _bySession = new Map(); // childSessionId → runId
  const _byController = new Map(); // controllerSessionId → Set<runId>
  let _orphanCheckTimer = null;

  /**
   * @typedef {Object} SubagentRun
   * @property {string} runId
   * @property {string} childSessionId
   * @property {string} controllerSessionId
   * @property {string} task
   * @property {string} label
   * @property {string} model
   * @property {number} depth
   * @property {number} createdAt
   * @property {number|null} endedAt
   * @property {string} status - 'running' | 'done' | 'failed' | 'killed' | 'timeout'
   * @property {string|null} result
   * @property {Object|null} outcome
   * @property {number} totalTokens
   */

  function _generateRunId() {
    return 'run_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function _generateSessionId() {
    return 'sub_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  // ── Spawn ──────────────────────────────────────────────────

  /**
   * Spawn a new sub-agent with its own task
   *
   * @param {Object} params
   * @param {string} params.task - Task description for the sub-agent
   * @param {string} [params.label] - Display label (e.g., "Research Agent")
   * @param {string} [params.model] - Override model for child
   * @param {number} [params.timeoutSec] - Timeout in seconds
   * @param {string} [params.controllerSessionId] - Parent session ID
   * @param {number} [params.currentDepth] - Current nesting depth
   * @returns {{ status: string, runId?: string, childSessionId?: string, error?: string }}
   */
  function spawnSubagent(params) {
    const task = (params.task || '').trim();
    if (!task) {
      return { status: 'error', error: 'Task description is required' };
    }

    const controllerSessionId = params.controllerSessionId || 'main';
    const currentDepth = params.currentDepth || 0;

    // Depth check
    if (currentDepth >= MAX_SPAWN_DEPTH) {
      return {
        status: 'forbidden',
        error: `Cannot spawn sub-agent: max depth reached (${currentDepth}/${MAX_SPAWN_DEPTH}). Complete current task first.`,
      };
    }

    // Children limit
    const activeChildren = countActiveRuns(controllerSessionId);
    if (activeChildren >= MAX_CHILDREN_PER_AGENT) {
      return {
        status: 'forbidden',
        error: `Cannot spawn: max concurrent children reached (${activeChildren}/${MAX_CHILDREN_PER_AGENT}). Wait for existing sub-agents to finish.`,
      };
    }

    const runId = _generateRunId();
    const childSessionId = _generateSessionId();
    const timeoutSec = params.timeoutSec || RUN_TIMEOUT_DEFAULT_SEC;

    const run = {
      runId,
      childSessionId,
      controllerSessionId,
      task,
      label: params.label || `SubAgent-${_runs.size + 1}`,
      model: params.model || 'inherit',
      depth: currentDepth + 1,
      createdAt: Date.now(),
      endedAt: null,
      status: 'running',
      result: null,
      outcome: null,
      totalTokens: 0,
      timeoutSec,
    };

    // Register
    _runs.set(runId, run);
    _bySession.set(childSessionId, runId);

    if (!_byController.has(controllerSessionId)) {
      _byController.set(controllerSessionId, new Set());
    }
    _byController.get(controllerSessionId).add(runId);

    // Set timeout
    if (timeoutSec > 0) {
      setTimeout(() => {
        const r = _runs.get(runId);
        if (r && !r.endedAt) {
          _markCompleted(runId, 'timeout', null, 'Sub-agent timed out');
        }
      }, timeoutSec * 1000);
    }

    console.log(`[FLOWORKOS SubAgent] 🚀 Spawned "${run.label}" (depth ${run.depth}, timeout ${timeoutSec}s)`);

    return {
      status: 'accepted',
      runId,
      childSessionId,
      label: run.label,
      depth: run.depth,
      note: 'Sub-agent spawned. Wait for completion event — do NOT poll.',
    };
  }

  // ── Completion ─────────────────────────────────────────────

  function _markCompleted(runId, status, result, error) {
    const run = _runs.get(runId);
    if (!run || run.endedAt) return;

    run.endedAt = Date.now();
    run.status = status;
    run.result = result;
    run.outcome = { status, error: error || null };

    const runtimeSec = ((run.endedAt - run.createdAt) / 1000).toFixed(1);
    console.log(`[FLOWORKOS SubAgent] ${status === 'done' ? '✅' : '❌'} "${run.label}" ${status} (${runtimeSec}s)`);

    // Auto-announce to controller
    _announceToController(run);
  }

  /**
   * Mark a sub-agent as completed (called by the sub-agent itself)
   */
  function completeSubagent(childSessionId, result) {
    const runId = _bySession.get(childSessionId);
    if (!runId) return { error: 'Unknown session' };
    _markCompleted(runId, 'done', result, null);
    return { status: 'ok' };
  }

  /**
   * Mark a sub-agent as failed
   */
  function failSubagent(childSessionId, error) {
    const runId = _bySession.get(childSessionId);
    if (!runId) return { error: 'Unknown session' };
    _markCompleted(runId, 'failed', null, error);
    return { status: 'ok' };
  }

  // ── Control ────────────────────────────────────────────────

  /**
   * Kill a running sub-agent
   */
  function killSubagent(runId) {
    const run = _runs.get(runId);
    if (!run) return { error: 'Unknown run' };
    if (run.endedAt) return { status: 'already_done', label: run.label };

    _markCompleted(runId, 'killed', null, 'Killed by controller');

    // Cascade kill children of this sub-agent
    const childRuns = _byController.get(run.childSessionId);
    let cascadeKilled = 0;
    if (childRuns) {
      for (const childRunId of childRuns) {
        const childRun = _runs.get(childRunId);
        if (childRun && !childRun.endedAt) {
          _markCompleted(childRunId, 'killed', null, 'Parent killed');
          cascadeKilled++;
        }
      }
    }

    return { status: 'ok', label: run.label, cascadeKilled };
  }

  /**
   * Kill all sub-agents for a controller
   */
  function killAllSubagents(controllerSessionId) {
    controllerSessionId = controllerSessionId || 'main';
    const runIds = _byController.get(controllerSessionId);
    if (!runIds || runIds.size === 0) return { killed: 0 };

    let killed = 0;
    for (const runId of runIds) {
      const run = _runs.get(runId);
      if (run && !run.endedAt) {
        _markCompleted(runId, 'killed', null, 'Kill all');
        killed++;
      }
    }
    return { killed };
  }

  /**
   * Send a steering message to a running sub-agent
   */
  function steerSubagent(runId, message) {
    const run = _runs.get(runId);
    if (!run) return { status: 'error', error: 'Unknown run' };
    if (run.endedAt) return { status: 'done', error: `${run.label} is already finished` };

    const truncated = (message || '').slice(0, MAX_STEER_MSG_CHARS);
    console.log(`[FLOWORKOS SubAgent] 📣 Steering "${run.label}": ${truncated.slice(0, 100)}...`);

    // In Flowork, steering injects a system message into the child's context
    return {
      status: 'accepted',
      runId,
      childSessionId: run.childSessionId,
      label: run.label,
      message: truncated,
    };
  }

  // ── Listing & Status ───────────────────────────────────────

  function listSubagents(controllerSessionId, recentMinutes) {
    controllerSessionId = controllerSessionId || 'main';
    recentMinutes = recentMinutes || 30;
    const now = Date.now();
    const recentCutoff = now - recentMinutes * 60_000;

    const runIds = _byController.get(controllerSessionId);
    if (!runIds) return { total: 0, active: [], recent: [], text: 'No sub-agents.' };

    const active = [];
    const recent = [];

    let index = 1;
    for (const runId of runIds) {
      const run = _runs.get(runId);
      if (!run) continue;

      const runtimeMs = (run.endedAt || now) - run.createdAt;
      const runtimeStr = _formatDuration(runtimeMs);
      const line = `${index}. ${run.label} (${run.model}, ${runtimeStr}) ${run.status} - ${run.task.slice(0, 72)}`;

      const item = {
        index, line, runId: run.runId, sessionId: run.childSessionId,
        label: run.label, task: run.task, status: run.status,
        depth: run.depth, runtime: runtimeStr, runtimeMs,
        model: run.model, totalTokens: run.totalTokens,
      };

      if (!run.endedAt) {
        active.push(item);
      } else if (run.endedAt >= recentCutoff) {
        recent.push(item);
      }
      index++;
    }

    const lines = [];
    lines.push('Active sub-agents:');
    lines.push(active.length ? active.map(a => a.line).join('\n') : '(none)');
    lines.push('');
    lines.push(`Recent (last ${recentMinutes}m):`);
    lines.push(recent.length ? recent.map(r => r.line).join('\n') : '(none)');

    return { total: runIds.size, active, recent, text: lines.join('\n') };
  }

  function getRunStatus(runId) {
    const run = _runs.get(runId);
    if (!run) return null;
    return {
      runId: run.runId,
      label: run.label,
      status: run.status,
      task: run.task,
      depth: run.depth,
      runtimeMs: (run.endedAt || Date.now()) - run.createdAt,
      result: run.result,
      outcome: run.outcome,
    };
  }

  function countActiveRuns(controllerSessionId) {
    const runIds = _byController.get(controllerSessionId || 'main');
    if (!runIds) return 0;
    let count = 0;
    for (const runId of runIds) {
      const run = _runs.get(runId);
      if (run && !run.endedAt) count++;
    }
    return count;
  }

  // ── Orphan Recovery ────────────────────────────────────────

  function checkOrphans() {
    const now = Date.now();
    const orphans = [];

    for (const [runId, run] of _runs) {
      if (run.endedAt) continue;
      const runtimeMs = now - run.createdAt;

      // Check if timed out
      if (run.timeoutSec > 0 && runtimeMs > run.timeoutSec * 1000) {
        _markCompleted(runId, 'timeout', null, 'Orphan timeout');
        orphans.push(run.label);
        continue;
      }

      // Check if controller is gone (very long running without update)
      if (runtimeMs > 10 * 60 * 1000) { // 10 minutes
        console.warn(`[FLOWORKOS SubAgent] ⚠️ Potential orphan: "${run.label}" running for ${_formatDuration(runtimeMs)}`);
      }
    }

    if (orphans.length > 0) {
      console.log(`[FLOWORKOS SubAgent] 🧹 Recovered ${orphans.length} orphan(s): ${orphans.join(', ')}`);
    }
  }

  function startOrphanMonitor() {
    if (_orphanCheckTimer) return;
    _orphanCheckTimer = setInterval(checkOrphans, ORPHAN_CHECK_INTERVAL_MS);
    console.log('[FLOWORKOS SubAgent] Orphan monitor started');
  }

  function stopOrphanMonitor() {
    if (_orphanCheckTimer) {
      clearInterval(_orphanCheckTimer);
      _orphanCheckTimer = null;
    }
  }

  // ── Auto-Announce ──────────────────────────────────────────

  function _announceToController(run) {
    // Inject completion event into controller's chat history
    if (!window.chatHistory) return;

    const statusEmoji = run.status === 'done' ? '✅' : run.status === 'killed' ? '🛑' : '❌';
    const runtimeSec = ((run.endedAt - run.createdAt) / 1000).toFixed(1);

    const announcement = [
      `[SUB-AGENT COMPLETE] ${statusEmoji} "${run.label}" — ${run.status} (${runtimeSec}s)`,
      run.result ? `Result: ${typeof run.result === 'string' ? run.result.slice(0, 500) : JSON.stringify(run.result).slice(0, 500)}` : '',
      run.outcome?.error ? `Error: ${run.outcome.error}` : '',
    ].filter(Boolean).join('\n');

    window.chatHistory.push({ role: 'system', content: announcement });
  }

  // ── Helpers ────────────────────────────────────────────────

  function _formatDuration(ms) {
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return sec + 's';
    const min = Math.floor(sec / 60);
    if (min < 60) return min + 'm ' + (sec % 60) + 's';
    const hr = Math.floor(min / 60);
    return hr + 'h ' + (min % 60) + 'm';
  }

  function resetAll() {
    _runs.clear();
    _bySession.clear();
    _byController.clear();
    stopOrphanMonitor();
  }

  // ── Register to Window ─────────────────────────────────────
  window.FLOWORKOS_SubAgents = {
    spawnSubagent,
    completeSubagent,
    failSubagent,
    killSubagent,
    killAllSubagents,
    steerSubagent,
    listSubagents,
    getRunStatus,
    countActiveRuns,
    checkOrphans,
    startOrphanMonitor,
    stopOrphanMonitor,
    resetAll,
    // Constants
    MAX_SPAWN_DEPTH,
    MAX_CHILDREN_PER_AGENT,
    RUN_TIMEOUT_DEFAULT_SEC,
  };

  // Start orphan monitor
  startOrphanMonitor();

  console.log('[FLOWORKOS] ✅ Sub-Agent Manager loaded');
})();
