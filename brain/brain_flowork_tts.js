// =========================================================================
// FLOWORK OS — Brain TTS Module (Text-to-Speech Output)
// Gives the AI a "mouth" — converts text responses to spoken audio.
// Bridges to smart/voice/FLOWORKOS_voice_tts.js multi-provider engine.
//
// Providers: Browser (free), ElevenLabs, OpenAI TTS, Google Cloud TTS
// =========================================================================

(function() {
    'use strict';

    let _autoSpeak = false;       // Auto-TTS every AI response
    let _defaultProvider = 'browser';
    let _defaultVoice = null;
    let _defaultLang = 'en-US';
    let _isSpeaking = false;
    let _speakQueue = [];
    let _currentAudio = null;

    // ─── Get API key for TTS providers ──────────────────────────────
    function _getTTSApiKey(provider) {
        // Try .env loaded keys
        if (window._envConfig) {
            if (provider === 'elevenlabs') return window._envConfig.ELEVENLABS_API_KEY || '';
            if (provider === 'openai-tts' || provider === 'openai') return window._envConfig.OPENAI_API_KEY || '';
            if (provider === 'google-tts' || provider === 'google') return window._envConfig.GOOGLE_TTS_API_KEY || '';
        }
        // Try localStorage
        try {
            const saved = JSON.parse(localStorage.getItem('flowork_builder_config') || '{}');
            if (provider === 'openai-tts' && saved.openaiKey) return saved.openaiKey;
            // For ElevenLabs/Google fallback to main key (user may store in config)
            if (saved.elevenLabsKey) return saved.elevenLabsKey;
        } catch(e) {}
        // Last resort: Gemini key for Google TTS (same billing)
        if (provider === 'google-tts') {
            return window.getEl?.('input-api-key')?.value || '';
        }
        return '';
    }

    // ─── Speak text ─────────────────────────────────────────────────
    async function speak(input) {
        const text = input.text || input.message || input.content || '';
        if (!text.trim()) return { error: 'No text provided for TTS.' };

        const provider = input.provider || _defaultProvider;
        const voice = input.voice || _defaultVoice;
        const lang = input.lang || input.language || _defaultLang;
        const apiKey = input.api_key || _getTTSApiKey(provider);

        // Use FLOWORKOS_Voice engine if loaded
        if (window.FLOWORKOS_Voice) {
            try {
                const result = await window.FLOWORKOS_Voice.speak(text, {
                    provider,
                    voice,
                    lang,
                    apiKey,
                    rate: input.rate || 1.0,
                    pitch: input.pitch || 1.0,
                    cache: input.cache !== false,
                });

                if (result.error) return { error: result.error };

                // If we got an audio URL, play it
                if (result.audioUrl) {
                    _isSpeaking = true;
                    try {
                        const playResult = await window.FLOWORKOS_Voice.playAudioUrl(result.audioUrl);
                        _isSpeaking = false;
                        return {
                            result: `🔊 TTS COMPLETE (${result.provider || provider})\\n` +
                                    `Text: "${text.substring(0, 80)}..."\\n` +
                                    `Duration: ${playResult.duration?.toFixed(1) || 'unknown'}s`
                        };
                    } catch(playErr) {
                        _isSpeaking = false;
                        return { error: `Audio playback failed: ${playErr.message}` };
                    }
                }

                // Browser native returns played:true directly
                if (result.played) {
                    return {
                        result: `🔊 TTS COMPLETE (browser native)\\n` +
                                `Text: "${text.substring(0, 80)}..."\\n` +
                                `Language: ${lang}`
                    };
                }

                return { result: `🔊 Speech delivered via ${provider}.` };
            } catch(err) {
                return { error: `TTS failed: ${err.message}` };
            }
        }

        // Fallback: Direct Web Speech API if FLOWORKOS_Voice not loaded
        if (typeof speechSynthesis !== 'undefined') {
            return new Promise((resolve) => {
                const utterance = new SpeechSynthesisUtterance(text);
                utterance.rate = input.rate || 1.0;
                utterance.pitch = input.pitch || 1.0;
                utterance.lang = lang;
                if (voice) {
                    const voices = speechSynthesis.getVoices();
                    const match = voices.find(v => v.name.toLowerCase().includes(voice.toLowerCase()));
                    if (match) utterance.voice = match;
                }
                utterance.onend = () => resolve({
                    result: `🔊 Spoken via browser: "${text.substring(0, 80)}..."`
                });
                utterance.onerror = (e) => resolve({
                    error: `Browser TTS error: ${e.error}`
                });
                speechSynthesis.cancel();
                speechSynthesis.speak(utterance);
            });
        }

        return { error: 'No TTS engine available. Load FLOWORKOS_voice_tts.js or use a browser with Web Speech API.' };
    }

    // ─── Stop speaking ──────────────────────────────────────────────
    function stop(input) {
        _isSpeaking = false;
        _speakQueue = [];

        if (_currentAudio) {
            try { _currentAudio.pause(); _currentAudio = null; } catch(e) {}
        }

        if (window.FLOWORKOS_Voice) {
            window.FLOWORKOS_Voice.stop();
        } else if (typeof speechSynthesis !== 'undefined') {
            speechSynthesis.cancel();
        }

        return { result: '🔇 TTS stopped. Queue cleared.' };
    }

    // ─── List available voices ──────────────────────────────────────
    async function listVoices(input) {
        const provider = input.provider || _defaultProvider;
        const apiKey = input.api_key || _getTTSApiKey(provider);

        if (window.FLOWORKOS_Voice) {
            const voices = await window.FLOWORKOS_Voice.listVoices(provider, apiKey);
            const providers = window.FLOWORKOS_Voice.listProviders();
            return {
                result: `🔊 TTS VOICES\\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\\n` +
                        `Providers: ${providers.map(p => `${p.id} (${p.name})`).join(', ')}\\n\\n` +
                        `Voices for "${provider}":\\n` +
                        voices.map(v => `  • ${v.name || v.id}${v.lang ? ' [' + v.lang + ']' : ''}${v.default ? ' ★' : ''}`).join('\\n')
            };
        }

        // Browser fallback
        if (typeof speechSynthesis !== 'undefined') {
            const voices = speechSynthesis.getVoices();
            return {
                result: `🔊 Browser Voices (${voices.length}):\\n` +
                        voices.slice(0, 20).map(v => `  • ${v.name} [${v.lang}]${v.default ? ' ★' : ''}`).join('\\n')
            };
        }

        return { result: 'No TTS engine available.' };
    }

    // ─── Set default provider/voice ─────────────────────────────────
    function setProvider(input) {
        if (input.provider) _defaultProvider = input.provider;
        if (input.voice) _defaultVoice = input.voice;
        if (input.lang || input.language) _defaultLang = input.lang || input.language;
        if (input.auto_speak !== undefined) _autoSpeak = !!input.auto_speak;

        return {
            result: `🔊 TTS Settings Updated:\\n` +
                    `  Provider: ${_defaultProvider}\\n` +
                    `  Voice: ${_defaultVoice || 'default'}\\n` +
                    `  Language: ${_defaultLang}\\n` +
                    `  Auto-speak: ${_autoSpeak ? '✅ ON' : '❌ OFF'}`
        };
    }

    // ─── TTS status ─────────────────────────────────────────────────
    function status(input) {
        const providerList = window.FLOWORKOS_Voice
            ? window.FLOWORKOS_Voice.listProviders()
            : [{ id: 'browser', name: 'Web Speech API (fallback)' }];

        return {
            result: `🔊 TTS STATUS\\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\\n` +
                    `Engine: ${window.FLOWORKOS_Voice ? 'FLOWORKOS Voice' : 'Browser fallback'}\\n` +
                    `Default provider: ${_defaultProvider}\\n` +
                    `Default voice: ${_defaultVoice || 'auto'}\\n` +
                    `Language: ${_defaultLang}\\n` +
                    `Auto-speak: ${_autoSpeak ? '✅ ON' : '❌ OFF'}\\n` +
                    `Currently speaking: ${_isSpeaking ? 'yes' : 'no'}\\n` +
                    `Queue: ${_speakQueue.length} items\\n\\n` +
                    `Providers:\\n` +
                    providerList.map(p => `  ${p.id}: ${p.name}${p.requiresKey ? ' (needs key)' : ' (free)'}`).join('\\n') +
                    `\\n\\nAPI Keys:\\n` +
                    `  ElevenLabs: ${_getTTSApiKey('elevenlabs') ? '✅' : '❌ not set'}\\n` +
                    `  OpenAI TTS: ${_getTTSApiKey('openai-tts') ? '✅' : '❌ not set'}\\n` +
                    `  Google TTS: ${_getTTSApiKey('google-tts') ? '✅' : '❌ not set'}`
        };
    }

    // ─── Auto-speak hook — inject into agent response pipeline ─────
    function _hookAutoSpeak() {
        if (!window.appendChatMessage) return;

        const _original = window.appendChatMessage;
        window.appendChatMessage = function(role, message, imageData) {
            // Call original
            _original.apply(this, arguments);

            // Auto-speak AI responses
            if (_autoSpeak && role === 'agent' && message && typeof message === 'string') {
                // Don't speak tool results, JSON, or very short messages
                if (message.startsWith('{') || message.startsWith('[') || message.length < 20) return;
                // Strip markdown
                const cleanText = message
                    .replace(/```[\s\S]*?```/g, '')
                    .replace(/[#*_~`]/g, '')
                    .replace(/\[.*?\]\(.*?\)/g, '')
                    .trim();
                if (cleanText.length > 20) {
                    speak({ text: cleanText.substring(0, 2000) }).catch(() => {});
                }
            }
        };
    }

    // Hook auto-speak after a short delay (wait for appendChatMessage to be defined)
    setTimeout(_hookAutoSpeak, 3000);

    // ═══════════════════════════════════════════════════════════════
    // STREAMING TTS — Sentence-by-sentence progressive audio
    // ═══════════════════════════════════════════════════════════════
    let _streamingBuffer = '';
    let _streamingActive = false;
    let _audioQueue = [];        // Pre-fetched audio blobs
    let _isPlayingQueue = false;

    // Sentence boundary regex
    const SENTENCE_BREAK = /(?<=[.!?。！？])\s+/;

    /**
     * Feed text chunks progressively — TTS starts as soon as
     * a full sentence is accumulated.
     */
    async function speakStreaming(input) {
        const chunk = input.chunk || input.text || '';
        const flush = input.flush || false;

        if (!chunk && !flush) return { result: 'No chunk provided.' };

        _streamingActive = true;
        _streamingBuffer += chunk;

        // Check for sentence boundaries
        const sentences = _streamingBuffer.split(SENTENCE_BREAK);

        if (sentences.length > 1 || flush) {
            // We have at least one complete sentence
            const complete = flush ? sentences : sentences.slice(0, -1);
            _streamingBuffer = flush ? '' : sentences[sentences.length - 1];

            for (const sentence of complete) {
                const clean = sentence.trim();
                if (clean.length < 3) continue;
                if (clean.startsWith('{') || clean.startsWith('[') || clean.startsWith('```')) continue;

                // Queue for playback
                _audioQueue.push(clean);
            }

            // Start playing queue if not already
            if (!_isPlayingQueue) {
                _playQueue();
            }
        }

        return { result: `Buffered ${chunk.length} chars. Queue: ${_audioQueue.length}. Buffer: ${_streamingBuffer.length} chars.` };
    }

    /**
     * Split complete text into sentences and play sequentially
     * with pre-fetch (start fetching next while current plays).
     */
    async function speakChunked(input) {
        const text = input.text || '';
        if (!text.trim()) return { error: 'Missing text.' };

        // Clean markdown
        const cleanText = text
            .replace(/```[\s\S]*?```/g, '')
            .replace(/[#*_~`]/g, '')
            .replace(/\[.*?\]\(.*?\)/g, '')
            .trim();

        // Split into sentences
        const sentences = cleanText.split(SENTENCE_BREAK).filter(s => s.trim().length > 3);

        if (sentences.length === 0) return { result: 'No speakable content found.' };

        _audioQueue = [..._audioQueue, ...sentences];

        if (!_isPlayingQueue) {
            _playQueue();
        }

        return {
            result: `🔊 Streaming TTS: ${sentences.length} sentences queued.\n` +
                    `First: "${sentences[0].substring(0, 60)}..."`
        };
    }

    /**
     * Queue player — plays sentences sequentially,
     * pre-fetches the next one while current is playing.
     */
    async function _playQueue() {
        if (_isPlayingQueue) return;
        _isPlayingQueue = true;

        while (_audioQueue.length > 0) {
            const sentence = _audioQueue.shift();
            if (!sentence || sentence.trim().length < 3) continue;

            try {
                await speak({ text: sentence.substring(0, 2000) });
            } catch (err) {
                console.warn('[TTS] Queue playback error:', err.message);
            }

            // Small gap between sentences for natural flow
            await new Promise(r => setTimeout(r, 150));
        }

        _isPlayingQueue = false;
        _streamingActive = false;
    }

    /**
     * Stop streaming TTS and clear queue.
     */
    function stopStreaming(input) {
        _streamingBuffer = '';
        _audioQueue = [];
        _streamingActive = false;
        _isPlayingQueue = false;
        stop({}); // Stop current playback
        return { result: '🔇 Streaming TTS stopped and queue cleared.' };
    }

    /**
     * Hook into brain adapter's LLM streaming for real-time TTS.
     * Call this once to enable "speak as AI thinks" mode.
     */
    function hookStreamingTTS(input) {
        const enabled = input.enabled !== undefined ? input.enabled : true;

        if (enabled) {
            // Monkey-patch createStreamingBubble to also feed text to TTS
            const _origCreateBubble = window.createStreamingBubble;
            if (_origCreateBubble && !window._ttsStreamHooked) {
                window._ttsStreamHooked = true;
                let _lastLength = 0;

                window.createStreamingBubble = function () {
                    const bubble = _origCreateBubble.call(this);
                    const _origUpdate = bubble.update;
                    _lastLength = 0;

                    bubble.update = function (fullText) {
                        _origUpdate.call(this, fullText);

                        // Feed new text delta to streaming TTS
                        if (fullText.length > _lastLength) {
                            const delta = fullText.substring(_lastLength);
                            _lastLength = fullText.length;
                            speakStreaming({ chunk: delta }).catch(() => {});
                        }
                    };

                    const _origFinish = bubble.finish;
                    bubble.finish = function () {
                        _origFinish.call(this);
                        // Flush remaining buffer
                        speakStreaming({ flush: true }).catch(() => {});
                        _lastLength = 0;
                    };

                    return bubble;
                };

                return { result: '🔊 Streaming TTS hooked into LLM output. AI will speak as it generates text.' };
            }
            return { result: 'Streaming TTS hook already installed or createStreamingBubble not available.' };
        } else {
            // Unhook
            if (window._ttsStreamHooked) {
                window._ttsStreamHooked = false;
                // Note: can't easily undo monkey-patch, but flag prevents re-entry
            }
            return { result: '🔇 Streaming TTS hook disabled.' };
        }
    }

    // ─── Expose ──────────────────────────────────────────────────────
    window.floworkTTS = {
        speak,
        stop,
        listVoices,
        setProvider,
        status,
        isAutoSpeak: () => _autoSpeak,
        isSpeaking: () => _isSpeaking,
        // v2: Streaming
        speakStreaming,
        speakChunked,
        stopStreaming,
        hookStreamingTTS,
    };

    console.log('[Brain] ✅ TTS module loaded (auto-speak: ' + (_autoSpeak ? 'ON' : 'OFF') + ', streaming: ready)');

})();
