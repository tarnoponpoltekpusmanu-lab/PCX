// =========================================================================
// FLOWORK OS — Brain Tool Registry
// Maps Flowork-specific tools to brain_flowork engine tool system
// This bridges the gap between Flowork's 175 tools and Claude Code's tool API
// =========================================================================

// ─── Tool Categories ─────────────────────────────────────────────────────
// Each tool is defined with:
//   - name: tool name used by AI
//   - category: logical grouping
//   - handler: 'go_api' | 'ws_ipc' | 'browser_api' | 'window_global' | 'brain_native'
//   - endpoint: API route or IPC action
//   - schema: input validation
//
// handler types:
//   go_api      — HTTP call to Go backend (port 5000)
//   ws_ipc      — WebSocket to Electron main process (port 5001)
//   browser_api — Direct browser DOM/window API
//   window_global — Call existing window.* function
//   brain_native  — Handled by brain_flowork_bundle.js natively

window.brainToolRegistry = {};

// ═════════════════════════════════════════════════════════════════════════
// FILE OPERATIONS — Mapped to Go backend
// ═════════════════════════════════════════════════════════════════════════
const FILE_TOOLS = {
    write_files:      { handler: 'go_api', method: 'POST', endpoint: '/api/ai-write' },
    patch_file:       { handler: 'go_api', method: 'POST', endpoint: '/api/ai-write' },
    smart_patch:      { handler: 'go_api', method: 'POST', endpoint: '/api/ai-write' },
    read_file:        { handler: 'go_api', method: 'POST', endpoint: '/api/ai-read/file' },
    delete_file:      { handler: 'go_api', method: 'DELETE', endpoint: '/api/fs/delete' },
    rename_file:      { handler: 'go_api', method: 'POST', endpoint: '/api/fs/rename' },
    create_file:      { handler: 'go_api', method: 'POST', endpoint: '/api/ai-write' },
    search_files:     { handler: 'go_api', method: 'POST', endpoint: '/api/search' },
    glob:             { handler: 'go_api', method: 'POST', endpoint: '/api/glob' },
    diff_preview:     { handler: 'go_api', method: 'POST', endpoint: '/api/diff-preview' },
    attach_file:      { handler: 'go_api', method: 'POST', endpoint: '/api/fs/read' },
};

// ═════════════════════════════════════════════════════════════════════════
// TERMINAL — Go backend process management
// ═════════════════════════════════════════════════════════════════════════
const TERMINAL_TOOLS = {
    run_command:      { handler: 'go_api', method: 'POST', endpoint: '/api/ai-exec' },
    powershell:       { handler: 'go_api', method: 'POST', endpoint: '/api/ai-exec' },
    terminal_start:   { handler: 'go_api', method: 'POST', endpoint: '/api/terminal/start' },
    terminal_status:  { handler: 'go_api', method: 'POST', endpoint: '/api/terminal/status' },
    terminal_input:   { handler: 'go_api', method: 'POST', endpoint: '/api/terminal/input' },
    terminal_kill:    { handler: 'go_api', method: 'POST', endpoint: '/api/terminal/kill' },
};

// ═════════════════════════════════════════════════════════════════════════
// BROWSER AUTOMATION — WebSocket IPC to Electron main
// ═════════════════════════════════════════════════════════════════════════
const BROWSER_TOOLS = {
    open_browser_tab:       { handler: 'ws_ipc', action: 'open_ai_tab' },
    close_browser_tab:      { handler: 'ws_ipc', action: 'close_ai_tab' },
    navigate_browser:       { handler: 'ws_ipc', action: 'navigate' },
    capture_browser:        { handler: 'ws_ipc', action: 'capture_tab' },
    click_element:          { handler: 'ws_ipc', action: 'click_element' },
    type_text:              { handler: 'ws_ipc', action: 'type_text' },
    scroll_page:            { handler: 'ws_ipc', action: 'scroll_page' },
    read_dom:               { handler: 'ws_ipc', action: 'read_dom' },
    keyboard_event:         { handler: 'ws_ipc', action: 'keyboard_event' },
    execute_browser_script: { handler: 'ws_ipc', action: 'execute_script' },
    get_console_logs:       { handler: 'ws_ipc', action: 'get_console_logs' },
    import_cookies:         { handler: 'ws_ipc', action: 'import_cookies' },
    export_cookies:         { handler: 'ws_ipc', action: 'export_cookies' },
    list_browsers:          { handler: 'ws_ipc', action: 'list_browsers' },
    download_video:         { handler: 'ws_ipc', action: 'download_video' },
    upload_to_page:         { handler: 'ws_ipc', action: 'upload_to_page' },
    drag_drop:              { handler: 'ws_ipc', action: 'drag_drop' },
};

