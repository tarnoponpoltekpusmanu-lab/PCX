// =========================================================================
// FLOWORK OS - NANO MODULAR ARCHITECTURE
// FILE: agent_engine.js
// DESKRIPSI: Otak AI (Agent Tick Loop, WS Connector, Message Handler)
// =========================================================================

// Global variable untuk menyimpan state Highlight Monaco Editor
window.currentMonacoDecorations = [];

window.getWsConnection = function () {
    return new Promise((resolve, reject) => {
        if (window.wssSocket && window.wssSocket.readyState === WebSocket.OPEN) return resolve(window.wssSocket);
        window.wssSocket = new WebSocket('ws://127.0.0.1:5001');
        window.wssSocket.onopen = () => resolve(window.wssSocket);
        window.wssSocket.onerror = (e) => reject("WebSocket to Main Engine failed (Multi-Browser Hub offline)");
        window.wssSocket.onmessage = (msg) => {
            const res = JSON.parse(msg.data);
            if (res.id && window.wssResolvers[res.id]) {
                window.wssResolvers[res.id](res);
                delete window.wssResolvers[res.id];
            } else if (res.type === 'CRASH_REPORT') {
                console.warn("Received CRASH_REPORT from Main Engine!");
                window.chatHistory.push({
                    role: 'user',
                    content: `[URGENT KERNEL CRASH DETECTED]\nThe OS Flowork Engine just actively intercepted a fatal crash! Do not panic. Read this stack trace carefully, identify the file causing the error, figure out the solution, and use 'patch_file' or 'write_files' to rewrite the code and fix the bug immediately!\n\nSTACK TRACE:\n${res.data}`
                });
                if (window.appendChatMessage) window.appendChatMessage('user', `ðŸ”´ System Crash Intercepted! Waking up AI to self-heal...\n\n${res.data}`);

                // [GOAL 5] Persist crash to disk for history
                try {
                    fetch('http://127.0.0.1:5000/api/crash-history', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            timestamp: new Date().toISOString(),
                            stack: res.data,
                            source: 'kernel_crash_report'
                        })
                    }).catch(() => { });
                } catch (e) { }


                if (!window.isGenerating) {
                    const apiKey = window.getEl('input-api-key').value;
                    const prov = window.getEl('select-provider').value;
                    const typeout = window.getEl('select-output-type') ? window.getEl('select-output-type').value : 'app';
                    if (window.showLoader) window.showLoader();
                    window.isGenerating = true;
                    window.agentTick(prov, apiKey, typeout, window.currentAppId, window.currentLang, 0).then(() => {
                        window.isGenerating = false;
                        if (window.removeLoader) window.removeLoader();
                    });
                }
            }
        };
    });
};

window.wsCommand = async function (action, payload) {
    try {
        const ws = await window.getWsConnection();
        const msgId = Date.now() + Math.random().toString();
        return new Promise((resolve) => {
            window.wssResolvers[msgId] = resolve;
            ws.send(JSON.stringify({ ...payload, action, id: msgId }));
            setTimeout(() => resolve({ status: 'error', message: 'Timeout waiting for Main Engine response' }), 15000);
        });
    } catch (err) {
        return { status: 'error', message: err.toString() };
    }
};

