// =========================================================================
// FLOWORK OS - CLAUDE CODE FULL PARITY v2
// FILE: agent_session_memory.js
// DESCRIPTION: Cross-Session Context Injection + AutoDream Consolidation
//              + Prompt Suggestion + MagicDocs (KB-based) + Prevent Sleep
//              + SESSION PERSISTENCE (Resume/Restore)
//              Ported from Claude Code's SessionMemory/, autoDream/, PromptSuggestion/
// =========================================================================
// =========================================================================

// ═══════════════════════════════════════════════════════════════════════
// 1. SESSION MEMORY — Inject relevant past memories at session start
// ═══════════════════════════════════════════════════════════════════════
window.sessionMemory = {
    maxMemories: 10,
    injected: false,

    // Load and inject memories at session start
    injectAtStart: async function() {
        if (this.injected) return;
        this.injected = true;

        try {
            // Get current context clues
            const appId = window.currentAppId || '';
            const lastUserMsg = (window.chatHistory || [])
                .filter(m => m.role === 'user')
                .pop();
            const query = lastUserMsg?.content || appId || 'recent project context';

            // Search KB for relevant memories
            const res = await fetch('http://127.0.0.1:5000/api/knowledge/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: query.substring(0, 200), limit: this.maxMemories })
            });

            if (!res.ok) return;
            const data = await res.json();
            const memories = data.results || data.data || [];

            if (memories.length === 0) return;

            // Build session context block
            let context = '=== SESSION MEMORY (from past conversations) ===\n';
            context += window.MEMORY_DRIFT_CAVEAT || '';
            context += '\n\n';

            for (const mem of memories.slice(0, this.maxMemories)) {
                const title = mem.title || mem.name || 'Memory';
                const content = (mem.content || mem.summary || '').substring(0, 300);
                const type = title.match(/\[AUTO:(\w+)\]/)?.[1] || 'general';
                context += `[${type}] ${title}\n${content}\n---\n`;
            }

            // Inject as first system message
            window.chatHistory.unshift({
                role: 'system',
                content: context
            });

            console.log(`[SessionMemory] 🧠 Injected ${memories.length} memories from past sessions`);
            if (window.appendToolMessage) {
                window.appendToolMessage('SessionMemory', 'success',
                    `🧠 ${memories.length} past memories loaded`);
            }
        } catch(e) {
            console.warn('[SessionMemory] Failed to load:', e.message);
        }
    },

    // Reset for new conversation
    reset: function() {
        this.injected = false;
    }
};

