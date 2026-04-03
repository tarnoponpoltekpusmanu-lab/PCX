// =========================================================================
// FLOWORK OS - NANO MODULAR ARCHITECTURE
// FILE: agent_ui.js
// DESKRIPSI: UI Helpers (Chat, Markdown Parser, Loader, History)
// =========================================================================

window.escapeHtml = function (unsafe) {
    return (unsafe || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
};

window.unescapeHtml = function (safe) {
    return (safe || '').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#039;/g, "'");
};

window.formatMarkdown = function (text) {
    if (!text) return '';

    // Strip control flags before rendering
    let cleaned = text
        .replace(/\[WAITING_APPROVAL\]/gi, '')
        .replace(/\[MENUNGGU_KONFIRMASI\]/gi, '')
        .replace(/\[AUTO_CONTINUE\]/gi, '')
        .replace(/\[LANJUT_OTOMATIS\]/gi, '')
        .replace(/\[TASK_COMPLETE\]/gi, '')
        .replace(/\[TUGAS_SELESAI\]/gi, '')
        .trim();

    let html = window.escapeHtml(cleaned);

    // Extract code blocks to prevent them from being mangled by <br> or other text formatting
    const codeBlocks = {};
    let codeIndex = 0;

    html = html.replace(/```([a-z0-9]*)\n([\s\S]*?)```/gi, (match, lang, code) => {
        const rawCode = window.unescapeHtml(code);
        const encodedCode = btoa(unescape(encodeURIComponent(rawCode)));
        const displayLang = lang ? lang.toUpperCase() : 'CODE';

        const blockId = `__CODE_BLOCK_${codeIndex}__`;
        codeBlocks[blockId] = `
        <div class="code-block-wrapper">
            <div class="code-block-header">
                <div class="mac-dots">
                    <span class="dot dot-close"></span>
                    <span class="dot dot-min"></span>
                    <span class="dot dot-max"></span>
                </div>
                <span class="code-block-lang">${displayLang}</span>
                <button class="code-block-btn" onclick="window.forceToMonaco('${encodedCode}', '${lang}')">◀ Move to Editor</button>
            </div>
            <pre style="margin:0; padding:12px; overflow-x:auto;"><code>${code}</code></pre>
        </div>`;
        codeIndex++;
        return blockId;
    });

    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/`(.*?)`/g, '<code style="background: rgba(255,255,255,0.1); padding: 2px 4px; border-radius: 4px; color: #3DDC84;">$1</code>');

    // Format links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color: #3b82f6; text-decoration: underline;">$1</a>');

    // Replace linebreaks with <br> only for actual text segments
    html = html.replace(/\n/g, '<br>');

    // Restore Code Blocks
    for (const [id, blockHtml] of Object.entries(codeBlocks)) {
        html = html.replace(id, blockHtml);
    }

    return html;
};

window.forceToMonaco = function (base64Code, lang) {
    try {
        const decodedCode = decodeURIComponent(escape(atob(base64Code)));
        if (window.monacoEditorInstance) {
            const editorPanel = document.getElementById('panel-editor');
            if (editorPanel) {
                editorPanel.style.boxShadow = 'inset 0 0 0 2px #7C3AED';
                setTimeout(() => editorPanel.style.boxShadow = 'none', 800);
            }

            if (Object.keys(window.generatedFiles).length === 0) {
                let dummyName = 'snippet.txt';
                if (lang === 'javascript' || lang === 'js') dummyName = 'index.js';
                else if (lang === 'html') dummyName = 'index.html';
                else if (lang === 'css') dummyName = 'style.css';
                else if (lang === 'python' || lang === 'py') dummyName = 'main.py';

                window.generatedFiles[dummyName] = decodedCode;
                if (window.renderPreviewTabs) window.renderPreviewTabs(window.generatedFiles);
                if (window.showFileContent) window.showFileContent(dummyName);
            } else {
                window.monacoEditorInstance.setValue(decodedCode);
            }
        } else {
            alert("Native Editor is not ready yet!");
        }
    } catch (e) { console.error("Failed to parse base64 code:", e); }
};

// =========================================================================
// PREMIUM INTERACTIVE CHAT ACTIONS
// =========================================================================
window.renderChatHistory = function () {
    const list = window.getEl('chat-history');
    if (!list) return;
    list.innerHTML = '';

    // Default system welcome message
    list.innerHTML = `
        <div class="chat-msg system">
            <div class="chat-bubble" style="background:transparent;border:none;color:var(--text-dim);font-size:10px;text-align:center">
                System Initialized. Ready for instructions.
            </div>
        </div>
    `;

    (window.chatHistory || []).forEach(m => {
        if (m.role !== 'system') {
            window.appendChatMessage(m.role, m.content, true);
        }
    });

    // Handle tool messages if any exist in DOM (they are not kept in array, or kept separately)
    setTimeout(window.scrollToBottom, 100);
};

window.clearChatHistory = function () {
    if (!confirm("Are you sure you want to clear the entire chat history?")) return;
    window.chatHistory = [];
    if (window.saveChatHistory) window.saveChatHistory();
    const list = window.getEl('chat-history');
    if (list) {
        list.innerHTML = `
            <div class="chat-msg system">
                <div class="chat-bubble" style="background:transparent;border:none;color:var(--text-dim);font-size:10px;text-align:center">
                    Chat history cleared.
                </div>
            </div>
        `;
    }
};

window._handleApprovalAction = function (action, btnContainer) {
    const inputEl = window.getEl('chat-input');
    if (!inputEl) return;

    // Disable all buttons in this container
    btnContainer.querySelectorAll('button').forEach(b => {
        b.disabled = true;
        b.style.opacity = '0.4';
        b.style.cursor = 'not-allowed';
    });

    // Highlight the clicked action
    const clickedBtn = btnContainer.querySelector(`[data-action="${action}"]`);
    if (clickedBtn) {
        clickedBtn.style.opacity = '1';
        clickedBtn.style.background = action === 'approve' ? '#10B981' : action === 'reject' ? '#EF4444' : '#F59E0B';
        clickedBtn.style.color = '#fff';
        clickedBtn.style.borderColor = 'transparent';
    }

    // Set appropriate response text
    const responses = {
        'approve': 'Approved, continue',
        'reject': 'No, cancel this',
        'modify': '',
        'debug': 'Debug this app now. Open the app in webview, take a screenshot, read DOM, check console logs, and report all errors found. If there are errors, fix them directly with smart_patch.',
        'test': 'Test this app end-to-end. Open the app in webview, screenshot, check console logs, test all buttons/features, and create a full report: what works, what fails, and improvement suggestions. When done, close the app.'
    };

    if (action === 'modify') {
        inputEl.focus();
        inputEl.placeholder = 'Describe the changes you want...';
        return;
    }

    inputEl.value = responses[action];
    setTimeout(() => {
        if (window.sendMessage) window.sendMessage();
    }, 150);
};