// ═════════════════════════════════════════════════════════════════════════
// APP MANAGEMENT — Mix of Go API and WS IPC
// ═════════════════════════════════════════════════════════════════════════
const APP_TOOLS = {
    open_app:             { handler: 'ws_ipc', action: 'open_app' },
    close_app:            { handler: 'ws_ipc', action: 'close_app' },
    compile_script:       { handler: 'go_api', method: 'POST', endpoint: '/api/compile' },
    discover_apps:        { handler: 'go_api', method: 'GET', endpoint: '/api/ai-read/discover' },
    list_installed_apps:  { handler: 'go_api', method: 'GET', endpoint: '/api/apps/list' },
    generate_icon:        { handler: 'go_api', method: 'POST', endpoint: '/api/generate-icon' },
    rollback:             { handler: 'go_api', method: 'POST', endpoint: '/api/rollback' },
    auto_test_app:        { handler: 'go_api', method: 'POST', endpoint: '/api/auto-test' },
};

// ═════════════════════════════════════════════════════════════════════════
// KNOWLEDGE BASE — Flowork cloud KB API
// ═════════════════════════════════════════════════════════════════════════
const KB_TOOLS = {
    kb_search:          { handler: 'go_api', method: 'GET', endpoint: '/api/kb/search' },
    kb_read:            { handler: 'go_api', method: 'GET', endpoint: '/api/kb/read' },
    kb_list:            { handler: 'go_api', method: 'GET', endpoint: '/api/kb/list' },
    kb_publish:         { handler: 'go_api', method: 'POST', endpoint: '/api/kb/publish' },
    kb_update:          { handler: 'go_api', method: 'POST', endpoint: '/api/kb/update' },
    save_knowledge:     { handler: 'go_api', method: 'POST', endpoint: '/api/kb/publish' },
    list_knowledge:     { handler: 'go_api', method: 'GET', endpoint: '/api/kb/list' },
    recall_knowledge:   { handler: 'go_api', method: 'GET', endpoint: '/api/kb/search' },
    tools_search:       { handler: 'go_api', method: 'GET', endpoint: '/api/tools/search' },
    tools_get:          { handler: 'go_api', method: 'GET', endpoint: '/api/tools/get' },
    tools_save:         { handler: 'go_api', method: 'POST', endpoint: '/api/tools/save' },
    tools_list:         { handler: 'go_api', method: 'GET', endpoint: '/api/tools/list' },
    tool_search:        { handler: 'go_api', method: 'GET', endpoint: '/api/tools/search' },
};

// ═════════════════════════════════════════════════════════════════════════
// GIT — Go backend
// ═════════════════════════════════════════════════════════════════════════
const GIT_TOOLS = {
    git:              { handler: 'go_api', method: 'POST', endpoint: '/api/git' },
    worktree_create:  { handler: 'go_api', method: 'POST', endpoint: '/api/worktree/create' },
    worktree_exit:    { handler: 'go_api', method: 'POST', endpoint: '/api/worktree/exit' },
    worktree_status:  { handler: 'go_api', method: 'GET', endpoint: '/api/worktree/status' },
};

// ═════════════════════════════════════════════════════════════════════════
// MULTI-AGENT / COORDINATOR — Window globals
// ═════════════════════════════════════════════════════════════════════════
const AGENT_TOOLS = {
    spawn_agent:      { handler: 'window_global', fn: 'agentPool.spawnAgent' },
    check_agent:      { handler: 'window_global', fn: 'agentPool.checkAgent' },
    list_agents:      { handler: 'window_global', fn: 'agentPool.listAgents' },
    create_team:      { handler: 'window_global', fn: 'teamManager.createTeam' },
    list_teams:       { handler: 'window_global', fn: 'teamManager.listTeams' },
    delete_team:      { handler: 'window_global', fn: 'teamManager.deleteTeam' },
    team_share_memory: { handler: 'window_global', fn: 'teamManager.shareMemory' },
    team_sync:        { handler: 'window_global', fn: 'teamManager.syncTeam' },
    // v2: Team enhancements
    decompose_task:   { handler: 'window_global', fn: 'teamManager.decomposeTask' },
    save_template:    { handler: 'window_global', fn: 'teamManager.saveTemplate' },
    list_templates:   { handler: 'window_global', fn: 'teamManager.listTemplates' },
    delete_template:  { handler: 'window_global', fn: 'teamManager.deleteTemplate' },
    pause_team:       { handler: 'window_global', fn: 'teamManager.pauseTeam' },
    resume_team:      { handler: 'window_global', fn: 'teamManager.resumeTeam' },
    list_roles:       { handler: 'window_global', fn: 'teamManager.listRoles' },
    list_strategies:  { handler: 'window_global', fn: 'teamManager.listStrategies' },
};

