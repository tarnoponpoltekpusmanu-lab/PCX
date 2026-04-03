// =========================================================================
// FLOWORK OS - NANO MODULAR ARCHITECTURE
// FILE: agent_file_manager.js
// DESKRIPSI: File Manager Panel — Manage workspace files (videos, cookies, etc.)
//            Used by AI to pick files for upload, delete after use, etc.
// =========================================================================

const fmFs = window.originalNodeRequire ? window.originalNodeRequire('fs') : require('fs');
const fmPath = window.originalNodeRequire ? window.originalNodeRequire('path') : require('path');

// ─── FILE MANAGER STATE ─────────────────────────────────────────────
window._fmCurrentPath = '';
window._fmFiles = [];
window._fmBasePath = ''; // Will be resolved on init
window._fmDragSource = null; // Currently dragged file

// ─── RESOLVE WORKSPACE PATH ─────────────────────────────────────────
window._fmResolveBasePath = function() {
    const engineDir = __dirname || '.';
    const workspaceDir = fmPath.join(engineDir, 'workspace');
    
    try {
        const isNew = !fmFs.existsSync(workspaceDir);
        if (isNew) {
            fmFs.mkdirSync(workspaceDir, { recursive: true });
            console.log('[FileManager] Created workspace dir:', workspaceDir);
        }
        window._fmBasePath = workspaceDir;

        // Create default sub-folders
        const defaultFolders = ['cookies', 'video', 'musik', 'media', 'file', 'images'];
        for (const folder of defaultFolders) {
            const folderPath = fmPath.join(workspaceDir, folder);
            if (!fmFs.existsSync(folderPath)) {
                fmFs.mkdirSync(folderPath, { recursive: true });
                console.log('[FileManager] Created default folder:', folder);
            }
        }
    } catch(e) {
        console.warn('[FileManager] Cannot create workspace dir, falling back to tree API');
        window._fmBasePath = '';
    }
    return window._fmBasePath;
};

// ─── FILE ICON MAPPER ────────────────────────────────────────────────
window._fmGetIcon = function(name) {
    const ext = (name || '').split('.').pop().toLowerCase();
    const icons = {
        mp4: '🎬', webm: '🎬', avi: '🎬', mkv: '🎬', mov: '🎬',
        mp3: '🎵', wav: '🎵', ogg: '🎵', flac: '🎵',
        png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', webp: '🖼️', svg: '🖼️', ico: '🖼️',
        txt: '📄', json: '📄', csv: '📄', xml: '📄', log: '📄',
        py: '🐍', js: '⚡', ts: '⚡', go: '🔷', rb: '💎',
        html: '🌐', css: '🎨',
        zip: '📦', tar: '📦', gz: '📦', rar: '📦',
        cookie: '🍪', cookies: '🍪',
        exe: '⚙️', msi: '⚙️',
        pdf: '📕',
    };
    return icons[ext] || '📄';
};

window._fmFormatSize = function(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
    return bytes.toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
};

window._fmGetCategory = function(name) {
    const ext = (name || '').split('.').pop().toLowerCase();
    if (['mp4','webm','avi','mkv','mov'].includes(ext)) return 'video';
    if (['mp3','wav','ogg','flac'].includes(ext)) return 'audio';
    if (['png','jpg','jpeg','gif','webp','svg','ico'].includes(ext)) return 'image';
    if (['cookie','cookies'].includes(ext) || (ext === 'txt' && name.toLowerCase().includes('cookie'))) return 'cookie';
    return 'other';
};

// ─── READ DIRECTORY USING NODE.JS FS ─────────────────────────────────
window._fmReadDir = function(dirPath) {
    const files = [];
    try {
        const entries = fmFs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = fmPath.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                let childCount = 0;
                try { childCount = fmFs.readdirSync(fullPath).length; } catch(e) {}
                files.push({ name: entry.name, path: fullPath, is_dir: true, children_count: childCount });
            } else {
                let size = 0;
                try { size = fmFs.statSync(fullPath).size; } catch(e) {}
                files.push({ name: entry.name, path: fullPath, is_dir: false, size: size });
            }
        }
    } catch(e) {
        console.warn('[FileManager] readdirSync failed:', e.message);
    }
    return files;
};