// =========================================================================
// TASK COMPLETE CONFIRMATION — Auto KB Publish on approval
// =========================================================================
window._handleTaskComplete = function (action, btnContainer) {
    // Disable all buttons
    btnContainer.querySelectorAll('button').forEach(b => {
        b.disabled = true;
        b.style.opacity = '0.4';
        b.style.cursor = 'not-allowed';
    });

    const clickedBtn = btnContainer.querySelector(`[data-action="${action}"]`);
    if (clickedBtn) {
        clickedBtn.style.opacity = '1';
        clickedBtn.style.color = '#fff';
        clickedBtn.style.borderColor = 'transparent';
        clickedBtn.style.background = action === 'confirm_done' ? '#10B981' : '#F59E0B';
    }

    if (action === 'confirm_done') {
        // User confirmed the task is complete!
        if (window.appendToolMessage) {
            window.appendToolMessage('System', 'success', '✅ User confirmed task is complete');
        }

        // ═══ FLAG: POST-TASK mode — suppress re-confirmation ═══
        window._isPostTaskRunning = true;

        // ═══ SILENT KB PUBLISH — Auto-generate and upload documentation ═══
        window._silentKBPublish();

        // ═══ AUTO-SAVE TO LOCAL MEMORY — Save task summary for future recall ═══
        window._autoSaveTaskToMemory();

        // ═══ SAVE CHAT HISTORY TO LOCAL FILE ═══
        window._saveChatToFile();

        // ═══ SILENT THANK YOU — No AI loop, just a clean message ═══
        setTimeout(() => {
            if (window.appendChatMessage) {
                window.appendChatMessage('agent', '✅ Great! Everything has been saved and documented.\n\n📦 Saved to: Memory (local) + KB (cloud) + Chat History\n\nThank you! Do you have another task for me?');
            }
            window._isPostTaskRunning = false;
            // Save final history
            if (window.saveChatHistory) window.saveChatHistory();
        }, 1500);

    } else if (action === 'need_fix') {
        // User wants changes
        const inputEl = window.getEl('chat-input');
        if (inputEl) {
            inputEl.focus();
            inputEl.placeholder = 'Describe what needs to be fixed...';
        }
    }
};

