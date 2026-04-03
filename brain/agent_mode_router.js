// =========================================================================
// FLOWORK OS - AI MODE ISOLATION SYSTEM
// FILE: agent_mode_router.js
// DESKRIPSI: Memisahkan AI berdasarkan konteks UI yang aktif.
//            Setiap mode hanya mendapat tools + directive yang RELEVAN.
//            Mencegah AI bingung (misalnya: cari TikTok di apps bukan browser)
// =========================================================================

// ─── AI MODE DEFINITIONS ─────────────────────────────────────────────
window.AI_MODES = {
    // Mode 1: APP BUILDER — di App Store & saat app terbuka di AI Builder
    APP_BUILDER: {
        id: 'app_builder',
        label: '🔨 App Builder',
        description: 'Build, edit, and deploy Flowork apps',
        allowedTools: [
            // File operations
            'write_files', 'read_file', 'patch_file', 'smart_patch', 'delete_file',
            'load_project_context', 'create_file',
            // Code intelligence 
            'analyze_code', 'search_files', 'find_definition', 'find_references',
            'document_symbols', 'hover_info', 'diff_preview',
            // Build & run
            'compile_script', 'run_command', 'open_app', 'close_app', 'auto_test_app',
            // App management
            'discover_apps', 'generate_icon', 
            // Git
            'git', 'worktree_create', 'worktree_exit', 'worktree_status',
            // Skills
            'invoke_skill', 'register_skill', 'list_skills',
            // Task management
            'todo_write', 'todo_list',
            // REPL
            'repl_start', 'repl_execute', 'repl_stop',
            // Knowledge & progress
            'save_knowledge', 'list_knowledge', 'save_progress', 'get_progress',
            // Chat
            'chat', 'ask_user',
            // Config
            'get_config', 'set_config', 'cost_report',
            // Compact
            'compact', 'set_auto_memory',
            // Glob & search
            'glob', 'tool_search',
            // Web
            'web_search', 'web_fetch', 'read_url',
            // Sleep
            'sleep',
            // Cross-mode tools (available everywhere)
            'capture_browser', 'list_browsers',
            // File attachment
            'attach_file',
            // Knowledge Base
            'kb_search', 'kb_read', 'kb_list', 'kb_publish', 'kb_update',
            // Reusable Tools (KV)
            'tools_search', 'tools_get', 'tools_save', 'tools_list',
            // v2: Session, Memory, Plan, Bridge, Auth, Feature Flags
            'session_save', 'session_restore', 'session_list',
            'remember', 'memory_search',
            'enter_plan_mode', 'exit_plan_mode',
            'bridge_start', 'bridge_stop', 'bridge_status',
            'auth_login', 'auth_logout', 'auth_status',
            'feature_enable', 'feature_disable', 'feature_list',
            'mcp_server_start', 'mcp_server_stop'
        ],
        directive: `You are an APP BUILDER AI. Full behavioral rules are loaded from KB article 'base-prompt-app-builder'.
Your workspace is the apps/ directory. Every app follows the Flowork Dual-Engine Architecture.
FOCUS: Write code, create files, compile backends, test apps.
DO NOT: Try to control browsers or automate web navigation.`
    },

    // Mode 2: NODE BUILDER
    NODE_BUILDER: {
        id: 'node_builder',
        label: '🧩 Node Builder',
        description: 'Create and edit workflow nodes for the visual flow editor',
        allowedTools: [
            'create_node', 'update_node', 'delete_node', 'list_nodes',
            'connect_nodes', 'disconnect_nodes',
            'write_files', 'read_file', 'patch_file', 'smart_patch',
            'search_files', 'load_project_context',
            'analyze_code', 'run_command', 'compile_script',
            'find_definition', 'find_references', 'document_symbols',
            'save_knowledge', 'list_knowledge', 'save_progress',
            'chat', 'ask_user',
            'get_config',
            'invoke_skill', 'list_skills',
            'todo_write', 'todo_list',
            'compact',
            'glob', 'tool_search',
            'sleep',
            // Cross-mode
            'capture_browser', 'list_browsers',
            'attach_file',
            // Knowledge Base
            'kb_search', 'kb_read', 'kb_list', 'kb_publish', 'kb_update',
            // Reusable Tools (KV)
            'tools_search', 'tools_get', 'tools_save', 'tools_list',
            // Workspace file access (universal)
            'list_workspace', 'read_workspace_file'
        ],
        directive: `You are a NODE BUILDER AI. Full behavioral rules are loaded from KB article 'base-prompt-node-builder'.
Nodes live in the nodes/ directory. Headless STDIN/STDOUT processors for the visual flow editor.
FOCUS: Design node schema, write executor logic, test with piped JSON.
DO NOT: Try to build full apps, control browsers, or navigate web pages.`
    },

    // Mode 3: BROWSER AUTOMATION — FULL SOCIAL MEDIA + WEB CONTROL
    BROWSER_AUTOMATION: {
        id: 'browser_automation',
        label: '🌐 Browser AI',
        description: 'Control and automate browser tabs',
        allowedTools: [
            // Browser operations (PRIMARY)
            'list_browsers', 'capture_browser', 'read_dom',
            'click_element', 'type_text', 'scroll_page',
            'keyboard_event', 'execute_browser_script',
            'mouse_drag', 'extract_data', 'get_console_logs',
            // Tab management
            'open_browser_tab', 'close_browser_tab', 'navigate_browser',
            // Media & files 
            'download_video', 'upload_to_page', 'attach_file',
            // Cookie management
            'import_cookies', 'export_cookies',
            // Workspace file access (CHECK HERE FIRST!)
            'list_workspace', 'read_workspace_file', 'read_file',
            // File search & discovery
            'glob', 'search_files',
            // Email (for signups)
            'email_generate', 'email_check_inbox', 'email_read',
            // Web
            'web_search', 'web_fetch', 'read_url',
            // Chat
            'chat', 'ask_user',
            // Knowledge
            'save_knowledge', 'list_knowledge',
            // Progress tracking
            'save_progress', 'get_progress',
            // Sleep/Wait
            'sleep', 'wait',
            // Compact
            'compact',
            // Cron
            'cron_create', 'cron_delete', 'cron_list',
            // Config
            'get_config',
            // Todo
            'todo_write', 'todo_list',
            // Run command (for yt-dlp etc)
            'run_command',
            // Knowledge Base
            'kb_search', 'kb_read', 'kb_list', 'kb_publish', 'kb_update',
            // Reusable Tools (KV)
            'tools_search', 'tools_get', 'tools_save', 'tools_list',
            // File writing (for saving downloaded content, creating temp files)
            'write_files', 'create_file'
        ],
        directive: `You are a BROWSER AUTOMATION AI. Full behavioral rules are loaded from KB article 'base-prompt-browser'.
You control browser tabs INSIDE the Flowork OS main window as native BrowserView tabs.
Flowork OS is ALREADY RUNNING — just use your tools directly.

# WORKSPACE FILES
Folders: cookies/, video/, musik/, media/, file/, images/
ALWAYS use list_workspace to find files. Then use read_workspace_file to READ them.
Example: { "action": "read_workspace_file", "path": "cookies/tiktok.txt" }
DO NOT use run_command/PowerShell to read files — use read_workspace_file instead.

# COOKIE IMPORT WORKFLOW (MANDATORY SEQUENCE)
Step 1: list_workspace("cookies/") → find cookie file
Step 2: read_workspace_file({ "path": "cookies/FILENAME" }) → get content
Step 3: open_browser_tab({ "url": "https://... " }) → open ONE tab (engine auto-reuses)
Step 4: import_cookies({ "netscape": "PASTE_FULL_CONTENT_HERE", "session_index": 1 }) → inject
Step 5: capture_browser → verify login
CRITICAL: In step 4, you MUST paste the ENTIRE file content as-is into "netscape". Do NOT truncate or modify it.

# TAB RULES
- open_browser_tab auto-reuses tabs for the same domain. DO NOT open multiple tabs for the same site.
- After opening a tab, WAIT 2-3 seconds, then capture_browser to see the state.
- Use the tabId from open_browser_tab's response for ALL subsequent browser tools.

# AUTONOMY
- Work autonomously until the task is DONE. Do NOT ask for confirmation mid-task.
- Use [AUTO_CONTINUE] after EVERY step to keep working.
- Only use [TASK_COMPLETE] when the ENTIRE task (open browser + import cookies + upload video etc.) is finished.
- Create your own roadmap and execute it without asking.

# DEBUG & VERIFY (after EVERY action)
- After open_browser_tab: sleep 2s → capture_browser → verify page loaded
- After import_cookies: capture_browser → verify login succeeded (check for avatar/username)
- After click_element: capture_browser → verify the click had the expected effect
- After type_text: capture_browser → verify text was entered
- After upload_to_page: capture_browser → verify upload progress
- If page shows error/captcha/unexpected state: get_console_logs → read_dom → fix → retry
- If action fails 3x: get_console_logs + read_dom + capture_browser → analyze → try new approach

# ANTI-LOOP
- NEVER call the same tool more than 2 times in a row.
- If you have results from kb_search/tools_search/list_workspace — USE them, don't search again.
- After PHASE 0, move to PHASE 1 immediately.`
    },

    // Mode 4: MAIN AI — universal
    MAIN: {
        id: 'main',
        label: '🤖 AI Assistant',
        description: 'Full-power AI with all capabilities',
        allowedTools: null,
        directive: `You are the MAIN AI ASSISTANT of Flowork OS. Full behavioral rules are loaded from KB article 'base-prompt-main'.
You have access to ALL tools and ALL capabilities.
Auto IDE Mode: IDE appears automatically when you write code.
Workspace: cookies/, video/, musik/, media/, file/, images/ — ALWAYS check before asking user.
NEVER confuse 'open_app' (local apps) with 'open_browser_tab' (websites).`
    },

    // Mode 5: PLAN MODE — Show execution plan before acting
    // Claude Code: EnterPlanModeTool / ExitPlanModeTool parity
    PLAN: {
        id: 'plan',
        label: '📋 Plan Mode',
        description: 'AI shows execution plan before acting, waits for approval',
        allowedTools: [
            'read_file', 'search_files', 'load_project_context', 'analyze_code',
            'list_browsers', 'capture_browser', 'discover_apps', 'list_nodes',
            'list_workflows', 'list_knowledge', 'glob', 'get_config',
            'find_definition', 'find_references', 'document_symbols',
            'kb_search', 'kb_read', 'kb_list',
            'tools_search', 'tools_get', 'tools_list',
            'web_search', 'read_url',
            'todo_list', 'git', 'cost_report',
            'enter_plan_mode', 'exit_plan_mode',
            'chat', 'update_roadmap', 'todo_write', 'compact'
        ],
        directive: `You are in PLAN MODE. You must NOT execute any destructive actions.

## PLAN MODE RULES:
1. RESEARCH ONLY: Use read-only tools to understand the codebase
2. CREATE PLAN: Use update_roadmap + todo_write to show your execution plan
3. SHOW PLAN: Present the plan to the user in a clear, structured format
4. WAIT FOR APPROVAL: Use [WAITING_APPROVAL] and wait for user to say "go" or "approve"
5. After approval: Use exit_plan_mode to switch back, then execute the plan

## WHAT YOU CAN DO:
- Read files, search code, analyze structure
- Create roadmaps and todo lists
- Search KB and tools
- Explain your approach

## WHAT YOU CANNOT DO:
- Write/patch/delete files
- Run commands
- Modify any state
- Execute browser actions

After researching, output your plan as:
## Execution Plan
1. [Step 1 description] > files affected
2. [Step 2 description] > files affected
...
## Estimated Impact
- Files modified: X
- New files: Y
- Commands to run: Z

Then use [WAITING_APPROVAL] to wait for user approval.`
    }
};

