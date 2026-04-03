/**
 * ============================================================
 *  FLOWORKOS™ Voice TTS Engine
 *  FLOWORKOS™ native voice TTS engine
 * ============================================================
 *  Logic: Multi-provider Text-to-Speech with:
 *  - Provider registry (ElevenLabs, OpenAI, Google, browser native)
 *  - Auto-summarization for long text
 *  - Voice selection per channel/session
 *  - Audio caching
 *  - Streaming support
 * ============================================================
 */

(function () {
  'use strict';

  // ── Provider Registry ──────────────────────────────────────
  const _providers = new Map();
  const _audioCache = new Map();   // hash → { audioUrl, createdAt }
  const CACHE_MAX_ENTRIES = 100;
  const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

  // ── Built-in Providers ─────────────────────────────────────

  const PROVIDERS = {
    'browser': {
      id: 'browser',
      name: 'Browser Native (Web Speech API)',
      aliases: ['native', 'webspeech'],
      requiresKey: false,
      maxChars: 5000,
      voices: () => {
        return typeof speechSynthesis !== 'undefined'
          ? speechSynthesis.getVoices().map(v => ({
              id: v.name, name: v.name, lang: v.lang, default: v.default,
            }))
          : [];
      },
      speak: (text, options) => {
        return new Promise((resolve, reject) => {
          if (typeof speechSynthesis === 'undefined') {
            return reject(new Error('SpeechSynthesis not available'));
          }
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.rate = options?.rate || 1.0;
          utterance.pitch = options?.pitch || 1.0;
          utterance.volume = options?.volume || 1.0;

          if (options?.voice) {
            const voices = speechSynthesis.getVoices();
            const match = voices.find(v =>
              v.name.toLowerCase().includes(options.voice.toLowerCase())
            );
            if (match) utterance.voice = match;
          }
          if (options?.lang) utterance.lang = options.lang;

          utterance.onend = () => resolve({ played: true, duration: 0 });
          utterance.onerror = (e) => reject(new Error(`TTS error: ${e.error}`));

          speechSynthesis.cancel();
          speechSynthesis.speak(utterance);
        });
      },
    },

    'elevenlabs': {
      id: 'elevenlabs',
      name: 'ElevenLabs',
      aliases: ['11labs', 'eleven'],
      requiresKey: true,
      maxChars: 5000,
      apiBase: 'https://api.elevenlabs.io/v1',
      defaultVoice: 'Rachel',
      defaultModel: 'eleven_multilingual_v2',
      voices: async (apiKey) => {
        const resp = await fetch('https://api.elevenlabs.io/v1/voices', {
          headers: { 'xi-api-key': apiKey },
        });
        if (!resp.ok) throw new Error(`ElevenLabs API ${resp.status}`);
        const data = await resp.json();
        return (data.voices || []).map(v => ({
          id: v.voice_id, name: v.name, category: v.category,
        }));
      },
      speak: async (text, options) => {
        const apiKey = options?.apiKey;
        if (!apiKey) throw new Error('ElevenLabs API key required');

        const voiceId = options?.voiceId || 'EXAVITQu4vr4xnSDxMaL'; // Rachel default
        const model = options?.model || 'eleven_multilingual_v2';

        const resp = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
          {
            method: 'POST',
            headers: {
              'xi-api-key': apiKey,
              'Content-Type': 'application/json',
              'Accept': 'audio/mpeg',
            },
            body: JSON.stringify({
              text,
              model_id: model,
              voice_settings: {
                stability: options?.stability || 0.5,
                similarity_boost: options?.similarityBoost || 0.75,
              },
            }),
          }
        );

        if (!resp.ok) throw new Error(`ElevenLabs API ${resp.status}: ${await resp.text()}`);

        const audioBlob = await resp.blob();
        const audioUrl = URL.createObjectURL(audioBlob);

        return { audioUrl, blob: audioBlob, format: 'mp3' };
      },
    },

    'openai-tts': {
      id: 'openai-tts',
      name: 'OpenAI TTS',
      aliases: ['openai', 'openai_tts'],
      requiresKey: true,
      maxChars: 4096,
      defaultVoice: 'alloy',
      defaultModel: 'tts-1',
      voices: () => [
        { id: 'alloy', name: 'Alloy' },
        { id: 'echo', name: 'Echo' },
        { id: 'fable', name: 'Fable' },
        { id: 'onyx', name: 'Onyx' },
        { id: 'nova', name: 'Nova' },
        { id: 'shimmer', name: 'Shimmer' },
      ],
      speak: async (text, options) => {
        const apiKey = options?.apiKey;
        if (!apiKey) throw new Error('OpenAI API key required');

        const resp = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: options?.model || 'tts-1',
            input: text,
            voice: options?.voice || 'alloy',
            speed: options?.speed || 1.0,
            response_format: 'mp3',
          }),
        });

        if (!resp.ok) throw new Error(`OpenAI TTS ${resp.status}: ${await resp.text()}`);

        const audioBlob = await resp.blob();
        const audioUrl = URL.createObjectURL(audioBlob);

        return { audioUrl, blob: audioBlob, format: 'mp3' };
      },
    },

    'google-tts': {
      id: 'google-tts',
      name: 'Google Cloud TTS',
      aliases: ['google', 'gcp-tts'],
      requiresKey: true,
      maxChars: 5000,
      defaultVoice: 'en-US-Neural2-F',
      speak: async (text, options) => {
        const apiKey = options?.apiKey;
        if (!apiKey) throw new Error('Google API key required');

        const resp = await fetch(
          `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              input: { text },
              voice: {
                languageCode: options?.lang || 'en-US',
                name: options?.voice || 'en-US-Neural2-F',
              },
              audioConfig: {
                audioEncoding: 'MP3',
                speakingRate: options?.speed || 1.0,
                pitch: options?.pitch || 0,
              },
            }),
          }
        );

        if (!resp.ok) throw new Error(`Google TTS ${resp.status}: ${await resp.text()}`);

        const data = await resp.json();
        const audioBytes = atob(data.audioContent);
        const audioArray = new Uint8Array(audioBytes.length);
        for (let i = 0; i < audioBytes.length; i++) {
          audioArray[i] = audioBytes.charCodeAt(i);
        }

        const audioBlob = new Blob([audioArray], { type: 'audio/mpeg' });
        const audioUrl = URL.createObjectURL(audioBlob);

        return { audioUrl, blob: audioBlob, format: 'mp3' };
      },
    },
  };

  // ── Register built-in providers ────────────────────────────
  for (const [id, provider] of Object.entries(PROVIDERS)) {
    _providers.set(id, provider);
    if (provider.aliases) {
      for (const alias of provider.aliases) {
        _providers.set(alias, provider);
      }
    }
  }

  // ── Main TTS API ───────────────────────────────────────────

  /**
   * Speak text using specified or default provider
   *
   * @param {string} text - Text to speak
   * @param {Object} [options]
   * @param {string} [options.provider='browser'] - TTS provider
   * @param {string} [options.voice] - Voice name/ID
   * @param {string} [options.apiKey] - Provider API key
   * @param {number} [options.rate] - Speech rate (0.5-2.0)
   * @param {string} [options.lang] - Language code
   * @param {boolean} [options.cache=true] - Use cached audio
   * @returns {Promise<Object>}
   */
  async function speak(text, options) {
    options = options || {};
    if (!text || typeof text !== 'string') return { error: 'No text' };

    const providerId = options.provider || 'browser';
    const provider = _providers.get(providerId.toLowerCase());
    if (!provider) return { error: `TTS provider "${providerId}" not found` };

    // Auto-truncate long text
    const maxChars = provider.maxChars || 5000;
    let spokenText = text;
    if (text.length > maxChars) {
      spokenText = await _autoSummarize(text, maxChars);
    }

    // Check cache
    const cacheKey = _hashText(spokenText + providerId + (options.voice || ''));
    if (options.cache !== false && _audioCache.has(cacheKey)) {
      const cached = _audioCache.get(cacheKey);
      if (Date.now() - cached.createdAt < CACHE_TTL_MS) {
        console.log(`[FLOWORKOS TTS] Cache hit for "${spokenText.slice(0, 40)}..."`);
        return cached;
      }
      _audioCache.delete(cacheKey);
    }

    // Speak
    console.log(`[FLOWORKOS TTS] 🔊 ${provider.name}: "${spokenText.slice(0, 60)}..." (${spokenText.length} chars)`);

    try {
      const result = await provider.speak(spokenText, options);

      // Cache if audio URL
      if (result.audioUrl && options.cache !== false) {
        _audioCache.set(cacheKey, { ...result, createdAt: Date.now() });
        _trimCache();
      }

      return { status: 'ok', provider: provider.id, ...result };
    } catch (err) {
      console.error(`[FLOWORKOS TTS] Error:`, err);
      return { error: err.message, provider: provider.id };
    }
  }

  /**
   * Stop all speech
   */
  function stop() {
    if (typeof speechSynthesis !== 'undefined') {
      speechSynthesis.cancel();
    }
  }

  /**
   * Play audio from URL/blob
   */
  function playAudioUrl(url) {
    return new Promise((resolve, reject) => {
      const audio = new Audio(url);
      audio.onended = () => resolve({ played: true, duration: audio.duration });
      audio.onerror = (e) => reject(new Error('Audio playback error'));
      audio.play().catch(reject);
    });
  }

  // ── Provider Management ────────────────────────────────────

  function registerProvider(provider) {
    if (!provider?.id) return { error: 'Provider must have an id' };
    _providers.set(provider.id, provider);
    if (provider.aliases) {
      for (const alias of provider.aliases) {
        _providers.set(alias, provider);
      }
    }
    return { status: 'ok' };
  }

  function listProviders() {
    const seen = new Set();
    const result = [];
    for (const [, p] of _providers) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      result.push({
        id: p.id, name: p.name, requiresKey: p.requiresKey,
        maxChars: p.maxChars, aliases: p.aliases || [],
      });
    }
    return result;
  }

  async function listVoices(providerId, apiKey) {
    const provider = _providers.get(providerId || 'browser');
    if (!provider?.voices) return [];
    try {
      return await provider.voices(apiKey);
    } catch (err) {
      return [{ error: err.message }];
    }
  }

  // ── Helpers ────────────────────────────────────────────────

  async function _autoSummarize(text, maxChars) {
    // Simple truncation with sentence boundary
    const truncated = text.slice(0, maxChars);
    const lastSentence = truncated.lastIndexOf('. ');
    if (lastSentence > maxChars * 0.5) {
      return truncated.slice(0, lastSentence + 1);
    }
    return truncated + '...';
  }

  function _hashText(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash) + text.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  function _trimCache() {
    if (_audioCache.size <= CACHE_MAX_ENTRIES) return;
    const oldest = [..._audioCache.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt);
    while (_audioCache.size > CACHE_MAX_ENTRIES * 0.8) {
      const [key, val] = oldest.shift();
      if (val.audioUrl) URL.revokeObjectURL(val.audioUrl);
      _audioCache.delete(key);
    }
  }

  // ── Register to Window ─────────────────────────────────────
  window.FLOWORKOS_Voice = {
    speak,
    stop,
    playAudioUrl,
    registerProvider,
    listProviders,
    listVoices,
    PROVIDERS,
  };

  console.log('[FLOWORKOS] ✅ Voice TTS Engine loaded (browser, elevenlabs, openai, google)');
})();