// ═══ SILENT KB PUBLISH — Checks for duplicates then publishes ═══
window._silentKBPublish = async function () {
    try {
        const appId = (window.getEl('input-app-name')?.value || window.currentAppId || '').trim();
        const outputType = window.getEl('select-output-type')?.value || 'app';
        const language = window.getEl('select-language')?.value || 'javascript';
        const isBrowserMode = outputType === 'browser' || window.activeAIMode === 'browser_automation';
        const hasFiles = Object.keys(window.generatedFiles || {}).length > 0;

        // In browser mode, we DON'T need files — generate from conversation
        if (!isBrowserMode && (!appId || !hasFiles)) {
            console.log('[KB Silent] No app ID or files (non-browser mode) — skipping KB publish');
            return;
        }

        // STEP 1: Check if article already exists in KB
        // For browser mode: use chat context keywords for search
        let searchQuery = appId ? appId.replace(/[-_]/g, ' ') : '';
        if (isBrowserMode && !searchQuery) {
            // Extract keywords from last AI messages
            const lastMsgs = (window.chatHistory || []).filter(m => m.role === 'agent').slice(-5);
            const chatText = lastMsgs.map(m => m.content || '').join(' ').toLowerCase();
            const keywords = [];
            if (chatText.includes('tiktok')) keywords.push('tiktok');
            if (chatText.includes('youtube')) keywords.push('youtube');
            if (chatText.includes('instagram')) keywords.push('instagram');
            if (chatText.includes('twitter') || chatText.includes('x.com')) keywords.push('twitter');
            if (chatText.includes('facebook')) keywords.push('facebook');
            if (chatText.includes('cookie')) keywords.push('cookies');
            if (chatText.includes('search') || chatText.includes('pencarian')) keywords.push('search');
            if (chatText.includes('download')) keywords.push('download');
            if (chatText.includes('upload')) keywords.push('upload');
            if (chatText.includes('login')) keywords.push('login');
            searchQuery = keywords.join(' ') || 'browser automation';
        }

        let articleExists = false;
        let existingArticleId = null;

        try {
            const searchRes = await fetch(`https://floworkos.com/api/v1/kb/search?q=${encodeURIComponent(searchQuery)}&limit=5`);
            const searchData = await searchRes.json();
            if (searchData.status === 'success' && searchData.results) {
                for (const result of searchData.results) {
                    const resultId = (result.id || '').toLowerCase();
                    const appIdLower = (appId || searchQuery).toLowerCase().replace(/\s+/g, '-');
                    if (resultId.includes(appIdLower) || resultId === appIdLower) {
                        articleExists = true;
                        existingArticleId = result.id;
                        break;
                    }
                }
            }
        } catch (e) {
            console.log('[KB Silent] Search failed, proceeding with publish:', e.message);
        }

        // STEP 2: If article already exists — skip
        if (articleExists) {
            console.log(`[KB Silent] Article already exists: ${existingArticleId} — skipping publish`);
            if (window.appendToolMessage) {
                window.appendToolMessage('KB', 'success', `📚 KB article already exists: ${existingArticleId}`);
            }
            return;
        }

        // STEP 3: Generate article
        let article = null;

        if (isBrowserMode) {
            // ═══ BROWSER MODE: Generate article from chat conversation ═══
            const agentMsgs = (window.chatHistory || []).filter(m => m.role === 'agent');
            const systemMsgs = (window.chatHistory || []).filter(m => m.role === 'system');
            const userMsgs = (window.chatHistory || []).filter(m => m.role === 'user');

            // Extract what was done from agent messages
            const allAgentText = agentMsgs.map(m => {
                try {
                    const actions = JSON.parse(m.content || '[]');
                    return actions.map(a => a.action + (a.message ? ': ' + a.message : '')).join('; ');
                } catch (e) { return m.content || ''; }
            }).join(' ');

            // Extract tool results from system messages
            const toolResults = systemMsgs.map(m => (m.content || '').substring(0, 200)).join(' ');

            // Detect what websites/tools were used
            const tags = ['browser', 'automation'];
            const detectors = {
                'tiktok': /tiktok/i, 'youtube': /youtube/i, 'instagram': /instagram/i,
                'twitter': /twitter|x\.com/i, 'cookies': /cookie/i, 'login': /login/i,
                'search': /search|pencarian/i, 'download': /download/i, 'upload': /upload/i,
                'scroll': /scroll/i, 'navigate': /navigate/i, 'video': /video/i
            };
            for (const [tag, rx] of Object.entries(detectors)) {
                if (rx.test(allAgentText) || rx.test(toolResults)) tags.push(tag);
            }

            // Build title from user request
            const userRequest = userMsgs.length > 0 ? (userMsgs[0].content || '').substring(0, 100) : 'Browser Task';
            const titleWords = userRequest.replace(/[^a-zA-Z0-9\s]/g, '').trim().split(/\s+/).slice(0, 6).join(' ');
            const title = 'Browser Automation: ' + (titleWords || 'Web Task');
            const articleId = 'browser-' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').substring(0, 50);

            // Extract actions taken
            const actionsTaken = [];
            for (const msg of agentMsgs) {
                try {
                    const actions = JSON.parse(msg.content || '[]');
                    for (const a of actions) {
                        if (a.action === 'chat' && a.message) continue;
                        let desc = a.action;
                        if (a.url) desc += ' → ' + a.url;
                        if (a.selector) desc += ' → ' + a.selector;
                        if (a.text) desc += ': "' + a.text.substring(0, 50) + '"';
                        actionsTaken.push(desc);
                    }
                } catch (e) { }
            }

            // Detect patterns used
            const keyPatterns = [];
            if (allAgentText.includes('import_cookies')) keyPatterns.push('Cookie import for bypass login');
            if (allAgentText.includes('navigate_browser')) keyPatterns.push('Direct URL navigation (bypasses UI interaction issues)');
            if (allAgentText.includes('execute_browser_script')) keyPatterns.push('JavaScript injection for complex interactions');
            if (allAgentText.includes('scroll_page')) keyPatterns.push('Page scrolling for content loading');
            if (allAgentText.includes('capture_browser')) keyPatterns.push('Screenshot capture for visual verification');
            if (allAgentText.includes('download_video')) keyPatterns.push('Video download extraction');
            if (allAgentText.includes('list_workspace')) keyPatterns.push('Workspace file check before asking user');

            // Detect errors that were resolved
            const commonErrors = [];
            if (toolResults.includes('Timeout waiting')) commonErrors.push('Timeout pada click_element/type_text — fallback ke execute_browser_script atau navigate_browser');
            if (toolResults.includes('0 success') && toolResults.includes('cookies')) commonErrors.push('Cookie import 0 success — gunakan fallback document.cookie via execute_browser_script');
            if (toolResults.includes('not found')) commonErrors.push('Selector not found — gunakan read_dom untuk cari selector yang benar');

            article = {
                id: articleId,
                title: title,
                category: 'browser',
                type: 'browser',
                language: 'javascript',
                tags: [...new Set(tags)],
                summary: 'Browser automation guide: ' + userRequest.substring(0, 150),
                architecture: 'Flowork Browser AI → open_browser_tab → ' + (tags.includes('cookies') ? 'import_cookies → ' : '') + 'navigate/interact → capture_browser → verify',
                key_patterns: keyPatterns.length > 0 ? keyPatterns : ['Browser tab management inside Flowork'],
                common_errors: commonErrors,
                files_structure: [],
                code_snippets: {},
                actions_taken: actionsTaken.slice(0, 20),
                article_body: '# ' + title + '\n\n' +
                    '## Tujuan\n' + userRequest + '\n\n' +
                    '## Langkah-langkah yang Dilakukan\n' + actionsTaken.slice(0, 15).map((a, i) => (i + 1) + '. ' + a).join('\n') + '\n\n' +
                    (keyPatterns.length > 0 ? '## Pola/Teknik yang Digunakan\n' + keyPatterns.map(p => '- ' + p).join('\n') + '\n\n' : '') +
                    (commonErrors.length > 0 ? '## Error yang Ditemukan dan Solusinya\n' + commonErrors.map(e => '- ⚠️ ' + e).join('\n') + '\n\n' : '') +
                    '## Tips\n- Selalu cek workspace/cookies/ sebelum minta user\n- Gunakan navigate_browser ke URL langsung jika UI interaction timeout\n- Capture screenshot sebelum dan sesudah setiap aksi penting'
            };

            console.log('[KB Silent] Generated browser article:', article.title, '(' + article.id + ')');
        } else if (window._kbGenerateArticle) {
            article = window._kbGenerateArticle(appId, outputType, window.generatedFiles, language);
        }

        if (!article || !article.id || !article.title) {
            console.log('[KB Silent] Could not generate article — skipping');
            return;
        }

        // STEP 4: Sanitize
        if (window._kbSanitize) article = window._kbSanitize(article);

        // STEP 4.5: SECURITY — Strip sensitive data before sending to cloud
        const _redactSecrets = (text) => {
            if (!text || typeof text !== 'string') return text;
            return text
                // API keys (generic patterns: sk-xxx, AIza-xxx, key-xxx, etc.)
                .replace(/\b(sk-[a-zA-Z0-9]{20,})\b/g, '<REDACTED_API_KEY>')
                .replace(/\b(AIza[a-zA-Z0-9_-]{30,})\b/g, '<REDACTED_GOOGLE_KEY>')
                .replace(/\b(xai-[a-zA-Z0-9]{20,})\b/g, '<REDACTED_XAI_KEY>')
                .replace(/\b(gsk_[a-zA-Z0-9]{20,})\b/g, '<REDACTED_GROQ_KEY>')
                .replace(/\b(ghp_[a-zA-Z0-9]{36,})\b/g, '<REDACTED_GITHUB_TOKEN>')
                .replace(/\b(Bearer\s+[a-zA-Z0-9._-]{20,})\b/g, 'Bearer <REDACTED>')
                // Passwords in common formats
                .replace(/(password|passwd|pwd|secret|token|apikey|api_key|auth_key)\s*[:=]\s*['"]?[^\s'"]{8,}/gi, '$1=<REDACTED>')
                // Email passwords
                .replace(/\b[a-z]{4}\s[a-z]{4}\s[a-z]{4}\s[a-z]{4}\b/gi, '<REDACTED_APP_PASSWORD>');
        };
        if (article.article_body) article.article_body = _redactSecrets(article.article_body);
        if (article.content) article.content = _redactSecrets(article.content);
        if (article.code_snippets) {
            for (const key of Object.keys(article.code_snippets)) {
                article.code_snippets[key] = _redactSecrets(article.code_snippets[key]);
            }
        }

        // STEP 5: Generate SEO body (only for non-browser, browser already has body)
        if (!isBrowserMode && window._kbGenerateArticleBody) {
            article.article_body = window._kbGenerateArticleBody(article);
        }

        // STEP 6: Publish silently (with retry)
        const publishBody = JSON.stringify({ article });
        const publishHeaders = { 'Content-Type': 'application/json' };

        let publishSuccess = false;
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const publishRes = await fetch('https://floworkos.com/api/v1/kb/publish', {
                    method: 'POST',
                    headers: publishHeaders,
                    body: publishBody
                });
                const publishData = await publishRes.json();

                if (publishData.status === 'success') {
                    console.log(`[KB Silent] ✨ Published: ${article.title} (v${publishData.version})`);
                    if (window.appendToolMessage) {
                        window.appendToolMessage('KB', 'success', `🧠 Documentation saved to Knowledge Base: "${article.title}"`);
                    }
                    publishSuccess = true;
                    break;
                } else {
                    console.error(`[KB Silent] ❌ Publish failed (attempt ${attempt + 1}):`, publishData.error);
                    if (attempt === 0) {
                        await new Promise(r => setTimeout(r, 1000)); // Wait 1s before retry
                    }
                }
            } catch (retryErr) {
                console.error(`[KB Silent] ❌ Fetch error (attempt ${attempt + 1}):`, retryErr.message);
                if (attempt === 0) {
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
        }

        if (!publishSuccess) {
            console.error('[KB Silent] ❌ All publish attempts failed');
            if (window.appendToolMessage) {
                window.appendToolMessage('KB', 'error', '❌ KB publish failed after 2 attempts');
            }
        }
    } catch (e) {
        console.error('[KB Silent] Error:', e.message);
    }
};

// ═══ AUTO-SAVE TASK TO LOCAL MEMORY ═══
// When user clicks "Looks Good ✅", save a summary of what was done to local memory (Go backend)
// This makes it searchable via memory_search for future tasks
window._autoSaveTaskToMemory = async function () {
    try {
        const history = window.chatHistory || [];
        const userMsgs = history.filter(m => m.role === 'user');
        const agentMsgs = history.filter(m => m.role === 'agent');

        if (userMsgs.length === 0) return;

        // Extract the original user request (first user message)
        const userRequest = (userMsgs[0]?.content || '').substring(0, 300);

        // Extract what the agent did (last few agent messages)
        const lastAgentMsgs = agentMsgs.slice(-5);
        let summary = '';
        for (const msg of lastAgentMsgs) {
            try {
                const actions = JSON.parse(msg.content || '[]');
                for (const a of actions) {
                    if (a.action === 'chat' && a.message) {
                        summary += a.message.substring(0, 200) + '\n';
                    } else if (a.action === 'write_files') {
                        summary += `Wrote files: ${Object.keys(a.files || {}).join(', ')}\n`;
                    } else if (a.action) {
                        summary += `Used tool: ${a.action}\n`;
                    }
                }
            } catch (e) {
                // Not JSON — just use raw text
                summary += (msg.content || '').substring(0, 200) + '\n';
            }
        }

        const appId = (window.getEl('input-app-name')?.value || window.currentAppId || '').trim();
        const outputType = window.getEl('select-output-type')?.value || 'app';

        const memoryContent = [
            `[TASK COMPLETED — ${new Date().toLocaleString()}]`,
            `User Request: ${userRequest}`,
            `App: ${appId || 'general'} (${outputType})`,
            `Summary: ${summary.substring(0, 500)}`,
            `Status: ✅ User confirmed — Looks Good`
        ].join('\n');

        const memoryTitle = `[Task] ${userRequest.substring(0, 80).replace(/\n/g, ' ')}`;

        const res = await fetch('http://127.0.0.1:5000/api/knowledge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: memoryTitle,
                content: memoryContent,
                category: 'task_history',
                tags: ['task', 'completed', appId, outputType].filter(Boolean)
            }),
            signal: AbortSignal.timeout(5000),
        });

        if (res.ok) {
            const data = await res.json();
            console.log(`[Memory] 🧠 Task saved to local memory: ${data.id}`);
            if (window.appendToolMessage) {
                window.appendToolMessage('Memory', 'success', `🧠 Task saved to local memory`);
            }
        } else {
            console.warn('[Memory] Save failed:', res.status);
        }
    } catch (e) {
        console.warn('[Memory] Auto-save failed:', e.message);
    }
};

