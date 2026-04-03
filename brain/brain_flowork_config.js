// =========================================================================
// FLOWORK OS — Brain Config Manager
// Handles save/load configuration (API keys, provider, email, etc.)
// Replaces agent_db.js config functions
// =========================================================================

(function() {
    'use strict';

    const CONFIG_KEY = 'flowork_builder_config';

    // ─── GATHER CONFIG FROM UI ──────────────────────────────────────────
    function _gatherConfig() {
        return {
            provider: window.getEl?.('select-provider')?.value || 'gemini-3.1-pro-preview',
            apiKey: window.getEl?.('input-api-key')?.value || '',
            appName: window.getEl?.('input-app-name')?.value || '',
            language: window.getEl?.('select-language')?.value || 'javascript',
            outputType: window.getEl?.('select-output-type')?.value || 'app',
            emailHost: window.getEl?.('input-email-host')?.value || '',
            emailPort: window.getEl?.('input-email-port')?.value || '993',
            emailUser: window.getEl?.('input-email-user')?.value || '',
            emailPassword: window.getEl?.('input-email-password')?.value || '',
        };
    }

    // ─── APPLY CONFIG TO UI ─────────────────────────────────────────────
    function _applyConfig(config) {
        if (!config) return;
        try {
            if (config.provider && window.getEl?.('select-provider')) window.getEl('select-provider').value = config.provider;
            if (config.apiKey && window.getEl?.('input-api-key')) window.getEl('input-api-key').value = config.apiKey;
            if (config.appName && window.getEl?.('input-app-name')) window.getEl('input-app-name').value = config.appName;
            if (config.language && window.getEl?.('select-language')) window.getEl('select-language').value = config.language;
            if (config.outputType && window.getEl?.('select-output-type')) window.getEl('select-output-type').value = config.outputType;
            if (config.emailHost && window.getEl?.('input-email-host')) window.getEl('input-email-host').value = config.emailHost;
            if (config.emailPort && window.getEl?.('input-email-port')) window.getEl('input-email-port').value = config.emailPort;
            if (config.emailUser && window.getEl?.('input-email-user')) window.getEl('input-email-user').value = config.emailUser;
            if (config.emailPassword && window.getEl?.('input-email-password')) window.getEl('input-email-password').value = config.emailPassword;
            if (config.appName) window.currentAppId = config.appName;
        } catch(e) {
            console.warn('[Config] Error applying config:', e.message);
        }
    }

    // ─── SAVE CONFIG ────────────────────────────────────────────────────
    window.manualSaveConfig = async function() {
        const btn = document.querySelector('button[onclick*="manualSaveConfig"]');
        if (btn) btn.innerHTML = '⏳ Saving...';

        const config = _gatherConfig();

        // Always save to localStorage (works offline)
        localStorage.setItem(CONFIG_KEY, JSON.stringify(config));

        // Try to sync to Go backend
        try {
            const res = await fetch('http://127.0.0.1:5000/api/variables', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ [CONFIG_KEY]: JSON.stringify(config) })
            });

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            if (window.appendToolMessage) window.appendToolMessage('Config', 'success', '✅ Configuration saved!');
        } catch(e) {
            // localStorage save still succeeded
            console.warn('[Config] Go backend sync skipped:', e.message);
            if (window.appendToolMessage) window.appendToolMessage('Config', 'success', '✅ Config saved locally (backend offline)');
        }

        if (btn) btn.innerHTML = '💾 Save Config';
    };

    // ─── AUTO-SAVE ON INPUT CHANGE ──────────────────────────────────────
    window.saveConfigToEngine = async function() {
        clearTimeout(window._configSaveTimeout);
        window._configSaveTimeout = setTimeout(() => {
            const config = _gatherConfig();
            localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
            // Background sync to Go backend (no UI feedback)
            fetch('http://127.0.0.1:5000/api/variables', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ [CONFIG_KEY]: JSON.stringify(config) })
            }).catch(() => {});
        }, 800);
    };

    // ─── LOAD CONFIG ────────────────────────────────────────────────────
    window.loadConfigFromEngine = async function() {
        let configStr = null;

        // Try Go backend first
        try {
            const res = await fetch('http://127.0.0.1:5000/api/variables');
            const result = await res.json();
            if (result?.data?.[CONFIG_KEY]) {
                configStr = result.data[CONFIG_KEY];
            } else if (result?.data?.key === CONFIG_KEY && result?.data?.value) {
                configStr = result.data.value;
            }
        } catch(e) {
            console.warn('[Config] Backend not available, using localStorage');
        }

        // Fallback to localStorage
        if (!configStr) {
            configStr = localStorage.getItem(CONFIG_KEY);
        }

        if (configStr) {
            try {
                const config = JSON.parse(configStr);
                _applyConfig(config);
                console.log('[Config] ✅ Configuration loaded & applied');
            } catch(e) {
                console.error('[Config] ❌ Failed to parse config:', e.message);
            }
        }
    };

    // ─── GET / SET CONFIG TOOLS (for AI access) ─────────────────────────
    window.getConfig = function(input) {
        const config = _gatherConfig();
        if (input?.key) return { result: config[input.key] || 'not set' };
        // Return config without exposing full API key
        const safe = { ...config };
        if (safe.apiKey) safe.apiKey = safe.apiKey.substring(0, 8) + '...(hidden)';
        return { result: JSON.stringify(safe, null, 2) };
    };

    window.setConfig = function(input) {
        if (input?.key && input?.value !== undefined) {
            const mapping = {
                provider: 'select-provider',
                apiKey: 'input-api-key',
                appName: 'input-app-name',
                language: 'select-language',
                outputType: 'select-output-type',
            };
            const elId = mapping[input.key];
            if (elId && window.getEl?.(elId)) {
                window.getEl(elId).value = input.value;
                window.saveConfigToEngine();
                return { result: `Config "${input.key}" set to "${input.value}"` };
            }
        }
        return { error: 'Unknown config key' };
    };

    // ─── AUTO-LOAD CONFIG ON STARTUP ────────────────────────────────────
    // Wait for DOM to be fully ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(window.loadConfigFromEngine, 500);
        });
    } else {
        setTimeout(window.loadConfigFromEngine, 500);
    }

    // ─── WIRE INPUT CHANGE EVENTS ───────────────────────────────────────
    setTimeout(() => {
        ['select-provider', 'input-api-key', 'input-app-name', 'select-language', 'select-output-type'].forEach(id => {
            const el = window.getEl?.(id);
            if (el) {
                el.addEventListener('change', window.saveConfigToEngine);
                el.addEventListener('input', window.saveConfigToEngine);
            }
        });
    }, 1000);

    // ─── DEV MODE DETECTION (from .env file) ──────────────────────────────
    // Developer sets FLOWORK_MODE=DEV or FLOWORK_MODE=PUBLISH in .env
    // AI CANNOT modify .env (kernel protected file)
    //
    // 🔒 SECURITY: Immutable getter. AI cannot override via window.floworkDevMode = true
    try {
        const _fs = window.originalNodeRequire?.('fs') || require('fs');
        const _path = window.originalNodeRequire?.('path') || require('path');
        const _envPath = _path.join(__dirname, '.env');

        function _readEnvMode() {
            try {
                if (!_fs.existsSync(_envPath)) return false;
                const content = _fs.readFileSync(_envPath, 'utf8');
                const match = content.match(/FLOWORK_MODE\s*=\s*(\w+)/);
                return match && match[1].toUpperCase() === 'DEV';
            } catch(e) {
                return false; // Fail-safe: can't read .env → PUBLISH mode
            }
        }

        Object.defineProperty(window, 'floworkDevMode', {
            get: _readEnvMode,
            set: function() {
                console.error('[🔒 SECURITY] ❌ Blocked attempt to modify floworkDevMode! Change .env file instead.');
            },
            configurable: false,
            enumerable: true,
        });

        window.floworkEngineRoot = __dirname;

        console.log(`[Brain] 🔧 Mode: ${window.floworkDevMode ? '🛠️ DEV (full engine access)' : '📦 PUBLISH (sandbox only)'}`);
        console.log(`[Brain] 📂 Engine root: ${window.floworkEngineRoot}`);
        console.log(`[Brain] 📄 .env path: ${_envPath}`);
    } catch(e) {
        try {
            Object.defineProperty(window, 'floworkDevMode', {
                value: false, writable: false, configurable: false, enumerable: true,
            });
        } catch(e2) {}
        window.floworkEngineRoot = '';
        console.warn('[Brain] Could not detect mode:', e.message);
    }

    console.log('[Brain] ✅ Config Manager loaded — save/load/auto-sync ready');

})();