// ─── RENDER BREADCRUMB ───────────────────────────────────────────────
window._fmRenderBreadcrumb = function() {
    const container = document.getElementById('fm-path-bar');
    if (!container) return;

    const basePath = window._fmBasePath;
    const currentPath = window._fmCurrentPath || basePath;

    // Build breadcrumb segments
    let relativePath = currentPath.replace(basePath, '').replace(/\\/g, '/');
    if (relativePath.startsWith('/')) relativePath = relativePath.substring(1);
    if (relativePath.endsWith('/')) relativePath = relativePath.slice(0, -1);

    const segments = relativePath ? relativePath.split('/') : [];

    let html = '';

    // Root "workspace" link — always first
    const rootEscaped = basePath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const isAtRoot = !relativePath;
    html += `<span class="fm-crumb${isAtRoot ? ' fm-crumb-active' : ''}" onclick="window.refreshFileManager('${rootEscaped}')" 
        style="cursor:pointer; color:${isAtRoot ? '#B794F6' : '#7C3AED'}; font-weight:${isAtRoot ? '700' : '500'}; transition: color 0.15s;"
        onmouseover="this.style.color='#B794F6'" onmouseout="this.style.color='${isAtRoot ? '#B794F6' : '#7C3AED'}'">📂 workspace</span>`;

    // Build each tier
    let cumPath = basePath;
    for (let i = 0; i < segments.length; i++) {
        cumPath = fmPath.join(cumPath, segments[i]);
        const escaped = cumPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const isLast = (i === segments.length - 1);
        html += `<span style="color: #333; margin: 0 3px;">›</span>`;
        html += `<span class="fm-crumb${isLast ? ' fm-crumb-active' : ''}" onclick="window.refreshFileManager('${escaped}')"
            style="cursor:pointer; color:${isLast ? '#E0E0E0' : '#888'}; font-weight:${isLast ? '600' : '400'}; transition: color 0.15s;"
            onmouseover="this.style.color='#B794F6'" onmouseout="this.style.color='${isLast ? '#E0E0E0' : '#888'}'">${segments[i]}</span>`;
    }

    container.innerHTML = html;
};

