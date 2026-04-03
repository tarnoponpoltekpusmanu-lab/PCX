// =========================================================================
// FLOWORK OS - CLAUDE CODE FULL PARITY v2
// FILE: agent_memory.js
// DESCRIPTION: Structured Memory Types + LLM-Powered Compaction
//              + Auto-Memory Extraction + Micro-Compact
//              + Hierarchical Memory (FLOWORK.md) + Memory Aging
//              + Semantic Search (Claude Code memdir/ full parity)
// =========================================================================

// ─── STRUCTURED MEMORY TYPES (Claude Code parity) ────────────────────
window.MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'];

window.parseMemoryType = function(raw) {
    if (typeof raw !== 'string') return undefined;
    return window.MEMORY_TYPES.find(t => t === raw);
};

// ─── AUTO-MEMORY EXTRACTION ─────────────────────────────────────────
window.autoMemory = {
    enabled: true,
    lastExtractTurn: 0,
    extractEveryNTurns: 3,
    minNewMessages: 4,

    shouldExtract: function() {
        if (!this.enabled || window.isGenerating) return false;
        const turnsSinceLast = (window._tokenTracker?.apiCalls || 0) - this.lastExtractTurn;
        if (turnsSinceLast < this.extractEveryNTurns) return false;
        const newMsgCount = window.chatHistory.filter(m => m.role !== 'system').length;
        return newMsgCount >= this.minNewMessages;
    },

    // Extract memories with TYPED classification (Claude Code parity)
    extractFromConversation: async function() {
        if (!this.shouldExtract()) return;

        const recentMessages = window.chatHistory.slice(-12).filter(m => m.role !== 'system');
        if (recentMessages.length < 2) return;

        this.lastExtractTurn = window._tokenTracker?.apiCalls || 0;
        const memories = [];

        for (let i = 0; i < recentMessages.length; i++) {
            const msg = recentMessages[i];
            const next = recentMessages[i + 1];
            const content = typeof msg.content === 'string' ? msg.content : '';
            const contentLower = content.toLowerCase();

            // TYPE: user — Role, preferences, expertise
            if (msg.role === 'user') {
                const userPhrases = ['i am a', 'i\'m a', 'my role', 'i work on', 'i prefer',
                    'i like', 'i always', 'i never', 'my team', 'we use'];
                for (const phrase of userPhrases) {
                    if (contentLower.includes(phrase)) {
                        memories.push({
                            type: 'user',
                            title: `User Profile: ${content.substring(0, 80)}`,
                            content: content.substring(0, 500),
                            confidence: 0.8
                        });
                        break;
                    }
                }
            }

            // TYPE: feedback — Corrections AND confirmations
            if (msg.role === 'user') {
                // Corrections (negative feedback)
                const correctionPhrases = ['don\'t', 'stop', 'no not', 'wrong', 'never do',
                    'that\'s not', 'please don\'t', 'jangan', 'salah'];
                for (const phrase of correctionPhrases) {
                    if (contentLower.includes(phrase)) {
                        memories.push({
                            type: 'feedback',
                            title: `Correction: ${content.substring(0, 80)}`,
                            content: `Rule: ${content.substring(0, 400)}\nWhy: User explicitly corrected this approach.`,
                            confidence: 0.9
                        });
                        break;
                    }
                }
                // Confirmations (positive feedback) — Claude Code insight
                const confirmPhrases = ['yes exactly', 'perfect', 'that\'s right', 'good job',
                    'keep doing', 'bagus', 'mantap', 'yes that'];
                for (const phrase of confirmPhrases) {
                    if (contentLower.includes(phrase) && i > 0) {
                        const prevAssistant = recentMessages.slice(0, i).reverse()
                            .find(m => m.role === 'assistant');
                        if (prevAssistant) {
                            memories.push({
                                type: 'feedback',
                                title: `Confirmed Approach: ${content.substring(0, 60)}`,
                                content: `Validated approach: ${(prevAssistant.content || '').substring(0, 300)}\nUser confirmed: "${content.substring(0, 100)}"`,
                                confidence: 0.75
                            });
                        }
                        break;
                    }
                }
            }

            // TYPE: project — Ongoing work, deadlines, goals
            if (msg.role === 'user') {
                const projectPhrases = ['deadline', 'release', 'sprint', 'milestone', 'we need to',
                    'the goal is', 'by friday', 'this week', 'priority'];
                for (const phrase of projectPhrases) {
                    if (contentLower.includes(phrase)) {
                        // Convert relative dates to absolute
                        const now = new Date();
                        let enhanced = content;
                        enhanced = enhanced.replace(/\btoday\b/gi, now.toISOString().split('T')[0]);
                        enhanced = enhanced.replace(/\btomorrow\b/gi,
                            new Date(now.getTime() + 86400000).toISOString().split('T')[0]);

                        memories.push({
                            type: 'project',
                            title: `Project: ${content.substring(0, 80)}`,
                            content: `Fact: ${enhanced.substring(0, 400)}\nRecorded: ${now.toISOString()}`,
                            confidence: 0.7
                        });
                        break;
                    }
                }
            }

            // TYPE: reference — External system pointers
            if (msg.role === 'user') {
                const refPhrases = ['check the', 'look at', 'documented in', 'tracked in',
                    'the dashboard', 'the repo at', 'API docs at'];
                for (const phrase of refPhrases) {
                    if (contentLower.includes(phrase) && (content.includes('http') || content.includes('/'))) {
                        memories.push({
                            type: 'reference',
                            title: `Reference: ${content.substring(0, 80)}`,
                            content: content.substring(0, 500),
                            confidence: 0.8
                        });
                        break;
                    }
                }
            }

            // Error→Fix patterns (type: feedback)
            if (msg.role === 'system' && (content.includes('error') || content.includes('failed'))) {
                if (next && next.role === 'assistant') {
                    memories.push({
                        type: 'feedback',
                        title: `Error Fix: ${content.split('\n')[0].substring(0, 80)}`,
                        content: `Error: ${content.substring(0, 300)}\nFix: ${(next.content || '').substring(0, 300)}`,
                        confidence: 0.7
                    });
                }
            }
        }

        // Save high-confidence memories
        for (const mem of memories.filter(m => m.confidence >= 0.7)) {
            try {
                await fetch('http://127.0.0.1:5000/api/knowledge', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: `[AUTO:${mem.type}] ${mem.title}`,
                        content: mem.content,
                        category: mem.type
                    })
                });
                console.log(`[AutoMemory] 🧠 [${mem.type}] ${mem.title}`);
            } catch(e) {
                console.warn('[AutoMemory] Failed to save:', e.message);
            }
        }

        if (memories.length > 0) {
            console.log(`[AutoMemory] 🧠 Extracted ${memories.length} memories (${memories.filter(m => m.confidence >= 0.7).length} saved)`);
        }
    }
};