// ═════════════════════════════════════════════════════════════════════════
// WORKFLOW / NODE — Go backend + Window globals
// ═════════════════════════════════════════════════════════════════════════
const WORKFLOW_TOOLS = {
    create_node:      { handler: 'go_api', method: 'POST', endpoint: '/api/nodes/create' },
    list_nodes:       { handler: 'go_api', method: 'GET', endpoint: '/api/nodes/list' },
    create_workflow:  { handler: 'go_api', method: 'POST', endpoint: '/api/workflows/create' },
    update_workflow:  { handler: 'go_api', method: 'POST', endpoint: '/api/workflows/update' },
    execute_workflow: { handler: 'go_api', method: 'POST', endpoint: '/api/workflows/execute' },
    list_workflows:   { handler: 'go_api', method: 'GET', endpoint: '/api/workflows/list' },
};

// ═════════════════════════════════════════════════════════════════════════
// MEMORY & SESSION — Window globals + Brain native
// ═════════════════════════════════════════════════════════════════════════
const MEMORY_TOOLS = {
    remember:              { handler: 'brain_native', module: 'memdir' },
    save_memory:           { handler: 'brain_native', module: 'memdir' },
    memory_search:         { handler: 'brain_native', module: 'memdir' },
    compact:               { handler: 'brain_native', module: 'compact' },
    smart_compact:         { handler: 'brain_native', module: 'compact' },
    session_save:          { handler: 'brain_native', module: 'history' },
    session_memory_inject: { handler: 'brain_native', module: 'history' },
};

// ═════════════════════════════════════════════════════════════════════════
// MCP — Brain native
// ═════════════════════════════════════════════════════════════════════════
const MCP_TOOLS = {
    mcp_connect:      { handler: 'brain_native', module: 'mcp' },
    mcp_call_tool:    { handler: 'brain_native', module: 'mcp' },
    mcp_disconnect:   { handler: 'brain_native', module: 'mcp' },
    mcp_list_tools:   { handler: 'brain_native', module: 'mcp' },
    mcp_list_servers: { handler: 'brain_native', module: 'mcp' },
    mcp_server_start: { handler: 'brain_native', module: 'mcp' },
    mcp_server_stop:  { handler: 'brain_native', module: 'mcp' },
};

// ═════════════════════════════════════════════════════════════════════════
// EMAIL — Go backend proxy
// ═════════════════════════════════════════════════════════════════════════
const EMAIL_TOOLS = {
    email_check_inbox: { handler: 'go_api', method: 'GET', endpoint: '/api/email/inbox' },
    email_read:        { handler: 'go_api', method: 'GET', endpoint: '/api/email/read' },
    email_generate:    { handler: 'go_api', method: 'POST', endpoint: '/api/email/generate' },
};

// ═════════════════════════════════════════════════════════════════════════
// CRON / SCHEDULING — Go backend
// ═════════════════════════════════════════════════════════════════════════
const CRON_TOOLS = {
    cron_create:    { handler: 'go_api', method: 'POST', endpoint: '/api/cron/create' },
    cron_delete:    { handler: 'go_api', method: 'DELETE', endpoint: '/api/cron/delete' },
    cron_list:      { handler: 'go_api', method: 'GET', endpoint: '/api/cron/list' },
    schedule_task:  { handler: 'go_api', method: 'POST', endpoint: '/api/schedule/create' },
    bg_task_start:  { handler: 'go_api', method: 'POST', endpoint: '/api/bg-task/start' },
    bg_task_list:   { handler: 'go_api', method: 'GET', endpoint: '/api/bg-task/list' },
    bg_task_update: { handler: 'go_api', method: 'POST', endpoint: '/api/bg-task/update' },
};

// ═════════════════════════════════════════════════════════════════════════
// VISION — Deep Visual Reasoning (Wish #1)
// ═════════════════════════════════════════════════════════════════════════
const VISION_TOOLS = {
    vision_analyze:     { handler: 'brain_native', module: 'vision' },
    analyze_screenshot: { handler: 'brain_native', module: 'vision' },
    vision_find_element:{ handler: 'brain_native', module: 'vision' },
    vision_ocr:         { handler: 'brain_native', module: 'vision' },
    vision_diff:        { handler: 'brain_native', module: 'vision' },
    vision_set_model:   { handler: 'brain_native', module: 'vision' },
    vision_status:      { handler: 'brain_native', module: 'vision' },
    vision_auto_start:  { handler: 'brain_native', module: 'vision' },
    vision_auto_stop:   { handler: 'brain_native', module: 'vision' },
    vision_click_at:    { handler: 'brain_native', module: 'vision' },
};

