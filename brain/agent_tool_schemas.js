// =========================================================================
// FLOWORK OS - CLAUDE CODE FULL PARITY
// FILE: agent_tool_schemas.js
// DESCRIPTION: Tool Schema Validation (Zod-like) for all 70+ tools
//              Prevents malformed AI tool calls from causing silent failures
// =========================================================================

window.toolSchemas = {
    // ─── File Operations ────────────────────────────────────────────
    'write_files':    { required: ['files'], props: { files: 'object' } },
    'patch_file':     { required: ['file', 'search', 'replace'], props: { file: 'string', search: 'string', replace: 'string' } },
    'smart_patch':    { required: ['file', 'patches'], props: { file: 'string', patches: 'array' } },
    'read_file':      { required: [], props: { file: 'string' } },
    'delete_file':    { required: ['file'], props: { file: 'string' } },
    'rename_file':    { required: ['old_name', 'new_name'], props: { old_name: 'string', new_name: 'string' } },
    'search_files':   { required: ['query'], props: { query: 'string' } },

    // ─── Terminal ───────────────────────────────────────────────────
    'run_command':    { required: ['command'], props: { command: 'string' } },
    'terminal_start': { required: ['command'], props: { command: 'string', session_id: 'string' } },
    'terminal_status':{ required: ['session_id'], props: { session_id: 'string' } },
    'terminal_input': { required: ['session_id', 'input'], props: { session_id: 'string', input: 'string' } },
    'terminal_kill':  { required: ['session_id'], props: { session_id: 'string' } },

    // ─── Browser ────────────────────────────────────────────────────
    'open_browser_tab':     { required: ['url'], props: { url: 'string', label: 'string' } },
    'close_browser_tab':    { required: ['tab_id'], props: { tab_id: 'string' } },
    'navigate_browser':     { required: ['tab_id', 'url'], props: { tab_id: 'string', url: 'string' } },
    'capture_browser':      { required: ['tabId'], props: { tabId: 'string' } },
    'click_element':        { required: ['tabId', 'selector'], props: { tabId: 'string', selector: 'string' } },
    'type_text':            { required: ['tabId', 'selector', 'text'], props: { tabId: 'string', selector: 'string', text: 'string' } },
    'scroll_page':          { required: ['tabId'], props: { tabId: 'string', direction: 'string' } },
    'read_dom':             { required: ['tabId'], props: { tabId: 'string' } },
    'keyboard_event':       { required: ['tabId', 'key'], props: { tabId: 'string', key: 'string' } },
    'execute_browser_script': { required: ['tabId', 'script'], props: { tabId: 'string', script: 'string' } },
    'get_console_logs':     { required: ['tabId'], props: { tabId: 'string' } },
    'import_cookies':       { required: ['tabId', 'netscape'], props: { tabId: 'string', netscape: 'string' } },
    'export_cookies':       { required: ['tabId'], props: { tabId: 'string' } },

    // ─── App Operations ─────────────────────────────────────────────
    'open_app':       { required: ['app_name'], props: { app_name: 'string' } },
    'close_app':      { required: ['app_name'], props: { app_name: 'string' } },
    'compile_script': { required: ['script_path', 'app_name'], props: { script_path: 'string', app_name: 'string' } },

    // ─── Knowledge Base ─────────────────────────────────────────────
    'kb_search':      { required: ['query'], props: { query: 'string', category: 'string' } },
    'kb_read':        { required: ['id'], props: { id: 'string' } },
    'save_knowledge': { required: ['title', 'content'], props: { title: 'string', content: 'string', category: 'string' } },

    // ─── Reusable Tools ─────────────────────────────────────────────
    'tools_search':   { required: ['query'], props: { query: 'string', category: 'string' } },
    'tools_get':      { required: ['id'], props: { id: 'string' } },
    'tools_save':     { required: ['tool'], props: { tool: 'object' } },

    // ─── Git ────────────────────────────────────────────────────────
    'git':            { required: ['git_action'], props: { git_action: 'string' } },
    'worktree_create':{ required: ['name'], props: { name: 'string', branch: 'string' } },
    'worktree_exit':  { required: [], props: { keep_changes: 'boolean' } },

    // ─── Coordinator ────────────────────────────────────────────────
    'spawn_agent':    { required: ['task'], props: { task: 'string', type: 'string' } },
    'check_agent':    { required: ['agent_id'], props: { agent_id: 'string' } },
    'create_team':    { required: ['name', 'goal'], props: { name: 'string', goal: 'string', tasks: 'array' } },

    // ─── Cron ───────────────────────────────────────────────────────
    'cron_create':    { required: ['prompt', 'cron'], props: { prompt: 'string', cron: 'string', recurring: 'boolean' } },
    'cron_delete':    { required: ['job_id'], props: { job_id: 'string' } },
    'cron_list':      { required: [], props: {} },

    // ─── MCP ────────────────────────────────────────────────────────
    'mcp_connect':    { required: ['server_id', 'command'], props: { server_id: 'string', command: 'string', args: 'array' } },
    'mcp_call_tool':  { required: ['tool_name'], props: { tool_name: 'string', arguments: 'object' } },

    // ─── Plan Mode ──────────────────────────────────────────────────
    'enter_plan_mode': { required: [], props: {} },
    'exit_plan_mode':  { required: [], props: {} },

    // ─── Misc ───────────────────────────────────────────────────────
    'web_search':     { required: ['query'], props: { query: 'string' } },
    'web_fetch':      { required: ['url'], props: { url: 'string', method: 'string' } },
    'read_url':       { required: ['url'], props: { url: 'string' } },
    'invoke_skill':   { required: ['skill'], props: { skill: 'string', args: 'string' } },
    'glob':           { required: ['pattern'], props: { pattern: 'string', base_path: 'string' } },
    'sleep':          { required: ['duration_ms'], props: { duration_ms: 'number' } },

    // ─── Session Persistence ────────────────────────────────────────
    'session_save':    { required: [], props: { label: 'string' } },
    'session_restore': { required: [], props: { session_id: 'string' } },
    'session_list':    { required: [], props: {} },

    // ─── Memory Management ──────────────────────────────────────────
    'remember':        { required: ['fact'], props: { fact: 'string', level: 'string' } },
    'save_memory':     { required: ['fact'], props: { fact: 'string', level: 'string' } },
    'memory_search':   { required: ['query'], props: { query: 'string', limit: 'number' } },

    // ─── MCP Server ─────────────────────────────────────────────────
    'mcp_server_start': { required: [], props: { port: 'number' } },
    'mcp_server_stop':  { required: [], props: {} },

    // ─── IDE Bridge ─────────────────────────────────────────────────
    'bridge_start':    { required: [], props: { port: 'number' } },
    'bridge_stop':     { required: [], props: {} },
    'bridge_status':   { required: [], props: {} },

    // ─── Auth ───────────────────────────────────────────────────────
    'auth_login':      { required: ['provider'], props: { provider: 'string' } },
    'auth_logout':     { required: [], props: { provider: 'string' } },
    'auth_status':     { required: [], props: {} },

    // ─── Feature Flags ──────────────────────────────────────────────
    'feature_enable':  { required: ['flag'], props: { flag: 'string' } },
    'feature_disable': { required: ['flag'], props: { flag: 'string' } },
    'feature_list':    { required: [], props: {} },

    // ─── Worktree ───────────────────────────────────────────────────
    'worktree_status': { required: [], props: {} },

    // ─── Compact ────────────────────────────────────────────────────
    'compact':         { required: [], props: { force: 'boolean' } },

    // ═══════════════════════════════════════════════════════════════
    // FULL PARITY: All remaining engine tools
    // ═══════════════════════════════════════════════════════════════

    // ─── Code Intelligence ──────────────────────────────────────────
    'analyze_code':       { required: [], props: { app_name: 'string' } },
    'dependency_graph':   { required: [], props: { app_name: 'string' } },
    'find_definition':    { required: [], props: { file_content: 'string', symbol: 'string' } },
    'find_references':    { required: [], props: { file_content: 'string', symbol: 'string' } },
    'document_symbols':   { required: [], props: { file_content: 'string', language: 'string' } },
    'hover_info':         { required: [], props: { file_content: 'string', symbol: 'string', language: 'string' } },
    'diff_preview':       { required: ['file', 'search', 'replace'], props: { file: 'string', search: 'string', replace: 'string' } },

    // ─── Browser Extended ───────────────────────────────────────────
    'list_browsers':      { required: [], props: {} },
    'download_video':     { required: [], props: { tabId: 'string', filename: 'string' } },
    'upload_to_page':     { required: ['file_path'], props: { tabId: 'string', file_path: 'string', selector: 'string' } },
    'drag_drop':          { required: ['tabId'], props: { tabId: 'string', source_selector: 'string', target_selector: 'string' } },
    'get_console_logs':   { required: ['tabId'], props: { tabId: 'string' } },
    'import_cookies':     { required: ['tabId', 'netscape'], props: { tabId: 'string', netscape: 'string' } },
    'export_cookies':     { required: ['tabId'], props: { tabId: 'string' } },

    // ─── App Management ─────────────────────────────────────────────
    'discover_apps':      { required: [], props: {} },
    'generate_icon':      { required: ['name'], props: { name: 'string', emoji: 'string', color: 'string' } },
    'rollback':           { required: ['app_id'], props: { app_id: 'string', files: 'array' } },
    'list_installed_apps': { required: [], props: {} },
    'auto_test_app':      { required: [], props: { app_name: 'string' } },

    // ─── Node / Workflow ────────────────────────────────────────────
    'create_node':        { required: [], props: { name: 'string', type: 'string' } },
    'list_nodes':         { required: [], props: {} },
    'create_workflow':    { required: [], props: { name: 'string' } },
    'update_workflow':    { required: [], props: { id: 'string' } },
    'execute_workflow':   { required: [], props: { id: 'string' } },
    'list_workflows':     { required: [], props: {} },

    // ─── Knowledge Base Extended ────────────────────────────────────
    'list_knowledge':     { required: [], props: { category: 'string' } },
    'recall_knowledge':   { required: ['query'], props: { query: 'string' } },
    'kb_list':            { required: [], props: { category: 'string' } },
    'kb_publish':         { required: ['title', 'content'], props: { title: 'string', content: 'string', category: 'string' } },
    'kb_update':          { required: ['id'], props: { id: 'string', content: 'string' } },

    // ─── Progress & Roadmap ─────────────────────────────────────────
    'save_progress':      { required: [], props: { status: 'string', detail: 'string' } },
    'read_progress':      { required: [], props: {} },
    'update_roadmap':     { required: [], props: { items: 'array' } },
    'suggest_next':       { required: [], props: {} },

    // ─── Workspace ──────────────────────────────────────────────────
    'list_workspace':     { required: [], props: { path: 'string' } },
    'read_workspace_file': { required: ['path'], props: { path: 'string' } },
    'load_project_context': { required: [], props: { app_name: 'string' } },

    // ─── Config ─────────────────────────────────────────────────────
    'get_config':         { required: [], props: {} },
    'set_config':         { required: ['key', 'value'], props: { key: 'string' } },
    'set_auto_memory':    { required: [], props: { enabled: 'boolean' } },

    // ─── Multi-Agent / Team ─────────────────────────────────────────
    'check_agent':        { required: ['agent_id'], props: { agent_id: 'string' } },
    'list_agents':        { required: [], props: { filter: 'string' } },
    'list_teams':         { required: [], props: {} },
    'delete_team':        { required: ['team_id'], props: { team_id: 'string' } },

    // ─── Evolution & System ─────────────────────────────────────────
    'evolution_start':    { required: [], props: {} },
    'evolution_stop':     { required: [], props: {} },
    'evolution_status':   { required: [], props: {} },
    'self_restart':       { required: [], props: {} },
    'self_shutdown':      { required: [], props: {} },
    'self_review':        { required: [], props: {} },
    'system_health':      { required: [], props: {} },
    'schedule_task':      { required: ['task_name', 'schedule'], props: { task_name: 'string', schedule: 'string', command: 'string' } },
    'prevent_sleep':      { required: [], props: { enabled: 'boolean' } },

    // ─── Permission & Audit ─────────────────────────────────────────
    'set_permission_mode': { required: ['mode'], props: { mode: 'string' } },
    'get_permission_status': { required: [], props: {} },
    'get_audit_trail':    { required: [], props: { count: 'number' } },

    // ─── Cost & Telemetry ───────────────────────────────────────────
    'cost_report':        { required: [], props: {} },
    'cost_status':        { required: [], props: {} },
    'get_token_usage':    { required: [], props: {} },
    'telemetry_report':   { required: [], props: {} },
    'tool_usage_report':  { required: [], props: {} },

    // ─── Todo ───────────────────────────────────────────────────────
    'todo_write':         { required: ['todos'], props: { todos: 'array' } },
    'todo_list':          { required: [], props: { filter: 'string' } },

    // ─── REPL ───────────────────────────────────────────────────────
    'repl_start':         { required: [], props: { language: 'string' } },
    'repl_execute':       { required: ['code'], props: { session_id: 'string', code: 'string' } },
    'repl_stop':          { required: [], props: { session_id: 'string' } },

    // ─── Skills Extended ────────────────────────────────────────────
    'register_skill':     { required: ['name'], props: { name: 'string', description: 'string', prompt: 'string' } },
    'list_skills':        { required: [], props: {} },
    'tool_search':        { required: ['query'], props: { query: 'string', max_results: 'number' } },

    // ─── Chat / Messaging ───────────────────────────────────────────
    'chat':               { required: [], props: { message: 'string' } },
    'ask_user':           { required: ['question'], props: { question: 'string' } },
    'send_message':       { required: ['message'], props: { message: 'string', target: 'string' } },

    // ─── Voice ──────────────────────────────────────────────────────
    'voice_start':        { required: [], props: {} },
    'voice_stop':         { required: [], props: {} },

    // ─── Email ──────────────────────────────────────────────────────
    'email_check_inbox':  { required: [], props: {} },
    'email_read':         { required: ['id'], props: { id: 'string' } },
    'email_generate':     { required: [], props: { to: 'string', subject: 'string', body: 'string', purpose: 'string' } },

    // ─── Diagnostic ─────────────────────────────────────────────────
    'diagnostic_snapshot': { required: [], props: {} },
    'diagnostic_compare': { required: [], props: {} },

    // ─── Session Memory ─────────────────────────────────────────────
    'session_memory_inject': { required: [], props: { content: 'string' } },
    'session_resume':     { required: [], props: { session_id: 'string' } },
    'list_sessions':      { required: [], props: {} },

    // ─── Background Tasks ───────────────────────────────────────────
    'bg_task_start':      { required: ['task'], props: { task: 'string' } },
    'bg_task_list':       { required: [], props: {} },
    'bg_task_update':     { required: ['task_id'], props: { task_id: 'string', status: 'string' } },

    // ─── Crash / Logs ───────────────────────────────────────────────
    'read_crash_history': { required: [], props: {} },
    'read_engine_logs':   { required: [], props: { lines: 'number' } },
    'CRASH_REPORT':       { required: [], props: {} },

    // ─── Plugin Extended ────────────────────────────────────────────
    'plugin_load':        { required: ['id'], props: { id: 'string' } },
    'plugin_unload':      { required: ['id'], props: { id: 'string' } },
    'plugin_list':        { required: [], props: {} },

    // ─── MCP Extended ───────────────────────────────────────────────
    'mcp_disconnect':     { required: ['server_id'], props: { server_id: 'string' } },
    'mcp_list_tools':     { required: [], props: {} },
    'mcp_list_servers':   { required: [], props: {} },

    // ─── Misc Extended ──────────────────────────────────────────────
    'attach_file':        { required: [], props: { path: 'string' } },
    'create_file':        { required: ['file', 'content'], props: { file: 'string', content: 'string' } },
    'navigate_flowork':   { required: ['page'], props: { page: 'string' } },
    'structured_output':  { required: [], props: { format: 'string' } },
    'smart_compact':      { required: [], props: {} },
    'magic_docs_update':  { required: [], props: {} },
    'dream':              { required: [], props: {} },
    'wait':               { required: [], props: { ms: 'number' } },
    'agent_summary':      { required: [], props: {} },
    'away_summary':       { required: [], props: {} },
    'get_ide_context':    { required: [], props: {} },
    'tools_list':         { required: [], props: { category: 'string', lang: 'string' } },
    'error':              { required: [], props: {} },
    'enter_worktree':     { required: [], props: { name: 'string' } },
    'exit_worktree':      { required: [], props: {} },
    'skill':              { required: ['skill'], props: { skill: 'string' } },

    // ─── TTS (Mouth) ────────────────────────────────────────────────
    'tts_speak':          { required: ['text'], props: { text: 'string', provider: 'string', voice: 'string', lang: 'string', rate: 'number', pitch: 'number' } },
    'tts_stop':           { required: [], props: {} },
    'tts_list_voices':    { required: [], props: { provider: 'string' } },
    'tts_set_provider':   { required: [], props: { provider: 'string', voice: 'string', lang: 'string', auto_speak: 'boolean' } },
    'tts_status':         { required: [], props: {} },

    // ─── Ears (Audio + Events) ──────────────────────────────────────
    'transcribe_audio':   { required: ['file'], props: { file: 'string', provider: 'string', language: 'string' } },
    'watch_folder':       { required: ['path'], props: { path: 'string', pattern: 'string', recursive: 'boolean', auto_inject: 'boolean' } },
    'unwatch_folder':     { required: [], props: { id: 'string' } },
    'start_webhook':      { required: [], props: { port: 'number', token: 'string' } },
    'stop_webhook':       { required: [], props: {} },
    'ear_status':         { required: [], props: {} },

    // ─── Crawler (Legs) ─────────────────────────────────────────────
    'crawl_url':          { required: ['url'], props: { url: 'string', raw: 'boolean', save: 'boolean', save_dir: 'string' } },
    'crawl_site':         { required: ['url'], props: { url: 'string', max: 'number', pattern: 'string', same_domain: 'boolean', save: 'boolean' } },
    'extract_page':       { required: ['url'], props: { url: 'string' } },
    'crawl_status':       { required: [], props: { id: 'string' } },

    // ─── Image Generation (Creativity) ──────────────────────────────
    'generate_image':     { required: ['prompt'], props: { prompt: 'string', provider: 'string', size: 'string', quality: 'string', style: 'string', save: 'string' } },
    'edit_image':         { required: ['image', 'prompt'], props: { image: 'string', prompt: 'string', size: 'string', output: 'string' } },
    'imagegen_status':    { required: [], props: {} },

    // ─── Audio Generation (Creativity) ──────────────────────────────
    'generate_sound':     { required: ['prompt'], props: { prompt: 'string', provider: 'string', duration: 'number', output: 'string' } },
    'generate_music':     { required: ['prompt'], props: { prompt: 'string', voice: 'string', speed: 'number', output: 'string' } },
    'audiogen_status':    { required: [], props: {} },

    // ─── Daemon (Background Tasks) ──────────────────────────────────
    'daemon_schedule':    { required: ['name'], props: { name: 'string', interval: 'string', mode: 'string', code: 'string', run_now: 'boolean' } },
    'daemon_list':        { required: [], props: {} },
    'daemon_cancel':      { required: [], props: { id: 'string' } },
    'daemon_pause':       { required: ['id'], props: { id: 'string' } },
    'daemon_resume':      { required: ['id'], props: { id: 'string' } },

    // ─── Vision Extended ────────────────────────────────────────────
    'vision_auto_start':  { required: [], props: { interval: 'number', question: 'string', auto_inject: 'boolean' } },
    'vision_auto_stop':   { required: [], props: {} },
    'vision_click_at':    { required: ['x', 'y'], props: { x: 'number', y: 'number' } },

    // ─── NAS Extended ───────────────────────────────────────────────
    'profile_report':     { required: [], props: {} },
    'tool_effectiveness': { required: [], props: {} },
};

