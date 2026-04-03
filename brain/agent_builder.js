// =========================================================================
// FLOWORK OS - NANO MODULAR ARCHITECTURE
// FILE: agent_builder.js (INDEX / ORCHESTRATOR)
// DESKRIPSI: Inisialisasi Aplikasi & DOM Event Listeners (Termasuk AI Kesadaran Error)
// =========================================================================

window.initApp = async function() {
    // 1. Inisialisasi Xterm.js Terminal
    try {
        const { Terminal } = window.originalNodeRequire ? window.originalNodeRequire('xterm') : require('xterm');
        const { FitAddon } = window.originalNodeRequire ? window.originalNodeRequire('xterm-addon-fit') : require('xterm-addon-fit');
        window.terminalInstance = new Terminal({
            theme: { background: '#000000', foreground: '#00FF00' },
            fontFamily: "'Consolas', 'Courier New', monospace",
            fontSize: 13,
            cursorBlink: true
        });
        window.fitAddon = new FitAddon();
        window.terminalInstance.loadAddon(window.fitAddon);
        window.terminalInstance.open(document.getElementById('terminal-view'));
        window.fitAddon.fit();

        window.terminalInstance.write('System Terminal Ready. Awaiting commands...\r\n$ ');

        let cmdBuffer = '';
        window.terminalInstance.onKey(e => {
            const printable = !e.domEvent.altKey && !e.domEvent.altGraphKey && !e.domEvent.ctrlKey && !e.domEvent.metaKey;

            if (e.domEvent.keyCode === 13) {
                window.terminalInstance.write('\r\n');
                if (cmdBuffer.trim() !== '') {
                    if(window.executeInteractiveCommand) window.executeInteractiveCommand(cmdBuffer);
                } else {
                    window.terminalInstance.write('$ ');
                }
                cmdBuffer = '';
            } else if (e.domEvent.keyCode === 8) {
                if (cmdBuffer.length > 0) {
                    window.terminalInstance.write('\b \b');
                    cmdBuffer = cmdBuffer.substring(0, cmdBuffer.length - 1);
                }
            } else if (printable) {
                cmdBuffer += e.key;
                window.terminalInstance.write(e.key);
            }
        });
    } catch(err) { console.warn("Xterm init failed:", err); }

    try {
        // 2. Mouse Wheel Scroll Horizontal untuk Tabs
        const previewTabsEl = window.getEl('preview-tabs');
        if (previewTabsEl) {
            previewTabsEl.addEventListener('wheel', (e) => {
                if (e.deltaY !== 0) {
                    e.preventDefault();
                    previewTabsEl.scrollLeft += e.deltaY;
                }
            }, { passive: false });
        }

        // 3. Inisialisasi Monaco Editor, Autosave & Auto-Heal Sensor
        const checkMonaco = setInterval(() => {
            if (window.isMonacoReady && window.monaco) {
                clearInterval(checkMonaco);

                // [KODE BARU - PERBAIKAN BUG 3] Menginjeksi CSS untuk Warna Highlight secara Otomatis ke DOM
                const style = document.createElement('style');
                style.innerHTML = `
                    .myLineHighlightClass { background: rgba(59, 130, 246, 0.3); border-radius: 2px; }
                    .myLineHighlightGutterClass { border-left: 4px solid #3B82F6; }
                `;
                document.head.appendChild(style);

                // Aktifkan Linter/Diagnostik agar muncul garis keriting merah (Bug 4)
                monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
                    noSemanticValidation: false,
                    noSyntaxValidation: false,
                });
                monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
                    target: monaco.languages.typescript.ScriptTarget.ES2020,
                    allowNonTsExtensions: true
                });

                // [BUG 4 FIX] Aktifkan JSON linter/diagnostics
                monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
                    validate: true,
                    allowComments: false,
                    schemaValidation: 'error',
                    trailingCommas: 'error'
                });

                window.monacoEditorInstance = window.monaco.editor.create(document.getElementById('code-view'), {
                    value: '// Welcome to Native Flowork IDE\n// Generated code will appear here automatically...',
                    language: 'javascript',
                    theme: 'vs-dark',
                    automaticLayout: true,
                    minimap: { enabled: true }
                });

                let autosaveTimeout;
                window.monacoEditorInstance.onDidChangeModelContent(() => {
                    if (!window.activeTab || window.activeTab === '__ROADMAP__') return;

                    const currentContent = window.monacoEditorInstance.getValue();
                    window.generatedFiles[window.activeTab] = currentContent;

                    clearTimeout(autosaveTimeout);
                    autosaveTimeout = setTimeout(async () => {
                        const appId = window.getEl('input-app-name').value.trim() || window.currentAppId;
                        const outputType = window.getEl('select-output-type') ? window.getEl('select-output-type').value : 'app';

                        let payloadFiles = {};
                        payloadFiles[window.activeTab] = currentContent;

                        try {
                            const res = await fetch('http://127.0.0.1:5000/api/ai-write', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    app_id: appId,
                                    output_type: outputType,
                                    files: payloadFiles
                                })
                            });

                            if(res.ok) {
                                const editorPanel = document.getElementById('panel-editor');
                                if (editorPanel) {
                                    editorPanel.style.borderTop = '2px solid #10B981';
                                    setTimeout(() => editorPanel.style.borderTop = 'none', 800);
                                }
                            }
                        } catch (e) {
                            console.error("Autosave Failed:", e);
                            const editorPanel = document.getElementById('panel-editor');
                            if (editorPanel) editorPanel.style.borderTop = '2px solid #EF4444';
                        }
                    }, 1000);
                });

                // FIX BUG 4: SENSOR AUTO-HEAL (Kesadaran AI terhadap Linter) + Problems Panel Update
                let errorHealTimeout;
                window.monaco.editor.onDidChangeMarkers(([uri]) => {
                    if (!window.monacoEditorInstance || !window.activeTab) return;

                    const markers = window.monaco.editor.getModelMarkers({ resource: uri });
                    const errors = markers.filter(m => m.severity === window.monaco.MarkerSeverity.Error);
                    const warnings = markers.filter(m => m.severity === window.monaco.MarkerSeverity.Warning);

                    // [BUG 4 FIX] Update Problems Panel & Badge
                    const problemsBadge = document.getElementById('problems-badge');
                    const problemsList = document.getElementById('problems-list');
                    const totalProblems = errors.length + warnings.length;

                    if (problemsBadge) {
                        problemsBadge.innerText = totalProblems > 0 ? totalProblems : '';
                        problemsBadge.style.display = totalProblems > 0 ? 'inline-flex' : 'none';
                    }
                    const btnAutoFix = document.getElementById('btn-auto-fix');
                    if (btnAutoFix) {
                        btnAutoFix.style.display = errors.length > 0 ? 'inline-block' : 'none';
                    }

                    if (problemsList) {
                        if (totalProblems === 0) {
                            problemsList.innerHTML = '<div style="color:#666; text-align:center; padding:20px; font-size:0.8rem;">No problems detected ✅</div>';
                        } else {
                            problemsList.innerHTML = markers
                                .filter(m => m.severity >= window.monaco.MarkerSeverity.Warning)
                                .map(m => {
                                    const isErr = m.severity === window.monaco.MarkerSeverity.Error;
                                    const icon = isErr ? '❌' : '⚠️';
                                    const color = isErr ? '#EF4444' : '#F59E0B';
                                    return `<div class="problem-item" style="border-left-color:${color}" onclick="if(window.monacoEditorInstance) window.monacoEditorInstance.revealLineInCenter(${m.startLineNumber})">
                                        <span>${icon}</span>
                                        <span style="color:${color}; font-weight:600;">Ln ${m.startLineNumber}</span>
                                        <span>${window.escapeHtml ? window.escapeHtml(m.message) : m.message}</span>
                                    </div>`;
                                }).join('');
                        }
                    }

                    // [BUG 1 FIX] Auto-Heal with cooldown & max retries
                    clearTimeout(errorHealTimeout);
                    if (errors.length > 0) {
                        errorHealTimeout = setTimeout(() => {
                            const now = Date.now();
                            if (window.lastAutoHealTime === undefined) window.lastAutoHealTime = 0;
                            if (window.autoHealCooldownMs === undefined) window.autoHealCooldownMs = 15000;
                            if (window.autoHealMaxRetries === undefined) window.autoHealMaxRetries = 3;
                            if (window.autoHealCount === undefined) window.autoHealCount = 0;

                            const cooldownOk = (now - window.lastAutoHealTime) > window.autoHealCooldownMs;
                            const retriesOk = window.autoHealCount < window.autoHealMaxRetries;

                            if (!window.isGenerating && cooldownOk && retriesOk) {
                                window.autoHealCount++;
                                window.lastAutoHealTime = now;

                                const errorMsgs = errors.map(e => `Line ${e.startLineNumber}: ${e.message}`).join('\n');
                                const currentFileContent = window.generatedFiles[window.activeTab] || '[File not in memory — use read_file]';
                                const appId = window.getEl('input-app-name').value.trim() || window.currentAppId;
                                const attemptNum = window.autoHealCount;
                                const maxAttempts = window.autoHealMaxRetries;

                                // Adaptive strategy based on attempt number
                                let strategyHint = '';
                                if (attemptNum === 1) {
                                    strategyHint = `STRATEGY (Attempt 1/${maxAttempts}): Use 'smart_patch' with exact line numbers to fix the syntax error. Read the file content below carefully to find the correct lines.`;
                                } else if (attemptNum === 2) {
                                    strategyHint = `STRATEGY (Attempt 2/${maxAttempts}): Previous patch attempt likely failed or introduced new issues. Do NOT retry the same approach. Instead: read the full file first, then use 'write_files' to rewrite the ENTIRE file cleanly from scratch with all syntax fixed.`;
                                } else {
                                    strategyHint = `STRATEGY (Final Attempt ${attemptNum}/${maxAttempts}): All incremental fixes have failed. You MUST: 1) delete_file the broken file, 2) write_files a completely fresh clean version, 3) save_knowledge the anti-pattern so this never happens again, 4) use [WAITING_APPROVAL] if the rewrite also fails.`;
                                }

                                const healPrompt = `[AUTO-HEAL TRIGGER ${attemptNum}/${maxAttempts}] — App: ${appId} — File: ${window.activeTab}

LINTER ERRORS DETECTED:
${errorMsgs}

${strategyHint}

CURRENT FILE CONTENT (what's actually in memory right now):
\`\`\`
${currentFileContent.substring(0, 4000)}${currentFileContent.length > 4000 ? '\n... [TRUNCATED — use read_file to see full content]' : ''}
\`\`\`

CRITICAL RULES FOR THIS HEAL SESSION:
1. First call 'list_knowledge' to check if this error pattern was seen before
2. Do NOT use patch_file if the string might have whitespace differences — use smart_patch with line numbers
3. After applying any fix, call 'read_file' to VERIFY the fix was actually applied correctly
4. If you see duplicate function definitions (e.g., two def main()) — delete the file and rewrite entirely
5. Do NOT declare success without re-reading the file to confirm it's clean`;


                                if(window.appendToolMessage) window.appendToolMessage('Auto-Heal Sensor', 'error', `Syntax error detected in ${window.activeTab}. Auto-Heal attempt ${window.autoHealCount}/${window.autoHealMaxRetries}...`);

                                window.chatHistory.push({ role: 'user', content: healPrompt });
                                if(window.saveChatHistory) window.saveChatHistory();

                                const provider = window.getEl('select-provider').value;
                                const apiKey = window.getEl('input-api-key').value.trim();
                                const language = window.getEl('select-language').value;


                                window.isGenerating = true;
                                let loaderId = null;
                                if(window.showLoader) loaderId = window.showLoader();

                                window.agentTick(provider, apiKey, (window.getEl('select-output-type') ? window.getEl('select-output-type').value : 'app'), appId, language, 0).catch(err => {
                                    console.error("Auto-Heal crashed:", err);
                                }).finally(() => {
                                    window.isGenerating = false;
                                    if(window.removeLoader && loaderId) window.removeLoader(loaderId);
                                });
                            } else if (!retriesOk) {
                                if(window.appendToolMessage) window.appendToolMessage('Auto-Heal Sensor', 'error', `Max auto-heal retries reached (${window.autoHealMaxRetries}). Please fix manually or ask AI in chat.`);
                            }
                        }, 5000);
                    }
                });
            }
        }, 100);

        window.addEventListener('resize', () => {
            if(window.fitAddon) window.fitAddon.fit();
        });

        // 4. Load Dictionary & Configs
        try {
            const response = await fetch('./brain/i18n.json');
            window.dictionary = await response.json();
        } catch (e) { console.warn("Failed to load i18n.json"); }

        const urlParams = new URLSearchParams(window.location.search);
        window.currentLang = urlParams.get('lang') || 'en';

        if(window.loadConfigFromEngine) await window.loadConfigFromEngine();

        // 5. Inisialisasi Variabel Input Proyek
        const appInput = window.getEl('input-app-name');
        if (appInput) {
            if (!appInput.value) appInput.value = window.currentAppId;
            if(window.loadChatHistory) window.loadChatHistory(window.currentAppId);

            appInput.addEventListener('change', (e) => {
                const val = e.target.value.trim();
                if (val) {
                    window.currentAppId = val;
                    if(window.loadChatHistory) window.loadChatHistory(window.currentAppId);
                }
            });
        }

        // 6. UI Action Event Listeners
        const btnClear = window.getEl('btn-clear-chat');
        if (btnClear) {
            btnClear.addEventListener('click', () => {
                window.chatHistory = [];
                if (window.renderWelcomeScreen) {
                    window.renderWelcomeScreen();
                } else {
                    window.getEl('chat-history').innerHTML = `<div class="chat-msg agent"><div class="chat-bubble">Conversation cleared. Started a fresh thread! 🚀</div></div>`;
                }
                if(window.saveChatHistory) window.saveChatHistory();
            });
        }

        const btnToggleKey = window.getEl('btn-toggle-key');
        if(btnToggleKey) {
            btnToggleKey.addEventListener('click', () => {
                const input = window.getEl('input-api-key');
                input.type = input.type === 'password' ? 'text' : 'password';
            });
        }

        const chatInput = window.getEl('chat-input');
        if(chatInput) {
            chatInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if(window.sendMessage) window.sendMessage();
                }
            });
        }

        document.body.addEventListener('click', (e) => {
            const actionTarget = e.target.closest('[data-flowork-action]');
            if (!actionTarget) return;

            const action = actionTarget.getAttribute('data-flowork-action');

            if (action === 'sendMessage') {
                if(window.sendMessage) window.sendMessage();
            }
            else if (action === 'toggleSettings') {
                const content = window.getEl('settings-content');
                const chevron = window.getEl('settings-chevron');
                if (content.classList.contains('open')) {
                    content.classList.remove('open');
                    chevron.innerText = '▼';
                } else {
                    content.classList.add('open');
                    chevron.innerText = '▲';
                }
            }
        });

        // 7. Event Listener Gambar & Clipboard
        document.addEventListener('paste', (e) => {
            const items = (e.clipboardData || e.originalEvent.clipboardData).items;
            for (let index in items) {
                const item = items[index];
                if (item.kind === 'file' && item.type.startsWith('image/')) {
                    const blob = item.getAsFile();
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        window.pendingImageAttachment = ev.target.result;
                        const previewContainer = window.getEl('chat-image-preview');
                        const previewImg = window.getEl('chat-image-img');
                        if (previewImg && previewContainer) {
                            previewImg.src = window.pendingImageAttachment;
                            previewContainer.style.display = 'block';
                        }
                    };
                    reader.readAsDataURL(blob);
                    e.preventDefault();
                }
            }
        });

        const fileInput = window.getEl('chat-image-upload');
        const attachBtn = window.getEl('btn-attach');
        const previewContainer = window.getEl('chat-image-preview');
        const previewImg = window.getEl('chat-image-img');
        const removeBtn = window.getEl('chat-image-remove');

        if (attachBtn && fileInput) {
            attachBtn.addEventListener('click', () => fileInput.click());

            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                
                if (file.type.startsWith('image/')) {
                    // Image files → show preview + base64
                    reader.onload = (ev) => {
                        window.pendingImageAttachment = ev.target.result;
                        previewImg.src = window.pendingImageAttachment;
                        previewContainer.style.display = 'block';
                    };
                    reader.readAsDataURL(file);
                } else {
                    // Non-image: read as text and inject into chat input
                    reader.onload = (ev) => {
                        const content = ev.target.result;
                        const chatInput = window.getEl('chat-input');
                        const truncated = content.length > 8000 ? content.substring(0, 8000) + '\n... [TRUNCATED]' : content;
                        if (chatInput) {
                            const existing = chatInput.value;
                            chatInput.value = (existing ? existing + '\n\n' : '') + 
                                `[Attached File: ${file.name}]\n\`\`\`\n${truncated}\n\`\`\``;
                            chatInput.style.height = 'auto';
                            chatInput.style.height = Math.min(chatInput.scrollHeight, 200) + 'px';
                        }
                        // Show confirmation in preview
                        previewContainer.style.display = 'block';
                        previewImg.style.display = 'none';
                        previewContainer.innerHTML = `
                            <div style="padding: 6px 10px; display: flex; align-items: center; gap: 6px; font-size: 0.75rem; color: #B794F6;">
                                📎 ${file.name} (${(file.size/1024).toFixed(1)}KB)
                            </div>
                            <span id="chat-image-remove" style="position: absolute; top: -8px; right: -8px; background: #EF4444; color: white; border-radius: 50%; width: 20px; height: 20px; font-size: 12px; text-align: center; cursor: pointer; line-height: 18px; font-weight: bold; border: 2px solid #1e1e1e;" onclick="this.parentElement.style.display='none'; document.getElementById('chat-image-upload').value=''">X</span>
                        `;
                    };
                    reader.readAsText(file);
                }
            });
        }

        if (removeBtn) {
            removeBtn.addEventListener('click', () => {
                window.pendingImageAttachment = null;
                if(previewContainer) previewContainer.style.display = 'none';
                if(fileInput) fileInput.value = '';
            });
        }

    } catch (err) { console.error('Failed to boot Agentic Builder UI events:', err); }
};

