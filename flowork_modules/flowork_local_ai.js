// =========================================================================
// FLOWORK OS — Local AI Engine (Main Process Module)
// DCD Module that runs node-llama-cpp DIRECTLY in Electron's main process.
// NO HTTP, NO REST API, NO separate server — SATU TUBUH.
//
// Loaded by loadFloworkModules() in main.js via DCD (Dynamic Component Discovery)
// Communicates with renderer brain via IPC.
// =========================================================================

let _llama = null;
let _model = null;
let _context = null;
let _session = null;
let _modelPath = null;
let _isLoaded = false;
let _isLoading = false;
let _ipcMain = null;
let _state = null;
let _fs = null;
let _path = null;

// ESM dynamic import wrapper (node-llama-cpp is ESM-only)
let _getLlama, _LlamaChatSession, _defineChatSessionFunction, _resolveModelFile;

async function _importNodeLlama() {
    if (_getLlama) return;
    const mod = await import('node-llama-cpp');
    _getLlama = mod.getLlama;
    _LlamaChatSession = mod.LlamaChatSession;
    _defineChatSessionFunction = mod.defineChatSessionFunction;
    _resolveModelFile = mod.resolveModelFile;
}

// ─── Engine Initialization ───────────────────────────────────────
async function _initEngine() {
    if (_llama) return;
    await _importNodeLlama();
    _llama = await _getLlama();
    console.log('[LocalAI] ✅ llama.cpp engine initialized in main process');
}

// ─── Model Loading ───────────────────────────────────────────────
async function loadModel(modelPathOrUrl) {
    if (_isLoading) return { error: 'Model is already loading. Please wait.' };
    _isLoading = true;

    try {
        await _initEngine();

        // Unload previous model if exists
        if (_session) { _session = null; }
        if (_context) { await _context.dispose(); _context = null; }
        if (_model) { await _model.dispose(); _model = null; }

        // Resolve model path (could be URL for auto-download)
        let resolvedPath = modelPathOrUrl;

        // If it's a HuggingFace URL, use resolveModelFile
        if (modelPathOrUrl.startsWith('http') && _resolveModelFile) {
            const modelsDir = _path.join(_path.dirname(require.main?.filename || __dirname), 'models');
            if (!_fs.existsSync(modelsDir)) _fs.mkdirSync(modelsDir, { recursive: true });
            resolvedPath = await _resolveModelFile(modelPathOrUrl, { directory: modelsDir });
        }

        if (!_fs.existsSync(resolvedPath)) {
            _isLoading = false;
            return { error: `Model file not found: ${resolvedPath}` };
        }

        _model = await _llama.loadModel({ modelPath: resolvedPath });
        _context = await _model.createContext();
        _session = new _LlamaChatSession({ contextSequence: _context.getSequence() });
        _modelPath = resolvedPath;
        _isLoaded = true;
        _isLoading = false;

        const info = {
            path: resolvedPath,
            filename: _path.basename(resolvedPath),
        };

        console.log(`[LocalAI] ✅ Model loaded: ${info.filename}`);
        return { result: `Model loaded: ${info.filename}`, info };

    } catch (err) {
        _isLoading = false;
        _isLoaded = false;
        console.error('[LocalAI] ❌ Failed to load model:', err.message);
        return { error: `Failed to load model: ${err.message}` };
    }
}

// ─── Chat ────────────────────────────────────────────────────────
async function chat(prompt, options = {}) {
    if (!_isLoaded || !_session) {
        return { error: 'No model loaded. Call local_ai_load_model first.' };
    }

    try {
        const response = await _session.prompt(prompt, {
            maxTokens: options.maxTokens || undefined,
            temperature: options.temperature || undefined,
            topP: options.topP || undefined,
            topK: options.topK || undefined,
        });

        return { result: response };
    } catch (err) {
        return { error: `Chat failed: ${err.message}` };
    }
}

// ─── Chat with Streaming (sends tokens via IPC) ──────────────────
async function chatStream(prompt, event, requestId, options = {}) {
    if (!_isLoaded || !_session) {
        event.sender.send('local-ai:stream-error', requestId, 'No model loaded.');
        return;
    }

    try {
        let fullResponse = '';
        await _session.prompt(prompt, {
            maxTokens: options.maxTokens || undefined,
            temperature: options.temperature || undefined,
            onTextChunk(chunk) {
                fullResponse += chunk;
                event.sender.send('local-ai:stream-chunk', requestId, chunk);
            }
        });

        event.sender.send('local-ai:stream-done', requestId, fullResponse);
    } catch (err) {
        event.sender.send('local-ai:stream-error', requestId, err.message);
    }
}