// ─── RENDER FILE LIST ────────────────────────────────────────────────
window._fmRenderFileList = function(files, displayPath) {
    const container = document.getElementById('fm-file-list');
    if (!container) return;

    window._fmFiles = files || [];

    // Update breadcrumb
    window._fmRenderBreadcrumb();

    if (!files || files.length === 0) {
        container.innerHTML = `
        <div style="color: #444; text-align: center; padding: 40px 10px; font-size: 0.8rem;">
            <div style="font-size: 2.5rem; margin-bottom: 12px; opacity: 0.3;">📂</div>
            <div style="color: #555; margin-bottom: 6px;">Folder kosong</div>
            <div style="color: #333; font-size: 0.7rem;">Drag & drop file atau klik <span style="color: #34D399;">＋ Add</span></div>
        </div>`;
        document.getElementById('fm-file-count').textContent = '0 files';
        document.getElementById('fm-total-size').textContent = '0 B';
        return;
    }

    const folders = files.filter(f => f.is_dir);
    const regularFiles = files.filter(f => !f.is_dir);

    let totalSize = 0;
    regularFiles.forEach(f => totalSize += (f.size || 0));

    let html = '';

    // ── FOLDERS ──
    for (const folder of folders) {
        html += `
        <div class="fm-item fm-folder" data-path="${folder.path}" data-isdir="true" draggable="false"
            ondragover="window._fmFolderDragOver(event, this)"
            ondragleave="window._fmFolderDragLeave(event, this)"
            ondrop="window._fmFolderDrop(event, this, '${folder.path.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')"
            onclick="window.refreshFileManager('${folder.path.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')"
            oncontextmenu="event.preventDefault(); window._fmCopyPath('${folder.path.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')"
            style="
                display: flex; align-items: center; gap: 8px; padding: 7px 10px;
                border-radius: 6px; cursor: pointer; transition: all 0.15s ease;
                border: 1px solid transparent; margin-bottom: 2px; user-select: none;
            ">
            <span style="font-size: 1.1rem;">📂</span>
            <span style="flex:1; color: #B794F6; font-weight: 600; font-size: 0.8rem;">${folder.name}</span>
            <span style="font-size: 0.6rem; color: #555; background: rgba(255,255,255,0.04); padding: 1px 6px; border-radius: 8px;">${folder.children_count || 0}</span>
        </div>`;
    }

    // ── FILES ──
    for (const file of regularFiles) {
        const icon = window._fmGetIcon(file.name);
        const size = window._fmFormatSize(file.size);
        const cat = window._fmGetCategory(file.name);
        const catColors = { video: '#3B82F6', audio: '#F59E0B', image: '#10B981', cookie: '#EF4444', other: '#666' };
        const catColor = catColors[cat] || '#666';

        html += `
        <div class="fm-item fm-file" data-path="${file.path}" data-isdir="false" draggable="true"
            ondragstart="window._fmDragStart(event, '${file.path.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')"
            ondragend="window._fmDragEnd(event)"
            oncontextmenu="event.preventDefault(); window._fmCopyPath('${file.path.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')"
            style="
                display: flex; align-items: center; gap: 8px; padding: 7px 10px;
                border-radius: 6px; cursor: grab; transition: all 0.15s ease;
                border: 1px solid transparent; margin-bottom: 2px; user-select: none;
            ">
            <span style="font-size: 1.1rem;">${icon}</span>
            <div style="flex:1; min-width:0;">
                <div style="font-size: 0.78rem; color: #E0E0E0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${file.name}">${file.name}</div>
                <div style="font-size: 0.58rem; color: ${catColor}; display: flex; gap: 5px; align-items: center; margin-top: 1px;">
                    <span>${size}</span>
                    <span style="opacity:0.3;">•</span>
                    <span style="text-transform: uppercase; letter-spacing: 0.5px;">${cat}</span>
                </div>
            </div>
            <div class="fm-actions" style="display: flex; gap: 2px; opacity: 0; transition: opacity 0.15s;">
                <button onclick="event.stopPropagation(); window._fmCopyPath('${file.path.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')" title="Copy path" 
                    style="background:none; border:none; cursor:pointer; font-size:0.7rem; padding: 2px 4px; color: #888; border-radius: 3px; transition: 0.15s;"
                    onmouseover="this.style.background='rgba(124,58,237,0.2)'" onmouseout="this.style.background='none'">📋</button>
                <button onclick="event.stopPropagation(); window._fmDeleteFile('${file.path.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}', '${file.name.replace(/'/g, "\\'")}')" title="Delete" 
                    style="background:none; border:none; cursor:pointer; font-size:0.7rem; padding: 2px 4px; color: #EF4444; border-radius: 3px; transition: 0.15s;"
                    onmouseover="this.style.background='rgba(239,68,68,0.15)'" onmouseout="this.style.background='none'">🗑️</button>
            </div>
        </div>`;
    }

    container.innerHTML = html;

    // Add hover listeners for action buttons visibility
    container.querySelectorAll('.fm-item').forEach(item => {
        item.addEventListener('mouseenter', () => {
            item.style.background = item.dataset.isdir === 'true' ? 'rgba(124,58,237,0.06)' : 'rgba(255,255,255,0.025)';
            item.style.borderColor = item.dataset.isdir === 'true' ? 'rgba(124,58,237,0.15)' : 'rgba(255,255,255,0.05)';
            const actions = item.querySelector('.fm-actions');
            if (actions) actions.style.opacity = '1';
        });
        item.addEventListener('mouseleave', () => {
            item.style.background = 'transparent';
            item.style.borderColor = 'transparent';
            const actions = item.querySelector('.fm-actions');
            if (actions) actions.style.opacity = '0';
        });
    });

    document.getElementById('fm-file-count').textContent = `${regularFiles.length} files, ${folders.length} folders`;
    document.getElementById('fm-total-size').textContent = window._fmFormatSize(totalSize);
};