// ═══════════════════════════════════════════════════════════════════════
// MICRO-COMPACT — Compress individual tool results inline (no full rewrite)
// Claude Code: compact/microCompact.ts parity
// ═══════════════════════════════════════════════════════════════════════
window.microCompact = {
    maxToolResultChars: 2000,
    maxSystemMsgChars: 3000,
    enabled: true,

    // Compress a single tool result string
    compressToolResult: function(result) {
        if (!result || result.length <= this.maxToolResultChars) return result;

        // For JSON-heavy results, keep structure but trim values
        if (result.trim().startsWith('{') || result.trim().startsWith('[')) {
            try {
                const parsed = JSON.parse(result);
                const compressed = this._compressJSON(parsed, 0);
                const out = JSON.stringify(compressed, null, 1);
                if (out.length <= this.maxToolResultChars) return out;
            } catch(e) {}
        }

        // For text, keep first + last portions
        const halfMax = Math.floor(this.maxToolResultChars / 2) - 50;
        const prefix = result.substring(0, halfMax);
        const suffix = result.substring(result.length - halfMax);
        const omitted = result.length - halfMax * 2;
        return `${prefix}\n\n... [${omitted} chars omitted by micro-compact] ...\n\n${suffix}`;
    },

    // Recursively compress JSON, truncating long string values
    _compressJSON: function(obj, depth) {
        if (depth > 3) return '[nested]';
        if (typeof obj === 'string') return obj.length > 200 ? obj.substring(0, 200) + '...' : obj;
        if (Array.isArray(obj)) {
            if (obj.length > 10) return [...obj.slice(0, 5).map(i => this._compressJSON(i, depth+1)), `... (${obj.length - 5} more)`];
            return obj.map(i => this._compressJSON(i, depth+1));
        }
        if (typeof obj === 'object' && obj !== null) {
            const out = {};
            const keys = Object.keys(obj);
            for (const k of keys.slice(0, 15)) {
                out[k] = this._compressJSON(obj[k], depth+1);
            }
            if (keys.length > 15) out['...'] = `(${keys.length - 15} more keys)`;
            return out;
        }
        return obj;
    },

    // Scan entire chatHistory and compress large tool results in-place
    compressInPlace: function() {
        if (!this.enabled) return 0;
        let compressed = 0;
        for (let i = 0; i < window.chatHistory.length; i++) {
            const msg = window.chatHistory[i];
            if (msg.role === 'system' && typeof msg.content === 'string' && msg.content.length > this.maxSystemMsgChars) {
                // Don't compress context summaries or memory injections
                if (msg.content.includes('=== ') || msg.content.includes('SESSION MEMORY') || msg.content.includes('FLOWORK.md')) continue;
                window.chatHistory[i].content = this.compressToolResult(msg.content);
                compressed++;
            }
        }
        if (compressed > 0) console.log(`[MicroCompact] 🗜️ Compressed ${compressed} messages in-place`);
        return compressed;
    },

    // Compact warning — fires when context is at warning threshold
    checkWarning: function() {
        const currentSize = window.chatHistory.reduce((sum, m) => {
            return sum + (typeof m.content === 'string' ? m.content.length : 200);
        }, 0);
        const threshold = (window.smartCompact?.maxContextChars || 50000) * 0.7;
        if (currentSize > threshold) {
            const pct = Math.round((currentSize / (window.smartCompact?.maxContextChars || 50000)) * 100);
            if (window.appendToolMessage && !window._lastCompactWarning || (Date.now() - window._lastCompactWarning > 60000)) {
                window.appendToolMessage('Context', 'warning', `⚠️ Context at ${pct}% — auto-compact will trigger at 80%`);
                window._lastCompactWarning = Date.now();
            }
            // Pre-emptive micro-compact
            this.compressInPlace();
            return true;
        }
        return false;
    }
};