// ═══════════════════════════════════════════════════════════════════════
// 2. PROMPT SUGGESTION — Predict what user will type next
// ═══════════════════════════════════════════════════════════════════════
window.promptSuggestion = {
    enabled: true,
    currentSuggestion: null,
    abortController: null,

    // Generate suggestion after AI finishes responding
    generate: async function() {
        if (!this.enabled || window.isGenerating) return null;

        // Need at least 2 AI turns to suggest meaningfully
        const assistantTurns = window.chatHistory.filter(m => m.role === 'assistant').length;
        if (assistantTurns < 2) return null;

        // Get last few messages for context
        const recentMsgs = window.chatHistory.slice(-6);
        const lastAssistant = recentMsgs.filter(m => m.role === 'assistant').pop();
        const lastContent = typeof lastAssistant?.content === 'string'
            ? lastAssistant.content : '';

        // Rule-based fast suggestions (no API call needed)
        const fastSuggestion = this._fastSuggest(lastContent, recentMsgs);
        if (fastSuggestion) {
            this.currentSuggestion = fastSuggestion;
            this._showInUI(fastSuggestion);
            return fastSuggestion;
        }

        // LLM-powered suggestion (forked, low-cost)
        try {
            const provider = document.getElementById('select-provider')?.value;
            const apiKey = document.getElementById('input-api-key')?.value;
            if (!apiKey) return null;

            const summaryPrompt = `Look at the conversation. Predict what the user will type next in 2-12 words.
Rules:
- Be specific: "run the tests" beats "continue"
- Match user's language style
- Never suggest evaluative phrases like "looks good" or "thanks"
- If the next step isn't obvious, return NOTHING

Recent conversation:
${recentMsgs.map(m => `[${m.role}]: ${(typeof m.content === 'string' ? m.content : '').substring(0, 200)}`).join('\n')}

Reply with ONLY the suggestion, no quotes.`;

            const res = await window.callLLMAPI(provider, null, apiKey, [
                { role: 'user', content: summaryPrompt }
            ], { maxTokens: 30, temperature: 0.3 });

            if (res?.text) {
                let suggestion = res.text.trim().replace(/^["']|["']$/g, '');
                if (suggestion.length > 2 && suggestion.length < 100 && !this._shouldFilter(suggestion)) {
                    this.currentSuggestion = suggestion;
                    this._showInUI(suggestion);
                    return suggestion;
                }
            }
        } catch(e) {
            // Silent fail — suggestions are best-effort
        }

        return null;
    },

    // Fast rule-based suggestions (zero API cost)
    _fastSuggest: function(lastResponse, messages) {
        const lower = lastResponse.toLowerCase();
        const lastUserMsg = messages.filter(m => m.role === 'user').pop();
        const userContent = (typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '').toLowerCase();

        // After code written successfully → suggest running
        if (lower.includes('[task_complete]') && lower.includes('write_files')) return 'run the app';
        // After error fix → suggest testing
        if (lower.includes('fixed') && lower.includes('error')) return 'test it again';
        // After build → suggest deploy
        if (lower.includes('compiled') || lower.includes('build success')) return 'deploy it';
        // Multi-part request, only first done
        if (userContent.includes(' and ') && !lower.includes('[task_complete]')) return 'continue with the next step';
        // AI asks question → suggest answering
        if (lower.includes('?') && lower.includes('would you like')) return 'yes, go ahead';
        // After tests pass
        if (lower.includes('tests passed') || lower.includes('all green')) return 'commit the changes';

        return null;
    },

    // Filter bad suggestions
    _shouldFilter: function(suggestion) {
        const lower = suggestion.toLowerCase();
        const filters = [
            /^(thanks|thank you|looks good|sounds good|that works|nice|great|perfect|awesome)/,
            /^(let me|i'll|i've|here's|this is|you can|you should)/,
            /nothing|silence|no suggestion/,
            /^\(.*\)$/, // wrapped in parens
        ];
        return filters.some(f => f.test(lower)) || suggestion.split(/\s+/).length > 12;
    },

    // Show suggestion in UI (ghost text in input)
    _showInUI: function(suggestion) {
        const chatInput = document.getElementById('chat-input');
        if (chatInput && !chatInput.value.trim()) {
            chatInput.setAttribute('placeholder', `💡 ${suggestion} (Tab to accept)`);
            chatInput.dataset.suggestion = suggestion;
        }
    },

    // Accept suggestion (called by Tab key handler)
    accept: function() {
        const chatInput = document.getElementById('chat-input');
        if (chatInput && chatInput.dataset.suggestion) {
            chatInput.value = chatInput.dataset.suggestion;
            chatInput.removeAttribute('data-suggestion');
            chatInput.placeholder = 'Describe what to build or fix...';
            this.currentSuggestion = null;
            return true;
        }
        return false;
    },

    // Clear current suggestion
    clear: function() {
        this.currentSuggestion = null;
        const chatInput = document.getElementById('chat-input');
        if (chatInput) {
            chatInput.removeAttribute('data-suggestion');
            chatInput.placeholder = 'Describe what to build or fix...';
        }
    }
};

// Tab key handler for prompt suggestion
document.addEventListener('keydown', function(e) {
    if (e.key === 'Tab') {
        const chatInput = document.getElementById('chat-input');
        if (chatInput && document.activeElement === chatInput && chatInput.dataset.suggestion) {
            e.preventDefault();
            window.promptSuggestion.accept();
        }
    }
});

// ═══════════════════════════════════════════════════════════════════════
// 2.5 SESSION PERSISTENCE — Save, Restore, List, AutoSave
// Claude Code: session resume/restore parity
// ═══════════════════════════════════════════════════════════════════════
window.sessionPersistence = {
    sessionsDir: 'hystory-chat',
    currentSessionId: null,
    autoSaveInterval: null,
    autoSaveMs: 30000, // 30 seconds
    isDirty: false,

    // Generate session ID
    _genId: function() {
        const now = new Date();
        const date = now.toISOString().split('T')[0];
        const time = now.toTimeString().split(' ')[0].replace(/:/g, '-');
        return `session_${date}_${time}_${Math.random().toString(36).substr(2, 4)}`;
    },

    // Initialize current session
    init: function() {
        if (!this.currentSessionId) {
            this.currentSessionId = this._genId();
        }
        this.startAutoSave();
        console.log(`[Session] 💾 Session initialized: ${this.currentSessionId}`);
    },

    // Save current session state to disk
    save: async function(label) {
        if (!this.currentSessionId) this.init();

        const state = {
            id: this.currentSessionId,
            label: label || `Session ${new Date().toLocaleString()}`,
            savedAt: new Date().toISOString(),
            appId: window.currentAppId || 'unknown',
            aiMode: window.activeAIMode || 'main',
            chatHistory: window.chatHistory || [],
            generatedFiles: window.generatedFiles || {},
            roadmap: window.roadmap || [],
            activeTab: window.activeTab || '__ROADMAP__',
            // Cost state
            costState: window.costTracker ? {
                totalInputTokens: window.costTracker.totalInputTokens,
                totalOutputTokens: window.costTracker.totalOutputTokens,
                totalCostUSD: window.costTracker.totalCostUSD,
                byModel: window.costTracker.byModel
            } : null,
            // Progress
            progressLog: window.progressLog || [],
            // Skills used
            toolStats: window.toolUseSummary?.stats || {},
            // Metadata
            messageCount: (window.chatHistory || []).length,
            userMessageCount: (window.chatHistory || []).filter(m => m.role === 'user').length
        };

        try {
            const path = `${this.sessionsDir}/${this.currentSessionId}.json`;
            await fetch('http://127.0.0.1:5000/api/fs/write', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path, content: JSON.stringify(state, null, 2) })
            });
            this.isDirty = false;
            console.log(`[Session] 💾 Saved: ${path} (${state.messageCount} msgs, ${Object.keys(state.generatedFiles).length} files)`);
            return { status: 'saved', id: this.currentSessionId, path };
        } catch(e) {
            console.warn('[Session] Failed to save:', e.message);
            return { error: e.message };
        }
    },

    // Restore a session from disk
    restore: async function(sessionId) {
        try {
            const path = `${this.sessionsDir}/${sessionId}.json`;
            const res = await fetch('http://127.0.0.1:5000/api/fs/read', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path })
            });
            if (!res.ok) return { error: 'Session file not found' };
            const data = await res.json();
            const state = JSON.parse(data.content || data.data || '{}');

            if (!state.chatHistory) return { error: 'Invalid session data' };

            // Restore state
            window.chatHistory = state.chatHistory;
            window.generatedFiles = state.generatedFiles || {};
            window.roadmap = state.roadmap || [];
            window.activeTab = state.activeTab || '__ROADMAP__';
            window.progressLog = state.progressLog || [];

            // Restore cost tracker
            if (state.costState && window.costTracker) {
                window.costTracker.totalInputTokens = state.costState.totalInputTokens || 0;
                window.costTracker.totalOutputTokens = state.costState.totalOutputTokens || 0;
                window.costTracker.totalCostUSD = state.costState.totalCostUSD || 0;
                window.costTracker.byModel = state.costState.byModel || {};
            }

            // Restore tool stats
            if (state.toolStats && window.toolUseSummary) {
                window.toolUseSummary.stats = state.toolStats;
            }

            // Set AI mode
            if (state.aiMode && window.setAIMode) {
                window.setAIMode(state.aiMode);
            }

            // Update session ID
            this.currentSessionId = state.id;

            // Refresh UI
            if (window.renderRoadmap) window.renderRoadmap();
            if (window.renderChatHistory) window.renderChatHistory();

            console.log(`[Session] ♻️ Restored: ${sessionId} (${state.messageCount} msgs)`);
            if (window.appendToolMessage) {
                window.appendToolMessage('Session', 'success', `♻️ Restored: ${state.label || sessionId}`);
            }
            return {
                status: 'restored',
                id: state.id,
                label: state.label,
                messageCount: state.messageCount,
                appId: state.appId
            };
        } catch(e) {
            console.warn('[Session] Failed to restore:', e.message);
            return { error: e.message };
        }
    },

    // List all saved sessions
    listSessions: async function() {
        try {
            const res = await fetch('http://127.0.0.1:5000/api/fs/list', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: this.sessionsDir })
            });
            if (!res.ok) return [];
            const data = await res.json();
            const files = (data.files || data.data || []).filter(f =>
                (f.name || f).endsWith('.json') && (f.name || f).startsWith('session_')
            );

            // Load metadata from each session file
            const sessions = [];
            for (const file of files.slice(-20)) { // Last 20 sessions
                const name = file.name || file;
                try {
                    const fRes = await fetch('http://127.0.0.1:5000/api/fs/read', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: `${this.sessionsDir}/${name}` })
                    });
                    if (!fRes.ok) continue;
                    const fData = await fRes.json();
                    const parsed = JSON.parse(fData.content || fData.data || '{}');
                    sessions.push({
                        id: parsed.id || name.replace('.json', ''),
                        label: parsed.label || name,
                        savedAt: parsed.savedAt,
                        appId: parsed.appId,
                        messageCount: parsed.messageCount || 0,
                        userMessageCount: parsed.userMessageCount || 0,
                        cost: parsed.costState?.totalCostUSD || 0
                    });
                } catch(e) {}
            }

            return sessions.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
        } catch(e) {
            console.warn('[Session] Failed to list:', e.message);
            return [];
        }
    },

    // Delete a session
    deleteSession: async function(sessionId) {
        try {
            await fetch('http://127.0.0.1:5000/api/fs/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: `${this.sessionsDir}/${sessionId}.json` })
            });
            return { status: 'deleted', id: sessionId };
        } catch(e) {
            return { error: e.message };
        }
    },

    // Start auto-save
    startAutoSave: function() {
        if (this.autoSaveInterval) return;
        this.autoSaveInterval = setInterval(() => {
            // Only save if there's been activity
            if (this.isDirty && window.chatHistory && window.chatHistory.length > 2) {
                this.save().catch(() => {});
            }
        }, this.autoSaveMs);
        console.log(`[Session] ⏰ Auto-save every ${this.autoSaveMs / 1000}s`);
    },

    // Stop auto-save
    stopAutoSave: function() {
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
            this.autoSaveInterval = null;
        }
    },

    // Mark as dirty (something changed)
    markDirty: function() {
        this.isDirty = true;
    }
};