// ═════════════════════════════════════════════════════════════════════════
// NAS — Neural Architecture Search (Wish #2)
// ═════════════════════════════════════════════════════════════════════════
const NAS_TOOLS = {
    nas_experiment:     { handler: 'brain_native', module: 'nas' },
    nas_benchmark:      { handler: 'brain_native', module: 'nas' },
    nas_optimize:       { handler: 'brain_native', module: 'nas' },
    nas_set_budget:     { handler: 'brain_native', module: 'nas' },
    nas_experiments:    { handler: 'brain_native', module: 'nas' },
    nas_self_patch:     { handler: 'brain_native', module: 'nas' },
    profile_report:     { handler: 'brain_native', module: 'nas' },
    tool_effectiveness: { handler: 'brain_native', module: 'nas' },
};

// ═════════════════════════════════════════════════════════════════════════
// SWARM — True Swarm Intelligence (Wish #3)
// ═════════════════════════════════════════════════════════════════════════
const SWARM_TOOLS = {
    swarm_launch:       { handler: 'brain_native', module: 'swarm' },
    swarm_status:       { handler: 'brain_native', module: 'swarm' },
    swarm_collect:      { handler: 'brain_native', module: 'swarm' },
    swarm_cancel:       { handler: 'brain_native', module: 'swarm' },
    swarm_parallel:     { handler: 'brain_native', module: 'swarm' },
    swarm_map_reduce:   { handler: 'brain_native', module: 'swarm' },
};

// ═════════════════════════════════════════════════════════════════════════
// TTS — Text-to-Speech Output (Mouth)
// ═════════════════════════════════════════════════════════════════════════
const TTS_TOOLS = {
    tts_speak:          { handler: 'brain_native', module: 'tts' },
    tts_stop:           { handler: 'brain_native', module: 'tts' },
    tts_list_voices:    { handler: 'brain_native', module: 'tts' },
    tts_set_provider:   { handler: 'brain_native', module: 'tts' },
    tts_status:         { handler: 'brain_native', module: 'tts' },
    // v2: Streaming TTS
    tts_speak_streaming: { handler: 'brain_native', module: 'tts' },
    tts_speak_chunked:   { handler: 'brain_native', module: 'tts' },
    tts_stop_streaming:  { handler: 'brain_native', module: 'tts' },
    tts_hook_streaming:  { handler: 'brain_native', module: 'tts' },
};

// ═════════════════════════════════════════════════════════════════════════
// EARS — Audio Transcription + Event Triggers
// ═════════════════════════════════════════════════════════════════════════
const EARS_TOOLS = {
    transcribe_audio:   { handler: 'brain_native', module: 'ears' },
    watch_folder:       { handler: 'brain_native', module: 'ears' },
    unwatch_folder:     { handler: 'brain_native', module: 'ears' },
    start_webhook:      { handler: 'brain_native', module: 'ears' },
    stop_webhook:       { handler: 'brain_native', module: 'ears' },
    ear_status:         { handler: 'brain_native', module: 'ears' },
    // v2: Real-time
    start_realtime_mic:     { handler: 'brain_native', module: 'ears' },
    stop_realtime_mic:      { handler: 'brain_native', module: 'ears' },
    start_wake_word:        { handler: 'brain_native', module: 'ears' },
    stop_wake_word:         { handler: 'brain_native', module: 'ears' },
    start_continuous_listen: { handler: 'brain_native', module: 'ears' },
    stop_continuous_listen:  { handler: 'brain_native', module: 'ears' },
};

// ═════════════════════════════════════════════════════════════════════════
// CRAWLER — Smart Web Crawling
// ═════════════════════════════════════════════════════════════════════════
const CRAWLER_TOOLS = {
    crawl_url:          { handler: 'brain_native', module: 'crawler' },
    crawl_site:         { handler: 'brain_native', module: 'crawler' },
    extract_page:       { handler: 'brain_native', module: 'crawler' },
    crawl_status:       { handler: 'brain_native', module: 'crawler' },
};

// ═════════════════════════════════════════════════════════════════════════
// IMAGE GENERATION — Creative Visual Output
// ═════════════════════════════════════════════════════════════════════════
const IMAGEGEN_TOOLS = {
    generate_image:     { handler: 'brain_native', module: 'imagegen' },
    edit_image:         { handler: 'brain_native', module: 'imagegen' },
    imagegen_status:    { handler: 'brain_native', module: 'imagegen' },
};

