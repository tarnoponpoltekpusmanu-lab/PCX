// =========================================================================
// FLOWORK OS — Brain Voice Module
// Voice input using Web Speech API (browser-native, free).
// =========================================================================

(function() {
    'use strict';

    let recognition = null;
    let isListening = false;
    let fullTranscript = '';

    function start(input) {
        if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
            return { result: '❌ Speech Recognition not supported in this browser/environment.' };
        }

        if (isListening) return { result: '🎤 Already listening. Use voice_stop to stop.' };

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = input.language || input.lang || 'en-US';

        fullTranscript = '';

        recognition.onresult = (event) => {
            let interim = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                if (event.results[i].isFinal) {
                    fullTranscript += event.results[i][0].transcript + ' ';
                } else {
                    interim += event.results[i][0].transcript;
                }
            }
            // Display interim results in chat input
            const chatInput = document.getElementById('chat-input');
            if (chatInput) {
                chatInput.value = fullTranscript + interim;
            }
        };

        recognition.onerror = (event) => {
            console.error('[Voice] Error:', event.error);
            isListening = false;
        };

        recognition.onend = () => {
            isListening = false;
            // Auto-submit if there's content
            if (fullTranscript.trim() && input.auto_submit) {
                const chatInput = document.getElementById('chat-input');
                if (chatInput) {
                    chatInput.value = fullTranscript.trim();
                    // Trigger send button click
                    const sendBtn = document.getElementById('btn-send');
                    if (sendBtn) sendBtn.click();
                }
            }
        };

        recognition.start();
        isListening = true;

        console.log(`[Voice] 🎤 Listening (${recognition.lang})...`);
        return {
            result: `🎤 Voice recognition STARTED.\n` +
                    `Language: ${recognition.lang}\n` +
                    `Speak now... Use voice_stop to stop recording.`
        };
    }

    function stop(input) {
        if (!isListening || !recognition) {
            return { result: 'Not currently listening.' };
        }

        recognition.stop();
        isListening = false;

        const result = fullTranscript.trim();
        console.log(`[Voice] 🛑 Stopped. Transcript: "${result.substring(0, 100)}"`);

        return {
            result: `🛑 Voice recognition STOPPED.\n` +
                    `Transcript: "${result || '(no speech detected)'}"\n` +
                    `Length: ${result.length} chars`
        };
    }

    // ─── Expose ──────────────────────────────────────────────────────────
    window.floworkVoice = {
        start,
        stop,
        isListening: () => isListening,
        getTranscript: () => fullTranscript,
    };

    console.log('[Brain] ✅ Voice module loaded (Web Speech API)');
})();
