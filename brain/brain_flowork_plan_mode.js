// =========================================================================
// FLOWORK OS — Brain Plan Mode Module
// Allows AI to enter a "planning" mode where destructive tools are blocked
// until the plan is reviewed and approved step-by-step.
// =========================================================================

(function() {
    'use strict';

    const DESTRUCTIVE_TOOLS = new Set([
        'write_files', 'patch_file', 'smart_patch', 'delete_file', 'rename_file',
        'run_command', 'terminal_start', 'terminal_input',
        'git', 'compile_app', 'compile_script',
        'click_element', 'type_text', 'keyboard_event', 'drag_drop',
        'evolve_tool', 'evolve_prompt', 'evolve_skill',
    ]);

    const state = {
        active: false,
        plan: [],           // Array of { step: string, tool: string, input: object, status: 'pending'|'approved'|'executed'|'skipped' }
        currentStep: 0,
        createdAt: null,
        name: '',
    };

    // ─── Core API ────────────────────────────────────────────────────────

    function enterPlanMode(input) {
        if (state.active) return { result: 'Already in plan mode. Use exit_plan_mode to leave first.' };
        state.active = true;
        state.plan = [];
        state.currentStep = 0;
        state.createdAt = new Date().toISOString();
        state.name = input.name || 'Untitled Plan';
        console.log(`[PlanMode] 📋 Entered Plan Mode: "${state.name}"`);
        return {
            result: `✅ Plan Mode ACTIVATED: "${state.name}"\n` +
                    `Destructive tools (write, execute, click, etc.) are now BLOCKED.\n` +
                    `Add steps with advance_plan, or generate them with ultraplan_start.\n` +
                    `Use exit_plan_mode to leave and execute.`
        };
    }

    function exitPlanMode(input) {
        if (!state.active) return { result: 'Not in plan mode.' };
        const summary = _generatePlanSummary();
        state.active = false;
        state.plan = [];
        state.currentStep = 0;
        console.log('[PlanMode] 🚪 Exited Plan Mode');
        return {
            result: `✅ Plan Mode DEACTIVATED. All tools are now available.\n\n` +
                    `=== Plan Summary ===\n${summary}`
        };
    }

    function advancePlan(input) {
        if (!state.active) return { result: 'Not in plan mode. Use enter_plan_mode first.' };

        // If input has step details, add to plan
        if (input.step || input.description) {
            const step = {
                step: input.step || input.description,
                tool: input.tool || null,
                input: input.tool_input || null,
                status: 'pending',
            };
            state.plan.push(step);
            return {
                result: `📋 Step ${state.plan.length} added: "${step.step}"\n` +
                        (step.tool ? `  Tool: ${step.tool}\n` : '') +
                        `Total steps: ${state.plan.length}`
            };
        }

        // If no step details, approve and execute current step
        if (state.currentStep >= state.plan.length) {
            return { result: `All ${state.plan.length} steps completed. Use exit_plan_mode to finish.` };
        }

        const current = state.plan[state.currentStep];
        current.status = 'approved';
        state.currentStep++;
        return {
            result: `✅ Step ${state.currentStep}/${state.plan.length} approved: "${current.step}"\n` +
                    (current.tool ? `Execute: ${current.tool} with input: ${JSON.stringify(current.input)}` : 'No tool to execute.') +
                    `\n[AUTO_CONTINUE]`
        };
    }

    function cancelPlan(input) {
        if (!state.active) return { result: 'Not in plan mode.' };
        const totalSteps = state.plan.length;
        state.active = false;
        state.plan = [];
        state.currentStep = 0;
        console.log('[PlanMode] ❌ Plan cancelled');
        return { result: `❌ Plan cancelled. ${totalSteps} steps discarded. All tools re-enabled.` };
    }

    function ultraplanStart(input) {
        // Enter plan mode and auto-generate steps from the task
        if (!state.active) {
            enterPlanMode({ name: input.task || 'Ultraplan' });
        }

        const task = input.task || input.description || 'No task specified';
        return {
            result: `🧠 ULTRAPLAN activated for: "${task}"\n` +
                    `Plan Mode is now ACTIVE. You should:\n` +
                    `1. Analyze the task thoroughly\n` +
                    `2. Add steps using advance_plan with step descriptions\n` +
                    `3. Once all steps are planned, exit_plan_mode to begin execution\n` +
                    `\nStart planning now. Add each step with advance_plan.`
        };
    }

    // ─── Helpers ─────────────────────────────────────────────────────────

    function _generatePlanSummary() {
        if (state.plan.length === 0) return 'No steps were planned.';
        return state.plan.map((s, i) => {
            const icon = s.status === 'approved' ? '✅' : s.status === 'executed' ? '🔧' : s.status === 'skipped' ? '⏭️' : '⏳';
            return `${icon} Step ${i+1}: ${s.step} [${s.status}]`;
        }).join('\n');
    }

    /**
     * Check if a tool should be blocked in plan mode.
     * Called by the master executeTool dispatcher.
     */
    function isToolBlocked(toolName) {
        if (!state.active) return false;
        return DESTRUCTIVE_TOOLS.has(toolName);
    }

    function getBlockedMessage(toolName) {
        return {
            result: `🚫 [PLAN MODE] Tool "${toolName}" is BLOCKED during planning.\n` +
                    `Add it as a plan step instead:\n` +
                    `  advance_plan({ step: "Execute ${toolName}", tool: "${toolName}" })\n` +
                    `Or exit_plan_mode to enable all tools.`
        };
    }

    function getState() {
        return { ...state, totalSteps: state.plan.length };
    }

    // ─── Expose ──────────────────────────────────────────────────────────
    window.floworkPlanMode = {
        enter: enterPlanMode,
        exit: exitPlanMode,
        advance: advancePlan,
        cancel: cancelPlan,
        ultraplan: ultraplanStart,
        isToolBlocked,
        getBlockedMessage,
        getState,
    };
    // ─── Compat alias for tool_registry.js (line 388) ────────────────────
    window.isPlanModeBlocked = isToolBlocked;

    console.log('[Brain] ✅ Plan Mode module loaded');

})();
