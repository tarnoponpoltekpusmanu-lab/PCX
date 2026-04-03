// =========================================================================
// FLOWORK OS - NANO MODULAR ARCHITECTURE
// FILE: agent_fs.js
// DESKRIPSI: File Explorer Tree & Aksi IO Dasar
// =========================================================================

window.loadFileSystem = async function () {
    try {
        const response = await fetch('http://127.0.0.1:5000/api/fs/tree');
        const data = await response.json();
        if (data.status === 'success') {
            window.renderFileTree(data.data);
        }
    } catch (e) {
        window.getEl('fs-tree-container').innerHTML = '<span style="color:red">Failed to load filesystem</span>';
    }
};

window.renderFileTree = function(treeData) {
    const container = window.getEl('fs-tree-container');
    container.innerHTML = '';

    const appsHtml = window.buildUL(treeData.apps, 'Apps');
    const nodesHtml = window.buildUL(treeData.nodes, 'Nodes');
    container.innerHTML = appsHtml + nodesHtml;

    document.querySelectorAll('.fs-item').forEach(el => {
        el.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const path = el.getAttribute('data-path');
            const cleanPath = path.replace(/\\/g, '/');
            navigator.clipboard.writeText(cleanPath);

            const chatInput = window.getEl('chat-input');
            if (chatInput) {
                chatInput.value = chatInput.value + (chatInput.value ? ' ' : '') + cleanPath;
                chatInput.focus();
            }

            const ogText = el.innerHTML;
            el.innerHTML = '✅ Copied!';
            setTimeout(() => el.innerHTML = ogText, 1000);
        });
    });

    document.querySelectorAll('.fs-file .file-name').forEach(el => {
        el.addEventListener('click', async (e) => {
            const path = el.getAttribute('data-path');
            try {
                const res = await fetch(`http://127.0.0.1:5000/api/fs/read?path=${encodeURIComponent(path)}`);
                if (!res.ok) throw new Error('Failed to read file');

                const filename = path.split('\\').pop().split('/').pop();

                if (filename.match(/\.(png|jpg|jpeg|webp|gif|ico)$/i)) {
                    const blob = await res.blob();
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        window.generatedFiles[filename] = reader.result;
                        window.activeTab = filename;
                        if(window.renderPreviewTabs) window.renderPreviewTabs(window.generatedFiles);
                        if(window.showFileContent) window.showFileContent(filename);
                    };
                    reader.readAsDataURL(blob);
                    return;
                }

                const content = await res.text();
                window.generatedFiles[filename] = content;

                window.activeTab = filename;
                if(window.renderPreviewTabs) window.renderPreviewTabs(window.generatedFiles);
                if(window.showFileContent) window.showFileContent(filename);
            } catch (err) { alert("Error reading file: " + err.message); }
        });
    });
};

window.deleteFileSystemNode = async function (path, event) {
    if (event) event.stopPropagation();
    if (!confirm(`Are you sure you want to permanently delete:\n${path}?`)) return;

    try {
        const res = await fetch(`http://127.0.0.1:5000/api/fs/delete?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to delete file/folder');
        if (window.loadFileSystem) window.loadFileSystem();
    } catch (err) { alert("Error deleting file: " + err.message); }
};

window.buildUL = function(nodes, title) {
    if (!nodes || nodes.length === 0) return `<div><strong style="color:#FFF;">📁 ${title}</strong><br><span style="padding-left:20px;color:#666;">Empty</span></div>`;
    let html = `<div style="margin-bottom:10px;"><strong style="color:#FFF; display:inline-block; border-bottom:1px solid #333; width:100%; padding-bottom:3px;">📁 ${title}</strong><ul style="list-style:none; padding-left:10px; margin: 5px 0;">`;
    for (let node of nodes) { html += window.buildNode(node); }
    html += `</ul></div>`;
    return html;
};

window.buildNode = function(node) {
    const cleanPath = node.path.replace(/\\/g, '\\\\');
    if (node.is_dir) {
        let text = `<li style="margin: 4px 0; display:flex; flex-direction:column;">
            <div style="display:flex; align-items:center; justify-content:space-between; padding-right:5px;">
                <span class="fs-item" data-path="${node.path}" style="cursor:pointer; color:#B794F6; font-weight:bold; flex:1;" title="Right click to copy absolute path" onclick="const ul = this.parentNode.nextElementSibling; if(ul && ul.tagName === 'UL') ul.style.display = ul.style.display === 'none' ? 'block' : 'none';">📂 ${node.name}</span>
                <span style="cursor:pointer; font-size:0.8rem;" onclick="window.deleteFileSystemNode('${cleanPath}', event)" title="Delete Folder">🗑️</span>
            </div>`;
        if (node.children && node.children.length > 0) {
            text += `<ul style="list-style:none; padding-left:12px; border-left: 1px dotted #444; margin-left: 5px; display: none;">`;
            for (let child of node.children) text += window.buildNode(child);
            text += `</ul>`;
        }
        text += `</li>`;
        return text;
    } else {
        return `<li style="margin: 4px 0; display:flex; align-items:center; justify-content:space-between; padding-right:5px;">
            <span class="fs-item fs-file" data-path="${node.path}" style="display:flex; flex:1; align-items:center;">
                <span class="file-name" data-path="${node.path}" style="cursor:pointer; color:#A7F3D0; transition: color 0.1s; flex:1;" onmouseover="this.style.color='#FFF'" onmouseout="this.style.color='#A7F3D0'" title="Left click to read, Right click to copy absolute path">📄 ${node.name}</span>
            </span>
            <span style="cursor:pointer; font-size:0.8rem;" onclick="window.deleteFileSystemNode('${cleanPath}', event)" title="Delete File">🗑️</span>
        </li>`;
    }
};