// ═══════════════════════════════════════════════════════════════════════
// HIERARCHICAL MEMORY SYSTEM — FLOWORK.md (Claude Code CLAUDE.md parity)
// 3 levels: Project → User → KB (server)
// ═══════════════════════════════════════════════════════════════════════
window.hierarchicalMemory = {
    projectMemoryFile: 'FLOWORK.md',
    userMemoryPath: null, // Set on init
    _cache: { project: null, user: null, lastLoad: 0 },
    cacheTTL: 60000, // 1 minute cache

    // Initialize — detect paths
    init: function() {
        // User memory: stored in FloworkData dir (same level as engine)
        this.userMemoryPath = 'FloworkData/MEMORY.md';
    },

    // Load project-level FLOWORK.md from current app directory
    loadProjectMemory: async function(appId) {
        const targetAppId = appId || window.currentAppId;
        if (!targetAppId || targetAppId === 'ai-builder-project') return null;

        // Check cache
        if (this._cache.project && Date.now() - this._cache.lastLoad < this.cacheTTL) {
            return this._cache.project;
        }

        try {
            const res = await fetch('http://127.0.0.1:5000/api/fs/read', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: `apps/${targetAppId}/${this.projectMemoryFile}` })
            });
            if (!res.ok) return null;
            const data = await res.json();
            const content = data.content || data.data || '';
            if (content.trim()) {
                this._cache.project = { path: `apps/${targetAppId}/${this.projectMemoryFile}`, content, appId: targetAppId, loadedAt: Date.now() };
                console.log(`[Memory] 📋 Project memory loaded: ${this.projectMemoryFile} (${content.length} chars)`);
                return this._cache.project;
            }
        } catch(e) {}
        return null;
    },

    // Load user-level memory (cross-project preferences)
    loadUserMemory: async function() {
        if (this._cache.user && Date.now() - this._cache.lastLoad < this.cacheTTL) {
            return this._cache.user;
        }

        try {
            const res = await fetch('http://127.0.0.1:5000/api/fs/read', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: this.userMemoryPath })
            });
            if (!res.ok) return null;
            const data = await res.json();
            const content = data.content || data.data || '';
            if (content.trim()) {
                this._cache.user = { path: this.userMemoryPath, content, loadedAt: Date.now() };
                console.log(`[Memory] 👤 User memory loaded: ${this.userMemoryPath} (${content.length} chars)`);
                return this._cache.user;
            }
        } catch(e) {}
        return null;
    },

    // Save to FLOWORK.md (project) or MEMORY.md (user)
    saveMemory: async function(level, newContent) {
        const path = level === 'project'
            ? `apps/${window.currentAppId || 'ai-builder-project'}/${this.projectMemoryFile}`
            : this.userMemoryPath;

        try {
            await fetch('http://127.0.0.1:5000/api/fs/write', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path, content: newContent })
            });
            // Invalidate cache
            if (level === 'project') this._cache.project = null;
            else this._cache.user = null;
            console.log(`[Memory] 💾 Saved ${level} memory: ${path}`);
            return true;
        } catch(e) {
            console.warn(`[Memory] Failed to save ${level} memory:`, e.message);
            return false;
        }
    },

    // Append new fact to memory file
    appendToMemory: async function(level, fact) {
        let existing = '';
        if (level === 'project') {
            const mem = await this.loadProjectMemory();
            existing = mem?.content || `# FLOWORK.md\n\nProject-level memory for ${window.currentAppId || 'unknown'}.\n\n## Facts\n`;
        } else {
            const mem = await this.loadUserMemory();
            existing = mem?.content || `# MEMORY.md\n\nUser-level memory (cross-project).\n\n## Preferences\n`;
        }
        const updated = existing.trimEnd() + `\n- ${fact} _(${new Date().toISOString().split('T')[0]})_\n`;
        return this.saveMemory(level, updated);
    },

    // Inject all relevant memories into chatHistory at session start
    injectAll: async function() {
        const parts = [];

        // 1. Project memory (FLOWORK.md)
        const projMem = await this.loadProjectMemory();
        if (projMem) {
            parts.push(`## Project Memory (${projMem.appId}/FLOWORK.md)\n${projMem.content.substring(0, 2000)}`);
        }

        // 2. User memory (MEMORY.md)
        const userMem = await this.loadUserMemory();
        if (userMem) {
            parts.push(`## User Preferences (MEMORY.md)\n${userMem.content.substring(0, 1500)}`);
        }

        if (parts.length === 0) return false;

        const injection = `=== HIERARCHICAL MEMORY ===\n${window.MEMORY_DRIFT_CAVEAT || ''}\n\n${parts.join('\n\n---\n\n')}`;

        // Inject as early system message (after system prompt)
        const firstNonSystem = window.chatHistory.findIndex(m => m.role !== 'system');
        const insertAt = Math.max(0, firstNonSystem);
        window.chatHistory.splice(insertAt, 0, { role: 'system', content: injection });

        console.log(`[Memory] 🧠 Injected hierarchical memory: ${parts.length} sources`);
        if (window.appendToolMessage) {
            window.appendToolMessage('Memory', 'success', `🧠 ${parts.length} memory sources loaded`);
        }
        this._cache.lastLoad = Date.now();
        return true;
    }
};