// ─── DRAG & DROP: MOVE FILES BETWEEN FOLDERS ─────────────────────────

// File drag start
window._fmDragStart = function(event, sourcePath) {
    window._fmDragSource = sourcePath.replace(/\\\\/g, '\\');
    event.dataTransfer.setData('text/plain', window._fmDragSource);
    event.dataTransfer.effectAllowed = 'move';
    // Visual feedback
    setTimeout(() => {
        if (event.target) event.target.style.opacity = '0.4';
    }, 0);
};

// File drag end
window._fmDragEnd = function(event) {
    window._fmDragSource = null;
    if (event.target) event.target.style.opacity = '1';
};

// Folder drag over (highlight drop target)
window._fmFolderDragOver = function(event, el) {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    el.style.background = 'rgba(124,58,237,0.15)';
    el.style.borderColor = '#7C3AED';
    el.style.boxShadow = 'inset 0 0 0 1px rgba(124,58,237,0.3)';
};

// Folder drag leave
window._fmFolderDragLeave = function(event, el) {
    el.style.background = 'transparent';
    el.style.borderColor = 'transparent';
    el.style.boxShadow = 'none';
};

// Folder drop (move file into folder)
window._fmFolderDrop = function(event, el, targetFolderPath) {
    event.preventDefault();
    event.stopPropagation();
    el.style.background = 'transparent';
    el.style.borderColor = 'transparent';
    el.style.boxShadow = 'none';

    const resolvedTarget = targetFolderPath.replace(/\\\\/g, '\\');

    // Handle external file drops (from OS)
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0 && !window._fmDragSource) {
        // External file drop into specific folder
        const origPath = window._fmCurrentPath;
        window._fmCurrentPath = resolvedTarget;
        window.handleFileManagerUpload(event.dataTransfer.files);
        window._fmCurrentPath = origPath;
        return;
    }

    // Handle internal move
    const sourcePath = window._fmDragSource || event.dataTransfer.getData('text/plain');
    if (!sourcePath) return;

    const resolved = sourcePath.replace(/\\\\/g, '\\');
    const fileName = fmPath.basename(resolved);
    const destPath = fmPath.join(resolvedTarget, fileName);

    if (resolved === destPath) return; // Same location
    if (destPath.startsWith(resolved)) return; // Can't move into itself

    try {
        fmFs.renameSync(resolved, destPath);
        if (window.appendToolMessage) window.appendToolMessage('File Manager', 'success', `📦 Moved: ${fileName} → ${fmPath.basename(resolvedTarget)}/`);
        window.refreshFileManager(window._fmCurrentPath);
    } catch(e) {
        // Cross-device: copy + delete
        try {
            fmFs.copyFileSync(resolved, destPath);
            fmFs.unlinkSync(resolved);
            if (window.appendToolMessage) window.appendToolMessage('File Manager', 'success', `📦 Moved: ${fileName} → ${fmPath.basename(resolvedTarget)}/`);
            window.refreshFileManager(window._fmCurrentPath);
        } catch(e2) {
            alert('Move failed: ' + e2.message);
        }
    }

    window._fmDragSource = null;
};