window.appendChatMessage = function (role, content, image = null) {
    const historyEl = window.getEl('chat-history');
    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-msg ${role}`;

    // Detect control flags BEFORE rendering
    const msgUpper = (content || '').toUpperCase();
    const isWaiting = msgUpper.includes('[WAITING_APPROVAL]') || msgUpper.includes('[MENUNGGU_KONFIRMASI]');
    const isAuto = msgUpper.includes('[AUTO_CONTINUE]') || msgUpper.includes('[LANJUT_OTOMATIS]');
    let isTaskComplete = msgUpper.includes('[TASK_COMPLETE]') || msgUpper.includes('[TUGAS_SELESAI]');

    // ═══ SUPPRESS re-confirmation during POST-TASK ═══
    // After user already confirmed, FASE 5 runs silently — no second confirm widget
    if (isTaskComplete && window._isPostTaskRunning) {
        isTaskComplete = false; // Don't show widget again
        window._isPostTaskRunning = false; // Reset flag
        // Save final chat history
        window._saveChatToFile();
    }

    let displayContent = '';
    if (image) {
        displayContent += `<img src="${image}" style="max-width: 100%; max-height: 250px; object-fit: contain; border-radius: 6px; margin-bottom: 10px; border: 1px solid rgba(255,255,255,0.1);">`;
    }
    if (content) {
        displayContent += window.formatMarkdown(content);
    }

    let actionButtons = '';

    if (role === 'agent' && isTaskComplete) {
        // ═══ TASK COMPLETE — Confirmation widget with KB auto-publish ═══
        actionButtons = `
        <div class="approval-widget">
            <div class="approval-divider"></div>
            <div class="approval-label" style="color: #10B981;">
                <span class="approval-dot" style="background: #10B981;"></span>
                How does the result look?
            </div>
            <div class="approval-actions" id="task-confirm-${Date.now()}">
                <button class="approval-btn approve" data-action="confirm_done" onclick="window._handleTaskComplete('confirm_done', this.parentElement)" style="background: rgba(16,185,129,0.1);">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    Looks Good ✅
                </button>
                <button class="approval-btn modify" data-action="need_fix" onclick="window._handleTaskComplete('need_fix', this.parentElement)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    Needs Improvement 🔧
                </button>
            </div>
        </div>`;
    } else if (role === 'agent' && isWaiting) {
        // Premium approval widget
        actionButtons = `
        <div class="approval-widget">
            <div class="approval-divider"></div>
            <div class="approval-label">
                <span class="approval-dot"></span>
                AI is waiting for your decision
            </div>
            <div class="approval-actions" id="approval-${Date.now()}">
                <button class="approval-btn approve" data-action="approve" onclick="window._handleApprovalAction('approve', this.parentElement)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    Approve & Continue
                </button>
                <button class="approval-btn modify" data-action="modify" onclick="window._handleApprovalAction('modify', this.parentElement)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    Request Changes
                </button>
                <button class="approval-btn" data-action="debug" style="border-color:#F59E0B;color:#F59E0B;" onclick="window._handleApprovalAction('debug', this.parentElement)">
                    🔍 Debug App
                </button>
                <button class="approval-btn" data-action="test" style="border-color:#8B5CF6;color:#8B5CF6;" onclick="window._handleApprovalAction('test', this.parentElement)">
                    🧪 Test App
                </button>
                <button class="approval-btn reject" data-action="reject" onclick="window._handleApprovalAction('reject', this.parentElement)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    Cancel
                </button>
            </div>
        </div>`;
    } else if (role === 'agent' && isAuto) {
        // Subtle auto-continue indicator
        actionButtons = `
        <div class="auto-continue-badge">
            <span class="auto-dot"></span>
            Auto-executing next step...
        </div>`;
    }

    msgDiv.innerHTML = `<div class="chat-bubble">${displayContent}${actionButtons}</div>`;
    historyEl.appendChild(msgDiv);
    historyEl.scrollTop = historyEl.scrollHeight;
};

window.appendToolMessage = function (toolName, status, details) {
    if (typeof window.hideEmptyState === 'function') window.hideEmptyState();
    const historyEl = window.getEl('chat-history');
    const msgDiv = document.createElement('div');
    msgDiv.className = `chat-msg system`;

    let emoji = '❌';
    let contentColor = '#f87171';

    if (status === 'success') {
        emoji = '✅';
        contentColor = '#06d6a0';
    } else if (['running', 'executing', 'pending', 'in_progress'].includes(status)) {
        emoji = '⏳';
        contentColor = '#fbbf24';
    } else if (status === 'blocked') {
        emoji = '🛑';
    }

    msgDiv.innerHTML = `
        <div class="chat-bubble ephemeral-tool" style="background: rgba(14,21,40,0.6); border: 1px solid rgba(255,255,255,0.05); padding: 8px 10px; font-family: var(--font-mono, monospace);">
            <div style="font-size: 10px; color: #8a9ab5; margin-bottom: 4px; display:flex; justify-content: space-between; align-items:center;">
                <span style="font-weight:bold;">Action: <span style="color: #38bdf8;">${toolName}</span></span>
                <span style="font-size: 11px;">${emoji}</span>
            </div>
            ${details ? `<div style="font-size: 9.5px; color: ${contentColor}; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 6px; white-space: pre-wrap; word-break: break-all; opacity: 0.85;">${window.escapeHtml(details)}</div>` : ''}
        </div>
    `;

    msgDiv.style.transition = 'opacity 0.6s ease-out, transform 0.6s ease-out';
    msgDiv.style.opacity = '1';

    historyEl.appendChild(msgDiv);
    historyEl.scrollTop = historyEl.scrollHeight;

    // Auto-remove success/running bubbles faster to avoid chat clutter
    if (status !== 'error') {
        setTimeout(() => {
            msgDiv.style.opacity = '0';
            msgDiv.style.transform = 'translateY(-10px)';
            setTimeout(() => {
                if (msgDiv.parentNode) msgDiv.parentNode.removeChild(msgDiv);
            }, 600);
        }, 3500); // Wait 3.5 seconds before dismissing
    }
};

window.showLoader = function () {
    const historyEl = window.getEl('chat-history');
    const id = 'loader-' + Date.now();
    const loaderDiv = document.createElement('div');
    loaderDiv.className = `chat-msg agent`;
    loaderDiv.id = id;
    loaderDiv.innerHTML = `<div class="typing-indicator"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>`;
    historyEl.appendChild(loaderDiv);
    historyEl.scrollTop = historyEl.scrollHeight;
    return id;
};

window.removeLoader = function (id) {
    const loader = window.getEl(id);
    if (loader && loader.parentNode) loader.parentNode.removeChild(loader);
};

window.loadChatHistory = async function (appId) {
    const outputType = window.getEl('select-output-type') ? window.getEl('select-output-type').value : 'app';
    try {
        const res = await fetch(`http://127.0.0.1:5000/api/ai-chat/history?app_id=${appId}&output_type=${outputType}`);
        const data = await res.json();
        if (data.status === 'success' && data.history && data.history.length > 0) {
            window.chatHistory = data.history;
            const historyEl = window.getEl('chat-history');
            historyEl.innerHTML = `<div class="chat-msg agent"><div class="chat-bubble">Loaded previous history for <b>${appId}</b>.</div></div>`;

            window.chatHistory.forEach(msg => {
                if (msg.role === 'user') window.appendChatMessage('user', msg.content, msg.image);
                else if (msg.role === 'agent') {
                    try {
                        let json = JSON.parse(msg.content);
                        if (json.action === 'chat') window.appendChatMessage('agent', json.message);
                        // Tool executions are ephemeral, so we intentionally skip rendering them from history
                    } catch (e) { window.appendChatMessage('agent', msg.content); }
                }
            });
            setTimeout(() => historyEl.scrollTop = historyEl.scrollHeight, 100);
        } else {
            window.chatHistory = [];
            if (window.renderWelcomeScreen) {
                window.renderWelcomeScreen();
            } else {
                window.getEl('chat-history').innerHTML = `<div class="chat-msg agent"><div class="chat-bubble">Hello! I'm Flowork AI. What would you like to do today?</div></div>`;
            }
        }
    } catch (e) { console.error("History load error:", e); }
};