window.fetchSystemPrompt = async function (language, outputType) {
    // â•â•â• AUTO-SET AI MODE BASED ON OUTPUT TYPE â•â•â•
    if (window.setAIMode) {
        if (outputType === 'browser') window.setAIMode('browser_automation');
        else if (outputType === 'run_app') window.setAIMode('main');
        else if (outputType === 'run_task') window.setAIMode('main');
        else window.setAIMode('app_builder');
    }

    let prompt = window.SYSTEM_PROMPT;

    // â•â•â• AUTO-FETCH BASE PROMPT FROM KB â•â•â•
    const modeMap = {
        'app_builder': 'base-prompt-app-builder',
        'node_builder': 'base-prompt-node-builder',
        'browser_automation': 'base-prompt-browser',
        'main': 'base-prompt-main'
    };
    const currentMode = window.activeAIMode || 'app_builder';
    const baseArticleId = modeMap[currentMode] || 'base-prompt-main';

    if (!window._basePromptCache || window._basePromptCacheMode !== currentMode) {
        try {
            console.log('[BasePrompt] Fetching ' + baseArticleId + ' for mode: ' + currentMode);
            const kbRes = await (window.kvDedupFetch || fetch)('https://floworkos.com/api/v1/kb/' + baseArticleId, {
                signal: (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(5000) : undefined
            });
            const kbData = await kbRes.json();
            if (kbData.status === 'success' && kbData.article) {
                window._basePromptCache = kbData.article.article_body || kbData.article.summary || '';
                window._basePromptCacheMode = currentMode;
                try {
                    localStorage.setItem('base_prompt_' + currentMode, window._basePromptCache);
                    localStorage.setItem('base_prompt_' + currentMode + '_ts', Date.now().toString());
                } catch (e) { }
                console.log('[BasePrompt] âœ… Loaded from KB: ' + kbData.article.title + ' (' + window._basePromptCache.length + ' chars)');
            }
        } catch (e) {
            console.log('[BasePrompt] âš ï¸ KB offline, trying localStorage cache...');
            try {
                const cached = localStorage.getItem('base_prompt_' + currentMode);
                if (cached) {
                    window._basePromptCache = cached;
                    window._basePromptCacheMode = currentMode;
                    console.log('[BasePrompt] âœ… Loaded from cache (' + cached.length + ' chars)');
                } else {
                    window._basePromptCache = '';
                    window._basePromptCacheMode = currentMode;
                    console.log('[BasePrompt] âš ï¸ No cache, using local fallback');
                }
            } catch (e2) {
                window._basePromptCache = '';
                window._basePromptCacheMode = currentMode;
            }
        }
    }

    try {
        const res = await fetch('https://floworkos.com/flowork_mapping.md', { cache: 'no-store' });
        if (res.ok) {
            const rawMapping = await res.text();
            prompt += `\n\n# INTERNAL ARCHITECTURE MAPPING (CRITICAL FOR FLOWORK OS)\n${rawMapping}\n`;
        }
    } catch (err) { console.log("Offline or unable to fetch OTA Rules from floworkos.com."); }

    if (language === 'id') {
        prompt += "\n\nCatatan: Berkomunikasilah dalam Bahasa Indonesia yang santai layaknya asisten ahli (gunakan 'kamu/saya/Bro').";
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // MODE-SPECIFIC SYSTEM PROMPTS (Output Type Routing)
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if (outputType === 'run_app') {
        prompt += `\n\n[CRITICAL MODE: RUN & OPERATE APP]
You are NOT a code generator right now. You are an APP OPERATOR.
Your job is to OPEN and OPERATE existing Flowork apps on behalf of the user.

Workflow:
1. Use 'discover_apps' to see all available apps and their capabilities
2. Find the right app for the user's request
3. Use 'open_app' to launch it inside the webview
4. Use 'capture_browser' + 'read_dom' to see the app state
5. Use 'click_element' / 'type_text' to interact with the app
6. Report results back to the user
7. Use 'close_app' when done

You MUST understand each app's purpose from its manifest.json 'purpose' and 'capabilities' fields.
If the app doesn't exist, tell the user to switch to 'Build Application' mode.
Do NOT write code in this mode. Only OPERATE existing apps.`;
    }
    else if (outputType === 'run_task') {
        prompt += `\n\n[CRITICAL MODE: TASK ORCHESTRATOR]
You are NOT a code generator. You are a TASK EXECUTOR.
The user gives you a TASK (e.g., "find stock info", "check crypto prices", "monitor server health").
Your job is to COMPLETE THE TASK using available resources.

Decision Tree:
1. Use 'discover_apps' to check if a matching app exists
2. IF app exists â†’ open_app â†’ operate it â†’ get results â†’ close_app â†’ report
3. IF app does NOT exist â†’ CHECK if a workflow/node combination can do it
4. IF nothing exists â†’ AUTO-BUILD the app (switch to build mode internally)
   a. Generate all necessary files (index.html, app.js, engine.py, manifest.json, etc.)
   b. Compile the backend
   c. Open and test the app
   d. Use the app to complete the original task
   e. Report results to user

You have FULL AUTONOMY to build, install, and run apps to complete tasks.
This is the most powerful mode â€” you are a true AI Operating System.
ALWAYS call 'save_progress' to document what you did.
ALWAYS call 'close_app' when done with an app.`;
    }
    else if (outputType === 'browser') {
        prompt += `\n\n[CRITICAL MODE: BROWSER AUTOMATION]
You are a BROWSER OPERATOR. You control the Flowork embedded browser to perform web tasks.
ALL navigation must happen INSIDE the Flowork webview. NEVER open external windows.

Available browser tools:
- 'list_browsers' â†’ See all open tabs
- 'capture_browser' â†’ Take screenshot to see current state
- 'read_dom' â†’ Read page structure
- 'click_element' â†’ Click buttons, links, menus
- 'type_text' â†’ Fill forms, search boxes
- 'scroll_page' â†’ Scroll up/down
- 'keyboard_event' â†’ Press keys (Enter, Tab, Escape)
- 'execute_browser_script' â†’ Run custom JavaScript

Workflow for web tasks:
1. Open target page: use 'open_app' with the app that has the URL
2. 'capture_browser' to see what's on screen
3. 'read_dom' to understand page structure
4. Interact: click, type, scroll as needed
5. 'capture_browser' to verify each action
6. Report results
7. 'close_app' when done

CRITICAL RULES:
- ALWAYS capture_browser BEFORE and AFTER each action
- NEVER assume page state â€” always verify visually
- Use CSS selectors from read_dom for clicks, not guesses
- If a page requires login, ASK the user for credentials
- All URLs must go through the Flowork webview`;
    }

    // [PROJECT TEMPLATES SUPPORT]
    const templateEl = document.getElementById('select-template');
    if (templateEl && templateEl.value) {
        if (templateEl.value === 'vite-react-ts') {
            prompt += `\n\n[CRITICAL PROJECT INSTRUCTION]\nUSER SELECTED TEMPLATE: Vite + React (TS).\nYou MUST structure this app as a Vite React application. Make sure to generate package.json, vite.config.ts, index.html, src/main.tsx, and src/App.tsx. Use run_command with 'npm install' and 'npm run dev' to start it.`;
        } else if (templateEl.value === 'nextjs-app') {
            prompt += `\n\n[CRITICAL PROJECT INSTRUCTION]\nUSER SELECTED TEMPLATE: Next.js (App Router).\nYou MUST structure this app as a Next.js 14+ application. Make sure to generate package.json, next.config.js, app/layout.tsx, and app/page.tsx. Use run_command with 'npm install' and 'npm run dev' to start it.`;
        } else if (templateEl.value === 'vanilla-html') {
            prompt += `\n\n[CRITICAL PROJECT INSTRUCTION]\nUSER SELECTED TEMPLATE: Vanilla HTML/JS.\nYou MUST structure this app using plain HTML, CSS, and JS. Generate index.html, style.css, and app.js. Make sure they are linked correctly.`;
        }
    }

    // â• â• â•  INJECT AI MODE DIRECTIVE â• â• â• 
    if (window.getModeDirective) {
        prompt += window.getModeDirective();
    }

    return prompt;
};

window.agentTick = async function (provider, apiKey, outputType, appId, language, depth = 0) {
    if (window.forceAbortAgent) {
        if (window.appendToolMessage) window.appendToolMessage('System', 'error', 'Generation aborted by user.');
        window.forceAbortAgent = false;
        return;
    }

    if (depth > 20) {
        // Hard safety cap â€” still exists but very generous for autonomous evolution
        if (window.appendToolMessage) window.appendToolMessage('System', 'error', 'Agent reached safety cap (20 loops). Use chat to continue.');
        return;
    }

    // ═══ QUERY STOP HOOKS — Check if generation should halt ═══
    if (window.runStopHooks) {
        const stopResult = window.runStopHooks({ depth, chatHistory: window.chatHistory });
        if (stopResult.stop) {
            if (window.appendToolMessage) window.appendToolMessage('System', 'warning', stopResult.reason);
            return;
        }
    }

    // ═══ SMART LOOP DETECTION — Track repeated tool calls ═══
    if (!window._loopDetection) window._loopDetection = { repeatCount: 0 };
    const lastAgentMsgs = window.chatHistory.filter(m => m.role === 'agent').slice(-3);
    if (lastAgentMsgs.length >= 3) {
        try {
            const actionSets = lastAgentMsgs.map(m => {
                const parsed = JSON.parse(m.content);
                const actions = Array.isArray(parsed) ? parsed : [parsed];
                return actions.map(a => a.action).sort().join(',');
            });
            if (actionSets[0] === actionSets[1] && actionSets[1] === actionSets[2]) {
                window._loopDetection.repeatCount++;
                if (window._loopDetection.repeatCount >= 2) {
                    window.chatHistory.push({ role: 'system', content: `[CRITICAL LOOP DETECTED] You called the EXACT SAME tools 3+ times in a row: [${actionSets[0]}]. You are STUCK. STOP repeating. Try a DIFFERENT approach or report to user with [WAITING_APPROVAL].` });
                    window._loopDetection.repeatCount = 0;
                }
            } else {
                window._loopDetection.repeatCount = 0;
            }
        } catch (e) { }
    }

    // ═══ RATE LIMITER — Check before API call ═══
    if (window.rateLimiter) {
        const estTok = Math.ceil(((window.cachedSystemPrompt || '').length + window.chatHistory.reduce((s, m) => s + (m.content || '').length, 0)) / 4);
        const rateCheck = window.rateLimiter.checkBeforeCall(estTok);
        if (!rateCheck.allowed) {
            if (rateCheck.waitMs > 0) {
                await new Promise(r => setTimeout(r, Math.min(rateCheck.waitMs, 60000)));
            } else {
                if (window.appendToolMessage) window.appendToolMessage('Rate Limiter', 'error', rateCheck.detail);
                return;
            }
        }
    }

    // Smart loop awareness â€” inject context about current depth
    if (depth > 0 && depth % 5 === 0) {
        // Every 10 loops, remind AI about its loop count
        window.chatHistory.push({ role: 'system', content: `[LOOP AWARENESS] You are at loop depth ${depth}/20. STOP repeating the same tools. If you already have data from list_workspace, kb_search, tools_search — USE IT and move to the NEXT phase. Do NOT search again for things you already found. Keep working with [AUTO_CONTINUE]. Only use [TASK_COMPLETE] when the entire job is done.` });
    }
    if (depth > 12) {
        window.chatHistory.push({ role: 'system', content: `[LOOP WARNING] Depth ${depth}/20 — WRAP UP NOW. Do NOT call kb_search or tools_search again. Complete your current action and report to user with [WAITING_APPROVAL].` });
    }

    if (!window.cachedSystemPrompt) {
        window.cachedSystemPrompt = await window.fetchSystemPrompt(language, outputType);

        // ═══ INJECT AI IDENTITY FROM BRAIN MANIFEST ═══
        if (window.FLOWORKOS_BrainLoader) {
            const identity = window.FLOWORKOS_BrainLoader.getIdentityPrompt();
            if (identity) {
                window.cachedSystemPrompt += '\n\n' + identity;
            }
        }
    }

    // ═══ WORKSPACE SNAPSHOT INJECTION (depth 0 only) ═══
    // Automatically inject workspace file listing so AI knows what's available
    if (depth === 0 && !window._workspaceSnapshotInjected) {
        try {
            const engineFs = window.originalNodeRequire ? window.originalNodeRequire('fs') : require('fs');
            const enginePath = window.originalNodeRequire ? window.originalNodeRequire('path') : require('path');
            const basePath = window._fmBasePath || enginePath.join(__dirname, 'workspace');

            if (engineFs.existsSync(basePath)) {
                let snapshot = '[WORKSPACE SNAPSHOT — Your available files]\n';
                const topEntries = engineFs.readdirSync(basePath, { withFileTypes: true });
                for (const entry of topEntries) {
                    const fullP = enginePath.join(basePath, entry.name);
                    if (entry.isDirectory()) {
                        let children = [];
                        try { children = engineFs.readdirSync(fullP); } catch (ex) { }
                        snapshot += `📂 ${entry.name}/ (${children.length} items)`;
                        if (children.length > 0 && children.length <= 10) {
                            snapshot += ': ' + children.join(', ');
                        }
                        snapshot += '\n';
                    } else {
                        let size = 0;
                        try { size = engineFs.statSync(fullP).size; } catch (ex) { }
                        const sizeStr = size > 1048576 ? (size / 1048576).toFixed(1) + 'MB' : size > 1024 ? (size / 1024).toFixed(0) + 'KB' : size + 'B';
                        snapshot += `📄 ${entry.name} (${sizeStr})\n`;
                    }
                }
                snapshot += `\nUse list_workspace("folder") to see subfolder contents. Use read_workspace_file("path") to read files.`;
                window.chatHistory.push({ role: 'system', content: snapshot });
                window._workspaceSnapshotInjected = true;
            }
        } catch (wsErr) {
            console.warn('[AgentEngine] Workspace snapshot failed:', wsErr.message);
        }
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // UPGRADE #15: TOKEN/COST AWARENESS
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if (!window._tokenTracker) {
        window._tokenTracker = { totalInputChars: 0, totalOutputChars: 0, apiCalls: 0, sessionStart: Date.now() };
    }
    window._tokenTracker.apiCalls++;

    // Estimate current context size
    let contextChars = window.cachedSystemPrompt.length;
    window.chatHistory.forEach(m => { contextChars += (m.content || '').length; });

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // UPGRADE #11 + #12: CONTEXT WINDOW MANAGEMENT & AUTO-SUMMARIZATION
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    const MAX_CONTEXT_CHARS = 50000;
    if (contextChars > MAX_CONTEXT_CHARS && window.chatHistory.length > 12) {
        console.log(`[Context-Manager] Context too large (${contextChars} chars). Auto-summarizing...`);
        if (window.appendToolMessage) window.appendToolMessage('Context Manager', 'success', `Auto-compressing context (${contextChars} chars â†’ optimized)`);

        // Keep last 10 messages intact
        const keepCount = 10;
        const oldMessages = window.chatHistory.slice(0, -keepCount);
        const recentMessages = window.chatHistory.slice(-keepCount);

        // Programmatic summarization: extract key actions from old messages
        let summary = '[CONTEXT CHECKPOINT â€” Auto-summarized from previous conversation]\n';
        let userRequests = [];
        let toolActions = [];
        let keyDecisions = [];

        for (const msg of oldMessages) {
            const content = msg.content || '';
            if (msg.role === 'user' && !content.startsWith('[AUTO-HEAL') && !content.startsWith('[URGENT')) {
                const shortReq = content.substring(0, 150);
                if (shortReq.trim()) userRequests.push(shortReq);
            }
            if (msg.role === 'system') {
                // Extract tool results
                const lines = content.split('\n');
                for (const line of lines) {
                    if (line.includes('success') || line.includes('âœ…') || line.includes('failed') || line.includes('âŒ')) {
                        toolActions.push(line.substring(0, 120));
                    }
                }
            }
            if (msg.role === 'agent') {
                try {
                    const parsed = JSON.parse(content);
                    const actions = Array.isArray(parsed) ? parsed : [parsed];
                    for (const a of actions) {
                        if (a.action === 'write_files' && a.files) {
                            toolActions.push(`Wrote files: ${Object.keys(a.files).join(', ')}`);
                        } else if (a.action === 'smart_patch' || a.action === 'patch_file') {
                            toolActions.push(`Patched: ${a.file || a.diff?.file_name || 'unknown'}`);
                        } else if (a.action === 'chat') {
                            const shortMsg = (a.message || '').substring(0, 100);
                            if (shortMsg.includes('[PHASE_') || shortMsg.includes('[WAITING')) {
                                keyDecisions.push(shortMsg);
                            }
                        }
                    }
                } catch (e) { }
            }
        }

        if (userRequests.length > 0) {
            summary += '\nUser Requests:\n';
            userRequests.slice(-5).forEach(r => summary += `- ${r}\n`);
        }
        if (toolActions.length > 0) {
            summary += '\nKey Actions Taken:\n';
            toolActions.slice(-15).forEach(a => summary += `- ${a}\n`);
        }
        if (keyDecisions.length > 0) {
            summary += '\nKey Decisions:\n';
            keyDecisions.slice(-5).forEach(d => summary += `- ${d}\n`);
        }

        // Replace old messages with summary
        window.chatHistory = [
            { role: 'system', content: summary },
            ...recentMessages
        ];

        contextChars = window.cachedSystemPrompt.length;
        window.chatHistory.forEach(m => { contextChars += (m.content || '').length; });
        console.log(`[Context-Manager] Compressed to ${contextChars} chars, ${window.chatHistory.length} messages`);
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // UPGRADE #17: IDE CONTEXT AWARENESS
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    let ideContext = '';
    try {
        if (window.monacoEditorInstance) {
            const model = window.monacoEditorInstance.getModel();
            const position = window.monacoEditorInstance.getPosition();
            const currentFile = window.activeTab || 'none';
            const totalLines = model ? model.getLineCount() : 0;
            ideContext = `\n[IDE Context] Active file: ${currentFile} | Cursor: line ${position?.lineNumber || 0} | Total lines: ${totalLines}`;
        }
    } catch (e) { }

    // â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• â• 
    // UPGRADE #15: TOKEN BUDGET WARNING
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    let tokenWarning = '';
    const estInputTokens = Math.ceil(contextChars / 4);
    window._tokenTracker.totalInputChars += contextChars;
    if (estInputTokens > 25000) {
        tokenWarning = `\n[TOKEN WARNING] Current context: ~${estInputTokens} tokens. Consider wrapping up or compressing context.`;
    }

    // ═══ TOKEN BUDGET — Record and check ═══
    if (window.tokenBudget) {
        const budgetCheck = window.tokenBudget.check(estInputTokens);
        if (!budgetCheck.allowed) {
            if (window.appendToolMessage) window.appendToolMessage('Token Budget', 'error', `⛔ ${budgetCheck.reason}`);
            return;
        }
        if (budgetCheck.warning) {
            tokenWarning += `\n[BUDGET WARNING] ${budgetCheck.warningPercent}% of session token budget used.`;
        }
    }

    // ═══ THINKING MODE — Inject thinking directive ═══
    let thinkingInjection = '';
    if (window.thinkingMode && window.thinkingMode.enabled) {
        thinkingInjection = window.thinkingMode.getPromptInjection();
        window.thinkingMode.resetTurn();
    }

    // Inject IDE context + token warning + thinking mode
    const injections = [ideContext, tokenWarning, thinkingInjection].filter(Boolean).join('\n');
    if (injections) {
        window.chatHistory.push({ role: 'system', content: injections.trim() });
    }

    // Create streaming bubble for real-time visual feedback
    let streamBubble = null;
    if (window.createStreamingBubble) {
        streamBubble = window.createStreamingBubble();
    }

    const onChunk = (chunk, fullText) => {
        if (streamBubble) streamBubble.update(fullText);
    };

    let rawResponse = '';
    try {
        if (provider.includes('gemini')) {
            rawResponse = await window.callGemini(apiKey, provider, window.cachedSystemPrompt, window.chatHistory, onChunk);
        } else if (provider.includes('chatgpt')) {
            rawResponse = await window.callOpenAI(apiKey, 'gpt-4o', window.cachedSystemPrompt, window.chatHistory, onChunk);
        } else if (provider.includes('claude')) {
            rawResponse = await window.callClaude(apiKey, provider, window.cachedSystemPrompt, window.chatHistory, onChunk);
        }
    } catch (e) {
        if (streamBubble) streamBubble.finish();
        if (window.appendToolMessage) window.appendToolMessage('Engine Exception', 'error', e.message);
        return;
    }

    // Remove streaming bubble
    if (streamBubble) streamBubble.finish();

    // === COST TRACKER — Record this API call ===
    if (window.costTracker && rawResponse) {
        window.costTracker.recordCall(provider, contextChars, rawResponse.length, 0);
        window._tokenTracker.totalOutputChars += rawResponse.length;
    }
    // === RATE LIMITER — Record call ===
    if (window.rateLimiter) {
        window.rateLimiter.recordCall(Math.ceil((contextChars + rawResponse.length) / 4));
    }
    // === TOKEN BUDGET — Record usage ===
    if (window.tokenBudget) {
        window.tokenBudget.recordUsage(
            Math.ceil(contextChars / 4),
            Math.ceil(rawResponse.length / 4),
            0
        );
    }

    // ═══ THINKING MODE — Parse thinking blocks from response ═══
    let processedResponse = rawResponse;
    if (window.thinkingMode && window.thinkingMode.enabled && rawResponse.includes('<thinking>')) {
        const thinkResult = window.thinkingMode.parseResponse(rawResponse);
        processedResponse = thinkResult.response;
        window.thinkingMode.renderThinkingInUI(thinkResult.thinking);
        // Record thinking tokens in budget
        if (window.tokenBudget && thinkResult.thinkingTokens > 0) {
            window.tokenBudget.recordUsage(0, 0, thinkResult.thinkingTokens);
        }
    }

    let actionData;
    try {
        let cleanText = processedResponse;
        if (cleanText.includes("```json")) cleanText = cleanText.split("```json").pop().split("```")[0].trim();
        else if (cleanText.includes("```")) cleanText = cleanText.split("```").pop().split("```")[0].trim();
        actionData = JSON.parse(cleanText);
    } catch (e) {
        window.chatHistory.push({ role: 'agent', content: processedResponse });
        window.chatHistory.push({ role: 'system', content: 'Error: invalid JSON output. You must use the JSON tool format.' });
        await new Promise(r => setTimeout(r, 1000));
        return await window.agentTick(provider, apiKey, outputType, appId, language, depth + 1);
    }

    window.chatHistory.push({ role: 'agent', content: JSON.stringify(actionData) });

    let actionsToProcess = Array.isArray(actionData) ? actionData : [actionData];
    let combinedToolResults = [];
    let hasToolExecution = false;
    let requireUserInteraction = false;

    let currentLoopAppId = appId;

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // UPGRADE #14: PARALLEL TOOL EXECUTION
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    const READ_ONLY_ACTIONS = new Set([
        'list_browsers', 'capture_browser', 'list_nodes', 'list_workflows',
        'read_progress', 'list_installed_apps', 'read_crash_history',
        'read_engine_logs', 'list_knowledge', 'load_project_context',
        'analyze_code', 'dependency_graph', 'terminal_status', 'check_agent',
        'get_console_logs', 'read_dom'
    ]);

    // Check if ALL actions in this batch are read-only
    const allReadOnly = actionsToProcess.every(a => READ_ONLY_ACTIONS.has(a.action));

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // UPGRADE #13: ROLLBACK â€” Auto git-commit before destructive ops
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    const DESTRUCTIVE_ACTIONS = new Set(['write_files', 'smart_patch', 'patch_file', 'create_node']);
    const hasDestructiveOps = actionsToProcess.some(a => DESTRUCTIVE_ACTIONS.has(a.action));
    if (hasDestructiveOps && currentLoopAppId) {
        try {
            // Auto-commit current state as safety checkpoint
            await fetch('http://127.0.0.1:5000/api/git', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    app_id: currentLoopAppId,
                    output_type: outputType,
                    action: 'add'
                })
            });
            await fetch('http://127.0.0.1:5000/api/git', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    app_id: currentLoopAppId,
                    output_type: outputType,
                    action: 'commit',
                    message: `[AUTO-CHECKPOINT] Before AI modification at ${new Date().toISOString()}`
                })
            });
        } catch (e) {
            // Git not initialized or not available â€” silently continue
        }
    }

    for (let act of actionsToProcess) {
        const type = act.action;
        let toolResultStr = '';

        // â•â•â• AI MODE TOOL GUARD â•â•â•
        // Block tools that don't belong to the current AI mode
        if (window.isToolAllowedInMode && !window.isToolAllowedInMode(type)) {
            const modeLabel = window.AI_MODES[window.activeAIMode.toUpperCase()]?.label || window.activeAIMode;
            toolResultStr = `â›” Tool "${type}" is NOT available in ${modeLabel} mode. `;
            // Provide helpful redirect
            if (['write_files', 'patch_file', 'smart_patch', 'compile_script'].includes(type)) {
                toolResultStr += 'Switch to App Builder mode to write/edit code.';
            } else if (['list_browsers', 'capture_browser', 'click_element', 'scroll_page', 'read_dom'].includes(type)) {
                toolResultStr += 'Switch to Browser Automation mode to control web browsers.';
            } else if (['create_node', 'update_node', 'connect_nodes'].includes(type)) {
                toolResultStr += 'Switch to Node Builder mode to create workflow nodes.';
            } else if (['open_app', 'discover_apps'].includes(type) && window.activeAIMode === 'browser_automation') {
                toolResultStr += 'In Browser mode, use list_browsers to see open tabs and execute_browser_script to navigate. Do NOT use open_app for web browsing!';
            }
            if (window.appendToolMessage) window.appendToolMessage(type, 'blocked', `â›” Not in ${modeLabel}`);
            combinedToolResults.push(toolResultStr);
            continue;
        }

        // ═══ PLAN MODE GUARD ═══
        if (window.planMode && window.planMode.active && !window.planMode.isAllowed(type)) {
            toolResultStr = window.planMode.getBlockReason(type);
            if (window.appendToolMessage) window.appendToolMessage(type, 'blocked', 'Plan Mode: blocked');
            combinedToolResults.push(toolResultStr);
            continue;
        }

        // ═══ SCHEMA VALIDATION ═══
        if (window.validateToolInput) {
            const validation = window.validateToolInput(type, act);
            if (!validation.valid) {
                console.warn(`[Schema] Tool "${type}" validation:`, validation.error);
            }
        }

        if (type === 'chat' || type === 'ask_user') {
            if (window.appendChatMessage) window.appendChatMessage('agent', act.message);

            let msgUpper = (act.message || '').toUpperCase();
            let isWaiting = msgUpper.includes('[WAITING_APPROVAL]') || msgUpper.includes('[MENUNGGU_KONFIRMASI]');
            let isTaskComplete = msgUpper.includes('[TASK_COMPLETE]') || msgUpper.includes('[TUGAS_SELESAI]');
            let isAuto = !isWaiting && !isTaskComplete;

            // Suppress re-halt during POST-TASK
            if (isTaskComplete && window._isPostTaskRunning) {
                isTaskComplete = false;
                window._isPostTaskRunning = false;
                combinedToolResults.push('POST-TASK completed. All tools and KB articles saved. Ready for next task.');
                hasToolExecution = false;
            }

            if (isTaskComplete) {
                combinedToolResults.push('Message delivered to user with TASK COMPLETE confirmation widget. ENGINE HALTED.');
                requireUserInteraction = true;
                hasToolExecution = false;
            } else if (isWaiting) {
                combinedToolResults.push('Message delivered to user. ENGINE HALTED. Waiting for user input...');
                requireUserInteraction = true;
                hasToolExecution = false;
            } else if (isAuto && !requireUserInteraction) {
                combinedToolResults.push('Message delivered to user. AUTO-CONTINUE FLAG DETECTED. Engine will continue looping.');
                hasToolExecution = true;
            } else {
                combinedToolResults.push('Message delivered to user. No specific control flag detected. Assuming waiting for confirmation.');
                requireUserInteraction = true;
            }
            continue;
        }
        else {
            if (!requireUserInteraction) {
                hasToolExecution = true;
            }
        }

        if (type === 'update_roadmap') {
            if (act.project_id) {
                currentLoopAppId = act.project_id;
                window.currentAppId = currentLoopAppId;
                const nameInput = window.getEl('input-app-name');
                if (nameInput) nameInput.value = currentLoopAppId;
                const displayApp = window.getEl('display-app-name');
                if (displayApp) displayApp.innerText = currentLoopAppId;
                if (window.appendToolMessage) window.appendToolMessage('System', 'success', `Project Workspace locked to: /apps/${currentLoopAppId}/`);
            }
            window.roadmap = act.tasks || [];
            if (window.renderRoadmap) window.renderRoadmap();
            window.activeTab = '__ROADMAP__';
            const tabsEl = window.getEl('preview-tabs');
            if (tabsEl) {
                tabsEl.querySelectorAll('.preview-tab').forEach(t => t.classList.remove('active'));
                const rmTab = window.getEl('tab-roadmap');
                if (rmTab) rmTab.classList.add('active');
            }
            if (window.showFileContent) window.showFileContent('__ROADMAP__');
            if (window.appendToolMessage) window.appendToolMessage('update_roadmap', 'success', 'Roadmap updated.');
            toolResultStr = 'Roadmap successfully updated.';
        }
        else if (type === 'list_browsers') {
            const res = await window.wsCommand('list_browsers', {});
            toolResultStr = JSON.stringify(res);
            if (window.appendToolMessage) window.appendToolMessage('list_browsers', res.status, res.status === 'success' ? `${res.data.length} tabs found` : res.message);
        }
        // â•â•â• BROWSER TAB MANAGEMENT (Critical for Browser AI Mode) â•â•â•
        // Uses wsCommand('open_ai_tab') â€” same IPC path as open_app
        // This actually creates a BrowserView in the Electron main process
        else if (type === 'open_browser_tab') {
            try {
                let url = act.url || 'https://www.google.com';
                if (!url.startsWith('http://') && !url.startsWith('https://')) {
                    if (url.includes(' ') || !url.includes('.')) {
                        url = 'https://www.google.com/search?q=' + encodeURIComponent(url);
                    } else {
                        url = 'https://' + url;
                    }
                }

                const label = act.label || new URL(url).hostname.replace('www.', '');
                // Check if tab for same domain already exists — REUSE it
                const existingLabel = label.replace(/[^a-z0-9]/gi, '');
                let tabId = 'browse-' + existingLabel + '-' + Date.now();
                let reuseExisting = false;
                if (window._agenticTabs) {
                    for (const [name, info] of Object.entries(window._agenticTabs)) {
                        if (name.replace(/[^a-z0-9]/gi, '') === existingLabel || info.url.includes(new URL(url).hostname)) {
                            tabId = info.tabId;
                            reuseExisting = true;
                            break;
                        }
                    }
                }

                // Strategy 1: Use openWebviewTab (index.html context)
                let opened = reuseExisting;
                if (!reuseExisting && typeof window.openWebviewTab === 'function') {
                    window.openWebviewTab(tabId, label, url);
                    opened = true;
                }
                // Strategy 2: Use wsCommand IPC (ai-builder.html context) â€” THE REAL PATH
                else if (!reuseExisting && typeof window.wsCommand === 'function') {
                    const res = await window.wsCommand('open_ai_tab', { tabId, url });
                    if (res.status === 'success') {
                        opened = true;
                    } else {
                        throw new Error(`wsCommand open_ai_tab failed: ${res.message || JSON.stringify(res)}`);
                    }
                } else if (!reuseExisting) {
                    throw new Error('No tab manager available (neither openWebviewTab nor wsCommand)');
                }

                if (opened) {
                    // Track tab in agentic registry (same as open_app does)
                    window._agenticTabs = window._agenticTabs || {};
                    window._agenticTabs[label] = { tabId, url, openedAt: Date.now() };
                    window.activeAppBrowserTabId = tabId;

                    toolResultStr = reuseExisting
                        ? `🌐 Reusing existing tab!\n  Tab ID: ${tabId}\n  URL: ${url}\n  Label: ${label}\n\nIMPORTANT: Use tabId "${tabId}" for all browser tools.`
                        : `🌐 Browser tab opened!\n  Tab ID: ${tabId}\n  URL: ${url}\n  Label: ${label}\n\nIMPORTANT: Use tabId "${tabId}" for all browser tools (capture_browser, click_element, scroll_page, type_text, read_dom).\nWait 2-3 seconds for page to load, then use capture_browser to see the page.`;
                    if (window.appendToolMessage) window.appendToolMessage('open_browser_tab', 'success', `ðŸŒ ${label}: ${url.substring(0, 30)}...`);
                }
            } catch (e) {
                toolResultStr = `open_browser_tab failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('open_browser_tab', 'error', e.message);
            }
        }
        else if (type === 'close_browser_tab') {
            try {
                const tabId = act.tab_id || act.tabId || act.bot_id;
                if (!tabId) {
                    toolResultStr = 'close_browser_tab: Please specify tab_id to close.';
                } else {
                    // Close via same IPC as close_app
                    if (typeof window.closeWebviewTab === 'function') {
                        window.closeWebviewTab(tabId);
                    } else if (typeof window.wsCommand === 'function') {
                        await window.wsCommand('close_ai_tab', { tabId });
                    }
                    // Remove from agentic registry
                    if (window._agenticTabs) {
                        for (const [name, info] of Object.entries(window._agenticTabs)) {
                            if (info.tabId === tabId) {
                                delete window._agenticTabs[name];
                                break;
                            }
                        }
                    }
                    if (window.activeAppBrowserTabId === tabId) {
                        window.activeAppBrowserTabId = null;
                    }
                    toolResultStr = `ðŸ—‘ï¸ Browser tab "${tabId}" closed.`;
                    if (window.appendToolMessage) window.appendToolMessage('close_browser_tab', 'success', `ðŸ—‘ï¸ ${tabId}`);
                }
            } catch (e) {
                toolResultStr = `close_browser_tab failed: ${e.message}`;
            }
        }
        else if (type === 'navigate_browser') {
            try {
                let url = act.url || '';
                const tabId = act.tab_id || act.tabId || act.bot_id;
                if (!url) {
                    toolResultStr = 'navigate_browser: Please specify url.';
                } else if (!tabId) {
                    toolResultStr = 'navigate_browser: Please specify tab_id. Use list_browsers to see available tabs.';
                } else {
                    if (!url.startsWith('http://') && !url.startsWith('https://')) {
                        if (url.includes(' ') || !url.includes('.')) {
                            url = 'https://www.google.com/search?q=' + encodeURIComponent(url);
                        } else {
                            url = 'https://' + url;
                        }
                    }
                    // Used main.js 'ai_navigate' which calls webContents.loadURL() â€” more reliable
                    const res = await window.wsCommand('ai_navigate', {
                        tabId: tabId,
                        url: url
                    });
                    toolResultStr = `ðŸ§­ Navigating tab "${tabId}" to: ${url}\nWait 2-3 seconds for page to load, then use capture_browser to see the result.`;
                    if (window.appendToolMessage) window.appendToolMessage('navigate_browser', 'success', `ðŸ§­ ${url.substring(0, 40)}`);
                }
            } catch (e) {
                toolResultStr = `navigate_browser failed: ${e.message}`;
            }
        }
        else if (type === 'capture_browser') {
            const tabId = act.tabId || act.tab_id || act.bot_id || window.activeAppBrowserTabId;
            if (!tabId) {
                toolResultStr = 'capture_browser: No tabId specified. Use list_browsers to see available tabs.';
                if (window.appendToolMessage) window.appendToolMessage('capture_browser', 'error', 'No tab specified');
            } else {
                const res = await window.wsCommand('capture_browser', { tabId });
                if (res.status === 'success') {
                    // Push to AI vision (chatHistory)
                    window.chatHistory.push({ role: 'system', content: `[Screenshot of ${tabId}]`, image: res.data });
                    // ALSO show in chat UI so USER can see what AI sees
                    if (window.appendChatMessage) window.appendChatMessage('agent', `ðŸ“¸ Screenshot of **${tabId}**:`, res.data);
                    toolResultStr = `Screenshot captured and displayed in chat. Use your Vision to analyze the UI state.`;
                    if (window.appendToolMessage) window.appendToolMessage('capture_browser', 'success', 'ðŸ“¸ Screenshot displayed');
                } else {
                    toolResultStr = JSON.stringify(res);
                    if (window.appendToolMessage) window.appendToolMessage('capture_browser', 'error', res.message);
                }
            }
        }
        else if (type === 'execute_browser_script') {
            const res = await window.wsCommand('execute_browser_script', { tabId: act.tabId, script: act.script });
            toolResultStr = JSON.stringify(res);
            if (window.appendToolMessage) window.appendToolMessage('execute_browser_script', res.status, res.status === 'success' ? 'DOM Injected' : res.message);
        }

        // â•â•â• PHASE 5: MEDIA & FILE TOOLS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

        // â”€â”€ DOWNLOAD VIDEO â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        else if (type === 'download_video') {
            try {
                const tabId = act.tabId || act.tab_id || act.bot_id || window.activeAppBrowserTabId;
                if (!tabId) {
                    toolResultStr = 'download_video: No tabId. Use list_browsers first.';
                } else {
                    // Strategy 1: Extract <video> src directly from the page
                    const extractScript = `
                        (function() {
                            const videos = document.querySelectorAll('video');
                            const sources = [];
                            videos.forEach(v => {
                                if (v.src) sources.push(v.src);
                                v.querySelectorAll('source').forEach(s => { if(s.src) sources.push(s.src); });
                            });
                            // Also check for blob URLs and data attributes
                            document.querySelectorAll('[data-video-src], [data-src]').forEach(el => {
                                const s = el.getAttribute('data-video-src') || el.getAttribute('data-src');
                                if (s && (s.includes('mp4') || s.includes('video'))) sources.push(s);
                            });
                            return JSON.stringify({ url: window.location.href, sources: [...new Set(sources)] });
                        })()
                    `;
                    const extractRes = await window.wsCommand('execute_browser_script', { tabId, script: extractScript });

                    if (extractRes.status === 'success' && extractRes.data) {
                        const parsed = typeof extractRes.data === 'string' ? JSON.parse(extractRes.data) : extractRes.data;

                        if (parsed.sources && parsed.sources.length > 0) {
                            // Download the first non-blob video source
                            const downloadable = parsed.sources.find(s => !s.startsWith('blob:'));
                            if (downloadable) {
                                // Download via Go API
                                const dlRes = await fetch('http://127.0.0.1:5000/api/download-file', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ url: downloadable, filename: act.filename || 'video_' + Date.now() + '.mp4' })
                                });
                                const dlData = await dlRes.json();
                                if (dlData.status === 'success') {
                                    toolResultStr = `ðŸ“¥ Video downloaded!\n  File: ${dlData.file_path}\n  Size: ${dlData.size}\n  Source: ${downloadable.substring(0, 60)}...`;
                                    if (window.appendToolMessage) window.appendToolMessage('download_video', 'success', `ðŸ“¥ ${dlData.file_path}`);
                                } else {
                                    toolResultStr = `Download failed: ${dlData.message}. Try using 'run_command' with yt-dlp: yt-dlp "${parsed.url}"`;
                                }
                            } else {
                                // All sources are blob: URLs, suggest yt-dlp
                                toolResultStr = `Found video but it's a blob URL (DRM protected). Try:\n{ "action": "run_command", "command": "yt-dlp \\"${parsed.url}\\"" }\nMake sure yt-dlp is installed: pip install yt-dlp`;
                            }
                        } else {
                            toolResultStr = `No <video> elements found on page. The video might be in an iframe or loaded dynamically. Try:\n1. Scroll to make sure the video is visible\n2. Use execute_browser_script to check for iframes\n3. Use yt-dlp: { "action": "run_command", "command": "yt-dlp \\"${parsed.url}\\"" }`;
                        }
                    } else {
                        toolResultStr = `Failed to extract video sources: ${JSON.stringify(extractRes)}`;
                    }
                }
                if (!toolResultStr.startsWith('ðŸ“¥') && window.appendToolMessage) window.appendToolMessage('download_video', 'error', 'See details');
            } catch (e) {
                toolResultStr = `download_video failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('download_video', 'error', e.message);
            }
        }

        // â”€â”€ UPLOAD FILE TO PAGE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        else if (type === 'upload_to_page') {
            try {
                const tabId = act.tabId || act.tab_id || window.activeAppBrowserTabId;
                const filePath = act.file_path;
                const selector = act.selector || 'input[type="file"]';
                if (!tabId || !filePath) {
                    toolResultStr = 'upload_to_page: Requires tabId and file_path.';
                } else {
                    const res = await window.wsCommand('upload_file_to_input', { tabId, selector, filePath });
                    if (res.status === 'success') {
                        toolResultStr = `ðŸ“¤ File uploaded to ${selector}. Use capture_browser to verify.`;
                        if (window.appendToolMessage) window.appendToolMessage('upload_to_page', 'success', `ðŸ“¤ Uploaded: ${filePath}`);
                    } else {
                        toolResultStr = `upload_to_page failed: ${res.message}`;
                        if (window.appendToolMessage) window.appendToolMessage('upload_to_page', 'error', res.message);
                    }
                }
            } catch (e) {
                toolResultStr = `upload_to_page failed: ${e.message}`;
            }
        }

        // â”€â”€ ATTACH FILE TO CHAT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        else if (type === 'attach_file') {
            try {
                let imageData = null;
                let filename = act.filename || 'file';

                if (act.base64) {
                    // Direct base64 data
                    imageData = act.base64;
                    filename = act.filename || 'attached_image.png';
                } else if (act.file_path) {
                    // Read from disk via Go API
                    const res = await fetch('http://127.0.0.1:5000/api/read-file-base64', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: act.file_path })
                    });
                    const data = await res.json();
                    if (data.status === 'success') {
                        imageData = data.base64;
                        filename = act.file_path.split(/[/\\\\]/).pop();
                    } else {
                        toolResultStr = `attach_file failed: ${data.message}`;
                    }
                }

                if (imageData) {
                    // Show in chat
                    if (window.appendChatMessage) window.appendChatMessage('agent', `ðŸ“Ž Attached: **${filename}**`, imageData);
                    // Add to AI vision
                    window.chatHistory.push({ role: 'system', content: `[File attached: ${filename}]`, image: imageData });
                    toolResultStr = `ðŸ“Ž File "${filename}" attached to chat and visible to both you and the user.`;
                    if (window.appendToolMessage) window.appendToolMessage('attach_file', 'success', `ðŸ“Ž ${filename}`);
                }
            } catch (e) {
                toolResultStr = `attach_file failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('attach_file', 'error', e.message);
            }
        }

        // â•â•â• PHASE 5: COOKIE MANAGEMENT â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

        // â”€â”€ IMPORT COOKIES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        else if (type === 'import_cookies') {
            try {
                const tabId = act.tabId || act.tab_id || window.activeAppBrowserTabId;
                if (!tabId) {
                    toolResultStr = 'import_cookies: No tabId specified.';
                } else {
                    let cookies = act.cookies || [];

                    // Parse Netscape format if provided
                    if (act.netscape) {
                        cookies = [];
                        // Support both actual newlines and escaped \n from JSON
                        const rawContent = act.netscape.replace(/\\n/g, '\n').replace(/\\t/g, '\t');

                        // Multi-session support: split by Netscape headers
                        const sessionBlocks = rawContent.split(/# Netscape HTTP Cookie File/).filter(b => b.trim());
                        const sessionIndex = (act.session_index || act.sessionIndex || 1) - 1; // 1-based to 0-based
                        const selectedBlock = sessionBlocks[Math.min(sessionIndex, sessionBlocks.length - 1)] || sessionBlocks[0] || '';
                        if (sessionBlocks.length > 1) {
                            console.log('[import_cookies] Multi-session file detected: ' + sessionBlocks.length + ' sessions. Using session ' + (sessionIndex + 1));
                        }
                        const lines = selectedBlock.split('\n');
                        for (const line of lines) {
                            const trimmed = line.trim();
                            if (!trimmed || trimmed.startsWith('#')) continue;
                            // Split on actual tab characters
                            // Tab-split with fallback to multi-space
                            let parts = trimmed.split('\t');
                            if (parts.length < 7) parts = trimmed.split(/\s{2,}/);
                            if (parts.length >= 7) {
                                cookies.push({
                                    url: `https://${parts[0].replace(/^\\./, '')}${parts[2]}`,
                                    name: parts[5],
                                    value: parts[6],
                                    domain: parts[0],
                                    path: parts[2],
                                    secure: parts[3] === 'TRUE',
                                    expirationDate: parseInt(parts[4]) > 0 ? parseInt(parts[4]) : undefined
                                });
                            }
                        }
                    }

                    let imported = 0;
                    let failed = 0;

                    // Batch import: send cookies in groups of 10 to prevent WS hang
                    const batchSize = 10;
                    for (let i = 0; i < cookies.length; i += batchSize) {
                        const batch = cookies.slice(i, i + batchSize);
                        const promises = batch.map(cookie => {
                            const cookieObj = {
                                url: cookie.url || `https://${(cookie.domain || '').replace(/^\\./, '')}${cookie.path || '/'}`,
                                name: cookie.name,
                                value: cookie.value,
                                domain: cookie.domain,
                                path: cookie.path || '/',
                                secure: cookie.secure !== false
                            };
                            if (cookie.expirationDate) cookieObj.expirationDate = cookie.expirationDate;
                            return window.wsCommand('set_cookie', { tabId, cookie: cookieObj })
                                .then(res => { if (res.status === 'success') imported++; else failed++; })
                                .catch(() => { failed++; });
                        });
                        await Promise.all(promises);
                    }

                    // Small delay then reload to apply cookies
                    await new Promise(r => setTimeout(r, 500));
                    await window.wsCommand('execute_browser_script', { tabId, script: 'window.location.reload()' });

                    toolResultStr = `ðŸª Cookies imported: ${imported} success, ${failed} failed (total: ${cookies.length}). Page reloaded to apply.`;
                    if (window.appendToolMessage) window.appendToolMessage('import_cookies', 'success', `ðŸª ${imported}/${cookies.length} cookies imported`);
                }
            } catch (e) {
                toolResultStr = `import_cookies failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('import_cookies', 'error', e.message);
            }
        }

        // â”€â”€ EXPORT COOKIES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        else if (type === 'export_cookies') {
            try {
                const tabId = act.tabId || act.tab_id || window.activeAppBrowserTabId;
                if (!tabId) {
                    toolResultStr = 'export_cookies: No tabId specified.';
                } else {
                    const res = await window.wsCommand('get_cookies', { tabId });
                    if (res.status === 'success') {
                        const cookies = res.data || [];
                        toolResultStr = `ðŸª Exported ${cookies.length} cookies from tab "${tabId}":\n${JSON.stringify(cookies.slice(0, 20), null, 2)}${cookies.length > 20 ? '\n... (' + (cookies.length - 20) + ' more)' : ''}`;
                        if (window.appendToolMessage) window.appendToolMessage('export_cookies', 'success', `ðŸª ${cookies.length} cookies`);
                    } else {
                        toolResultStr = `export_cookies failed: ${res.message}`;
                        if (window.appendToolMessage) window.appendToolMessage('export_cookies', 'error', res.message);
                    }
                }
            } catch (e) {
                toolResultStr = `export_cookies failed: ${e.message}`;
            }
        }

        // â”€â”€ LIST WORKSPACE FILES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        else if (type === 'list_workspace') {
            try {
                const engineFs = window.originalNodeRequire ? window.originalNodeRequire('fs') : require('fs');
                const enginePath = window.originalNodeRequire ? window.originalNodeRequire('path') : require('path');
                const basePath = window._fmBasePath || enginePath.join(__dirname, 'workspace');
                const subDir = act.path || act.folder || '';
                const targetDir = subDir ? enginePath.join(basePath, subDir) : basePath;

                if (!engineFs.existsSync(targetDir)) {
                    toolResultStr = `list_workspace: Folder "${subDir || 'workspace'}" does not exist.`;
                } else {
                    const entries = engineFs.readdirSync(targetDir, { withFileTypes: true });
                    const items = entries.map(e => {
                        const fullP = enginePath.join(targetDir, e.name);
                        if (e.isDirectory()) {
                            let count = 0;
                            try { count = engineFs.readdirSync(fullP).length; } catch (ex) { }
                            return `ðŸ“‚ ${e.name}/ (${count} items)`;
                        } else {
                            let size = 0;
                            try { size = engineFs.statSync(fullP).size; } catch (ex) { }
                            const sizeStr = size > 1048576 ? (size / 1048576).toFixed(1) + 'MB' : size > 1024 ? (size / 1024).toFixed(0) + 'KB' : size + 'B';
                            return `ðŸ“„ ${e.name} (${sizeStr})`;
                        }
                    });
                    const displayDir = subDir || 'workspace';
                    toolResultStr = `ðŸ“ Files in ${displayDir}/:\n${items.length > 0 ? items.join('\n') : '(empty folder)'}\n\nFull path: ${targetDir.replace(/\\/g, '/')}`;
                    if (window.appendToolMessage) window.appendToolMessage('list_workspace', 'success', `ðŸ“ ${items.length} items in ${displayDir}/`);
                }
            } catch (e) {
                toolResultStr = `list_workspace failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('list_workspace', 'error', e.message);
            }
        }

        // â”€â”€ READ WORKSPACE FILE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        else if (type === 'read_workspace_file') {
            try {
                const engineFs = window.originalNodeRequire ? window.originalNodeRequire('fs') : require('fs');
                const enginePath = window.originalNodeRequire ? window.originalNodeRequire('path') : require('path');
                const basePath = window._fmBasePath || enginePath.join(__dirname, 'workspace');
                const filePath = act.path || act.file || '';

                if (!filePath) {
                    toolResultStr = 'read_workspace_file: Please specify "path" (relative to workspace/).';
                } else {
                    // Support both absolute and relative paths
                    let fullPath = filePath;
                    if (!enginePath.isAbsolute(filePath)) {
                        fullPath = enginePath.join(basePath, filePath);
                    }

                    if (!engineFs.existsSync(fullPath)) {
                        toolResultStr = `read_workspace_file: File not found: ${filePath}`;
                    } else {
                        const stat = engineFs.statSync(fullPath);
                        if (stat.size > 5 * 1024 * 1024) {
                            toolResultStr = `read_workspace_file: File too large (${(stat.size / 1048576).toFixed(1)}MB). Max 5MB for reading.`;
                        } else {
                            const content = engineFs.readFileSync(fullPath, 'utf-8');
                            toolResultStr = `ðŸ“„ Content of ${filePath} (${(stat.size / 1024).toFixed(1)}KB):\n\n${content}`;
                            if (window.appendToolMessage) window.appendToolMessage('read_workspace_file', 'success', `ðŸ“„ Read: ${filePath}`);
                        }
                    }
                }
            } catch (e) {
                toolResultStr = `read_workspace_file failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('read_workspace_file', 'error', e.message);
            }
        }

        // â•â•â• PHASE 4B: KNOWLEDGE BASE TOOLS (Global Learning) â•â•â•â•â•â•â•â•â•â•â•

        // â”€â”€ KB SEARCH â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        else if (type === 'kb_search') {
            try {
                const query = act.query || act.q || '';
                const tags = act.tags || [];
                const category = act.category || '';
                const lang = act.lang || act.language || '';
                const limit = act.limit || 15;

                if (!query && tags.length === 0 && !category && !lang) {
                    toolResultStr = 'kb_search: Please provide "query", "category", "tags", or "lang" to search.';
                } else {
                    let url = `https://floworkos.com/api/v1/kb/search?q=${encodeURIComponent(query)}&limit=${limit}`;
                    if (tags.length > 0) url += `&tags=${encodeURIComponent(tags.join(','))}`;
                    if (category) url += `&category=${encodeURIComponent(category)}`;
                    if (lang) url += `&lang=${encodeURIComponent(lang)}`;

                    const res = await (window.kvDedupFetch || fetch)(url);
                    const data = await res.json();

                    if (data.status === 'success' && data.results) {
                        if (data.results.length === 0) {
                            toolResultStr = `ðŸ“š KB Search: No articles found for "${query}"${category ? ` in category "${category}"` : ''}${lang ? ` (${lang})` : ''}. This is a new topic â€” build it fresh!`;
                        } else {
                            const list = data.results.map((r, i) =>
                                `${i + 1}. **${r.title}**\n   ID: \`${r.id}\`\n   Category: ${r.category || 'general'} | Language: ${r.language || 'js'} | Score: ${r.score}\n   Tags: ${(r.tags || []).join(', ')}\n   ${(r.summary || '').substring(0, 120)}...`
                            ).join('\n\n');
                            toolResultStr = `ðŸ“š KB Search Results (${data.total} found):\n\n${list}\n\nðŸ’¡ Use kb_read with the article ID to read the full guide.\nðŸ’¡ Use kb_update with the article ID to update an existing article.`;
                        }
                        window._hasSearchedKB = true;
                        if (window._hasSearchedKB && window._hasSearchedTools) window._phase0Done = true;
                        if (window.appendToolMessage) window.appendToolMessage('kb_search', 'success', `ðŸ“š ${data.total} articles found`);
                    } else {
                        toolResultStr = 'kb_search: Server returned error: ' + (data.error || 'Unknown') + '. Falling back to kb_list...';
                        // FALLBACK: Use kb_list + client-side filtering
                        try {
                            const fallbackRes = await (window.kvDedupFetch || fetch)('https://floworkos.com/api/v1/kb/list?limit=100');
                            const fallbackData = await fallbackRes.json();
                            if (fallbackData.status === 'success' && fallbackData.articles) {
                                const q = (query || '').toLowerCase();
                                const filtered = fallbackData.articles.filter(a => {
                                    const t = (a.title || '').toLowerCase();
                                    const s = (a.summary || '').toLowerCase();
                                    const tags = (a.tags || []).join(' ').toLowerCase();
                                    return t.includes(q) || s.includes(q) || tags.includes(q);
                                }).slice(0, limit);

                                if (filtered.length === 0) {
                                    toolResultStr = 'kb_search (fallback): No matching articles found for "' + query + '". This is a new topic!';
                                } else {
                                    const list = filtered.map((a, i) =>
                                        (i + 1) + '. **' + a.title + '**\n   ID: \`' + a.id + '\`\n   Category: ' + (a.category || 'general') + ' | Tags: ' + (a.tags || []).join(', ')
                                    ).join('\n\n');
                                    toolResultStr = 'kb_search (fallback via kb_list): ' + filtered.length + ' results\n\n' + list + '\n\nðŸ’¡ Use kb_read with the article ID to read the full guide.';
                                }
                                if (window.appendToolMessage) window.appendToolMessage('kb_search', 'success', 'ðŸ“š ' + filtered.length + ' results (fallback)');
                            }
                        } catch (fb) { /* fallback also failed, keep original error */ }
                    }
                }
            } catch (e) {
                toolResultStr = `kb_search failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('kb_search', 'error', e.message);
            }
        }

        // â”€â”€ KB READ â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        else if (type === 'kb_read') {
            try {
                const articleId = act.id || act.article_id || '';
                if (!articleId) {
                    toolResultStr = 'kb_read: Please provide "id" of the article to read.';
                } else {
                    const res = await (window.kvDedupFetch || fetch)(`https://floworkos.com/api/v1/kb/${encodeURIComponent(articleId)}`);
                    const data = await res.json();

                    if (data.status === 'success' && data.article) {
                        const a = data.article;
                        let content = `ðŸ“– **${a.title}** (v${a.version})\n`;
                        content += `Tags: ${(a.tags || []).join(', ')}\n`;
                        content += `Type: ${a.type} | Language: ${a.language}\n\n`;
                        content += `## Summary\n${a.summary}\n\n`;
                        if (a.architecture) content += `## Architecture\n${a.architecture}\n\n`;
                        if (a.key_patterns && a.key_patterns.length > 0) {
                            content += `## Key Patterns\n${a.key_patterns.map(p => `- ${p}`).join('\n')}\n\n`;
                        }
                        if (a.files_structure && a.files_structure.length > 0) {
                            content += `## File Structure\n${a.files_structure.map(f => `- ${f}`).join('\n')}\n\n`;
                        }
                        if (a.code_snippets && Object.keys(a.code_snippets).length > 0) {
                            content += `## Code Reference\n`;
                            for (const [fname, code] of Object.entries(a.code_snippets)) {
                                content += `### ${fname}\n\`\`\`\n${code.substring(0, 800)}\n\`\`\`\n\n`;
                            }
                        }
                        if (a.common_errors && a.common_errors.length > 0) {
                            content += `## Common Pitfalls\n${a.common_errors.map(e => `âš ï¸ ${e}`).join('\n')}\n`;
                        }
                        toolResultStr = content;
                        if (window.appendToolMessage) window.appendToolMessage('kb_read', 'success', `ðŸ“– Read: ${a.title}`);
                    } else {
                        toolResultStr = `kb_read: Article not found: ${articleId}`;
                    }
                }
            } catch (e) {
                toolResultStr = `kb_read failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('kb_read', 'error', e.message);
            }
        }

        // â”€â”€ KB LIST â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        else if (type === 'kb_list') {
            try {
                const limit = act.limit || 50;
                const category = act.category || '';
                const lang = act.lang || act.language || '';
                let url = `https://floworkos.com/api/v1/kb/list?limit=${limit}`;
                if (category) url += `&category=${encodeURIComponent(category)}`;
                if (lang) url += `&lang=${encodeURIComponent(lang)}`;

                const res = await (window.kvDedupFetch || fetch)(url);
                const data = await res.json();

                if (data.status === 'success' && data.articles) {
                    if (data.articles.length === 0) {
                        toolResultStr = 'ðŸ“š Knowledge Base is empty. No articles published yet.';
                    } else {
                        const list = data.articles.map((a, i) =>
                            `${i + 1}. **${a.title}**\n   ID: \`${a.id}\`\n   Category: ${a.category || 'general'} | Language: ${a.language || 'js'} | Version: ${a.version || 1}\n   Tags: ${(a.tags || []).join(', ')}`
                        ).join('\n');

                        let stats = '';
                        if (data.categories) {
                            stats = `\n\nðŸ“Š Categories: ${Object.entries(data.categories).map(([k, v]) => `${k}(${v})`).join(', ')}`;
                        }
                        if (data.languages) {
                            stats += `\nðŸ”¤ Languages: ${Object.entries(data.languages).map(([k, v]) => `${k}(${v})`).join(', ')}`;
                        }

                        toolResultStr = `ðŸ“š Knowledge Base (${data.total} articles):\n\n${list}${stats}`;
                    }
                    if (window.appendToolMessage) window.appendToolMessage('kb_list', 'success', `ðŸ“š ${data.total} articles`);
                } else {
                    toolResultStr = `kb_list: ${data.error || 'Unknown error'}`;
                }
            } catch (e) {
                toolResultStr = `kb_list failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('kb_list', 'error', e.message);
            }
        }

        // â”€â”€ KB PUBLISH â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        else if (type === 'kb_publish') {
            try {
                let article = act.article;

                // Auto-generate if not provided
                if (!article && window._kbGenerateArticle) {
                    const appId = act.app_id || window.currentAppId || 'unnamed';
                    const outputType = act.output_type || document.getElementById('select-output-type')?.value || 'app';
                    const language = act.language || document.getElementById('select-language')?.value || 'javascript';
                    article = window._kbGenerateArticle(appId, outputType, window.generatedFiles, language);
                }

                // â›” PROTECT base-prompt articles
                if (article && article.id && article.id.startsWith('base-prompt-')) {
                    toolResultStr = 'â›” kb_publish BLOCKED: Cannot publish with base-prompt-* ID. These are PROTECTED system articles.';
                    if (window.appendToolMessage) window.appendToolMessage('kb_publish', 'error', 'â›” Protected ID');
                } else if (!article || !article.id || !article.title) {
                    toolResultStr = 'kb_publish: No article data. Cannot publish.';
                } else {
                    // Sanitize before publish
                    if (window._kbSanitize) article = window._kbSanitize(article);

                    const res = await fetch('https://floworkos.com/api/v1/kb/publish', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ article })
                    });
                    const data = await res.json();

                    if (data.status === 'success') {
                        // Invalidate KB cache after publish
                        if (window.kvCache) window.kvCache.invalidateKB();
                        toolResultStr = `✨ Knowledge Base ${data.action === 'updated' ? 'updated' : 'published'}!\n\n📖 "${article.title}" (v${data.version})\n🏷️ Tags: ${article.tags.join(', ')}\n\nI'll remember this experience. Next time a similar project comes up, I'll be faster and more accurate. 🧠`;
                        if (window.appendToolMessage) window.appendToolMessage('kb_publish', 'success', `✨ Published: ${article.title}`);
                    } else {
                        toolResultStr = `kb_publish failed: ${data.error}`;
                        if (window.appendToolMessage) window.appendToolMessage('kb_publish', 'error', data.error);
                    }
                }
            } catch (e) {
                toolResultStr = `kb_publish failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('kb_publish', 'error', e.message);
            }
        }

        // â”€â”€ KB UPDATE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        else if (type === 'kb_update') {
            try {
                const articleId = act.id || act.article_id || '';
                const changeReason = act.reason || act.change_reason || 'Updated with latest changes';

                // â›” PROTECT base-prompt articles from AI modification
                if (articleId.startsWith('base-prompt-')) {
                    toolResultStr = 'â›” kb_update BLOCKED: base-prompt-* articles are PROTECTED system articles. Only administrators can modify them.';
                    if (window.appendToolMessage) window.appendToolMessage('kb_update', 'error', 'â›” Protected article');
                } else if (articleId.startsWith('ki_')) {
                    toolResultStr = 'âš ï¸ kb_update: "' + articleId + '" is a LOCAL knowledge item (save_knowledge), not a KB article. Use kb_search or kb_list to find the correct KB article ID (e.g. "app-tiktok-v1", "browser-wall-clock-v1").';
                    if (window.appendToolMessage) window.appendToolMessage('kb_update', 'error', 'âš ï¸ Wrong ID type');
                } else if (!articleId) {
                    toolResultStr = 'kb_update: Please provide "id" of the article to update. Use kb_search or kb_list to find the ID.';
                } else {
                    // First, fetch existing article
                    const checkRes = await (window.kvDedupFetch || fetch)(`https://floworkos.com/api/v1/kb/${encodeURIComponent(articleId)}`);
                    const checkData = await checkRes.json();

                    if (checkData.status !== 'success' || !checkData.article) {
                        toolResultStr = `kb_update: Article not found: ${articleId}. Use kb_publish to create a new one.`;
                    } else {
                        // Start with existing article as base
                        let article = { ...checkData.article };

                        // STRATEGY 1: Full article replacement
                        if (act.article) {
                            article = { ...article, ...act.article };
                            article.id = articleId;
                        }
                        // STRATEGY 2: Partial field updates
                        else if (act.updates) {
                            for (const [key, value] of Object.entries(act.updates)) {
                                if (Array.isArray(article[key]) && Array.isArray(value)) {
                                    article[key] = [...new Set([...article[key], ...value])];
                                } else if (typeof article[key] === 'object' && typeof value === 'object' && !Array.isArray(value)) {
                                    article[key] = { ...article[key], ...value };
                                } else {
                                    article[key] = value;
                                }
                            }
                        }
                        // STRATEGY 3: Quick append helpers
                        else {
                            if (act.add_pattern) {
                                article.key_patterns = article.key_patterns || [];
                                if (!article.key_patterns.includes(act.add_pattern)) article.key_patterns.push(act.add_pattern);
                            }
                            if (act.add_error) {
                                article.common_errors = article.common_errors || [];
                                if (!article.common_errors.includes(act.add_error)) article.common_errors.push(act.add_error);
                            }
                            if (act.add_snippet && act.snippet_name) {
                                article.code_snippets = article.code_snippets || {};
                                article.code_snippets[act.snippet_name] = act.add_snippet;
                            }
                            if (act.add_tags) {
                                article.tags = [...new Set([...(article.tags || []), ...(Array.isArray(act.add_tags) ? act.add_tags : [act.add_tags])])];
                            }
                            // Fallback: auto-generate from project files (app_builder mode)
                            if (!act.add_pattern && !act.add_error && !act.add_snippet && !act.add_tags) {
                                if (window._kbGenerateArticle && window.generatedFiles && Object.keys(window.generatedFiles).length > 0) {
                                    const appId = act.app_id || window.currentAppId || articleId.replace(/^(app|node)-/, '').replace(/-v\\d+$/, '');
                                    const genArticle = window._kbGenerateArticle(appId, checkData.article.type || 'app', window.generatedFiles, checkData.article.language || 'javascript');
                                    if (genArticle) { article = genArticle; article.id = articleId; }
                                }
                            }
                        }

                        if (!article || !article.id) {
                            toolResultStr = 'kb_update: Could not build updated article. Try: { "action": "kb_update", "id": "...", "add_pattern": "new pattern" } or "add_error" or "add_snippet".';
                        } else {
                            if (window._kbSanitize) article = window._kbSanitize(article);
                            if (window._kbGenerateArticleBody) article.article_body = window._kbGenerateArticleBody(article);

                            const res = await fetch('https://floworkos.com/api/v1/kb/publish', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ article, change_reason: changeReason })
                            });
                            const data = await res.json();

                            if (data.status === 'success') {
                                // Invalidate KB cache after update
                                if (window.kvCache) window.kvCache.invalidateKB();
                                toolResultStr = `ðŸ“ Knowledge Base updated!\n\nðŸ“– "${article.title}" â†’ v${data.version}\nðŸ“‹ Reason: ${changeReason}\nðŸ·ï¸ Tags: ${(article.tags || []).join(', ')}\n\nThe guide has been refreshed. ðŸ§ `;
                                if (window.appendToolMessage) window.appendToolMessage('kb_update', 'success', `ðŸ“ Updated: ${article.title} v${data.version}`);
                            } else {
                                toolResultStr = `kb_update failed: ${data.error}`;
                            }
                        }
                    }
                }
            } catch (e) {
                toolResultStr = `kb_update failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('kb_update', 'error', e.message);
            }
        }

        // â•â•â• PHASE 4C: REUSABLE TOOLS (KV-based, hemat token) â•â•â•â•â•â•â•â•â•â•â•â•

        // â”€â”€ TOOLS SEARCH â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        else if (type === 'tools_search') {
            try {
                const query = act.query || act.q || '';
                const category = act.category || '';
                const lang = act.lang || act.language || '';
                const tags = act.tags || [];
                const limit = act.limit || 15;

                if (!query && !category && !lang && tags.length === 0) {
                    toolResultStr = 'tools_search: Provide at least one: "query", "category", "lang", or "tags".';
                } else {
                    // Check localStorage cache first (5 min TTL)
                    const cacheKey = `tools_cache_${query}_${category}_${lang}_${(tags || []).join(',')}`;
                    let cached = null;
                    try {
                        const raw = localStorage.getItem(cacheKey);
                        if (raw) {
                            const parsed = JSON.parse(raw);
                            if (Date.now() - parsed.ts < 300000) cached = parsed.data;
                        }
                    } catch (ce) { }

                    if (cached) {
                        // Serve from cache
                        if (cached.results && cached.results.length === 0) {
                            toolResultStr = `ðŸ”§ Tools Search (cached): No tools found for "${query}". This capability doesn't exist yet â€” you'll need to build it from scratch and create the tool in FASE 5 POST-TASK.`;
                        } else {
                            const list = cached.results.map((r, i) =>
                                `${i + 1}. **${r.name}** (score: ${r.score})\n   ID: \`${r.id}\`\n   Category: ${r.category} | Language: ${r.language} | Used: ${r.usage_count}x\n   Tags: ${(r.tags || []).join(', ')}\n   ${(r.description || '').substring(0, 120)}...`
                            ).join('\n\n');
                            toolResultStr = `ðŸ”§ Tools Search (cached, ${cached.total} found):\n\n${list}\n\nðŸ’¡ Use tools_get with the ID to read the full tool steps & code.`;
                        }
                        window._hasSearchedTools = true;
                        if (window._hasSearchedKB && window._hasSearchedTools) window._phase0Done = true;
                        if (window.appendToolMessage) window.appendToolMessage('tools_search', 'success', `ðŸ”§ ${cached.total} tools (cached)`);
                    } else {
                        // Fetch from API
                        let url = `https://floworkos.com/api/v1/tools/search?q=${encodeURIComponent(query)}&limit=${limit}`;
                        if (category) url += `&category=${encodeURIComponent(category)}`;
                        if (lang) url += `&lang=${encodeURIComponent(lang)}`;
                        if (tags.length > 0) url += `&tags=${encodeURIComponent(tags.join(','))}`;

                        const res = await (window.kvDedupFetch || fetch)(url);
                        const data = await res.json();

                        // Cache response
                        try {
                            localStorage.setItem(cacheKey, JSON.stringify({ data, ts: Date.now() }));
                            // Limit cache entries to 50
                            const allKeys = Object.keys(localStorage).filter(k => k.startsWith('tools_cache_'));
                            if (allKeys.length > 50) localStorage.removeItem(allKeys[0]);
                        } catch (ce) { }

                        if (data.status === 'success' && data.results) {
                            if (data.results.length === 0) {
                                toolResultStr = `ðŸ”§ Tools Search: No tools found for "${query}"${category ? ` in category "${category}"` : ''}${lang ? ` (${lang})` : ''}. This capability doesn't exist yet â€” you'll need to build it from scratch. Remember to create the tool in FASE 5 POST-TASK using tools_save!`;
                            } else {
                                const list = data.results.map((r, i) =>
                                    `${i + 1}. **${r.name}** (score: ${r.score})\n   ID: \`${r.id}\`\n   Category: ${r.category} | Language: ${r.language} | Used: ${r.usage_count}x | Success: ${Math.round((r.success_rate || 0) * 100)}%\n   Tags: ${(r.tags || []).join(', ')}\n   ${(r.description || '').substring(0, 120)}...`
                                ).join('\n\n');
                                toolResultStr = `ðŸ”§ Tools Search (${data.total} found):\n\n${list}\n\nðŸ’¡ Use tools_get with the ID to read the full tool steps & code.\nðŸ’¡ If tool exists, use it as blueprint â€” DON'T reinvent the wheel!`;
                            }
                            if (window.appendToolMessage) window.appendToolMessage('tools_search', 'success', `ðŸ”§ ${data.total} tools found`);
                        } else {
                            toolResultStr = `tools_search: ${data.error || 'Unknown error'}`;
                            if (window.appendToolMessage) window.appendToolMessage('tools_search', 'error', data.error || 'Unknown');
                        }
                    }
                }
            } catch (e) {
                toolResultStr = `tools_search failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('tools_search', 'error', e.message);
            }
        }

        // â”€â”€ TOOLS GET â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        else if (type === 'tools_get') {
            try {
                const toolId = act.id || act.tool_id || '';
                if (!toolId) {
                    toolResultStr = 'tools_get: Please provide "id" of the tool to read.';
                } else {
                    const res = await (window.kvDedupFetch || fetch)(`https://floworkos.com/api/v1/tools/${encodeURIComponent(toolId)}`);
                    const data = await res.json();

                    if (data.status === 'success' && data.tool) {
                        const t = data.tool;
                        let content = `ðŸ”§ **${t.name}** (v${t.version}) â€” ${t.category}/${t.language}\n`;
                        content += `â±ï¸ Runtime: ${t.runtime || 'browser_script'} | Platform: ${t.platform || '-'}\n`;
                        content += `ðŸ“Š Used ${t.usage_count}x | Success: ${Math.round((t.success_rate || 0) * 100)}%\n`;
                        content += `Tags: ${(t.tags || []).join(', ')}\n\n`;

                        // PRE-CONDITIONS
                        if (t.pre_conditions && t.pre_conditions.length > 0) {
                            content += `## Pre-Conditions\n`;
                            t.pre_conditions.forEach(c => { content += `- ${c}\n`; });
                            content += '\n';
                        }

                        // SELECTORS (for browser tools)
                        if (t.selectors && Object.keys(t.selectors).length > 0) {
                            content += `## CSS Selectors\n\`\`\`json\n${JSON.stringify(t.selectors, null, 2)}\n\`\`\`\n\n`;
                        }

                        // THE CODE â€” this is the main content
                        if (t.code) {
                            content += `## âš¡ EXECUTABLE CODE (copy & run directly!)\n\`\`\`${t.language || 'javascript'}\n${t.code.substring(0, 2000)}\n\`\`\`\n\n`;
                        } else if (t.code_snippet) {
                            // Legacy fallback
                            content += `## Code Reference\n\`\`\`${t.language || 'javascript'}\n${t.code_snippet.substring(0, 1500)}\n\`\`\`\n\n`;
                        }

                        // PARAMETERS
                        if (t.parameters && t.parameters.length > 0) {
                            content += `## Parameters\n`;
                            t.parameters.forEach(p => {
                                content += `- **${p.name}** (${p.type || 'string'}): ${p.description || ''}\n`;
                            });
                            content += '\n';
                        }

                        // SUCCESS INDICATORS
                        if (t.success_indicators && t.success_indicators.length > 0) {
                            content += `## Success Check\n`;
                            t.success_indicators.forEach(s => { content += `- \`${s}\`\n`; });
                            content += '\n';
                        }

                        // POST-CONDITIONS
                        if (t.post_conditions && t.post_conditions.length > 0) {
                            content += `## Expected Result\n`;
                            t.post_conditions.forEach(c => { content += `- ${c}\n`; });
                            content += '\n';
                        }

                        content += `\nâš¡ This is EXECUTABLE CODE â€” run it directly via execute_browser_script or run_command. DO NOT rewrite!`;
                        toolResultStr = content;
                        if (window.appendToolMessage) window.appendToolMessage('tools_get', 'success', `ðŸ”§ Read: ${t.name}`);
                    } else {
                        toolResultStr = `tools_get: Tool not found: ${toolId}`;
                        if (window.appendToolMessage) window.appendToolMessage('tools_get', 'error', `Not found: ${toolId}`);
                    }
                }
            } catch (e) {
                toolResultStr = `tools_get failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('tools_get', 'error', e.message);
            }
        }

        // â”€â”€ TOOLS SAVE (Create/Update) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        else if (type === 'tools_save') {
            try {
                const tool = act.tool;
                if (!tool || !tool.id || !tool.name) {
                    toolResultStr = 'tools_save: Tool must have "id", "name" and "code". Example: { "action": "tools_save", "tool": { "id": "tool-tiktok-click-upload", "name": "Click Upload", "runtime": "browser_script", "code": "document.querySelector(...).click()", "category": "browser", "language": "javascript", "tags": [...], "selectors": {...}, "pre_conditions": [...] } }';
                } else {
                    // Sanitize: remove local paths/secrets from code
                    if (tool.code && window._kbSanitize) {
                        const tempArticle = { code_snippets: { main: tool.code } };
                        const sanitized = window._kbSanitize(tempArticle);
                        tool.code = sanitized.code_snippets?.main || tool.code;
                    }
                    // Legacy fallback: also sanitize code_snippet
                    if (tool.code_snippet && window._kbSanitize) {
                        const tempArticle = { code_snippets: { main: tool.code_snippet } };
                        const sanitized = window._kbSanitize(tempArticle);
                        tool.code_snippet = sanitized.code_snippets?.main || tool.code_snippet;
                    }

                    const changeReason = act.change_reason || act.reason || '';
                    const res = await fetch('https://floworkos.com/api/v1/tools/publish', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tool, change_reason: changeReason })
                    });
                    const data = await res.json();

                    if (data.status === 'success') {
                        // Invalidate KV cache + old localStorage cache
                        if (window.kvCache) window.kvCache.invalidateTools();
                        try {
                            Object.keys(localStorage).filter(k => k.startsWith('tools_cache_')).forEach(k => localStorage.removeItem(k));
                        } catch (ce) { }

                        toolResultStr = `âœ¨ Tool ${data.action === 'updated' ? 'updated' : 'saved'}!\n\nðŸ”§ "${tool.name}" â†’ v${data.version}\nâ±ï¸ Runtime: ${data.runtime || tool.runtime || 'browser_script'}\nðŸ·ï¸ Category: ${tool.category || 'general'} | Language: ${tool.language || 'javascript'}\nðŸ·ï¸ Tags: ${(tool.tags || []).join(', ')}\nðŸ“¦ Code: ${(tool.code || '').length} chars\n\nThis tool is now in the global library. Other AI sessions will find and execute it directly. ðŸ§ `;
                        if (window.appendToolMessage) window.appendToolMessage('tools_save', 'success', `âœ¨ ${data.action}: ${tool.name} v${data.version}`);
                    } else {
                        toolResultStr = `tools_save failed: ${data.error}`;
                        if (window.appendToolMessage) window.appendToolMessage('tools_save', 'error', data.error);
                    }
                }
            } catch (e) {
                toolResultStr = `tools_save failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('tools_save', 'error', e.message);
            }
        }

        // â”€â”€ TOOLS LIST â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        else if (type === 'tools_list') {
            try {
                const limit = act.limit || 50;
                const category = act.category || '';
                const lang = act.lang || act.language || '';
                const tags = act.tags || '';
                let url = `https://floworkos.com/api/v1/tools/list?limit=${limit}`;
                if (category) url += `&category=${encodeURIComponent(category)}`;
                if (lang) url += `&lang=${encodeURIComponent(lang)}`;
                if (tags) url += `&tags=${encodeURIComponent(Array.isArray(tags) ? tags.join(',') : tags)}`;

                const res = await (window.kvDedupFetch || fetch)(url);
                const data = await res.json();

                if (data.status === 'success' && data.tools) {
                    if (data.tools.length === 0) {
                        toolResultStr = `ðŸ”§ Tools Library is empty${category ? ` for category "${category}"` : ''}${lang ? ` in ${lang}` : ''}. No tools created yet.`;
                    } else {
                        const list = data.tools.map((t, i) =>
                            `${i + 1}. **${t.name}**\n   ID: \`${t.id}\`\n   Category: ${t.category} | Language: ${t.language} | Used: ${t.usage_count}x | v${t.version}\n   Tags: ${(t.tags || []).join(', ')}`
                        ).join('\n');

                        let stats = '';
                        if (data.categories) {
                            stats = `\n\nðŸ“Š Categories: ${Object.entries(data.categories).map(([k, v]) => `${k}(${v})`).join(', ')}`;
                        }
                        if (data.languages) {
                            stats += `\nðŸ”¤ Languages: ${Object.entries(data.languages).map(([k, v]) => `${k}(${v})`).join(', ')}`;
                        }
                        if (data.top_tags) {
                            stats += `\nðŸ·ï¸ Top Tags: ${data.top_tags.slice(0, 15).map(t => `${t.tag}(${t.count})`).join(', ')}`;
                        }

                        toolResultStr = `ðŸ”§ Tools Library (${data.total} tools):\n\n${list}${stats}`;
                    }
                    if (window.appendToolMessage) window.appendToolMessage('tools_list', 'success', `ðŸ”§ ${data.total} tools`);
                } else {
                    toolResultStr = `tools_list: ${data.error || 'Unknown error'}`;
                    if (window.appendToolMessage) window.appendToolMessage('tools_list', 'error', data.error || 'Unknown');
                }
            } catch (e) {
                toolResultStr = `tools_list failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('tools_list', 'error', e.message);
            }
        }

        // â•â•â• PHASE 5: EMAIL TOOLS (IMAP via @flowork.cloud) â•â•â•â•â•â•â•â•â•â•â•â•â•

        // â”€â”€ GENERATE EMAIL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        else if (type === 'email_generate') {
            try {
                const purpose = (act.purpose || 'general').replace(/[^a-z0-9-]/gi, '-').toLowerCase();
                const timestamp = Math.floor(Date.now() / 1000);
                const email = `${purpose}-${timestamp}@flowork.cloud`;

                // Store for reference
                window._generatedEmails = window._generatedEmails || [];
                window._generatedEmails.push({ email, purpose, created: new Date().toISOString() });

                toolResultStr = `ðŸ“§ Email generated!\n  Address: ${email}\n  Purpose: ${purpose}\n\nThis email will receive messages via Cloudflare Email Routing â†’ Gmail IMAP.\nUse 'email_check_inbox' to read incoming emails.`;
                if (window.appendToolMessage) window.appendToolMessage('email_generate', 'success', `ðŸ“§ ${email}`);
            } catch (e) {
                toolResultStr = `email_generate failed: ${e.message}`;
            }
        }

        // â”€â”€ CHECK EMAIL INBOX â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        else if (type === 'email_check_inbox') {
            try {
                const targetEmail = act.email || act.address;
                const waitSeconds = act.wait_seconds || 10;
                if (!targetEmail) {
                    toolResultStr = 'email_check_inbox: Please specify "email" to search for.';
                } else {
                    const res = await fetch('http://127.0.0.1:5000/api/email/inbox', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ target_email: targetEmail, wait_seconds: waitSeconds })
                    });
                    const data = await res.json();
                    if (data.status === 'success') {
                        const emails = data.emails || [];
                        if (emails.length === 0) {
                            toolResultStr = `ðŸ“¬ No emails found for ${targetEmail} (waited ${waitSeconds}s). Try again with longer wait_seconds.`;
                        } else {
                            toolResultStr = `ðŸ“¬ Found ${emails.length} email(s) for ${targetEmail}:\n` +
                                emails.map((e, i) => `  ${i + 1}. [${e.id}] From: ${e.from} | Subject: ${e.subject} | Date: ${e.date}`).join('\n') +
                                `\n\nUse email_read with email_id to read full content.`;
                        }
                        if (window.appendToolMessage) window.appendToolMessage('email_check_inbox', 'success', `ðŸ“¬ ${emails.length} emails`);
                    } else {
                        toolResultStr = `email_check_inbox failed: ${data.message || 'IMAP not configured. Set Gmail IMAP credentials in Flowork settings.'}`;
                        if (window.appendToolMessage) window.appendToolMessage('email_check_inbox', 'error', data.message || 'IMAP error');
                    }
                }
            } catch (e) {
                toolResultStr = `email_check_inbox failed: ${e.message}. Make sure IMAP credentials are configured.`;
                if (window.appendToolMessage) window.appendToolMessage('email_check_inbox', 'error', e.message);
            }
        }

        // â”€â”€ READ EMAIL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        else if (type === 'email_read') {
            try {
                const emailId = act.email_id || act.id;
                if (!emailId) {
                    toolResultStr = 'email_read: Please specify "email_id".';
                } else {
                    const res = await fetch('http://127.0.0.1:5000/api/email/read', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ email_id: emailId })
                    });
                    const data = await res.json();
                    if (data.status === 'success') {
                        toolResultStr = `ðŸ“§ Email Content:\n  From: ${data.from}\n  Subject: ${data.subject}\n  Date: ${data.date}\n\n${data.body}\n\n${data.verification_code ? 'ðŸ”‘ Verification Code Detected: ' + data.verification_code : ''}${data.verification_link ? 'ðŸ”— Verification Link: ' + data.verification_link : ''}`;
                        if (window.appendToolMessage) window.appendToolMessage('email_read', 'success', data.verification_code ? `ðŸ”‘ Code: ${data.verification_code}` : 'ðŸ“§ Read');
                    } else {
                        toolResultStr = `email_read failed: ${data.message}`;
                        if (window.appendToolMessage) window.appendToolMessage('email_read', 'error', data.message);
                    }
                }
            } catch (e) {
                toolResultStr = `email_read failed: ${e.message}`;
            }
        }
        else if (type === 'compile_script') {
            if (window.appendToolMessage) window.appendToolMessage('compile_script', 'in_progress', `Compiling ${act.app_name}.exe using pkg cross-compiler...`);
            try {
                const res = await fetch('http://127.0.0.1:5000/api/compile', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ script_path: act.script_path, app_name: act.app_name })
                });
                const data = await res.json();
                toolResultStr = JSON.stringify(data);
                if (window.appendToolMessage) window.appendToolMessage('compile_script', data.status === 'success' ? 'success' : 'error', data.compiled_file ? `Saved natively to: ${data.compiled_file}` : data.error);
            } catch (e) {
                toolResultStr = e.message;
                if (window.appendToolMessage) window.appendToolMessage('compile_script', 'error', e.message);
            }
        }
        else if (type === 'patch_file') {
            try {
                // [UNDO SYSTEM] Save checkpoint before patching
                if (window.createCheckpoint) window.createCheckpoint('patch_file');
                let targetFile = act.file;
                let searchStr = act.search;
                let replaceStr = act.replace;

                // [CRITICAL FIX] Normalize file path - AI may send "apps/whale-scanner/engine.py" instead of "engine.py"
                const patchPrefixMatch = targetFile.match(/^(?:apps|nodes)\/[^/]+\/(.+)$/);
                if (patchPrefixMatch) targetFile = patchPrefixMatch[1];

                if (window.generatedFiles[targetFile] !== undefined) {

                    window.activeTab = targetFile;
                    if (window.renderPreviewTabs) window.renderPreviewTabs(window.generatedFiles);
                    if (window.showFileContent) window.showFileContent(window.activeTab);

                    if (window.monacoEditorInstance) {
                        const editorPanel = document.getElementById('panel-editor');
                        if (editorPanel) editorPanel.style.borderTop = '2px solid #F59E0B';
                    }

                    await new Promise(r => setTimeout(r, 500));

                    if (window.generatedFiles[targetFile].includes(searchStr)) {
                        const linesBefore = window.generatedFiles[targetFile].split(searchStr)[0].split('\n');
                        const startLineNumber = linesBefore.length;

                        window.generatedFiles[targetFile] = window.generatedFiles[targetFile].replace(searchStr, replaceStr);

                        if (window.monacoEditorInstance) {
                            window.monacoEditorInstance.setValue(window.generatedFiles[targetFile]);

                            if (window.monaco) {
                                const newLinesCount = replaceStr.split('\n').length;
                                const endLineNumber = startLineNumber + newLinesCount - 1;

                                window.monacoEditorInstance.revealLineInCenter(startLineNumber);

                                window.currentMonacoDecorations = window.monacoEditorInstance.deltaDecorations(window.currentMonacoDecorations, [
                                    {
                                        range: new window.monaco.Range(startLineNumber, 1, endLineNumber, 1),
                                        options: {
                                            isWholeLine: true,
                                            className: 'myLineHighlightClass',
                                            linesDecorationsClassName: 'myLineHighlightGutterClass'
                                        }
                                    }
                                ]);

                                setTimeout(() => {
                                    if (window.monacoEditorInstance) {
                                        window.currentMonacoDecorations = window.monacoEditorInstance.deltaDecorations(window.currentMonacoDecorations, []);
                                    }
                                }, 3000);
                            }
                        }

                        await new Promise(r => setTimeout(r, 400));
                        if (window.monacoEditorInstance) {
                            const editorPanel = document.getElementById('panel-editor');
                            if (editorPanel) editorPanel.style.borderTop = 'none';
                        }

                        let payloadFiles = {};
                        payloadFiles[targetFile] = window.generatedFiles[targetFile];

                        await fetch('http://127.0.0.1:5000/api/ai-write', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ app_id: currentLoopAppId, output_type: outputType, files: payloadFiles })
                        });

                        if (window.renderPreviewTabs) window.renderPreviewTabs(window.generatedFiles);

                        // Generate Inline Diff UI
                        let diffHtml = '';
                        if (window.escapeHtml) {
                            const oldLines = searchStr.split('\n');
                            const newLines = replaceStr.split('\n');
                            let diffLinesHTML = '';
                            oldLines.forEach(l => {
                                if (l.trim()) diffLinesHTML += `<div class="diff-line remove">- ${window.escapeHtml(l)}</div>`;
                            });
                            newLines.forEach(l => {
                                if (l.trim()) diffLinesHTML += `<div class="diff-line add">+ ${window.escapeHtml(l)}</div>`;
                            });

                            diffHtml = `
                           <div class="diff-container">
                               <div class="diff-header">
                                   <span class="diff-header-title">${targetFile}</span>
                                   <div class="diff-stats">
                                       <span class="diff-stat-remove">-${oldLines.filter(l => l.trim()).length}</span>
                                       <span class="diff-stat-add">+${newLines.filter(l => l.trim()).length}</span>
                                   </div>
                               </div>
                               <div class="diff-body">${diffLinesHTML}</div>
                           </div>`;
                        }

                        if (window.appendToolMessage) window.appendToolMessage('patch_file', 'success', `Patched file: ${targetFile} at line ${startLineNumber}`);
                        // Injeksi diff ke chat history box
                        const historyEl = document.getElementById('chat-history');
                        if (historyEl && diffHtml) {
                            const diffDiv = document.createElement('div');
                            diffDiv.className = 'chat-msg system';
                            diffDiv.innerHTML = diffHtml;
                            historyEl.appendChild(diffDiv);
                            historyEl.scrollTop = historyEl.scrollHeight;
                        }

                        // [LIVE RELOAD TRIGGER]
                        const toggleLive = document.getElementById('toggle-live-reload');
                        if (toggleLive && toggleLive.checked && window.activeAppBrowserTabId && window.wsCommand) {
                            try {
                                window.wsCommand('execute_browser_script', {
                                    tabId: window.activeAppBrowserTabId,
                                    script: "location.reload();"
                                });
                                if (window.appendToolMessage) window.appendToolMessage('System', 'success', 'Live Preview Reloaded âš¡');
                            } catch (e) { }
                        }

                        toolResultStr = `Successfully patched ${targetFile}.`;
                    } else {
                        throw new Error(`Search string not found in ${targetFile}. Ensure exact formatting/indentation is used.`);
                    }
                } else {
                    throw new Error(`File ${targetFile} does not exist yet.`);
                }
            } catch (e) {
                if (window.appendToolMessage) window.appendToolMessage('patch_file', 'error', e.message);
                toolResultStr = `Patch Failed: ${e.message}`;
            }
        }
        // ═══ CONNECTOR: Write Protection Guard ═══
        if (window.FLOWORKOS_Connector && (type === 'write_files' || type === 'patch_file' || type === 'smart_patch')) {
            const connector = window.FLOWORKOS_Connector;
            let blocked = false;
            let blockedReason = '';

            if (type === 'write_files' && act.files) {
                // Check each file path against protection rules
                for (const filePath of Object.keys(act.files)) {
                    const fullPath = require('path').resolve(connector.TOOLS_DIR, '..', filePath);
                    const check = connector.validateWrite(fullPath);
                    if (!check.allowed) {
                        blocked = true;
                        blockedReason = check.reason;
                        break;
                    }
                }
            } else if ((type === 'patch_file' || type === 'smart_patch') && act.file) {
                const fullPath = require('path').resolve(connector.TOOLS_DIR, '..', act.file);
                const check = connector.validateWrite(fullPath);
                if (!check.allowed) {
                    blocked = true;
                    blockedReason = check.reason;
                }
            }

            if (blocked) {
                toolResultStr = `🔒 WRITE BLOCKED by Connector: ${blockedReason} Tip: Create a new tool in tools/ folder instead.`;
                if (window.appendToolMessage) window.appendToolMessage('Connector', 'error', blockedReason);
            }
        }
        // ═══ AI BEHAVIOR GUARD: Phase 0 once per task ═══
        if (!toolResultStr && (type === 'write_files' || type === 'smart_patch' || type === 'patch_file' || type === 'create_node') && !window._phase0Done && depth < 3) {
            toolResultStr = '⚠️ PHASE 0 REQUIRED: Call kb_search and tools_search once before starting work. After that, proceed freely with [AUTO_CONTINUE].';
            if (window.appendToolMessage) window.appendToolMessage('Guard', 'error', 'Phase 0 not done yet — search KB/tools once');
        }
        else if (type === 'write_files' || type === 'run_command') {
            try {
                // [UNDO SYSTEM] Save checkpoint before writing files
                if (type === 'write_files' && window.createCheckpoint) window.createCheckpoint('write_files');

                // [AUTO IDE MODE] Switch to IDE when AI starts writing code
                if (type === 'write_files' && window.showIDEMode) {
                    window.showIDEMode();
                    if (window.appendToolMessage) window.appendToolMessage('Mode Switch', 'success', 'ðŸ”§ Auto-switched to IDE mode for coding');
                }

                let rData = {};
                if (type === 'write_files') {
                    // ============================================================
                    // [CRITICAL FIX] Normalize file keys from AI
                    // AI often sends: { "apps/whale-scanner/manifest.json": "..." }
                    // We need:        { "manifest.json": "..." }
                    // ============================================================
                    const rawFiles = act.files || {};
                    const normalizedFiles = {};
                    for (const [rawKey, content] of Object.entries(rawFiles)) {
                        // Strip prefixes: "apps/app-id/file.js" â†’ "file.js"
                        //                 "nodes/node-id/file.js" â†’ "file.js"
                        let cleanKey = rawKey;
                        const prefixMatch = cleanKey.match(/^(?:apps|nodes)\/[^/]+\/(.+)$/);
                        if (prefixMatch) {
                            cleanKey = prefixMatch[1]; // Extract just "manifest.json" etc.
                        }
                        normalizedFiles[cleanKey] = content;
                    }
                    act.files = normalizedFiles; // Replace with normalized version

                    // [BUG 5 FIX] Auto-detect App ID from manifest.json (now works with normalized keys)
                    if (act.files['manifest.json']) {
                        try {
                            const manifestText = act.files['manifest.json'];
                            const manifest = JSON.parse(manifestText);
                            if (manifest.id && manifest.id !== currentLoopAppId) {
                                // Fallback JIKA AI lupa masukin project_id di roadmap
                                currentLoopAppId = manifest.id;
                                window.currentAppId = currentLoopAppId;

                                const nameInput = window.getEl('input-app-name');
                                if (nameInput) nameInput.value = currentLoopAppId;

                                const displayApp = window.getEl('display-app-name');
                                if (displayApp) displayApp.innerText = currentLoopAppId;

                                if (window.appendToolMessage) window.appendToolMessage('System', 'success', `Workspace auto-redirected by AI to: /apps/${currentLoopAppId}/`);
                            }
                        } catch (e) { console.warn("Failed to auto-detect App ID from manifest.", e); }
                    }

                    const fileKeys = Object.keys(act.files);
                    if (fileKeys.length > 0) {
                        // [BUG 3 FIX] Merge all files into generatedFiles FIRST, then render all tabs
                        Object.assign(window.generatedFiles, act.files);
                        window.activeTab = fileKeys[0];
                        if (window.renderPreviewTabs) window.renderPreviewTabs(window.generatedFiles);
                        if (window.showFileContent) window.showFileContent(window.activeTab);

                        if (window.monacoEditorInstance) {
                            const editorPanel = document.getElementById('panel-editor');
                            if (editorPanel) {
                                editorPanel.style.borderTop = '2px solid #3B82F6';
                                editorPanel.classList.add('ai-writing');
                            }
                        }
                        await new Promise(r => setTimeout(r, 800));

                        if (window.monacoEditorInstance) {
                            const editorPanel = document.getElementById('panel-editor');
                            if (editorPanel) {
                                editorPanel.style.borderTop = 'none';
                                editorPanel.classList.remove('ai-writing');
                            }
                        }
                    }

                    console.log(`[AI-Write] Sending ${fileKeys.length} files to /api/ai-write for app_id=${currentLoopAppId}, output_type=${outputType}`);

                    const res = await fetch('http://127.0.0.1:5000/api/ai-write', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            app_id: currentLoopAppId,
                            output_type: outputType,
                            files: act.files
                        })
                    });
                    rData = await res.json();
                    console.log(`[AI-Write] Response:`, rData);
                    if (rData.status !== 'success') throw new Error(rData.error || 'Failed to write files');

                    if (window.appendToolMessage) window.appendToolMessage('write_files', 'success', `Wrote ${rData.total_files || fileKeys.length} files to disk â†’ /apps/${currentLoopAppId}/`);
                    // [LIVE RELOAD TRIGGER]
                    const toggleLive = document.getElementById('toggle-live-reload');
                    if (toggleLive && toggleLive.checked && window.activeAppBrowserTabId && window.wsCommand) {
                        try {
                            window.wsCommand('execute_browser_script', {
                                tabId: window.activeAppBrowserTabId,
                                script: "location.reload();"
                            });
                            if (window.appendToolMessage) window.appendToolMessage('System', 'success', 'Live Preview Reloaded âš¡');
                        } catch (e) { }
                    }
                    toolResultStr = `Successfully wrote files. Total files updated: ${rData.total_files || fileKeys.length}`;

                } else if (type === 'run_command') {
                    // MAGIC INTERCEPTOR 2: Membersihkan typo directory bawaan AI secara otomatis
                    let safeCommand = act.command;
                    safeCommand = safeCommand.replace(/apps\/[^\s/]+\//g, '');

                    const res = await fetch('http://127.0.0.1:5000/api/ai-exec', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            app_id: currentLoopAppId,
                            output_type: outputType,
                            command: safeCommand
                        })
                    });
                    rData = await res.json();
                    if (rData.status !== 'success' && !rData.output) throw new Error(rData.error || 'Failed to run command');

                    if (window.appendToolMessage) window.appendToolMessage('run_command', 'success', `$ ${safeCommand}`);
                    if (window.setTerminalOutput) {
                        window.setTerminalOutput(`$ ${safeCommand}\n` + (rData.output || ''));
                        if (rData.error) window.setTerminalOutput(`[OS Error]: ${rData.error}`);
                    }

                    toolResultStr = `Command executed. Output: ${rData.output || 'None'}${rData.error ? ' Error: ' + rData.error : ''}`;
                }

            } catch (e) {
                if (window.appendToolMessage) window.appendToolMessage(type, 'error', `Action Failed: ${e.message}`);
                toolResultStr = `Action Failed: ${e.message}`;
            }
        }
        // ============================================================
        // [ANTIGRAVITY TIER] READ FILE â€” AI can read existing code
        // ============================================================
        else if (type === 'read_file') {
            try {
                const targetFile = act.file;
                if (targetFile) {
                    // Read a specific file from the current app
                    const safeName = targetFile.replace(/^(?:apps|nodes)\/[^/]+\//, ''); // normalize prefix
                    const readType = outputType === 'node' ? 'nodes' : 'apps';
                    const res = await fetch(`http://127.0.0.1:5000/api/fs/read?path=${encodeURIComponent(`${readType}/${currentLoopAppId}/${safeName}`)}`);
                    if (!res.ok) throw new Error(`File not found: ${safeName}`);
                    const content = await res.text();

                    // Also load into editor for visualization
                    window.generatedFiles[safeName] = content;
                    window.activeTab = safeName;
                    if (window.renderPreviewTabs) window.renderPreviewTabs(window.generatedFiles);
                    if (window.showFileContent) window.showFileContent(safeName);

                    if (window.appendToolMessage) window.appendToolMessage('read_file', 'success', `Read: ${safeName} (${content.length} chars)`);
                    toolResultStr = `Content of ${safeName}:\n\`\`\`\n${content}\n\`\`\``;
                } else {
                    // Read ALL files from the current app
                    const readType = outputType === 'node' ? 'nodes' : 'apps';
                    const res = await fetch(`http://127.0.0.1:5000/api/ai-read/${readType}/${currentLoopAppId}`);
                    const data = await res.json();
                    if (data.status !== 'success') throw new Error(data.error || 'Failed to read files');

                    // Load all files into the editor
                    Object.assign(window.generatedFiles, data.files);
                    const fileKeys = Object.keys(data.files);
                    if (fileKeys.length > 0) {
                        window.activeTab = fileKeys[0];
                        if (window.renderPreviewTabs) window.renderPreviewTabs(window.generatedFiles);
                        if (window.showFileContent) window.showFileContent(window.activeTab);
                    }

                    if (window.appendToolMessage) window.appendToolMessage('read_file', 'success', `Read ${data.total_files} files from ${currentLoopAppId}`);

                    // Build summary for AI context
                    let fileSummary = '';
                    for (const [name, content] of Object.entries(data.files)) {
                        if (content === '[BINARY FILE - SKIPPED]') {
                            fileSummary += `\n--- ${name} (binary, skipped) ---\n`;
                        } else {
                            fileSummary += `\n--- ${name} ---\n${content}\n`;
                        }
                    }
                    toolResultStr = `Read ${data.total_files} files from /apps/${currentLoopAppId}/:\n${fileSummary}`;
                }
            } catch (e) {
                if (window.appendToolMessage) window.appendToolMessage('read_file', 'error', e.message);
                toolResultStr = `read_file failed: ${e.message}`;
            }
        }
        // ============================================================
        // [ANTIGRAVITY TIER] SEARCH FILES â€” grep across project
        // ============================================================
        else if (type === 'search_files') {
            try {
                const res = await fetch('http://127.0.0.1:5000/api/ai-search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        app_id: currentLoopAppId,
                        output_type: outputType,
                        query: act.query
                    })
                });
                const data = await res.json();
                if (data.status !== 'success') throw new Error(data.error || 'Search failed');

                if (window.appendToolMessage) window.appendToolMessage('search_files', 'success', `Found ${data.total} matches for "${act.query}"`);

                let resultText = `Search "${act.query}" â†’ ${data.total} matches:\n`;
                (data.matches || []).forEach(m => {
                    resultText += `  ${m.file}:${m.line} â†’ ${m.content}\n`;
                });
                toolResultStr = resultText;
            } catch (e) {
                if (window.appendToolMessage) window.appendToolMessage('search_files', 'error', e.message);
                toolResultStr = `search_files failed: ${e.message}`;
            }
        }
        // ============================================================
        // [ANTIGRAVITY TIER] DELETE FILE
        // ============================================================
        else if (type === 'delete_file') {
            try {
                let targetFile = act.file;
                const prefixMatch = targetFile.match(/^(?:apps|nodes)\/[^/]+\/(.+)$/);
                if (prefixMatch) targetFile = prefixMatch[1];

                const readType = outputType === 'node' ? 'nodes' : 'apps';
                const fullPath = `${readType}/${currentLoopAppId}/${targetFile}`;

                const res = await fetch(`http://127.0.0.1:5000/api/fs/delete?path=${encodeURIComponent(fullPath)}`, { method: 'DELETE' });
                const data = await res.json();
                if (data.status !== 'success') throw new Error(data.error || 'Delete failed');

                // Remove from editor state
                delete window.generatedFiles[targetFile];
                if (window.renderPreviewTabs) window.renderPreviewTabs(window.generatedFiles);

                if (window.appendToolMessage) window.appendToolMessage('delete_file', 'success', `Deleted: ${targetFile}`);
                toolResultStr = `Successfully deleted ${targetFile}`;
            } catch (e) {
                if (window.appendToolMessage) window.appendToolMessage('delete_file', 'error', e.message);
                toolResultStr = `delete_file failed: ${e.message}`;
            }
        }
        // ============================================================
        // [ANTIGRAVITY TIER] RENAME FILE
        // ============================================================
        else if (type === 'rename_file') {
            try {
                let oldName = act.old_name;
                let newName = act.new_name;
                // Normalize prefixes
                const oldMatch = oldName.match(/^(?:apps|nodes)\/[^/]+\/(.+)$/);
                if (oldMatch) oldName = oldMatch[1];
                const newMatch = newName.match(/^(?:apps|nodes)\/[^/]+\/(.+)$/);
                if (newMatch) newName = newMatch[1];

                const res = await fetch('http://127.0.0.1:5000/api/ai-rename', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        app_id: currentLoopAppId,
                        output_type: outputType,
                        old_name: oldName,
                        new_name: newName
                    })
                });
                const data = await res.json();
                if (data.status !== 'success') throw new Error(data.error || 'Rename failed');

                // Update editor state
                if (window.generatedFiles[oldName] !== undefined) {
                    window.generatedFiles[newName] = window.generatedFiles[oldName];
                    delete window.generatedFiles[oldName];
                    if (window.renderPreviewTabs) window.renderPreviewTabs(window.generatedFiles);
                }

                if (window.appendToolMessage) window.appendToolMessage('rename_file', 'success', `${oldName} â†’ ${newName}`);
                toolResultStr = `Successfully renamed ${oldName} â†’ ${newName}`;
            } catch (e) {
                if (window.appendToolMessage) window.appendToolMessage('rename_file', 'error', e.message);
                toolResultStr = `rename_file failed: ${e.message}`;
            }
        }
        // ============================================================
        // [ANTIGRAVITY TIER] WEB SEARCH â€” Search documentation/APIs
        // ============================================================
        else if (type === 'web_search') {
            try {
                const query = act.query;
                // Use DuckDuckGo Instant Answer API (free, no key needed)
                const res = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`);
                const data = await res.json();

                let resultText = `Web Search: "${query}"\n\n`;

                if (data.AbstractText) {
                    resultText += `**Summary**: ${data.AbstractText}\n`;
                    resultText += `Source: ${data.AbstractURL}\n\n`;
                }

                if (data.Answer) {
                    resultText += `**Answer**: ${data.Answer}\n\n`;
                }

                if (data.RelatedTopics && data.RelatedTopics.length > 0) {
                    resultText += `**Related:**\n`;
                    data.RelatedTopics.slice(0, 8).forEach(topic => {
                        if (topic.Text) {
                            resultText += `- ${topic.Text}\n`;
                            if (topic.FirstURL) resultText += `  URL: ${topic.FirstURL}\n`;
                        }
                    });
                }

                if (!data.AbstractText && !data.Answer && (!data.RelatedTopics || data.RelatedTopics.length === 0)) {
                    resultText += 'No instant results found. Try a more specific query or use run_command with curl to fetch specific API docs.';
                }

                if (window.appendToolMessage) window.appendToolMessage('web_search', 'success', `Searched: "${query}"`);
                toolResultStr = resultText;
            } catch (e) {
                if (window.appendToolMessage) window.appendToolMessage('web_search', 'error', e.message);
                toolResultStr = `web_search failed: ${e.message}`;
            }
        }
        // ===================================================================
        // AGENTIC AUTONOMOUS TOOLS (Phase 1 - App Operator)
        // ===================================================================
        else if (type === 'open_app') {
            try {
                const appName = act.app_name;
                // CRITICAL FIX: Default to LOCAL engine URL for apps built by AI Mother.
                // Only use floworkos.com/webview/flow if explicitly requested via source: 'store'
                let appUrl;
                if (act.url) {
                    appUrl = act.url;
                } else if (act.source === 'store' || act.source === 'cloud') {
                    appUrl = `https://floworkos.com/webview/flow/${appName}`;
                } else {
                    // Default: open from local engine (where AI Mother builds apps)
                    appUrl = `http://127.0.0.1:5000/local-apps/${appName}/`;
                }

                const tabId = appName + '-' + Date.now();
                let opened = false;

                // Strategy 1: Use tab_manager.js (available on index.html / dashboard)
                if (typeof window.openWebviewTab === 'function') {
                    window.openWebviewTab(appName, appName, appUrl);
                    opened = true;
                }
                // Strategy 2: Use wsCommand IPC (available on ai-builder.html via WebSocket)
                // This sends the request to the main Electron process which creates a BrowserView
                else if (typeof window.wsCommand === 'function') {
                    const res = await window.wsCommand('open_ai_tab', { tabId, url: appUrl });
                    if (res.status === 'success') {
                        opened = true;
                    } else {
                        // Strategy 3: Last resort â€” direct HTTP test to confirm app exists
                        try {
                            const pingRes = await fetch(appUrl, { method: 'HEAD' });
                            if (pingRes.ok) {
                                opened = true; // App exists and is servable, just can't open tab visually
                            }
                        } catch (pingErr) { }

                        if (!opened) {
                            throw new Error(`Could not open app tab. wsCommand returned: ${res.message || 'unknown error'}. Verify the engine is running and the app folder exists at apps/${appName}/`);
                        }
                    }
                }
                // Strategy 4: No tab system available at all
                else {
                    throw new Error('No tab manager available. Neither openWebviewTab nor wsCommand are defined. Ensure the engine modules are loaded.');
                }

                // Track for AI browser tools
                window._agenticTabs = window._agenticTabs || {};
                window._agenticTabs[appName] = { tabId, url: appUrl, openedAt: Date.now() };
                window.activeAppBrowserTabId = tabId;

                const isLocal = appUrl.includes('127.0.0.1') || appUrl.includes('localhost');
                toolResultStr = `App '${appName}' opened in webview tab '${tabId}' at ${appUrl} (${isLocal ? 'LOCAL ENGINE' : 'CLOUD STORE'}). The tab is now visible inside Flowork. Use tabId: '${tabId}' for capture_browser, click_element, type_text, and read_dom tools.`;
                if (window.appendToolMessage) window.appendToolMessage('open_app', 'success', `Tab opened: ${appName} (${isLocal ? 'ðŸ–¥ï¸ Local' : 'â˜ï¸ Store'})`);
            } catch (e) {
                toolResultStr = `Failed to open app: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('open_app', 'error', e.message);
            }
        }

        // ===================================================================
        // CLOSE APP + CLEANUP (uses multi-tab system)
        // ===================================================================
        else if (type === 'close_app') {
            try {
                const appName = act.app_name;
                const tabs = window._agenticTabs || {};

                if (appName && tabs[appName]) {
                    const tabId = tabs[appName].tabId;

                    // Close via multi-tab system (with fallback for ai-builder.html context)
                    if (typeof window.closeWebviewTab === 'function') {
                        window.closeWebviewTab(tabId);
                    } else if (typeof window.wsCommand === 'function') {
                        await window.wsCommand('close_ai_tab', { tabId });
                    }

                    // Remove from AI tracking
                    delete tabs[appName];
                    if (window.activeAppBrowserTabId === tabId) {
                        window.activeAppBrowserTabId = null;
                    }

                    toolResultStr = `App '${appName}' tab closed and cleaned up.`;
                    if (window.appendToolMessage) window.appendToolMessage('close_app', 'success', `Closed: ${appName}`);
                } else if (!appName) {
                    // Close ALL non-permanent tabs
                    let closed = 0;
                    for (const [name, info] of Object.entries(tabs)) {
                        if (typeof window.closeWebviewTab === 'function') {
                            window.closeWebviewTab(info.tabId);
                        } else if (typeof window.wsCommand === 'function') {
                            await window.wsCommand('close_ai_tab', { tabId: info.tabId });
                        }
                        delete tabs[name];
                        closed++;
                    }
                    window.activeAppBrowserTabId = null;
                    toolResultStr = `Closed ${closed} app tabs. All cleaned up.`;
                    if (window.appendToolMessage) window.appendToolMessage('close_app', 'success', `Closed ${closed} tabs`);
                } else {
                    toolResultStr = `App '${appName}' is not currently open.`;
                }
            } catch (e) {
                toolResultStr = `close_app failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('close_app', 'error', e.message);
            }
        }
        // ===================================================================
        // APP DISCOVERY â€” AI reads all app manifests to understand capabilities
        // ===================================================================
        else if (type === 'discover_apps') {
            try {
                const appsRes = await fetch('http://127.0.0.1:5000/api/local-apps');
                const nodesRes = await fetch('http://127.0.0.1:5000/api/local-nodes');
                const appsData = await appsRes.json();
                const nodesData = await nodesRes.json();

                let discoveryResult = '=== INSTALLED APPS ===\n';
                const apps = appsData.apps || appsData.data || [];
                if (Array.isArray(apps) && apps.length > 0) {
                    for (const app of apps) {
                        // Try to read manifest.json for each app
                        try {
                            const mRes = await fetch(`http://127.0.0.1:5000/api/ai-read/apps/${app.id || app.name || app}`);
                            const mData = await mRes.json();
                            if (mData.status === 'success' && mData.files) {
                                const manifest = mData.files['manifest.json'] ? JSON.parse(mData.files['manifest.json']) : {};
                                const schema = mData.files['schema.json'] ? JSON.parse(mData.files['schema.json']) : {};
                                discoveryResult += `\nðŸ“± ${manifest.name || app.id || app}`;
                                discoveryResult += `\n   ID: ${manifest.id || app.id || app}`;
                                discoveryResult += `\n   Purpose: ${manifest.purpose || schema.description || 'Not specified'}`;
                                discoveryResult += `\n   Capabilities: ${(manifest.capabilities || []).join(', ') || 'Not specified'}`;
                                discoveryResult += `\n   Files: ${Object.keys(mData.files).join(', ')}`;
                                discoveryResult += '\n';
                            }
                        } catch (e) {
                            discoveryResult += `\nðŸ“± ${app.id || app.name || app} (manifest unreadable)\n`;
                        }
                    }
                } else {
                    discoveryResult += 'No apps installed.\n';
                }

                discoveryResult += '\n=== INSTALLED NODES ===\n';
                const nodes = nodesData.nodes || nodesData.data || [];
                if (Array.isArray(nodes) && nodes.length > 0) {
                    for (const node of nodes) {
                        discoveryResult += `âš¡ ${node.name || node.id || node}\n`;
                    }
                } else {
                    discoveryResult += 'No custom nodes installed.\n';
                }

                toolResultStr = discoveryResult;
                if (window.appendToolMessage) window.appendToolMessage('discover_apps', 'success', `Found ${apps.length} apps, ${nodes.length} nodes`);
            } catch (e) {
                toolResultStr = `discover_apps failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('discover_apps', 'error', e.message);
            }
        }
        else if (type === 'click_element') {
            try {
                const script = `
                    (function() {
                        const el = document.querySelector('${(act.selector || '').replace(/'/g, "\\'")}');
                        if (!el) return 'ERROR: Element not found: ${act.selector}';
                        el.click();
                        return 'Clicked: ' + el.tagName + (el.id ? '#'+el.id : '') + (el.className ? '.'+el.className.split(' ')[0] : '');
                    })()
                `;
                const res = await window.wsCommand('execute_browser_script', { tabId: act.tabId, script });
                toolResultStr = res.status === 'success' ? `Click executed: ${res.data}` : `Click failed: ${res.message}`;
                if (window.appendToolMessage) window.appendToolMessage('click_element', res.status, toolResultStr);
            } catch (e) {
                toolResultStr = `Click failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('click_element', 'error', e.message);
            }
        }
        else if (type === 'type_text') {
            try {
                const escapedText = (act.text || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
                const script = `
                    (function() {
                        const el = document.querySelector('${(act.selector || '').replace(/'/g, "\\'")}');
                        if (!el) return 'ERROR: Element not found: ${act.selector}';
                        el.focus();
                        el.value = '${escapedText}';
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        return 'Typed into: ' + el.tagName + (el.id ? '#'+el.id : '');
                    })()
                `;
                const res = await window.wsCommand('execute_browser_script', { tabId: act.tabId, script });
                toolResultStr = res.status === 'success' ? `Text typed: ${res.data}` : `Type failed: ${res.message}`;
                if (window.appendToolMessage) window.appendToolMessage('type_text', res.status, toolResultStr);
            } catch (e) {
                toolResultStr = `Type failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('type_text', 'error', e.message);
            }
        }
        else if (type === 'scroll_page') {
            try {
                const amount = act.amount || 300;
                const dir = act.direction === 'up' ? -amount : amount;
                const script = `window.scrollBy(0, ${dir}); 'Scrolled ${act.direction || 'down'} by ${amount}px'`;
                const res = await window.wsCommand('execute_browser_script', { tabId: act.tabId, script });
                toolResultStr = res.status === 'success' ? res.data : `Scroll failed: ${res.message}`;
                if (window.appendToolMessage) window.appendToolMessage('scroll_page', res.status, toolResultStr);
            } catch (e) {
                toolResultStr = `Scroll failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('scroll_page', 'error', e.message);
            }
        }
        else if (type === 'read_dom') {
            try {
                const selector = act.selector || 'body';
                const script = `
                    (function() {
                        const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
                        if (!el) return 'ERROR: Element not found: ${selector}';
                        // Return a summarized version to avoid token overflow
                        const html = el.innerHTML;
                        if (html.length > 8000) {
                            return html.substring(0, 8000) + '\\n... [TRUNCATED - DOM too large. Use a more specific selector]';
                        }
                        return html;
                    })()
                `;
                const res = await window.wsCommand('execute_browser_script', { tabId: act.tabId, script });
                if (res.status === 'success') {
                    toolResultStr = `DOM content of '${selector}':\n${res.data}`;
                    if (window.appendToolMessage) window.appendToolMessage('read_dom', 'success', `Read ${selector} (${String(res.data).length} chars)`);
                } else {
                    toolResultStr = `read_dom failed: ${res.message}`;
                    if (window.appendToolMessage) window.appendToolMessage('read_dom', 'error', res.message);
                }
            } catch (e) {
                toolResultStr = `read_dom failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('read_dom', 'error', e.message);
            }
        }
        else if (type === 'wait') {
            const seconds = Math.min(act.seconds || 1, 10);
            await new Promise(r => setTimeout(r, seconds * 1000));
            toolResultStr = `Waited ${seconds} seconds.`;
            if (window.appendToolMessage) window.appendToolMessage('wait', 'success', `â³ ${seconds}s`);
        }
        // ===================================================================
        // NODE CREATION TOOLS
        // ===================================================================
        else if (type === 'create_node') {
            try {
                const nodeId = act.node_id;
                const lang = act.language || 'javascript';
                const schema = act.schema || {};
                const code = act.code || '';

                if (!nodeId) throw new Error('Missing node_id');
                if (!schema.name) schema.name = nodeId;

                // Write schema.json
                const schemaContent = JSON.stringify(schema, null, 2);

                // Determine entry file name
                const entryFile = lang === 'python' ? 'main.py' : 'main.js';

                const files = {};
                files['schema.json'] = schemaContent;
                files[entryFile] = code;

                // Generate a default icon.svg for the node
                if (!act.icon) {
                    files['icon.svg'] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none"><rect width="64" height="64" rx="12" fill="#7C3AED"/><text x="32" y="38" text-anchor="middle" font-size="24" fill="white" font-family="sans-serif">âš¡</text></svg>`;
                } else {
                    files['icon.svg'] = act.icon;
                }

                // Display in editor
                Object.assign(window.generatedFiles, files);
                window.activeTab = 'schema.json';
                if (window.renderPreviewTabs) window.renderPreviewTabs(window.generatedFiles);
                if (window.showFileContent) window.showFileContent(window.activeTab);

                // Write to disk via API (output_type = node)
                const res = await fetch('http://127.0.0.1:5000/api/ai-write', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        app_id: nodeId,
                        output_type: 'node',
                        files: files
                    })
                });
                const rData = await res.json();
                if (rData.status !== 'success') throw new Error(rData.error || 'Failed to write node files');

                // Update UI display
                const displayApp = window.getEl('display-app-name');
                if (displayApp) displayApp.innerText = `[NODE] ${nodeId}`;

                toolResultStr = `Node '${nodeId}' created successfully with ${Object.keys(files).length} files (${entryFile}, schema.json, icon.svg). It is now available in the Workflow Editor under list_nodes.`;
                if (window.appendToolMessage) window.appendToolMessage('create_node', 'success', `Created node: ${nodeId} (${lang})`);
            } catch (e) {
                toolResultStr = `create_node failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('create_node', 'error', e.message);
            }
        }
        // ===================================================================
        // ENHANCED AGENTIC TOOLS
        // ===================================================================
        else if (type === 'keyboard_event') {
            try {
                const key = act.key || 'Enter';
                const selector = act.selector ? (act.selector).replace(/'/g, "\\'") : '';

                // Map common key names to KeyboardEvent properties
                const keyMap = {
                    'Enter': { key: 'Enter', code: 'Enter', keyCode: 13 },
                    'Escape': { key: 'Escape', code: 'Escape', keyCode: 27 },
                    'Tab': { key: 'Tab', code: 'Tab', keyCode: 9 },
                    'Backspace': { key: 'Backspace', code: 'Backspace', keyCode: 8 },
                    'Delete': { key: 'Delete', code: 'Delete', keyCode: 46 },
                    'Space': { key: ' ', code: 'Space', keyCode: 32 },
                    'ArrowUp': { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
                    'ArrowDown': { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
                    'ArrowLeft': { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
                    'ArrowRight': { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 }
                };

                const keyInfo = keyMap[key] || { key: key, code: `Key${key.toUpperCase()}`, keyCode: key.charCodeAt(0) };
                const keyInfoJson = JSON.stringify(keyInfo);

                const script = `
                    (function() {
                        const keyInfo = ${keyInfoJson};
                        let target = ${selector ? `document.querySelector('${selector}')` : 'document.activeElement || document.body'};
                        if (!target) return 'ERROR: Element not found: ${selector}';
                        target.focus();
                        const evtDown = new KeyboardEvent('keydown', { key: keyInfo.key, code: keyInfo.code, keyCode: keyInfo.keyCode, bubbles: true, cancelable: true });
                        const evtUp = new KeyboardEvent('keyup', { key: keyInfo.key, code: keyInfo.code, keyCode: keyInfo.keyCode, bubbles: true, cancelable: true });
                        target.dispatchEvent(evtDown);
                        target.dispatchEvent(evtUp);
                        // Also dispatch 'keypress' for character keys
                        if (keyInfo.key.length === 1) {
                            const evtPress = new KeyboardEvent('keypress', { key: keyInfo.key, code: keyInfo.code, keyCode: keyInfo.keyCode, charCode: keyInfo.key.charCodeAt(0), bubbles: true });
                            target.dispatchEvent(evtPress);
                        }
                        return 'Key dispatched: ' + keyInfo.key + ' on ' + target.tagName + (target.id ? '#' + target.id : '');
                    })()
                `;
                const res = await window.wsCommand('execute_browser_script', { tabId: act.tabId, script });
                toolResultStr = res.status === 'success' ? `Keyboard event: ${res.data}` : `Keyboard event failed: ${res.message}`;
                if (window.appendToolMessage) window.appendToolMessage('keyboard_event', res.status, toolResultStr);
            } catch (e) {
                toolResultStr = `keyboard_event failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('keyboard_event', 'error', e.message);
            }
        }
        else if (type === 'drag_drop') {
            try {
                const srcSel = (act.sourceSelector || '').replace(/'/g, "\\'");
                const tgtSel = (act.targetSelector || '').replace(/'/g, "\\'");
                const offX = act.offsetX || 0;
                const offY = act.offsetY || 0;

                const script = `
                    (function() {
                        const src = document.querySelector('${srcSel}');
                        const tgt = document.querySelector('${tgtSel}');
                        if (!src) return 'ERROR: Source element not found: ${srcSel}';
                        if (!tgt) return 'ERROR: Target element not found: ${tgtSel}';

                        const srcRect = src.getBoundingClientRect();
                        const tgtRect = tgt.getBoundingClientRect();

                        const startX = srcRect.left + srcRect.width / 2;
                        const startY = srcRect.top + srcRect.height / 2;
                        const endX = tgtRect.left + ${offX};
                        const endY = tgtRect.top + ${offY};

                        const dtStart = new DataTransfer();
                        src.dispatchEvent(new MouseEvent('mousedown', { clientX: startX, clientY: startY, bubbles: true }));
                        src.dispatchEvent(new DragEvent('dragstart', { clientX: startX, clientY: startY, dataTransfer: dtStart, bubbles: true }));
                        tgt.dispatchEvent(new DragEvent('dragover', { clientX: endX, clientY: endY, dataTransfer: dtStart, bubbles: true, cancelable: true }));
                        tgt.dispatchEvent(new DragEvent('drop', { clientX: endX, clientY: endY, dataTransfer: dtStart, bubbles: true }));
                        src.dispatchEvent(new DragEvent('dragend', { clientX: endX, clientY: endY, dataTransfer: dtStart, bubbles: true }));
                        tgt.dispatchEvent(new MouseEvent('mouseup', { clientX: endX, clientY: endY, bubbles: true }));

                        return 'Dragged ' + src.tagName + (src.id ? '#' + src.id : '') + ' â†’ ' + tgt.tagName + (tgt.id ? '#' + tgt.id : '') + ' at offset (${offX}, ${offY})';
                    })()
                `;
                const res = await window.wsCommand('execute_browser_script', { tabId: act.tabId, script });
                toolResultStr = res.status === 'success' ? `Drag-drop: ${res.data}` : `Drag-drop failed: ${res.message}`;
                if (window.appendToolMessage) window.appendToolMessage('drag_drop', res.status, toolResultStr);
            } catch (e) {
                toolResultStr = `drag_drop failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('drag_drop', 'error', e.message);
            }
        }
        else if (type === 'get_console_logs') {
            try {
                const script = `
                    (function() {
                        // Inject console interceptor if not already present
                        if (!window.__flowork_console_logs) {
                            window.__flowork_console_logs = [];
                            const origLog = console.log;
                            const origErr = console.error;
                            const origWarn = console.warn;
                            console.log = function(...args) {
                                window.__flowork_console_logs.push({ type: 'log', msg: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '), ts: Date.now() });
                                if (window.__flowork_console_logs.length > 50) window.__flowork_console_logs.shift();
                                origLog.apply(console, args);
                            };
                            console.error = function(...args) {
                                window.__flowork_console_logs.push({ type: 'error', msg: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '), ts: Date.now() });
                                if (window.__flowork_console_logs.length > 50) window.__flowork_console_logs.shift();
                                origErr.apply(console, args);
                            };
                            console.warn = function(...args) {
                                window.__flowork_console_logs.push({ type: 'warn', msg: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '), ts: Date.now() });
                                if (window.__flowork_console_logs.length > 50) window.__flowork_console_logs.shift();
                                origWarn.apply(console, args);
                            };
                            return 'Console interceptor installed. Call get_console_logs again to retrieve captured logs.';
                        }
                        const logs = window.__flowork_console_logs.slice(-30);
                        window.__flowork_console_logs = [];
                        if (logs.length === 0) return 'No console output captured yet.';
                        return logs.map(l => '[' + l.type.toUpperCase() + '] ' + l.msg).join('\\n');
                    })()
                `;
                const res = await window.wsCommand('execute_browser_script', { tabId: act.tabId, script });
                if (res.status === 'success') {
                    toolResultStr = `Console logs:\\n${res.data}`;
                    if (window.appendToolMessage) window.appendToolMessage('get_console_logs', 'success', `Retrieved logs (${String(res.data).split('\\n').length} entries)`);
                } else {
                    toolResultStr = `get_console_logs failed: ${res.message}`;
                    if (window.appendToolMessage) window.appendToolMessage('get_console_logs', 'error', res.message);
                }
            } catch (e) {
                toolResultStr = `get_console_logs failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('get_console_logs', 'error', e.message);
            }
        }
        // ===================================================================
        // WORKFLOW AUTOMATION TOOLS
        // ===================================================================
        else if (type === 'create_workflow') {
            try {
                const wfPayload = {
                    id: act.id || ('wf-' + Date.now()),
                    name: act.name || 'AI Generated Workflow',
                    description: act.description || '',
                    active: false,
                    nodes: act.nodes || [],
                    edges: act.edges || [],
                    trigger: act.trigger || null
                };
                const res = await fetch('http://127.0.0.1:5000/api/workflow/save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(wfPayload)
                });
                const data = await res.json();
                toolResultStr = data.status === 'success'
                    ? `Workflow created successfully! ID: ${data.id}. Use 'execute_workflow' with this ID to run it.`
                    : `Failed to create workflow: ${data.error}`;
                if (window.appendToolMessage) window.appendToolMessage('create_workflow', data.status === 'success' ? 'success' : 'error', toolResultStr);
            } catch (e) {
                toolResultStr = `create_workflow failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('create_workflow', 'error', e.message);
            }
        }
        else if (type === 'list_nodes') {
            try {
                const res = await fetch('http://127.0.0.1:5000/api/local-nodes');
                const data = await res.json();
                toolResultStr = JSON.stringify(data);
                if (window.appendToolMessage) window.appendToolMessage('list_nodes', 'success', `Found ${(data.data || []).length} installed nodes`);
            } catch (e) {
                toolResultStr = `list_nodes failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('list_nodes', 'error', e.message);
            }
        }
        else if (type === 'execute_workflow') {
            try {
                const res = await fetch(`http://127.0.0.1:5000/api/workflow/execute/${act.workflow_id}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                const data = await res.json();
                toolResultStr = JSON.stringify(data);
                if (window.appendToolMessage) window.appendToolMessage('execute_workflow', data.status === 'success' ? 'success' : 'error',
                    data.status === 'success' ? `Workflow executed! Duration: ${data.data?.duration || 'N/A'}` : data.error);
            } catch (e) {
                toolResultStr = `execute_workflow failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('execute_workflow', 'error', e.message);
            }
        }
        else if (type === 'list_workflows') {
            try {
                const res = await fetch('http://127.0.0.1:5000/api/workflow/list');
                const data = await res.json();
                toolResultStr = JSON.stringify(data);
                if (window.appendToolMessage) window.appendToolMessage('list_workflows', 'success', `Found ${(data.data || []).length} workflows`);
            } catch (e) {
                toolResultStr = `list_workflows failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('list_workflows', 'error', e.message);
            }
        }
        // ===================================================================
        // GOAL 4: UPDATE EXISTING WORKFLOW
        // ===================================================================
        else if (type === 'update_workflow') {
            try {
                const wfId = act.workflow_id;
                if (!wfId) throw new Error('Missing workflow_id');
                const patchData = act.patch || {};

                const res = await fetch(`http://127.0.0.1:5000/api/workflow/${wfId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(patchData)
                });
                const data = await res.json();
                if (data.status === 'success') {
                    toolResultStr = `Workflow '${wfId}' updated successfully.`;
                    if (window.appendToolMessage) window.appendToolMessage('update_workflow', 'success', `Updated: ${wfId}`);
                } else {
                    throw new Error(data.error || 'Failed to update workflow');
                }
            } catch (e) {
                toolResultStr = `update_workflow failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('update_workflow', 'error', e.message);
            }
        }
        // ===================================================================
        // GOAL 1: PROGRESS TRACKING â€” SAVE
        // ===================================================================
        else if (type === 'save_progress') {
            try {
                const entry = act.entry || {};
                entry.timestamp = entry.timestamp === 'auto' ? new Date().toISOString() : (entry.timestamp || new Date().toISOString());

                const res = await fetch('http://127.0.0.1:5000/api/progress-log', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        app_id: currentLoopAppId,
                        output_type: outputType,
                        entry: entry
                    })
                });
                const data = await res.json();

                // Also store locally
                window.progressLog.push(entry);

                toolResultStr = `Progress logged: "${entry.description}" (Total: ${data.total_entries || window.progressLog.length})`;
                if (window.appendToolMessage) window.appendToolMessage('save_progress', 'success', `ðŸ“‹ ${entry.phase}: ${entry.description}`);
            } catch (e) {
                toolResultStr = `save_progress failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('save_progress', 'error', e.message);
            }
        }
        // ===================================================================
        // GOAL 1: PROGRESS TRACKING â€” READ
        // ===================================================================
        else if (type === 'read_progress') {
            try {
                const res = await fetch(`http://127.0.0.1:5000/api/progress-log?app_id=${encodeURIComponent(currentLoopAppId)}`);
                const data = await res.json();

                if (data.entries && data.entries.length > 0) {
                    window.progressLog = data.entries;
                    let summary = `Progress Log for ${currentLoopAppId} (${data.total} entries):\n`;
                    data.entries.forEach((e, i) => {
                        summary += `${i + 1}. [${e.phase || 'unknown'}] ${e.description || 'N/A'} (${e.timestamp || 'N/A'})\n`;
                        if (e.files_affected) summary += `   Files: ${Array.isArray(e.files_affected) ? e.files_affected.join(', ') : e.files_affected}\n`;
                    });
                    toolResultStr = summary;
                } else {
                    toolResultStr = `No progress history found for ${currentLoopAppId}. This is a fresh project.`;
                }
                if (window.appendToolMessage) window.appendToolMessage('read_progress', 'success', `${data.total || 0} entries loaded`);
            } catch (e) {
                toolResultStr = `read_progress failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('read_progress', 'error', e.message);
            }
        }
        // ===================================================================
        // GOAL 2: NAVIGATE FLOWORK OS
        // ===================================================================
        else if (type === 'navigate_flowork') {
            try {
                const route = act.route || '/';
                // Find the main Flowork webview and navigate it
                const targetUrl = `https://floworkos.com${route}`;

                // Try main Flowork window via WebSocket
                const res = await window.wsCommand('execute_browser_script', {
                    tabId: '__FLOWORK_MAIN__',
                    script: `window.location.href = '${targetUrl}'; 'Navigated to ${route}'`
                });

                if (res.status === 'success') {
                    toolResultStr = `Navigated Flowork OS to: ${route}`;
                } else {
                    // Fallback: try via postMessage to parent
                    if (window.parent && window.parent !== window) {
                        window.parent.postMessage({ type: 'FLOWORK_NAVIGATE', route: route }, '*');
                        toolResultStr = `Navigation request sent to Flowork OS: ${route}`;
                    } else {
                        toolResultStr = `Navigation fallback: opening ${targetUrl} in browser`;
                    }
                }
                if (window.appendToolMessage) window.appendToolMessage('navigate_flowork', 'success', `â†’ ${route}`);
            } catch (e) {
                toolResultStr = `navigate_flowork failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('navigate_flowork', 'error', e.message);
            }
        }
        // ===================================================================
        // GOAL 2: LIST INSTALLED APPS
        // ===================================================================
        else if (type === 'list_installed_apps') {
            try {
                const res = await fetch('http://127.0.0.1:5000/api/local-apps');
                const data = await res.json();
                if (data.status === 'success') {
                    const apps = data.data || [];
                    let summary = `Installed Apps (${apps.length}):\n`;
                    apps.forEach((a, i) => {
                        summary += `${i + 1}. [${a.id}] ${a.name || a.id}${a.description ? ' â€” ' + a.description : ''}\n`;
                    });
                    toolResultStr = summary;
                    if (window.appendToolMessage) window.appendToolMessage('list_installed_apps', 'success', `${apps.length} apps found`);
                } else {
                    throw new Error('Failed to fetch apps');
                }
            } catch (e) {
                toolResultStr = `list_installed_apps failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('list_installed_apps', 'error', e.message);
            }
        }
        // ===================================================================
        // GOAL 5: READ CRASH HISTORY
        // ===================================================================
        else if (type === 'read_crash_history') {
            try {
                const res = await fetch('http://127.0.0.1:5000/api/crash-history');
                const data = await res.json();

                if (data.entries && data.entries.length > 0) {
                    window.crashHistory = data.entries;
                    let summary = `Crash History (${data.total} entries):\n`;
                    data.entries.slice(-20).forEach((e, i) => {
                        summary += `\n--- Crash ${i + 1} ---\n`;
                        summary += `Timestamp: ${e.timestamp || 'N/A'}\n`;
                        summary += `Source: ${e.source || 'N/A'}\n`;
                        summary += `Stack: ${(e.stack || 'N/A').substring(0, 500)}\n`;
                    });
                    toolResultStr = summary;
                } else {
                    toolResultStr = 'No crash history found. System has been stable! ðŸŽ‰';
                }
                if (window.appendToolMessage) window.appendToolMessage('read_crash_history', 'success', `${data.total || 0} crashes found`);
            } catch (e) {
                toolResultStr = `read_crash_history failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('read_crash_history', 'error', e.message);
            }
        }
        // ===================================================================
        // GOAL 5: READ ENGINE LOGS
        // ===================================================================
        else if (type === 'read_engine_logs') {
            try {
                const res = await fetch('http://127.0.0.1:5000/api/engine-logs');
                const data = await res.json();

                let summary = `Engine Status Report:\n`;
                summary += `Version: ${data.engine_version || 'unknown'}\n`;
                summary += `Directory: ${data.engine_dir || 'unknown'}\n`;
                summary += `User Tier: ${data.user_tier || 'free'}\n`;
                summary += `Log Entries: ${data.total || 0}\n`;

                if (data.logs && data.logs.length > 0) {
                    summary += `\nRecent Logs:\n`;
                    data.logs.slice(-20).forEach(l => {
                        summary += `[${l.time || ''}] ${l.text || ''}\n`;
                    });
                }

                toolResultStr = summary;
                if (window.appendToolMessage) window.appendToolMessage('read_engine_logs', 'success', `Engine v${data.engine_version || '?'} | ${data.user_tier || 'free'}`);
            } catch (e) {
                toolResultStr = `read_engine_logs failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('read_engine_logs', 'error', e.message);
            }
        }
        // ===================================================================
        // GOAL 6: SELF REVIEW (Autonomous Code Review)
        // ===================================================================
        else if (type === 'self_review') {
            try {
                const appName = act.app_name || currentLoopAppId;
                const readType = outputType === 'node' ? 'nodes' : 'apps';

                // Step 1: Read all files
                const res = await fetch(`http://127.0.0.1:5000/api/ai-read/${readType}/${appName}`);
                const data = await res.json();
                if (data.status !== 'success') throw new Error(data.error || 'Failed to read app');

                let reviewReport = `Self-Review Report for '${appName}':\n`;
                reviewReport += `Total Files: ${data.total_files}\n\n`;

                let issues = [];
                let totalLines = 0;

                for (const [name, content] of Object.entries(data.files)) {
                    if (content === '[BINARY FILE - SKIPPED]') continue;

                    const lines = content.split('\n');
                    totalLines += lines.length;

                    // Check for common issues
                    if (name.endsWith('.json')) {
                        try { JSON.parse(content); }
                        catch (e) { issues.push(`âŒ ${name}: Invalid JSON â€” ${e.message}`); }
                    }
                    if (name.endsWith('.js') || name.endsWith('.py')) {
                        if (content.includes('console.log') && !name.includes('app.js')) {
                            issues.push(`âš ï¸ ${name}: Contains console.log (may pollute STDOUT pipe)`);
                        }
                        if (content.includes('TODO') || content.includes('FIXME')) {
                            issues.push(`ðŸ“ ${name}: Contains TODO/FIXME markers`);
                        }
                    }
                    if (content.length === 0) {
                        issues.push(`âŒ ${name}: Empty file`);
                    }
                }

                reviewReport += `Total Lines of Code: ${totalLines}\n`;
                reviewReport += `Issues Found: ${issues.length}\n\n`;

                if (issues.length > 0) {
                    reviewReport += `Issues:\n`;
                    issues.forEach(i => reviewReport += `  ${i}\n`);
                } else {
                    reviewReport += `âœ… No obvious issues found. Code quality looks good!\n`;
                }

                // Load into editor
                Object.assign(window.generatedFiles, data.files);
                const fileKeys = Object.keys(data.files || {});
                if (fileKeys.length > 0) {
                    window.activeTab = fileKeys[0];
                    if (window.renderPreviewTabs) window.renderPreviewTabs(window.generatedFiles);
                    if (window.showFileContent) window.showFileContent(window.activeTab);
                }

                toolResultStr = reviewReport;
                if (window.appendToolMessage) window.appendToolMessage('self_review', issues.length > 0 ? 'error' : 'success', `${appName}: ${issues.length} issues found`);
            } catch (e) {
                toolResultStr = `self_review failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('self_review', 'error', e.message);
            }
        }
        // ===================================================================
        // GOAL 6: AUTO TEST APP (Autonomous Testing)
        // ===================================================================
        else if (type === 'auto_test_app') {
            try {
                const appName = act.app_name || currentLoopAppId;
                let testReport = `Auto-Test Report for '${appName}':\n\n`;
                let testsPassed = 0;
                let testsFailed = 0;

                // Step 1: Check files exist
                const readRes = await fetch(`http://127.0.0.1:5000/api/ai-read/apps/${appName}`);
                const readData = await readRes.json();
                if (readData.status === 'success') {
                    const files = Object.keys(readData.files || {});
                    testReport += `âœ… File Check: ${files.length} files found\n`;
                    testsPassed++;

                    // Check mandatory files
                    const required = ['manifest.json', 'schema.json', 'index.html'];
                    const missing = required.filter(f => !files.includes(f));
                    if (missing.length > 0) {
                        testReport += `âŒ Missing Required Files: ${missing.join(', ')}\n`;
                        testsFailed++;
                    } else {
                        testReport += `âœ… All required files present\n`;
                        testsPassed++;
                    }

                    // Validate JSON files
                    for (const f of ['manifest.json', 'schema.json', 'i18n.json']) {
                        if (readData.files[f]) {
                            try {
                                JSON.parse(readData.files[f]);
                                testReport += `âœ… ${f}: Valid JSON\n`;
                                testsPassed++;
                            } catch (e) {
                                testReport += `âŒ ${f}: Invalid JSON â€” ${e.message}\n`;
                                testsFailed++;
                            }
                        }
                    }
                } else {
                    testReport += `âŒ App folder not found\n`;
                    testsFailed++;
                }

                // Step 2: Try opening the app
                try {
                    const appUrl = `http://127.0.0.1:5000/local-apps/${appName}/`;
                    const tabId = 'auto-test-' + appName + '-' + Date.now();
                    const openRes = await window.wsCommand('open_ai_tab', { tabId, url: appUrl });

                    if (openRes.status === 'success') {
                        testReport += `âœ… App opened successfully\n`;
                        testsPassed++;

                        // Wait for load
                        await new Promise(r => setTimeout(r, 3000));

                        // Step 3: Capture screenshot
                        const capRes = await window.wsCommand('capture_browser', { tabId });
                        if (capRes.status === 'success') {
                            testReport += `âœ… Screenshot captured\n`;
                            testsPassed++;
                            // Store screenshot for AI vision
                            window.chatHistory.push({ role: 'system', content: `[Auto-Test Screenshot of ${appName}]`, image: capRes.data });
                        } else {
                            testReport += `âš ï¸ Screenshot capture failed\n`;
                        }

                        // Step 4: Check console logs
                        const consoleScript = `
                            (function() {
                                if (!window.__flowork_console_logs) return 'Console interceptor not installed yet.';
                                const logs = window.__flowork_console_logs.slice(-20);
                                const errors = logs.filter(l => l.type === 'error');
                                return JSON.stringify({ total: logs.length, errors: errors.length, entries: logs });
                            })()
                        `;
                        const consoleRes = await window.wsCommand('execute_browser_script', { tabId, script: consoleScript });
                        if (consoleRes.status === 'success') {
                            try {
                                const consoleData = JSON.parse(consoleRes.data);
                                if (consoleData.errors > 0) {
                                    testReport += `âŒ Console Errors: ${consoleData.errors} errors detected\n`;
                                    testsFailed++;
                                } else {
                                    testReport += `âœ… No console errors\n`;
                                    testsPassed++;
                                }
                            } catch (e) {
                                testReport += `âš ï¸ Console log parse issue: ${consoleRes.data}\n`;
                            }
                        }

                        // Store auto-test tab for future reference
                        window._agenticTabs = window._agenticTabs || {};
                        window._agenticTabs[appName] = { tabId, url: appUrl };
                    } else {
                        testReport += `âŒ Failed to open app\n`;
                        testsFailed++;
                    }
                } catch (e) {
                    testReport += `âš ï¸ App launch test skipped: ${e.message}\n`;
                }

                testReport += `\n--- Summary ---\n`;
                testReport += `âœ… Passed: ${testsPassed} | âŒ Failed: ${testsFailed}\n`;
                testReport += `Grade: ${testsFailed === 0 ? 'A+ (Perfect)' : testsFailed <= 2 ? 'B (Needs Minor Fixes)' : 'C (Needs Attention)'}\n`;

                // Store in evolution state
                window.evolutionState.autoTestResults.push({
                    app: appName,
                    timestamp: new Date().toISOString(),
                    passed: testsPassed,
                    failed: testsFailed
                });

                toolResultStr = testReport;
                if (window.appendToolMessage) window.appendToolMessage('auto_test_app', testsFailed === 0 ? 'success' : 'error', `${appName}: ${testsPassed}âœ… ${testsFailed}âŒ`);
            } catch (e) {
                toolResultStr = `auto_test_app failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('auto_test_app', 'error', e.message);
            }
        }
        // ===================================================================
        // UPGRADE #3: SMART DIFFING (Line-Based Patching)
        // ===================================================================
        else if (type === 'smart_patch') {
            try {
                const file = act.file;
                const patches = act.patches || [];
                if (!file || patches.length === 0) throw new Error('Missing file or patches');

                const res = await fetch('http://127.0.0.1:5000/api/ai-smart-patch', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        app_id: currentLoopAppId,
                        output_type: outputType,
                        file: file,
                        patches: patches
                    })
                });
                const data = await res.json();
                if (data.status === 'success') {
                    toolResultStr = `Smart-patched ${file}: ${data.patches_count} patches applied (${data.total_lines} total lines)`;
                    if (window.appendToolMessage) window.appendToolMessage('smart_patch', 'success', `âœ… ${file}: ${data.patches_count} patches`);

                    // Reload file in editor
                    try {
                        const readRes = await fetch(`http://127.0.0.1:5000/api/ai-read/${outputType === 'node' ? 'nodes' : 'apps'}/${currentLoopAppId}`);
                        const readData = await readRes.json();
                        if (readData.status === 'success' && readData.files[file]) {
                            window.generatedFiles[file] = readData.files[file];
                            if (window.activeTab === file && window.showFileContent) window.showFileContent(file);
                        }
                    } catch (e) { }
                } else {
                    throw new Error(data.error || 'Smart patch failed');
                }
            } catch (e) {
                toolResultStr = `smart_patch failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('smart_patch', 'error', e.message);
            }
        }
        // ===================================================================
        // UPGRADE #8: PROJECT-WIDE CONTEXT WINDOW
        // ===================================================================
        else if (type === 'load_project_context') {
            try {
                const appName = act.app_name || currentLoopAppId;
                const readType = outputType === 'node' ? 'nodes' : 'apps';
                const res = await fetch(`http://127.0.0.1:5000/api/ai-context/${readType}/${appName}`);
                const data = await res.json();
                if (data.status === 'success') {
                    toolResultStr = data.context;
                    if (window.appendToolMessage) window.appendToolMessage('load_project_context', 'success', `${appName}: ${data.total_files} files, ${data.total_chars} chars loaded`);
                } else {
                    throw new Error(data.error || 'Failed to load context');
                }
            } catch (e) {
                toolResultStr = `load_project_context failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('load_project_context', 'error', e.message);
            }
        }
        // ===================================================================
        // UPGRADE #1: PERSISTENT KNOWLEDGE â€” SAVE
        // ===================================================================
        else if (type === 'save_knowledge') {
            try {
                const res = await fetch('http://127.0.0.1:5000/api/knowledge', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: act.title,
                        content: act.content,
                        category: act.category || 'general'
                    })
                });
                const data = await res.json();
                toolResultStr = `Knowledge saved: "${act.title}" (ID: ${data.id})`;
                if (window.appendToolMessage) window.appendToolMessage('save_knowledge', 'success', `ðŸ§  ${act.title}`);
            } catch (e) {
                toolResultStr = `save_knowledge failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('save_knowledge', 'error', e.message);
            }
        }
        // ===================================================================
        // UPGRADE #1: PERSISTENT KNOWLEDGE â€” RECALL
        // ===================================================================
        else if (type === 'recall_knowledge') {
            try {
                let url = 'http://127.0.0.1:5000/api/knowledge';
                if (act.id) url += `/${act.id}`;
                const res = await fetch(url);
                const data = await res.json();
                if (act.id) {
                    const item = data.item;
                    toolResultStr = `Knowledge Item: ${item.title}\nCategory: ${item.category}\nCreated: ${item.created_at}\n\n${item.content}`;
                } else {
                    const items = data.items || [];
                    let summary = `Knowledge Bank (${items.length} items):\n`;
                    // Filter by query if provided
                    const query = (act.query || '').toLowerCase();
                    items.forEach((item, i) => {
                        if (!query || item.title.toLowerCase().includes(query) || (item.content || '').toLowerCase().includes(query)) {
                            summary += `${i + 1}. [${item.id}] ${item.title} (${item.category || 'general'}) â€” ${item.created_at}\n`;
                        }
                    });
                    toolResultStr = summary;
                }
                if (window.appendToolMessage) window.appendToolMessage('recall_knowledge', 'success', `${(data.items || [data.item]).length} items found`);
            } catch (e) {
                toolResultStr = `recall_knowledge failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('recall_knowledge', 'error', e.message);
            }
        }
        // ===================================================================
        // UPGRADE #1: PERSISTENT KNOWLEDGE â€” LIST
        // ===================================================================
        else if (type === 'list_knowledge') {
            try {
                const res = await fetch('http://127.0.0.1:5000/api/knowledge');
                const data = await res.json();
                const items = data.items || [];
                let summary = `Memory Bank (${items.length} Knowledge Items):\n`;
                items.forEach((item, i) => {
                    summary += `${i + 1}. [${item.id}] "${item.title}" â€” ${item.category || 'general'}\n`;
                    if (item.content) summary += `   Preview: ${item.content.substring(0, 100)}...\n`;
                });
                toolResultStr = summary || 'Memory bank is empty. No knowledge items stored yet.';
                if (window.appendToolMessage) window.appendToolMessage('list_knowledge', 'success', `${items.length} items in memory`);
            } catch (e) {
                toolResultStr = `list_knowledge failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('list_knowledge', 'error', e.message);
            }
        }
        // ===================================================================
        // UPGRADE #5: REAL TERMINAL â€” START
        // ===================================================================
        else if (type === 'terminal_start') {
            try {
                const sessionId = act.session_id || ('term_' + Date.now());
                const res = await fetch('http://127.0.0.1:5000/api/terminal/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        session_id: sessionId,
                        command: act.command,
                        app_id: act.app_id || currentLoopAppId,
                        output_type: outputType
                    })
                });
                const data = await res.json();
                if (data.status === 'success') {
                    toolResultStr = `Terminal session '${data.session_id}' started. Command: ${act.command}\nUse 'terminal_status' with session_id '${data.session_id}' to check output.`;
                    if (window.appendToolMessage) window.appendToolMessage('terminal_start', 'success', `ðŸ’» ${act.command}`);
                } else {
                    throw new Error(data.error);
                }
            } catch (e) {
                toolResultStr = `terminal_start failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('terminal_start', 'error', e.message);
            }
        }
        // ===================================================================
        // UPGRADE #5: REAL TERMINAL â€” STATUS
        // ===================================================================
        else if (type === 'terminal_status') {
            try {
                const res = await fetch(`http://127.0.0.1:5000/api/terminal/status/${act.session_id}`);
                const data = await res.json();
                if (data.status === 'success') {
                    toolResultStr = `Terminal [${act.session_id}] Status: ${data.session_status}\nOutput (last ${data.total_lines} lines):\n${data.output}`;
                    if (window.appendToolMessage) window.appendToolMessage('terminal_status', data.session_status === 'error' ? 'error' : 'success', `${act.session_id}: ${data.session_status}`);
                } else {
                    throw new Error(data.error);
                }
            } catch (e) {
                toolResultStr = `terminal_status failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('terminal_status', 'error', e.message);
            }
        }
        // ===================================================================
        // UPGRADE #5: REAL TERMINAL â€” INPUT
        // ===================================================================
        else if (type === 'terminal_input') {
            try {
                const res = await fetch(`http://127.0.0.1:5000/api/terminal/input/${act.session_id}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ input: act.input })
                });
                toolResultStr = `Input sent to terminal session ${act.session_id}`;
                if (window.appendToolMessage) window.appendToolMessage('terminal_input', 'success', `â†’ ${act.session_id}`);
            } catch (e) {
                toolResultStr = `terminal_input failed: ${e.message}`;
            }
        }
        // ===================================================================
        // UPGRADE #5: REAL TERMINAL â€” KILL
        // ===================================================================
        else if (type === 'terminal_kill') {
            try {
                const res = await fetch(`http://127.0.0.1:5000/api/terminal/kill/${act.session_id}`, { method: 'POST' });
                toolResultStr = `Terminal session ${act.session_id} killed`;
                if (window.appendToolMessage) window.appendToolMessage('terminal_kill', 'success', `â˜ ï¸ ${act.session_id}`);
            } catch (e) {
                toolResultStr = `terminal_kill failed: ${e.message}`;
            }
        }
        // ===================================================================
        // UPGRADE #9: WEB RESEARCH â€” READ URL
        // ===================================================================
        else if (type === 'read_url') {
            try {
                const res = await fetch('http://127.0.0.1:5000/api/web/read', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: act.url })
                });
                const data = await res.json();
                if (data.status === 'success') {
                    toolResultStr = `Page Content from ${act.url} (${data.length} chars):\n\n${data.content}`;
                    if (window.appendToolMessage) window.appendToolMessage('read_url', 'success', `ðŸŒ ${act.url} (${data.length} chars)`);
                } else {
                    throw new Error(data.error);
                }
            } catch (e) {
                toolResultStr = `read_url failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('read_url', 'error', e.message);
            }
        }
        // ===================================================================
        // UPGRADE #7: GIT INTEGRATION
        // ===================================================================
        else if (type === 'git') {
            try {
                const res = await fetch('http://127.0.0.1:5000/api/git', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        app_id: act.app_id || currentLoopAppId,
                        output_type: outputType,
                        action: act.git_action,
                        args: act.args || [],
                        message: act.message || ''
                    })
                });
                const data = await res.json();
                toolResultStr = `Git ${act.git_action}:\n${data.output}${data.error ? '\nError: ' + data.error : ''}`;
                if (window.appendToolMessage) window.appendToolMessage('git', data.error ? 'error' : 'success', `ðŸ“¦ ${act.git_action}`);
            } catch (e) {
                toolResultStr = `git failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('git', 'error', e.message);
            }
        }
        // ===================================================================
        // UPGRADE #2: SEMANTIC CODE ANALYSIS (JS-based AST)
        // ===================================================================
        else if (type === 'analyze_code') {
            try {
                const appName = act.app_name || currentLoopAppId;
                const readType = outputType === 'node' ? 'nodes' : 'apps';
                const res = await fetch(`http://127.0.0.1:5000/api/ai-read/${readType}/${appName}`);
                const data = await res.json();
                if (data.status !== 'success') throw new Error(data.error);

                let analysis = `Code Analysis for '${appName}':\n\n`;
                let totalFunctions = 0;
                let totalImports = 0;
                let totalExports = 0;

                for (const [name, content] of Object.entries(data.files)) {
                    if (typeof content !== 'string' || content === '[BINARY FILE - SKIPPED]') continue;
                    if (!name.endsWith('.js') && !name.endsWith('.py') && !name.endsWith('.html')) continue;

                    analysis += `\nðŸ“„ ${name} (${content.split('\\n').length} lines):\n`;

                    // Extract functions (JS)
                    const funcMatches = content.match(/(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\(.*?\)\s*=>))/g);
                    if (funcMatches) {
                        analysis += `  Functions: ${funcMatches.length}\n`;
                        funcMatches.slice(0, 10).forEach(f => analysis += `    - ${f.trim().substring(0, 60)}\n`);
                        totalFunctions += funcMatches.length;
                    }

                    // Extract imports
                    const importMatches = content.match(/(?:import\s+.+from\s+|require\s*\()/g);
                    if (importMatches) {
                        analysis += `  Imports: ${importMatches.length}\n`;
                        totalImports += importMatches.length;
                    }

                    // Extract exports
                    const exportMatches = content.match(/(?:module\.exports|export\s+(?:default|const|function))/g);
                    if (exportMatches) {
                        analysis += `  Exports: ${exportMatches.length}\n`;
                        totalExports += exportMatches.length;
                    }

                    // Extract event listeners (HTML/JS)
                    const eventMatches = content.match(/addEventListener\s*\(\s*['"](\w+)['"]/g);
                    if (eventMatches) {
                        analysis += `  Event Listeners: ${eventMatches.map(e => e.match(/['"](\w+)['"]/)[1]).join(', ')}\n`;
                    }
                }

                analysis += `\n--- Summary ---\n`;
                analysis += `Total Functions: ${totalFunctions}\n`;
                analysis += `Total Imports: ${totalImports}\n`;
                analysis += `Total Exports: ${totalExports}\n`;
                analysis += `Total Files Analyzed: ${Object.keys(data.files).length}\n`;

                toolResultStr = analysis;
                if (window.appendToolMessage) window.appendToolMessage('analyze_code', 'success', `${appName}: ${totalFunctions} functions, ${totalImports} imports`);
            } catch (e) {
                toolResultStr = `analyze_code failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('analyze_code', 'error', e.message);
            }
        }
        // ===================================================================
        // UPGRADE #6: DEPENDENCY GRAPH
        // ===================================================================
        else if (type === 'dependency_graph') {
            try {
                const appName = act.app_name || currentLoopAppId;
                const readType = outputType === 'node' ? 'nodes' : 'apps';
                const res = await fetch(`http://127.0.0.1:5000/api/ai-read/${readType}/${appName}`);
                const data = await res.json();
                if (data.status !== 'success') throw new Error(data.error);

                let graph = `Dependency Graph for '${appName}':\n\n`;
                const deps = {};

                for (const [name, content] of Object.entries(data.files)) {
                    if (typeof content !== 'string' || !name.endsWith('.js')) continue;

                    deps[name] = [];
                    // Find require() calls
                    const requireMatches = content.match(/require\s*\(\s*['"](\.\/[^'"]+)['"]\s*\)/g);
                    if (requireMatches) {
                        requireMatches.forEach(m => {
                            const dep = m.match(/['"](\.\/[^'"]+)['"]/)[1];
                            deps[name].push(dep.replace('./', '') + (dep.endsWith('.js') ? '' : '.js'));
                        });
                    }
                    // Find import statements
                    const importMatches = content.match(/import\s+.+\s+from\s+['"](\.\/[^'"]+)['"]/g);
                    if (importMatches) {
                        importMatches.forEach(m => {
                            const dep = m.match(/['"](\.\/[^'"]+)['"]/)[1];
                            deps[name].push(dep.replace('./', '') + (dep.endsWith('.js') ? '' : '.js'));
                        });
                    }
                    // Find script src in HTML
                    if (name.endsWith('.html')) {
                        const srcMatches = content.match(/src\s*=\s*["']([^"']+\.js)["']/g);
                        if (srcMatches) {
                            srcMatches.forEach(m => {
                                const src = m.match(/["']([^"']+)["']/)[1];
                                deps[name] = deps[name] || [];
                                deps[name].push(src);
                            });
                        }
                    }
                }

                for (const [file, fileDeps] of Object.entries(deps)) {
                    if (fileDeps.length > 0) {
                        graph += `${file}\n`;
                        fileDeps.forEach(d => graph += `  â””â†’ ${d}\n`);
                    }
                }

                if (Object.keys(deps).length === 0) {
                    graph += 'No JavaScript dependencies found.\n';
                }

                toolResultStr = graph;
                if (window.appendToolMessage) window.appendToolMessage('dependency_graph', 'success', `${appName}: ${Object.keys(deps).length} files analyzed`);
            } catch (e) {
                toolResultStr = `dependency_graph failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('dependency_graph', 'error', e.message);
            }
        }
        // ===================================================================
        // UPGRADE #4: MULTI-AGENT â€” SPAWN SUB-AGENT
        // ===================================================================
        else if (type === 'spawn_agent') {
            try {
                const task = act.task || '';
                const agentType = act.type || 'browser_agent';
                const returnWhen = act.return_when || 'task complete';

                // Create a self-contained sub-task that runs async
                const subAgentId = 'agent_' + Date.now();
                window._subAgents = window._subAgents || {};

                if (agentType === 'browser_agent') {
                    // Browser sub-agent: captures, analyzes, and reports back
                    window._subAgents[subAgentId] = { status: 'running', task, result: null };

                    // Execute in background
                    (async () => {
                        try {
                            // Find an open app tab to work with
                            const tabs = window._agenticTabs || {};
                            const tabIds = Object.keys(tabs);
                            if (tabIds.length === 0) {
                                window._subAgents[subAgentId] = { status: 'done', task, result: 'No open app tabs to interact with.' };
                                return;
                            }
                            const tabId = tabs[tabIds[0]].tabId;

                            // Capture + Read DOM
                            const capRes = await window.wsCommand('capture_browser', { tabId });
                            const domRes = await window.wsCommand('execute_browser_script', { tabId, script: 'document.body.innerText.substring(0, 2000)' });

                            window._subAgents[subAgentId] = {
                                status: 'done',
                                task,
                                result: `Sub-agent completed. DOM text: ${domRes.data || 'N/A'}`,
                                screenshot: capRes.data || null
                            };
                        } catch (e) {
                            window._subAgents[subAgentId] = { status: 'error', task, result: e.message };
                        }
                    })();

                    toolResultStr = `Sub-agent '${subAgentId}' spawned (${agentType}). Task: "${task}". Check back later for results.`;
                } else if (agentType === 'monitor_agent') {
                    const duration = act.duration_seconds || 30;
                    window._subAgents[subAgentId] = { status: 'running', task, result: null };

                    setTimeout(() => {
                        window._subAgents[subAgentId] = { status: 'done', task, result: `Monitoring period (${duration}s) completed.` };
                    }, duration * 1000);

                    toolResultStr = `Monitor agent '${subAgentId}' spawned. Will run for ${duration} seconds.`;
                } else {
                    toolResultStr = `Unknown agent type: ${agentType}`;
                }

                if (window.appendToolMessage) window.appendToolMessage('spawn_agent', 'success', `ðŸ¤– ${subAgentId} (${agentType})`);
            } catch (e) {
                toolResultStr = `spawn_agent failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('spawn_agent', 'error', e.message);
            }
        }
        // ===================================================================
        // UPGRADE #4: MULTI-AGENT â€” CHECK SUB-AGENT
        // ===================================================================
        else if (type === 'check_agent') {
            try {
                const agentId = act.agent_id;
                const agents = window._subAgents || {};
                if (!agentId) {
                    // List all agents
                    let summary = `Active Sub-Agents (${Object.keys(agents).length}):\n`;
                    for (const [id, a] of Object.entries(agents)) {
                        summary += `  ${id}: ${a.status} â€” "${a.task}"\n`;
                    }
                    toolResultStr = summary;
                } else if (agents[agentId]) {
                    const a = agents[agentId];
                    toolResultStr = `Agent ${agentId}:\nStatus: ${a.status}\nTask: ${a.task}\nResult: ${a.result || 'Still running...'}`;
                } else {
                    toolResultStr = `Agent ${agentId} not found.`;
                }
                if (window.appendToolMessage) window.appendToolMessage('check_agent', 'success', `${Object.keys(agents).length} agents`);
            } catch (e) {
                toolResultStr = `check_agent failed: ${e.message}`;
            }
        }
        // ===================================================================
        // UPGRADE #16: IMAGE/ICON GENERATION (SVG Programmatic)
        // ===================================================================
        else if (type === 'generate_icon') {
            try {
                const name = act.name || 'icon';
                const color = act.color || '#6366f1';
                const bgColor = act.bg_color || '#1e1b4b';
                const emoji = act.emoji || 'âš¡';
                const shape = act.shape || 'rounded_rect'; // rounded_rect, circle, hexagon
                const size = act.size || 128;

                let shapeSvg = '';
                if (shape === 'circle') {
                    shapeSvg = `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 4}" fill="${bgColor}" stroke="${color}" stroke-width="3"/>`;
                } else if (shape === 'hexagon') {
                    const s = size / 2;
                    const points = [];
                    for (let i = 0; i < 6; i++) {
                        const angle = (Math.PI / 3) * i - Math.PI / 6;
                        points.push(`${s + (s - 4) * Math.cos(angle)},${s + (s - 4) * Math.sin(angle)}`);
                    }
                    shapeSvg = `<polygon points="${points.join(' ')}" fill="${bgColor}" stroke="${color}" stroke-width="3"/>`;
                } else {
                    shapeSvg = `<rect x="4" y="4" width="${size - 8}" height="${size - 8}" rx="20" ry="20" fill="${bgColor}" stroke="${color}" stroke-width="3"/>`;
                }

                const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${bgColor};stop-opacity:1"/>
      <stop offset="100%" style="stop-color:${color};stop-opacity:0.3"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="2" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
  </defs>
  ${shapeSvg}
  <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" font-size="${size * 0.45}" filter="url(#glow)">${emoji}</text>
</svg>`;

                // Write as icon.svg for the current app
                const writeRes = await fetch('http://127.0.0.1:5000/api/ai-write', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        app_id: currentLoopAppId,
                        output_type: outputType,
                        files: { [`${name}.svg`]: svgContent }
                    })
                });

                window.generatedFiles[`${name}.svg`] = svgContent;
                toolResultStr = `Generated ${shape} icon '${name}.svg' with emoji ${emoji}, color ${color}`;
                if (window.appendToolMessage) window.appendToolMessage('generate_icon', 'success', `ðŸŽ¨ ${name}.svg (${emoji})`);
            } catch (e) {
                toolResultStr = `generate_icon failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('generate_icon', 'error', e.message);
            }
        }
        // ===================================================================
        // UPGRADE #13: ROLLBACK TO LAST CHECKPOINT
        // ===================================================================
        else if (type === 'rollback') {
            try {
                const targetApp = act.app_id || currentLoopAppId;
                if (!targetApp) throw new Error('No app_id specified');

                // Git revert all changes since last checkpoint
                const res = await fetch('http://127.0.0.1:5000/api/git', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        app_id: targetApp,
                        output_type: outputType,
                        action: 'revert',
                        args: act.files || ['.']
                    })
                });
                const data = await res.json();
                toolResultStr = `Rolled back ${targetApp}: ${data.output || 'reverted to last checkpoint'}`;
                if (window.appendToolMessage) window.appendToolMessage('rollback', 'success', `âª ${targetApp} reverted`);

                // Reload editor with restored files
                try {
                    const readRes = await fetch(`http://127.0.0.1:5000/api/ai-read/${outputType === 'node' ? 'nodes' : 'apps'}/${targetApp}`);
                    const readData = await readRes.json();
                    if (readData.status === 'success') {
                        window.generatedFiles = readData.files;
                    }
                } catch (e) { }
            } catch (e) {
                toolResultStr = `rollback failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('rollback', 'error', e.message);
            }
        }
        // ===================================================================
        // CLAUDE CODE PARITY: SELF-EVOLUTION ENGINE TOOLS
        // ===================================================================
        else if (type === 'evolution_start') {
            const started = window.startEvolution();
            toolResultStr = started
                ? 'Self-Evolution Engine ACTIVATED! AI Assistant is now operating autonomously.\nMonitoring: Crash scan (5min), Self-review (15min), Health check (30min), Knowledge review (1hr)'
                : 'Evolution Engine is already running. Use evolution_status to check.';
            if (window.appendToolMessage) window.appendToolMessage('evolution_start', started ? 'success' : 'error', started ? 'Activated' : 'Already running');
        }
        else if (type === 'evolution_stop') {
            const stopped = window.stopEvolution();
            toolResultStr = stopped ? 'Self-Evolution Engine DEACTIVATED.' : 'Evolution Engine was not running.';
            if (window.appendToolMessage) window.appendToolMessage('evolution_stop', stopped ? 'success' : 'error', stopped ? 'Stopped' : 'Not running');
        }
        else if (type === 'evolution_status') {
            const status = window.getEvolutionStatus();
            let summary = `Self-Evolution Engine Status:\n`;
            summary += `Active: ${status.active ? 'YES' : 'NO'}\n`;
            summary += `Uptime: ${status.stats.uptime}\n`;
            summary += `Crashes Detected: ${status.stats.crashesDetected}\n`;
            summary += `Crashes Fixed: ${status.stats.crashesFixed}\n`;
            summary += `Reviews Performed: ${status.stats.reviewsPerformed}\n`;
            summary += `Improvements Made: ${status.stats.improvementsMade}\n`;
            summary += `Health Checks: ${status.stats.healthChecks}\n`;
            summary += `\nConfig:\n`;
            Object.entries(status.config).forEach(([k, v]) => { summary += `  ${k}: ${v}\n`; });
            if (status.recentActions.length > 0) {
                summary += `\nRecent Actions (${status.recentActions.length}):\n`;
                status.recentActions.forEach(a => { summary += `  [${a.timestamp}] ${a.type}: ${a.detail}\n`; });
            }
            toolResultStr = summary;
            if (window.appendToolMessage) window.appendToolMessage('evolution_status', 'success', status.active ? 'Active' : 'Inactive');
        }
        // ===================================================================
        // UPGRADE #15: GET TOKEN USAGE
        // ===================================================================
        else if (type === 'get_token_usage') {
            const tracker = window._tokenTracker || { totalInputChars: 0, totalOutputChars: 0, apiCalls: 0, sessionStart: Date.now() };
            const sessionMins = Math.floor((Date.now() - tracker.sessionStart) / 60000);
            const estTokens = Math.ceil(tracker.totalInputChars / 4);
            toolResultStr = `Token Usage Report:
- Session Duration: ${sessionMins} minutes
- API Calls Made: ${tracker.apiCalls}
- Total Input Characters: ${tracker.totalInputChars.toLocaleString()}
- Estimated Input Tokens: ~${estTokens.toLocaleString()}
- Current Chat History: ${window.chatHistory.length} messages
- Current Context Size: ~${Math.ceil((window.cachedSystemPrompt || '').length / 4)} prompt tokens`;
            if (window.appendToolMessage) window.appendToolMessage('get_token_usage', 'success', `📊 ${tracker.apiCalls} calls, ~${estTokens} tokens`);
        }
        // ===================================================================
        // UPGRADE #17: GET IDE CONTEXT
        // ===================================================================
        else if (type === 'get_ide_context') {
            try {
                let ideInfo = 'IDE Context:\n';
                ideInfo += `Active File: ${window.activeTab || 'none'}\n`;
                ideInfo += `Generated Files: ${Object.keys(window.generatedFiles || {}).join(', ') || 'none'}\n`;
                ideInfo += `Current App ID: ${currentLoopAppId || 'none'}\n`;

                if (window.monacoEditorInstance) {
                    const model = window.monacoEditorInstance.getModel();
                    const pos = window.monacoEditorInstance.getPosition();
                    ideInfo += `Cursor Position: line ${pos?.lineNumber || 0}, column ${pos?.column || 0}\n`;
                    ideInfo += `Total Lines: ${model ? model.getLineCount() : 0}\n`;

                    // Get selected text if any
                    const selection = window.monacoEditorInstance.getSelection();
                    if (selection && !selection.isEmpty()) {
                        const selectedText = model.getValueInRange(selection);
                        ideInfo += `Selected Text (${selectedText.length} chars):\n${selectedText.substring(0, 500)}\n`;
                    }
                }

                ideInfo += `Roadmap Items: ${(window.roadmap || []).length}\n`;
                toolResultStr = ideInfo;
                if (window.appendToolMessage) window.appendToolMessage('get_ide_context', 'success', `ðŸ“‹ ${window.activeTab || 'none'}`);
            } catch (e) {
                toolResultStr = `get_ide_context failed: ${e.message}`;
            }
        }
        // ===================================================================
        // CLAUDE CODE PARITY: MCP TOOLS
        // ===================================================================
        else if (type === 'mcp_connect') {
            try {
                const serverId = act.server_id;
                if (!serverId) throw new Error('Missing server_id');
                window.mcpRegistry.addServer(serverId, act.name || serverId, {
                    type: act.type || 'stdio',
                    command: act.command || '',
                    args: act.args || [],
                    url: act.url || '',
                    env: act.env || {}
                });
                const result = await window.mcpClient.connect(serverId);
                toolResultStr = `MCP server '${serverId}' connected! Discovered ${result.tools.length} tools: ${result.tools.join(', ')}`;
                if (window.appendToolMessage) window.appendToolMessage('mcp_connect', 'success', `ðŸ”Œ ${serverId}: ${result.tools.length} tools`);
            } catch (e) {
                toolResultStr = `mcp_connect failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('mcp_connect', 'error', e.message);
            }
        }
        else if (type === 'mcp_disconnect') {
            try {
                await window.mcpClient.disconnect(act.server_id);
                toolResultStr = `MCP server '${act.server_id}' disconnected.`;
                if (window.appendToolMessage) window.appendToolMessage('mcp_disconnect', 'success', `ðŸ”Œ ${act.server_id}`);
            } catch (e) {
                toolResultStr = `mcp_disconnect failed: ${e.message}`;
            }
        }
        else if (type === 'mcp_list_tools') {
            const tools = window.mcpClient.listTools();
            if (tools.length === 0) {
                toolResultStr = 'No MCP tools available. Connect to an MCP server first using mcp_connect.';
            } else {
                let summary = `MCP Tools (${tools.length}):\n`;
                tools.forEach(t => { summary += `  - ${t.shortName} [${t.server}]: ${t.description}\n`; });
                toolResultStr = summary;
            }
            if (window.appendToolMessage) window.appendToolMessage('mcp_list_tools', 'success', `${tools.length} tools`);
        }
        else if (type === 'mcp_call_tool') {
            try {
                const result = await window.mcpClient.callTool(act.tool_name, act.arguments || {});
                toolResultStr = `MCP Tool '${act.tool_name}' result:\n${JSON.stringify(result.result, null, 2)}`;
                if (window.appendToolMessage) window.appendToolMessage('mcp_call_tool', result.isError ? 'error' : 'success', act.tool_name);
            } catch (e) {
                toolResultStr = `mcp_call_tool failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('mcp_call_tool', 'error', e.message);
            }
        }
        else if (type === 'mcp_list_servers') {
            const servers = window.mcpRegistry.listServers();
            if (servers.length === 0) {
                toolResultStr = 'No MCP servers registered. Use mcp_connect to add one.';
            } else {
                let summary = `MCP Servers (${servers.length}):\n`;
                servers.forEach(s => { summary += `  - ${s.id} (${s.name}): ${s.status} | ${s.toolCount} tools\n`; });
                toolResultStr = summary;
            }
            if (window.appendToolMessage) window.appendToolMessage('mcp_list_servers', 'success', `${servers.length} servers`);
        }
        // ===================================================================
        // CLAUDE CODE PARITY: AGENT COORDINATOR TOOLS
        // ===================================================================
        else if (type === 'create_team') {
            try {
                const team = window.teamManager.createTeam(act.name || 'Unnamed Team', act.goal || '', act.tasks || []);
                toolResultStr = `Team '${team.name}' created with ${team.agents.length} agents (ID: ${team.id}). Goal: ${team.goal}`;
                if (window.appendToolMessage) window.appendToolMessage('create_team', 'success', `ðŸ‘¥ ${team.name}: ${team.agents.length} agents`);
            } catch (e) {
                toolResultStr = `create_team failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('create_team', 'error', e.message);
            }
        }
        else if (type === 'delete_team') {
            const success = window.teamManager.deleteTeam(act.team_id);
            toolResultStr = success ? `Team '${act.team_id}' disbanded.` : `Team '${act.team_id}' not found.`;
            if (window.appendToolMessage) window.appendToolMessage('delete_team', success ? 'success' : 'error', act.team_id);
        }
        else if (type === 'send_message') {
            try {
                const msg = window.agentMessaging.send(act.from_agent, act.to_agent, act.message, act.type || 'info');
                toolResultStr = `Message sent from ${act.from_agent} â†’ ${act.to_agent}: "${act.message}"`;
                if (window.appendToolMessage) window.appendToolMessage('send_message', 'success', `ðŸ“¨ ${act.from_agent} â†’ ${act.to_agent}`);
            } catch (e) {
                toolResultStr = `send_message failed: ${e.message}`;
            }
        }
        else if (type === 'list_agents') {
            const agents = window.agentPool.listAgents(act.filter || null);
            if (agents.length === 0) {
                toolResultStr = 'No agents in the pool. Use spawn_agent or create_team to create agents.';
            } else {
                let summary = `Agent Pool (${agents.length}):\n`;
                agents.forEach(a => { summary += `  ðŸ¤– ${a.id} [${a.type}] â€” ${a.status} â€” "${a.task}" (${a.duration})\n`; });
                toolResultStr = summary;
            }
            if (window.appendToolMessage) window.appendToolMessage('list_agents', 'success', `${agents.length} agents`);
        }
        else if (type === 'list_teams') {
            const teams = window.teamManager.listTeams();
            if (teams.length === 0) {
                toolResultStr = 'No active teams. Use create_team to form one.';
            } else {
                let summary = `Teams (${teams.length}):\n`;
                teams.forEach(t => { summary += `  ðŸ‘¥ ${t.id} "${t.name}" â€” ${t.agentCount} agents â€” ${t.status}\n`; });
                toolResultStr = summary;
            }
            if (window.appendToolMessage) window.appendToolMessage('list_teams', 'success', `${teams.length} teams`);
        }
        else if (type === 'self_restart') {
            try {
                const result = await window.selfRestart();
                toolResultStr = result.status === 'success'
                    ? 'ðŸ”„ Engine restart initiated. The engine will restart in ~1 second.'
                    : `Self-restart failed: ${result.error}`;
                if (window.appendToolMessage) window.appendToolMessage('self_restart', result.status, 'ðŸ”„ Restarting...');
            } catch (e) {
                toolResultStr = `self_restart failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('self_restart', 'error', e.message);
            }
        }
        else if (type === 'self_shutdown') {
            try {
                const result = await window.selfShutdown();
                toolResultStr = 'ðŸ›‘ Engine shutdown initiated. Goodbye!';
                if (window.appendToolMessage) window.appendToolMessage('self_shutdown', 'success', 'ðŸ›‘ Shutting down...');
            } catch (e) {
                toolResultStr = `self_shutdown failed: ${e.message}`;
            }
        }
        else if (type === 'schedule_task') {
            try {
                const result = await window.scheduleTask(act.task_name, act.schedule, act.command || '');
                toolResultStr = result.status === 'success'
                    ? `â° Scheduled task '${act.task_name}' created (${act.schedule}). Output: ${result.output}`
                    : `schedule_task failed: ${result.error}`;
                if (window.appendToolMessage) window.appendToolMessage('schedule_task', result.status, `â° ${act.task_name} (${act.schedule})`);
            } catch (e) {
                toolResultStr = `schedule_task failed: ${e.message}`;
            }
        }
        // ===================================================================
        // CLAUDE CODE PARITY: PERMISSION & SAFETY TOOLS
        // ===================================================================
        else if (type === 'set_permission_mode') {
            const success = window.setPermissionMode(act.mode);
            toolResultStr = success
                ? `Permission mode changed to: ${act.mode}`
                : `Invalid mode: ${act.mode}. Valid modes: auto, supervised, locked`;
            if (window.appendToolMessage) window.appendToolMessage('set_permission_mode', success ? 'success' : 'error', act.mode);
        }
        else if (type === 'get_audit_trail') {
            const entries = window.auditTrail.getRecent(act.count || 50);
            let summary = `${window.auditTrail.getSummary()}\n\nRecent ${entries.length} entries:\n`;
            entries.forEach(e => {
                summary += `  [${e.timestamp}] ${e.allowed ? 'âœ…' : 'ðŸš«'} ${e.action}: ${e.details.substring(0, 80)}${e.reason ? ' â€” ' + e.reason : ''}\n`;
            });
            toolResultStr = summary;
            if (window.appendToolMessage) window.appendToolMessage('get_audit_trail', 'success', `${entries.length} entries`);
        }
        else if (type === 'get_permission_status') {
            const status = window.getPermissionStatus();
            toolResultStr = `Permission Status:\n  Mode: ${status.mode}\n  API Calls (this min): ${status.rateLimiter.apiCallsThisMinute}/${status.rateLimiter.maxPerMinute}\n  Tool Calls (session): ${status.rateLimiter.toolCallsThisSession}/${status.rateLimiter.maxPerSession}\n  Cost Estimate: ${status.rateLimiter.costEstimate} / Budget: ${status.rateLimiter.costBudget}\n  ${status.audit}`;
            if (window.appendToolMessage) window.appendToolMessage('get_permission_status', 'success', `Mode: ${status.mode}`);
        }
        // ===================================================================
        // CLAUDE CODE PARITY: SYSTEM HEALTH
        // ===================================================================
        else if (type === 'system_health') {
            try {
                const res = await fetch('http://127.0.0.1:5000/api/system/health');
                const data = await res.json();
                let summary = `Engine Health Report:\n`;
                summary += `  Version: ${data.engine_version}\n`;
                summary += `  Uptime: ${Math.round(data.uptime_secs / 60)} minutes\n`;
                summary += `  Memory: ${data.mem_alloc_mb}MB allocated / ${data.mem_sys_mb}MB system\n`;
                summary += `  Goroutines: ${data.goroutines}\n`;
                summary += `  GC Cycles: ${data.mem_gc_count}\n`;
                summary += `  OS: ${data.os}/${data.arch} (${data.num_cpu} CPUs)\n`;
                summary += `  User Tier: ${data.user_tier}\n`;
                summary += `  Engine Dir: ${data.engine_dir}\n`;
                toolResultStr = summary;
                if (window.appendToolMessage) window.appendToolMessage('system_health', 'success', `ðŸ¥ v${data.engine_version} | ${Math.round(data.uptime_secs / 60)}min | ${data.mem_alloc_mb}MB`);
            } catch (e) {
                toolResultStr = `system_health failed: ${e.message}`;
                if (window.appendToolMessage) window.appendToolMessage('system_health', 'error', e.message);
            }
        }
        // ===================================================================
        // PHASE 2: SKILL SYSTEM (Slash Commands)
        // ===================================================================
        else if (type === 'invoke_skill' || type === 'skill') {
            const skillName = act.skill || act.name || '';
            const skill = window.skillRegistry.invoke(skillName, act.args || act.arguments || '');
            if (skill) {
                // Inject skill prompt as a system message and re-tick
                window.chatHistory.push({ role: 'system', content: `[SKILL: /${skillName}]\n${skill}` });
                toolResultStr = `Skill /${skillName} activated. Instructions injected into context.`;
                if (window.appendToolMessage) window.appendToolMessage('skill', 'success', `ðŸ“Œ /${skillName}`);
            } else {
                const available = window.skillRegistry.list().map(s => s.name).join(', ');
                toolResultStr = `Skill "/${skillName}" not found. Available skills: ${available}`;
                if (window.appendToolMessage) window.appendToolMessage('skill', 'error', `/${skillName} not found`);
            }
        }
        else if (type === 'register_skill') {
            window.skillRegistry.register(act.name, {
                description: act.description || '',
                whenToUse: act.when_to_use || '',
                prompt: act.prompt || '',
                source: 'user'
            });
            toolResultStr = `Skill "/${act.name}" registered successfully.`;
            if (window.appendToolMessage) window.appendToolMessage('register_skill', 'success', `ðŸ“Œ /${act.name}`);
        }
        else if (type === 'list_skills') {
            const skills = window.skillRegistry.list();
            if (skills.length === 0) {
                toolResultStr = 'No skills registered. Use register_skill to create one, or bundled skills are available by default.';
            } else {
                let summary = `Skills (${skills.length}):\n`;
                skills.forEach(s => { summary += `  /${s.name} [${s.source}]: ${s.description}\n`; });
                toolResultStr = summary;
            }
            if (window.appendToolMessage) window.appendToolMessage('list_skills', 'success', `${skills.length} skills`);
        }
        else if (type === 'tool_search') {
            const results = window.toolSearch.search(act.query || '', act.max_results || 5);
            if (results.length === 0) {
                toolResultStr = `No tools found matching "${act.query}". Try broader keywords.`;
            } else {
                let summary = `Tool Search Results for "${act.query}":\n`;
                results.forEach(r => { summary += `  - ${r.name}: ${r.hint} (score: ${r.score})\n`; });
                toolResultStr = summary;
            }
            if (window.appendToolMessage) window.appendToolMessage('tool_search', 'success', `${results.length} results`);
        }
        // ===================================================================
        // CLAUDE CODE PARITY v2: NEW TOOL HANDLERS
        // ===================================================================
        // ── GIT WORKTREE ─────────────────────────────────────────────
        else if (type === 'worktree_create') {
            try {
                const name = act.name || 'agent-worktree-' + Date.now();
                const branch = act.branch || name;
                const cmdResult = await window.wsCommand('run_terminal', { command: `git worktree add -b ${branch} ../worktrees/${name}`, session_id: 'worktree_' + name });
                window._activeWorktree = { name, branch, path: `../worktrees/${name}` };
                toolResultStr = `Git worktree created: ${name}\n  Branch: ${branch}\n  Path: ../worktrees/${name}`;
                if (window.appendToolMessage) window.appendToolMessage('worktree', 'success', name);
            } catch (e) { toolResultStr = `worktree_create failed: ${e.message}`; }
        }
        else if (type === 'worktree_exit') {
            const wt = window._activeWorktree;
            if (!wt) { toolResultStr = 'No active worktree.'; }
            else {
                try {
                    if (act.keep_changes !== false) {
                        await window.wsCommand('run_terminal', { command: `cd ${wt.path} && git add -A && git commit -m "worktree: ${wt.name}" && cd .. && git merge ${wt.branch}`, session_id: 'wt_merge' });
                    }
                    await window.wsCommand('run_terminal', { command: `git worktree remove ${wt.path} --force`, session_id: 'wt_rm' });
                    window._activeWorktree = null;
                    toolResultStr = `Worktree ${wt.name} closed. Changes ${act.keep_changes !== false ? 'merged' : 'discarded'}.`;
                } catch (e) { toolResultStr = `worktree_exit failed: ${e.message}`; }
            }
        }
        else if (type === 'worktree_status') {
            const wt = window._activeWorktree;
            toolResultStr = wt ? `Active worktree: ${wt.name} (branch: ${wt.branch}, path: ${wt.path})` : 'No active worktree.';
        }
        // ── PLAN MODE ────────────────────────────────────────────────
        else if (type === 'enter_plan_mode') {
            const result = window.enterPlanMode ? window.enterPlanMode() : { error: 'Plan mode not available' };
            toolResultStr = result.error || `Plan mode activated. Previous mode: ${result.previousMode}. You are now in READ-ONLY mode. Create a plan, show it, then use exit_plan_mode after approval.`;
        }
        else if (type === 'exit_plan_mode') {
            const result = window.exitPlanMode ? window.exitPlanMode() : { error: 'Plan mode not available' };
            toolResultStr = result.error || `Plan mode deactivated. Restored to: ${result.restoredMode}. You can now execute the approved plan.`;
        }
        // ── SESSION PERSISTENCE ──────────────────────────────────────
        else if (type === 'session_save') {
            const result = await window.sessionPersistence.save(act.label || act.name);
            toolResultStr = result.error ? `Session save failed: ${result.error}` : `Session saved: ${result.id}`;
        }
        else if (type === 'session_restore' || type === 'session_resume') {
            if (!act.session_id && !act.id) {
                const sessions = await window.sessionPersistence.listSessions();
                let listing = `Saved sessions (${sessions.length}):\n`;
                sessions.slice(0, 10).forEach((s, i) => { listing += `  ${i + 1}. [${s.id}] ${s.label} (${s.messageCount} msgs)\n`; });
                toolResultStr = listing + '\nUse session_restore with session_id to restore.';
            } else {
                const result = await window.sessionPersistence.restore(act.session_id || act.id);
                toolResultStr = result.error ? `Restore failed: ${result.error}` : `Session restored: ${result.label}`;
            }
        }
        else if (type === 'session_list' || type === 'list_sessions') {
            const sessions = await window.sessionPersistence.listSessions();
            let listing = `Saved sessions (${sessions.length}):\n`;
            sessions.forEach((s, i) => { listing += `  ${i + 1}. [${s.id}] ${s.label} (${s.messageCount} msgs)\n`; });
            toolResultStr = listing;
        }
        // ── MEMORY MANAGEMENT ────────────────────────────────────────
        else if (type === 'remember' || type === 'save_memory') {
            const fact = act.fact || act.content || act.text || '';
            if (!fact) { toolResultStr = 'remember: Please provide a fact. Example: { "action": "remember", "fact": "User prefers dark theme" }'; }
            else {
                await window.hierarchicalMemory.appendToMemory(act.level || 'project', fact);
                toolResultStr = `Saved to ${act.level || 'project'} memory: "${fact}"`;
            }
        }
        else if (type === 'memory_search') {
            const results = await window.semanticMemorySearch.search(act.query || '', act.limit || 5);
            if (results.length === 0) { toolResultStr = `No memories found for "${act.query}".`; }
            else {
                let summary = `Memory search results for "${act.query}":\n`;
                results.forEach(r => { summary += `  - [${r.freshnessLabel}] ${r.title || 'Untitled'}: ${(r.content || '').substring(0, 100)}\n`; });
                toolResultStr = summary;
            }
        }
        // ── MCP SERVER MODE ──────────────────────────────────────────
        else if (type === 'mcp_server_start') {
            const result = await window.mcpServer.start(act.port);
            toolResultStr = result.error || `MCP Server started on port ${result.port} with ${result.tools} tools exposed.`;
        }
        else if (type === 'mcp_server_stop') {
            const result = await window.mcpServer.stop();
            toolResultStr = 'MCP Server stopped.';
        }
        // ── IDE BRIDGE ───────────────────────────────────────────────
        else if (type === 'bridge_start') {
            const result = await window.ideBridge.start();
            toolResultStr = result.error || `IDE Bridge started (${result.mode || 'websocket'} mode, port: ${result.port}).`;
        }
        else if (type === 'bridge_stop') {
            await window.ideBridge.stop();
            toolResultStr = 'IDE Bridge stopped.';
        }
        else if (type === 'bridge_status') {
            const status = window.ideBridge.getStatus();
            toolResultStr = `IDE Bridge: ${status.enabled ? 'Active' : 'Inactive'} (${status.mode}, port: ${status.port}, handlers: ${status.handlers.length})`;
        }
        // ── AUTH ─────────────────────────────────────────────────────
        else if (type === 'auth_login') {
            const result = await window.authManager.login(act.provider);
            toolResultStr = result.error || `Login initiated for ${act.provider}. Check browser for auth prompt.`;
        }
        else if (type === 'auth_logout') {
            const result = window.authManager.logout(act.provider);
            toolResultStr = `Logged out: ${result.provider}`;
        }
        else if (type === 'auth_status') {
            const status = window.authManager.getStatus();
            let report = 'Auth Status:\n';
            for (const [name, info] of Object.entries(status)) {
                report += `  ${info.name}: ${info.loggedIn ? 'Logged In' : 'Not logged in'}${info.expiresAt ? ' (expires: ' + info.expiresAt + ')' : ''}\n`;
            }
            toolResultStr = report;
        }
        // ── FEATURE FLAGS ────────────────────────────────────────────
        else if (type === 'feature_enable') {
            window.featureFlags.enable(act.flag);
            toolResultStr = `Feature flag "${act.flag}" enabled.`;
        }
        else if (type === 'feature_disable') {
            window.featureFlags.disable(act.flag);
            toolResultStr = `Feature flag "${act.flag}" disabled.`;
        }
        else if (type === 'feature_list') {
            const report = window.featureFlags.getReport();
            toolResultStr = report.display;
        }
        // ── COMPACT ──────────────────────────────────────────────────
        else if (type === 'compact') {
            const result = await window.smartCompact.compact(act.force || false);
            toolResultStr = result ? 'Context compacted successfully.' : 'No compaction needed (context within limits).';
        }
        // ===================================================================
        // PHASE 2: TODO / TASK MANAGEMENT
        // ===================================================================
        else if (type === 'todo_write') {
            const todos = act.todos || [];
            const result = window.sessionTodo.write(todos);
            const summary = window.sessionTodo.getSummary();
            toolResultStr = `Todos updated: ${summary.total} items (${summary.pending} pending, ${summary.inProgress} in progress, ${summary.completed} completed)`;
            if (result.needsVerification) {
                toolResultStr += '\n\nâš ï¸ NOTE: You completed 3+ tasks without a verification step. Consider verifying your changes before finishing.';
            }
            if (window.appendToolMessage) window.appendToolMessage('todo_write', 'success', `âœ… ${summary.total} items`);
        }
        else if (type === 'todo_list') {
            const items = window.sessionTodo.list(act.filter || null);
            if (items.length === 0) {
                toolResultStr = 'No todo items. Use todo_write to create a task list.';
            } else {
                const icons = { pending: 'â¬œ', in_progress: 'ðŸ”„', completed: 'âœ…' };
                let summary = `Todo List (${items.length}):\n`;
                items.forEach(i => {
                    summary += `  ${icons[i.status] || 'â¬œ'} [${i.id}] ${i.content} (${i.priority})\n`;
                });
                toolResultStr = summary;
            }
            if (window.appendToolMessage) window.appendToolMessage('todo_list', 'success', `${items.length} items`);
        }
        // ===================================================================
        // PHASE 2: REPL TOOL
        // ===================================================================
        else if (type === 'repl_start') {
            const result = await window.replTool.start(act.language || 'node');
            toolResultStr = result.error
                ? `repl_start failed: ${result.error}`
                : `REPL started (${result.language}). Session ID: ${result.sessionId}. Use repl_execute to run code.`;
            if (window.appendToolMessage) window.appendToolMessage('repl_start', result.error ? 'error' : 'success', result.language || '');
        }
        else if (type === 'repl_execute') {
            const result = await window.replTool.execute(act.session_id, act.code || '');
            toolResultStr = result.error
                ? `repl_execute failed: ${result.error}`
                : `REPL Output:\n${result.output}`;
            if (window.appendToolMessage) window.appendToolMessage('repl_execute', result.error ? 'error' : 'success', (act.code || '').substring(0, 30));
        }
        else if (type === 'repl_stop') {
            const stopped = await window.replTool.stop(act.session_id);
            toolResultStr = stopped ? `REPL session ${act.session_id} stopped.` : `Session not found: ${act.session_id}`;
            if (window.appendToolMessage) window.appendToolMessage('repl_stop', stopped ? 'success' : 'error', act.session_id || '');
        }
        // ===================================================================
        // PHASE 2: SMART COMPACTION & AUTO-MEMORY CONTROL
        // ===================================================================
        else if (type === 'compact' || type === 'smart_compact') {
            const compacted = window.smartCompact.compact();
            toolResultStr = compacted
                ? 'ðŸ“¦ Context compacted. Old messages summarized and recent messages preserved.'
                : 'âš ï¸ Compaction not needed yet (context below threshold) or already in progress.';
            if (window.appendToolMessage) window.appendToolMessage('compact', compacted ? 'success' : 'error', compacted ? 'ðŸ“¦ Done' : 'Not needed');
        }
        else if (type === 'set_auto_memory') {
            const enabled = act.enabled !== false;
            window.autoMemory.enabled = enabled;
            toolResultStr = `Auto-memory ${enabled ? 'ENABLED' : 'DISABLED'}. ${enabled ? 'Memories will be auto-extracted every ' + window.autoMemory.extractEveryNTurns + ' turns.' : 'No auto-extraction.'}`;
            if (window.appendToolMessage) window.appendToolMessage('set_auto_memory', 'success', enabled ? 'ðŸ§  ON' : 'ðŸ§  OFF');
        }
        // ===================================================================
        // PHASE 2: CONFIG TOOL
        // ===================================================================
        else if (type === 'get_config') {
            const config = window.configTool.getConfig();
            let summary = `Current Configuration:\n`;
            Object.entries(config).forEach(([k, v]) => {
                summary += `  ${k}: ${Array.isArray(v) ? v.join(', ') || 'none' : v}\n`;
            });
            toolResultStr = summary;
            if (window.appendToolMessage) window.appendToolMessage('get_config', 'success', `âš™ï¸ ${config.provider}/${config.model}`);
        }
        else if (type === 'set_config') {
            const success = window.configTool.setConfig(act.key, act.value);
            toolResultStr = success
                ? `Config "${act.key}" set to "${act.value}".`
                : `Unknown config key: ${act.key}. Use get_config to see available keys.`;
            if (window.appendToolMessage) window.appendToolMessage('set_config', success ? 'success' : 'error', `${act.key}=${act.value}`);
        }
        // ===================================================================
        // PHASE 2: WEB FETCH + SLEEP + GLOB + SESSION BG
        // ===================================================================
        else if (type === 'web_fetch') {
            try {
                const result = await window.webFetchTool.fetch(act.url, { method: act.method, headers: act.headers, body: act.body });
                if (result.error) {
                    toolResultStr = `web_fetch failed: ${result.error}`;
                } else {
                    const body = window.briefOutput.summarize(result.body, 5000);
                    toolResultStr = `HTTP ${result.status} from ${act.url}:\n${body}`;
                }
                if (window.appendToolMessage) window.appendToolMessage('web_fetch', result.ok ? 'success' : 'error', act.url.substring(0, 40));
            } catch (e) {
                toolResultStr = `web_fetch failed: ${e.message}`;
            }
        }
        else if (type === 'sleep') {
            const ms = act.duration_ms || act.ms || 1000;
            await window.sleepTool(ms);
            toolResultStr = `Slept for ${ms}ms.`;
        }
        else if (type === 'glob') {
            const results = await window.globTool.match(act.pattern || '*', act.base_path || '.');
            if (Array.isArray(results)) {
                toolResultStr = results.length > 0
                    ? `Matched ${results.length} files:\n${results.slice(0, 50).join('\n')}`
                    : `No files matched pattern "${act.pattern}"`;
            } else {
                toolResultStr = `glob failed: ${results.error || 'unknown error'}`;
            }
            if (window.appendToolMessage) window.appendToolMessage('glob', 'success', `${act.pattern}: ${Array.isArray(results) ? results.length : 0} files`);
        }
        else if (type === 'bg_task_start') {
            const task = window.sessionBackground.addTask(act.task_id, act.description);
            toolResultStr = `Background task started: ${task.id}`;
            if (window.appendToolMessage) window.appendToolMessage('bg_task', 'success', task.id);
        }
        else if (type === 'bg_task_update') {
            const task = window.sessionBackground.updateTask(act.task_id, act.status, act.output);
            toolResultStr = task
                ? `Task ${act.task_id} updated: ${task.status}`
                : `Task not found: ${act.task_id}`;
        }
        else if (type === 'bg_task_list') {
            const tasks = window.sessionBackground.listTasks();
            if (tasks.length === 0) {
                toolResultStr = 'No background tasks.';
            } else {
                let summary = `Background Tasks (${tasks.length}):\n`;
                tasks.forEach(t => { summary += `  [${t.status}] ${t.id}: ${t.description} (${t.duration})\n`; });
                toolResultStr = summary;
            }
        }
        else if (type === 'diff_preview') {
            try {
                const diff = window.diffPreview.generateDiff(act.original || '', act.modified || '', act.filename || 'file');
                toolResultStr = `Diff Preview:\n\`\`\`diff\n${diff}\n\`\`\``;
                if (window.appendToolMessage) window.appendToolMessage('diff_preview', 'success', act.filename || 'file');
            } catch (e) {
                toolResultStr = `diff_preview failed: ${e.message}`;
            }
        }
        // ===================================================================
        // PHASE 3: GIT WORKTREE
        // ===================================================================
        else if (type === 'worktree_create' || type === 'enter_worktree') {
            try {
                const result = await window.worktreeTool.create(act.name, act.base_branch);
                toolResultStr = result.status === 'success'
                    ? `ðŸŒ³ Worktree created: ${result.worktree.name} (branch: ${result.worktree.branch}, path: ${result.worktree.path})`
                    : `worktree_create failed: ${result.error}`;
                if (window.appendToolMessage) window.appendToolMessage('worktree', result.status, `ðŸŒ³ ${act.name || 'new'}`);
            } catch (e) {
                toolResultStr = `worktree_create failed: ${e.message}`;
            }
        }
        else if (type === 'worktree_exit' || type === 'exit_worktree') {
            const result = await window.worktreeTool.exit(act.keep_changes !== false);
            toolResultStr = result.status === 'success'
                ? `ðŸŒ³ Exited worktree. Changes ${result.kept ? 'KEPT' : 'REMOVED'}.`
                : `worktree_exit failed: ${result.error}`;
            if (window.appendToolMessage) window.appendToolMessage('worktree', result.status, result.kept ? 'ðŸŒ³ Kept' : 'ðŸŒ³ Removed');
        }
        else if (type === 'worktree_status') {
            const status = window.worktreeTool.getStatus();
            toolResultStr = status.active
                ? `ðŸŒ³ Active worktree: ${status.name} (branch: ${status.branch}, created: ${status.createdAt})`
                : 'ðŸŒ³ Not in a worktree. Use worktree_create to start one.';
        }
        // ===================================================================
        // PHASE 3: CRON SCHEDULING
        // ===================================================================
        else if (type === 'cron_create') {
            try {
                const job = window.cronScheduler.create(act.prompt || '', act.cron || '*/5 * * * *', {
                    recurring: act.recurring !== false,
                    durable: !!act.durable
                });
                toolResultStr = `â° Cron job created: ${job.id}\n  Schedule: ${job.cron}\n  Prompt: "${job.prompt.substring(0, 80)}"\n  Recurring: ${job.recurring}\n  Durable: ${job.durable}`;
                if (window.appendToolMessage) window.appendToolMessage('cron_create', 'success', `â° ${job.id}`);
            } catch (e) {
                toolResultStr = `cron_create failed: ${e.message}`;
            }
        }
        else if (type === 'cron_delete') {
            const deleted = window.cronScheduler.delete(act.job_id);
            toolResultStr = deleted ? `â° Cron job ${act.job_id} deleted.` : `Job not found: ${act.job_id}`;
            if (window.appendToolMessage) window.appendToolMessage('cron_delete', deleted ? 'success' : 'error', act.job_id || '');
        }
        else if (type === 'cron_list') {
            const jobs = window.cronScheduler.list();
            if (jobs.length === 0) {
                toolResultStr = 'No scheduled cron jobs. Use cron_create to schedule one.';
            } else {
                let summary = `Cron Jobs (${jobs.length}):\n`;
                jobs.forEach(j => {
                    summary += `  â° ${j.id}: "${j.prompt}" [${j.cron}] ${j.recurring ? 'ðŸ”„' : '1ï¸âƒ£'} ${j.durable ? 'ðŸ’¾' : 'âš¡'} runs: ${j.runCount}\n`;
                });
                toolResultStr = summary;
            }
            if (window.appendToolMessage) window.appendToolMessage('cron_list', 'success', `${jobs.length} jobs`);
        }
        // ===================================================================
        // PHASE 3: COST REPORT
        // ===================================================================
        else if (type === 'cost_report') {
            toolResultStr = window.costTracker.getReport();
            if (window.appendToolMessage) window.appendToolMessage('cost_report', 'success', `ðŸ’° $${window.costTracker.totalCostUSD.toFixed(4)}`);
        }
        // ===================================================================
        // PHASE 3: PREVENT SLEEP
        // ===================================================================
        else if (type === 'prevent_sleep') {
            const enabled = act.enabled !== false;
            if (enabled) {
                await window.preventSleepWin.start();
                toolResultStr = 'ðŸ”’ Sleep prevention ENABLED. System will stay awake during long tasks.';
            } else {
                window.preventSleepWin.stop();
                toolResultStr = 'ðŸ”“ Sleep prevention DISABLED. System can sleep normally.';
            }
            if (window.appendToolMessage) window.appendToolMessage('prevent_sleep', 'success', enabled ? 'ðŸ”’ ON' : 'ðŸ”“ OFF');
        }
        // ===================================================================
        // PHASE 3: LSP-LITE (Code Intelligence)
        // ===================================================================
        else if (type === 'find_definition') {
            try {
                const content = act.file_content || '';
                const results = window.lspLite.findDefinition(content, act.symbol || '');
                if (results.length === 0) {
                    toolResultStr = `No definition found for "${act.symbol}"`;
                } else {
                    let summary = `Definitions of "${act.symbol}" (${results.length}):\n`;
                    results.forEach(r => { summary += `  Line ${r.line}: ${r.content}\n`; });
                    toolResultStr = summary;
                }
            } catch (e) { toolResultStr = `find_definition failed: ${e.message}`; }
        }
        else if (type === 'find_references') {
            try {
                const content = act.file_content || '';
                const results = window.lspLite.findReferences(content, act.symbol || '');
                toolResultStr = `References to "${act.symbol}": ${results.length} found\n` +
                    results.slice(0, 20).map(r => `  Line ${r.line}, col ${r.column}: ${r.content}`).join('\n');
            } catch (e) { toolResultStr = `find_references failed: ${e.message}`; }
        }
        else if (type === 'document_symbols') {
            try {
                const content = act.file_content || '';
                const lang = act.language || 'javascript';
                const symbols = window.lspLite.getSymbols(content, lang);
                if (symbols.length === 0) {
                    toolResultStr = `No symbols found in ${lang} content.`;
                } else {
                    let summary = `Symbols (${symbols.length}):\n`;
                    symbols.forEach(s => { summary += `  [${s.kind}] ${s.name} â€” line ${s.line}\n`; });
                    toolResultStr = summary;
                }
            } catch (e) { toolResultStr = `document_symbols failed: ${e.message}`; }
        }
        else if (type === 'hover_info') {
            try {
                const content = act.file_content || '';
                const info = window.lspLite.getHoverInfo(content, act.line || 1, act.column || 1);
                if (info) {
                    toolResultStr = `Symbol: ${info.symbol}\n  Definition: ${info.definition ? `line ${info.definition.line}: ${info.definition.content}` : 'not found'}\n  References: ${info.referenceCount}`;
                } else {
                    toolResultStr = 'No symbol at that position.';
                }
            } catch (e) { toolResultStr = `hover_info failed: ${e.message}`; }
        }
        // ===================================================================
        // PHASE 3: AWAY SUMMARY & STRUCTURED OUTPUT
        // ===================================================================
        else if (type === 'away_summary') {
            const summary = window.awaySummary.getSummary();
            toolResultStr = summary || 'No actions occurred while you were away.';
        }
        else if (type === 'structured_output') {
            const result = window.structuredOutput.validate(act.data || {}, act.schema || null);
            toolResultStr = result.valid
                ? `Structured output validated: ${JSON.stringify(result.data).substring(0, 500)}`
                : `Validation failed: ${result.error}`;
        }

        // ===================================================================
        // WIRED: Cost Tracker
        // ===================================================================
        else if (type === 'cost_report') {
            toolResultStr = window.costTracker.getReport();
        }
        else if (type === 'cost_status') {
            toolResultStr = window.costTracker.getStatusLine();
        }
        // ===================================================================
        // WIRED: Session Memory
        // ===================================================================
        else if (type === 'session_memory_inject') {
            await window.sessionMemory.injectAtStart();
            toolResultStr = 'Session memories injected.';
        }
        // ===================================================================
        // WIRED: Prompt Suggestion
        // ===================================================================
        else if (type === 'suggest_next') {
            const suggestion = await window.promptSuggestion.generate();
            toolResultStr = suggestion ? 'Suggested: "' + suggestion + '"' : 'No suggestion available.';
        }
        // ===================================================================
        // WIRED: AutoDream
        // ===================================================================
        else if (type === 'dream') {
            await window.autoDream.run();
            toolResultStr = 'Memory consolidation triggered.';
        }
        // ===================================================================
        // WIRED: MagicDocs
        // ===================================================================
        else if (type === 'magic_docs_update') {
            await window.magicDocs.updateAll();
            toolResultStr = 'Magic docs updated (' + window.magicDocs.trackedDocs.size + ' tracked docs).';
        }
        // ===================================================================
        // WIRED: Tool Use Summary
        // ===================================================================
        else if (type === 'tool_usage_report') {
            toolResultStr = window.toolUseSummary.getReport();
        }
        // ===================================================================
        // WIRED: Diagnostic Tracking
        // ===================================================================
        else if (type === 'diagnostic_snapshot') {
            const snap = window.diagnosticTracker.takeSnapshot(act.label || 'snapshot');
            toolResultStr = 'Diagnostic snapshot: ' + snap.errors + ' errors, ' + snap.warnings + ' warnings.';
        }
        else if (type === 'diagnostic_compare') {
            const cmp = window.diagnosticTracker.compare();
            toolResultStr = cmp ? ('Before: ' + cmp.before.errors + 'E/' + cmp.before.warnings + 'W -> After: ' + cmp.after.errors + 'E/' + cmp.after.warnings + 'W (delta: ' + cmp.delta.errors + 'E)') : 'Need at least 2 snapshots.';
        }
        // ===================================================================
        // WIRED: Prevent Sleep
        // ===================================================================
        else if (type === 'prevent_sleep') {
            if (act.enable !== false) { await window.preventSleep.start(); toolResultStr = 'Sleep prevention ON.'; }
            else { window.preventSleep.stop(); toolResultStr = 'Sleep prevention OFF.'; }
        }
        // ===================================================================
        // WIRED: Agent Summary
        // ===================================================================
        else if (type === 'agent_summary') {
            const summary = window.agentSummary.generate(window.chatHistory);
            toolResultStr = summary.summary + '\nTop tools: ' + summary.topTools.map(function (t) { return t[0] + ':' + t[1]; }).join(', ');
        }
        // ===================================================================
        // ===================================================================
        // WIRED: New Claude Code Parity Features (v2)
        // ===================================================================

        // ═══ CRON v2 ═══
        else if (type === 'cron_create') {
            try {
                var cronResult = await window.cronScheduler.create(act.name || act.prompt, act.schedule || act.cron, act);
                toolResultStr = 'Cron job created: ' + cronResult.id + ' (' + (act.schedule || act.cron) + ')';
            } catch (e) { toolResultStr = 'cron_create failed: ' + e.message; }
        }
        else if (type === 'cron_delete') {
            try {
                var cronDel = window.cronScheduler.delete(act.job_id || act.name);
                toolResultStr = 'Cron deleted: ' + cronDel.name;
            } catch (e) { toolResultStr = 'cron_delete failed: ' + e.message; }
        }
        else if (type === 'cron_list') {
            var cronJobs = window.cronScheduler.list();
            toolResultStr = cronJobs.length > 0 ? JSON.stringify(cronJobs, null, 2) : 'No cron jobs.';
        }

        // ═══ WORKTREE v2 ═══
        else if (type === 'enter_worktree' || type === 'worktree_create') {
            try {
                var wtRes = await window.worktreeManager.enter(act.branch || act.name, currentLoopAppId);
                toolResultStr = wtRes.error ? 'Worktree failed: ' + wtRes.error : wtRes.message;
            } catch (e) { toolResultStr = 'enter_worktree failed: ' + e.message; }
        }
        else if (type === 'exit_worktree' || type === 'worktree_exit') {
            try {
                var wtExit = await window.worktreeManager.exit({ merge: act.merge !== false });
                toolResultStr = wtExit.error ? 'exit_worktree failed: ' + wtExit.error : 'Worktree ' + wtExit.status + ': ' + wtExit.branch;
            } catch (e) { toolResultStr = 'exit_worktree failed: ' + e.message; }
        }

        // ═══ PLAN MODE v2 ═══
        else if (type === 'enter_plan_mode') {
            var pmResult = window.planMode.enter();
            toolResultStr = 'Plan mode ' + pmResult.status + '. Only read/analysis tools allowed. ' + pmResult.blockedCount + ' destructive tools blocked.';
        }
        else if (type === 'exit_plan_mode') {
            var pmExit = window.planMode.exit();
            toolResultStr = 'Plan mode ' + pmExit.status + '. All tools unlocked.';
        }

        // ═══ THINKING MODE ═══
        else if (type === 'enable_thinking') {
            var thinkRes = window.thinkingMode.enable(act.mode || 'extended', act.budget || 10000);
            toolResultStr = 'Thinking mode ' + thinkRes.mode + ' enabled. Budget: ' + thinkRes.budget + ' tokens.';
        }
        else if (type === 'disable_thinking') {
            window.thinkingMode.disable();
            toolResultStr = 'Thinking mode disabled.';
        }

        // ═══ POWERSHELL ═══
        else if (type === 'powershell') {
            try {
                var psCmd = act.command || act.script || '';
                var psRes = await fetch('http://127.0.0.1:5000/api/terminal', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        command: 'powershell -NoProfile -Command "' + psCmd.replace(/"/g, '\\"') + '"',
                        session_id: act.session_id || 'ps_' + Date.now()
                    })
                });
                var psData = await psRes.json();
                toolResultStr = psData.output || psData.message || JSON.stringify(psData);
                if (window.appendToolMessage) window.appendToolMessage('powershell', psData.status || 'success', 'PS> ' + psCmd.substring(0, 60));
            } catch (e) { toolResultStr = 'PowerShell error: ' + e.message; }
        }

        // ═══ NOTEBOOK ═══
        else if (type === 'notebook_read') {
            try {
                var nb = await window.notebookTool.readNotebook(act.file);
                toolResultStr = JSON.stringify(nb, null, 2);
                if (window.appendToolMessage) window.appendToolMessage('notebook_read', 'success', nb.totalCells + ' cells');
            } catch (e) { toolResultStr = 'notebook_read failed: ' + e.message; }
        }
        else if (type === 'notebook_edit') {
            try {
                var nbEdit = await window.notebookTool.editCell(act.file, act.cell_index, act.source);
                toolResultStr = 'Cell ' + nbEdit.cell + ' updated (' + nbEdit.type + ')';
                if (window.appendToolMessage) window.appendToolMessage('notebook_edit', 'success', 'Cell ' + nbEdit.cell + ' edited');
            } catch (e) { toolResultStr = 'notebook_edit failed: ' + e.message; }
        }
        else if (type === 'notebook_add_cell') {
            try {
                var nbAdd = await window.notebookTool.addCell(act.file, act.after_index, act.cell_type, act.source);
                toolResultStr = 'Cell added at index ' + nbAdd.insertedAt + ' (' + nbAdd.type + '). Total: ' + nbAdd.totalCells;
            } catch (e) { toolResultStr = 'notebook_add_cell failed: ' + e.message; }
        }
        else if (type === 'notebook_delete_cell') {
            try {
                var nbDel = await window.notebookTool.deleteCell(act.file, act.cell_index);
                toolResultStr = 'Cell ' + nbDel.deletedCell + ' deleted. Remaining: ' + nbDel.remainingCells;
            } catch (e) { toolResultStr = 'notebook_delete_cell failed: ' + e.message; }
        }

        // ═══ SYNTHETIC OUTPUT ═══
        else if (type === 'synthetic_output') {
            try {
                var fmt = act.format || 'json';
                var data = act.data;
                if (fmt === 'json') toolResultStr = JSON.stringify(data, null, 2);
                else if (fmt === 'csv') {
                    if (Array.isArray(data) && data.length > 0) {
                        var headers = Object.keys(data[0]);
                        toolResultStr = headers.join(',') + '\n' + data.map(function (row) {
                            return headers.map(function (h) { return String(row[h] || '').replace(/,/g, ';'); }).join(',');
                        }).join('\n');
                    } else toolResultStr = JSON.stringify(data);
                }
                else if (fmt === 'xml') {
                    toolResultStr = '<data>' + JSON.stringify(data).replace(/[{}"]/g, '') + '</data>';
                }
                else toolResultStr = JSON.stringify(data, null, 2);
                if (window.appendToolMessage) window.appendToolMessage('synthetic_output', 'success', fmt.toUpperCase() + ' output generated');
            } catch (e) { toolResultStr = 'synthetic_output failed: ' + e.message; }
        }

        // ═══ SEND MESSAGE (Inter-Agent) ═══
        else if (type === 'send_message') {
            if (window.agentMessaging) {
                window.agentMessaging.send(act.from || 'main', act.to, { type: act.type || 'info', content: act.message });
                toolResultStr = 'Message sent to ' + act.to;
            } else { toolResultStr = 'agentMessaging not loaded'; }
        }
        else if (type === 'broadcast_message') {
            if (window.agentMessaging) {
                window.agentMessaging.broadcast(act.from || 'main', { type: act.type || 'info', content: act.message });
                toolResultStr = 'Message broadcast to all agents';
            } else { toolResultStr = 'agentMessaging not loaded'; }
        }

        // ═══ BRIEF ═══
        else if (type === 'brief') {
            var text = act.text || act.content || '';
            var maxLen = act.max_length || 500;
            toolResultStr = text.length > maxLen ? text.substring(0, maxLen) + '...' : text;
        }

        // ═══ REMOTE SESSION ═══
        else if (type === 'remote_start') {
            var rmStart = await window.remoteSession.startServer(act.port);
            toolResultStr = JSON.stringify(rmStart);
        }
        else if (type === 'remote_stop') {
            var rmStop = await window.remoteSession.stopServer();
            toolResultStr = rmStop.status;
        }
        else if (type === 'remote_share') {
            var rmShare = window.remoteSession.shareSession(act.session_id);
            toolResultStr = 'Share URL: ' + rmShare.url + ' (expires: ' + rmShare.expiresIn + ')';
        }

        // ═══ ULTRAPLAN ═══
        else if (type === 'ultraplan_start') {
            var upStart = window.ultraPlan.start(act.goal);
            toolResultStr = upStart.error ? upStart.error : upStart.systemPrompt;
        }
        else if (type === 'advance_plan') {
            var upAdv = window.ultraPlan.advancePhase(act.data || act);
            toolResultStr = upAdv.systemPrompt || JSON.stringify(upAdv);
        }
        else if (type === 'cancel_plan') {
            var upCancel = window.ultraPlan.cancel(act.reason);
            toolResultStr = 'Plan ' + upCancel.status;
        }

        // ═══ INSIGHTS ═══
        else if (type === 'insights' || type === 'get_insights') {
            var report = await window.insightsDashboard.generateReport();
            toolResultStr = report;
        }

        // ═══ PLUGIN v2 ═══
        else if (type === 'plugin_install') {
            var piRes = await window.pluginManager.install(act.plugin_id, act.source);
            toolResultStr = piRes.error ? 'Install failed: ' + piRes.error : 'Installed: ' + piRes.name + ' v' + piRes.version;
        }
        else if (type === 'plugin_uninstall') {
            var puRes = await window.pluginManager.uninstall(act.plugin_id);
            toolResultStr = puRes.status + ': ' + (puRes.name || act.plugin_id);
        }
        else if (type === 'plugin_enable') {
            var peRes = await window.pluginManager.enable(act.plugin_id);
            toolResultStr = peRes.status || peRes.error;
        }
        else if (type === 'plugin_disable') {
            var pdRes = await window.pluginManager.disable(act.plugin_id);
            toolResultStr = pdRes.status || pdRes.error;
        }
        else if (type === 'plugin_load') {
            var pl = await window.pluginManager.install(act.plugin_id, act.source);
            toolResultStr = pl.error ? ('plugin_load failed: ' + pl.error) : ('Plugin loaded: ' + pl.name);
        }
        else if (type === 'plugin_unload') {
            var pu = await window.pluginManager.uninstall(act.plugin_id);
            toolResultStr = pu.error ? ('plugin_unload failed: ' + pu.error) : 'Plugin unloaded.';
        }
        else if (type === 'plugin_list') {
            var pls = window.pluginManager.list();
            toolResultStr = pls.length > 0 ? JSON.stringify(pls, null, 2) : 'No plugins.';
        }

        // ═══ TEAM MEMORY ═══
        else if (type === 'team_sync') {
            var tmSync = await window.teamMemory.sync(act.team_id);
            toolResultStr = JSON.stringify(tmSync);
        }
        else if (type === 'team_share_memory') {
            var tmShare = await window.teamMemory.share(act.memory_id, act.team_id);
            toolResultStr = tmShare.status || tmShare.error;
        }

        // ═══ SETTINGS SYNC ═══
        else if (type === 'settings_push') {
            var ssPush = await window.settingsSync.push();
            toolResultStr = ssPush.status + ': ' + (ssPush.count || 0) + ' settings';
        }
        else if (type === 'settings_pull') {
            var ssPull = await window.settingsSync.pull();
            toolResultStr = ssPull.status + ': ' + (ssPull.applied || 0) + ' settings applied';
        }

        // ═══ REMOTE TRIGGER ═══
        else if (type === 'remote_trigger') {
            try {
                var rtRes = await window.remoteTrigger.fire(act.name, act.params);
                toolResultStr = JSON.stringify(rtRes);
            } catch (e) { toolResultStr = 'remote_trigger failed: ' + e.message; }
        }

        // ═══ x402 PAYMENT ═══
        else if (type === 'x402_pay') {
            var payRes = await window.x402.pay(act.amount, act.recipient, act.reason);
            toolResultStr = payRes.error ? payRes.error : 'Paid $' + act.amount + '. Balance: $' + payRes.balanceAfter;
        }
        else if (type === 'x402_balance') {
            var balRes = window.x402.checkBalance();
            toolResultStr = 'Balance: $' + balRes.balance + ' (' + balRes.currency + ')';
        }

        // ═══ QR CODE ═══
        else if (type === 'qr_session') {
            var qrRes = window.qrGenerator.showSessionQR(act.session_id);
            toolResultStr = 'QR code displayed for session sharing.';
        }

        // ═══ EXISTING TOOLS (Telemetry, LSP) ═══
        else if (type === 'telemetry_report') {
            var rpt = window.telemetry.getReport();
            toolResultStr = 'Telemetry: ' + rpt.spans.total + ' spans, ' + rpt.logs.errors + ' errors, avg ' + rpt.spans.avgDurationMs + 'ms';
        }
        else if (type === 'voice_start') {
            var vr = window.voiceInput.start(act.language);
            toolResultStr = vr.error ? ('voice_start failed: ' + vr.error) : 'Voice input started.';
        }
        else if (type === 'voice_stop') {
            var vs = window.voiceInput.stop();
            toolResultStr = 'Voice stopped. Transcript: ' + (vs.transcript || '').substring(0, 200);
        }
        else if (type === 'find_definition') {
            var defs = window.lspLite.findDefinition(act.file_content || '', act.symbol || '');
            toolResultStr = defs.length > 0 ? defs.map(function (d) { return 'L' + d.line + ': ' + d.content; }).join('\n') : 'Not found.';
        }
        else if (type === 'find_references') {
            var refs = window.lspLite.findReferences(act.file_content || '', act.symbol || '');
            toolResultStr = refs.length > 0 ? refs.slice(0, 15).map(function (r) { return 'L' + r.line + ': ' + r.content; }).join('\n') : 'Not found.';
        }
        else if (type === 'document_symbols') {
            var syms = window.lspLite.getSymbols(act.file_content || '', act.language || 'javascript');
            toolResultStr = syms.length > 0 ? syms.slice(0, 20).map(function (s) { return s.kind + ' ' + s.name + ' L' + s.line; }).join('\n') : 'No symbols.';
        }
        else {
            toolResultStr = `Unknown action requested: ${type}`;
        }

        combinedToolResults.push(toolResultStr);
    }

    window.chatHistory.push({ role: 'system', content: combinedToolResults.join('\n') });
    if (window.saveChatHistory) window.saveChatHistory();

    if (requireUserInteraction) {
        return;
    } else if (hasToolExecution) {
        await new Promise(r => setTimeout(r, 1000));
        return await window.agentTick(provider, apiKey, outputType, currentLoopAppId, language, depth + 1);
    } else {
        return;
    }
};

