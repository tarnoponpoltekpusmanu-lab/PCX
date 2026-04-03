// =========================================================================
// FLOWORK OS — Brain Vision Module (VLM Integration)
// Local & API-based visual intelligence for screenshot analysis.
// Supports: Gemini Vision, Ollama (LLaVA/Moondream), Browser Canvas
// =========================================================================

(function() {
    'use strict';

    const OLLAMA_URL = 'http://127.0.0.1:11434';
    const VISION_MODELS = {
        ollama_llava: { name: 'llava', type: 'ollama', description: 'LLaVA — Local VLM via Ollama' },
        ollama_moondream: { name: 'moondream', type: 'ollama', description: 'Moondream — Lightweight local VLM' },
        ollama_bakllava: { name: 'bakllava', type: 'ollama', description: 'BakLLaVA — Enhanced local vision' },
        gemini_vision: { name: 'gemini', type: 'api', description: 'Gemini Flash — Cloud vision API' },
    };

    let preferredModel = 'gemini_vision';  // Default: cloud fallback
    let ollamaAvailable = false;
    let analysisCache = {};  // hash → { result, timestamp }
    const CACHE_TTL = 60000;  // 1 minute cache

    // ─── Check Ollama availability on load ──────────────────────────────
    async function _checkOllama() {
        try {
            const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
            if (res.ok) {
                const data = await res.json();
                const models = (data.models || []).map(m => m.name?.split(':')[0]);
                ollamaAvailable = true;

                // Auto-prefer local model if available
                if (models.includes('llava')) preferredModel = 'ollama_llava';
                else if (models.includes('moondream')) preferredModel = 'ollama_moondream';
                else if (models.includes('bakllava')) preferredModel = 'ollama_bakllava';

                console.log(`[Vision] 🔍 Ollama detected! Models: ${models.join(', ')}. Using: ${preferredModel}`);
                return models;
            }
        } catch(e) {
            ollamaAvailable = false;
        }
        return [];
    }
    _checkOllama();

    // ─── Capture current browser tab as base64 ──────────────────────────
    async function _captureScreenshot(tabId) {
        if (window.wsCommand) {
            try {
                const res = await window.wsCommand('capture_browser', { tabId: tabId || 'current' });
                if (res?.screenshot) return res.screenshot;
                if (res?.result) return res.result;
            } catch(e) {}
        }

        // Fallback: capture via canvas (renderer process)
        try {
            const canvas = document.createElement('canvas');
            const body = document.body;
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
            // Use html2canvas-like approach
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#1a1a2e';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#fff';
            ctx.font = '14px monospace';
            ctx.fillText('[Vision] Screenshot captured from renderer', 20, 30);
            return canvas.toDataURL('image/png').split(',')[1];
        } catch(e) {
            return null;
        }
    }

    // ─── Analyze image via Ollama (LOCAL) ────────────────────────────────
    async function _analyzeOllama(modelName, base64Image, prompt) {
        const payload = {
            model: modelName,
            prompt: prompt || 'Describe what you see in this image in detail. Identify all UI elements, text, buttons, and layout.',
            images: [base64Image],
            stream: false,
        };

        const res = await fetch(`${OLLAMA_URL}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(60000),
        });

        if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
        const data = await res.json();
        return {
            analysis: data.response,
            model: modelName,
            local: true,
            tokenCount: data.eval_count || 0,
            duration: data.total_duration ? (data.total_duration / 1e9).toFixed(2) + 's' : 'unknown',
        };
    }

    // ─── Analyze image via Gemini Vision (CLOUD) ────────────────────────
    async function _analyzeGemini(base64Image, prompt) {
        // Get raw API key from DOM / localStorage (getConfig returns truncated key)
        let apiKey = window.getEl?.('input-api-key')?.value || '';
        if (!apiKey) {
            try { apiKey = JSON.parse(localStorage.getItem('flowork_builder_config') || '{}').apiKey || ''; } catch(e) {}
        }
        const model = window.getEl?.('select-provider')?.value || 'gemini-2.5-flash-preview-05-20';

        if (!apiKey) throw new Error('No API key configured for Gemini Vision');

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const payload = {
            contents: [{
                parts: [
                    { text: prompt || 'Analyze this screenshot. Describe all UI elements, text content, buttons, inputs, layout, and any errors visible. Be precise about positions.' },
                    { inline_data: { mime_type: 'image/png', data: base64Image } }
                ]
            }],
            generationConfig: { temperature: 0.2, maxOutputTokens: 2000 },
        };

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(30000),
        });

        if (!res.ok) throw new Error(`Gemini Vision error: ${res.status}`);
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No analysis returned';

        // Track cost
        if (window.costTracker) {
            window.costTracker.recordCall(model, prompt.length, text.length, 1);
        }

        return {
            analysis: text,
            model: model,
            local: false,
            tokenCount: data.usageMetadata?.totalTokenCount || 0,
            duration: 'cloud',
        };
    }

    // ─── Hash for cache ─────────────────────────────────────────────────
    function _hashImage(base64) {
        let hash = 0;
        const sample = base64.substring(0, 1000) + base64.substring(base64.length - 1000);
        for (let i = 0; i < sample.length; i++) {
            hash = ((hash << 5) - hash) + sample.charCodeAt(i);
            hash |= 0;
        }
        return hash.toString(36);
    }

    // ═══ PUBLIC API ═══════════════════════════════════════════════════════

    /**
     * Analyze a screenshot or image
     * Tools: vision_analyze, analyze_screenshot
     */
    async function analyzeImage(input) {
        const prompt = input.prompt || input.question || 'Describe this UI screenshot in detail.';
        let base64 = input.image || input.base64 || input.screenshot;

        // If no image provided, capture current tab
        if (!base64) {
            base64 = await _captureScreenshot(input.tab_id || input.tabId);
            if (!base64) return { error: 'Failed to capture screenshot. No image available.' };
        }

        // Remove data URL prefix if present
        if (base64.startsWith('data:')) base64 = base64.split(',')[1];

        // Check cache
        const hash = _hashImage(base64);
        const cacheKey = `${hash}_${prompt.substring(0, 50)}`;
        if (analysisCache[cacheKey] && Date.now() - analysisCache[cacheKey].timestamp < CACHE_TTL) {
            return { result: `[CACHED] ${analysisCache[cacheKey].result.analysis}` };
        }

        let result;
        try {
            const modelConfig = VISION_MODELS[preferredModel];

            if (modelConfig?.type === 'ollama' && ollamaAvailable) {
                result = await _analyzeOllama(modelConfig.name, base64, prompt);
            } else {
                result = await _analyzeGemini(base64, prompt);
            }

            // Cache result
            analysisCache[cacheKey] = { result, timestamp: Date.now() };

            // Clean old cache entries
            const now = Date.now();
            for (const [k, v] of Object.entries(analysisCache)) {
                if (now - v.timestamp > CACHE_TTL * 5) delete analysisCache[k];
            }

            // Track analytics
            if (window.toolAnalytics) {
                window.toolAnalytics.record('vision_analyze', true, 0);
            }

            return {
                result: `🔍 VISION ANALYSIS (${result.local ? '🏠 LOCAL' : '☁️ CLOUD'} — ${result.model})\n` +
                        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                        `${result.analysis}\n\n` +
                        `📊 Tokens: ${result.tokenCount} | Duration: ${result.duration}`
            };

        } catch(err) {
            // If local fails, fallback to cloud
            if (preferredModel !== 'gemini_vision') {
                console.warn(`[Vision] Local model failed, falling back to Gemini: ${err.message}`);
                try {
                    result = await _analyzeGemini(base64, prompt);
                    return {
                        result: `🔍 VISION ANALYSIS (☁️ FALLBACK — ${result.model})\n` +
                                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                                `${result.analysis}\n\n` +
                                `⚠️ Local model unavailable. Using cloud fallback.\n` +
                                `📊 Tokens: ${result.tokenCount}`
                    };
                } catch(e2) {
                    return { error: `Vision analysis failed: ${e2.message}` };
                }
            }
            return { error: `Vision analysis failed: ${err.message}` };
        }
    }

    /**
     * Find UI elements in a screenshot
     * Tool: vision_find_element
     */
    async function findElement(input) {
        const target = input.element || input.target || input.find;
        if (!target) return { error: 'Missing target element description.' };

        let base64 = input.image || input.base64;
        if (!base64) {
            base64 = await _captureScreenshot(input.tab_id);
            if (!base64) return { error: 'Failed to capture screenshot.' };
        }
        if (base64.startsWith('data:')) base64 = base64.split(',')[1];

        const prompt = `I need to find this UI element: "${target}". 
Analyze the screenshot and tell me:
1. Is the element visible? (yes/no)
2. Approximate position (x%, y% from top-left)
3. Element type (button, input, link, text, image, etc.)
4. Current state (enabled/disabled, checked/unchecked, etc.)
5. Suggested CSS selector to target it
6. Any nearby text or labels that identify it

Be very precise about the position.`;

        return analyzeImage({ ...input, base64, prompt });
    }

    /**
     * OCR - Extract text from screenshot
     * Tool: vision_ocr
     */
    async function extractText(input) {
        let base64 = input.image || input.base64;
        if (!base64) {
            base64 = await _captureScreenshot(input.tab_id);
            if (!base64) return { error: 'Failed to capture screenshot.' };
        }
        if (base64.startsWith('data:')) base64 = base64.split(',')[1];

        const prompt = `Extract ALL visible text from this screenshot. Output ONLY the text content, organized by sections/areas. Include:
- Headings and titles
- Button labels
- Input field values and placeholders
- Menu items
- Status messages
- Error messages
- Any other readable text

Format as structured text maintaining the visual hierarchy.`;

        return analyzeImage({ ...input, base64, prompt });
    }

    /**
     * Compare two screenshots for changes
     * Tool: vision_diff
     */
    async function diffScreenshots(input) {
        const before = input.before || input.image1;
        const after = input.after || input.image2;

        if (!before || !after) return { error: 'Need both "before" and "after" images for diff.' };

        const prompt = `Compare these two screenshots and describe ALL differences:
1. New elements that appeared
2. Elements that disappeared
3. Text that changed
4. Layout/position changes
5. Color/style changes
6. State changes (loading, error, success, etc.)

Be specific about each difference.`;

        // Use Gemini for multi-image (Ollama may not support well)
        let apiKey = window.getEl?.('input-api-key')?.value || '';
        if (!apiKey) {
            try { apiKey = JSON.parse(localStorage.getItem('flowork_builder_config') || '{}').apiKey || ''; } catch(e) {}
        }
        if (!apiKey) return { error: 'Vision diff requires Gemini API key.' };

        const model = window.getEl?.('select-provider')?.value || 'gemini-2.5-flash-preview-05-20';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const b1 = before.startsWith('data:') ? before.split(',')[1] : before;
        const b2 = after.startsWith('data:') ? after.split(',')[1] : after;

        const payload = {
            contents: [{
                parts: [
                    { text: 'BEFORE screenshot:' },
                    { inline_data: { mime_type: 'image/png', data: b1 } },
                    { text: 'AFTER screenshot:' },
                    { inline_data: { mime_type: 'image/png', data: b2 } },
                    { text: prompt },
                ]
            }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 2000 },
        };

        try {
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No differences detected.';
            return { result: `🔍 VISION DIFF\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${text}` };
        } catch(e) {
            return { error: `Vision diff failed: ${e.message}` };
        }
    }

    /**
     * Set preferred vision model
     * Tool: vision_set_model
     */
    function setModel(input) {
        const model = input.model || input.name;
        if (!model) {
            return {
                result: `🔍 VISION MODELS\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `Current: ${preferredModel}\n` +
                    `Ollama available: ${ollamaAvailable}\n\n` +
                    Object.entries(VISION_MODELS).map(([k, v]) =>
                        `${k === preferredModel ? '→ ' : '  '}${k}: ${v.description}`
                    ).join('\n')
            };
        }

        if (VISION_MODELS[model]) {
            preferredModel = model;
            return { result: `✅ Vision model set to: ${model} (${VISION_MODELS[model].description})` };
        }

        return { error: `Unknown model: ${model}. Available: ${Object.keys(VISION_MODELS).join(', ')}` };
    }

    /**
     * Check vision system status
     * Tool: vision_status
     */
    async function status(input) {
        const models = await _checkOllama();

        return {
            result: `🔍 VISION SYSTEM STATUS\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `Preferred model: ${preferredModel}\n` +
                    `Ollama status: ${ollamaAvailable ? '🟢 Available' : '🔴 Not found'}\n` +
                    `Ollama models: ${models.length > 0 ? models.join(', ') : 'none'}\n` +
                    `Gemini API: ${(window.getEl?.('input-api-key')?.value) ? '🟢 Key configured' : '🔴 No key'}\n` +
                    `Cache entries: ${Object.keys(analysisCache).length}\n` +
                    `\nTo use local vision:\n` +
                    `  1. Install Ollama: https://ollama.ai\n` +
                    `  2. Run: ollama pull llava\n` +
                    `  3. System auto-detects and uses local model`
        };
    }

    // ─── AUTO VISION LOOP ─────────────────────────────────────────────
    let _autoVisionTimer = null;
    let _autoVisionInterval = 5000;
    let _lastScreenHash = '';

    function _simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i += 10) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash = hash & hash;
        }
        return hash.toString(36);
    }

    async function autoStart(input) {
        if (_autoVisionTimer) return { result: 'Auto-vision already running. Use vision_auto_stop first.' };

        _autoVisionInterval = input.interval || input.every || 5000;
        const question = input.question || input.prompt || 'Describe what you see. Report any changes or issues.';

        _autoVisionTimer = setInterval(async () => {
            try {
                const result = await analyzeImage({ question, inject: true });
                const text = result?.result || '';
                const hash = _simpleHash(text);

                if (hash !== _lastScreenHash) {
                    _lastScreenHash = hash;
                    // Inject change notification into AI context
                    if (window.chatHistory && input.auto_inject !== false) {
                        window.chatHistory.push({
                            role: 'system',
                            content: `[👁️ VISION CHANGE DETECTED] Auto-vision loop detected visual change:\n${text.substring(0, 500)}\n\nEvaluate if this is relevant to your current task.`
                        });
                    }
                    console.log('[Vision] 👁️ Auto-vision: change detected');
                }
            } catch(e) {
                console.warn('[Vision] Auto-vision error:', e.message);
            }
        }, _autoVisionInterval);

        return {
            result: `👁️ AUTO-VISION STARTED\n` +
                    `Interval: ${_autoVisionInterval}ms\n` +
                    `Question: "${question}"\n` +
                    `Changes will be auto-injected into AI context.\n` +
                    `Use vision_auto_stop to stop.`
        };
    }

    function autoStop(input) {
        if (_autoVisionTimer) {
            clearInterval(_autoVisionTimer);
            _autoVisionTimer = null;
        }
        _lastScreenHash = '';
        return { result: '👁️ Auto-vision stopped.' };
    }

    async function clickAt(input) {
        const x = input.x;
        const y = input.y;
        if (x === undefined || y === undefined) {
            return { error: 'Missing x,y coordinates. Usage: vision_click_at { x: 50, y: 30 } (percentage 0-100)' };
        }

        // Get the active webview/browser tab dimensions
        const tabId = window.activeAppBrowserTabId || 'main';
        try {
            // Attempt to use WebSocket IPC to execute click at coordinates
            if (window.sendBrowserCommand) {
                const xPercent = Math.max(0, Math.min(100, parseFloat(x)));
                const yPercent = Math.max(0, Math.min(100, parseFloat(y)));

                // Execute JS in the target page to click at percentage coordinates
                const clickScript = `
                    (function() {
                        var el = document.elementFromPoint(
                            window.innerWidth * ${xPercent / 100},
                            window.innerHeight * ${yPercent / 100}
                        );
                        if (el) {
                            el.click();
                            return 'Clicked: ' + el.tagName + (el.id ? '#' + el.id : '') + (el.className ? '.' + el.className.split(' ')[0] : '');
                        }
                        return 'No element found at coordinates';
                    })()
                `;

                const result = await window.sendBrowserCommand('execute_js', { code: clickScript, tabId });
                return { result: `🖱️ Click at (${xPercent}%, ${yPercent}%): ${result?.result || 'executed'}` };
            }

            return { error: 'Browser command interface not available. Use click_element with a CSS selector instead.' };
        } catch(err) {
            return { error: `Click failed: ${err.message}` };
        }
    }

    // ─── Expose ──────────────────────────────────────────────────────────
    window.floworkVision = {
        analyzeImage,
        findElement,
        extractText,
        diffScreenshots,
        setModel,
        status,
        autoStart,
        autoStop,
        clickAt,
    };

    console.log(`[Brain] ✅ Vision module loaded (preferred: ${preferredModel}, ollama: ${ollamaAvailable ? 'yes' : 'no'})`);

})();