// ─── ACTIVE MODE STATE ───────────────────────────────────────────────
window.activeAIMode = 'main';

// ─── MODE SWITCHER ───────────────────────────────────────────────────
window.setAIMode = function(modeId) {
    const mode = Object.values(window.AI_MODES).find(m => m.id === modeId);
    if (!mode) { console.warn(`[AIMode] Unknown mode: ${modeId}`); return false; }
    window.activeAIMode = modeId;
    window.cachedSystemPrompt = null;
    console.log(`[AIMode] 🔄 Switched to: ${mode.label}`);
    if (window.appendToolMessage) window.appendToolMessage('AI Mode', 'success', `${mode.label}`);
    const indicator = document.getElementById('ai-mode-indicator');
    if (indicator) { indicator.textContent = mode.label; indicator.title = mode.description; }
    return true;
};

// ─── TOOL FILTER ─────────────────────────────────────────────────────
window.getFilteredToolSection = function(fullToolSection) {
    const mode = Object.values(window.AI_MODES).find(m => m.id === window.activeAIMode);
    if (!mode || mode.allowedTools === null) return fullToolSection;
    const lines = fullToolSection.split('\n');
    const filtered = [];
    let insideAllowedTool = false;
    for (const line of lines) {
        const toolMatch = line.match(/"action"\s*:\s*"(\w+)"/);
        if (toolMatch) insideAllowedTool = mode.allowedTools.includes(toolMatch[1]);
        if (line.startsWith('##') || line.startsWith('# ')) { filtered.push(line); insideAllowedTool = true; continue; }
        if (insideAllowedTool || line.trim() === '') filtered.push(line);
    }
    return filtered.join('\n');
};

