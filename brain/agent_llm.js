// =========================================================================
// FLOWORK OS - NANO MODULAR ARCHITECTURE
// FILE: agent_llm.js
// DESKRIPSI: Klien API untuk model AI (Gemini, OpenAI, Claude)
//            ANTIGRAVITY TIER: Full Streaming Support
// =========================================================================

// ─── GEMINI (Streaming) ───────────────────────────────────────────────
window.callGemini = async function(apiKey, model, systemPrompt, history, onChunk) {
    let actualModel = model;

    // Normalize model names to actual Gemini API model IDs
    // Valid: gemini-3.1-pro-preview, gemini-3-flash-preview, gemini-2.5-flash,
    //        gemini-2.5-pro, gemini-2.0-flash, gemini-2.0-flash-lite
    if (!actualModel || !actualModel.includes('gemini')) {
        actualModel = 'gemini-2.5-flash';
    } else if (actualModel.includes('-preview-05-') || actualModel.includes('-preview-04-')) {
        // Strip date suffixes: "gemini-2.5-pro-preview-05-06" → "gemini-2.5-pro"
        actualModel = actualModel.replace(/-preview-\d{2}-\d{2}$/, '');
    }

    let contents = [];
    history.forEach(msg => {
        let role = msg.role === 'agent' ? 'model' : 'user';
        let parts = [];
        if (msg.image) {
            const base64Str = msg.image.split(',')[1];
            parts.push({ inlineData: { mimeType: "image/png", data: base64Str }});
            parts.push({ text: msg.content || "[Attached Image]" });
        } else {
            parts.push({ text: msg.content });
        }
        contents.push({ role: role, parts: parts });
    });

    const body = {
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: contents,
        generationConfig: { temperature: 0.4, responseMimeType: "application/json" }
    };

    // Use streaming endpoint if callback provided
    if (onChunk && typeof onChunk === 'function') {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${actualModel}:streamGenerateContent?alt=sse&key=${apiKey}`;
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!response.ok) {
            const errDetails = await response.text();
            throw new Error(`Gemini API Error: ${response.status}. Details: ${errDetails}`);
        }

        let fullText = '';
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop(); // keep incomplete line

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const jsonStr = line.slice(6).trim();
                    if (!jsonStr || jsonStr === '[DONE]') continue;
                    try {
                        const chunk = JSON.parse(jsonStr);
                        const text = chunk?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                        if (text) {
                            fullText += text;
                            onChunk(text, fullText);
                        }
                    } catch (e) { /* skip malformed chunk */ }
                }
            }
        }
        return fullText;
    }

    // Fallback: non-streaming
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${actualModel}:generateContent?key=${apiKey}`;
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) {
        const errDetails = await response.text();
        throw new Error(`Gemini API Error: ${response.status}. Details: ${errDetails}`);
    }
    const data = await response.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
};

// ─── OPENAI (Streaming) ──────────────────────────────────────────────
window.callOpenAI = async function(apiKey, model, systemPrompt, history, onChunk) {
    const url = 'https://api.openai.com/v1/chat/completions';
    const messages = [{ role: 'system', content: systemPrompt }];

    history.forEach(msg => {
        if (msg.image) {
            messages.push({
                role: msg.role === 'agent' ? 'assistant' : 'user',
                content: [
                    {type: "text", text: msg.content || "Analyze this image"},
                    {type: "image_url", image_url: {url: msg.image}}
                ]
            });
        } else {
            messages.push({ role: msg.role === 'agent' ? 'assistant' : 'user', content: msg.content });
        }
    });

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    if (onChunk && typeof onChunk === 'function') {
        const body = { model: model, messages: messages, temperature: 0.4, response_format: { type: "json_object" }, stream: true };
        const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
        if (!response.ok) throw new Error('OpenAI API Error: ' + response.status);

        let fullText = '';
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const jsonStr = line.slice(6).trim();
                    if (jsonStr === '[DONE]') continue;
                    try {
                        const chunk = JSON.parse(jsonStr);
                        const text = chunk?.choices?.[0]?.delta?.content || '';
                        if (text) {
                            fullText += text;
                            onChunk(text, fullText);
                        }
                    } catch (e) { /* skip */ }
                }
            }
        }
        return fullText;
    }

    // Fallback
    const body = { model: model, messages: messages, temperature: 0.4, response_format: { type: "json_object" } };
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!response.ok) throw new Error('OpenAI API Error');
    const data = await response.json();
    return data?.choices?.[0]?.message?.content || '';
};

