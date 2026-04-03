/**
 * ============================================================
 *  FLOWORKOS™ Multi-Channel Gateway
 *  FLOWORKOS™ native multi-channel messaging gateway
 * ============================================================
 *  Logic: Unified messaging bridge — route messages from any
 *  channel (WhatsApp, Telegram, Discord, Slack, Web, REST API)
 *  through a single gateway to the Flowork brain.
 *
 *  Architecture:
 *  ┌──────────┐  ┌──────────┐  ┌──────────┐
 *  │ WhatsApp │  │ Telegram │  │  Slack   │
 *  └────┬─────┘  └────┬─────┘  └────┬─────┘
 *       │             │             │
 *       └──────┬──────┴──────┬──────┘
 *              ▼             ▼
 *     ┌─────────────────────────────┐
 *     │    FLOWORKOS Gateway Core   │
 *     │   (normalize → route →     │
 *     │    brain → format → send)  │
 *     └─────────────────────────────┘
 * ============================================================
 */

(function () {
  'use strict';

  // ── Channel Registry ───────────────────────────────────────
  const _channels = new Map();      // channelId → ChannelAdapter
  const _messageQueue = [];         // Pending outbound messages
  const _inboundHandlers = [];      // Message handlers
  const _sessionBindings = new Map(); // sessionKey → channelId+threadId

  /**
   * @typedef {Object} ChannelAdapter
   * @property {string} id - Channel ID ('whatsapp', 'telegram', etc.)
   * @property {string} name - Display name
   * @property {boolean} connected - Is currently connected
   * @property {boolean} markdownCapable - Supports markdown formatting
   * @property {string[]} aliases - Alternative names
   * @property {Function} sendMessage - (to, text, options) => Promise
   * @property {Function} [sendTyping] - (to) => void
   * @property {Function} [sendReaction] - (messageId, emoji) => void
   * @property {Object} config - Channel-specific config
   */

  // ── Built-in Channel Definitions ───────────────────────────
  const CHANNEL_DEFS = {
    web: {
      id: 'web',
      name: 'Web Chat',
      markdownCapable: true,
      aliases: ['webchat', 'browser', 'ui'],
      description: 'Built-in web chat interface',
    },
    whatsapp: {
      id: 'whatsapp',
      name: 'WhatsApp',
      markdownCapable: false,
      aliases: ['wa'],
      description: 'WhatsApp Business API',
      apiBase: 'https://graph.facebook.com/v18.0',
    },
    telegram: {
      id: 'telegram',
      name: 'Telegram',
      markdownCapable: true,
      aliases: ['tg'],
      description: 'Telegram Bot API',
      apiBase: 'https://api.telegram.org',
    },
    discord: {
      id: 'discord',
      name: 'Discord',
      markdownCapable: true,
      aliases: ['dc'],
      description: 'Discord Bot',
    },
    slack: {
      id: 'slack',
      name: 'Slack',
      markdownCapable: true,
      aliases: [],
      description: 'Slack Bot',
    },
    rest: {
      id: 'rest',
      name: 'REST API',
      markdownCapable: true,
      aliases: ['api', 'http'],
      description: 'HTTP REST endpoint',
    },
  };

  // ── Channel Registration ───────────────────────────────────

  /**
   * Register a channel adapter
   */
  function registerChannel(adapter) {
    if (!adapter || !adapter.id) return { error: 'Adapter must have an id' };

    const channel = {
      ...CHANNEL_DEFS[adapter.id] || {},
      ...adapter,
      connected: false,
      registeredAt: Date.now(),
    };

    _channels.set(channel.id, channel);

    // Register aliases
    if (channel.aliases) {
      for (const alias of channel.aliases) {
        _channels.set(alias, channel);
      }
    }

    console.log(`[FLOWORKOS Gateway] 📡 Registered channel: ${channel.name} (${channel.id})`);
    return { status: 'ok', id: channel.id };
  }

  /**
   * Unregister a channel
   */
  function unregisterChannel(channelId) {
    const channel = _channels.get(channelId);
    if (!channel) return { error: 'Channel not found' };

    // Remove aliases
    if (channel.aliases) {
      for (const alias of channel.aliases) {
        _channels.delete(alias);
      }
    }
    _channels.delete(channelId);
    return { status: 'ok' };
  }

  // ── Normalized Message Format ──────────────────────────────

  /**
   * @typedef {Object} GatewayMessage
   * @property {string} id - Unique message ID
   * @property {string} channel - Channel ID
   * @property {string} from - Sender identifier
   * @property {string} to - Recipient identifier
   * @property {string} text - Message text
   * @property {string} [threadId] - Thread/conversation ID
   * @property {string} [replyTo] - Reply-to message ID
   * @property {string[]} [attachments] - File URLs
   * @property {Object} [metadata] - Channel-specific metadata
   * @property {number} timestamp
   */

  function normalizeInbound(raw, channelId) {
    return {
      id: raw.id || raw.message_id || `msg_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
      channel: channelId,
      from: raw.from || raw.sender || raw.user || raw.accountId || 'unknown',
      to: raw.to || raw.recipient || raw.bot || 'flowork',
      text: raw.text || raw.body || raw.content || raw.message || '',
      threadId: raw.threadId || raw.thread_id || raw.chat_id || raw.conversation_id || null,
      replyTo: raw.replyTo || raw.reply_to_message_id || null,
      attachments: raw.attachments || raw.media || [],
      metadata: raw.metadata || {},
      timestamp: raw.timestamp || Date.now(),
    };
  }

  // ── Inbound Processing ─────────────────────────────────────

  /**
   * Handle an incoming message from any channel
   */
  async function handleInbound(rawMessage, channelId) {
    const msg = normalizeInbound(rawMessage, channelId);

    console.log(`[FLOWORKOS Gateway] 📨 ${msg.channel}/${msg.from}: "${msg.text.slice(0, 80)}"`);

    // Send typing indicator
    const channel = _channels.get(channelId);
    if (channel?.sendTyping) {
      try { channel.sendTyping(msg.threadId || msg.from); } catch {}
    }

    // Run through handlers
    for (const handler of _inboundHandlers) {
      try {
        const result = await handler(msg);
        if (result?.handled) return result;
      } catch (err) {
        console.error(`[FLOWORKOS Gateway] Handler error:`, err);
      }
    }

    // Default: route to brain
    return await routeToBrain(msg);
  }

  /**
   * Register an inbound message handler
   */
  function onInbound(handler) {
    if (typeof handler === 'function') {
      _inboundHandlers.push(handler);
    }
  }

  // ── Brain Routing ──────────────────────────────────────────

  /**
   * Route a normalized message to the Flowork brain
   */
  async function routeToBrain(msg) {
    // Push to chat history
    if (window.chatHistory) {
      window.chatHistory.push({
        role: 'user',
        content: msg.text,
        _gateway: {
          channel: msg.channel,
          from: msg.from,
          threadId: msg.threadId,
          messageId: msg.id,
        },
      });
    }

    // Bind session to channel for reply routing
    const sessionKey = msg.threadId || msg.from;
    _sessionBindings.set(sessionKey, {
      channel: msg.channel,
      from: msg.from,
      threadId: msg.threadId,
    });

    // Trigger the brain agent tick
    if (window.floworkBrain?.submitMessage) {
      try {
        await window.floworkBrain.submitMessage(msg.text);
        return { handled: true, routed: 'brain' };
      } catch (err) {
        return { handled: false, error: err.message };
      }
    }

    return { handled: false, error: 'Brain not available' };
  }

  // ── Outbound Processing ────────────────────────────────────

  /**
   * Send a message through a channel
   */
  async function sendOutbound(channelId, to, text, options) {
    options = options || {};
    const channel = _channels.get(channelId);
    if (!channel) return { error: `Channel "${channelId}" not found` };
    if (!channel.sendMessage) return { error: `Channel "${channelId}" has no sendMessage` };

    // Format text for channel capabilities
    let formattedText = text;
    if (!channel.markdownCapable) {
      formattedText = stripMarkdown(text);
    }

    // Truncate if needed (WhatsApp: 4096, Telegram: 4096, Discord: 2000)
    const maxLength = options.maxLength || 4000;
    if (formattedText.length > maxLength) {
      formattedText = formattedText.slice(0, maxLength - 20) + '\n\n...truncated';
    }

    try {
      const result = await channel.sendMessage(to, formattedText, {
        threadId: options.threadId,
        replyTo: options.replyTo,
        ...options,
      });

      console.log(`[FLOWORKOS Gateway] 📤 ${channelId}/${to}: sent (${formattedText.length} chars)`);
      return { status: 'ok', channel: channelId, to, ...result };
    } catch (err) {
      console.error(`[FLOWORKOS Gateway] Send failed:`, err);
      return { error: err.message };
    }
  }

  /**
   * Reply to a session's channel (auto-route based on binding)
   */
  async function replyToSession(sessionKey, text, options) {
    const binding = _sessionBindings.get(sessionKey);
    if (!binding) return { error: 'No channel binding for session' };

    return await sendOutbound(binding.channel, binding.from, text, {
      threadId: binding.threadId,
      ...options,
    });
  }

  // ── WhatsApp Channel Adapter ───────────────────────────────

  function createWhatsAppAdapter(config) {
    const phoneNumberId = config.phoneNumberId;
    const accessToken = config.accessToken;
    const apiBase = 'https://graph.facebook.com/v18.0';

    return {
      id: 'whatsapp',
      name: 'WhatsApp',
      config,

      async sendMessage(to, text, options) {
        const url = `${apiBase}/${phoneNumberId}/messages`;
        const body = {
          messaging_product: 'whatsapp',
          to: to,
          type: 'text',
          text: { body: text },
        };

        if (options?.replyTo) {
          body.context = { message_id: options.replyTo };
        }

        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          throw new Error(`WhatsApp API ${response.status}: ${await response.text()}`);
        }

        return await response.json();
      },

      sendTyping(to) {
        // WhatsApp doesn't have built-in typing, but we can mark as read
      },

      parseWebhook(req) {
        // Parse WhatsApp Cloud API webhook
        const entry = req.entry?.[0];
        const changes = entry?.changes?.[0];
        const message = changes?.value?.messages?.[0];
        if (!message) return null;

        return {
          id: message.id,
          from: message.from,
          text: message.text?.body || '',
          timestamp: parseInt(message.timestamp) * 1000,
          type: message.type,
        };
      },
    };
  }

  // ── Telegram Channel Adapter ───────────────────────────────

  function createTelegramAdapter(config) {
    const botToken = config.botToken;
    const apiBase = `https://api.telegram.org/bot${botToken}`;

    return {
      id: 'telegram',
      name: 'Telegram',
      config,

      async sendMessage(to, text, options) {
        const body = {
          chat_id: to,
          text: text,
          parse_mode: 'Markdown',
        };

        if (options?.replyTo) {
          body.reply_to_message_id = options.replyTo;
        }
        if (options?.threadId) {
          body.message_thread_id = options.threadId;
        }

        const response = await fetch(`${apiBase}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          throw new Error(`Telegram API ${response.status}: ${await response.text()}`);
        }

        return await response.json();
      },

      async sendTyping(chatId) {
        try {
          await fetch(`${apiBase}/sendChatAction`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
          });
        } catch {}
      },

      parseWebhook(update) {
        const msg = update.message || update.edited_message;
        if (!msg) return null;

        return {
          id: msg.message_id,
          from: String(msg.chat.id),
          text: msg.text || msg.caption || '',
          threadId: msg.message_thread_id || null,
          timestamp: msg.date * 1000,
          metadata: {
            username: msg.from?.username,
            firstName: msg.from?.first_name,
            chatType: msg.chat.type,
          },
        };
      },

      async setWebhook(url) {
        const response = await fetch(`${apiBase}/setWebhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        return await response.json();
      },

      async getMe() {
        const response = await fetch(`${apiBase}/getMe`);
        return await response.json();
      },
    };
  }

  // ── Web Chat Adapter ───────────────────────────────────────

  function createWebChatAdapter() {
    return {
      id: 'web',
      name: 'Web Chat',

      async sendMessage(to, text) {
        // Output to UI
        if (window.appendChatMessage) {
          window.appendChatMessage('agent', text);
        }
        return { delivered: true };
      },

      sendTyping() {
        if (window.showTypingIndicator) {
          window.showTypingIndicator();
        }
      },
    };
  }

  // ── Gateway WebSocket Server ───────────────────────────────

  let _wsConnections = new Map(); // connectionId → { ws, channel, authenticated }

  /**
   * Handle a WebSocket connection (for remote channels)
   */
  function handleWsConnection(ws, connectionId) {
    _wsConnections.set(connectionId, {
      ws,
      channel: null,
      authenticated: false,
      connectedAt: Date.now(),
    });

    ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);

        switch (data.type) {
          case 'auth':
            _wsConnections.get(connectionId).authenticated = true;
            _wsConnections.get(connectionId).channel = data.channel;
            ws.send(JSON.stringify({ type: 'auth_ok' }));
            break;

          case 'message':
            if (!_wsConnections.get(connectionId).authenticated) {
              ws.send(JSON.stringify({ type: 'error', error: 'Not authenticated' }));
              return;
            }
            const result = await handleInbound(data, data.channel || 'ws');
            ws.send(JSON.stringify({ type: 'ack', id: data.id, result }));
            break;

          case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;
        }
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', error: err.message }));
      }
    };

    ws.onclose = () => {
      _wsConnections.delete(connectionId);
    };
  }

  /**
   * Broadcast to all connected WebSocket clients
   */
  function broadcastWs(data) {
    const payload = JSON.stringify(data);
    for (const [, conn] of _wsConnections) {
      if (conn.authenticated && conn.ws.readyState === 1) {
        try { conn.ws.send(payload); } catch {}
      }
    }
  }

  // ── Helpers ────────────────────────────────────────────────

  function stripMarkdown(text) {
    return text
      .replace(/\*\*(.*?)\*\*/g, '$1')     // **bold**
      .replace(/\*(.*?)\*/g, '$1')          // *italic*
      .replace(/`{3}[\s\S]*?`{3}/g, '')    // ```code blocks```
      .replace(/`([^`]+)`/g, '$1')          // `inline code`
      .replace(/#{1,6}\s/g, '')             // # headings
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [links](url)
      .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1') // ![images](url)
      .replace(/^[-*+]\s/gm, '• ')         // - lists
      .replace(/^>\s/gm, '')               // > blockquotes
      ;
  }

  function listChannels() {
    const channels = [];
    const seen = new Set();
    for (const [id, ch] of _channels) {
      if (seen.has(ch.id)) continue;
      seen.add(ch.id);
      channels.push({
        id: ch.id, name: ch.name, connected: ch.connected,
        markdownCapable: ch.markdownCapable,
        description: ch.description || '',
      });
    }
    return channels;
  }

  function getGatewayStatus() {
    const channels = listChannels();
    return {
      channels: channels.length,
      connected: channels.filter(c => c.connected).length,
      wsConnections: _wsConnections.size,
      sessionBindings: _sessionBindings.size,
      pendingMessages: _messageQueue.length,
    };
  }

  // ── Auto-register Web Chat ─────────────────────────────────
  registerChannel(createWebChatAdapter());

  // ── Register to Window ─────────────────────────────────────
  window.FLOWORKOS_Gateway = {
    // Core
    registerChannel,
    unregisterChannel,
    handleInbound,
    sendOutbound,
    replyToSession,
    routeToBrain,
    onInbound,
    // Adapters
    createWhatsAppAdapter,
    createTelegramAdapter,
    createWebChatAdapter,
    // WebSocket
    handleWsConnection,
    broadcastWs,
    // Utils
    normalizeInbound,
    stripMarkdown,
    listChannels,
    getGatewayStatus,
    // Constants
    CHANNEL_DEFS,
  };

  console.log('[FLOWORKOS] ✅ Multi-Channel Gateway loaded (web, whatsapp, telegram, discord, slack, rest)');
})();