window.sendMessage = async function () {
    if (window.isGenerating) {
        window.forceAbortAgent = true;
        return;
    }
    window.forceAbortAgent = false;

    // Reset KB/Tools search tracking for new task
    window._hasSearchedKB = false;
    window._hasSearchedTools = false;
    window._phase0Done = false;
    window._workspaceSnapshotInjected = false;

    const inputEl = window.getEl('chat-input');
    const text = inputEl.value.trim();

    if (!text && !window.pendingImageAttachment) return;

    const provider = window.getEl('select-provider').value;
    let apiKey = window.getEl('input-api-key').value.trim();
    const appId = window.getEl('input-app-name').value.trim() || 'ai-' + Date.now();
    const language = window.getEl('select-language').value;

    // Fallback: read from env loader if field is empty
    if (!apiKey && window.FLOWORKOS_Env) {
        apiKey = window.FLOWORKOS_Env.get('FLOWORK_AI_KEY', '');
        if (apiKey) { var k = window.getEl('input-api-key'); if (k) k.value = apiKey; }
    }
    if (!apiKey) {
        try { var s = JSON.parse(localStorage.getItem('flowork_builder_config') || '{}'); if (s.apiKey) apiKey = s.apiKey; } catch (e) { }
    }
    if (!apiKey) {
        if (window.appendToolMessage) window.appendToolMessage('System', 'error', 'API Key not found. Set FLOWORK_AI_KEY in .env');
        return;
    }

    const attachedImage = window.pendingImageAttachment;
    window.pendingImageAttachment = null;

    inputEl.value = '';
    const previewContainer = window.getEl('chat-image-preview');
    if (previewContainer) previewContainer.style.display = 'none';
    if (window.getEl('chat-image-upload')) window.getEl('chat-image-upload').value = '';

    if (window.appendChatMessage) window.appendChatMessage('user', text, attachedImage);

    window.chatHistory.push({ role: 'user', content: text, image: attachedImage });
    if (window.saveChatHistory) window.saveChatHistory();

    const btnSend = window.getEl('btn-send');
    btnSend.disabled = false;
    btnSend.classList.add('btn-send--stop');
    btnSend.innerHTML = '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>'

    window.isGenerating = true;
    if (window.saveConfigToEngine) window.saveConfigToEngine();

    let loaderId = null;
    if (window.showLoader) loaderId = window.showLoader();

    try {
        const outputType = window.getEl('select-output-type') ? window.getEl('select-output-type').value : 'app';
        // Invalidate cached prompt when mode changes
        if (window._lastOutputType !== outputType) {
            window.cachedSystemPrompt = null;
            window._lastOutputType = outputType;
        }
        await window.agentTick(provider, apiKey, outputType, appId, language, 0);
    } catch (err) {
        if (window.appendToolMessage) window.appendToolMessage('Engine Exception', 'error', err.message);
    } finally {
        if (window.removeLoader && loaderId) window.removeLoader(loaderId);
        window.isGenerating = false;
        const btnSendReset = window.getEl('btn-send');
        btnSendReset.classList.remove('btn-send--stop');
        btnSendReset.innerHTML = '<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>';
        setTimeout(() => inputEl.focus(), 100);
    }
};

