// =========================================================================
// FLOWORK OS — Brain Gateway Bridge Module
// Wires the FLOWORKOS™ Multi-Channel Gateway into the brain agent loop.
// Enables AI to receive/send via WhatsApp, Telegram, Discord, Slack.
// Tools: gateway_send, gateway_channels, gateway_status, gateway_connect,
//        gateway_disconnect, gateway_broadcast, gateway_reply
// =========================================================================

(function () {
    'use strict';

    // ── State ────────────────────────────────────────────────
    const _state = {
        autoReply: true,            // Auto-reply to gateway channel on agent response
        defaultChannel: 'web',      // Default outbound channel
        channelsInitialized: false,  // Whether auto-init ran
        interceptInstalled: false,   // Whether response intercept is hooked
        messageLog: [],              // Recent gateway messages (last 50)
        MAX_LOG: 50,
    };

    // ── Auto-Register Channels from Environment ─────────────
    function _autoRegisterChannels() {
        if (_state.channelsInitialized) return;
        _state.channelsInitialized = true;

        const gw = window.FLOWORKOS_Gateway;
        if (!gw) {
            console.warn('[GatewayBridge] FLOWORKOS_Gateway not loaded yet — skipping auto-register');
            return;
        }

        const env = window._envConfig || {};

        // WhatsApp
        if (env.WA_PHONE_NUMBER_ID && env.WA_ACCESS_TOKEN) {
            const wa = gw.createWhatsAppAdapter({
                phoneNumberId: env.WA_PHONE_NUMBER_ID,
                accessToken: env.WA_ACCESS_TOKEN,
            });
            gw.registerChannel(wa);
            wa.connected = true;
            console.log('[GatewayBridge] 📱 WhatsApp auto-registered');
        }

        // Telegram
        if (env.TELEGRAM_BOT_TOKEN || env.TG_BOT_TOKEN) {
            const tg = gw.createTelegramAdapter({
                botToken: env.TELEGRAM_BOT_TOKEN || env.TG_BOT_TOKEN,
            });
            gw.registerChannel(tg);
            tg.connected = true;
            console.log('[GatewayBridge] ✈️ Telegram auto-registered');
        }

        // Discord (requires custom adapter — register placeholder)
        if (env.DISCORD_BOT_TOKEN) {
            gw.registerChannel({
                id: 'discord',
                name: 'Discord',
                markdownCapable: true,
                config: { botToken: env.DISCORD_BOT_TOKEN },
                connected: false,  // Needs Discord.js — mark as not connected
                async sendMessage(to, text, options) {
                    // Discord requires a WebSocket gateway — delegate to Go backend
                    try {
                        const resp = await fetch('http://127.0.0.1:5000/api/gateway/discord/send', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ channel_id: to, content: text, ...options }),
                        });
                        return await resp.json();
                    } catch (err) {
                        return { error: err.message };
                    }
                },
            });
            console.log('[GatewayBridge] 🎮 Discord registered (via Go backend)');
        }

        // Slack
        if (env.SLACK_BOT_TOKEN) {
            gw.registerChannel({
                id: 'slack',
                name: 'Slack',
                markdownCapable: true,
                config: { botToken: env.SLACK_BOT_TOKEN },
                connected: false,
                async sendMessage(to, text, options) {
                    try {
                        const resp = await fetch('https://slack.com/api/chat.postMessage', {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`,
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                                channel: to,
                                text: text,
                                thread_ts: options?.threadId || undefined,
                            }),
                        });
                        return await resp.json();
                    } catch (err) {
                        return { error: err.message };
                    }
                },
            });
            console.log('[GatewayBridge] 💬 Slack registered');
        }

        // REST API (always available)
        gw.registerChannel({
            id: 'rest',
            name: 'REST API',
            markdownCapable: true,
            connected: true,
            async sendMessage(to, text, options) {
                // REST replies are stored for polling
                _state.messageLog.push({
                    type: 'outbound',
                    channel: 'rest',
                    to,
                    text,
                    ts: new Date().toISOString(),
                });
                if (_state.messageLog.length > _state.MAX_LOG) {
                    _state.messageLog = _state.messageLog.slice(-_state.MAX_LOG);
                }
                return { delivered: true, method: 'poll' };
            },
        });
    }

    // ── Agent Response Intercept ─────────────────────────────
    // Hook into appendChatMessage to auto-forward agent responses
    // to the gateway channel that sent the original message.
    function _installResponseIntercept() {
        if (_state.interceptInstalled) return;
        _state.interceptInstalled = true;

        const gw = window.FLOWORKOS_Gateway;
        if (!gw) return;

        const _originalAppend = window.appendChatMessage;
        if (!_originalAppend) return;

        window.appendChatMessage = function (role, content, options) {
            // Call original first
            _originalAppend.call(this, role, content, options);

            // If agent responds and auto-reply is on, forward to gateway
            if (_state.autoReply && role === 'agent' && content) {
                // Check the last user message for gateway metadata
                const history = window.chatHistory || [];
                let lastGatewayMsg = null;

                for (let i = history.length - 1; i >= 0; i--) {
                    if (history[i].role === 'user' && history[i]._gateway) {
                        lastGatewayMsg = history[i]._gateway;
                        break;
                    }
                }

                if (lastGatewayMsg && lastGatewayMsg.channel !== 'web') {
                    // Auto-reply to the channel
                    gw.sendOutbound(
                        lastGatewayMsg.channel,
                        lastGatewayMsg.from,
                        content,
                        { threadId: lastGatewayMsg.threadId }
                    ).then(result => {
                        if (result?.error) {
                            console.warn(`[GatewayBridge] Auto-reply failed: ${result.error}`);
                        } else {
                            console.log(`[GatewayBridge] ✅ Auto-replied to ${lastGatewayMsg.channel}/${lastGatewayMsg.from}`);
                        }
                    }).catch(err => {
                        console.error('[GatewayBridge] Auto-reply error:', err);
                    });

                    _state.messageLog.push({
                        type: 'auto_reply',
                        channel: lastGatewayMsg.channel,
                        to: lastGatewayMsg.from,
                        text: content.substring(0, 200),
                        ts: new Date().toISOString(),
                    });
                    if (_state.messageLog.length > _state.MAX_LOG) {
                        _state.messageLog = _state.messageLog.slice(-_state.MAX_LOG);
                    }
                }
            }
        };

        console.log('[GatewayBridge] ✅ Agent response intercept installed');
    }

    // ── Tool: gateway_send ──────────────────────────────────
    async function gatewaySend(input) {
        const gw = window.FLOWORKOS_Gateway;
        if (!gw) return { error: 'FLOWORKOS_Gateway not available' };

        const channel = input.channel || _state.defaultChannel;
        const to = input.to || input.recipient || input.chat_id;
        const text = input.text || input.message || input.content || '';

        if (!to) return { error: 'Missing "to" (recipient). Usage: gateway_send { channel: "telegram", to: "123456", text: "Hello" }' };
        if (!text.trim()) return { error: 'Missing "text". Provide message content.' };

        const result = await gw.sendOutbound(channel, to, text, {
            threadId: input.thread_id || input.threadId,
            replyTo: input.reply_to,
        });

        _state.messageLog.push({
            type: 'manual_send',
            channel,
            to,
            text: text.substring(0, 200),
            ts: new Date().toISOString(),
        });
        if (_state.messageLog.length > _state.MAX_LOG) {
            _state.messageLog = _state.messageLog.slice(-_state.MAX_LOG);
        }

        if (result?.error) return { error: result.error };
        return {
            result: `📤 Message sent via ${channel} to ${to}\n` +
                    `Length: ${text.length} chars\n` +
                    `Status: ${result?.status || 'sent'}`
        };
    }

    // ── Tool: gateway_channels ──────────────────────────────
    function gatewayChannels(input) {
        const gw = window.FLOWORKOS_Gateway;
        if (!gw) return { error: 'FLOWORKOS_Gateway not available' };

        const channels = gw.listChannels();

        let report = `📡 GATEWAY CHANNELS (${channels.length})\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        for (const ch of channels) {
            const icon = ch.connected ? '🟢' : '🔴';
            report += `${icon} ${ch.name} (${ch.id}) — ${ch.connected ? 'Connected' : 'Disconnected'}\n`;
            if (ch.description) report += `   ${ch.description}\n`;
        }

        return { result: report };
    }

    // ── Tool: gateway_status ────────────────────────────────
    function gatewayStatus(input) {
        const gw = window.FLOWORKOS_Gateway;
        if (!gw) return { error: 'FLOWORKOS_Gateway not available' };

        const status = gw.getGatewayStatus();

        const recentLogs = _state.messageLog.slice(-5);
        let logStr = '';
        for (const log of recentLogs) {
            logStr += `  [${log.type}] ${log.channel}→${log.to}: ${log.text?.substring(0, 80) || ''}\n`;
        }

        return {
            result: `🔌 GATEWAY STATUS\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `Channels: ${status.channels} (${status.connected} connected)\n` +
                    `WebSocket clients: ${status.wsConnections}\n` +
                    `Session bindings: ${status.sessionBindings}\n` +
                    `Auto-reply: ${_state.autoReply ? '✅ ON' : '❌ OFF'}\n` +
                    `Message log: ${_state.messageLog.length} entries\n` +
                    (logStr ? `\n📋 Recent:\n${logStr}` : '')
        };
    }

    // ── Tool: gateway_connect ───────────────────────────────
    function gatewayConnect(input) {
        const gw = window.FLOWORKOS_Gateway;
        if (!gw) return { error: 'FLOWORKOS_Gateway not available' };

        const channel = input.channel;
        if (!channel) return { error: 'Missing "channel". Options: whatsapp, telegram, discord, slack' };

        const config = {};
        if (channel === 'whatsapp') {
            config.phoneNumberId = input.phone_number_id || input.phoneNumberId;
            config.accessToken = input.access_token || input.accessToken;
            if (!config.phoneNumberId || !config.accessToken) {
                return { error: 'WhatsApp requires phone_number_id and access_token' };
            }
            const adapter = gw.createWhatsAppAdapter(config);
            gw.registerChannel(adapter);
            adapter.connected = true;
        } else if (channel === 'telegram') {
            config.botToken = input.bot_token || input.botToken;
            if (!config.botToken) return { error: 'Telegram requires bot_token' };
            const adapter = gw.createTelegramAdapter(config);
            gw.registerChannel(adapter);
            adapter.connected = true;
        } else {
            return { error: `Channel "${channel}" not supported for manual connect. Use env config.` };
        }

        return { result: `✅ ${channel} connected and ready to receive/send messages.` };
    }

    // ── Tool: gateway_disconnect ────────────────────────────
    function gatewayDisconnect(input) {
        const gw = window.FLOWORKOS_Gateway;
        if (!gw) return { error: 'FLOWORKOS_Gateway not available' };

        const channel = input.channel;
        if (!channel) return { error: 'Missing "channel"' };

        gw.unregisterChannel(channel);
        return { result: `🔌 ${channel} disconnected.` };
    }

    // ── Tool: gateway_broadcast ─────────────────────────────
    async function gatewayBroadcast(input) {
        const gw = window.FLOWORKOS_Gateway;
        if (!gw) return { error: 'FLOWORKOS_Gateway not available' };

        const text = input.text || input.message || '';
        if (!text.trim()) return { error: 'Missing "text"' };

        const channels = gw.listChannels().filter(c => c.connected && c.id !== 'web');
        if (channels.length === 0) return { error: 'No connected external channels to broadcast to.' };

        // Broadcast via WebSocket
        gw.broadcastWs({ type: 'broadcast', text, ts: Date.now() });

        return {
            result: `📢 Broadcast sent to ${channels.length} channels: ${channels.map(c => c.name).join(', ')}\n` +
                    `Text: "${text.substring(0, 100)}"`
        };
    }

    // ── Tool: gateway_reply ─────────────────────────────────
    async function gatewayReply(input) {
        const gw = window.FLOWORKOS_Gateway;
        if (!gw) return { error: 'FLOWORKOS_Gateway not available' };

        const sessionKey = input.session || input.session_key || input.from;
        const text = input.text || input.message || '';

        if (!sessionKey) return { error: 'Missing "session" (session key or sender ID)' };
        if (!text.trim()) return { error: 'Missing "text"' };

        const result = await gw.replyToSession(sessionKey, text);
        if (result?.error) return { error: result.error };

        return { result: `✅ Replied to session "${sessionKey}" via ${result?.channel || 'auto-detected channel'}` };
    }

    // ── Auto-Reply Toggle ───────────────────────────────────
    function setAutoReply(input) {
        const enabled = input.enabled !== undefined ? input.enabled : !_state.autoReply;
        _state.autoReply = !!enabled;
        return { result: `Auto-reply ${_state.autoReply ? '✅ ENABLED' : '❌ DISABLED'}` };
    }

    // ── Daemon Hook: Gateway Event Delivery ─────────────────
    // Allow daemon/cron to deliver results via gateway channels
    function _hookDaemonDelivery() {
        if (!window.floworkDaemon) return;

        const _origDelivery = window.floworkDaemon._deliverResult;
        if (!_origDelivery || window.floworkDaemon._gatewayHooked) return;

        window.floworkDaemon._gatewayHooked = true;

        window.floworkDaemon._deliverResult = async function (job, result) {
            // Call original delivery
            if (_origDelivery) await _origDelivery.call(this, job, result);

            // If job has gateway delivery config, forward
            if (job.delivery?.gateway) {
                const gw = window.FLOWORKOS_Gateway;
                if (!gw) return;

                const gwConfig = job.delivery.gateway;
                const channel = gwConfig.channel || _state.defaultChannel;
                const to = gwConfig.to || gwConfig.recipient;

                if (to) {
                    const text = typeof result === 'string' ? result : JSON.stringify(result);
                    await gw.sendOutbound(channel, to, `🔔 [${job.name}] ${text}`, {
                        threadId: gwConfig.threadId,
                    });
                    console.log(`[GatewayBridge] 🔔 Daemon delivery sent via ${channel} to ${to}`);
                }
            }
        };
    }

    // ── Initialize ──────────────────────────────────────────
    function _init() {
        // Wait for gateway to be available
        const checkInterval = setInterval(() => {
            if (window.FLOWORKOS_Gateway) {
                clearInterval(checkInterval);
                _autoRegisterChannels();
                _installResponseIntercept();
                _hookDaemonDelivery();
                console.log('[GatewayBridge] ✅ Fully initialized');
            }
        }, 500);

        // Timeout after 10s
        setTimeout(() => clearInterval(checkInterval), 10000);
    }

    // ── Expose ──────────────────────────────────────────────
    window.floworkGatewayBridge = {
        // Tools (registered in tool registry)
        gatewaySend,
        gatewayChannels,
        gatewayStatus,
        gatewayConnect,
        gatewayDisconnect,
        gatewayBroadcast,
        gatewayReply,
        setAutoReply,
        // Internal
        _autoRegisterChannels,
        _installResponseIntercept,
        _state,
    };

    _init();

    console.log('[Brain] ✅ Gateway Bridge module loaded (WhatsApp, Telegram, Discord, Slack, REST)');
})();