// ─── CLAUDE (Streaming) ──────────────────────────────────────────────
window.callClaude = async function(apiKey, model, systemPrompt, history, onChunk) {
    const url = 'https://api.anthropic.com/v1/messages';
    let actualModel = 'claude-4-6-sonnet-2026';
    if (model.includes('opus')) actualModel = 'claude-4-6-opus-2026';
    else if (model.includes('haiku')) actualModel = 'claude-4-5-haiku-2026';
    else if (model.includes('sonnet')) actualModel = 'claude-4-6-sonnet-2026';

    const messages = [];
    history.forEach(msg => {
        if (msg.image) {
            const base64Str = msg.image.split(',')[1];
            const mimeType = msg.image.split(';')[0].split(':')[1];
            messages.push({
                role: msg.role === 'agent' ? 'assistant' : 'user',
                content: [
                    {type: "image", source: {type: "base64", media_type: mimeType, data: base64Str}},
                    {type: "text", text: msg.content || "Analyze this image"}
                ]
            });
        } else {
            messages.push({ role: msg.role === 'agent' ? 'assistant' : 'user', content: msg.content });
        }
    });

    const headers = { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };

    if (onChunk && typeof onChunk === 'function') {
        const body = { model: actualModel, max_tokens: 8192, system: systemPrompt, messages: messages, stream: true };
        const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
        if (!response.ok) throw new Error('Claude API Error: ' + response.status);

        let fullText = '';
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const jsonStr = line.slice(6).trim();
                    if (!jsonStr) continue;
                    try {
                        const chunk = JSON.parse(jsonStr);
                        if (chunk.type === 'content_block_delta') {
                            const text = chunk.delta?.text || '';
                            if (text) {
                                fullText += text;
                                onChunk(text, fullText);
                            }
                        }
                    } catch (e) { /* skip */ }
                }
            }
        }
        return fullText;
    }

    // Fallback
    const body = { model: actualModel, max_tokens: 8192, system: systemPrompt, messages: messages };
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!response.ok) throw new Error('Claude API Error');
    const data = await response.json();
    return data?.content?.[0]?.text || '';
};

// ─── OPENAI-COMPATIBLE PROVIDERS ─────────────────────────────────────
// xAI Grok, DeepSeek, Groq, Mistral, Together AI, Fireworks AI, Cohere
// All use the same OpenAI chat/completions format with different base URLs
// ─────────────────────────────────────────────────────────────────────

/**
 * Universal OpenAI-compatible caller
 * Works for any provider that implements the /v1/chat/completions format
 */
