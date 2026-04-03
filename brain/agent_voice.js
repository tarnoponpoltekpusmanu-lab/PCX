// =========================================================================
// FLOWORK OS - CLAUDE CODE FULL PARITY v2
// FILE: agent_voice.js
// DESCRIPTION: Native Voice Input — Streaming STT + Push-to-Talk
//              Claude Code: Voice/TTS parity (adapted for Electron)
//              Supports: Whisper API, Web Speech API fallback
// =========================================================================

window.voiceInput = {
    isRecording: false,
    mediaRecorder: null,
    audioChunks: [],
    stream: null,
    mode: 'push_to_talk', // or 'continuous'
    silenceTimeout: null,
    silenceThresholdMs: 2000,
    analyser: null,
    audioContext: null,
    _silenceFrames: 0,
    keybinding: { ctrl: true, shift: true, key: 'V' },

    // ─── INITIALIZE ──────────────────────────────────────────────────
    init: function() {
        // Register push-to-talk keybinding
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && e.key === 'V') {
                e.preventDefault();
                if (this.isRecording) {
                    this.stop();
                } else {
                    this.start();
                }
            }
        });
        console.log('[Voice] Initialized (Ctrl+Shift+V to toggle)');
    },

    // ─── START RECORDING ─────────────────────────────────────────────
    start: async function() {
        if (this.isRecording) return;

        try {
            // Request microphone access
            this.stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 16000
                }
            });

            // Setup audio analysis for silence detection
            this.audioContext = new AudioContext();
            const source = this.audioContext.createMediaStreamSource(this.stream);
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            source.connect(this.analyser);

            // Setup MediaRecorder
            const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                ? 'audio/webm;codecs=opus'
                : 'audio/webm';

            this.mediaRecorder = new MediaRecorder(this.stream, { mimeType });
            this.audioChunks = [];

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };

            this.mediaRecorder.onstop = () => {
                this._processAudio();
            };

            this.mediaRecorder.start(1000); // Collect data every 1s
            this.isRecording = true;
            this._silenceFrames = 0;

            // Start silence detection
            this._startSilenceDetection();

            // UI feedback
            if (window.appendToolMessage) {
                window.appendToolMessage('Voice', 'in_progress', 'Recording... (Ctrl+Shift+V to stop)');
            }
            this._updateUI(true);
            console.log('[Voice] Recording started');

        } catch(e) {
            console.error('[Voice] Failed to start:', e.message);
            // Fallback to Web Speech API
            this._startWebSpeechFallback();
        }
    },

    // ─── STOP RECORDING ──────────────────────────────────────────────
    stop: function() {
        if (!this.isRecording) return;

        this.isRecording = false;
        clearInterval(this._silenceInterval);

        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }

        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }

        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        this._updateUI(false);
        console.log('[Voice] Recording stopped');
    },

    // ─── SILENCE DETECTION ───────────────────────────────────────────
    _silenceInterval: null,
    _startSilenceDetection: function() {
        if (!this.analyser) return;

        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        const silenceThreshold = 10; // RMS threshold

        this._silenceInterval = setInterval(() => {
            if (!this.isRecording || !this.analyser) return;

            this.analyser.getByteTimeDomainData(dataArray);

            // Calculate RMS
            let rms = 0;
            for (let i = 0; i < bufferLength; i++) {
                const sample = (dataArray[i] - 128) / 128;
                rms += sample * sample;
            }
            rms = Math.sqrt(rms / bufferLength) * 100;

            if (rms < silenceThreshold) {
                this._silenceFrames++;
                // 2 seconds of silence at 10fps = 20 frames
                if (this._silenceFrames > 20) {
                    console.log('[Voice] Silence detected, stopping...');
                    this.stop();
                }
            } else {
                this._silenceFrames = 0;
            }
        }, 100); // Check every 100ms
    },

    // ─── PROCESS AUDIO (Whisper API) ─────────────────────────────────
    _processAudio: async function() {
        if (this.audioChunks.length === 0) return;

        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        this.audioChunks = [];

        if (window.appendToolMessage) {
            window.appendToolMessage('Voice', 'in_progress', 'Transcribing...');
        }

        // Try Whisper API via Go backend
        try {
            const formData = new FormData();
            formData.append('file', audioBlob, 'recording.webm');
            formData.append('model', 'whisper-1');

            const res = await fetch('http://127.0.0.1:5000/api/voice/transcribe', {
                method: 'POST',
                body: formData
            });

            if (res.ok) {
                const data = await res.json();
                const text = data.text || data.transcript || '';
                if (text.trim()) {
                    this._injectText(text.trim());
                    return;
                }
            }
        } catch(e) {
            console.warn('[Voice] Whisper API failed, trying OpenAI directly:', e.message);
        }

        // Try OpenAI Whisper API directly
        const apiKey = document.getElementById('input-api-key')?.value;
        const provider = document.getElementById('select-provider')?.value;

        if (apiKey && (provider === 'openai' || provider === 'groq')) {
            try {
                const formData = new FormData();
                formData.append('file', audioBlob, 'recording.webm');
                formData.append('model', provider === 'groq' ? 'whisper-large-v3' : 'whisper-1');

                const baseUrl = provider === 'groq'
                    ? 'https://api.groq.com/openai/v1'
                    : 'https://api.openai.com/v1';

                const res = await fetch(`${baseUrl}/audio/transcriptions`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${apiKey}` },
                    body: formData
                });

                if (res.ok) {
                    const data = await res.json();
                    if (data.text?.trim()) {
                        this._injectText(data.text.trim());
                        return;
                    }
                }
            } catch(e) {
                console.warn('[Voice] Direct Whisper failed:', e.message);
            }
        }

        // Fallback: Browser transcription (limited)
        console.warn('[Voice] No STT API available');
        if (window.appendToolMessage) {
            window.appendToolMessage('Voice', 'warning', 'No STT API available. Set OpenAI/Groq API key for voice transcription.');
        }
    },

    // ─── WEB SPEECH API FALLBACK ─────────────────────────────────────
    _webSpeechRecognition: null,
    _startWebSpeechFallback: function() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.error('[Voice] Web Speech API not available');
            if (window.appendToolMessage) {
                window.appendToolMessage('Voice', 'error', 'Voice input not available in this browser');
            }
            return;
        }

        this._webSpeechRecognition = new SpeechRecognition();
        this._webSpeechRecognition.continuous = true;
        this._webSpeechRecognition.interimResults = false;
        this._webSpeechRecognition.lang = 'en-US';

        this._webSpeechRecognition.onresult = (event) => {
            const last = event.results[event.results.length - 1];
            if (last.isFinal) {
                const text = last[0].transcript.trim();
                if (text) this._injectText(text);
            }
        };

        this._webSpeechRecognition.onerror = (event) => {
            console.error('[Voice] Speech recognition error:', event.error);
            this.isRecording = false;
            this._updateUI(false);
        };

        this._webSpeechRecognition.onend = () => {
            this.isRecording = false;
            this._updateUI(false);
        };

        this._webSpeechRecognition.start();
        this.isRecording = true;
        this._updateUI(true);
        console.log('[Voice] Web Speech API started (fallback mode)');
    },

    // ─── INJECT TRANSCRIBED TEXT ─────────────────────────────────────
    _injectText: function(text) {
        console.log(`[Voice] Transcribed: "${text}"`);
        const chatInput = document.getElementById('chat-input');
        if (chatInput) {
            chatInput.value = text;
            chatInput.focus();
            // Optionally auto-send
            if (window.appendToolMessage) {
                window.appendToolMessage('Voice', 'success', `"${text.substring(0, 60)}${text.length > 60 ? '...' : ''}"`);
            }
        }
    },

    // ─── UI UPDATE ───────────────────────────────────────────────────
    _updateUI: function(recording) {
        // Update any voice indicator in the UI
        const indicator = document.getElementById('voice-indicator');
        if (indicator) {
            indicator.style.display = recording ? 'flex' : 'none';
            indicator.textContent = recording ? 'Recording...' : '';
        }

        // Add pulsing class to chat input
        const chatInput = document.getElementById('chat-input');
        if (chatInput) {
            if (recording) {
                chatInput.placeholder = 'Listening... (Ctrl+Shift+V to stop)';
                chatInput.style.borderColor = '#ef4444';
            } else {
                chatInput.placeholder = 'Type a message...';
                chatInput.style.borderColor = '';
            }
        }
    }
};

// Initialize on load
setTimeout(() => window.voiceInput.init(), 2000);

console.log('[Flowork OS] Voice Input v2 loaded (Native + Web Speech fallback)');