window.hierarchicalMemory.init();

// ═══════════════════════════════════════════════════════════════════════
// MEMORY AGING — Track freshness, demote stale memories
// ═══════════════════════════════════════════════════════════════════════
window.memoryAging = {
    maxAgeDays: 30,

    // Calculate freshness score (0.0 = stale, 1.0 = fresh)
    score: function(createdAt) {
        if (!createdAt) return 0.5;
        const ageMs = Date.now() - new Date(createdAt).getTime();
        const ageDays = ageMs / 86_400_000;
        if (ageDays < 1) return 1.0;
        if (ageDays < 7) return 0.9;
        if (ageDays < 14) return 0.7;
        if (ageDays < this.maxAgeDays) return 0.5;
        return 0.3;
    },

    // Label for display
    label: function(createdAt) {
        const s = this.score(createdAt);
        if (s >= 0.9) return '🟢 fresh';
        if (s >= 0.7) return '🟡 recent';
        if (s >= 0.5) return '🟠 aging';
        return '🔴 stale';
    }
};

// ═══════════════════════════════════════════════════════════════════════
// SEMANTIC MEMORY SEARCH — Fuzzy search with scoring
// ═══════════════════════════════════════════════════════════════════════
window.semanticMemorySearch = {
    // Search KB with scoring and aging
    search: async function(query, maxResults) {
        maxResults = maxResults || 10;
        try {
            const res = await fetch('http://127.0.0.1:5000/api/knowledge/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: query.substring(0, 200), limit: maxResults * 2 })
            });
            if (!res.ok) return [];
            const data = await res.json();
            const raw = data.results || data.data || [];

            // Score each result: relevance × freshness
            return raw.map(mem => {
                const freshness = window.memoryAging.score(mem.created_at || mem.createdAt);
                const textRelevance = this._textRelevance(query, (mem.title || '') + ' ' + (mem.content || ''));
                return {
                    ...mem,
                    freshness,
                    freshnessLabel: window.memoryAging.label(mem.created_at || mem.createdAt),
                    relevance: textRelevance,
                    combinedScore: (textRelevance * 0.7) + (freshness * 0.3)
                };
            })
            .sort((a, b) => b.combinedScore - a.combinedScore)
            .slice(0, maxResults);
        } catch(e) {
            console.warn('[SemanticSearch] Failed:', e.message);
            return [];
        }
    },

    // Simple text relevance scoring (term frequency)
    _textRelevance: function(query, text) {
        if (!query || !text) return 0;
        const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
        const textLower = text.toLowerCase();
        let matches = 0;
        for (const term of terms) {
            if (textLower.includes(term)) matches++;
        }
        return terms.length > 0 ? matches / terms.length : 0;
    }
};

