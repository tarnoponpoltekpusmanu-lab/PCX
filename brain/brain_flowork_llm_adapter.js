// =========================================================================
// FLOWORK OS — Brain LLM Adapter
// Bridges existing agent_llm.js (Gemini, OpenAI, Claude) with
// brain_flowork_bundle.js QueryEngine format
// =========================================================================

// The brain's QueryEngine expects an API service that returns messages
// in Claude SDK format. This adapter normalizes all providers into that format.

window.brainLLMAdapter = {
    /**
     * Unified query function — called by brain_flowork_adapter.js
     * @param {string} provider - 'gemini' | 'chatgpt' | 'claude'
     * @param {string} apiKey
     * @param {string} systemPrompt
     * @param {Array} messages - Brain format messages [{role, content}]
     * @param {Object} toolDefinitions - Tool schemas for function calling
     * @param {Function} onChunk - Streaming callback (text, fullText)
     * @param {AbortSignal} signal - For cancellation
     * @returns {Object} Normalized response in Claude SDK format
     */
    async query(provider, apiKey, systemPrompt, messages, toolDefinitions, onChunk, signal) {
        // Convert brain messages to provider-specific format
        const history = messages.map(m => ({
            role: m.role === 'assistant' ? 'agent' : m.role,
            content: typeof m.content === 'string' ? m.content : 
                     m.content?.map(c => c.text).join('\n') || '',
            image: m.image || null,
        }));

        let rawResponse = '';
        let toolCalls = [];

        try {
            // ─── Provider Routing (ordered by specificity) ──────────────
            if (provider.includes('gemini')) {
                rawResponse = await window.callGemini(apiKey, provider, systemPrompt, history, onChunk);
            } else if (provider.includes('grok')) {
                rawResponse = await window.callGrok(apiKey, provider, systemPrompt, history, onChunk);
            } else if (provider.startsWith('groq-')) {
                rawResponse = await window.callGroq(apiKey, provider, systemPrompt, history, onChunk);
            } else if (provider.startsWith('deepseek-')) {
                rawResponse = await window.callDeepSeek(apiKey, provider, systemPrompt, history, onChunk);
            } else if (provider.startsWith('mistral-') || provider.startsWith('magistral-')) {
                rawResponse = await window.callMistral(apiKey, provider, systemPrompt, history, onChunk);
            } else if (provider.startsWith('together-')) {
                rawResponse = await window.callTogether(apiKey, provider, systemPrompt, history, onChunk);
            } else if (provider.startsWith('fireworks-')) {
                rawResponse = await window.callFireworks(apiKey, provider, systemPrompt, history, onChunk);
            } else if (provider.startsWith('cohere-')) {
                rawResponse = await window.callCohere(apiKey, provider, systemPrompt, history, onChunk);
            } else if (provider.startsWith('ollama-')) {
                rawResponse = await window.callOllama(apiKey, provider, systemPrompt, history, onChunk);
            } else if (provider.includes('claude') || provider.includes('anthropic')) {
                rawResponse = await window.callClaude(apiKey, provider, systemPrompt, history, onChunk);
            } else if (provider.includes('chatgpt') || provider.includes('openai') || provider.includes('gpt') || provider.includes('o1') || provider.includes('o3') || provider.includes('o4')) {
                rawResponse = await window.callOpenAI(apiKey, provider, systemPrompt, history, onChunk);
            } else {
                // Unknown provider → try OpenAI-compatible as fallback
                console.warn(`[LLMAdapter] Unknown provider "${provider}", trying OpenAI-compatible format...`);
                rawResponse = await window.callOpenAI(apiKey, provider, systemPrompt, history, onChunk);
            }
        } catch (err) {
            if (err.name === 'AbortError') {
                return { type: 'aborted', content: [] };
            }
            throw err;
        }

        // Parse JSON tool calls from response
        const parsed = _parseToolCalls(rawResponse);

        // ═══ AUTO COST TRACKING ═══
        if (window.costTracker) {
            const inputChars = systemPrompt.length + history.reduce((sum, m) => sum + (m.content || '').length, 0);
            const outputChars = (rawResponse || '').length;
            const imageCount = history.filter(m => m.image).length;
            window.costTracker.recordCall(provider, inputChars, outputChars, imageCount);
        }

        // Return in Claude SDK message format + rawText for brain adapter v2
        const result = _normalizeToClaudeFormat(parsed, rawResponse);
        result.rawText = rawResponse;
        return result;
    },

    /**
     * Get available tools in Claude SDK format
     * Converts window.brainToolRegistry to Claude's tool definition format
     */
    getToolDefinitions() {
        const tools = [];
        const schemas = window.toolSchemas || {};

        for (const [name, schema] of Object.entries(schemas)) {
            const properties = {};
            const required = schema.required || [];

            for (const [propName, propType] of Object.entries(schema.props || {})) {
                properties[propName] = {
                    type: propType === 'array' ? 'array' : propType === 'object' ? 'object' : propType,
                    description: `${propName} parameter`,
                };
            }

            tools.push({
                name: name,
                description: `Flowork tool: ${name}`,
                input_schema: {
                    type: 'object',
                    properties,
                    required,
                },
            });
        }

        return tools;
    },
};