// ─── REFRESH FILE MANAGER ────────────────────────────────────────────
window.refreshFileManager = function(targetPath) {
    const basePath = window._fmBasePath || window._fmResolveBasePath();
    
    if (!basePath) {
        window._fmRefreshFromAPI();
        return;
    }

    const dirToRead = targetPath ? targetPath.replace(/\\\\/g, '\\') : basePath;
    window._fmCurrentPath = dirToRead;

    // Build relative display path
    let displayPath = dirToRead.replace(basePath, '').replace(/\\/g, '/');
    if (displayPath.startsWith('/')) displayPath = displayPath.substring(1);
    displayPath = 'workspace/' + displayPath;

    const files = window._fmReadDir(dirToRead);
    window._fmRenderFileList(files, displayPath);
};

// ─── FALLBACK: LOAD FROM GO API ─────────────────────────────────────
window._fmRefreshFromAPI = async function() {
    try {
        const res = await fetch('http://127.0.0.1:5000/api/fs/tree');
        const data = await res.json();
        if (data.status === 'success' && data.data) {
            const allItems = [];
            const flatten = (nodes) => {
                if (!nodes) return;
                for (const n of nodes) {
                    allItems.push({
                        name: n.name, path: n.path, is_dir: n.is_dir,
                        size: n.size, children_count: n.children ? n.children.length : 0
                    });
                }
            };
            flatten(data.data.apps);
            flatten(data.data.nodes);
            window._fmRenderFileList(allItems, 'workspace/');
        }
    } catch(e) {
        console.warn('[FileManager] API tree load failed:', e.message);
        window._fmRenderFileList([], 'workspace/');
    }
};

// ─── DELETE FILE ─────────────────────────────────────────────────────
window._fmDeleteFile = function(filePath, fileName) {
    if (!confirm(`Hapus file "${fileName}"?`)) return;
    try {
        const resolved = filePath.replace(/\\\\/g, '\\');
        const stat = fmFs.statSync(resolved);
        if (stat.isDirectory()) {
            fmFs.rmSync(resolved, { recursive: true, force: true });
        } else {
            fmFs.unlinkSync(resolved);
        }
        if (window.appendToolMessage) window.appendToolMessage('File Manager', 'success', `🗑️ Deleted: ${fileName}`);
        window.refreshFileManager(window._fmCurrentPath);
    } catch(e) {
        alert('Error deleting file: ' + e.message);
    }
};

// ─── COPY PATH TO CHAT ──────────────────────────────────────────────
window._fmCopyPath = function(filePath) {
    const cleanPath = filePath.replace(/\\\\/g, '\\').replace(/\\/g, '/');
    navigator.clipboard.writeText(cleanPath).catch(() => {});

    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.value = chatInput.value + (chatInput.value ? ' ' : '') + cleanPath;
        chatInput.focus();
    }
    if (window.appendToolMessage) window.appendToolMessage('File Manager', 'success', `📋 Copied: ${cleanPath}`);
};

// ─── FILE UPLOAD HANDLER ─────────────────────────────────────────────
window.handleFileManagerUpload = function(fileList) {
    if (!fileList || fileList.length === 0) return;

    const targetDir = window._fmCurrentPath || window._fmBasePath;
    if (!targetDir) { alert('Workspace path not resolved.'); return; }

    try {
        if (!fmFs.existsSync(targetDir)) fmFs.mkdirSync(targetDir, { recursive: true });
    } catch(e) { alert('Cannot create target directory: ' + e.message); return; }

    for (const file of fileList) {
        try {
            const sourcePath = file.path;
            const destPath = fmPath.join(targetDir, file.name);

            if (sourcePath) {
                fmFs.copyFileSync(sourcePath, destPath);
                if (window.appendToolMessage) window.appendToolMessage('File Manager', 'success', `📤 Uploaded: ${file.name}`);
            } else {
                const reader = new FileReader();
                reader.onload = function(e) {
                    const buffer = Buffer.from(e.target.result);
                    fmFs.writeFileSync(destPath, buffer);
                    if (window.appendToolMessage) window.appendToolMessage('File Manager', 'success', `📤 Uploaded: ${file.name}`);
                    window.refreshFileManager(window._fmCurrentPath);
                };
                reader.readAsArrayBuffer(file);
                continue;
            }
        } catch(e) {
            console.error('[FileManager] Upload failed:', file.name, e.message);
            if (window.appendToolMessage) window.appendToolMessage('File Manager', 'error', `❌ Upload failed: ${file.name}`);
        }
    }

    setTimeout(() => window.refreshFileManager(window._fmCurrentPath), 300);
    const input = document.getElementById('fm-upload-input');
    if (input) input.value = '';
};

