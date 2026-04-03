// =========================================================================
// FLOWORK OS — Local AI Brain Bridge (Renderer Process)
// Connects brain modules to the Local AI engine running in main process.
//
// Architecture: SATU TUBUH (One Body)
//   Renderer (this file) ──IPC──▶ Main Process (flowork_local_ai.js)
//                                      │
//                                      ▼
//                              node-llama-cpp (C++ native)
//                                      │
//                                      ▼
//                              GGUF Model (GPU/RAM)
//
// NO HTTP, NO REST API, NO separate server.
// Direct function calls via Electron IPC.
//
// Exposes: window.floworkLocalAI
// =========================================================================

(function() {
    'use strict';

    // ─── IPC Bridge ──────────────────────────────────────────────────
    // Uses window.wsCommand (preload IPC) or electron.ipcRenderer
    function _ipc(channel, ...args) {
        // Method 1: Flowork preload bridge
        if (window.electronAPI && window.electronAPI.invoke) {
            return window.electronAPI.invoke(channel, ...args);
        }
        // Method 2: Direct ipcRenderer (nodeIntegration: true)
        if (typeof require !== 'undefined') {
            try {
                const { ipcRenderer } = require('electron');
                return ipcRenderer.invoke(channel, ...args);
            } catch(e) {}
        }
        // Method 3: Fallback error
        return Promise.reject(new Error('No IPC bridge available. Is this running in Electron?'));
    }

    function _onIpc(channel, callback) {
        if (typeof require !== 'undefined') {
            try {
                const { ipcRenderer } = require('electron');
                ipcRenderer.on(channel, callback);
                return;
            } catch(e) {}
        }
    }

    // ─── Model Loading ───────────────────────────────────────────────
    async function loadModel(input = {}) {
        const modelPath = input.model || input.path || input.modelPath || '';
        if (!modelPath) return { error: 'Model path required. Example: loadModel({ model: "C:/models/gemma-3.gguf" })' };

        try {
            return await _ipc('local-ai:load-model', modelPath);
        } catch (err) {
            return { error: `Load model failed: ${err.message}` };
        }
    }

    // ─── Chat (one-shot) ─────────────────────────────────────────────
    async function chat(input = {}) {
        const prompt = input.prompt || input.message || '';
        if (!prompt) return { error: 'No prompt provided.' };

        try {
            return await _ipc('local-ai:chat', prompt, {
                maxTokens: input.maxTokens || input.max_tokens,
                temperature: input.temperature,
                topP: input.top_p || input.topP,
                topK: input.top_k || input.topK,
            });
        } catch (err) {
            return { error: `Chat failed: ${err.message}` };
        }
    }

    // ─── Chat Streaming ──────────────────────────────────────────────
    async function chatStream(input = {}, onChunk) {
        const prompt = input.prompt || input.message || '';
        if (!prompt) return { error: 'No prompt provided.' };

        const requestId = 'stream_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);

        return new Promise((resolve, reject) => {
            let fullResponse = '';

            _onIpc('local-ai:stream-chunk', (event, id, chunk) => {
                if (id !== requestId) return;
                fullResponse += chunk;
                if (onChunk) onChunk(chunk);
            });

            _onIpc('local-ai:stream-done', (event, id, response) => {
                if (id !== requestId) return;
                resolve({ result: response });
            });

            _onIpc('local-ai:stream-error', (event, id, error) => {
                if (id !== requestId) return;
                resolve({ error: `Stream failed: ${error}` });
            });

            _ipc('local-ai:chat-stream', prompt, requestId, {
                maxTokens: input.maxTokens || input.max_tokens,
                temperature: input.temperature,
            }).catch(err => resolve({ error: err.message }));
        });
    }

    // ─── Reset Session ───────────────────────────────────────────────
    async function resetSession(input = {}) {
        try {
            return await _ipc('local-ai:reset-session');
        } catch (err) {
            return { error: `Reset failed: ${err.message}` };
        }
    }

    // ─── Embedding ───────────────────────────────────────────────────
    async function embed(input = {}) {
        const text = input.text || input.input || input.prompt || '';
        if (!text) return { error: 'No text provided.' };

        try {
            return await _ipc('local-ai:embed', text);
        } catch (err) {
            return { error: `Embedding failed: ${err.message}` };
        }
    }

    // ─── List Models ─────────────────────────────────────────────────
    async function listModels(input = {}) {
        try {
            return await _ipc('local-ai:list-models');
        } catch (err) {
            return { error: `List models failed: ${err.message}` };
        }
    }

    // ─── Status ──────────────────────────────────────────────────────
    async function status(input = {}) {
        try {
            return await _ipc('local-ai:status');
        } catch (err) {
            return { error: `Status check failed: ${err.message}` };
        }
    }

    // ─── Unload ──────────────────────────────────────────────────────
    async function unloadModel(input = {}) {
        try {
            return await _ipc('local-ai:unload');
        } catch (err) {
            return { error: `Unload failed: ${err.message}` };
        }
    }

    // ─── Expose to window ────────────────────────────────────────────
    window.floworkLocalAI = {
        // Model lifecycle
        loadModel,
        unloadModel,
        listModels,
        status,

        // Inference
        chat,
        chatStream,
        resetSession,

        // Embeddings
        embed,
    };

    console.log('[Brain] ✅ Flowork Local AI bridge loaded — SATU TUBUH (IPC direct, no HTTP)');

})();