// ─── MODE DIRECTIVE INJECTOR ─────────────────────────────────────────
// ─── MODE DIRECTIVE INJECTOR ─────────────────────────────────────────
window.getModeDirective = function() {
    const mode = Object.values(window.AI_MODES).find(m => m.id === window.activeAIMode);
    if (!mode) return '';
    
    const UNIVERSAL_SOP = `
# MANDATORY LIFECYCLE SOP 
You MUST adhere to this exact 4-step sequence for EVERY new task:

1. MEMORY & RESEARCH CHECK: 
   - Before writing code or proposing a plan, ALWAYS consult your memory using 'kb_search', 'tools_search', or 'list_workspace'.
   - If no similar solution exists locally, you MUST fallback to 'web_search' or 'read_url' to pull accurate modern documentation.
   
2. PLANNING & IMPLEMENTING: 
   - Write your implementation plan into a file (e.g. 'workspace/plan.md') using 'write_files' SO THAT it auto-opens in the user's Dashboard IDE.
   - Proceed to write the actual code (also using 'write_files').

3. POST-TASK DELIVERY (DO NOT END TASK YET): 
   - When implementation is finished, STOP. Call 'chat' or 'ask_user' and explicitly ask the user: "Apakah Anda puas dengan hasilnya?"
   - Do NOT use [TASK_COMPLETE] until the user confirms they are satisfied!

4. KB PUBLISHING & CLOSE: 
   - Once the user replies that they are satisfied, you MUST strip any sensitive data (API keys, passwords, personal info) from your code.
   - Save a reusable summary or template into the Knowledge Base using 'kb_publish' or 'tools_save'.
   - Finally, use 'chat' to thank the user gracefully and politely ask if there's any other task you can help with, while marking the job complete.
`;

    return `\n\n# ═══ CURRENT AI MODE: ${mode.label.toUpperCase()} ═══\n${mode.directive}\n${UNIVERSAL_SOP}\n`;
};