window.saveChatHistory = async function () {
    const appId = window.getEl('input-app-name').value.trim() || window.currentAppId;
    const outputType = window.getEl('select-output-type') ? window.getEl('select-output-type').value : 'app';

    // Save to Go backend (legacy backup)
    try {
        await fetch('http://127.0.0.1:5000/api/ai-chat/history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ app_id: appId, output_type: outputType, history: window.chatHistory })
        });
    } catch (e) { }

    // Save to local JSON using Node.js fs (portable — works in .exe)
    try {
        const nodeFs = window.originalNodeRequire ? window.originalNodeRequire('fs') : require('fs');
        const nodePath = window.originalNodeRequire ? window.originalNodeRequire('path') : require('path');
        const engineDir = nodePath.resolve(__dirname);

        if (!window._chatSessionId) {
            const now = new Date();
            const dateStr = now.toISOString().split('T')[0];
            const timeStr = now.toTimeString().substring(0, 5).replace(':', '-');
            window._chatSessionId = dateStr + '_' + timeStr + '_' + (appId || 'chat');
            window._chatStartedAt = now.toISOString();
        }

        const sessionDir = nodePath.join(engineDir, 'hystory-chat', window._chatSessionId);

        // Create directory if not exists
        if (!nodeFs.existsSync(sessionDir)) {
            nodeFs.mkdirSync(sessionDir, { recursive: true });
        }

        const messages = window.chatHistory || [];
        const chunkSize = 50;
        const totalChunks = Math.ceil(messages.length / chunkSize) || 1;

        // Save session_info.json
        nodeFs.writeFileSync(
            nodePath.join(sessionDir, 'session_info.json'),
            JSON.stringify({
                session_id: window._chatSessionId,
                app_id: appId,
                output_type: outputType,
                started_at: window._chatStartedAt || new Date().toISOString(),
                last_updated: new Date().toISOString(),
                total_messages: messages.length,
                total_chunks: totalChunks,
                status: window.isGenerating ? 'generating' : 'idle'
            }, null, 2),
            'utf-8'
        );

        // Save chunks
        for (let i = 0; i < totalChunks; i++) {
            const chunk = messages.slice(i * chunkSize, (i + 1) * chunkSize);
            const chunkNum = String(i + 1).padStart(3, '0');
            nodeFs.writeFileSync(
                nodePath.join(sessionDir, 'chunk_' + chunkNum + '.json'),
                JSON.stringify({ chunk_index: i, messages: chunk }, null, 2),
                'utf-8'
            );
        }

        console.log('[History] Saved to', sessionDir, '(' + messages.length + ' messages, ' + totalChunks + ' chunks)');
    } catch (e) {
        console.warn('[History] JSON save failed:', e.message);
    }
};

