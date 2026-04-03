// =========================================================================
// FLOWORK OS — Brain Image Generation Module
// Gives the AI "creativity" — generate images via DALL-E 3, Flux, Imagen.
//
// Tools: generate_image, edit_image, imagegen_status
// =========================================================================

(function() {
    'use strict';

    const fs = window.originalNodeRequire?.('fs') || null;
    const pathMod = window.originalNodeRequire?.('path') || null;

    // ─── State ──────────────────────────────────────────────────────
    const _history = [];   // Recent generation history
    const MAX_HISTORY = 50;

    // ─── Get API keys ───────────────────────────────────────────────
    function _getKey(provider) {
        const env = window._envConfig || {};
        if (provider === 'openai' || provider === 'dall-e') {
            return env.OPENAI_API_KEY || (() => {
                try { return JSON.parse(localStorage.getItem('flowork_builder_config') || '{}').openaiKey || ''; } catch(e) { return ''; }
            })();
        }
        if (provider === 'gemini' || provider === 'imagen') {
            return env.GEMINI_API_KEY || window.getEl?.('input-api-key')?.value || '';
        }
        if (provider === 'together' || provider === 'flux') {
            return env.TOGETHER_API_KEY || '';
        }
        if (provider === 'replicate') {
            return env.REPLICATE_API_KEY || '';
        }
        return '';
    }

    // ─── DALL-E 3 ───────────────────────────────────────────────────
    async function _generateDallE(prompt, options) {
        const apiKey = options.api_key || _getKey('openai');
        if (!apiKey) throw new Error('OpenAI API key required for DALL-E. Set OPENAI_API_KEY in .env');

        const resp = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: options.model || 'dall-e-3',
                prompt,
                n: 1,
                size: options.size || '1024x1024',
                quality: options.quality || 'standard',
                style: options.style || 'vivid',
                response_format: 'b64_json',
            }),
            signal: AbortSignal.timeout(120000),
        });

        if (!resp.ok) throw new Error(`DALL-E API ${resp.status}: ${(await resp.text()).substring(0, 300)}`);

        const data = await resp.json();
        const b64 = data.data[0].b64_json;
        const revisedPrompt = data.data[0].revised_prompt || prompt;

        return { b64, revisedPrompt, provider: 'dall-e-3' };
    }

    // ─── Gemini Imagen ──────────────────────────────────────────────
    async function _generateImagen(prompt, options) {
        const apiKey = options.api_key || _getKey('gemini');
        if (!apiKey) throw new Error('Gemini API key required. Set GEMINI_API_KEY in .env');

        const model = options.model || 'imagen-3.0-generate-002';
        const resp = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    instances: [{ prompt }],
                    parameters: {
                        sampleCount: 1,
                        aspectRatio: options.aspect_ratio || '1:1',
                    },
                }),
                signal: AbortSignal.timeout(120000),
            }
        );

        if (!resp.ok) throw new Error(`Imagen API ${resp.status}: ${(await resp.text()).substring(0, 300)}`);

        const data = await resp.json();
        const b64 = data.predictions?.[0]?.bytesBase64Encoded;
        if (!b64) throw new Error('No image returned from Imagen');

        return { b64, revisedPrompt: prompt, provider: 'imagen-3' };
    }

    // ─── Together AI (Flux) ─────────────────────────────────────────
    async function _generateFlux(prompt, options) {
        const apiKey = options.api_key || _getKey('together');
        if (!apiKey) throw new Error('Together AI API key required for Flux. Set TOGETHER_API_KEY in .env');

        const model = options.model || 'black-forest-labs/FLUX.1-schnell';
        const resp = await fetch('https://api.together.xyz/v1/images/generations', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model,
                prompt,
                width: parseInt(options.width) || 1024,
                height: parseInt(options.height) || 1024,
                steps: parseInt(options.steps) || 4,
                n: 1,
                response_format: 'b64_json',
            }),
            signal: AbortSignal.timeout(120000),
        });

        if (!resp.ok) throw new Error(`Flux API ${resp.status}: ${(await resp.text()).substring(0, 300)}`);

        const data = await resp.json();
        const b64 = data.data?.[0]?.b64_json;
        if (!b64) throw new Error('No image returned from Flux');

        return { b64, revisedPrompt: prompt, provider: 'flux-schnell' };
    }

    // ─── Main generate_image tool ───────────────────────────────────
    async function generateImage(input) {
        const prompt = input.prompt || input.description || input.text || '';
        if (!prompt.trim()) return { error: 'Missing prompt. Usage: generate_image { prompt: "a futuristic city" }' };

        const provider = (input.provider || 'dall-e').toLowerCase();
        const savePath = input.save || input.output || null;

        try {
            let result;
            if (provider === 'dall-e' || provider === 'openai' || provider === 'dalle') {
                result = await _generateDallE(prompt, input);
            } else if (provider === 'imagen' || provider === 'gemini') {
                result = await _generateImagen(prompt, input);
            } else if (provider === 'flux' || provider === 'together') {
                result = await _generateFlux(prompt, input);
            } else {
                // Default to DALL-E, fallback to Imagen
                try {
                    result = await _generateDallE(prompt, input);
                } catch(e) {
                    result = await _generateImagen(prompt, input);
                }
            }

            // Save to file
            let savedPath = null;
            if (fs && pathMod) {
                const fileName = savePath || `generated_${Date.now()}.png`;
                savedPath = pathMod.resolve(window._fmBasePath || '.', fileName);
                const dir = pathMod.dirname(savedPath);
                fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(savedPath, Buffer.from(result.b64, 'base64'));
            }

            // Record history
            _history.push({
                prompt,
                provider: result.provider,
                revisedPrompt: result.revisedPrompt,
                savedPath,
                ts: new Date().toISOString(),
            });
            if (_history.length > MAX_HISTORY) _history.shift();

            return {
                result: `🎨 IMAGE GENERATED\\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\\n` +
                        `Prompt: "${prompt.substring(0, 100)}"\\n` +
                        `Provider: ${result.provider}\\n` +
                        (result.revisedPrompt !== prompt ? `Revised: "${result.revisedPrompt.substring(0, 100)}"\\n` : '') +
                        (savedPath ? `Saved: ${savedPath}\\n` : '') +
                        `Size: ~${Math.round(result.b64.length * 0.75 / 1024)}KB`,
                image_b64: result.b64,   // For inline display
                saved_path: savedPath,
            };
        } catch(err) {
            return { error: `Image generation failed: ${err.message}` };
        }
    }

    // ─── Edit image (DALL-E edit/inpaint) ───────────────────────────
    async function editImage(input) {
        const imagePath = input.image || input.file;
        const prompt = input.prompt || '';
        if (!imagePath || !prompt) return { error: 'Missing image path and/or prompt.' };
        if (!fs) return { error: 'File system not available.' };

        const apiKey = input.api_key || _getKey('openai');
        if (!apiKey) return { error: 'OpenAI API key required for image editing.' };

        const absPath = pathMod.resolve(window._fmBasePath || '.', imagePath);
        if (!fs.existsSync(absPath)) return { error: `Image not found: ${absPath}` };

        try {
            const imageBuffer = fs.readFileSync(absPath);
            const imageBlob = new Blob([imageBuffer], { type: 'image/png' });

            const formData = new FormData();
            formData.append('image', imageBlob, 'image.png');
            formData.append('prompt', prompt);
            formData.append('model', 'dall-e-2');  // Only DALL-E 2 supports edit
            formData.append('n', '1');
            formData.append('size', input.size || '1024x1024');
            formData.append('response_format', 'b64_json');

            const resp = await fetch('https://api.openai.com/v1/images/edits', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${apiKey}` },
                body: formData,
                signal: AbortSignal.timeout(120000),
            });

            if (!resp.ok) throw new Error(`DALL-E Edit API ${resp.status}: ${(await resp.text()).substring(0, 300)}`);

            const data = await resp.json();
            const b64 = data.data[0].b64_json;

            // Save edited image
            const outputPath = input.output || absPath.replace(/\.(\w+)$/, '_edited.$1');
            fs.writeFileSync(outputPath, Buffer.from(b64, 'base64'));

            return {
                result: `🎨 IMAGE EDITED\\n` +
                        `Source: ${imagePath}\\n` +
                        `Prompt: "${prompt.substring(0, 100)}"\\n` +
                        `Saved: ${outputPath}`,
                image_b64: b64,
                saved_path: outputPath,
            };
        } catch(err) {
            return { error: `Image edit failed: ${err.message}` };
        }
    }

    // ─── Status ─────────────────────────────────────────────────────
    function imagegenStatus(input) {
        let report = `🎨 IMAGE GEN STATUS\\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\\n`;
        report += `Providers:\\n`;
        report += `  DALL-E 3: ${_getKey('openai') ? '✅ key set' : '❌ no key (set OPENAI_API_KEY)'}\\n`;
        report += `  Imagen 3: ${_getKey('gemini') ? '✅ key set' : '❌ no key (set GEMINI_API_KEY)'}\\n`;
        report += `  Flux (Together): ${_getKey('together') ? '✅ key set' : '❌ no key (set TOGETHER_API_KEY)'}\\n`;
        report += `\\nHistory: ${_history.length} images generated\\n`;

        if (_history.length > 0) {
            report += `\\nRecent:\\n`;
            for (const h of _history.slice(-5)) {
                report += `  • ${h.ts}: "${h.prompt.substring(0, 60)}" via ${h.provider}\\n`;
            }
        }

        return { result: report };
    }

    // ─── Expose ──────────────────────────────────────────────────────
    window.floworkImageGen = {
        generateImage,
        editImage,
        imagegenStatus,
    };

    console.log('[Brain] ✅ ImageGen module loaded (DALL-E, Imagen, Flux)');

})();
