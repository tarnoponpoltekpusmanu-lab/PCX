// =========================================================================
// FLOWORK OS - CLAUDE CODE PARITY: THINKING MODE
// FILE: agent_thinking.js
// DESCRIPTION: Extended Thinking / Chain-of-Thought mode with budget control
//              Parses <thinking> blocks, tracks token usage, UI integration
// =========================================================================

window.thinkingMode = {
    enabled: false,
    mode: 'disabled',        // 'disabled' | 'brief' | 'extended'
    budget: 10000,           // max thinking tokens
    currentUsage: 0,         // tokens used in current thinking block
    sessionUsage: 0,         // total thinking tokens this session
    thinkingBlocks: [],      // history of thinking blocks
    showInUI: true,          // show thinking in chat UI
    _collapseByDefault: true,

    // ─── ENABLE THINKING MODE ───────────────────────────────────────
    enable: function(mode, budget) {
        this.mode = mode || 'extended';
        this.enabled = true;
        if (budget) this.budget = budget;
        this.currentUsage = 0;
        console.log(`[Thinking] 🧠 Enabled: ${this.mode} mode, budget: ${this.budget} tokens`);
        if (window.appendToolMessage) {
            window.appendToolMessage('Thinking', 'success', `🧠 ${this.mode} mode ON (budget: ${this.budget} tokens)`);
        }
        return { status: 'enabled', mode: this.mode, budget: this.budget };
    },

    // ─── DISABLE THINKING MODE ──────────────────────────────────────
    disable: function() {
        this.enabled = false;
        this.mode = 'disabled';
        this.currentUsage = 0;
        console.log('[Thinking] 🧠 Disabled');
        if (window.appendToolMessage) {
            window.appendToolMessage('Thinking', 'success', '🧠 Thinking mode OFF');
        }
        return { status: 'disabled' };
    },

    // ─── GET SYSTEM PROMPT INJECTION ────────────────────────────────
    getPromptInjection: function() {
        if (!this.enabled) return '';

        const modeInstructions = {
            'brief': `\n\n[THINKING MODE: BRIEF]
Before responding, think through the problem briefly inside <thinking>...</thinking> tags.
Keep thinking concise — 2-5 sentences max. Focus on:
- What is the user asking?
- What's the best approach?
Then provide your response outside the thinking tags.`,

            'extended': `\n\n[THINKING MODE: EXTENDED]
Before responding, think through the problem in detail inside <thinking>...</thinking> tags.
Use extended reasoning to:
1. Analyze the problem from multiple angles
2. Consider edge cases and potential issues
3. Evaluate different approaches and their tradeoffs
4. Plan your solution step by step
5. Identify risks and mitigation strategies

Think budget: ~${this.budget} tokens. Be thorough but not redundant.
Then provide your response outside the thinking tags.
IMPORTANT: Always include <thinking> tags. The user can see your thinking process.`
        };

        return modeInstructions[this.mode] || '';
    },

    // ─── PARSE THINKING BLOCKS FROM RESPONSE ────────────────────────
    parseResponse: function(rawResponse) {
        const thinkingRegex = /<thinking>([\s\S]*?)<\/thinking>/gi;
        const matches = [];
        let match;
        let cleanResponse = rawResponse;

        while ((match = thinkingRegex.exec(rawResponse)) !== null) {
            const thinkingContent = match[1].trim();
            const estimatedTokens = Math.ceil(thinkingContent.length / 4);

            matches.push({
                content: thinkingContent,
                estimatedTokens: estimatedTokens,
                timestamp: new Date().toISOString()
            });

            this.currentUsage += estimatedTokens;
            this.sessionUsage += estimatedTokens;
        }

        // Remove thinking blocks from the clean response
        cleanResponse = rawResponse.replace(thinkingRegex, '').trim();

        // Store thinking blocks
        if (matches.length > 0) {
            this.thinkingBlocks.push(...matches);
            // Keep last 50 blocks
            if (this.thinkingBlocks.length > 50) {
                this.thinkingBlocks = this.thinkingBlocks.slice(-25);
            }
        }

        return {
            thinking: matches,
            response: cleanResponse,
            thinkingTokens: matches.reduce((sum, m) => sum + m.estimatedTokens, 0),
            budgetRemaining: this.budget - this.currentUsage,
            overBudget: this.currentUsage > this.budget
        };
    },

    // ─── RENDER THINKING IN CHAT UI ─────────────────────────────────
    renderThinkingInUI: function(thinkingBlocks) {
        if (!this.showInUI || !thinkingBlocks || thinkingBlocks.length === 0) return;

        for (const block of thinkingBlocks) {
            const thinkingHtml = `
<details class="thinking-block" ${this._collapseByDefault ? '' : 'open'}>
    <summary class="thinking-header">
        <span class="thinking-icon">🧠</span> 
        <span class="thinking-label">AI Thinking</span>
        <span class="thinking-tokens">${block.estimatedTokens} tokens</span>
    </summary>
    <div class="thinking-content">${this._escapeHtml(block.content)}</div>
</details>`;

            if (window.appendChatMessage) {
                window.appendChatMessage('thinking', thinkingHtml, null, true);
            }
        }
    },

    // ─── CHECK BUDGET ───────────────────────────────────────────────
    checkBudget: function() {
        if (!this.enabled) return { allowed: true };

        const remaining = this.budget - this.currentUsage;
        const usedPercent = this.budget > 0 ? (this.currentUsage / this.budget * 100) : 0;

        return {
            allowed: remaining > 0,
            remaining: remaining,
            used: this.currentUsage,
            budget: this.budget,
            usedPercent: Math.round(usedPercent),
            warning: usedPercent > 80
        };
    },

    // ─── RESET FOR NEW TURN ─────────────────────────────────────────
    resetTurn: function() {
        this.currentUsage = 0;
    },

    // ─── GET STATUS ─────────────────────────────────────────────────
    getStatus: function() {
        return {
            enabled: this.enabled,
            mode: this.mode,
            budget: this.budget,
            currentUsage: this.currentUsage,
            sessionUsage: this.sessionUsage,
            blocksCount: this.thinkingBlocks.length,
            budgetCheck: this.checkBudget()
        };
    },

    // ─── REPLAY THINKING (for /thinkback command) ───────────────────
    getThinkingHistory: function(last) {
        const blocks = last ? this.thinkingBlocks.slice(-last) : this.thinkingBlocks;
        return blocks.map((b, i) => ({
            index: i,
            content: b.content.substring(0, 500) + (b.content.length > 500 ? '...' : ''),
            tokens: b.estimatedTokens,
            timestamp: b.timestamp
        }));
    },

    // ─── HELPER ─────────────────────────────────────────────────────
    _escapeHtml: function(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/\n/g, '<br>');
    }
};

// ─── CSS INJECTION FOR THINKING BLOCKS ──────────────────────────────
(function() {
    const style = document.createElement('style');
    style.textContent = `
        .thinking-block {
            background: rgba(147, 51, 234, 0.08);
            border: 1px solid rgba(147, 51, 234, 0.2);
            border-radius: 8px;
            margin: 8px 0;
            overflow: hidden;
            font-size: 13px;
        }
        .thinking-header {
            padding: 8px 12px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            color: #a855f7;
            font-weight: 500;
            user-select: none;
        }
        .thinking-header:hover { background: rgba(147, 51, 234, 0.05); }
        .thinking-icon { font-size: 16px; }
        .thinking-tokens {
            margin-left: auto;
            font-size: 11px;
            opacity: 0.6;
            font-weight: 400;
        }
        .thinking-content {
            padding: 8px 12px 12px;
            color: #c4b5fd;
            line-height: 1.5;
            font-family: monospace;
            font-size: 12px;
            white-space: pre-wrap;
            border-top: 1px solid rgba(147, 51, 234, 0.15);
        }
    `;
    document.head.appendChild(style);
})();

console.log('[Flowork OS] ✅ Thinking Mode loaded (brief/extended + budget control)');