// ═════════════════════════════════════════════════════════════════════════
// AUDIO GENERATION — Sound & Music
// ═════════════════════════════════════════════════════════════════════════
const AUDIOGEN_TOOLS = {
    generate_sound:     { handler: 'brain_native', module: 'audiogen' },
    generate_music:     { handler: 'brain_native', module: 'audiogen' },
    generate_voice_clone: { handler: 'brain_native', module: 'audiogen' },
    mix_audio:          { handler: 'brain_native', module: 'audiogen' },
    audio_library:      { handler: 'brain_native', module: 'audiogen' },
    audiogen_status:    { handler: 'brain_native', module: 'audiogen' },
};

// ═════════════════════════════════════════════════════════════════════════
// VIDEO GENERATION — AI Video, Screen Recording, Animation
// ═════════════════════════════════════════════════════════════════════════
const VIDEOGEN_TOOLS = {
    generate_video:     { handler: 'brain_native', module: 'videogen' },
    video_status:       { handler: 'brain_native', module: 'videogen' },
    record_screen:      { handler: 'brain_native', module: 'videogen' },
    stop_recording:     { handler: 'brain_native', module: 'videogen' },
    create_animation:   { handler: 'brain_native', module: 'videogen' },
};

// ═════════════════════════════════════════════════════════════════════════
// GATEWAY — Multi-channel messaging (WhatsApp, Telegram, Discord, Slack)
// ═════════════════════════════════════════════════════════════════════════
const GATEWAY_TOOLS = {
    gateway_send:       { handler: 'window_global', fn: 'floworkGatewayBridge.gatewaySend' },
    gateway_channels:   { handler: 'window_global', fn: 'floworkGatewayBridge.gatewayChannels' },
    gateway_status:     { handler: 'window_global', fn: 'floworkGatewayBridge.gatewayStatus' },
    gateway_connect:    { handler: 'window_global', fn: 'floworkGatewayBridge.gatewayConnect' },
    gateway_disconnect: { handler: 'window_global', fn: 'floworkGatewayBridge.gatewayDisconnect' },
    gateway_broadcast:  { handler: 'window_global', fn: 'floworkGatewayBridge.gatewayBroadcast' },
    gateway_reply:      { handler: 'window_global', fn: 'floworkGatewayBridge.gatewayReply' },
    gateway_auto_reply: { handler: 'window_global', fn: 'floworkGatewayBridge.setAutoReply' },
};

// ═════════════════════════════════════════════════════════════════════════
// DAEMON — Background Tasks + Cron
// ═════════════════════════════════════════════════════════════════════════
const DAEMON_TOOLS = {
    daemon_schedule:    { handler: 'brain_native', module: 'daemon' },
    daemon_list:        { handler: 'brain_native', module: 'daemon' },
    daemon_cancel:      { handler: 'brain_native', module: 'daemon' },
    daemon_pause:       { handler: 'brain_native', module: 'daemon' },
    daemon_resume:      { handler: 'brain_native', module: 'daemon' },
};