window.executeCompilerFromUI = async function () {
    const appId = window.getEl('input-app-name').value.trim() || window.currentAppId;
    const lang = window.getEl('select-language') ? window.getEl('select-language').value : 'javascript';

    let entryFile = 'index.js';
    if (lang === 'python') entryFile = 'script.py';
    else if (lang === 'golang') entryFile = 'main.go';
    else if (lang === 'cpp') entryFile = 'main.cpp';

    const isApp = window.getEl('select-output-type') ? window.getEl('select-output-type').value === 'app' : true;
    const scriptPath = isApp ? `apps/${appId}/${entryFile}` : `nodes/${appId}/${entryFile}`;

    const btn = document.querySelector('button[onclick*="executeCompilerFromUI"]');
    if (btn) btn.innerHTML = 'â³ Compiling...';

    if (window.appendToolMessage) window.appendToolMessage('System', 'in_progress', `Manual Compile Triggered for ${appId} (${scriptPath})...`);
    try {
        const res = await fetch('http://127.0.0.1:5000/api/compile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ script_path: scriptPath, app_name: appId })
        });
        const data = await res.json();
        if (data.status === 'success') {
            if (window.appendToolMessage) window.appendToolMessage('System', 'success', `Successfully compiled to: ${data.compiled_file}`);
            alert(`Compilation Successful!\nSaved to: ${data.compiled_file}`);
        } else {
            if (window.appendToolMessage) window.appendToolMessage('System', 'error', data.error);
            alert(`Compilation Failed!\n${data.error}`);
        }
    } catch (e) {
        if (window.appendToolMessage) window.appendToolMessage('System', 'error', `Failed to contact compiler: ${e.message}`);
        alert(`Compilation Failed!\n${e.message}`);
    } finally {
        if (btn) btn.innerHTML = 'ðŸ“¦ Build .EXE';
    }
};