// ═══ SAVE CHAT TO LOCAL FILE ═══
// Saves conversation as .txt in ENGINE/hystory-chat/ folder
// Path is relative (portable) — uses IPC to get engine base path
window._saveChatToFile = async function () {
    try {
        const nodeFs = window.originalNodeRequire ? window.originalNodeRequire('fs') : require('fs');
        const nodePath = window.originalNodeRequire ? window.originalNodeRequire('path') : require('path');
        const engineDir = nodePath.resolve(__dirname);
        const appId = window.getEl('input-app-name').value.trim() || window.currentAppId || 'unknown';

        if (!window._chatSessionId) {
            const now = new Date();
            const dateStr = now.toISOString().split('T')[0];
            const timeStr = now.toTimeString().substring(0, 5).replace(':', '-');
            window._chatSessionId = dateStr + '_' + timeStr + '_' + appId;
        }

        const sessionDir = nodePath.join(engineDir, 'hystory-chat', window._chatSessionId);
        if (!nodeFs.existsSync(sessionDir)) {
            nodeFs.mkdirSync(sessionDir, { recursive: true });
        }

        // Save full conversation as JSON
        nodeFs.writeFileSync(
            nodePath.join(sessionDir, 'full_conversation.json'),
            JSON.stringify({
                session_id: window._chatSessionId,
                app_id: appId,
                exported_at: new Date().toISOString(),
                total_messages: (window.chatHistory || []).length,
                messages: window.chatHistory || []
            }, null, 2),
            'utf-8'
        );

        console.log('[History] Full conversation saved as JSON to', sessionDir);
    } catch (e) {
        console.warn('[History] Save to file failed:', e.message);
    }
};

// =========================================================================
// STREAMING BUBBLE — Real-time AI output visualization
// =========================================================================
window.createStreamingBubble = function () {
    const historyEl = window.getEl('chat-history');
    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-msg agent';
    const bubbleId = 'stream-' + Date.now();
    msgDiv.id = bubbleId;

    msgDiv.innerHTML = `
        <div class="chat-bubble stream-bubble">
            <div class="stream-content"></div>
            <span class="stream-cursor"></span>
        </div>
    `;
    historyEl.appendChild(msgDiv);
    historyEl.scrollTop = historyEl.scrollHeight;

    const contentEl = msgDiv.querySelector('.stream-content');
    let lastLength = 0;

    return {
        update: function (fullText) {
            // Show a readable preview of what's streaming
            // Since it's JSON, try to extract any readable text
            let display = fullText;

            // Try to extract chat messages from partial JSON for nicer preview
            const msgMatch = display.match(/"message"\s*:\s*"([^"]*)/);
            if (msgMatch) {
                display = msgMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
            } else {
                // Show raw but truncate if long
                if (display.length > 500) display = display.slice(-500);
            }

            contentEl.textContent = display;
            if (display.length !== lastLength) {
                historyEl.scrollTop = historyEl.scrollHeight;
                lastLength = display.length;
            }
        },
        finish: function () {
            const el = document.getElementById(bubbleId);
            if (el && el.parentNode) el.parentNode.removeChild(el);
        }
    };
};

// =========================================================================
// CHECKPOINT / UNDO SYSTEM — Roll back AI edits
// =========================================================================
window.fileCheckpoints = [];
window.MAX_CHECKPOINTS = 10;

window.createCheckpoint = function (action) {
    const snapshot = {
        timestamp: Date.now(),
        action: action || 'unknown',
        files: JSON.parse(JSON.stringify(window.generatedFiles))
    };
    window.fileCheckpoints.push(snapshot);

    // Keep only last N checkpoints to prevent memory bloat
    if (window.fileCheckpoints.length > window.MAX_CHECKPOINTS) {
        window.fileCheckpoints.shift();
    }

    // Update undo button state
    window.updateUndoButton();

    console.log(`[Checkpoint] Saved (${window.fileCheckpoints.length}/${window.MAX_CHECKPOINTS}) before '${action}'`);
};

window.restoreCheckpoint = function () {
    if (window.fileCheckpoints.length === 0) {
        if (window.appendToolMessage) window.appendToolMessage('Undo', 'error', 'No checkpoints available');
        return;
    }

    const snapshot = window.fileCheckpoints.pop();
    window.generatedFiles = snapshot.files;

    // Refresh the editor
    const fileKeys = Object.keys(window.generatedFiles);
    if (fileKeys.length > 0) {
        window.activeTab = fileKeys[0];
        if (window.renderPreviewTabs) window.renderPreviewTabs(window.generatedFiles);
        if (window.showFileContent) window.showFileContent(window.activeTab);
    }

    // Also write restored files back to disk
    const appId = window.getEl('input-app-name').value.trim() || window.currentAppId;
    const outputType = window.getEl('select-output-type') ? window.getEl('select-output-type').value : 'app';
    fetch('http://127.0.0.1:5000/api/ai-write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: appId, output_type: outputType, files: window.generatedFiles })
    }).catch(e => console.error('Failed to sync undo to disk:', e));

    window.updateUndoButton();

    if (window.appendToolMessage) {
        window.appendToolMessage('Undo', 'success', `Restored to checkpoint before '${snapshot.action}' (${new Date(snapshot.timestamp).toLocaleTimeString()})`);
    }
};

window.updateUndoButton = function () {
    const btn = window.getEl('btn-undo');
    if (btn) {
        const count = window.fileCheckpoints.length;
        btn.disabled = count === 0;
        btn.title = count > 0 ? `Undo (${count} checkpoints)` : 'No checkpoints';
        const badge = btn.querySelector('.undo-badge');
        if (badge) {
            badge.textContent = count;
            badge.style.display = count > 0 ? 'inline-flex' : 'none';
        }
    }
};