// ═════════════════════════════════════════════════════════════════════════
// MISC / STATE — Various handlers
// ═════════════════════════════════════════════════════════════════════════
const MISC_TOOLS = {
    web_search:       { handler: 'go_api', method: 'POST', endpoint: '/api/web-search' },
    web_fetch:        { handler: 'go_api', method: 'POST', endpoint: '/api/web-fetch' },
    read_url:         { handler: 'go_api', method: 'POST', endpoint: '/api/web-fetch' },
    sleep:            { handler: 'browser_api', fn: 'sleep' },
    wait:             { handler: 'browser_api', fn: 'sleep' },
    navigate_flowork: { handler: 'browser_api', fn: 'navigate' },
    chat:             { handler: 'browser_api', fn: 'chat' },
    send_message:     { handler: 'browser_api', fn: 'sendMessage' },
    structured_output: { handler: 'browser_api', fn: 'structuredOutput' },
    ask_user:         { handler: 'browser_api', fn: 'askUser' },
    dream:            { handler: 'browser_api', fn: 'dream' },
    
    // UI / State tools
    update_roadmap:   { handler: 'window_global', fn: 'updateRoadmap' },
    save_progress:    { handler: 'window_global', fn: 'saveProgress' },
    read_progress:    { handler: 'window_global', fn: 'readProgress' },
    suggest_next:     { handler: 'window_global', fn: 'suggestNext' },
    todo_write:       { handler: 'window_global', fn: 'todoWrite' },
    todo_list:        { handler: 'window_global', fn: 'todoList' },
    agent_summary:    { handler: 'window_global', fn: 'agentSummary' },
    away_summary:     { handler: 'window_global', fn: 'awaySummary' },

    // Plan mode
    enter_plan_mode:  { handler: 'brain_native', module: 'plan' },
    exit_plan_mode:   { handler: 'brain_native', module: 'plan' },
    advance_plan:     { handler: 'brain_native', module: 'plan' },
    cancel_plan:      { handler: 'brain_native', module: 'plan' },
    ultraplan_start:  { handler: 'brain_native', module: 'plan' },

    // System
    self_restart:     { handler: 'ws_ipc', action: 'restart' },
    self_shutdown:    { handler: 'ws_ipc', action: 'shutdown' },
    self_review:      { handler: 'brain_native', module: 'review' },
    system_health:    { handler: 'go_api', method: 'GET', endpoint: '/api/health' },
    prevent_sleep:    { handler: 'ws_ipc', action: 'prevent_sleep' },
    diagnostic_snapshot: { handler: 'window_global', fn: 'diagnosticSnapshot' },
    diagnostic_compare:  { handler: 'window_global', fn: 'diagnosticCompare' },

    // Workspace
    list_workspace:      { handler: 'go_api', method: 'GET', endpoint: '/api/workspace/list' },
    read_workspace_file: { handler: 'go_api', method: 'POST', endpoint: '/api/workspace/read' },
    load_project_context: { handler: 'go_api', method: 'GET', endpoint: '/api/project/context' },

    // Config
    get_config:       { handler: 'window_global', fn: 'getConfig' },
    set_config:       { handler: 'window_global', fn: 'setConfig' },
    set_auto_memory:  { handler: 'window_global', fn: 'setAutoMemory' },

    // Cost / Telemetry  
    cost_report:      { handler: 'brain_native', module: 'cost_tracker' },
    cost_status:      { handler: 'brain_native', module: 'cost_tracker' },
    get_token_usage:  { handler: 'brain_native', module: 'cost_tracker' },
    telemetry_report: { handler: 'brain_native', module: 'analytics' },
    tool_usage_report: { handler: 'brain_native', module: 'analytics' },

    // Permission / Audit
    set_permission_mode: { handler: 'brain_native', module: 'permissions' },
    get_permission_status: { handler: 'brain_native', module: 'permissions' },
    get_audit_trail:  { handler: 'brain_native', module: 'permissions' },

    // Code intelligence
    analyze_code:     { handler: 'go_api', method: 'POST', endpoint: '/api/analyze' },
    dependency_graph: { handler: 'go_api', method: 'POST', endpoint: '/api/dependency-graph' },
    find_definition:  { handler: 'brain_native', module: 'lsp' },
    find_references:  { handler: 'brain_native', module: 'lsp' },
    document_symbols: { handler: 'brain_native', module: 'lsp' },
    hover_info:       { handler: 'brain_native', module: 'lsp' },

    // Plugin
    plugin_list:      { handler: 'brain_native', module: 'plugins' },
    plugin_load:      { handler: 'brain_native', module: 'plugins' },
    plugin_unload:    { handler: 'brain_native', module: 'plugins' },
    plugin_install:   { handler: 'brain_native', module: 'plugins' },
    plugin_uninstall: { handler: 'brain_native', module: 'plugins' },
    plugin_enable:    { handler: 'brain_native', module: 'plugins' },
    plugin_disable:   { handler: 'brain_native', module: 'plugins' },

    // REPL
    repl_start:       { handler: 'go_api', method: 'POST', endpoint: '/api/repl/start' },
    repl_execute:     { handler: 'go_api', method: 'POST', endpoint: '/api/repl/execute' },
    repl_stop:        { handler: 'go_api', method: 'POST', endpoint: '/api/repl/stop' },

    // Notebook
    notebook_read:       { handler: 'go_api', method: 'POST', endpoint: '/api/notebook/read' },
    notebook_edit:       { handler: 'go_api', method: 'POST', endpoint: '/api/notebook/edit' },
    notebook_add_cell:   { handler: 'go_api', method: 'POST', endpoint: '/api/notebook/add' },
    notebook_delete_cell: { handler: 'go_api', method: 'POST', endpoint: '/api/notebook/delete' },

    // Skills
    invoke_skill:     { handler: 'brain_native', module: 'skills' },
    register_skill:   { handler: 'brain_native', module: 'skills' },
    list_skills:      { handler: 'brain_native', module: 'skills' },

    // Feature flags
    feature_enable:   { handler: 'brain_native', module: 'features' },
    feature_disable:  { handler: 'brain_native', module: 'features' },
    feature_list:     { handler: 'brain_native', module: 'features' },
    enable_thinking:  { handler: 'window_global', fn: 'enableThinking' },
    disable_thinking: { handler: 'window_global', fn: 'disableThinking' },

    // Auth
    auth_login:       { handler: 'go_api', method: 'POST', endpoint: '/api/auth/login' },
    auth_logout:      { handler: 'go_api', method: 'POST', endpoint: '/api/auth/logout' },
    auth_status:      { handler: 'go_api', method: 'GET', endpoint: '/api/auth/status' },

    // Voice
    voice_start:      { handler: 'ws_ipc', action: 'voice_start' },
    voice_stop:       { handler: 'ws_ipc', action: 'voice_stop' },

    // Bridge / IDE
    bridge_start:     { handler: 'brain_native', module: 'bridge' },
    bridge_stop:      { handler: 'brain_native', module: 'bridge' },
    bridge_status:    { handler: 'brain_native', module: 'bridge' },
    get_ide_context:  { handler: 'brain_native', module: 'bridge' },

    // Remote
    remote_start:     { handler: 'go_api', method: 'POST', endpoint: '/api/remote/start' },
    remote_stop:      { handler: 'go_api', method: 'POST', endpoint: '/api/remote/stop' },
    remote_share:     { handler: 'go_api', method: 'POST', endpoint: '/api/remote/share' },
    remote_trigger:   { handler: 'go_api', method: 'POST', endpoint: '/api/remote/trigger' },
    qr_session:       { handler: 'go_api', method: 'GET', endpoint: '/api/remote/qr' },

    // Crash / Logs
    read_crash_history: { handler: 'go_api', method: 'GET', endpoint: '/api/crash-history' },
    read_engine_logs:   { handler: 'go_api', method: 'GET', endpoint: '/api/logs' },

    // x402 payments
    x402_pay:         { handler: 'window_global', fn: 'x402Pay' },
    x402_balance:     { handler: 'window_global', fn: 'x402Balance' },

    // Settings sync
    settings_push:    { handler: 'go_api', method: 'POST', endpoint: '/api/settings/push' },
    settings_pull:    { handler: 'go_api', method: 'GET', endpoint: '/api/settings/pull' },

    // Session / History
    session_save:     { handler: 'brain_native', module: 'history' },
    session_memory_inject: { handler: 'window_global', fn: 'sessionMemoryInject' },

    // Other
    magic_docs_update: { handler: 'brain_native', module: 'memdir' },
    synthetic_output: { handler: 'brain_native', module: 'synthetic_output' },
    brief:            { handler: 'brain_native', module: 'brief' },
    broadcast_message: { handler: 'ws_ipc', action: 'broadcast' },
};

