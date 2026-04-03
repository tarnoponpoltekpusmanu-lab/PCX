/**
 * ============================================================
 *  FLOWORKOS™ Environment Config Loader
 *  Auto-loads .env and wires up all channels/services
 * ============================================================
 *  Logic:
 *  1. Read .env file (via Electron fs or localStorage fallback)
 *  2. Parse key=value pairs
 *  3. Auto-register enabled channels (WhatsApp, Telegram, etc)
 *  4. Auto-configure TTS, Vision, MCP, Security
 *  5. Expose config via window.FLOWORKOS_Env
 * ============================================================
 */

(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────
  const _env = {};
  const _setupLog = [];
  let _loaded = false;

  // ── Parse .env content ─────────────────────────────────────
  function parseEnvContent(content) {
    const result = {};
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith('#')) continue;

      const eqIndex = trimmed.indexOf('=');
      if (eqIndex < 0) continue;

      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();

      // Remove quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      result[key] = value;
    }

    return result;
  }

  // ── Load .env ──────────────────────────────────────────────

  /**
   * Load environment from multiple sources:
   * 1. Electron fs (if available)
   * 2. localStorage (browser fallback)
   * 3. Manual setConfig()
   */
  async function loadEnv() {
    _setupLog.length = 0;
    _log('🔧 Loading environment configuration...');

    // Try 1: Electron fs
    if (typeof require !== 'undefined') {
      try {
        const fs = require('fs');
        const path = require('path');

        // Find .env relative to the HTML file
        const possiblePaths = [
          path.join(__dirname, '.env'),
          path.join(process.cwd(), '.env'),
          'C:\\flowork\\ENGINE\\.env',
        ];

        for (const envPath of possiblePaths) {
          if (fs.existsSync(envPath)) {
            const content = fs.readFileSync(envPath, 'utf-8');
            Object.assign(_env, parseEnvContent(content));
            _log(`✅ Loaded .env from: ${envPath}`);
            break;
          }
        }
      } catch (e) {
        _log(`⚠️ Electron fs not available: ${e.message}`);
      }
    }

    // Try 2: localStorage
    const saved = localStorage.getItem('floworkos_env');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // localStorage values DON'T override .env file values
        for (const [key, value] of Object.entries(parsed)) {
          if (!_env[key]) _env[key] = value;
        }
        _log(`✅ Loaded ${Object.keys(parsed).length} values from localStorage`);
      } catch {}
    }

    // Try 3: UI config (from brain_flowork_config.js)
    const uiConfig = localStorage.getItem('flowork_builder_config');
    if (uiConfig) {
      try {
        const parsed = JSON.parse(uiConfig);
        if (parsed.apiKey && !_env.FLOWORK_AI_KEY) {
          _env.FLOWORK_AI_KEY = parsed.apiKey;
        }
        if (parsed.provider && !_env.FLOWORK_AI_MODEL) {
          _env.FLOWORK_AI_MODEL = parsed.provider;
        }
      } catch {}
    }

    _loaded = true;
    _log(`📦 Loaded ${Object.keys(_env).length} env variables`);

    // Auto-setup everything
    await _autoSetup();

    return { status: 'ok', count: Object.keys(_env).length, log: [..._setupLog] };
  }

  // ── Auto Setup ─────────────────────────────────────────────

  async function _autoSetup() {
    _applyToUI();
    _setupEmail();
    _setupChannels();
    _setupTTS();
    _setupVision();
    _setupMCP();
    _setupSecurity();
    _setupFailover();
    _setupSession();
    _updateEnvStatus();
  }

  // ── Apply env values to UI form fields ─────────────────────

  function _applyToUI() {
    // API Key → input field (so brain_flowork_config.js can read it)
    if (_env.FLOWORK_AI_KEY) {
      const el = document.getElementById('input-api-key');
      if (el && !el.value) {
        el.value = _env.FLOWORK_AI_KEY;
        _log('🔑 API key applied to UI from .env');
      }
    }

    // Provider → select dropdown (only if model matches an option)
    if (_env.FLOWORK_AI_MODEL) {
      const sel = document.getElementById('select-provider');
      if (sel) {
        const options = [...sel.options].map(o => o.value);
        if (options.includes(_env.FLOWORK_AI_MODEL)) {
          sel.value = _env.FLOWORK_AI_MODEL;
          _log(`🤖 Provider set to: ${_env.FLOWORK_AI_MODEL}`);
        }
      }
    }
  }

  // ── Email Setup ────────────────────────────────────────────

  function _setupEmail() {
    // Fill hidden email fields for backward compatibility
    const emailMap = {
      'input-email-host': _env.FLOWORK_EMAIL_HOST,
      'input-email-port': _env.FLOWORK_EMAIL_PORT || '993',
      'input-email-user': _env.FLOWORK_EMAIL_USER,
      'input-email-password': _env.FLOWORK_EMAIL_PASSWORD,
    };

    let hasEmail = false;
    for (const [id, value] of Object.entries(emailMap)) {
      if (value) {
        const el = document.getElementById(id);
        if (el) el.value = value;
        hasEmail = true;
      }
    }

    if (hasEmail && _env.FLOWORK_EMAIL_HOST) {
      _log(`📧 Email configured: ${_env.FLOWORK_EMAIL_USER || '(user not set)'}@${_env.FLOWORK_EMAIL_HOST}`);
    }
  }

  // ── Update env status indicator in UI ──────────────────────

  function _updateEnvStatus() {
    const statusEl = document.getElementById('env-status');
    if (!statusEl) return;

    const parts = [];
    if (_env.FLOWORK_AI_KEY) parts.push('🔑 AI');
    if (_env.FLOWORK_EMAIL_HOST) parts.push('📧 Email');
    if (_env.FLOWORK_WHATSAPP_ENABLED === 'true') parts.push('📱 WA');
    if (_env.FLOWORK_TELEGRAM_ENABLED === 'true') parts.push('✈️ TG');
    if (_env.FLOWORK_DISCORD_ENABLED === 'true') parts.push('🎮 DC');
    if (_env.FLOWORK_SLACK_ENABLED === 'true') parts.push('💼 Slack');
    if (_env.FLOWORK_TTS_PROVIDER && _env.FLOWORK_TTS_PROVIDER !== 'browser') parts.push('🔊 TTS');
    if (_env.FLOWORK_MCP_SERVERS) parts.push('🔌 MCP');

    if (parts.length > 0) {
      statusEl.innerHTML = `✅ .env loaded: ${parts.join(' · ')}`;
      statusEl.style.color = '#3fb950';
    } else {
      statusEl.innerHTML = '📁 .env loaded (no services configured)';
      statusEl.style.color = '#8b949e';
    }
  }

  // ── Channel Setup ──────────────────────────────────────────

  function _setupChannels() {
    if (!window.FLOWORKOS_Gateway) {
      _log('⚠️ Gateway not loaded — skipping channel setup');
      return;
    }

    // WhatsApp
    if (_env.FLOWORK_WHATSAPP_ENABLED === 'true') {
      if (_env.FLOWORK_WHATSAPP_PHONE_ID && _env.FLOWORK_WHATSAPP_TOKEN) {
        const wa = FLOWORKOS_Gateway.createWhatsAppAdapter({
          phoneNumberId: _env.FLOWORK_WHATSAPP_PHONE_ID,
          accessToken: _env.FLOWORK_WHATSAPP_TOKEN,
        });
        FLOWORKOS_Gateway.registerChannel(wa);
        _log('📱 WhatsApp channel registered');
      } else {
        _log('⚠️ WhatsApp enabled but PHONE_ID or TOKEN missing');
      }
    }

    // Telegram
    if (_env.FLOWORK_TELEGRAM_ENABLED === 'true') {
      if (_env.FLOWORK_TELEGRAM_BOT_TOKEN) {
        const tg = FLOWORKOS_Gateway.createTelegramAdapter({
          botToken: _env.FLOWORK_TELEGRAM_BOT_TOKEN,
        });
        FLOWORKOS_Gateway.registerChannel(tg);
        _log('✈️ Telegram channel registered');

        // Auto-set webhook if URL provided
        if (_env.FLOWORK_TELEGRAM_WEBHOOK_URL) {
          tg.setWebhook(_env.FLOWORK_TELEGRAM_WEBHOOK_URL)
            .then(() => _log('✅ Telegram webhook set'))
            .catch(e => _log(`⚠️ Telegram webhook failed: ${e.message}`));
        }
      } else {
        _log('⚠️ Telegram enabled but BOT_TOKEN missing');
      }
    }

    // Discord (note: requires Node.js discord.js, just register the channel def)
    if (_env.FLOWORK_DISCORD_ENABLED === 'true') {
      FLOWORKOS_Gateway.registerChannel({
        id: 'discord',
        name: 'Discord',
        markdownCapable: true,
        config: {
          botToken: _env.FLOWORK_DISCORD_BOT_TOKEN,
          appId: _env.FLOWORK_DISCORD_APP_ID,
        },
        sendMessage: async (to, text) => {
          _log(`[Discord] Would send to ${to}: ${text.slice(0, 50)}...`);
          return { note: 'Discord requires Node.js runtime — use relay server' };
        },
      });
      _log('🎮 Discord channel registered (relay mode)');
    }

    // Slack
    if (_env.FLOWORK_SLACK_ENABLED === 'true') {
      FLOWORKOS_Gateway.registerChannel({
        id: 'slack',
        name: 'Slack',
        markdownCapable: true,
        config: {
          botToken: _env.FLOWORK_SLACK_BOT_TOKEN,
          signingSecret: _env.FLOWORK_SLACK_SIGNING_SECRET,
        },
        sendMessage: async (to, text) => {
          // Slack Web API
          if (!_env.FLOWORK_SLACK_BOT_TOKEN) return { error: 'No Slack token' };
          const resp = await fetch('https://slack.com/api/chat.postMessage', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${_env.FLOWORK_SLACK_BOT_TOKEN}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ channel: to, text }),
          });
          return await resp.json();
        },
      });
      _log('💼 Slack channel registered');
    }

    const channels = FLOWORKOS_Gateway.listChannels();
    _log(`📡 Total channels: ${channels.length} (${channels.map(c => c.name).join(', ')})`);
  }

  // ── TTS Setup ──────────────────────────────────────────────

  function _setupTTS() {
    if (!window.FLOWORKOS_Voice) return;

    const provider = _env.FLOWORK_TTS_PROVIDER || 'browser';
    _log(`🔊 TTS provider: ${provider}`);

    // Store TTS config for later use
    window._floworkTTSConfig = {
      provider,
      voice: _env.FLOWORK_TTS_VOICE || '',
      elevenlabs: {
        apiKey: _env.FLOWORK_ELEVENLABS_KEY || '',
        voiceId: _env.FLOWORK_ELEVENLABS_VOICE_ID || '',
      },
      openai: {
        apiKey: _env.FLOWORK_OPENAI_TTS_KEY || _env.FLOWORK_AI_KEY || '',
        voice: _env.FLOWORK_OPENAI_TTS_VOICE || 'alloy',
      },
      google: {
        apiKey: _env.FLOWORK_GOOGLE_TTS_KEY || '',
      },
    };
  }

  // ── Vision Setup ───────────────────────────────────────────

  function _setupVision() {
    if (!window.FLOWORKOS_Media) return;

    window._floworkVisionConfig = {
      provider: _env.FLOWORK_VISION_PROVIDER || 'gemini-2.5-flash',
      apiKey: _env.FLOWORK_VISION_KEY || _env.FLOWORK_AI_KEY || '',
      whisperKey: _env.FLOWORK_WHISPER_KEY || _env.FLOWORK_AI_KEY || '',
    };

    _log(`👁️ Vision: ${window._floworkVisionConfig.provider}`);
  }

  // ── MCP Setup ──────────────────────────────────────────────

  function _setupMCP() {
    if (!window.FLOWORKOS_MCP || !_env.FLOWORK_MCP_SERVERS) return;

    const servers = _env.FLOWORK_MCP_SERVERS.split(',').filter(Boolean);
    for (const serverDef of servers) {
      const [name, transport, url] = serverDef.split('|');
      if (!name || !transport || !url) continue;

      _log(`🔌 MCP: connecting to "${name}" via ${transport}...`);

      if (transport === 'sse') {
        FLOWORKOS_MCP.connectSSE({ id: name, name, url })
          .then(r => _log(`✅ MCP "${name}": ${r.tools} tools`))
          .catch(e => _log(`⚠️ MCP "${name}" failed: ${e.message}`));
      } else if (transport === 'ws') {
        FLOWORKOS_MCP.connectWS({ id: name, name, url })
          .then(r => _log(`✅ MCP "${name}": ${r.tools} tools`))
          .catch(e => _log(`⚠️ MCP "${name}" failed: ${e.message}`));
      }
    }
  }

  // ── Security Setup ─────────────────────────────────────────

  function _setupSecurity() {
    if (_env.FLOWORK_REDACTION_ENABLED === 'false' && window.FLOWORKOS_Redaction) {
      _log('🛡️ Redaction: DISABLED by env');
    }

    if (_env.FLOWORK_TOOL_POLICY_ENABLED === 'false' && window.FLOWORKOS_ToolPolicy) {
      _log('🛡️ Tool Policy: DISABLED by env');
    }
  }

  // ── Failover Setup ─────────────────────────────────────────

  function _setupFailover() {
    if (!window.FLOWORKOS_ModelFailover) return;

    const providers = [];

    // Main provider
    if (_env.FLOWORK_AI_KEY) {
      providers.push({
        provider: _env.FLOWORK_AI_PROVIDER || 'gemini',
        model: _env.FLOWORK_AI_MODEL || 'gemini-2.5-flash',
        apiKey: _env.FLOWORK_AI_KEY,
      });
    }

    // Backup 1
    if (_env.FLOWORK_BACKUP_KEY_1) {
      providers.push({
        provider: _env.FLOWORK_BACKUP_PROVIDER_1 || 'openai',
        model: _env.FLOWORK_BACKUP_MODEL_1 || 'gpt-4o-mini',
        apiKey: _env.FLOWORK_BACKUP_KEY_1,
      });
    }

    // Backup 2
    if (_env.FLOWORK_BACKUP_KEY_2) {
      providers.push({
        provider: _env.FLOWORK_BACKUP_PROVIDER_2 || 'anthropic',
        model: _env.FLOWORK_BACKUP_MODEL_2 || 'claude-3-haiku-20240307',
        apiKey: _env.FLOWORK_BACKUP_KEY_2,
      });
    }

    if (providers.length > 0) {
      window._floworkFailoverProviders = providers;
      _log(`🔄 Failover: ${providers.length} provider(s) configured (${providers.map(p => p.provider).join(' → ')})`);
    }
  }

  // ── Session Setup ──────────────────────────────────────────

  function _setupSession() {
    if (!window.FLOWORKOS_Sessions) return;

    if (_env.FLOWORK_SESSION_AUTOSAVE === 'false') {
      _log('💾 Session autosave: DISABLED');
    } else {
      const interval = parseInt(_env.FLOWORK_SESSION_INTERVAL) || 30;
      _log(`💾 Session autosave: every ${interval}s`);
    }
  }

  // ── Config API ─────────────────────────────────────────────

  function get(key, defaultValue) {
    return _env[key] || defaultValue || '';
  }

  function set(key, value) {
    _env[key] = value;
    // Persist to localStorage
    _saveToLocalStorage();
  }

  function getAll() {
    // Return copy without sensitive values exposed
    const safe = {};
    for (const [key, value] of Object.entries(_env)) {
      if (key.includes('KEY') || key.includes('TOKEN') || key.includes('SECRET') || key.includes('PASSWORD')) {
        safe[key] = value ? '***' + value.slice(-4) : '(empty)';
      } else {
        safe[key] = value;
      }
    }
    return safe;
  }

  function setFromUI(config) {
    // Accept a flat object from a settings UI
    for (const [key, value] of Object.entries(config)) {
      if (value !== undefined && value !== null && value !== '') {
        _env[key] = String(value);
      }
    }
    _saveToLocalStorage();
    _log('✅ Config updated from UI');
  }

  function _saveToLocalStorage() {
    try {
      localStorage.setItem('floworkos_env', JSON.stringify(_env));
    } catch {}
  }

  function _log(msg) {
    _setupLog.push({ time: new Date().toLocaleTimeString(), message: msg });
    console.log(`[FLOWORKOS Env] ${msg}`);
  }

  function getSetupLog() {
    return [..._setupLog];
  }

  function isChannelEnabled(channel) {
    const key = `FLOWORK_${channel.toUpperCase()}_ENABLED`;
    return _env[key] === 'true';
  }

  // ── Convenience: Speak with configured TTS ─────────────────

  async function speak(text) {
    if (!window.FLOWORKOS_Voice) return { error: 'Voice not loaded' };
    const cfg = window._floworkTTSConfig || {};

    const options = { provider: cfg.provider || 'browser' };

    if (cfg.provider === 'elevenlabs' && cfg.elevenlabs?.apiKey) {
      options.apiKey = cfg.elevenlabs.apiKey;
      options.voiceId = cfg.elevenlabs.voiceId;
    } else if (cfg.provider === 'openai-tts' && cfg.openai?.apiKey) {
      options.apiKey = cfg.openai.apiKey;
      options.voice = cfg.openai.voice;
    } else if (cfg.provider === 'google-tts' && cfg.google?.apiKey) {
      options.apiKey = cfg.google.apiKey;
    }

    return await FLOWORKOS_Voice.speak(text, options);
  }

  // ── Convenience: Analyze image with configured provider ────

  async function analyzeImage(imageBlob, prompt) {
    if (!window.FLOWORKOS_Media) return { error: 'Media not loaded' };
    const cfg = window._floworkVisionConfig || {};

    return await FLOWORKOS_Media.analyzeImage(imageBlob, prompt, {
      provider: cfg.provider,
      apiKey: cfg.apiKey,
    });
  }

  // ── Register to Window ─────────────────────────────────────
  window.FLOWORKOS_Env = {
    loadEnv,
    parseEnvContent,
    get,
    set,
    getAll,
    setFromUI,
    getSetupLog,
    isChannelEnabled,
    speak,
    analyzeImage,
    get loaded() { return _loaded; },
  };

  // Auto-load on DOM ready
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(() => loadEnv(), 200);
  } else {
    document.addEventListener('DOMContentLoaded', () => setTimeout(() => loadEnv(), 200));
  }

  console.log('[FLOWORKOS] ✅ Env Config Loader ready');
})();