// ─── MODE SWITCHING HELPERS ──────────────────────────────────────────
window.showIDEMode = function() {
    const ideWrapper = document.getElementById('panel-ide-wrapper');
    const fileManager = document.getElementById('panel-file-manager');
    const toolbarIDE = document.getElementById('toolbar-ide-items');
    const modeIndicator = document.getElementById('ai-mode-indicator');
    const subtitle = document.getElementById('header-subtitle');

    if (ideWrapper) ideWrapper.style.display = 'flex';
    if (fileManager) fileManager.style.display = 'none';
    if (toolbarIDE) toolbarIDE.style.display = 'flex';
    if (modeIndicator) { modeIndicator.textContent = 'CODE MODE'; modeIndicator.style.background = '#10B981'; }
    if (subtitle) subtitle.textContent = 'Flowork OS — Native IDE (Monaco + Xterm)';

    if (window.isMonacoReady && !window.monacoEditorInstance) {
        if (window.initMonacoEditor) window.initMonacoEditor();
    }
    if (!window._terminalInitialized && window.initTerminal) {
        window.initTerminal();
        window._terminalInitialized = true;
    }
    if (window.loadFileSystem) window.loadFileSystem();
};

window.showChatMode = function() {
    const ideWrapper = document.getElementById('panel-ide-wrapper');
    const fileManager = document.getElementById('panel-file-manager');
    const toolbarIDE = document.getElementById('toolbar-ide-items');
    const modeIndicator = document.getElementById('ai-mode-indicator');
    const subtitle = document.getElementById('header-subtitle');

    if (ideWrapper) ideWrapper.style.display = 'none';
    if (fileManager) fileManager.style.display = 'flex';
    if (toolbarIDE) toolbarIDE.style.display = 'none';
    if (modeIndicator) { modeIndicator.textContent = 'CHAT MODE'; modeIndicator.style.background = '#7C3AED'; }
    if (subtitle) subtitle.textContent = 'Flowork OS — Chat, Build, Automate';

    window.refreshFileManager();
};

// ─── PANEL-LEVEL DRAG & DROP (external files) ────────────────────────
(function() {
    setTimeout(() => {
        const fmPanel = document.getElementById('panel-file-manager');
        if (!fmPanel) return;

        fmPanel.addEventListener('dragover', (e) => {
            // Only highlight for external files (not internal moves)
            if (window._fmDragSource) return;
            e.preventDefault();
            e.stopPropagation();
            fmPanel.style.outline = '2px dashed #7C3AED';
            fmPanel.style.outlineOffset = '-2px';
            fmPanel.style.background = 'rgba(124,58,237,0.03)';
        });

        fmPanel.addEventListener('dragleave', (e) => {
            fmPanel.style.outline = 'none';
            fmPanel.style.background = '#0A0A10';
        });

        fmPanel.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            fmPanel.style.outline = 'none';
            fmPanel.style.background = '#0A0A10';

            // Only handle external file drops at panel level
            if (!window._fmDragSource && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                window.handleFileManagerUpload(e.dataTransfer.files);
            }
        });
    }, 1000);
})();

// ─── INITIALIZE ──────────────────────────────────────────────────────
window._fmResolveBasePath();
setTimeout(() => { window.refreshFileManager(); }, 1500);

console.log('[Flowork OS] ✅ File Manager loaded (workspace:', window._fmBasePath, ')');