// ═════════════════════════════════════════════════════════════════════════
// MERGE ALL TOOLS
// ═════════════════════════════════════════════════════════════════════════
const ALL_CATEGORIES = {
    file: FILE_TOOLS,
    terminal: TERMINAL_TOOLS,
    browser: BROWSER_TOOLS,
    app: APP_TOOLS,
    kb: KB_TOOLS,
    git: GIT_TOOLS,
    agent: AGENT_TOOLS,
    workflow: WORKFLOW_TOOLS,
    memory: MEMORY_TOOLS,
    mcp: MCP_TOOLS,
    email: EMAIL_TOOLS,
    cron: CRON_TOOLS,
    vision: VISION_TOOLS,
    nas: NAS_TOOLS,
    swarm: SWARM_TOOLS,
    tts: TTS_TOOLS,
    ears: EARS_TOOLS,
    crawler: CRAWLER_TOOLS,
    imagegen: IMAGEGEN_TOOLS,
    audiogen: AUDIOGEN_TOOLS,
    videogen: VIDEOGEN_TOOLS,
    gateway: GATEWAY_TOOLS,
    daemon: DAEMON_TOOLS,
    misc: MISC_TOOLS,
};

// Build unified registry
for (const [category, tools] of Object.entries(ALL_CATEGORIES)) {
    for (const [name, config] of Object.entries(tools)) {
        window.brainToolRegistry[name] = { ...config, category };
    }
}