// Initialize session persistence
setTimeout(() => window.sessionPersistence.init(), 3000);

// ═══════════════════════════════════════════════════════════════════════
// 3. AUTODREAM — Background Memory Consolidation
// ═══════════════════════════════════════════════════════════════════════
window.autoDream = {
    enabled: true,
    minHours: 24,
    minSessions: 3,
    lastConsolidatedAt: 0,
    isRunning: false,

    init: function() {
        try {
            this.lastConsolidatedAt = parseInt(localStorage.getItem('flowork_last_dream') || '0');
        } catch(e) {}
    },

    shouldRun: function() {
        if (this.isRunning || !this.enabled) return false;
        const hoursSince = (Date.now() - this.lastConsolidatedAt) / 3_600_000;
        return hoursSince >= this.minHours;
    },

    run: async function() {
        if (!this.shouldRun()) return;
        this.isRunning = true;

        console.log('[AutoDream] 🌙 Starting background memory consolidation...');
        if (window.appendToolMessage) {
            window.appendToolMessage('AutoDream', 'in_progress', '🌙 Consolidating memories...');
        }

        try {
            // Fetch all auto-extracted memories
            const res = await fetch('http://127.0.0.1:5000/api/knowledge/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: '[AUTO:', limit: 50 })
            });

            if (!res.ok) return;
            const data = await res.json();
            const memories = data.results || data.data || [];

            if (memories.length < 5) {
                console.log('[AutoDream] Not enough memories to consolidate');
                return;
            }

            // Group by type
            const byType = {};
            for (const mem of memories) {
                const typeMatch = (mem.title || '').match(/\[AUTO:(\w+)\]/);
                const type = typeMatch ? typeMatch[1] : 'general';
                if (!byType[type]) byType[type] = [];
                byType[type].push(mem);
            }

            // Use LLM to consolidate each type
            const provider = document.getElementById('select-provider')?.value;
            const apiKey = document.getElementById('input-api-key')?.value;

            if (!apiKey) return;

            for (const [type, mems] of Object.entries(byType)) {
                if (mems.length < 2) continue;

                const memText = mems.map(m =>
                    `- ${m.title}: ${(m.content || '').substring(0, 200)}`
                ).join('\n');

                const consolidatePrompt = `Consolidate these ${type} memories into 1-3 key insights. Remove duplicates. Keep only actionable, specific information.

Memories:
${memText.substring(0, 5000)}

Output format:
- [insight 1]
- [insight 2]
- [insight 3]

Be extremely concise. Max 200 words.`;

                try {
                    const result = await window.callLLMAPI(provider, null, apiKey, [
                        { role: 'user', content: consolidatePrompt }
                    ], { maxTokens: 300, temperature: 0.1 });

                    if (result?.text) {
                        // Save consolidated memory
                        await fetch('http://127.0.0.1:5000/api/knowledge', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                title: `[DREAM:${type}] Consolidated ${mems.length} memories`,
                                content: result.text,
                                category: type
                            })
                        });
                        console.log(`[AutoDream] 🌙 Consolidated ${mems.length} ${type} memories`);
                    }
                } catch(e) {
                    console.warn(`[AutoDream] Failed to consolidate ${type}:`, e.message);
                }
            }

            // Update timestamp
            this.lastConsolidatedAt = Date.now();
            try { localStorage.setItem('flowork_last_dream', String(this.lastConsolidatedAt)); } catch(e) {}

            console.log('[AutoDream] 🌙 Consolidation complete!');
            if (window.appendToolMessage) {
                window.appendToolMessage('AutoDream', 'success',
                    `🌙 Consolidated ${memories.length} memories across ${Object.keys(byType).length} types`);
            }

        } catch(e) {
            console.error('[AutoDream] Failed:', e);
            // IMPORTANT: Mark as consolidated even on failure to prevent infinite retry
            this.lastConsolidatedAt = Date.now();
            try { localStorage.setItem('flowork_last_dream', String(this.lastConsolidatedAt)); } catch(x) {}
            if (window.appendToolMessage) {
                window.appendToolMessage('AutoDream', 'error', `❌ ${e.message || 'Failed — will retry in 24h'}`);
            }
        } finally {
            this.isRunning = false;
        }
    }
};

