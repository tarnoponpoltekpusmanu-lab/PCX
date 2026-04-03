/**
 * ============================================================
 *  FLOWORKOS™ Payload Redaction Engine
 *  FLOWORKOS™ native payload redaction engine
 * ============================================================
 *  Logic: Automatically detect and redact sensitive data from:
 *  - API keys and tokens
 *  - Passwords and secrets
 *  - Credit card numbers
 *  - Social security numbers
 *  - Private keys (RSA, SSH, etc.)
 *  - JWT tokens
 *  - Connection strings
 *  Applied before: logging, KB publish, tool responses, context
 * ============================================================
 */

(function () {
  'use strict';

  // ── Sensitive Patterns ─────────────────────────────────────
  const REDACTION_PATTERNS = [
    // API Keys (common formats)
    { pattern: /(?:api[_-]?key|apikey|api_secret)\s*[:=]\s*["']?([A-Za-z0-9_\-]{20,})["']?/gi,
      label: 'API_KEY', group: 1 },
    { pattern: /(?:sk|pk)[-_](?:live|test|prod)[-_][A-Za-z0-9]{20,}/g,
      label: 'STRIPE_KEY' },
    { pattern: /AIza[A-Za-z0-9_\-]{35}/g,
      label: 'GOOGLE_API_KEY' },
    { pattern: /ghp_[A-Za-z0-9]{36}/g,
      label: 'GITHUB_TOKEN' },
    { pattern: /gho_[A-Za-z0-9]{36}/g,
      label: 'GITHUB_OAUTH' },
    { pattern: /github_pat_[A-Za-z0-9_]{82}/g,
      label: 'GITHUB_PAT' },
    { pattern: /xox[bpas]-[A-Za-z0-9\-]{10,}/g,
      label: 'SLACK_TOKEN' },
    { pattern: /(?:sk-|sess-)[A-Za-z0-9]{20,}/g,
      label: 'OPENAI_KEY' },
    { pattern: /(?:AKIA|ASIA)[A-Z0-9]{16}/g,
      label: 'AWS_ACCESS_KEY' },
    { pattern: /(?:npm_)[A-Za-z0-9]{36}/g,
      label: 'NPM_TOKEN' },

    // Bearer tokens
    { pattern: /[Bb]earer\s+[A-Za-z0-9_\-.]{20,}/g,
      label: 'BEARER_TOKEN' },

    // JWT tokens
    { pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_\-.+/=]{10,}/g,
      label: 'JWT_TOKEN' },

    // Private keys
    { pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
      label: 'PRIVATE_KEY' },
    { pattern: /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
      label: 'CERTIFICATE' },

    // Passwords in config/env
    { pattern: /(?:password|passwd|pwd|secret|token)\s*[:=]\s*["']([^"'\s]{8,})["']/gi,
      label: 'PASSWORD', group: 1 },
    { pattern: /(?:password|passwd|pwd|secret|token)\s*[:=]\s*([^\s"',;]{8,})/gi,
      label: 'PASSWORD', group: 1 },

    // Connection strings
    { pattern: /(?:mongodb|postgres|mysql|redis|amqp|mssql):\/\/[^\s"']{10,}/gi,
      label: 'CONNECTION_STRING' },
    { pattern: /(?:Data Source|Server)=[^;]+;.*(?:Password|Pwd)=[^;]+/gi,
      label: 'CONNECTION_STRING' },

    // Credit card numbers (basic detection)
    { pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
      label: 'CREDIT_CARD' },

    // SSN
    { pattern: /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/g,
      label: 'SSN_CANDIDATE' },

    // Webhook URLs with secrets
    { pattern: /https?:\/\/hooks\.slack\.com\/[^\s"']{20,}/g,
      label: 'SLACK_WEBHOOK' },
    { pattern: /https?:\/\/discord(?:app)?\.com\/api\/webhooks\/[^\s"']{20,}/g,
      label: 'DISCORD_WEBHOOK' },

    // .env file style
    { pattern: /^[A-Z_]{3,}(?:_KEY|_SECRET|_TOKEN|_PASSWORD|_PASS|_API)\s*=\s*(.+)$/gm,
      label: 'ENV_SECRET', group: 1 },
  ];

  // ── Allowlist (false positives to skip) ────────────────────
  const REDACTION_ALLOWLIST = [
    'undefined', 'null', 'true', 'false',
    'localhost', '127.0.0.1', '0.0.0.0',
    'example.com', 'test', 'demo',
  ];

  // ── Main Redaction Function ────────────────────────────────

  /**
   * Redact sensitive content from text
   *
   * @param {string} text - Input text
   * @param {Object} [options]
   * @param {boolean} [options.verbose=false] - Log each redaction
   * @param {string} [options.placeholder='[REDACTED]'] - Replacement text
   * @returns {{ text: string, redactions: Array<{ label: string, count: number }> }}
   */
  function redact(text, options) {
    if (!text || typeof text !== 'string') return { text: text || '', redactions: [] };

    options = options || {};
    const placeholder = options.placeholder || '[REDACTED]';
    const verbose = options.verbose || false;
    const redactions = new Map(); // label → count
    let result = text;

    for (const rule of REDACTION_PATTERNS) {
      const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
      let match;

      while ((match = regex.exec(result)) !== null) {
        const fullMatch = match[0];
        const sensitiveValue = rule.group ? (match[rule.group] || fullMatch) : fullMatch;

        // Check allowlist
        if (REDACTION_ALLOWLIST.some(a => sensitiveValue.toLowerCase() === a)) continue;
        // Skip short matches (likely false positive)
        if (sensitiveValue.length < 8) continue;

        const redactedLabel = `${placeholder}:${rule.label}`;
        if (rule.group) {
          // Only redact the captured group, not the key
          result = result.replace(sensitiveValue, redactedLabel);
        } else {
          result = result.replace(fullMatch, redactedLabel);
        }

        redactions.set(rule.label, (redactions.get(rule.label) || 0) + 1);

        if (verbose) {
          console.warn(`[FLOWORKOS Redaction] Redacted ${rule.label}: ****${sensitiveValue.slice(-4)}`);
        }
      }
    }

    const redactionList = [];
    for (const [label, count] of redactions) {
      redactionList.push({ label, count });
    }

    return { text: result, redactions: redactionList };
  }

  /**
   * Quick check if text contains any sensitive data
   */
  function containsSensitiveData(text) {
    if (!text || typeof text !== 'string') return false;
    for (const rule of REDACTION_PATTERNS) {
      const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
      if (regex.test(text)) return true;
    }
    return false;
  }

  /**
   * Redact an object's values recursively
   */
  function redactObject(obj, options) {
    if (!obj || typeof obj !== 'object') {
      if (typeof obj === 'string') return redact(obj, options).text;
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map(item => redactObject(item, options));
    }
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      // Always redact values for known sensitive keys
      const keyLower = key.toLowerCase();
      if (['password', 'secret', 'token', 'apikey', 'api_key', 'private_key',
           'access_key', 'auth', 'credential', 'authorization'].includes(keyLower)) {
        result[key] = '[REDACTED:' + key.toUpperCase() + ']';
      } else {
        result[key] = redactObject(value, options);
      }
    }
    return result;
  }

  /**
   * Sanitize console output (for safe logging)
   */
  function sanitizeForLog(text) {
    if (typeof text !== 'string') return String(text);
    // Strip ANSI escape codes
    text = text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    // Redact secrets
    return redact(text, { placeholder: '***' }).text;
  }

  // ── Register to Window ─────────────────────────────────────
  window.FLOWORKOS_Redaction = {
    redact,
    containsSensitiveData,
    redactObject,
    sanitizeForLog,
    REDACTION_PATTERNS,
  };

  console.log('[FLOWORKOS] ✅ Payload Redaction Engine loaded');
})();