// ─── TOOL CALL GUARD ─────────────────────────────────────────────────
window.isToolAllowedInMode = function(toolName) {
    const mode = Object.values(window.AI_MODES).find(m => m.id === window.activeAIMode);
    if (!mode || mode.allowedTools === null) return true;
    return mode.allowedTools.includes(toolName);
};

// ─── AUTO-MODE DETECTION ─────────────────────────────────────────────
window.detectAIModeFromContext = function() {
    const browserPanel = document.querySelector('.grid-dummy-card');
    const hasOpenBots = document.getElementById('bot-selector')?.options?.length > 1;
    const isInBuilder = window.location.href.includes('ai-builder') || document.getElementById('chat-panel') !== null;
    const isInCanvas = document.getElementById('flow-canvas') !== null || document.querySelector('.node-editor') !== null;
    const navFlow = document.getElementById('fw-nav-flow');
    if (isInCanvas || (navFlow && navFlow.classList.contains('active'))) return 'node_builder';
    if (isInBuilder) {
        const outputType = document.getElementById('select-output-type')?.value;
        if (outputType === 'browser') return 'browser_automation';
        return 'app_builder';
    }
    if (hasOpenBots && browserPanel) return 'browser_automation';
    return 'main';
};

// ─── PLAN MODE HELPERS ───────────────────────────────────────────────
window.enterPlanMode = function() {
    window._prePlanMode = window.activeAIMode;
    window.setAIMode('plan');
    console.log('[PlanMode] Entered plan mode');
    if (window.appendToolMessage) window.appendToolMessage('Plan Mode', 'success', 'Plan mode active - AI will show plan before acting');
    return { status: 'plan_mode_active', previousMode: window._prePlanMode };
};

window.exitPlanMode = function() {
    const prevMode = window._prePlanMode || 'main';
    window.setAIMode(prevMode);
    window._prePlanMode = null;
    console.log('[PlanMode] Exited plan mode -> ' + prevMode);
    if (window.appendToolMessage) window.appendToolMessage('Plan Mode', 'success', 'Plan approved - switching to ' + prevMode);
    return { status: 'plan_mode_exited', restoredMode: prevMode };
};

// ─── INITIALIZE ──────────────────────────────────────────────────────
console.log('[Flowork OS] AI Mode Router v2 loaded (+ Plan Mode)');
console.log('[Flowork OS] Modes: ' + Object.values(window.AI_MODES).map(m => m.label).join(', '));
