// =========================================================================
// FLOWORK OS — Brain Audio Generation Module v2
// Generate sound effects, music, voice cloning, and audio mixing.
// Tools: generate_sound, generate_music, generate_voice_clone,
//        mix_audio, audio_library, audiogen_status
// =========================================================================

(function() {
    'use strict';

    const fs = window.originalNodeRequire?.('fs') || null;
    const pathMod = window.originalNodeRequire?.('path') || null;
    const _history = [];

    function _getKey(p) {
        const env = window._envConfig || {};
        if (p === 'elevenlabs') return env.ELEVENLABS_API_KEY || '';
        if (p === 'openai') {
            return env.OPENAI_API_KEY || (() => {
                try { return JSON.parse(localStorage.getItem('flowork_builder_config') || '{}').openaiKey || ''; } catch(e) { return ''; }
            })();
        }
        if (p === 'replicate') return env.REPLICATE_API_TOKEN || '';
        if (p === 'suno') return env.SUNO_API_KEY || '';
        return '';
    }

    function _savePath(fileName) {
        if (!fs || !pathMod) return null;
        const savePath = pathMod.resolve(window._fmBasePath || '.', fileName);
        fs.mkdirSync(pathMod.dirname(savePath), { recursive: true });
        return savePath;
    }

    function _logEntry(entry) {
        _history.push(entry);
        if (_history.length > 50) _history.shift();
    }

    // ═══════════════════════════════════════════════════════════════
    // SOUND EFFECTS — ElevenLabs SFX
    // ═══════════════════════════════════════════════════════════════
    async function generateSound(input) {
        const prompt = input.prompt || input.description || '';
        if (!prompt.trim()) return { error: 'Missing prompt. Usage: generate_sound { prompt: "thunder crash" }' };

        const apiKey = input.api_key || _getKey('elevenlabs');
        if (!apiKey) return { error: 'ElevenLabs API key required. Set ELEVENLABS_API_KEY in .env' };

        try {
            const resp = await fetch('https://api.elevenlabs.io/v1/sound-generation', {
                method: 'POST',
                headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: prompt,
                    duration_seconds: input.duration || null,
                    prompt_influence: input.influence || 0.3,
                }),
                signal: AbortSignal.timeout(60000),
            });
            if (!resp.ok) throw new Error(`ElevenLabs SFX ${resp.status}: ${(await resp.text()).substring(0, 300)}`);

            const blob = await resp.blob();
            const arrayBuffer = await blob.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            let savedPath = null;
            const fileName = input.output || `sound_${Date.now()}.mp3`;
            savedPath = _savePath(fileName);
            if (savedPath) fs.writeFileSync(savedPath, buffer);

            _logEntry({ type: 'sound', prompt, provider: 'elevenlabs', savedPath, ts: new Date().toISOString() });

            return {
                result: `🔊 SOUND GENERATED\nPrompt: "${prompt.substring(0, 100)}"\nProvider: ElevenLabs SFX\nSize: ${Math.round(buffer.length / 1024)}KB` +
                        (savedPath ? `\nSaved: ${savedPath}` : '')
            };
        } catch(err) {
            return { error: `Sound generation failed: ${err.message}` };
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // MUSIC GENERATION — OpenAI TTS-HD + Suno + Replicate MusicGen
    // ═══════════════════════════════════════════════════════════════
    async function generateMusic(input) {
        const prompt = input.prompt || '';
        if (!prompt.trim()) return { error: 'Missing prompt.' };

        const provider = input.provider || 'openai';

        if (provider === 'suno' || provider === 'suno-ai') {
            return await _generateMusicSuno(input);
        } else if (provider === 'replicate' || provider === 'musicgen') {
            return await _generateMusicReplicate(input);
        }

        // Default: OpenAI TTS-HD (speech, not music — but usable for narration)
        const apiKey = input.api_key || _getKey('openai');
        if (!apiKey) return { error: 'OpenAI API key required.' };

        try {
            const resp = await fetch('https://api.openai.com/v1/audio/speech', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: input.model || 'tts-1-hd',
                    input: prompt,
                    voice: input.voice || 'onyx',
                    speed: input.speed || 1.0,
                    response_format: input.format || 'mp3',
                }),
                signal: AbortSignal.timeout(60000),
            });
            if (!resp.ok) throw new Error(`OpenAI Audio ${resp.status}`);

            const blob = await resp.blob();
            const buffer = Buffer.from(await blob.arrayBuffer());

            let savedPath = null;
            const fileName = input.output || `audio_${Date.now()}.mp3`;
            savedPath = _savePath(fileName);
            if (savedPath) fs.writeFileSync(savedPath, buffer);

            _logEntry({ type: 'music', prompt, provider: 'openai-tts-hd', savedPath, ts: new Date().toISOString() });

            return {
                result: `🎵 AUDIO GENERATED\nPrompt: "${prompt.substring(0, 100)}"\nProvider: OpenAI TTS-HD\nSize: ${Math.round(buffer.length / 1024)}KB` +
                        (savedPath ? `\nSaved: ${savedPath}` : '')
            };
        } catch(err) {
            return { error: `Music generation failed: ${err.message}` };
        }
    }

    // ── Suno API ─────────────────────────────────────────────
    async function _generateMusicSuno(input) {
        const apiKey = input.api_key || _getKey('suno');
        if (!apiKey) return { error: 'Suno API key required. Set SUNO_API_KEY in .env' };

        try {
            // Start generation
            const resp = await fetch('https://studio-api.suno.ai/api/external/generate/', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    topic: input.prompt,
                    tags: input.genre || input.tags || 'pop',
                    title: input.title || `Flowork Music ${Date.now()}`,
                    make_instrumental: input.instrumental || false,
                }),
                signal: AbortSignal.timeout(120000),
            });

            if (!resp.ok) throw new Error(`Suno API ${resp.status}: ${(await resp.text()).substring(0, 300)}`);
            const data = await resp.json();

            _logEntry({ type: 'music', prompt: input.prompt, provider: 'suno', data, ts: new Date().toISOString() });

            const clipIds = (data.clips || data.songs || []).map(c => c.id || c.clip_id).join(', ');
            return {
                result: `🎵 MUSIC GENERATION STARTED (Suno)\nPrompt: "${input.prompt?.substring(0, 100)}"\n` +
                        `Genre: ${input.genre || 'pop'}\n` +
                        `Clips: ${clipIds || 'generating...'}\n` +
                        `Note: Music generation takes 30-60 seconds. Check audiogen_status for updates.`
            };
        } catch (err) {
            return { error: `Suno music generation failed: ${err.message}` };
        }
    }

    // ── Replicate MusicGen ───────────────────────────────────
    async function _generateMusicReplicate(input) {
        const apiKey = input.api_key || _getKey('replicate');
        if (!apiKey) return { error: 'Replicate API token required. Set REPLICATE_API_TOKEN in .env' };

        try {
            const resp = await fetch('https://api.replicate.com/v1/predictions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    version: 'b05b1dff1d8c6dc63d14b0cdb42135571e41c82716c29cd2caf5b3f93ae25b39',
                    input: {
                        prompt: input.prompt,
                        duration: input.duration || 8,
                        model_version: 'stereo-melody-large',
                    },
                }),
                signal: AbortSignal.timeout(120000),
            });

            if (!resp.ok) throw new Error(`Replicate ${resp.status}`);
            const data = await resp.json();

            _logEntry({ type: 'music', prompt: input.prompt, provider: 'replicate-musicgen', predictionId: data.id, ts: new Date().toISOString() });

            return {
                result: `🎵 MUSIC GENERATION STARTED (MusicGen via Replicate)\n` +
                        `Prompt: "${input.prompt?.substring(0, 100)}"\n` +
                        `Duration: ${input.duration || 8}s\n` +
                        `Prediction ID: ${data.id}\n` +
                        `Status: ${data.status}. Poll with audiogen_status.`
            };
        } catch (err) {
            return { error: `MusicGen failed: ${err.message}` };
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // VOICE CLONING — ElevenLabs Voice Clone
    // ═══════════════════════════════════════════════════════════════
    async function generateVoiceClone(input) {
        const apiKey = input.api_key || _getKey('elevenlabs');
        if (!apiKey) return { error: 'ElevenLabs API key required.' };

        const name = input.name || 'Flowork Clone';
        const sampleFile = input.sample || input.audio_file;
        if (!sampleFile) return { error: 'Missing "sample" audio file path for voice cloning.' };

        try {
            // Read sample file
            if (!fs) return { error: 'fs not available (not in Electron)' };
            const sampleBuffer = fs.readFileSync(sampleFile);
            const sampleBlob = new Blob([sampleBuffer], { type: 'audio/mpeg' });

            const formData = new FormData();
            formData.append('name', name);
            formData.append('files', sampleBlob, 'sample.mp3');
            formData.append('description', input.description || 'Cloned voice via Flowork');

            const resp = await fetch('https://api.elevenlabs.io/v1/voices/add', {
                method: 'POST',
                headers: { 'xi-api-key': apiKey },
                body: formData,
                signal: AbortSignal.timeout(60000),
            });

            if (!resp.ok) throw new Error(`ElevenLabs Clone ${resp.status}: ${(await resp.text()).substring(0, 300)}`);
            const data = await resp.json();

            _logEntry({ type: 'voice_clone', name, voiceId: data.voice_id, ts: new Date().toISOString() });

            return {
                result: `🎤 VOICE CLONED\nName: "${name}"\nVoice ID: ${data.voice_id}\n` +
                        `Use this voice_id with tts_speak or generate_music.`
            };
        } catch (err) {
            return { error: `Voice cloning failed: ${err.message}` };
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // AUDIO MIXING — Layer multiple audio files
    // ═══════════════════════════════════════════════════════════════
    async function mixAudio(input) {
        const files = input.files || [];
        if (files.length < 2) return { error: 'Need at least 2 audio files to mix. Usage: mix_audio { files: ["bg.mp3", "voice.mp3"], output: "mixed.mp3" }' };

        // Use Web Audio API for mixing
        try {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const buffers = [];

            for (const filePath of files) {
                let arrayBuffer;
                if (fs) {
                    const fileBuffer = fs.readFileSync(filePath);
                    arrayBuffer = fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength);
                } else {
                    const resp = await fetch(filePath);
                    arrayBuffer = await resp.arrayBuffer();
                }
                const decoded = await audioCtx.decodeAudioData(arrayBuffer);
                buffers.push(decoded);
            }

            // Find longest duration
            const maxDuration = Math.max(...buffers.map(b => b.duration));
            const sampleRate = buffers[0].sampleRate;
            const totalSamples = Math.ceil(maxDuration * sampleRate);

            // Mix all channels
            const mixedBuffer = audioCtx.createBuffer(1, totalSamples, sampleRate);
            const output = mixedBuffer.getChannelData(0);

            for (const buf of buffers) {
                const volume = 1.0 / buffers.length; // Equal volume
                const channelData = buf.getChannelData(0);
                for (let i = 0; i < channelData.length && i < totalSamples; i++) {
                    output[i] += channelData[i] * volume;
                }
            }

            // Encode to WAV
            const wavBlob = _audioBufferToWav(mixedBuffer);
            const wavArrayBuffer = await wavBlob.arrayBuffer();
            const wavBuffer = Buffer.from(wavArrayBuffer);

            let savedPath = null;
            const fileName = input.output || `mixed_${Date.now()}.wav`;
            savedPath = _savePath(fileName);
            if (savedPath) fs.writeFileSync(savedPath, wavBuffer);

            audioCtx.close();

            _logEntry({ type: 'mix', files, savedPath, ts: new Date().toISOString() });

            return {
                result: `🎛️ AUDIO MIXED\nFiles: ${files.length}\nDuration: ${maxDuration.toFixed(1)}s\nSize: ${Math.round(wavBuffer.length / 1024)}KB` +
                        (savedPath ? `\nSaved: ${savedPath}` : '')
            };
        } catch (err) {
            return { error: `Audio mixing failed: ${err.message}` };
        }
    }

    // Helper: AudioBuffer → WAV Blob
    function _audioBufferToWav(audioBuffer) {
        const numChannels = audioBuffer.numberOfChannels;
        const sampleRate = audioBuffer.sampleRate;
        const samples = audioBuffer.getChannelData(0);
        const buffer = new ArrayBuffer(44 + samples.length * 2);
        const view = new DataView(buffer);

        const writeStr = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
        writeStr(0, 'RIFF');
        view.setUint32(4, 36 + samples.length * 2, true);
        writeStr(8, 'WAVE');
        writeStr(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * numChannels * 2, true);
        view.setUint16(32, numChannels * 2, true);
        view.setUint16(34, 16, true);
        writeStr(36, 'data');
        view.setUint32(40, samples.length * 2, true);

        for (let i = 0; i < samples.length; i++) {
            const s = Math.max(-1, Math.min(1, samples[i]));
            view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }

        return new Blob([buffer], { type: 'audio/wav' });
    }

    // ═══════════════════════════════════════════════════════════════
    // SFX LIBRARY — Common sound effect prompt templates
    // ═══════════════════════════════════════════════════════════════
    const SFX_LIBRARY = {
        notification: 'Short pleasant notification chime, digital, bright',
        error: 'Error alert beep, two-tone descending, digital',
        success: 'Success fanfare, short triumphant brass',
        click: 'UI button click, soft, satisfying',
        typing: 'Keyboard typing sounds, mechanical keyboard',
        whoosh: 'Fast whoosh transition sound, cinematic',
        pop: 'Bubble pop sound, playful',
        ding: 'Bell ding, clear and resonant',
        thunder: 'Rolling thunder, distant storm',
        rain: 'Gentle rain on window, ambient',
        ocean: 'Ocean waves, calm beach ambiance',
        fire: 'Crackling campfire, cozy',
        wind: 'Gentle breeze through trees',
        footsteps: 'Footsteps on wooden floor',
        door: 'Door opening and closing, wooden',
        glass: 'Glass breaking, dramatic shatter',
        explosion: 'Distant explosion, cinematic bass',
        laser: 'Sci-fi laser beam, pew pew',
        sword: 'Sword swing and clash, metallic',
        magic: 'Magical spell casting, sparkle and shimmer',
    };

    function audioLibrary(input) {
        const category = input.category || 'all';

        let report = `🎵 SOUND EFFECTS LIBRARY\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        report += `Use generate_sound with these prompts:\n\n`;

        for (const [name, prompt] of Object.entries(SFX_LIBRARY)) {
            report += `  🔊 ${name}: "${prompt}"\n`;
        }

        report += `\nUsage: generate_sound { prompt: "<prompt above>" }\n`;
        report += `Or use your own custom prompt!`;

        return { result: report };
    }

    // ═══════════════════════════════════════════════════════════════
    // STATUS
    // ═══════════════════════════════════════════════════════════════
    function audiogenStatus(input) {
        const providers = {
            'ElevenLabs SFX': !!_getKey('elevenlabs'),
            'OpenAI TTS-HD': !!_getKey('openai'),
            'Suno Music': !!_getKey('suno'),
            'Replicate MusicGen': !!_getKey('replicate'),
        };

        let report = `🔊 AUDIOGEN STATUS v2\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        for (const [name, hasKey] of Object.entries(providers)) {
            report += `${hasKey ? '✅' : '❌'} ${name}: ${hasKey ? 'Ready' : 'No API key'}\n`;
        }
        report += `\nSFX Library: ${Object.keys(SFX_LIBRARY).length} templates\n`;
        report += `History: ${_history.length} items\n`;

        if (_history.length > 0) {
            report += `\n📋 Recent:\n`;
            for (const h of _history.slice(-5)) {
                report += `  [${h.type}] ${h.prompt?.substring(0, 50) || h.name || '...'} (${h.provider}) — ${h.ts}\n`;
            }
        }

        return { result: report };
    }

    // ─── Expose ──────────────────────────────────────────────
    window.floworkAudioGen = {
        generateSound,
        generateMusic,
        generateVoiceClone,
        mixAudio,
        audioLibrary,
        audiogenStatus,
        SFX_LIBRARY,
    };

    console.log('[Brain] ✅ AudioGen v2 loaded (ElevenLabs SFX, OpenAI TTS-HD, Suno, MusicGen, Voice Clone, Mix)');
})();