// =========================================================================
// PREMIUM WELCOME SCREEN — Action-based Mode Selection
// =========================================================================
window.renderWelcomeScreen = function () {
    const nativeState = document.getElementById('chat-empty-state');
    if (nativeState) {
        if (typeof window.showEmptyState === 'function') window.showEmptyState();
        return;
    }
    const historyEl = window.getEl('chat-history');
    if (!historyEl) return;

    historyEl.innerHTML = `
    <div class="welcome-screen" style="
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        padding: 30px 20px; gap: 20px; min-height: 60%; animation: fadeIn 0.4s ease;
    ">
        <div style="text-align: center; margin-bottom: 8px;">
            <div style="
                width: 60px; height: 60px; margin: 0 auto 12px;
                background: linear-gradient(135deg, #7C3AED, #3B82F6);
                border-radius: 16px; display: flex; align-items: center; justify-content: center;
                font-size: 1.8rem; box-shadow: 0 8px 25px rgba(124,58,237,0.3);
            ">🤖</div>
            <h2 style="
                margin: 0; font-size: 1.1rem; font-weight: 700; color: #E0E0E0;
                letter-spacing: 0.5px;
            ">What would you like to do?</h2>
            <p style="margin: 6px 0 0; font-size: 0.75rem; color: #666;">Choose a mode to get started — or just type in the chat</p>
        </div>

        <div class="welcome-grid" style="
            display: grid; grid-template-columns: 1fr 1fr; gap: 10px; width: 100%; max-width: 380px;
        ">
            <!-- BUILD APP -->
            <div class="welcome-card" onclick="window._showAppForm()" style="
                background: linear-gradient(145deg, rgba(16,185,129,0.08), rgba(16,185,129,0.02));
                border: 1px solid rgba(16,185,129,0.2); border-radius: 12px; padding: 16px 14px;
                cursor: pointer; transition: all 0.25s ease; text-align: center;
            " onmouseover="this.style.borderColor='#10B981';this.style.transform='translateY(-2px)';this.style.boxShadow='0 6px 20px rgba(16,185,129,0.15)'"
               onmouseout="this.style.borderColor='rgba(16,185,129,0.2)';this.style.transform='none';this.style.boxShadow='none'">
                <div style="font-size: 1.6rem; margin-bottom: 6px;">🔨</div>
                <div style="font-size: 0.85rem; font-weight: 600; color: #10B981;">Build App</div>
                <div style="font-size: 0.65rem; color: #666; margin-top: 3px;">Build a new application</div>
            </div>

            <!-- BUILD NODE -->
            <div class="welcome-card" onclick="window._selectMode('node','node_builder')" style="
                background: linear-gradient(145deg, rgba(124,58,237,0.08), rgba(124,58,237,0.02));
                border: 1px solid rgba(124,58,237,0.2); border-radius: 12px; padding: 16px 14px;
                cursor: pointer; transition: all 0.25s ease; text-align: center;
            " onmouseover="this.style.borderColor='#7C3AED';this.style.transform='translateY(-2px)';this.style.boxShadow='0 6px 20px rgba(124,58,237,0.15)'"
               onmouseout="this.style.borderColor='rgba(124,58,237,0.2)';this.style.transform='none';this.style.boxShadow='none'">
                <div style="font-size: 1.6rem; margin-bottom: 6px;">🧩</div>
                <div style="font-size: 0.85rem; font-weight: 600; color: #B794F6;">Build Node</div>
                <div style="font-size: 0.65rem; color: #666; margin-top: 3px;">Create workflow nodes</div>
            </div>

            <!-- BROWSER AUTOMATION -->
            <div class="welcome-card" onclick="window._selectMode('browser','browser_automation')" style="
                background: linear-gradient(145deg, rgba(59,130,246,0.08), rgba(59,130,246,0.02));
                border: 1px solid rgba(59,130,246,0.2); border-radius: 12px; padding: 16px 14px;
                cursor: pointer; transition: all 0.25s ease; text-align: center;
            " onmouseover="this.style.borderColor='#3B82F6';this.style.transform='translateY(-2px)';this.style.boxShadow='0 6px 20px rgba(59,130,246,0.15)'"
               onmouseout="this.style.borderColor='rgba(59,130,246,0.2)';this.style.transform='none';this.style.boxShadow='none'">
                <div style="font-size: 1.6rem; margin-bottom: 6px;">🌐</div>
                <div style="font-size: 0.85rem; font-weight: 600; color: #60A5FA;">Browser AI</div>
                <div style="font-size: 0.65rem; color: #666; margin-top: 3px;">Control browser & social media</div>
            </div>

            <!-- AI ASSISTANT -->
            <div class="welcome-card" onclick="window._selectMode('run_task','main')" style="
                background: linear-gradient(145deg, rgba(245,158,11,0.08), rgba(245,158,11,0.02));
                border: 1px solid rgba(245,158,11,0.2); border-radius: 12px; padding: 16px 14px;
                cursor: pointer; transition: all 0.25s ease; text-align: center;
            " onmouseover="this.style.borderColor='#F59E0B';this.style.transform='translateY(-2px)';this.style.boxShadow='0 6px 20px rgba(245,158,11,0.15)'"
               onmouseout="this.style.borderColor='rgba(245,158,11,0.2)';this.style.transform='none';this.style.boxShadow='none'">
                <div style="font-size: 1.6rem; margin-bottom: 6px;">🤖</div>
                <div style="font-size: 0.85rem; font-weight: 600; color: #FBBF24;">AI Assistant</div>
                <div style="font-size: 0.65rem; color: #666; margin-top: 3px;">Full power — all tools available</div>
            </div>
        </div>
    </div>`;
};