window.autoDream.init();

// ═══════════════════════════════════════════════════════════════════════
// 4. MAGIC DOCS — Auto-update KB articles (uses server KB + Tools)
// NOTE: Flowork uses KB on floworkos.com, NOT file-based docs
// ═══════════════════════════════════════════════════════════════════════
window.magicDocs = {
    trackedArticles: new Map(), // Map<articleId, metadata>
    MAGIC_TAG: 'magic-doc',

    // Track a KB article for auto-updates
    track: function(articleId, title) {
        this.trackedArticles.set(articleId, {
            id: articleId,
            title: title || articleId,
            lastUpdated: Date.now(),
            updateCount: 0
        });
        console.log(`[MagicDocs] 📄 Tracking KB article: ${articleId}`);
    },

    // Detect magic docs from KB search results
    detectFromKBResult: function(article) {
        if (!article) return false;
        const tags = article.tags || [];
        const title = (article.title || '').toLowerCase();
        if (tags.includes(this.MAGIC_TAG) || title.includes('magic doc')) {
            this.track(article.id, article.title);
            return true;
        }
        return false;
    },

    // Update tracked KB articles with new learnings
    updateAll: async function() {
        if (this.trackedArticles.size === 0) return;

        const provider = document.getElementById('select-provider')?.value;
        const apiKey = document.getElementById('input-api-key')?.value;
        if (!apiKey) return;

        const recentMsgs = (window.chatHistory || []).slice(-10);
        const contextText = recentMsgs.map(m =>
            `[${m.role}]: ${(typeof m.content === 'string' ? m.content : '').substring(0, 200)}`
        ).join('\n');

        for (const [articleId, docInfo] of this.trackedArticles) {
            try {
                // Read current KB article
                const res = await fetch('http://127.0.0.1:5000/api/knowledge/search', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ query: articleId, limit: 1 })
                });
                if (!res.ok) continue;
                const data = await res.json();
                const articles = data.results || data.data || [];
                const current = articles.find(a => a.id === articleId);
                if (!current) continue;

                const updatePrompt = `Review this KB article and the recent conversation. Extract any NEW learnings that should be added.
Title: ${current.title}
Current content: ${(current.content || '').substring(0, 2000)}
Recent context: ${contextText.substring(0, 2000)}

Rules:
- Only output NEW facts not already in the article
- Output as bullet points, one per line
- If nothing new, output NOTHING
- Max 3 new bullet points`;

                const result = await window.callLLMAPI(provider, null, apiKey, [
                    { role: 'user', content: updatePrompt }
                ], { maxTokens: 300, temperature: 0.1 });

                if (result?.text && result.text.trim().length > 5 && !result.text.toLowerCase().includes('nothing')) {
                    // Append to KB article via kb_update
                    await fetch('http://127.0.0.1:5000/api/knowledge', {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            id: articleId,
                            add_pattern: result.text.trim()
                        })
                    });
                    docInfo.lastUpdated = Date.now();
                    docInfo.updateCount++;
                    console.log(`[MagicDocs] 📄 Updated KB article: ${articleId}`);
                }
            } catch(e) {
                console.warn(`[MagicDocs] Failed to update ${articleId}:`, e.message);
            }
        }
    }
};