// ─── LLM-POWERED SMART COMPACTION (Claude Code compact/ parity) ──────
window.smartCompact = {
    maxContextChars: 50000,
    compactionThresholdPercent: 80,
    isCompacting: false,

    shouldCompact: function() {
        if (this.isCompacting) return false;
        const currentSize = window.chatHistory.reduce((sum, m) => {
            return sum + (typeof m.content === 'string' ? m.content.length : 200);
        }, 0);
        return currentSize > this.maxContextChars * (this.compactionThresholdPercent / 100);
    },

    // Programmatic summary (fast fallback)
    generateSummaryFast: function(messages) {
        let summary = '=== COMPACTED CONVERSATION HISTORY ===\n\n';

        const userMessages = messages.filter(m => m.role === 'user').map(m => {
            const content = typeof m.content === 'string' ? m.content : '[image/tool]';
            return content.substring(0, 200);
        });
        summary += '## User Requests:\n';
        userMessages.forEach((msg, i) => { summary += `${i + 1}. ${msg}\n`; });

        summary += '\n## Key Actions:\n';
        const assistantMsgs = messages.filter(m => m.role === 'assistant');
        for (const msg of assistantMsgs) {
            const content = typeof msg.content === 'string' ? msg.content : '';
            const actionMatch = content.match(/"action"\s*:\s*"(\w+)"/g);
            if (actionMatch) {
                const actions = [...new Set(actionMatch.map(a => a.replace(/"action"\s*:\s*"/, '').replace('"', '')))];
                summary += `- Tools: ${actions.join(', ')}\n`;
            }
        }

        summary += '\n## Errors:\n';
        const errors = messages.filter(m =>
            m.role === 'system' && typeof m.content === 'string' &&
            (m.content.includes('error') || m.content.includes('failed'))
        );
        if (errors.length === 0) summary += '- None\n';
        else errors.slice(-5).forEach(m => {
            summary += `- ${m.content.split('\n')[0].substring(0, 150)}\n`;
        });

        summary += `\n## State: App=${window.currentAppId || 'unknown'}, Files=[${Object.keys(window.generatedFiles || {}).join(', ')}]\n`;
        return summary;
    },

    // LLM-powered summary (high quality, uses API call)
    generateSummaryLLM: async function(messages) {
        const conversationText = messages.map(m =>
            `[${m.role}]: ${typeof m.content === 'string' ? m.content.substring(0, 300) : '[tool]'}`
        ).join('\n');

        const summaryPrompt = `Summarize this AI coding session concisely. Extract ONLY:
- User's goals and requests (numbered list)
- Files created/modified (with names)
- Errors encountered and how they were fixed
- Current progress and what's left to do
- Important decisions made

Be EXTREMELY concise. Max 500 words. Bullet points only.

CONVERSATION:
${conversationText.substring(0, 15000)}`;

        try {
            const provider = document.getElementById('select-provider')?.value;
            const model = document.getElementById('select-model')?.value;
            const apiKey = document.getElementById('input-api-key')?.value;

            if (!apiKey) return this.generateSummaryFast(messages);

            const res = await window.callLLMAPI(provider, model, apiKey, [
                { role: 'user', content: summaryPrompt }
            ], { maxTokens: 600, temperature: 0.1 });

            if (res && res.text) {
                console.log('[SmartCompact] 🤖 LLM summary generated');
                return `=== AI-SUMMARIZED CONTEXT ===\n\n${res.text}`;
            }
            return this.generateSummaryFast(messages);
        } catch(e) {
            console.warn('[SmartCompact] LLM summary failed, using fast:', e.message);
            return this.generateSummaryFast(messages);
        }
    },

    // Perform compaction
    compact: async function(useLLM) {
        if (!this.shouldCompact()) return false;
        this.isCompacting = true;

        try {
            const totalMessages = window.chatHistory.length;
            const keepCount = Math.max(10, Math.floor(totalMessages * 0.3));
            const compactMessages = window.chatHistory.slice(0, totalMessages - keepCount);
            const recentMessages = window.chatHistory.slice(totalMessages - keepCount);

            if (compactMessages.length < 5) {
                this.isCompacting = false;
                return false;
            }

            // Use LLM if requested and available, otherwise fast
            const summary = useLLM !== false
                ? await this.generateSummaryLLM(compactMessages)
                : this.generateSummaryFast(compactMessages);

            // Preserve file state context (Claude Code pattern)
            let fileStateContext = '';
            const activeFiles = Object.keys(window.generatedFiles || {});
            if (activeFiles.length > 0) {
                fileStateContext = '\n\n## Active Files In Editor:\n';
                for (const f of activeFiles.slice(0, 5)) {
                    const content = window.generatedFiles[f];
                    if (content && content.length < 500) {
                        fileStateContext += `### ${f}\n\`\`\`\n${content}\n\`\`\`\n`;
                    } else if (content) {
                        fileStateContext += `### ${f} (${content.length} chars, truncated)\n`;
                    }
                }
            }

            window.chatHistory = [
                { role: 'system', content: summary + fileStateContext },
                ...recentMessages
            ];

            // Extract memories before losing context
            window.autoMemory.extractFromConversation();

            console.log(`[SmartCompact] 📦 Compacted ${compactMessages.length} → 1 summary + ${recentMessages.length} recent (${summary.length} chars)`);
            if (window.appendToolMessage) {
                window.appendToolMessage('SmartCompact', 'success',
                    `📦 ${compactMessages.length} msgs → summary (${useLLM !== false ? 'LLM' : 'fast'})`);
            }

            this.isCompacting = false;
            return true;
        } catch(e) {
            console.error('[SmartCompact] Failed:', e);
            this.isCompacting = false;
            return false;
        }
    }
};

// ─── MEMORY DRIFT CAVEAT (Claude Code pattern) ──────────────────────
window.MEMORY_DRIFT_CAVEAT = `Memory records can become stale. Before acting on a memory:
- If it names a file: check it exists
- If it names a function: grep for it
- If the user will act on your recommendation: verify first
"The memory says X exists" is not the same as "X exists now."`;

// ─── HOOK INTO AGENT LOOP ────────────────────────────────────────────
window._originalAgentTickForMemory = null;
window.hookAutoMemory = function() {
    if (window._originalAgentTickForMemory) return;

    const originalSendMessage = window.sendMessage;
    if (originalSendMessage && !window._memoryHooked) {
        window._memoryHooked = true;

        setInterval(() => {
            if (!window.isGenerating && window._prevGenerating) {
                setTimeout(() => window.autoMemory.extractFromConversation(), 2000);
                setTimeout(() => window.smartCompact.compact(), 3000);
                // Micro-compact warning check
                setTimeout(() => window.microCompact.checkWarning(), 1000);
            }
            window._prevGenerating = window.isGenerating;
        }, 1000);
    }
};

setTimeout(() => window.hookAutoMemory(), 3000);

// Inject hierarchical memory on first load
setTimeout(() => {
    if (!window._hierarchicalMemoryInjected) {
        window._hierarchicalMemoryInjected = true;
        window.hierarchicalMemory.injectAll().catch(() => {});
    }
}, 5000);

console.log('[Flowork OS] ✅ Memory v2 loaded (Structured Types + Micro-Compact + FLOWORK.md Hierarchy + Aging + Semantic Search)');
