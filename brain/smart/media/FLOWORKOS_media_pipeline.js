/**
 * ============================================================
 *  FLOWORKOS™ Media Pipeline
 *  FLOWORKOS™ native media processing pipeline
 * ============================================================
 *  Logic: Process and understand media content:
 *  - Image analysis (vision models)
 *  - File type detection (MIME)
 *  - Image resize/optimize for LLM context
 *  - Audio transcription (Whisper)
 *  - Screenshot understanding
 *  - Attachment handling
 * ============================================================
 */

(function () {
  'use strict';

  // ── MIME Types ─────────────────────────────────────────────
  const MIME_MAP = {
    // Images
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.avif': 'image/avif',
    // Audio
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
    '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
    '.webm': 'audio/webm',
    // Video
    '.mp4': 'video/mp4', '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska',
    '.mov': 'video/quicktime', '.wmv': 'video/x-ms-wmv',
    // Documents
    '.pdf': 'application/pdf', '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // Code/Text
    '.json': 'application/json', '.xml': 'application/xml',
    '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
    '.ts': 'text/typescript', '.py': 'text/x-python', '.md': 'text/markdown',
    '.txt': 'text/plain', '.csv': 'text/csv', '.yaml': 'text/yaml',
    '.yml': 'text/yaml', '.toml': 'text/toml',
    // Archives
    '.zip': 'application/zip', '.tar': 'application/x-tar',
    '.gz': 'application/gzip', '.rar': 'application/x-rar-compressed',
  };

  const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif']);
  const AUDIO_TYPES = new Set(['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/mp4', 'audio/aac', 'audio/webm']);
  const VIDEO_TYPES = new Set(['video/mp4', 'video/x-msvideo', 'video/x-matroska', 'video/quicktime']);

  // ── MIME Detection ─────────────────────────────────────────

  function getMimeType(filename) {
    if (!filename) return 'application/octet-stream';
    const ext = '.' + filename.split('.').pop().toLowerCase();
    return MIME_MAP[ext] || 'application/octet-stream';
  }

  function isImage(filenameOrMime) {
    const mime = MIME_MAP['.' + filenameOrMime.split('.').pop()?.toLowerCase()] || filenameOrMime;
    return IMAGE_TYPES.has(mime);
  }

  function isAudio(filenameOrMime) {
    const mime = MIME_MAP['.' + filenameOrMime.split('.').pop()?.toLowerCase()] || filenameOrMime;
    return AUDIO_TYPES.has(mime);
  }

  function isVideo(filenameOrMime) {
    const mime = MIME_MAP['.' + filenameOrMime.split('.').pop()?.toLowerCase()] || filenameOrMime;
    return VIDEO_TYPES.has(mime);
  }

  // ── Image Processing ───────────────────────────────────────

  /**
   * Resize image for LLM vision input
   * Most vision models accept max 2048x2048 at ~768 tokens per image
   */
  function resizeImageForVision(imageBlob, maxDim) {
    maxDim = maxDim || 1024;
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;

        // Scale down if needed
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(img.src);
            resolve({
              blob,
              width,
              height,
              originalWidth: img.naturalWidth,
              originalHeight: img.naturalHeight,
              resized: width !== img.naturalWidth || height !== img.naturalHeight,
            });
          },
          'image/jpeg',
          0.85
        );
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = URL.createObjectURL(imageBlob);
    });
  }

  /**
   * Convert image to base64 data URI (for LLM vision API)
   */
  function imageToBase64(imageBlob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Failed to read image'));
      reader.readAsDataURL(imageBlob);
    });
  }

  /**
   * Analyze image using vision model
   */
  async function analyzeImage(imageBlob, prompt, options) {
    options = options || {};
    prompt = prompt || 'Describe this image in detail.';

    // Resize for vision
    const resized = await resizeImageForVision(imageBlob, options.maxDim || 1024);
    const base64 = await imageToBase64(resized.blob);

    // Call vision-capable LLM
    const provider = options.provider || 'gemini-2.5-flash';
    const apiKey = options.apiKey;

    if (!apiKey) {
      return { error: 'API key required for image analysis' };
    }

    // Build multimodal request
    if (provider.includes('gemini')) {
      return await _analyzeWithGemini(base64, prompt, provider, apiKey);
    } else if (provider.includes('gpt') || provider.includes('openai')) {
      return await _analyzeWithOpenAI(base64, prompt, provider, apiKey);
    } else if (provider.includes('claude')) {
      return await _analyzeWithClaude(base64, prompt, provider, apiKey);
    }

    return { error: `Vision not supported for provider "${provider}"` };
  }

  async function _analyzeWithGemini(base64, prompt, model, apiKey) {
    const mimeType = base64.split(';')[0].split(':')[1];
    const imageData = base64.split(',')[1];

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: imageData } },
            ],
          }],
        }),
      }
    );

    if (!resp.ok) throw new Error(`Gemini Vision ${resp.status}`);
    const data = await resp.json();
    return {
      description: data.candidates?.[0]?.content?.parts?.[0]?.text || '',
      model,
    };
  }

  async function _analyzeWithOpenAI(base64, prompt, model, apiKey) {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model || 'gpt-4o',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: base64, detail: 'auto' } },
          ],
        }],
        max_tokens: 1024,
      }),
    });

    if (!resp.ok) throw new Error(`OpenAI Vision ${resp.status}`);
    const data = await resp.json();
    return {
      description: data.choices?.[0]?.message?.content || '',
      model,
    };
  }

  async function _analyzeWithClaude(base64, prompt, model, apiKey) {
    const mimeType = base64.split(';')[0].split(':')[1];
    const imageData = base64.split(',')[1];

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: imageData } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    });

    if (!resp.ok) throw new Error(`Claude Vision ${resp.status}`);
    const data = await resp.json();
    return {
      description: data.content?.[0]?.text || '',
      model,
    };
  }

  // ── Audio Transcription ────────────────────────────────────

  /**
   * Transcribe audio using Whisper API
   */
  async function transcribeAudio(audioBlob, options) {
    options = options || {};
    const apiKey = options.apiKey;

    if (!apiKey) return { error: 'OpenAI API key required for transcription' };

    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.wav');
    formData.append('model', options.model || 'whisper-1');
    if (options.language) formData.append('language', options.language);

    const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData,
    });

    if (!resp.ok) throw new Error(`Whisper API ${resp.status}: ${await resp.text()}`);

    const data = await resp.json();
    return {
      text: data.text || '',
      language: data.language,
      duration: data.duration,
    };
  }

  // ── Media Store ────────────────────────────────────────────
  const _mediaStore = new Map(); // mediaId → { blob, url, metadata }

  function storeMedia(blob, metadata) {
    const id = 'media_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    const url = URL.createObjectURL(blob);
    _mediaStore.set(id, { blob, url, metadata: metadata || {}, createdAt: Date.now() });
    return { id, url };
  }

  function getMedia(mediaId) {
    return _mediaStore.get(mediaId) || null;
  }

  function removeMedia(mediaId) {
    const media = _mediaStore.get(mediaId);
    if (media?.url) URL.revokeObjectURL(media.url);
    _mediaStore.delete(mediaId);
  }

  // ── Register to Window ─────────────────────────────────────
  window.FLOWORKOS_Media = {
    // MIME
    getMimeType, isImage, isAudio, isVideo, MIME_MAP,
    // Image
    resizeImageForVision, imageToBase64, analyzeImage,
    // Audio
    transcribeAudio,
    // Store
    storeMedia, getMedia, removeMedia,
  };

  console.log('[FLOWORKOS] ✅ Media Pipeline loaded (vision, whisper, mime)');
})();