// ═══════════════════════════════════════════════════════════════════════
// 5. PREVENT SLEEP — Keep OS awake during long tasks
// ═══════════════════════════════════════════════════════════════════════
window.preventSleep = {
    active: false,
    wakeLock: null,

    start: async function() {
        if (this.active) return;
        this.active = true;

        // Method 1: Screen Wake Lock API (Chromium/Electron)
        try {
            if ('wakeLock' in navigator) {
                this.wakeLock = await navigator.wakeLock.request('screen');
                this.wakeLock.addEventListener('release', () => {
                    if (this.active) {
                        // Re-acquire if still needed
                        setTimeout(() => this.start(), 1000);
                    }
                });
                console.log('[PreventSleep] 🔋 Wake lock acquired');
                return;
            }
        } catch(e) {
            console.warn('[PreventSleep] Wake Lock API failed:', e.message);
        }

        // Method 2: Fallback — play silent audio to prevent sleep
        try {
            if (!this._audio) {
                this._audio = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=');
                this._audio.loop = true;
                this._audio.volume = 0.01;
            }
            await this._audio.play();
            console.log('[PreventSleep] 🔋 Audio fallback active');
        } catch(e) {
            console.warn('[PreventSleep] All methods failed');
        }
    },

    stop: function() {
        this.active = false;
        if (this.wakeLock) {
            this.wakeLock.release();
            this.wakeLock = null;
        }
        if (this._audio) {
            this._audio.pause();
        }
        console.log('[PreventSleep] 😴 Sleep allowed');
    }
};

