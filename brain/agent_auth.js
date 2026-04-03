// =========================================================================
// FLOWORK OS - CLAUDE CODE FULL PARITY v2
// FILE: agent_auth.js
// DESCRIPTION: OAuth 2.0 + Multi-Provider Auth + Token Management
//              Claude Code: OAuth/JWT parity (adapted for Electron)
// =========================================================================

window.authManager = {
    providers: {
        flowork: {
            name: 'Flowork Cloud',
            authUrl: 'https://floworkos.com/auth/authorize',
            tokenUrl: 'https://floworkos.com/auth/token',
            clientId: 'flowork-desktop',
            scopes: ['read', 'write', 'sync']
        },
        github: {
            name: 'GitHub',
            authUrl: 'https://github.com/login/oauth/authorize',
            tokenUrl: 'https://github.com/login/oauth/access_token',
            clientId: '', // Set by user
            scopes: ['repo', 'user']
        },
        google: {
            name: 'Google',
            authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
            tokenUrl: 'https://oauth2.googleapis.com/token',
            clientId: '', // Set by user
            scopes: ['openid', 'email']
        }
    },

    // Token storage (in localStorage, encrypted in production via Go backend)
    _tokens: {},

    init: function() {
        try {
            const saved = localStorage.getItem('flowork_auth_tokens');
            if (saved) this._tokens = JSON.parse(saved);
        } catch(e) {}
    },

    // Generate PKCE challenge
    _generatePKCE: async function() {
        const verifier = Array.from(crypto.getRandomValues(new Uint8Array(32)))
            .map(b => b.toString(36)).join('').substring(0, 43);
        const encoder = new TextEncoder();
        const data = encoder.encode(verifier);
        const hash = await crypto.subtle.digest('SHA-256', data);
        const challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        return { verifier, challenge };
    },

    // Start OAuth 2.0 PKCE flow
    login: async function(providerName) {
        const provider = this.providers[providerName];
        if (!provider) return { error: `Unknown provider: ${providerName}` };
        if (!provider.clientId) return { error: `Client ID not set for ${providerName}. Use set_config to set it.` };

        try {
            const pkce = await this._generatePKCE();
            const state = crypto.randomUUID();
            const redirectUri = 'http://127.0.0.1:5000/auth/callback';

            // Build auth URL
            const params = new URLSearchParams({
                client_id: provider.clientId,
                response_type: 'code',
                redirect_uri: redirectUri,
                scope: provider.scopes.join(' '),
                state: state,
                code_challenge: pkce.challenge,
                code_challenge_method: 'S256'
            });

            const authUrl = `${provider.authUrl}?${params.toString()}`;

            // Store PKCE verifier for callback
            sessionStorage.setItem('oauth_state', state);
            sessionStorage.setItem('oauth_verifier', pkce.verifier);
            sessionStorage.setItem('oauth_provider', providerName);

            // Open auth URL via Go backend (which will handle redirect)
            try {
                await fetch('http://127.0.0.1:5000/api/auth/start', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        provider: providerName,
                        auth_url: authUrl,
                        state: state,
                        verifier: pkce.verifier,
                        redirect_uri: redirectUri
                    })
                });
            } catch(e) {
                // Fallback: open in browser
                window.open(authUrl, '_blank');
            }

            console.log(`[Auth] Opening login for ${provider.name}...`);
            return { status: 'redirecting', provider: providerName, url: authUrl };
        } catch(e) {
            return { error: `Login failed: ${e.message}` };
        }
    },

    // Handle callback (called by Go backend after OAuth redirect)
    handleCallback: async function(providerName, code) {
        const provider = this.providers[providerName];
        if (!provider) return { error: 'Unknown provider' };

        const verifier = sessionStorage.getItem('oauth_verifier');
        if (!verifier) return { error: 'No PKCE verifier found' };

        try {
            // Exchange code for token
            const res = await fetch('http://127.0.0.1:5000/api/auth/exchange', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    provider: providerName,
                    code: code,
                    verifier: verifier,
                    token_url: provider.tokenUrl,
                    client_id: provider.clientId,
                    redirect_uri: 'http://127.0.0.1:5000/auth/callback'
                })
            });

            if (!res.ok) return { error: 'Token exchange failed' };
            const data = await res.json();

            // Store token
            this._tokens[providerName] = {
                accessToken: data.access_token,
                refreshToken: data.refresh_token,
                expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
                scope: data.scope,
                tokenType: data.token_type || 'Bearer'
            };
            this._save();

            // Clear PKCE state
            sessionStorage.removeItem('oauth_state');
            sessionStorage.removeItem('oauth_verifier');
            sessionStorage.removeItem('oauth_provider');

            console.log(`[Auth] Logged in to ${provider.name}`);
            if (window.appendToolMessage) {
                window.appendToolMessage('Auth', 'success', `Logged in to ${provider.name}`);
            }
            return { status: 'logged_in', provider: providerName };
        } catch(e) {
            return { error: `Token exchange failed: ${e.message}` };
        }
    },

    // Get access token (auto-refresh if expired)
    getToken: async function(providerName) {
        const token = this._tokens[providerName];
        if (!token) return null;

        // Check if expired
        if (Date.now() > token.expiresAt - 60000) { // 1 minute buffer
            const refreshed = await this.refreshToken(providerName);
            if (!refreshed) return null;
        }

        return token.accessToken;
    },

    // Refresh token
    refreshToken: async function(providerName) {
        const token = this._tokens[providerName];
        if (!token?.refreshToken) return false;
        const provider = this.providers[providerName];

        try {
            const res = await fetch('http://127.0.0.1:5000/api/auth/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    provider: providerName,
                    refresh_token: token.refreshToken,
                    token_url: provider.tokenUrl,
                    client_id: provider.clientId
                })
            });

            if (!res.ok) {
                this.logout(providerName);
                return false;
            }

            const data = await res.json();
            this._tokens[providerName] = {
                ...token,
                accessToken: data.access_token,
                expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
                refreshToken: data.refresh_token || token.refreshToken
            };
            this._save();
            return true;
        } catch(e) {
            return false;
        }
    },

    // Logout
    logout: function(providerName) {
        if (providerName) {
            delete this._tokens[providerName];
        } else {
            this._tokens = {};
        }
        this._save();
        console.log(`[Auth] Logged out: ${providerName || 'all'}`);
        return { status: 'logged_out', provider: providerName || 'all' };
    },

    // Check login status
    isLoggedIn: function(providerName) {
        const token = this._tokens[providerName];
        return token && Date.now() < token.expiresAt;
    },

    // Get status
    getStatus: function() {
        const status = {};
        for (const [name, provider] of Object.entries(this.providers)) {
            status[name] = {
                name: provider.name,
                loggedIn: this.isLoggedIn(name),
                expiresAt: this._tokens[name]?.expiresAt
                    ? new Date(this._tokens[name].expiresAt).toLocaleString()
                    : null
            };
        }
        return status;
    },

    _save: function() {
        try {
            localStorage.setItem('flowork_auth_tokens', JSON.stringify(this._tokens));
        } catch(e) {}
    }
};

window.authManager.init();
console.log('[Flowork OS] Auth Manager loaded (OAuth 2.0 PKCE)');
