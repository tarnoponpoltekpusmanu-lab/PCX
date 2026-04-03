// =========================================================================
// FLOWORK OS - SETTINGS UI
// FILE: brain/settings_ui.js
// DESKRIPSI: Settings overlay to replace .env manual editing.
//            Reads from FLOWORKOS_Env and saves to localStorage.
//            Categories: AI, Backup, Channels, Email, TTS, Vision, MCP, Security, Session
// =========================================================================

(function () {
    'use strict';

    // ── Settings Schema ─────────────────────────────────────────
    const SETTINGS_GROUPS = [
        {
            id: 'ai', label: '🤖 AI Provider', icon: '🤖', color: '#00f0ff',
            fields: [
                { key: 'FLOWORK_MODE', label: 'Engine Mode', type: 'select', options: ['DEV', 'PUBLISH'], desc: 'DEV = AI can evolve | PUBLISH = AI locked' },
                { key: 'FLOWORK_AI_PROVIDER', label: 'AI Provider', type: 'select', options: ['gemini', 'openai', 'anthropic', 'groq', 'ollama'], desc: 'Main LLM provider' },
                { key: 'FLOWORK_AI_MODEL', label: 'AI Model', type: 'text', placeholder: 'gemini-2.5-flash', desc: 'Model name for the selected provider' },
                { key: 'FLOWORK_AI_KEY', label: 'API Key', type: 'password', placeholder: 'Your API key...', desc: 'API key for the selected provider', sensitive: true },
            ]
        },
        {
            id: 'backup', label: '🔄 Backup Providers', icon: '🔄', color: '#ffd166',
            fields: [
                { key: 'FLOWORK_BACKUP_PROVIDER_1', label: 'Backup 1 Provider', type: 'select', options: ['', 'openai', 'anthropic', 'gemini', 'groq'] },
                { key: 'FLOWORK_BACKUP_MODEL_1', label: 'Backup 1 Model', type: 'text', placeholder: 'gpt-4o-mini' },
                { key: 'FLOWORK_BACKUP_KEY_1', label: 'Backup 1 Key', type: 'password', placeholder: 'API key...', sensitive: true },
                { key: 'FLOWORK_BACKUP_PROVIDER_2', label: 'Backup 2 Provider', type: 'select', options: ['', 'openai', 'anthropic', 'gemini', 'groq'] },
                { key: 'FLOWORK_BACKUP_MODEL_2', label: 'Backup 2 Model', type: 'text', placeholder: 'claude-3-haiku-20240307' },
                { key: 'FLOWORK_BACKUP_KEY_2', label: 'Backup 2 Key', type: 'password', placeholder: 'API key...', sensitive: true },
            ]
        },
        {
            id: 'whatsapp', label: '📱 WhatsApp', icon: '📱', color: '#25D366',
            fields: [
                { key: 'FLOWORK_WHATSAPP_ENABLED', label: 'Enable WhatsApp', type: 'toggle' },
                { key: 'FLOWORK_WHATSAPP_PHONE_ID', label: 'Phone Number ID', type: 'text', placeholder: 'From Facebook Developers' },
                { key: 'FLOWORK_WHATSAPP_TOKEN', label: 'Access Token', type: 'password', placeholder: 'WhatsApp token...', sensitive: true },
                { key: 'FLOWORK_WHATSAPP_VERIFY_TOKEN', label: 'Verify Token', type: 'text', placeholder: 'my_verify_token' },
            ]
        },
        {
            id: 'telegram', label: '✈️ Telegram', icon: '✈️', color: '#0088cc',
            fields: [
                { key: 'FLOWORK_TELEGRAM_ENABLED', label: 'Enable Telegram', type: 'toggle' },
                { key: 'FLOWORK_TELEGRAM_BOT_TOKEN', label: 'Bot Token', type: 'password', placeholder: 'From @BotFather', sensitive: true },
                { key: 'FLOWORK_TELEGRAM_WEBHOOK_URL', label: 'Webhook URL', type: 'text', placeholder: 'https://...' },
            ]
        },
        {
            id: 'discord', label: '🎮 Discord', icon: '🎮', color: '#5865F2',
            fields: [
                { key: 'FLOWORK_DISCORD_ENABLED', label: 'Enable Discord', type: 'toggle' },
                { key: 'FLOWORK_DISCORD_BOT_TOKEN', label: 'Bot Token', type: 'password', placeholder: 'Discord bot token...', sensitive: true },
                { key: 'FLOWORK_DISCORD_APP_ID', label: 'Application ID', type: 'text', placeholder: 'Discord app ID' },
            ]
        },
        {
            id: 'slack', label: '💼 Slack', icon: '💼', color: '#4A154B',
            fields: [
                { key: 'FLOWORK_SLACK_ENABLED', label: 'Enable Slack', type: 'toggle' },
                { key: 'FLOWORK_SLACK_BOT_TOKEN', label: 'Bot Token', type: 'password', placeholder: 'xoxb-...', sensitive: true },
                { key: 'FLOWORK_SLACK_SIGNING_SECRET', label: 'Signing Secret', type: 'password', placeholder: 'Slack signing secret...', sensitive: true },
            ]
        },
        {
            id: 'email', label: '📧 Email (IMAP)', icon: '📧', color: '#ea4335',
            fields: [
                { key: 'FLOWORK_EMAIL_HOST', label: 'IMAP Host', type: 'text', placeholder: 'imap.gmail.com' },
                { key: 'FLOWORK_EMAIL_PORT', label: 'Port', type: 'number', placeholder: '993' },
                { key: 'FLOWORK_EMAIL_USER', label: 'Email Address', type: 'text', placeholder: 'you@gmail.com' },
                { key: 'FLOWORK_EMAIL_PASSWORD', label: 'Password', type: 'password', placeholder: 'App password...', sensitive: true },
            ]
        },
        {
            id: 'tts', label: '🔊 Voice / TTS', icon: '🔊', color: '#ff6b6b',
            fields: [
                { key: 'FLOWORK_TTS_PROVIDER', label: 'TTS Provider', type: 'select', options: ['browser', 'elevenlabs', 'openai-tts', 'google-tts'] },
                { key: 'FLOWORK_TTS_VOICE', label: 'Voice Name', type: 'text', placeholder: 'Default voice' },
                { key: 'FLOWORK_ELEVENLABS_KEY', label: 'ElevenLabs Key', type: 'password', placeholder: 'API key...', sensitive: true },
                { key: 'FLOWORK_ELEVENLABS_VOICE_ID', label: 'ElevenLabs Voice ID', type: 'text', placeholder: 'Voice ID' },
                { key: 'FLOWORK_OPENAI_TTS_KEY', label: 'OpenAI TTS Key', type: 'password', placeholder: 'API key...', sensitive: true },
                { key: 'FLOWORK_OPENAI_TTS_VOICE', label: 'OpenAI TTS Voice', type: 'select', options: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] },
                { key: 'FLOWORK_GOOGLE_TTS_KEY', label: 'Google TTS Key', type: 'password', placeholder: 'API key...', sensitive: true },
            ]
        },
        {
            id: 'vision', label: '👁️ Vision & Whisper', icon: '👁️', color: '#a78bfa',
            fields: [
                { key: 'FLOWORK_VISION_PROVIDER', label: 'Vision Provider', type: 'text', placeholder: 'gemini-2.5-flash' },
                { key: 'FLOWORK_VISION_KEY', label: 'Vision API Key', type: 'password', placeholder: 'API key...', sensitive: true },
                { key: 'FLOWORK_WHISPER_KEY', label: 'Whisper API Key', type: 'password', placeholder: 'API key...', sensitive: true },
            ]
        },
        {
            id: 'mcp', label: '🔌 MCP Servers', icon: '🔌', color: '#06b6d4',
            fields: [
                { key: 'FLOWORK_MCP_SERVERS', label: 'MCP Servers', type: 'textarea', placeholder: 'name|transport|url, comma-separated', desc: 'Format: name|transport|url' },
            ]
        },
        {
            id: 'security', label: '🛡️ Security', icon: '🛡️', color: '#f43f5e',
            fields: [
                { key: 'FLOWORK_REDACTION_ENABLED', label: 'Enable Redaction', type: 'toggle' },
                { key: 'FLOWORK_TOOL_POLICY_ENABLED', label: 'Enable Tool Policy', type: 'toggle' },
            ]
        },
        {
            id: 'session', label: '💾 Session', icon: '💾', color: '#84cc16',
            fields: [
                { key: 'FLOWORK_SESSION_AUTOSAVE', label: 'Auto-Save Sessions', type: 'toggle' },
                { key: 'FLOWORK_SESSION_INTERVAL', label: 'Save Interval (sec)', type: 'number', placeholder: '30' },
            ]
        },
    ];

    // ── Render Settings View ────────────────────────────────────

    function renderSettingsView() {
        const view = document.getElementById('settings-view');
        if (!view) return;

        // Load current values
        const env = (window.FLOWORKOS_Env && window.FLOWORKOS_Env.loaded) ? window.FLOWORKOS_Env : null;

        view.innerHTML = `
            <div style="padding:15px 20px; border-bottom:1px solid rgba(255,0,102,0.12); display:flex; align-items:center; justify-content:space-between; background:rgba(255,0,102,0.02); flex-shrink:0;">
                <div style="font-weight:700; font-size:15px; font-family:'Orbitron','Inter',sans-serif; letter-spacing:2px; background:linear-gradient(135deg,#ff0066,#ffd166); -webkit-background-clip:text; background-clip:text; -webkit-text-fill-color:transparent;">
                    ⚙️ ENGINE SETTINGS
                </div>
                <div style="display:flex;gap:10px;">
                    <button id="btn-settings-save" style="font-size:11px; padding:6px 16px; background:linear-gradient(135deg,rgba(6,214,160,0.2),rgba(6,214,160,0.05)); color:#06d6a0; border:1px solid rgba(6,214,160,0.3); border-radius:6px; cursor:pointer; font-weight:700; letter-spacing:1px;">
                        💾 SAVE ALL
                    </button>
                    <button id="btn-settings-reset" style="font-size:11px; padding:6px 16px; background:rgba(255,0,102,0.08); color:#ff0066; border:1px solid rgba(255,0,102,0.2); border-radius:6px; cursor:pointer; font-weight:700;">
                        🔄 RESET DEFAULT
                    </button>
                </div>
            </div>

            <div style="display:flex; flex:1; overflow:hidden;">
                <!-- SIDEBAR NAV -->
                <div id="settings-sidebar" style="width:180px; border-right:1px solid rgba(0,240,255,0.06); overflow-y:auto; padding:10px 0; flex-shrink:0;">
                    ${SETTINGS_GROUPS.map((g, i) => `
                        <div class="settings-nav-item ${i === 0 ? 'active' : ''}" data-group="${g.id}"
                            onclick="document.querySelectorAll('.settings-nav-item').forEach(x=>x.classList.remove('active'));this.classList.add('active');document.getElementById('settings-section-${g.id}').scrollIntoView({behavior:'smooth',block:'start'});"
                            style="padding:8px 16px; font-size:11px; color:${i === 0 ? g.color : '#8a9aaa'}; cursor:pointer; display:flex; align-items:center; gap:8px; transition:all 0.2s; border-left:2px solid ${i === 0 ? g.color : 'transparent'};"
                            onmouseover="this.style.color='${g.color}';this.style.background='rgba(255,255,255,0.02)';"
                            onmouseout="if(!this.classList.contains('active')){this.style.color='#8a9aaa';this.style.background='none';}">
                            <span>${g.icon}</span> ${g.label.replace(/^[^\s]+\s/, '')}
                        </div>
                    `).join('')}
                </div>

                <!-- MAIN CONTENT -->
                <div id="settings-content" style="flex:1; overflow-y:auto; padding:20px;">
                    ${SETTINGS_GROUPS.map(g => _renderSettingsGroup(g, env)).join('')}
                    
                    <!-- ENV STATUS -->
                    <div style="margin-top:20px; padding:14px; background:rgba(0,0,0,0.2); border:1px solid rgba(0,240,255,0.06); border-radius:10px;">
                        <div style="font-size:10px; color:#3a4d6a; letter-spacing:1px; margin-bottom:6px;">ENVIRONMENT STATUS</div>
                        <div id="settings-env-status" style="font-size:11px; color:#8a9aaa; font-family:'JetBrains Mono',monospace;">
                            Loading...
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Bind buttons
        document.getElementById('btn-settings-save').addEventListener('click', _saveSettings);
        var resetBtn = document.getElementById('btn-settings-reset');
        if (resetBtn) resetBtn.addEventListener('click', _resetDefaults);

        // Show env status
        _updateEnvStatusInSettings();
    }

    function _renderSettingsGroup(group, env) {
        return `
            <div id="settings-section-${group.id}" style="margin-bottom:24px;">
                <div style="font-size:13px; font-weight:700; color:${group.color}; letter-spacing:1px; margin-bottom:12px; padding-bottom:8px; border-bottom:1px solid ${group.color}18; display:flex; align-items:center; gap:8px;">
                    ${group.icon} ${group.label.replace(/^[^\s]+\s/, '')}
                </div>
                <div style="display:flex; flex-direction:column; gap:10px;">
                    ${group.fields.map(f => _renderField(f, group.color, env)).join('')}
                </div>
            </div>
        `;
    }

    function _renderField(field, color, env) {
        const val = env ? (env.get(field.key, '') || '') : '';
        const descHtml = field.desc ? `<div style="font-size:9px; color:#3a4d6a; margin-top:2px;">${field.desc}</div>` : '';
        
        let inputHtml = '';

        if (field.type === 'toggle') {
            const checked = val === 'true' ? 'checked' : '';
            inputHtml = `
                <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                    <input type="checkbox" data-key="${field.key}" ${checked} 
                        style="width:16px; height:16px; accent-color:${color}; cursor:pointer;">
                    <span style="font-size:11px; color:#c8d6e5;">${field.label}</span>
                </label>`;
        } else if (field.type === 'select') {
            inputHtml = `
                <div style="display:flex; align-items:center; gap:10px;">
                    <label style="font-size:11px; color:#8a9aaa; min-width:140px;">${field.label}</label>
                    <select data-key="${field.key}" 
                        style="flex:1; background:rgba(0,0,0,0.3); color:#c8d6e5; border:1px solid rgba(255,255,255,0.08); border-radius:6px; padding:6px 10px; font-size:11px; font-family:'JetBrains Mono',monospace; outline:none;">
                        ${(field.options || []).map(o => `<option value="${o}" ${val === o ? 'selected' : ''}>${o || '(none)'}</option>`).join('')}
                    </select>
                </div>`;
        } else if (field.type === 'textarea') {
            const safePlaceholder = (field.placeholder || '').replace(/"/g, '&quot;');
            inputHtml = `
                <div>
                    <label style="font-size:11px; color:#8a9aaa;">${field.label}</label>
                    ${descHtml}
                    <textarea data-key="${field.key}" placeholder="${safePlaceholder}"
                        style="width:100%; height:60px; background:rgba(0,0,0,0.3); color:#c8d6e5; border:1px solid rgba(255,255,255,0.08); border-radius:6px; padding:8px; font-size:11px; font-family:'JetBrains Mono',monospace; resize:vertical; outline:none; margin-top:4px; box-sizing:border-box;"
                    >${val}</textarea>
                </div>`;
        } else {
            inputHtml = `
                <div style="display:flex; align-items:center; gap:10px;">
                    <label style="font-size:11px; color:#8a9aaa; min-width:140px;">${field.label}</label>
                    <input type="${field.type === 'password' ? 'password' : field.type === 'number' ? 'number' : 'text'}" 
                        data-key="${field.key}" value="${field.sensitive ? '' : val}" placeholder="${field.placeholder || ''}"
                        style="flex:1; background:rgba(0,0,0,0.3); color:#c8d6e5; border:1px solid rgba(255,255,255,0.08); border-radius:6px; padding:6px 10px; font-size:11px; font-family:'JetBrains Mono',monospace; outline:none;"
                    >
                    ${field.sensitive && val ? '<span style="font-size:9px;color:#06d6a0;">● set</span>' : ''}
                </div>
                ${descHtml}`;
        }

        return `<div style="padding:4px 0;">${inputHtml}</div>`;
    }

    function _saveSettings() {
        const config = {};
        const view = document.getElementById('settings-view');
        if (!view) return;

        // Collect all inputs
        view.querySelectorAll('[data-key]').forEach(el => {
            const key = el.getAttribute('data-key');
            if (el.type === 'checkbox') {
                config[key] = el.checked ? 'true' : 'false';
            } else if (el.tagName === 'TEXTAREA') {
                if (el.value.trim()) config[key] = el.value.trim();
            } else if (el.tagName === 'SELECT') {
                config[key] = el.value;
            } else {
                // Only save non-empty values (don't overwrite passwords with empty)
                if (el.value.trim()) config[key] = el.value.trim();
            }
        });

        // Save via FLOWORKOS_Env
        if (window.FLOWORKOS_Env && window.FLOWORKOS_Env.setFromUI) {
            window.FLOWORKOS_Env.setFromUI(config);
        } else {
            // Fallback: save directly to localStorage
            try {
                const existing = JSON.parse(localStorage.getItem('floworkos_env') || '{}');
                Object.assign(existing, config);
                localStorage.setItem('floworkos_env', JSON.stringify(existing));
            } catch (e) { console.error('[Settings] Save failed:', e); }
        }

        // Visual feedback
        const btn = document.getElementById('btn-settings-save');
        if (btn) {
            const original = btn.innerHTML;
            btn.innerHTML = '✅ SAVED!';
            btn.style.color = '#06d6a0';
            setTimeout(() => { btn.innerHTML = original; btn.style.color = '#06d6a0'; }, 1500);
        }

        _updateEnvStatusInSettings();

        console.log('[Settings] Saved', Object.keys(config).length, 'keys');
    }

    function _closeSettings() {
        const view = document.getElementById('settings-view');
        if (view) view.style.display = 'none';
    }

    function _resetDefaults() {
        if (!confirm('Reset all settings to default? This cannot be undone.')) return;
        try {
            localStorage.removeItem('flowork_settings');
            if (window.FLOWORKOS_Env && window.FLOWORKOS_Env.resetDefaults) {
                window.FLOWORKOS_Env.resetDefaults();
            }
        } catch (e) { console.warn('[Settings] Reset error:', e); }
        // Re-render to show defaults
        renderSettingsView();
        // Visual feedback
        var btn = document.getElementById('btn-settings-reset');
        if (btn) {
            var original = btn.innerHTML;
            btn.innerHTML = '✅ RESET DONE!';
            btn.style.color = '#06d6a0';
            setTimeout(function() { btn.innerHTML = original; btn.style.color = '#ff0066'; }, 1500);
        }
        console.log('[Settings] All settings reset to defaults');
    }

    function _updateEnvStatusInSettings() {
        const el = document.getElementById('settings-env-status');
        if (!el) return;

        if (window.FLOWORKOS_Env && window.FLOWORKOS_Env.loaded) {
            const log = window.FLOWORKOS_Env.getSetupLog ? window.FLOWORKOS_Env.getSetupLog() : [];
            const last3 = log.slice(-3).map(l => `${l.time} ${l.message}`).join('\n');
            el.textContent = last3 || 'Environment loaded.';
            el.style.color = '#06d6a0';
        } else {
            el.textContent = 'Environment not loaded yet.';
            el.style.color = '#ffd166';
        }
    }

    // ── Open Settings (BrowserView Tab) ────────────────────────
    // Settings is now a separate HTML file (settings.html) loaded
    // as a BrowserView tab, just like Flow/Store.
    // The header ⚙️ button triggers switchToTab('settings') in tab_manager.

    function _openSettingsTab() {
        console.log('[Settings] Opening settings BrowserView tab...');
        // Use the tab manager to switch — it handles BrowserView creation
        if (window.FW_TabState && window.FW_TabState.tabs['settings']) {
            // Tab already registered, just switch
            if (typeof window.switchToTab === 'function') {
                window.switchToTab('settings');
            }
        } else {
            // Fallback: construct URL and open directly
            var baseUrl = window.location.href.replace(/[^\/\\]*$/, '');
            var settingsUrl = baseUrl + 'settings.html';
            if (window.floworkDesktop && window.floworkDesktop.openAppTab) {
                window.floworkDesktop.openAppTab('settings', 'Settings', settingsUrl);
            }
            if (window.floworkDesktop && window.floworkDesktop.switchAppTab) {
                window.floworkDesktop.switchAppTab('settings');
            }
        }
    }

    // Legacy DOM-based open (kept for API compatibility)
    function _openSettings() {
        _openSettingsTab();
    }

    // ── Public API ───────────────────────────────────────────────
    window.FW_UI = window.FW_UI || {};
    window.FW_UI.openSettings = _openSettingsTab;
    window.FW_UI.closeSettings = _closeSettings;

    // ── BIND SETTINGS BUTTON (header ⚙️) ────────────────────────
    function _onSettingsClick(e) {
        e.preventDefault();
        e.stopPropagation();
        console.log('[Settings] ⚙️ Button clicked!');
        _openSettingsTab();
    }

    var _settingsBtn = document.getElementById('btn-settings');
    if (_settingsBtn) {
        _settingsBtn.addEventListener('click', _onSettingsClick);
        console.log('[Settings] ✅ Button bound to #btn-settings');
    } else {
        document.addEventListener('DOMContentLoaded', function() {
            var btn = document.getElementById('btn-settings');
            if (btn) {
                btn.addEventListener('click', _onSettingsClick);
                console.log('[Settings] ✅ Button bound (deferred)');
            }
        });
    }

    console.log('[Flowork OS] ✅ Settings UI loaded (BrowserView tab mode)');
})();