// ═══════════════════════════════════════════════════════════════════════
// 6. AGENT SUMMARY — Post-task report for coordinator
// ═══════════════════════════════════════════════════════════════════════
window.agentSummary = {
    generate: function(chatHistory) {
        const userMsgs = chatHistory.filter(m => m.role === 'user');
        const assistantMsgs = chatHistory.filter(m => m.role === 'assistant');
        const systemMsgs = chatHistory.filter(m => m.role === 'system');

        const errors = systemMsgs.filter(m =>
            typeof m.content === 'string' && (m.content.includes('error') || m.content.includes('failed'))
        );

        // Extract tool usage
        const toolCounts = {};
        for (const msg of assistantMsgs) {
            const content = typeof msg.content === 'string' ? msg.content : '';
            const matches = content.match(/"action"\s*:\s*"(\w+)"/g) || [];
            for (const m of matches) {
                const tool = m.replace(/"action"\s*:\s*"/, '').replace('"', '');
                toolCounts[tool] = (toolCounts[tool] || 0) + 1;
            }
        }

        return {
            requestCount: userMsgs.length,
            responseCount: assistantMsgs.length,
            errorCount: errors.length,
            toolsUsed: toolCounts,
            topTools: Object.entries(toolCounts).sort((a, b) => b[1] - a[1]).slice(0, 5),
            summary: `${userMsgs.length} requests, ${assistantMsgs.length} responses, ${errors.length} errors, ${Object.keys(toolCounts).length} unique tools`
        };
    }
};

// ═══════════════════════════════════════════════════════════════════════
// 7. TOOL USE SUMMARY — Track tool usage stats
// ═══════════════════════════════════════════════════════════════════════
window.toolUseSummary = {
    stats: {},

    record: function(toolName, success, durationMs) {
        if (!this.stats[toolName]) {
            this.stats[toolName] = { calls: 0, successes: 0, failures: 0, totalDuration: 0 };
        }
        const s = this.stats[toolName];
        s.calls++;
        if (success) s.successes++; else s.failures++;
        s.totalDuration += (durationMs || 0);
    },

    getReport: function() {
        const entries = Object.entries(this.stats).sort((a, b) => b[1].calls - a[1].calls);
        if (entries.length === 0) return 'No tools used yet.';

        let report = `🔧 Tool Usage Summary (${entries.length} tools):\n`;
        for (const [name, s] of entries.slice(0, 15)) {
            const avgMs = s.calls > 0 ? Math.round(s.totalDuration / s.calls) : 0;
            const rate = s.calls > 0 ? Math.round(s.successes / s.calls * 100) : 0;
            report += `  ${name}: ${s.calls}x (${rate}% ok, avg ${avgMs}ms)\n`;
        }
        return report;
    },

    reset: function() { this.stats = {}; }
};

// ═══════════════════════════════════════════════════════════════════════
// 8. DIAGNOSTIC TRACKING — Error count before/after edits
// ═══════════════════════════════════════════════════════════════════════
window.diagnosticTracker = {
    snapshots: [],

    takeSnapshot: function(label) {
        const diagnostics = window.lspService ? window.lspService.getDiagnostics('') : [];
        const errorCount = diagnostics.filter(d => d.severity === 'error').length;
        const warnCount = diagnostics.filter(d => d.severity === 'warning').length;
        this.snapshots.push({
            label, time: Date.now(), errors: errorCount, warnings: warnCount
        });
        return { errors: errorCount, warnings: warnCount };
    },

    compare: function() {
        if (this.snapshots.length < 2) return null;
        const first = this.snapshots[0];
        const last = this.snapshots[this.snapshots.length - 1];
        return {
            before: { errors: first.errors, warnings: first.warnings },
            after: { errors: last.errors, warnings: last.warnings },
            delta: {
                errors: last.errors - first.errors,
                warnings: last.warnings - first.warnings
            },
            improved: last.errors < first.errors
        };
    },

    reset: function() { this.snapshots = []; }
};

// ═══════════════════════════════════════════════════════════════════════
// HOOKS — Wire everything into the agent lifecycle
// ═══════════════════════════════════════════════════════════════════════
window._sessionFeaturesHooked = false;
window.hookSessionFeatures = function() {
    if (window._sessionFeaturesHooked) return;
    window._sessionFeaturesHooked = true;

    // On session start: inject memories
    setTimeout(() => window.sessionMemory.injectAtStart(), 2000);

    // After each AI response: generate prompt suggestion + check autoDream
    setInterval(() => {
        if (!window.isGenerating && window._prevGenerating2) {
            // AI just finished
            if (window.promptSuggestion) setTimeout(() => window.promptSuggestion.generate().catch(()=>{}), 1500);
            if (window.autoDream && window.autoDream.shouldRun()) setTimeout(() => window.autoDream.run().catch(()=>{}), 5000);
            if (window.magicDocs) setTimeout(() => window.magicDocs.updateAll().catch(()=>{}), 8000);
            // Save cost
            if (window.costTracker) window.costTracker.save?.();
            // Mark session dirty for auto-save
            if (window.sessionPersistence) window.sessionPersistence.markDirty();
        }
        window._prevGenerating2 = window.isGenerating;
    }, 1000);

    // Prevent sleep while generating
    setInterval(() => {
        if (window.isGenerating && window.preventSleep && !window.preventSleep.active) {
            window.preventSleep.start();
        } else if (!window.isGenerating && window.preventSleep && window.preventSleep.active) {
            window.preventSleep.stop();
        }
    }, 2000);
};

setTimeout(() => window.hookSessionFeatures(), 4000);

console.log('[Flowork OS] ✅ Session Memory v2 + Persistence + Prompt Suggestion + AutoDream + MagicDocs(KB) + PreventSleep loaded');
