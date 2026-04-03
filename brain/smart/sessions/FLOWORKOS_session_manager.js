/**
 * ============================================================
 *  FLOWORKOS™ Session Persistence Manager
 *  FLOWORKOS™ native session persistence engine
 * ============================================================
 *  Logic: Auto-save and restore agent sessions:
 *  - Persist conversation history to disk
 *  - Resume sessions after restart
 *  - Session metadata (model, tokens, timestamps)
 *  - Transcript repair (fix corrupt sessions)
 *  - Export/import sessions
 * ============================================================
 */

(function () {
  'use strict';

  // ── Constants ──────────────────────────────────────────────
  const SESSION_DIR = 'sessions';
  const MAX_SESSIONS = 50;
  const AUTO_SAVE_INTERVAL_MS = 30_000; // Auto-save every 30s
  const TRANSCRIPT_MAX_MESSAGES = 1000;

  // ── State ──────────────────────────────────────────────────
  let _currentSession = null;
  let _autoSaveTimer = null;
  const _sessionIndex = new Map(); // sessionId → metadata

  /**
   * @typedef {Object} SessionData
   * @property {string} id
   * @property {string} title
   * @property {number} createdAt
   * @property {number} updatedAt
   * @property {string} model
   * @property {string} provider
   * @property {number} messageCount
   * @property {number} totalTokens
   * @property {Array} messages - Chat history
   * @property {Object} metadata - Custom metadata
   */

  // ── Session Lifecycle ──────────────────────────────────────

  /**
   * Create a new session
   */
  function createSession(options) {
    options = options || {};
    const id = 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);

    const session = {
      id,
      title: options.title || 'New Session',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      model: options.model || '',
      provider: options.provider || '',
      messageCount: 0,
      totalTokens: 0,
      messages: [],
      metadata: options.metadata || {},
    };

    _sessionIndex.set(id, {
      id, title: session.title, createdAt: session.createdAt,
      updatedAt: session.updatedAt, messageCount: 0,
    });

    _currentSession = session;
    _startAutoSave();

    console.log(`[FLOWORKOS Session] Created: ${id} ("${session.title}")`);
    return session;
  }

  /**
   * Save current session to disk
   */
  async function saveSession(session) {
    session = session || _currentSession;
    if (!session) return { error: 'No active session' };

    session.updatedAt = Date.now();
    session.messageCount = (session.messages || []).length;

    // Truncate messages if too many
    if (session.messages.length > TRANSCRIPT_MAX_MESSAGES) {
      const systemMsgs = session.messages.filter(m => m.role === 'system').slice(0, 1);
      const recentMsgs = session.messages.slice(-TRANSCRIPT_MAX_MESSAGES + 1);
      session.messages = [...systemMsgs, ...recentMsgs];
      session.messageCount = session.messages.length;
    }

    try {
      if (window.electronBridge?.writeFile) {
        const filePath = `${SESSION_DIR}/${session.id}.json`;
        const data = JSON.stringify(session, null, 2);

        // Redact sensitive data before saving
        let safeData = data;
        if (window.FLOWORKOS_Redaction) {
          safeData = window.FLOWORKOS_Redaction.redact(data, { placeholder: '***' }).text;
        }

        await window.electronBridge.writeFile(filePath, safeData);

        // Update index
        _sessionIndex.set(session.id, {
          id: session.id, title: session.title,
          createdAt: session.createdAt, updatedAt: session.updatedAt,
          messageCount: session.messageCount,
        });

        return { status: 'ok', id: session.id, size: safeData.length };
      } else {
        // Fallback: save to localStorage
        const key = `floworkos_session_${session.id}`;
        localStorage.setItem(key, JSON.stringify(session));
        return { status: 'ok', id: session.id, storage: 'localStorage' };
      }
    } catch (err) {
      console.error(`[FLOWORKOS Session] Save failed:`, err);
      return { error: err.message };
    }
  }

  /**
   * Load a session from disk
   */
  async function loadSession(sessionId) {
    try {
      if (window.electronBridge?.readFile) {
        const filePath = `${SESSION_DIR}/${sessionId}.json`;
        const data = await window.electronBridge.readFile(filePath);
        const session = JSON.parse(data);
        _currentSession = session;
        _startAutoSave();
        console.log(`[FLOWORKOS Session] Loaded: ${sessionId} (${session.messageCount} msgs)`);
        return session;
      } else {
        const key = `floworkos_session_${sessionId}`;
        const data = localStorage.getItem(key);
        if (!data) return { error: 'Session not found' };
        const session = JSON.parse(data);
        _currentSession = session;
        return session;
      }
    } catch (err) {
      return { error: err.message };
    }
  }

  /**
   * List all saved sessions
   */
  async function listSessions() {
    try {
      if (window.electronBridge?.listFiles) {
        const files = await window.electronBridge.listFiles(SESSION_DIR);
        const sessions = [];
        for (const file of files) {
          if (!file.endsWith('.json')) continue;
          try {
            const data = await window.electronBridge.readFile(`${SESSION_DIR}/${file}`);
            const session = JSON.parse(data);
            sessions.push({
              id: session.id, title: session.title,
              createdAt: session.createdAt, updatedAt: session.updatedAt,
              messageCount: session.messageCount, model: session.model,
            });
          } catch { /* skip corrupt files */ }
        }
        return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
      } else {
        // Fallback: scan localStorage
        const sessions = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key?.startsWith('floworkos_session_')) continue;
          try {
            const session = JSON.parse(localStorage.getItem(key));
            sessions.push({
              id: session.id, title: session.title,
              createdAt: session.createdAt, updatedAt: session.updatedAt,
              messageCount: session.messageCount,
            });
          } catch { /* skip */ }
        }
        return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
      }
    } catch (err) {
      return [];
    }
  }

  /**
   * Delete a session
   */
  async function deleteSession(sessionId) {
    try {
      if (window.electronBridge?.deleteFile) {
        await window.electronBridge.deleteFile(`${SESSION_DIR}/${sessionId}.json`);
      } else {
        localStorage.removeItem(`floworkos_session_${sessionId}`);
      }
      _sessionIndex.delete(sessionId);
      if (_currentSession?.id === sessionId) _currentSession = null;
      return { status: 'ok' };
    } catch (err) {
      return { error: err.message };
    }
  }

  // ── Sync with chatHistory ──────────────────────────────────

  /**
   * Sync window.chatHistory to current session
   */
  function syncFromChatHistory() {
    if (!_currentSession) return;
    _currentSession.messages = [...(window.chatHistory || [])];
    _currentSession.messageCount = _currentSession.messages.length;
    _currentSession.updatedAt = Date.now();
  }

  /**
   * Restore chatHistory from current session
   */
  function syncToChatHistory() {
    if (!_currentSession) return;
    window.chatHistory = [..._currentSession.messages];
  }

  // ── Transcript Repair ──────────────────────────────────────

  /**
   * Repair a corrupt session transcript
   */
  function repairTranscript(session) {
    if (!session || !session.messages) return session;

    const repaired = [];
    for (const msg of session.messages) {
      if (!msg || typeof msg !== 'object') continue;
      if (!msg.role || !['user', 'assistant', 'agent', 'system', 'tool'].includes(msg.role)) continue;
      if (msg.content === undefined || msg.content === null) msg.content = '';
      if (typeof msg.content !== 'string') msg.content = JSON.stringify(msg.content);
      repaired.push(msg);
    }

    session.messages = repaired;
    session.messageCount = repaired.length;
    return session;
  }

  /**
   * Export session as JSON (for sharing/backup)
   */
  function exportSession(session) {
    session = session || _currentSession;
    if (!session) return null;

    // Redact before export
    const safe = window.FLOWORKOS_Redaction
      ? window.FLOWORKOS_Redaction.redactObject(session)
      : session;

    return JSON.stringify(safe, null, 2);
  }

  /**
   * Import session from JSON
   */
  function importSession(jsonString) {
    try {
      const session = JSON.parse(jsonString);
      if (!session.id || !session.messages) throw new Error('Invalid session format');
      session.id = 'imported_' + Date.now().toString(36);
      _currentSession = repairTranscript(session);
      return { status: 'ok', session: _currentSession };
    } catch (err) {
      return { error: err.message };
    }
  }

  // ── Auto-Save ──────────────────────────────────────────────

  function _startAutoSave() {
    _stopAutoSave();
    _autoSaveTimer = setInterval(() => {
      if (_currentSession) {
        syncFromChatHistory();
        saveSession(_currentSession);
      }
    }, AUTO_SAVE_INTERVAL_MS);
  }

  function _stopAutoSave() {
    if (_autoSaveTimer) {
      clearInterval(_autoSaveTimer);
      _autoSaveTimer = null;
    }
  }

  function getCurrentSession() {
    return _currentSession;
  }

  // ── Register to Window ─────────────────────────────────────
  window.FLOWORKOS_Sessions = {
    createSession,
    saveSession,
    loadSession,
    listSessions,
    deleteSession,
    syncFromChatHistory,
    syncToChatHistory,
    repairTranscript,
    exportSession,
    importSession,
    getCurrentSession,
    // Constants
    SESSION_DIR,
    MAX_SESSIONS,
    AUTO_SAVE_INTERVAL_MS,
  };

  console.log('[FLOWORKOS] ✅ Session Persistence Manager loaded');
})();