// ─── Reset Session (clear conversation history) ──────────────────
async function resetSession() {
    if (!_isLoaded || !_context) {
        return { error: 'No model loaded.' };
    }
    _session = new _LlamaChatSession({ contextSequence: _context.getSequence() });
    return { result: 'Chat session reset. Conversation history cleared.' };
}

// ─── Embedding ───────────────────────────────────────────────────
async function embed(text) {
    if (!_isLoaded || !_model || !_context) {
        return { error: 'No model loaded.' };
    }

    try {
        const embContext = await _model.createEmbeddingContext();
        const embedding = await embContext.getEmbeddingFor(text);
        const vector = embedding.vector;
        await embContext.dispose();

        return {
            result: `Embedding generated (${vector.length} dimensions)`,
            vector: Array.from(vector),
            dimensions: vector.length
        };
    } catch (err) {
        return { error: `Embedding failed: ${err.message}` };
    }
}

// ─── List Available Models ───────────────────────────────────────
function listModels() {
    const modelsDir = _path.join(_path.dirname(require.main?.filename || __dirname), 'models');
    if (!_fs.existsSync(modelsDir)) {
        return { result: 'No models directory found.', models: [] };
    }

    const files = _fs.readdirSync(modelsDir).filter(f => f.endsWith('.gguf'));
    if (files.length === 0) {
        return { result: 'No GGUF models found in models/ directory.', models: [] };
    }

    const models = files.map(f => {
        const stat = _fs.statSync(_path.join(modelsDir, f));
        return {
            name: f,
            path: _path.join(modelsDir, f),
            size: `${(stat.size / 1e9).toFixed(2)} GB`,
            sizeBytes: stat.size
        };
    });

    let report = `📦 LOCAL MODELS (${models.length})\n`;
    models.forEach(m => { report += `  • ${m.name} (${m.size})\n`; });

    return { result: report, models };
}

// ─── Status ──────────────────────────────────────────────────────
function status() {
    return {
        result: JSON.stringify({
            engine: _llama ? 'ready' : 'not initialized',
            model: _isLoaded ? _path.basename(_modelPath) : 'none',
            isLoaded: _isLoaded,
            isLoading: _isLoading,
        }, null, 2),
        engine: _llama ? 'ready' : 'not initialized',
        model: _isLoaded ? _path.basename(_modelPath) : 'none',
        isLoaded: _isLoaded,
        isLoading: _isLoading,
    };
}

// ─── Unload ──────────────────────────────────────────────────────
async function unloadModel() {
    if (_session) _session = null;
    if (_context) { await _context.dispose(); _context = null; }
    if (_model) { await _model.dispose(); _model = null; }
    _isLoaded = false;
    _modelPath = null;
    return { result: '🧹 Model unloaded from memory.' };
}

// ═══════════════════════════════════════════════════════════════════
// DCD MODULE INTERFACE
// ═══════════════════════════════════════════════════════════════════
module.exports = {
    name: 'Flowork Local AI',

    init(ipcMain, state, childProc, path, app, __dirname, fs) {
        _ipcMain = ipcMain;
        _state = state;
        _fs = fs;
        _path = path;

        console.log('[DCD] ✅ Flowork Local AI module loaded (satu tubuh)');

        // ── IPC Handlers ──────────────────────────────────────────

        ipcMain.handle('local-ai:load-model', async (event, modelPath) => {
            return await loadModel(modelPath);
        });

        ipcMain.handle('local-ai:chat', async (event, prompt, options) => {
            return await chat(prompt, options);
        });

        ipcMain.handle('local-ai:chat-stream', async (event, prompt, requestId, options) => {
            await chatStream(prompt, event, requestId, options);
            return { result: 'Stream started' };
        });

        ipcMain.handle('local-ai:reset-session', async () => {
            return await resetSession();
        });

        ipcMain.handle('local-ai:embed', async (event, text) => {
            return await embed(text);
        });

        ipcMain.handle('local-ai:list-models', () => {
            return listModels();
        });

        ipcMain.handle('local-ai:status', () => {
            return status();
        });

        ipcMain.handle('local-ai:unload', async () => {
            return await unloadModel();
        });

        // Pre-init engine in background (don't await — non-blocking)
        _initEngine().catch(err => {
            console.warn('[LocalAI] Engine pre-init warning:', err.message);
        });
    }
};