window.callOpenAICompatible = async function(apiKey, model, systemPrompt, history, onChunk, baseUrl, extraHeaders = {}) {
    const url = `${baseUrl}/chat/completions`;
    const messages = [{ role: 'system', content: systemPrompt }];

    history.forEach(msg => {
        if (msg.image) {
            messages.push({
                role: msg.role === 'agent' ? 'assistant' : 'user',
                content: [
                    {type: "text", text: msg.content || "Analyze this image"},
                    {type: "image_url", image_url: {url: msg.image}}
                ]
            });
        } else {
            messages.push({ role: msg.role === 'agent' ? 'assistant' : 'user', content: msg.content });
        }
    });

    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        ...extraHeaders,
    };

    if (onChunk && typeof onChunk === 'function') {
        const body = { model, messages, temperature: 0.4, stream: true };
        // Only add response_format for providers that support it
        if (!baseUrl.includes('cohere') && !baseUrl.includes('groq')) {
            body.response_format = { type: "json_object" };
        }
        const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            throw new Error(`API Error (${response.status}): ${errText.substring(0, 200)}`);
        }

        let fullText = '';
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const jsonStr = line.slice(6).trim();
                    if (jsonStr === '[DONE]') continue;
                    try {
                        const chunk = JSON.parse(jsonStr);
                        const text = chunk?.choices?.[0]?.delta?.content || '';
                        if (text) {
                            fullText += text;
                            onChunk(text, fullText);
                        }
                    } catch (e) { /* skip */ }
                }
            }
        }
        return fullText;
    }

    // Fallback: non-streaming
    const body = { model, messages, temperature: 0.4 };
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`API Error: ${response.status}`);
    const data = await response.json();
    return data?.choices?.[0]?.message?.content || '';
};

// ─── xAI GROK ────────────────────────────────────────────────────────
window.callGrok = async function(apiKey, model, systemPrompt, history, onChunk) {
    return window.callOpenAICompatible(apiKey, model, systemPrompt, history, onChunk,
        'https://api.x.ai/v1');
};

// ─── DEEPSEEK ────────────────────────────────────────────────────────
window.callDeepSeek = async function(apiKey, model, systemPrompt, history, onChunk) {
    return window.callOpenAICompatible(apiKey, model, systemPrompt, history, onChunk,
        'https://api.deepseek.com/v1');
};

// ─── GROQ (Ultra-Fast Inference) ─────────────────────────────────────
window.callGroq = async function(apiKey, model, systemPrompt, history, onChunk) {
    // Strip 'groq-' prefix from model name
    const actualModel = model.replace('groq-', '');
    return window.callOpenAICompatible(apiKey, actualModel, systemPrompt, history, onChunk,
        'https://api.groq.com/openai/v1');
};

// ─── MISTRAL AI ──────────────────────────────────────────────────────
window.callMistral = async function(apiKey, model, systemPrompt, history, onChunk) {
    return window.callOpenAICompatible(apiKey, model, systemPrompt, history, onChunk,
        'https://api.mistral.ai/v1');
};

// ─── TOGETHER AI ─────────────────────────────────────────────────────
window.callTogether = async function(apiKey, model, systemPrompt, history, onChunk) {
    // Strip 'together-' prefix
    const actualModel = model.replace('together-', '');
    return window.callOpenAICompatible(apiKey, actualModel, systemPrompt, history, onChunk,
        'https://api.together.xyz/v1');
};

// ─── FIREWORKS AI ────────────────────────────────────────────────────
window.callFireworks = async function(apiKey, model, systemPrompt, history, onChunk) {
    // Strip 'fireworks-' prefix
    const actualModel = model.replace('fireworks-', '');
    return window.callOpenAICompatible(apiKey, actualModel, systemPrompt, history, onChunk,
        'https://api.fireworks.ai/inference/v1');
};

// ─── COHERE ──────────────────────────────────────────────────────────
window.callCohere = async function(apiKey, model, systemPrompt, history, onChunk) {
    // Strip 'cohere-' prefix
    const actualModel = model.replace('cohere-', '');
    // Cohere uses /v2/chat (non-OpenAI), but also supports OpenAI-compat
    return window.callOpenAICompatible(apiKey, actualModel, systemPrompt, history, onChunk,
        'https://api.cohere.com/compatibility/v1');
};

// ─── OLLAMA (Local) ──────────────────────────────────────────────────
window.callOllama = async function(apiKey, model, systemPrompt, history, onChunk) {
    // Strip 'ollama-' prefix
    const actualModel = model.replace('ollama-', '');
    // Ollama runs locally on port 11434 and is OpenAI-compatible
    return window.callOpenAICompatible('ollama', actualModel, systemPrompt, history, onChunk,
        'http://127.0.0.1:11434/v1');
};