// ═════════════════════════════════════════════════════════════════════════
// PRIVATE HELPERS
// ═════════════════════════════════════════════════════════════════════════

/**
 * Parse raw LLM response to extract tool calls and text
 * Flowork uses JSON format: { message, actions: [{action, ...params}] }
 */
function _parseToolCalls(rawResponse) {
    const result = { text: '', actions: [], rawJSON: null };

    if (!rawResponse || !rawResponse.trim()) {
        return result;
    }

    try {
        let cleanText = rawResponse.trim();
        if (cleanText.includes("```json")) {
            cleanText = cleanText.split("```json").pop().split("```")[0].trim();
        } else if (cleanText.startsWith("```") && cleanText.endsWith("```")) {
            cleanText = cleanText.slice(3, -3).trim();
        }

        const parsed = JSON.parse(cleanText);
        result.rawJSON = parsed;

        // Extract message text
        result.text = parsed.message || parsed.response || parsed.text || '';

        // Extract actions (tool calls)
        if (parsed.actions && Array.isArray(parsed.actions)) {
            result.actions = parsed.actions;
        } else if (parsed.action) {
            // Single action format
            result.actions = [parsed];
        }
    } catch (e) {
        // Not JSON — treat entire response as text
        result.text = rawResponse;
    }

    return result;
}

/**
 * Normalize parsed response to Claude SDK message format
 * This is what the brain's QueryEngine expects
 */
function _normalizeToClaudeFormat(parsed, rawResponse) {
    const content = [];

    // Add text block
    if (parsed.text) {
        content.push({
            type: 'text',
            text: parsed.text,
        });
    }

    // Add tool_use blocks for each action
    for (const action of parsed.actions) {
        const toolName = action.action || action.tool || action.name;
        if (!toolName) continue;

        // Extract input (everything except 'action' key)
        const input = { ...action };
        delete input.action;
        delete input.tool;
        delete input.name;

        content.push({
            type: 'tool_use',
            id: `toolu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: toolName,
            input: input,
        });
    }

    // If no content at all, return the raw text
    if (content.length === 0 && rawResponse) {
        content.push({
            type: 'text',
            text: rawResponse,
        });
    }

    return {
        id: `msg_${Date.now()}`,
        type: 'message',
        role: 'assistant',
        content: content,
        model: 'flowork-brain',
        stop_reason: parsed.actions.length > 0 ? 'tool_use' : 'end_turn',
        usage: {
            input_tokens: 0,  // tracked by brain's cost tracker
            output_tokens: 0,
        },
    };
}

/**
 * Convert Claude SDK tool_result format back to Flowork chatHistory format
 * Called when the brain needs to feed tool results back into the conversation
 */
window.brainLLMAdapter.formatToolResult = function(toolUseId, toolName, result) {
    return {
        role: 'user',
        content: [{
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: typeof result === 'string' ? result : JSON.stringify(result),
        }],
    };
};

/**
 * Convert Flowork chatHistory format to Claude SDK messages format
 * For when brain needs to see the full conversation
 */
window.brainLLMAdapter.convertHistory = function(chatHistory) {
    return chatHistory.map(msg => {
        if (msg.role === 'system') {
            return { role: 'user', content: `[System] ${msg.content}` };
        }
        if (msg.role === 'agent') {
            return { role: 'assistant', content: msg.content };
        }
        return { role: msg.role, content: msg.content };
    });
};

console.log('[Brain] ✅ LLM Adapter loaded (Gemini, OpenAI, Claude, Grok, DeepSeek, Groq, Mistral, Together, Fireworks, Cohere, Ollama → unified)');
