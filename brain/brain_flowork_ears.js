// =========================================================================
// FLOWORK OS — Brain Ears Module (Audio Input + Event Triggers)
// Gives the AI "ears" — audio transcription, file watchers, webhooks.
//
// Tools: transcribe_audio, watch_folder, unwatch_folder,
//        start_webhook, stop_webhook, ear_status
// =========================================================================

(function() {
    'use strict';

    const fs = window.originalNodeRequire?.('fs') || null;
    const path = window.originalNodeRequire?.('path') || null;
    const http = window.originalNodeRequire?.('http') || null;

    // ─── State ──────────────────────────────────────────────────────
    const _watchers = {};        // watchId → { path, handler, watcher }
    let _watcherCounter = 0;
    let _webhookServer = null;
    let _webhookPort = 5050;
    const _webhookLog = [];
    const MAX_WEBHOOK_LOG = 100;

    // ─── Whisper Transcription ──────────────────────────────────────
    async function transcribeAudio(input) {
        const filePath = input.file || input.path || input.audio;
        const provider = input.provider || 'openai';   // openai, groq
        const lang = input.language || input.lang || null;

        if (!filePath) return { error: 'Missing file path. Usage: transcribe_audio { file: "audio.mp3" }' };

        // Get API key
        let apiKey = input.api_key || '';
        if (!apiKey) {
            const config = window._envConfig || {};
            if (provider === 'groq') apiKey = config.GROQ_API_KEY || '';
            else apiKey = config.OPENAI_API_KEY || '';
            if (!apiKey) {
                try {
                    const saved = JSON.parse(localStorage.getItem('flowork_builder_config') || '{}');
                    apiKey = saved.openaiKey || '';
                } catch(e) {}
            }
        }

        if (!apiKey) return { error: `No API key for ${provider}. Set OPENAI_API_KEY or GROQ_API_KEY in .env` };

        // Read file
        if (!fs) return { error: 'File system not available (not in Electron).' };

        const absPath = path.resolve(window._fmBasePath || '.', filePath);
        if (!fs.existsSync(absPath)) return { error: `File not found: ${absPath}` };

        try {
            const fileBuffer = fs.readFileSync(absPath);
            const ext = path.extname(absPath).toLowerCase();
            const mimeMap = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.webm': 'audio/webm', '.flac': 'audio/flac' };
            const mime = mimeMap[ext] || 'audio/mpeg';
            const fileName = path.basename(absPath);

            // Build FormData
            const blob = new Blob([fileBuffer], { type: mime });
            const formData = new FormData();
            formData.append('file', blob, fileName);
            formData.append('model', provider === 'groq' ? 'whisper-large-v3' : 'whisper-1');
            if (lang) formData.append('language', lang);
            formData.append('response_format', 'verbose_json');

            // API endpoint
            const apiBase = provider === 'groq'
                ? 'https://api.groq.com/openai/v1'
                : 'https://api.openai.com/v1';

            const resp = await fetch(`${apiBase}/audio/transcriptions`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${apiKey}` },
                body: formData,
                signal: AbortSignal.timeout(120000),  // 2 min timeout
            });

            if (!resp.ok) {
                const errText = await resp.text();
                return { error: `Whisper API ${resp.status}: ${errText.substring(0, 300)}` };
            }

            const data = await resp.json();
            const text = data.text || '';
            const duration = data.duration || 0;
            const language = data.language || 'unknown';

            return {
                result: `🎤 TRANSCRIPTION COMPLETE\\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\\n` +
                        `File: ${fileName}\\n` +
                        `Language: ${language}\\n` +
                        `Duration: ${duration.toFixed(1)}s\\n` +
                        `Provider: ${provider} (${provider === 'groq' ? 'whisper-large-v3' : 'whisper-1'})\\n\\n` +
                        `--- TRANSCRIPT ---\\n${text}\\n--- END ---`
            };
        } catch(err) {
            return { error: `Transcription failed: ${err.message}` };
        }
    }

    // ─── File Watcher ───────────────────────────────────────────────
    function watchFolder(input) {
        const folderPath = input.path || input.folder || input.dir;
        if (!folderPath) return { error: 'Missing path to watch.' };
        if (!fs) return { error: 'File system not available.' };

        const absPath = path.resolve(window._fmBasePath || '.', folderPath);
        if (!fs.existsSync(absPath)) return { error: `Path not found: ${absPath}` };

        const watchId = `watch_${++_watcherCounter}`;
        const pattern = input.pattern || '*';   // glob pattern
        const events = [];

        try {
            const watcher = fs.watch(absPath, { recursive: input.recursive !== false }, (eventType, filename) => {
                if (!filename) return;
                // Pattern filter
                if (pattern !== '*' && !filename.includes(pattern.replace('*', ''))) return;

                const event = {
                    type: eventType,  // 'rename' or 'change'
                    file: filename,
                    path: path.join(absPath, filename),
                    ts: new Date().toISOString(),
                };

                events.push(event);
                if (events.length > 50) events.shift();

                // Auto-inject into AI context
                if (window.chatHistory && input.auto_inject !== false) {
                    window.chatHistory.push({
                        role: 'system',
                        content: `[📁 FILE ${eventType.toUpperCase()}] ${filename} at ${absPath}\\n` +
                                 `Watcher: ${watchId} | Time: ${event.ts}\\n` +
                                 `The file system has changed. Evaluate if this is relevant to your current task.`
                    });
                }

                console.log(`[Ears] 📁 ${eventType}: ${filename}`);
            });

            _watchers[watchId] = {
                path: absPath,
                pattern,
                watcher,
                events,
                startedAt: new Date().toISOString(),
            };

            return {
                result: `👁️ File watcher started: ${watchId}\\n` +
                        `Path: ${absPath}\\n` +
                        `Pattern: ${pattern}\\n` +
                        `Recursive: ${input.recursive !== false}\\n` +
                        `Auto-inject to AI: ${input.auto_inject !== false}\\n\\n` +
                        `Use unwatch_folder { id: "${watchId}" } to stop.`
            };
        } catch(err) {
            return { error: `Watch failed: ${err.message}` };
        }
    }

    function unwatchFolder(input) {
        const id = input.id || input.watch_id;
        if (!id) {
            // Stop all
            for (const [wid, w] of Object.entries(_watchers)) {
                try { w.watcher.close(); } catch(e) {}
                delete _watchers[wid];
            }
            return { result: '🔇 All file watchers stopped.' };
        }

        if (!_watchers[id]) return { error: `Watcher "${id}" not found.` };
        try { _watchers[id].watcher.close(); } catch(e) {}
        delete _watchers[id];
        return { result: `🔇 Watcher "${id}" stopped.` };
    }

    // ─── Webhook Listener ───────────────────────────────────────────
    function startWebhook(input) {
        if (_webhookServer) return { result: `Webhook already running on port ${_webhookPort}. Use stop_webhook first.` };
        if (!http) return { error: 'HTTP module not available (not in Electron).' };

        const port = input.port || _webhookPort;
        _webhookPort = port;
        const authToken = input.token || input.auth || null;

        try {
            _webhookServer = http.createServer((req, res) => {
                // CORS headers
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

                if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
                if (req.method !== 'POST') { res.writeHead(405); res.end('Method Not Allowed'); return; }

                // Auth check
                if (authToken) {
                    const authHeader = req.headers['authorization'] || '';
                    if (authHeader !== `Bearer ${authToken}`) {
                        res.writeHead(401); res.end('Unauthorized'); return;
                    }
                }

                let body = '';
                req.on('data', chunk => { body += chunk; if (body.length > 100000) req.destroy(); });
                req.on('end', () => {
                    let parsed;
                    try { parsed = JSON.parse(body); } catch(e) { parsed = { raw: body }; }

                    const entry = {
                        path: req.url,
                        body: parsed,
                        ts: new Date().toISOString(),
                        ip: req.socket.remoteAddress,
                    };

                    _webhookLog.push(entry);
                    if (_webhookLog.length > MAX_WEBHOOK_LOG) _webhookLog.shift();

                    // Auto-inject into AI context
                    if (window.chatHistory) {
                        window.chatHistory.push({
                            role: 'system',
                            content: `[📡 WEBHOOK RECEIVED] POST ${req.url}\\n` +
                                     `From: ${entry.ip} | Time: ${entry.ts}\\n` +
                                     `Body: ${JSON.stringify(parsed).substring(0, 500)}\\n\\n` +
                                     `Process this webhook event.`
                        });
                    }

                    console.log(`[Ears] 📡 Webhook: POST ${req.url} from ${entry.ip}`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'ok', message: 'Event received by Flowork AI' }));
                });
            });

            _webhookServer.listen(port, '127.0.0.1', () => {
                console.log(`[Ears] 📡 Webhook listener started on port ${port}`);
            });

            return {
                result: `📡 Webhook listener started\\n` +
                        `URL: http://127.0.0.1:${port}/\\n` +
                        `Auth: ${authToken ? 'Bearer token required' : 'none'}\\n\\n` +
                        `Send POST requests to inject context into AI.\\n` +
                        `Example: curl -X POST http://127.0.0.1:${port}/event -d '{"message": "hello"}'\\n\\n` +
                        `Use stop_webhook to stop.`
            };
        } catch(err) {
            return { error: `Webhook start failed: ${err.message}` };
        }
    }

    function stopWebhook(input) {
        if (!_webhookServer) return { result: 'No webhook server running.' };
        try { _webhookServer.close(); } catch(e) {}
        _webhookServer = null;
        return { result: `📡 Webhook listener stopped (port ${_webhookPort}).` };
    }

    // ─── Status ─────────────────────────────────────────────────────
    function earStatus(input) {
        const watcherList = Object.entries(_watchers);
        let report = `👂 EARS STATUS\\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\\n`;

        // Whisper
        report += `\\n🎤 Audio Transcription:\\n`;
        report += `  OpenAI Whisper: ${(window._envConfig?.OPENAI_API_KEY) ? '✅ ready' : '❌ no API key'}\\n`;
        report += `  Groq Whisper: ${(window._envConfig?.GROQ_API_KEY) ? '✅ ready' : '❌ no API key'}\\n`;

        // File watchers
        report += `\\n📁 File Watchers (${watcherList.length}):\\n`;
        if (watcherList.length === 0) {
            report += `  No active watchers.\\n`;
        } else {
            for (const [id, w] of watcherList) {
                report += `  • ${id}: ${w.path} (${w.events.length} events since ${w.startedAt})\\n`;
            }
        }

        // Webhook
        report += `\\n📡 Webhook Listener:\\n`;
        report += `  Status: ${_webhookServer ? '🟢 Running on port ' + _webhookPort : '⚪ Not running'}\\n`;
        report += `  Log entries: ${_webhookLog.length}\\n`;

        if (_webhookLog.length > 0) {
            report += `  Last event: ${_webhookLog[_webhookLog.length - 1].ts} — POST ${_webhookLog[_webhookLog.length - 1].path}\\n`;
        }

        return { result: report };
    }

    // ═══════════════════════════════════════════════════════════════
    // REAL-TIME MIC STREAMING — Web Audio API → Whisper chunks
    // ═══════════════════════════════════════════════════════════════
    let _micStream = null;
    let _micContext = null;
    let _micProcessor = null;
    let _micActive = false;
    let _micBuffer = [];
    const _MIC_CHUNK_INTERVAL = 3000;  // Send every 3 seconds
    let _micChunkTimer = null;

    async function startRealtimeMic(input) {
        if (_micActive) return { result: '🎙️ Real-time mic already active.' };

        try {
            _micStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: 16000,
                    echoCancellation: true,
                    noiseSuppression: true,
                }
            });

            _micContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
            const source = _micContext.createMediaStreamSource(_micStream);

            // Use ScriptProcessor for PCM capture (worklet not needed for simplicity)
            _micProcessor = _micContext.createScriptProcessor(4096, 1, 1);
            _micBuffer = [];

            _micProcessor.onaudioprocess = (event) => {
                if (!_micActive) return;
                const pcm = event.inputBuffer.getChannelData(0);
                _micBuffer.push(new Float32Array(pcm));
            };

            source.connect(_micProcessor);
            _micProcessor.connect(_micContext.destination);
            _micActive = true;

            // Periodically send chunks to Whisper
            const chunkMs = input.chunk_ms || _MIC_CHUNK_INTERVAL;
            const autoInject = input.auto_inject !== false;
            const language = input.language || 'auto';

            _micChunkTimer = setInterval(async () => {
                if (_micBuffer.length === 0) return;

                // Merge chunks into single Float32Array
                const totalLength = _micBuffer.reduce((acc, chunk) => acc + chunk.length, 0);
                const merged = new Float32Array(totalLength);
                let offset = 0;
                for (const chunk of _micBuffer) {
                    merged.set(chunk, offset);
                    offset += chunk.length;
                }
                _micBuffer = [];

                // Check if audio has enough energy (silence detection)
                const rms = Math.sqrt(merged.reduce((sum, s) => sum + s * s, 0) / merged.length);
                if (rms < 0.01) return; // Skip silence

                // Convert Float32 PCM to WAV blob
                const wavBlob = _float32ToWavBlob(merged, 16000);

                // Send to Whisper via existing transcribeAudio
                try {
                    const result = await transcribeAudio({
                        audio_blob: wavBlob,
                        language: language,
                    });

                    if (result?.result && !result.error) {
                        const text = result.result.replace(/^.*Transcription:\s*"?|"?\s*$/g, '').trim();
                        if (text && text.length > 2 && text !== '[silence]' && text !== '...') {
                            console.log(`[Ears] 🎙️ Real-time: "${text}"`);
                            if (autoInject && window.chatHistory) {
                                window.chatHistory.push({
                                    role: 'user',
                                    content: text,
                                    _source: 'realtime_mic',
                                });
                                if (window.appendChatMessage) {
                                    window.appendChatMessage('user', `🎙️ ${text}`);
                                }
                                // Auto-trigger brain if not already running
                                if (window.floworkBrain && !window.isGenerating) {
                                    window.floworkBrain.submitMessage(null).catch(() => {});
                                }
                            }
                        }
                    }
                } catch (err) {
                    console.warn('[Ears] Real-time transcription error:', err.message);
                }
            }, chunkMs);

            return {
                result: `🎙️ REAL-TIME MIC STARTED\n` +
                        `Sample rate: 16000 Hz\n` +
                        `Chunk interval: ${chunkMs}ms\n` +
                        `Auto-inject: ${autoInject}\n` +
                        `Language: ${language}\n` +
                        `Use stop_realtime_mic to stop.`
            };
        } catch (err) {
            return { error: `Failed to start mic: ${err.message}. Check microphone permissions.` };
        }
    }

    function stopRealtimeMic(input) {
        if (!_micActive) return { result: 'Real-time mic not active.' };

        _micActive = false;
        if (_micChunkTimer) { clearInterval(_micChunkTimer); _micChunkTimer = null; }
        if (_micProcessor) { _micProcessor.disconnect(); _micProcessor = null; }
        if (_micContext) { _micContext.close().catch(() => {}); _micContext = null; }
        if (_micStream) { _micStream.getTracks().forEach(t => t.stop()); _micStream = null; }
        _micBuffer = [];

        return { result: '🎙️ Real-time mic stopped.' };
    }

    // Helper: Float32 PCM → WAV Blob
    function _float32ToWavBlob(samples, sampleRate) {
        const buffer = new ArrayBuffer(44 + samples.length * 2);
        const view = new DataView(buffer);

        // WAV header
        const writeString = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
        writeString(0, 'RIFF');
        view.setUint32(4, 36 + samples.length * 2, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);     // PCM
        view.setUint16(22, 1, true);     // mono
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);    // 16-bit
        writeString(36, 'data');
        view.setUint32(40, samples.length * 2, true);

        // Convert Float32 → Int16
        for (let i = 0; i < samples.length; i++) {
            const s = Math.max(-1, Math.min(1, samples[i]));
            view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }

        return new Blob([buffer], { type: 'audio/wav' });
    }

    // ═══════════════════════════════════════════════════════════════
    // WAKE WORD DETECTION — "Hey Flowork" trigger
    // ═══════════════════════════════════════════════════════════════
    let _wakeWordRecognition = null;
    let _wakeWordActive = false;
    let _wakeWordTriggers = ['hey flowork', 'flowork', 'hey flow'];

    function startWakeWord(input) {
        if (_wakeWordActive) return { result: 'Wake word detection already active.' };

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) return { error: 'SpeechRecognition API not available in this browser.' };

        // Configure triggers
        if (input.triggers && Array.isArray(input.triggers)) {
            _wakeWordTriggers = input.triggers.map(t => t.toLowerCase().trim());
        }

        _wakeWordRecognition = new SpeechRecognition();
        _wakeWordRecognition.continuous = true;
        _wakeWordRecognition.interimResults = true;
        _wakeWordRecognition.lang = input.language || 'en-US';

        _wakeWordRecognition.onresult = (event) => {
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript.toLowerCase().trim();

                // Check against wake word triggers
                const triggered = _wakeWordTriggers.some(trigger => transcript.includes(trigger));

                if (triggered) {
                    console.log(`[Ears] 🔔 WAKE WORD DETECTED: "${transcript}"`);

                    // Extract command after wake word
                    let command = transcript;
                    for (const trigger of _wakeWordTriggers) {
                        command = command.replace(trigger, '').trim();
                    }

                    if (command.length > 2 && event.results[i].isFinal) {
                        // Inject command into brain
                        if (window.chatHistory) {
                            window.chatHistory.push({
                                role: 'user',
                                content: command,
                                _source: 'wake_word',
                            });
                            if (window.appendChatMessage) {
                                window.appendChatMessage('user', `🔔 ${command}`);
                            }
                            if (window.floworkBrain && !window.isGenerating) {
                                window.floworkBrain.submitMessage(null).catch(() => {});
                            }
                        }
                    } else if (event.results[i].isFinal && command.length <= 2) {
                        // Just the wake word — signal listening
                        if (window.appendChatMessage) {
                            window.appendChatMessage('system', '🔔 Listening...');
                        }
                    }
                }
            }
        };

        _wakeWordRecognition.onerror = (event) => {
            if (event.error === 'no-speech') return; // Normal
            console.warn('[Ears] Wake word error:', event.error);
        };

        _wakeWordRecognition.onend = () => {
            // Auto-restart if still active
            if (_wakeWordActive) {
                setTimeout(() => {
                    try { _wakeWordRecognition.start(); } catch (e) { /* ignore */ }
                }, 500);
            }
        };

        _wakeWordRecognition.start();
        _wakeWordActive = true;

        return {
            result: `🔔 WAKE WORD ACTIVE\n` +
                    `Triggers: ${_wakeWordTriggers.map(t => `"${t}"`).join(', ')}\n` +
                    `Language: ${_wakeWordRecognition.lang}\n` +
                    `Say a trigger word followed by your command.`
        };
    }

    function stopWakeWord(input) {
        if (!_wakeWordActive) return { result: 'Wake word not active.' };
        _wakeWordActive = false;
        if (_wakeWordRecognition) {
            _wakeWordRecognition.stop();
            _wakeWordRecognition = null;
        }
        return { result: '🔔 Wake word detection stopped.' };
    }

    // ═══════════════════════════════════════════════════════════════
    // CONTINUOUS LISTENING — Always-on speech recognition
    // ═══════════════════════════════════════════════════════════════
    let _continuousRecognition = null;
    let _continuousActive = false;
    let _continuousSilenceTimer = null;

    function startContinuousListening(input) {
        if (_continuousActive) return { result: 'Continuous listening already active.' };

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) return { error: 'SpeechRecognition API not available.' };

        _continuousRecognition = new SpeechRecognition();
        _continuousRecognition.continuous = true;
        _continuousRecognition.interimResults = false;
        _continuousRecognition.lang = input.language || 'en-US';

        const silenceTimeoutMs = input.silence_timeout_ms || 30000; // Stop after 30s silence
        const autoSubmit = input.auto_submit !== false;

        function resetSilenceTimer() {
            if (_continuousSilenceTimer) clearTimeout(_continuousSilenceTimer);
            _continuousSilenceTimer = setTimeout(() => {
                console.log('[Ears] 🔇 Silence timeout — continuous listening paused');
                if (_continuousActive) {
                    _continuousRecognition.stop();
                    // Auto-restart after brief pause
                    setTimeout(() => {
                        if (_continuousActive) {
                            try { _continuousRecognition.start(); } catch (e) { /* ignore */ }
                        }
                    }, 2000);
                }
            }, silenceTimeoutMs);
        }

        _continuousRecognition.onresult = (event) => {
            resetSilenceTimer();

            for (let i = event.resultIndex; i < event.results.length; i++) {
                if (event.results[i].isFinal) {
                    const text = event.results[i][0].transcript.trim();
                    if (text.length > 2) {
                        console.log(`[Ears] 👂 Continuous: "${text}"`);

                        if (autoSubmit && window.floworkBrain) {
                            window.floworkBrain.submitMessage(text).catch(() => {});
                        } else if (window.chatHistory) {
                            window.chatHistory.push({ role: 'user', content: text, _source: 'continuous_listen' });
                            if (window.appendChatMessage) window.appendChatMessage('user', `👂 ${text}`);
                        }
                    }
                }
            }
        };

        _continuousRecognition.onerror = (event) => {
            if (event.error === 'no-speech' || event.error === 'aborted') return;
            console.warn('[Ears] Continuous error:', event.error);
        };

        _continuousRecognition.onend = () => {
            if (_continuousActive) {
                setTimeout(() => {
                    try { _continuousRecognition.start(); } catch (e) { /* ignore */ }
                }, 500);
            }
        };

        _continuousRecognition.start();
        _continuousActive = true;
        resetSilenceTimer();

        return {
            result: `👂 CONTINUOUS LISTENING STARTED\n` +
                    `Language: ${_continuousRecognition.lang}\n` +
                    `Auto-submit: ${autoSubmit}\n` +
                    `Silence timeout: ${silenceTimeoutMs / 1000}s\n` +
                    `All speech will be transcribed and sent to the AI.`
        };
    }

    function stopContinuousListening(input) {
        if (!_continuousActive) return { result: 'Continuous listening not active.' };
        _continuousActive = false;
        if (_continuousSilenceTimer) { clearTimeout(_continuousSilenceTimer); _continuousSilenceTimer = null; }
        if (_continuousRecognition) {
            _continuousRecognition.stop();
            _continuousRecognition = null;
        }
        return { result: '👂 Continuous listening stopped.' };
    }

    // ─── Expose ──────────────────────────────────────────────────────
    window.floworkEars = {
        transcribeAudio,
        watchFolder,
        unwatchFolder,
        startWebhook,
        stopWebhook,
        earStatus,
        // v2: Real-time
        startRealtimeMic,
        stopRealtimeMic,
        // v2: Wake word
        startWakeWord,
        stopWakeWord,
        // v2: Continuous
        startContinuousListening,
        stopContinuousListening,
    };

    console.log('[Brain] ✅ Ears module loaded (Whisper + File Watch + Webhook + Real-time Mic + Wake Word + Continuous)');

})();