// ═════════════════════════════════════════════════════════════════════════
// UNIVERSAL TOOL EXECUTOR
// Routes tool call to the correct handler
// ═════════════════════════════════════════════════════════════════════════
window.brainExecuteTool = async function(toolName, toolInput) {
    const tool = window.brainToolRegistry[toolName];
    if (!tool) {
        console.warn(`[Brain] Unknown tool: ${toolName}`);
        return { error: `Unknown tool: ${toolName}` };
    }

    // Validate input
    if (window.validateToolInput) {
        const validation = window.validateToolInput(toolName, toolInput);
        if (!validation.valid) {
            return { error: validation.error };
        }
    }

    // Plan mode guard
    if (window.isPlanModeBlocked && window.isPlanModeBlocked(toolName)) {
        return { error: `Tool "${toolName}" is blocked in plan mode. Exit plan mode first.` };
    }

    try {
        switch (tool.handler) {
            case 'go_api':
                return await _executeGoAPI(tool, toolName, toolInput);
            case 'ws_ipc':
                return await _executeWSIPC(tool, toolName, toolInput);
            case 'browser_api':
                return await _executeBrowserAPI(tool, toolName, toolInput);
            case 'window_global':
                return await _executeWindowGlobal(tool, toolName, toolInput);
            case 'brain_native':
                return await _executeBrainNative(tool, toolName, toolInput);
            case 'js_code':
                // [EVOLUTION] Delegate to brainToolBridge for dynamic execution
                if (window.brainToolBridge) {
                    return await window.brainToolBridge(toolName, toolInput);
                }
                return { error: 'brainToolBridge not found for js_code handler' };
            default:
                return { error: `Unknown handler type: ${tool.handler}` };
        }
    } catch (err) {
        console.error(`[Brain] Tool ${toolName} error:`, err);
        return { error: err.message || String(err) };
    }
};

// ─── Handler: Go API (HTTP to port 5000) ─────────────────────────────────
async function _executeGoAPI(tool, name, input) {
    let url = `http://127.0.0.1:5000${tool.endpoint}`;
    const opts = {
        method: tool.method || 'POST',
        headers: { 'Content-Type': 'application/json' },
    };
    if (opts.method === 'GET') {
        const params = new URLSearchParams();
        for (const [key, val] of Object.entries(input)) {
            if (key !== 'action' && key !== 'tool') {
                params.append(key, val);
            }
        }
        const qs = params.toString();
        if (qs) url += (url.includes('?') ? '&' : '?') + qs;
    } else {
        opts.body = JSON.stringify({ tool: name, ...input });
    }
    const res = await fetch(url, opts);
    const data = await res.json();
    return data;
}

// ─── Handler: WebSocket IPC (port 5001) ──────────────────────────────────
async function _executeWSIPC(tool, name, input) {
    if (!window.wsCommand) {
        return { error: 'WebSocket not connected to Electron main process' };
    }
    return await window.wsCommand(tool.action, input);
}

// ─── Handler: Browser API (direct DOM/window) ───────────────────────────
async function _executeBrowserAPI(tool, name, input) {
    switch (name) {
        case 'sleep':
        case 'wait':
            const ms = input.duration_ms || input.ms || 1000;
            await new Promise(r => setTimeout(r, ms));
            return { result: `Waited ${ms}ms` };
        case 'navigate_flowork':
            if (window.navigateFlowork) window.navigateFlowork(input.page);
            return { result: `Navigated to ${input.page}` };
        case 'chat':
            return { result: input.message || 'No message' };
        case 'ask_user':
            return { result: `[WAITING_APPROVAL] ${input.question}`, requiresApproval: true };
        default:
            return { error: `Browser API handler not implemented: ${name}` };
    }
}

// ─── Handler: Window global function ────────────────────────────────────
async function _executeWindowGlobal(tool, name, input) {
    const fnPath = tool.fn.split('.');
    let target = window;
    for (const part of fnPath) {
        target = target?.[part];
    }
    if (typeof target === 'function') {
        return await target(input);
    }
    return { error: `Window function ${tool.fn} not found` };
}

// ─── Handler: Brain native module ───────────────────────────────────────
async function _executeBrainNative(tool, name, input) {
    // These will be wired to brain_flowork_bundle.js exports
    if (window.floworkBrain && typeof window.floworkBrain.executeTool === 'function') {
        return await window.floworkBrain.executeTool(name, input);
    }
    // Fallback: stub response
    return { result: `[brain_native:${tool.module}] Tool ${name} — module not yet connected` };
}

// ═════════════════════════════════════════════════════════════════════════
// STATS
// ═════════════════════════════════════════════════════════════════════════
const stats = {
    total: Object.keys(window.brainToolRegistry).length,
    go_api: 0, ws_ipc: 0, browser_api: 0, window_global: 0, brain_native: 0,
};
for (const t of Object.values(window.brainToolRegistry)) {
    stats[t.handler] = (stats[t.handler] || 0) + 1;
}
console.log(`[Brain] ✅ Tool Registry loaded: ${stats.total} tools`);
console.log(`  go_api: ${stats.go_api} | ws_ipc: ${stats.ws_ipc} | browser_api: ${stats.browser_api} | window_global: ${stats.window_global} | brain_native: ${stats.brain_native}`);