// ─── VALIDATION FUNCTION ─────────────────────────────────────────────
window.validateToolInput = function(toolName, input) {
    const schema = window.toolSchemas[toolName];
    if (!schema) return { valid: true }; // No schema = allow (unknown tools pass through)

    // Check required fields
    for (const field of (schema.required || [])) {
        if (!(field in input) || input[field] === undefined || input[field] === null) {
            return {
                valid: false,
                error: `Missing required field: "${field}" for tool "${toolName}"`
            };
        }
    }

    // Check types
    for (const [field, expectedType] of Object.entries(schema.props || {})) {
        if (field in input && input[field] !== undefined && input[field] !== null) {
            const actual = Array.isArray(input[field]) ? 'array' : typeof input[field];
            if (actual !== expectedType) {
                return {
                    valid: false,
                    error: `Field "${field}": expected ${expectedType}, got ${actual}`
                };
            }
        }
    }

    return { valid: true };
};

// ─── PLAN MODE GUARD ─────────────────────────────────────────────────
window._planMode = false;
window._planModeStartedAt = 0;

window.PLAN_MODE_ALLOWED_TOOLS = [
    'chat', 'read_file', 'search_files', 'web_search', 'kb_search', 'kb_read',
    'tools_search', 'tools_get', 'load_project_context', 'analyze_code',
    'list_knowledge', 'list_browsers', 'discover_apps', 'list_agents',
    'list_workspace', 'read_workspace_file', 'todo_list', 'read_progress',
    'glob', 'read_url', 'enter_plan_mode', 'exit_plan_mode',
    'find_definition', 'find_references', 'document_symbols',
    'update_roadmap', 'todo_write', 'save_progress'
];

window.isPlanModeBlocked = function(toolName) {
    if (!window._planMode) return false;
    return !window.PLAN_MODE_ALLOWED_TOOLS.includes(toolName);
};

console.log('[Flowork OS] ✅ Tool Schema Validation loaded (' + Object.keys(window.toolSchemas).length + ' schemas)');
console.log('[Flowork OS] ✅ Plan Mode Guard loaded');
