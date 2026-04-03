// =========================================================================
// FLOWORK OS — Brain Video Generation Module
// Generate videos, record screen, and create animations via AI providers.
// Tools: generate_video, record_screen, create_animation,
//        video_status, stop_recording
// =========================================================================

(function() {
    'use strict';

    const fs = window.originalNodeRequire?.('fs') || null;
    const pathMod = window.originalNodeRequire?.('path') || null;
    const _history = [];
    let _recorder = null;
    let _recordingStream = null;
    let _recordedChunks = [];

    function _getKey(p) {
        const env = window._envConfig || {};
        if (p === 'runway') return env.RUNWAY_API_KEY || '';
        if (p === 'luma') return env.LUMA_API_KEY || '';
        if (p === 'replicate') return env.REPLICATE_API_TOKEN || '';
        if (p === 'openai') {
            return env.OPENAI_API_KEY || (() => {
                try { return JSON.parse(localStorage.getItem('flowork_builder_config') || '{}').openaiKey || ''; } catch(e) { return ''; }
            })();
        }
        if (p === 'stability') return env.STABILITY_API_KEY || '';
        return '';
    }

    function _savePath(fileName) {
        if (!fs || !pathMod) return null;
        const savePath = pathMod.resolve(window._fmBasePath || '.', fileName);
        fs.mkdirSync(pathMod.dirname(savePath), { recursive: true });
        return savePath;
    }

    function _logEntry(entry) {
        _history.push({ ...entry, ts: new Date().toISOString() });
        if (_history.length > 30) _history.shift();
    }

    // ═══════════════════════════════════════════════════════════════
    // VIDEO GENERATION — Multi-provider AI video creation
    // ═══════════════════════════════════════════════════════════════
    async function generateVideo(input) {
        const prompt = input.prompt || input.description || '';
        if (!prompt.trim()) return { error: 'Missing prompt. Usage: generate_video { prompt: "A cat walking on Mars", provider: "luma" }' };

        const provider = input.provider || _detectBestProvider();

        switch (provider) {
            case 'luma':
            case 'luma-ai':
            case 'dream-machine':
                return await _generateLuma(input);
            case 'runway':
            case 'runwayml':
                return await _generateRunway(input);
            case 'replicate':
            case 'stable-video':
                return await _generateReplicateVideo(input);
            default:
                return { error: `Unknown video provider: "${provider}". Options: luma, runway, replicate` };
        }
    }

    function _detectBestProvider() {
        if (_getKey('luma')) return 'luma';
        if (_getKey('runway')) return 'runway';
        if (_getKey('replicate')) return 'replicate';
        return 'luma'; // Default
    }

    // ── Luma AI Dream Machine ───────────────────────────────
    async function _generateLuma(input) {
        const apiKey = input.api_key || _getKey('luma');
        if (!apiKey) return { error: 'Luma AI API key required. Set LUMA_API_KEY in .env' };

        try {
            const body = {
                prompt: input.prompt,
                aspect_ratio: input.aspect_ratio || '16:9',
                loop: input.loop || false,
            };

            // Image-to-video: provide start image
            if (input.image || input.start_image) {
                body.keyframes = {
                    frame0: {
                        type: 'image',
                        url: input.image || input.start_image,
                    }
                };
            }

            const resp = await fetch('https://api.lumalabs.ai/dream-machine/v1/generations', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(30000),
            });

            if (!resp.ok) throw new Error(`Luma API ${resp.status}: ${(await resp.text()).substring(0, 300)}`);
            const data = await resp.json();

            _logEntry({ type: 'video', prompt: input.prompt, provider: 'luma', generationId: data.id, status: data.state });

            return {
                result: `🎬 VIDEO GENERATION STARTED (Luma Dream Machine)\n` +
                        `Prompt: "${input.prompt.substring(0, 100)}"\n` +
                        `Aspect: ${body.aspect_ratio}\n` +
                        `Generation ID: ${data.id}\n` +
                        `Status: ${data.state || 'queued'}\n\n` +
                        `⏳ Video generation takes 1-3 minutes.\n` +
                        `Check progress: video_status { id: "${data.id}", provider: "luma" }`
            };
        } catch (err) {
            return { error: `Luma video generation failed: ${err.message}` };
        }
    }

    // ── Runway ML Gen-3 ─────────────────────────────────────
    async function _generateRunway(input) {
        const apiKey = input.api_key || _getKey('runway');
        if (!apiKey) return { error: 'Runway API key required. Set RUNWAY_API_KEY in .env' };

        try {
            const body = {
                promptText: input.prompt,
                model: input.model || 'gen3a_turbo',
                duration: input.duration || 5,
                ratio: input.aspect_ratio || '16:9',
                watermark: false,
            };

            if (input.image || input.start_image) {
                body.promptImage = input.image || input.start_image;
            }

            const resp = await fetch('https://api.dev.runwayml.com/v1/image_to_video', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'X-Runway-Version': '2024-11-06',
                },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(30000),
            });

            if (!resp.ok) throw new Error(`Runway API ${resp.status}: ${(await resp.text()).substring(0, 300)}`);
            const data = await resp.json();

            _logEntry({ type: 'video', prompt: input.prompt, provider: 'runway', taskId: data.id, status: 'submitted' });

            return {
                result: `🎬 VIDEO GENERATION STARTED (Runway Gen-3)\n` +
                        `Prompt: "${input.prompt.substring(0, 100)}"\n` +
                        `Duration: ${body.duration}s | Model: ${body.model}\n` +
                        `Task ID: ${data.id}\n\n` +
                        `⏳ Check progress: video_status { id: "${data.id}", provider: "runway" }`
            };
        } catch (err) {
            return { error: `Runway video generation failed: ${err.message}` };
        }
    }

    // ── Replicate Stable Video Diffusion ────────────────────
    async function _generateReplicateVideo(input) {
        const apiKey = input.api_key || _getKey('replicate');
        if (!apiKey) return { error: 'Replicate API token required. Set REPLICATE_API_TOKEN in .env' };

        const image = input.image || input.start_image;
        if (!image) return { error: 'Stable Video Diffusion requires a start image. Provide "image" URL.' };

        try {
            const resp = await fetch('https://api.replicate.com/v1/predictions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    version: 'dc73b86eedafcf94a5e0e3436711662a5c7c86e2815e2218541e64b4291e4ec3',
                    input: {
                        input_image: image,
                        motion_bucket_id: input.motion || 127,
                        fps: input.fps || 7,
                        cond_aug: 0.02,
                    },
                }),
                signal: AbortSignal.timeout(30000),
            });

            if (!resp.ok) throw new Error(`Replicate ${resp.status}`);
            const data = await resp.json();

            _logEntry({ type: 'video', prompt: `image→video from ${image}`, provider: 'replicate-svd', predictionId: data.id });

            return {
                result: `🎬 VIDEO GENERATION STARTED (Stable Video Diffusion)\n` +
                        `Source image: ${image.substring(0, 80)}\n` +
                        `Prediction ID: ${data.id}\n` +
                        `Status: ${data.status}\n\n` +
                        `Check: video_status { id: "${data.id}", provider: "replicate" }`
            };
        } catch (err) {
            return { error: `Replicate video failed: ${err.message}` };
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // VIDEO STATUS CHECK — Poll generation status
    // ═══════════════════════════════════════════════════════════════
    async function videoStatus(input) {
        const id = input.id || input.generation_id || input.task_id;
        const provider = input.provider || 'luma';

        if (!id) {
            // Show all history
            if (_history.length === 0) return { result: 'No video generation history.' };

            let report = `🎬 VIDEO GENERATION HISTORY\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            for (const h of _history.slice(-10)) {
                report += `  [${h.provider}] ${h.prompt?.substring(0, 50) || 'screen recording'} — ${h.ts}\n`;
                if (h.generationId) report += `    ID: ${h.generationId}\n`;
                if (h.savedPath) report += `    Saved: ${h.savedPath}\n`;
            }
            report += `\nRecorder: ${_recorder ? '🔴 RECORDING' : '⬜ Idle'}`;
            return { result: report };
        }

        try {
            let url, headers;

            if (provider === 'luma') {
                url = `https://api.lumalabs.ai/dream-machine/v1/generations/${id}`;
                headers = { 'Authorization': `Bearer ${_getKey('luma')}` };
            } else if (provider === 'runway') {
                url = `https://api.dev.runwayml.com/v1/tasks/${id}`;
                headers = {
                    'Authorization': `Bearer ${_getKey('runway')}`,
                    'X-Runway-Version': '2024-11-06',
                };
            } else if (provider === 'replicate') {
                url = `https://api.replicate.com/v1/predictions/${id}`;
                headers = { 'Authorization': `Bearer ${_getKey('replicate')}` };
            } else {
                return { error: `Unknown provider: ${provider}` };
            }

            const resp = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
            if (!resp.ok) throw new Error(`Status check ${resp.status}`);
            const data = await resp.json();

            // Try to download if complete
            const videoUrl = data.assets?.video || data.output?.[0] || data.output || null;
            let savedPath = null;

            if (videoUrl && (data.state === 'completed' || data.status === 'succeeded')) {
                // Download video
                try {
                    const videoResp = await fetch(videoUrl, { signal: AbortSignal.timeout(60000) });
                    const videoBlob = await videoResp.blob();
                    const videoBuffer = Buffer.from(await videoBlob.arrayBuffer());
                    const fileName = input.output || `video_${id}.mp4`;
                    savedPath = _savePath(fileName);
                    if (savedPath) {
                        fs.writeFileSync(savedPath, videoBuffer);
                        console.log(`[VideoGen] 💾 Saved video: ${savedPath}`);
                    }
                } catch (dlErr) {
                    console.warn('[VideoGen] Download failed:', dlErr.message);
                }
            }

            const status = data.state || data.status || 'unknown';
            return {
                result: `🎬 VIDEO STATUS: ${status.toUpperCase()}\n` +
                        `Provider: ${provider}\n` +
                        `ID: ${id}\n` +
                        (videoUrl ? `URL: ${videoUrl}\n` : '') +
                        (savedPath ? `Saved: ${savedPath}\n` : '') +
                        (data.failure_reason ? `Error: ${data.failure_reason}\n` : '')
            };
        } catch (err) {
            return { error: `Status check failed: ${err.message}` };
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // SCREEN RECORDING — Capture browser tab as video
    // ═══════════════════════════════════════════════════════════════
    async function recordScreen(input) {
        if (_recorder && _recorder.state === 'recording') {
            return { result: '🔴 Already recording. Use stop_recording to finish.' };
        }

        try {
            // Request screen/tab capture
            const displayMediaOptions = {
                video: {
                    cursor: input.cursor !== false ? 'always' : 'never',
                    displaySurface: input.surface || 'browser', // browser, monitor, window
                },
                audio: input.audio !== false,
            };

            _recordingStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
            _recordedChunks = [];

            const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
                ? 'video/webm;codecs=vp9'
                : 'video/webm';

            _recorder = new MediaRecorder(_recordingStream, {
                mimeType,
                videoBitsPerSecond: input.bitrate || 2500000, // 2.5 Mbps
            });

            _recorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    _recordedChunks.push(event.data);
                }
            };

            _recorder.onstop = async () => {
                const blob = new Blob(_recordedChunks, { type: mimeType });
                const arrayBuffer = await blob.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);

                const fileName = input.output || `recording_${Date.now()}.webm`;
                const savedPath = _savePath(fileName);
                if (savedPath) {
                    fs.writeFileSync(savedPath, buffer);
                    console.log(`[VideoGen] 💾 Recording saved: ${savedPath}`);
                    _logEntry({ type: 'recording', savedPath, size: buffer.length, duration: 'unknown' });
                }

                // Clean up
                if (_recordingStream) {
                    _recordingStream.getTracks().forEach(t => t.stop());
                    _recordingStream = null;
                }
                _recordedChunks = [];
            };

            // Handle track end (user clicks "Stop sharing")
            _recordingStream.getVideoTracks()[0].onended = () => {
                if (_recorder && _recorder.state === 'recording') {
                    _recorder.stop();
                }
            };

            // Start recording
            _recorder.start(1000); // Collect chunks every 1s

            // Auto-stop after max duration
            const maxSeconds = input.max_seconds || input.duration || 300; // 5 min default
            setTimeout(() => {
                if (_recorder && _recorder.state === 'recording') {
                    console.log('[VideoGen] ⏱️ Max recording duration reached');
                    _recorder.stop();
                }
            }, maxSeconds * 1000);

            _logEntry({ type: 'recording_start', maxSeconds });

            return {
                result: `🔴 SCREEN RECORDING STARTED\n` +
                        `Format: ${mimeType}\n` +
                        `Max duration: ${maxSeconds}s\n` +
                        `Audio: ${input.audio !== false ? 'Yes' : 'No'}\n` +
                        `Output: ${input.output || 'recording_<timestamp>.webm'}\n\n` +
                        `Use stop_recording to save the video.`
            };
        } catch (err) {
            return { error: `Screen recording failed: ${err.message}. User may have denied screen capture permission.` };
        }
    }

    async function stopRecording(input) {
        if (!_recorder || _recorder.state !== 'recording') {
            return { result: 'No active recording to stop.' };
        }

        _recorder.stop();

        return {
            result: `⏹️ Recording stopped. Video will be saved automatically.\n` +
                    `Chunks recorded: ${_recordedChunks.length}`
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // ANIMATION — Generate SVG/CSS animation from text
    // ═══════════════════════════════════════════════════════════════
    async function createAnimation(input) {
        const type = input.type || 'css';
        const prompt = input.prompt || input.description || '';
        if (!prompt.trim()) return { error: 'Missing prompt for animation.' };

        if (type === 'lottie' || type === 'json') {
            return _createLottieAnimation(input);
        }

        // Default: Generate CSS keyframe animation as HTML file
        const duration = input.duration || '2s';
        const easing = input.easing || 'ease-in-out';
        const iterations = input.iterations || 'infinite';

        // Use AI to generate animation code if brain is available
        if (window.floworkBrain) {
            return {
                result: `🎨 ANIMATION REQUEST\n` +
                        `Type: CSS Keyframes\n` +
                        `Prompt: "${prompt}"\n` +
                        `Duration: ${duration}, Easing: ${easing}\n\n` +
                        `To create this animation, use write_files to create an HTML file with CSS @keyframes.\n` +
                        `The AI should generate the animation code based on the prompt.`
            };
        }

        // Fallback: simple bounce animation template
        const html = `<!DOCTYPE html>
<html>
<head>
<style>
body { background: #111; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
.animated {
    width: 100px; height: 100px;
    background: linear-gradient(135deg, #667eea, #764ba2);
    border-radius: 50%;
    animation: floworkAnim ${duration} ${easing} ${iterations};
}
@keyframes floworkAnim {
    0%, 100% { transform: translateY(0) scale(1); }
    50% { transform: translateY(-50px) scale(1.1); }
}
</style>
</head>
<body>
<div class="animated"></div>
<!-- Animation: ${prompt} -->
</body>
</html>`;

        const fileName = input.output || `animation_${Date.now()}.html`;
        const savedPath = _savePath(fileName);
        if (savedPath) {
            fs.writeFileSync(savedPath, html);
            _logEntry({ type: 'animation', prompt, savedPath });
        }

        return {
            result: `🎨 ANIMATION CREATED\n` +
                    `Type: CSS Keyframes\n` +
                    `Prompt: "${prompt}"\n` +
                    (savedPath ? `Saved: ${savedPath}\n` : '') +
                    `Open in browser to preview.`
        };
    }

    function _createLottieAnimation(input) {
        // Lottie JSON template — simple scale/fade animation
        const lottie = {
            v: '5.7.4',
            fr: 30,
            ip: 0,
            op: 60,
            w: 512,
            h: 512,
            nm: input.prompt || 'Flowork Animation',
            layers: [{
                ty: 4, nm: 'Shape',
                ks: {
                    o: { a: 1, k: [{ t: 0, s: [0] }, { t: 30, s: [100] }, { t: 60, s: [0] }] },
                    s: { a: 1, k: [{ t: 0, s: [80, 80] }, { t: 30, s: [100, 100] }, { t: 60, s: [80, 80] }] },
                },
                shapes: [{
                    ty: 'el', p: { a: 0, k: [256, 256] }, s: { a: 0, k: [200, 200] },
                }, {
                    ty: 'fl', c: { a: 0, k: [0.4, 0.5, 0.92, 1] },
                }],
                ip: 0, op: 60, st: 0,
            }],
        };

        const fileName = input.output || `animation_${Date.now()}.json`;
        const savedPath = _savePath(fileName);
        if (savedPath) {
            fs.writeFileSync(savedPath, JSON.stringify(lottie, null, 2));
            _logEntry({ type: 'lottie', prompt: input.prompt, savedPath });
        }

        return {
            result: `🎨 LOTTIE ANIMATION CREATED\n` +
                    `Prompt: "${input.prompt?.substring(0, 100)}"\n` +
                    (savedPath ? `Saved: ${savedPath}\n` : '') +
                    `Use with Lottie player (lottie-web, lottie-react).`
        };
    }

    // ─── Expose ──────────────────────────────────────────────
    window.floworkVideoGen = {
        generateVideo,
        videoStatus,
        recordScreen,
        stopRecording,
        createAnimation,
    };

    console.log('[Brain] ✅ VideoGen module loaded (Luma, Runway, Replicate, Screen Recording, Animation)');
})();