// =========================================================================
// MANUAL HEAL EXECUTOR
// =========================================================================
window.triggerManualHeal = function() {
    if (!window.monacoEditorInstance || !window.activeTab || window.isGenerating) return;
    
    const uri = window.monacoEditorInstance.getModel().uri;
    const markers = window.monaco.editor.getModelMarkers({ resource: uri });
    const errors = markers.filter(m => m.severity === window.monaco.MarkerSeverity.Error);
    
    if (errors.length === 0) return alert("No syntax errors to fix!");
    
    const errorMsgs = errors.map(e => `Line ${e.startLineNumber}: ${e.message}`).join('\n');
    const appId = window.getEl('input-app-name').value.trim() || window.currentAppId;
    const currentFileContent = window.generatedFiles[window.activeTab] || '[File not in memory — use read_file]';

    const healPrompt = `[MANUAL HEAL TRIGGER] — App: ${appId} — File: ${window.activeTab}

LINTER ERRORS DETECTED:
${errorMsgs}

STRATEGY: This is a user-initiated manual heal. 
1. First call 'list_knowledge' to check if this error was seen before
2. Read the file content below and identify the root cause
3. Use 'smart_patch' with exact line numbers OR 'write_files' for full clean rewrite
4. After fix: call 'read_file' to confirm the result is correct
5. If you see duplicate functions (two def main(), etc.) → delete file + rewrite entirely

CURRENT FILE CONTENT:
\`\`\`
${currentFileContent.substring(0, 5000)}${currentFileContent.length > 5000 ? '\n... [TRUNCATED — use read_file to see full content]' : ''}
\`\`\``;

    if(window.appendToolMessage) window.appendToolMessage('Auto-Heal Sensor', 'error', `Manual Auto-Heal triggered for ${window.activeTab}...`);

    window.chatHistory.push({ role: 'user', content: healPrompt });
    if(window.saveChatHistory) window.saveChatHistory();
    if(window.appendChatMessage) window.appendChatMessage('user', `🔴 Manual Heal triggered for ${window.activeTab} (${errors.length} error${errors.length > 1 ? 's' : ''})`);

    const provider = window.getEl('select-provider').value;
    const apiKey = window.getEl('input-api-key').value.trim();
    const language = window.getEl('select-language').value;

    window.isGenerating = true;
    let loaderId = null;
    if(window.showLoader) loaderId = window.showLoader();

    window.agentTick(provider, apiKey, (window.getEl('select-output-type') ? window.getEl('select-output-type').value : 'app'), appId, language, 0).catch(err => {
        console.error("Auto-Heal crashed:", err);
    }).finally(() => {
        window.isGenerating = false;
        if(window.removeLoader && loaderId) window.removeLoader(loaderId);
    });
};


// =========================================================================
// BOOTSTRAP OS
// =========================================================================
function _bootstrapFloworkApp() {
    if(window.initApp) window.initApp();
    if (window.loadFileSystem) window.loadFileSystem();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _bootstrapFloworkApp);
} else {
    _bootstrapFloworkApp();
}