// Show app builder form with language picker
window._showAppForm = function () {
    const historyEl = window.getEl('chat-history');
    if (!historyEl) return;

    historyEl.innerHTML = `
    <div class="welcome-screen" style="
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        padding: 30px 20px; gap: 16px; min-height: 60%; animation: fadeIn 0.4s ease;
    ">
        <div style="text-align: center;">
            <div style="font-size: 2rem; margin-bottom: 8px;">🔨</div>
            <h2 style="margin: 0; font-size: 1rem; font-weight: 700; color: #10B981;">Build Application</h2>
            <p style="margin: 6px 0 0; font-size: 0.7rem; color: #666;">Choose a backend programming language</p>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; width: 100%; max-width: 340px;">
            <button onclick="window._selectApp('javascript')" class="lang-btn" style="
                background: rgba(245,158,11,0.06); border: 1px solid rgba(245,158,11,0.2);
                border-radius: 10px; padding: 14px 8px; cursor: pointer; transition: all 0.2s;
                display: flex; flex-direction: column; align-items: center; gap: 6px;
            " onmouseover="this.style.borderColor='#F59E0B';this.style.background='rgba(245,158,11,0.12)'"
               onmouseout="this.style.borderColor='rgba(245,158,11,0.2)';this.style.background='rgba(245,158,11,0.06)'">
                <span style="font-size: 1.5rem;">⚡</span>
                <span style="font-size: 0.75rem; font-weight: 600; color: #FBBF24;">Node.js</span>
            </button>
            <button onclick="window._selectApp('python')" class="lang-btn" style="
                background: rgba(59,130,246,0.06); border: 1px solid rgba(59,130,246,0.2);
                border-radius: 10px; padding: 14px 8px; cursor: pointer; transition: all 0.2s;
                display: flex; flex-direction: column; align-items: center; gap: 6px;
            " onmouseover="this.style.borderColor='#3B82F6';this.style.background='rgba(59,130,246,0.12)'"
               onmouseout="this.style.borderColor='rgba(59,130,246,0.2)';this.style.background='rgba(59,130,246,0.06)'">
                <span style="font-size: 1.5rem;">🐍</span>
                <span style="font-size: 0.75rem; font-weight: 600; color: #60A5FA;">Python</span>
            </button>
            <button onclick="window._selectApp('golang')" class="lang-btn" style="
                background: rgba(16,185,129,0.06); border: 1px solid rgba(16,185,129,0.2);
                border-radius: 10px; padding: 14px 8px; cursor: pointer; transition: all 0.2s;
                display: flex; flex-direction: column; align-items: center; gap: 6px;
            " onmouseover="this.style.borderColor='#10B981';this.style.background='rgba(16,185,129,0.12)'"
               onmouseout="this.style.borderColor='rgba(16,185,129,0.2)';this.style.background='rgba(16,185,129,0.06)'">
                <span style="font-size: 1.5rem;">🔷</span>
                <span style="font-size: 0.75rem; font-weight: 600; color: #34D399;">Golang</span>
            </button>
            <button onclick="window._selectApp('cpp')" class="lang-btn" style="
                background: rgba(139,92,246,0.06); border: 1px solid rgba(139,92,246,0.2);
                border-radius: 10px; padding: 14px 8px; cursor: pointer; transition: all 0.2s;
                display: flex; flex-direction: column; align-items: center; gap: 6px;
            " onmouseover="this.style.borderColor='#8B5CF6';this.style.background='rgba(139,92,246,0.12)'"
               onmouseout="this.style.borderColor='rgba(139,92,246,0.2)';this.style.background='rgba(139,92,246,0.06)'">
                <span style="font-size: 1.5rem;">⚙️</span>
                <span style="font-size: 0.75rem; font-weight: 600; color: #A78BFA;">C++</span>
            </button>
            <button onclick="window._selectApp('c')" class="lang-btn" style="
                background: rgba(99,102,241,0.06); border: 1px solid rgba(99,102,241,0.2);
                border-radius: 10px; padding: 14px 8px; cursor: pointer; transition: all 0.2s;
                display: flex; flex-direction: column; align-items: center; gap: 6px;
            " onmouseover="this.style.borderColor='#6366F1';this.style.background='rgba(99,102,241,0.12)'"
               onmouseout="this.style.borderColor='rgba(99,102,241,0.2)';this.style.background='rgba(99,102,241,0.06)'">
                <span style="font-size: 1.5rem;">🔧</span>
                <span style="font-size: 0.75rem; font-weight: 600; color: #818CF8;">C</span>
            </button>
            <button onclick="window._selectApp('ruby')" class="lang-btn" style="
                background: rgba(239,68,68,0.06); border: 1px solid rgba(239,68,68,0.2);
                border-radius: 10px; padding: 14px 8px; cursor: pointer; transition: all 0.2s;
                display: flex; flex-direction: column; align-items: center; gap: 6px;
            " onmouseover="this.style.borderColor='#EF4444';this.style.background='rgba(239,68,68,0.12)'"
               onmouseout="this.style.borderColor='rgba(239,68,68,0.2)';this.style.background='rgba(239,68,68,0.06)'">
                <span style="font-size: 1.5rem;">💎</span>
                <span style="font-size: 0.75rem; font-weight: 600; color: #F87171;">Ruby</span>
            </button>
        </div>

        <button onclick="window.renderWelcomeScreen()" style="
            background: none; border: none; color: #555; font-size: 0.7rem; cursor: pointer;
            padding: 6px 12px; transition: color 0.2s;
        " onmouseover="this.style.color='#999'" onmouseout="this.style.color='#555'">
            ← Back
        </button>
    </div>`;
};

// Select app language and start app builder mode
window._selectApp = function (lang) {
    const langSelect = window.getEl('select-language');
    const outputSelect = window.getEl('select-output-type');
    if (langSelect) langSelect.value = lang;
    if (outputSelect) outputSelect.value = 'app';

    // Set AI mode
    if (window.setAIMode) window.setAIMode('app_builder');
    if (window.saveConfigToEngine) window.saveConfigToEngine();

    // SWITCH TO IDE MODE — show Monaco + Terminal + Explorer
    if (window.showIDEMode) window.showIDEMode();

    // Clear welcome and show ready message
    const historyEl = window.getEl('chat-history');
    const langNames = { javascript: 'Node.js', python: 'Python', golang: 'Golang', cpp: 'C++', c: 'C', ruby: 'Ruby' };
    historyEl.innerHTML = '';
    if (window.appendChatMessage) {
        window.appendChatMessage('agent', `🔨 **App Builder Mode** activated!\n\nLanguage: **${langNames[lang] || lang}**\n\nDescribe the application you want to build. I will design the architecture, write code, and deploy it for you.`);
    }

    // Focus chat input
    const input = window.getEl('chat-input');
    if (input) { input.focus(); input.placeholder = 'Describe the application you want to build...'; }
};

// Select mode (non-app)
window._selectMode = function (outputType, aiMode) {
    const outputSelect = window.getEl('select-output-type');
    if (outputSelect) outputSelect.value = outputType;

    if (window.setAIMode) window.setAIMode(aiMode);
    if (window.saveConfigToEngine) window.saveConfigToEngine();

    // Node builder needs IDE — others stay in chat mode
    if (aiMode === 'node_builder') {
        if (window.showIDEMode) window.showIDEMode();
    } else {
        if (window.showChatMode) window.showChatMode();
    }

    const modeMessages = {
        'browser_automation': '🌐 **Browser AI Mode** activated!\n\nI can:\n- Open websites & navigate\n- Scroll, click, type\n- Download videos\n- Import cookies (bypass login)\n- Upload files to web\n- Auto sign up + email verification\n- Post content & articles\n\n📁 **File Manager** is active on the left panel — use it to manage video files, cookies, etc.\n\nWhat would you like to do?',
        'node_builder': '🧩 **Node Builder Mode** activated!\n\nI will help you create workflow nodes for the Flowork visual editor.\n\nDescribe the node you want to create.',
        'main': '🤖 **AI Assistant Mode** activated!\n\nAll capabilities available:\n- Build apps\n- Control browser\n- Create nodes\n- Manage system\n- Self-evolve\n\n📁 **File Manager** is active on the left panel.\n\nHow can I help you?'
    };

    const historyEl = window.getEl('chat-history');
    historyEl.innerHTML = '';
    if (window.appendChatMessage) {
        window.appendChatMessage('agent', modeMessages[aiMode] || 'Mode activated. What would you like to do?');
    }

    const input = window.getEl('chat-input');
    if (input) {
        input.focus();
        const placeholders = {
            'browser_automation': 'e.g., open TikTok and scroll...',
            'node_builder': 'e.g., create an email sender node...',
            'main': 'Ask me anything...'
        };
        input.placeholder = placeholders[aiMode] || 'Type a command...';
    }
};

// CSS animation for welcome screen
(function () {
    const style = document.createElement('style');
    style.textContent = `
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        .welcome-screen .welcome-card:active { transform: scale(0.97) !important; }
        .welcome-screen .lang-btn:active { transform: scale(0.95) !important; }
    `;
    document.head.appendChild(style);
})();