// =========================================================================
// FLOWORK OS — Brain Permissions Module
// Security layer: controls which tools can run and logs all executions.
// Modes: auto (allow all), ask (prompt for write/exec), strict (block destructive)
// =========================================================================

(function() {
    'use strict';

    const STORAGE_KEY = 'flowork_permissions';

    const DESTRUCTIVE_TOOLS = new Set([
        'write_files', 'patch_file', 'smart_patch', 'delete_file', 'rename_file',
        'run_command', 'terminal_start', 'terminal_input', 'terminal_kill',
        'git', 'compile_app', 'compile_script',
        'click_element', 'type_text', 'keyboard_event', 'drag_drop',
        'evolve_tool', 'evolve_prompt', 'evolve_skill', 'self_improve',
        'kb_publish', 'kb_update', 'tools_save',
        'close_browser_tab', 'close_app',
    ]);

    let state = {
        mode: 'auto',       // 'auto' | 'ask' | 'strict'
        auditTrail: [],     // { tool, inputHash, ts, allowed, mode }
        blocked: 0,
        allowed: 0,
    };

    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) state = { ...state, ...JSON.parse(saved) };
    } catch(e) {}

    function _save() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch(e) {}
    }

    function _hash(obj) {
        const str = JSON.stringify(obj || {});
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        return hash.toString(16);
    }

    // ─── Core: Check if a tool is allowed ───────────────────────────────
    function checkPermission(toolName, input) {
        const isDestructive = DESTRUCTIVE_TOOLS.has(toolName);
        let allowed = true;
        let reason = '';

        switch (state.mode) {
            case 'strict':
                if (isDestructive) {
                    allowed = false;
                    reason = `STRICT mode: destructive tool "${toolName}" blocked`;
                }
                break;
            case 'ask':
                // In autonomous mode, "ask" treats destructive as allowed but logged with warning
                // In future: could prompt user via ask_user tool
                if (isDestructive) {
                    reason = `ASK mode: destructive tool "${toolName}" — auto-allowed (autonomous)`;
                }
                break;
            case 'auto':
            default:
                reason = 'AUTO mode: all tools allowed';
                break;
        }

        // Log to audit trail
        const entry = {
            tool: toolName,
            inputHash: _hash(input),
            ts: new Date().toISOString(),
            allowed,
            mode: state.mode,
            destructive: isDestructive,
            reason,
        };
        state.auditTrail.push(entry);
        if (state.auditTrail.length > 1000) state.auditTrail = state.auditTrail.slice(-1000);

        if (allowed) state.allowed++;
        else state.blocked++;

        _save();
        return { allowed, reason };
    }

    // ─── Tool Handlers ──────────────────────────────────────────────────

    function setPermissionMode(input) {
        const newMode = (input.mode || '').toLowerCase();
        if (!['auto', 'ask', 'strict'].includes(newMode)) {
            return { result: `Invalid mode: "${newMode}". Valid modes: auto, ask, strict` };
        }
        const oldMode = state.mode;
        state.mode = newMode;
        _save();
        console.log(`[Permissions] 🔐 Mode changed: ${oldMode} → ${newMode}`);
        return {
            result: `🔐 Permission mode changed: ${oldMode.toUpperCase()} → ${newMode.toUpperCase()}\n\n` +
                    `• auto: All tools allowed without restriction\n` +
                    `• ask: Destructive tools logged with warnings\n` +
                    `• strict: Destructive tools BLOCKED entirely\n\n` +
                    `Current: ${newMode.toUpperCase()}`
        };
    }

    function getPermissionStatus(input) {
        return {
            result: JSON.stringify({
                mode: state.mode,
                totalAllowed: state.allowed,
                totalBlocked: state.blocked,
                destructiveToolCount: DESTRUCTIVE_TOOLS.size,
                auditTrailEntries: state.auditTrail.length,
                recentActions: state.auditTrail.slice(-10).map(e => ({
                    tool: e.tool,
                    allowed: e.allowed,
                    destructive: e.destructive,
                    ts: e.ts,
                })),
            }, null, 2)
        };
    }

    function getAuditTrail(input) {
        const limit = input.limit || 50;
        const toolFilter = input.tool;
        let trail = state.auditTrail;

        if (toolFilter) {
            trail = trail.filter(e => e.tool === toolFilter);
        }

        const recent = trail.slice(-limit);

        let report = `📜 AUDIT TRAIL (${recent.length} of ${trail.length} entries)\n`;
        report += `Permission Mode: ${state.mode.toUpperCase()}\n`;
        report += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

        for (const e of recent) {
            const icon = e.allowed ? '✅' : '🚫';
            const dIcon = e.destructive ? '⚠️' : '  ';
            report += `${icon} ${dIcon} ${e.tool} | ${e.ts}\n`;
        }

        report += `\nTotal: ✅ ${state.allowed} allowed | 🚫 ${state.blocked} blocked`;
        return { result: report };
    }

    // ─── Expose ──────────────────────────────────────────────────────────
    window.floworkPermissions = {
        checkPermission,
        setPermissionMode,
        getPermissionStatus,
        getAuditTrail,
        getMode: () => state.mode,
        isDestructive: (tool) => DESTRUCTIVE_TOOLS.has(tool),
    };

    console.log(`[Brain] ✅ Permissions module loaded (mode: ${state.mode})`);

})();
