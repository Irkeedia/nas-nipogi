/* ═══════════════════════════════════════════════════════
   NexusNAS v4 — App JS (SVG icons, touch-optimized)
   ═══════════════════════════════════════════════════════ */

const API = '/api';
let currentUser = null;
let currentView = 'grid';
let currentSection = 'dashboard';
let currentParentId = null;
let breadcrumbStack = [];
let filesCache = [];
let currentFileFilter = 'all';
let currentPreviewFileId = null;
let _appShowTime = 0;

// ── Helpers ────────────────────────────────────────

function $(sel, ctx = document) { return ctx.querySelector(sel); }
function $$(sel, ctx = document) { return [...ctx.querySelectorAll(sel)]; }
function getToken() { return localStorage.getItem('nexusnas_token'); }
function setToken(t) { localStorage.setItem('nexusnas_token', t); }
function clearToken() { localStorage.removeItem('nexusnas_token'); }

async function api(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (!(opts.body instanceof FormData) && opts.body) {
        headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(opts.body);
    }
    const res = await fetch(`${API}${path}`, { ...opts, headers });
    if (res.status === 401) {
        clearToken();
        const elapsed = Date.now() - _appShowTime;
        if (_appShowTime === 0 || elapsed > 8000) showAuth();
        throw new Error('Non autorisé');
    }
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Erreur serveur' }));
        throw new Error(err.detail || 'Erreur');
    }
    if (res.status === 204) return null;
    return res.json();
}

function showToast(message, type = 'info') {
    const container = $('#toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span style="flex:1">${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}

function timeAgo(dateStr) {
    if (!dateStr) return '';
    let s = dateStr;
    if (!s.endsWith('Z') && !s.includes('+')) s += 'Z';
    const diff = Math.max(0, Math.floor((Date.now() - new Date(s)) / 1000));
    if (diff < 10) return "à l'instant";
    if (diff < 60) return `il y a ${diff}s`;
    if (diff < 3600) return `il y a ${Math.floor(diff/60)}min`;
    if (diff < 86400) return `il y a ${Math.floor(diff/3600)}h`;
    if (diff < 604800) return `il y a ${Math.floor(diff/86400)}j`;
    return new Date(s).toLocaleDateString('fr-FR');
}

function formatSizeJS(bytes) {
    const u = ['o','Ko','Mo','Go','To']; let i = 0, s = bytes;
    while (s >= 1024 && i < u.length - 1) { s /= 1024; i++; }
    return `${s.toFixed(1)} ${u[i]}`;
}

function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

function getCategoryIcon(cat) {
    const map = { folder:'folder', image:'image', video:'video', audio:'audio', document:'document', archive:'archive', other:'clip' };
    return icon(map[cat] || 'file', 20);
}
function getCategoryColor(cat) {
    return { image:'#E63946', video:'#3B82F6', audio:'#8B5CF6', document:'#22C55E', archive:'#F59E0B', folder:'#F59E0B', other:'#6E6E7A' }[cat] || '#6E6E7A';
}

function getActionIcon(a) {
    const map = { upload:'upload', download:'download', delete:'trash', trash:'trash', restore:'restore', create_folder:'folderPlus', register:'user', share:'share' };
    return icon(map[a] || 'file', 16);
}
function getActionLabel(a) {
    return { upload:'Upload', download:'Téléchargement', delete:'Suppression', trash:'Corbeille', restore:'Restauré', create_folder:'Dossier créé', register:'Inscription', share:'Partagé' }[a] || a;
}

// ── Password Toggle ───────────────────────────────

function togglePw(btn) {
    const input = btn.parentElement.querySelector('input');
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    btn.innerHTML = isPassword
        ? ICONS.eyeOff.replace('<svg', '<svg width="18" height="18"')
        : ICONS.eye.replace('<svg', '<svg width="18" height="18"');
}

// ── Auth ───────────────────────────────────────────

function showAuth() {
    currentUser = null; _appShowTime = 0;
    $('#auth-screen').style.display = 'flex';
    $('#app-layout').style.display = 'none';
    switchAuthTab('login');
}

function showApp() {
    _appShowTime = Date.now();
    $('#auth-screen').style.display = 'none';
    $('#app-layout').style.display = 'flex';
    updateUserUI();
    buildDesktopNav();
    navigateTo('dashboard');
}

function switchAuthTab(tab) {
    $$('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    $('#login-form').style.display = tab === 'login' ? 'block' : 'none';
    $('#register-form').style.display = tab === 'register' ? 'block' : 'none';
}

async function handleLogin(e) {
    e.preventDefault();
    const form = e.target;
    const username = form.username.value.trim(), password = form.password.value;
    if (!username || !password) return showToast('Remplissez tous les champs', 'warning');
    try {
        const formData = new URLSearchParams();
        formData.append('username', username);
        formData.append('password', password);
        const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: formData });
        if (!res.ok) { const err = await res.json(); throw new Error(err.detail); }
        const data = await res.json();
        setToken(data.access_token);
        currentUser = data.user;
        showToast(`Bienvenue ${currentUser.display_name} !`, 'success');
        showApp();
    } catch (err) { showToast(err.message, 'error'); }
}

async function handleRegister(e) {
    e.preventDefault();
    const form = e.target;
    const username = form.username.value.trim(), email = form.email.value.trim();
    const password = form.password.value, confirm = form.confirm.value;
    if (!username || !email || !password) return showToast('Remplissez tous les champs', 'warning');
    if (password !== confirm) return showToast('Mots de passe différents', 'warning');
    if (password.length < 4) return showToast('Mot de passe trop court', 'warning');
    try {
        const data = await api('/auth/register', { method: 'POST', body: { username, email, password, display_name: username } });
        setToken(data.access_token); currentUser = data.user;
        showToast('Compte créé !', 'success'); showApp();
    } catch (err) { showToast(err.message, 'error'); }
}

function updateUserUI() {
    if (!currentUser) return;
    const name = currentUser.display_name || currentUser.username;
    const initial = name.charAt(0).toUpperCase();
    const color = currentUser.avatar_color || '#E63946';
    const role = currentUser.is_admin ? 'Admin' : 'Utilisateur';
    const dsAvatar = $('#ds-avatar');
    if (dsAvatar) { dsAvatar.style.backgroundColor = color; dsAvatar.textContent = initial; }
    const dsName = $('#ds-username'); if (dsName) dsName.textContent = name;
    const dsRole = $('#ds-role'); if (dsRole) dsRole.textContent = role;
}

function buildDesktopNav() {
    const nav = $('#ds-nav');
    if (!nav) return;
    const items = [
        { section: 'dashboard', icon: 'home', label: 'Accueil' },
        { section: 'files', icon: 'folder', label: 'Fichiers' },
        { section: 'favorites', icon: 'star', label: 'Favoris' },
        { section: 'trash', icon: 'trash', label: 'Corbeille' },
        { section: 'settings', icon: 'settings', label: 'Réglages' },
    ];
    const adminItems = [
        { section: 'users', icon: 'users', label: 'Utilisateurs' },
        { section: 'system', icon: 'monitor', label: 'Système' },
    ];
    let html = items.map(i => `<button class="ds-item${i.section==='dashboard'?' active':''}" data-section="${i.section}" onclick="navigateTo('${i.section}')">${icon(i.icon, 18)}<span>${i.label}</span></button>`).join('');
    if (currentUser && currentUser.is_admin) {
        html += `<div style="height:8px"></div><div style="padding:4px 12px;font-size:.7rem;text-transform:uppercase;letter-spacing:.5px;color:var(--t3);font-weight:600;">Admin</div>`;
        html += adminItems.map(i => `<button class="ds-item" data-section="${i.section}" onclick="navigateTo('${i.section}')">${icon(i.icon, 18)}<span>${i.label}</span></button>`).join('');
    }
    nav.innerHTML = html;
}

function logout() { clearToken(); showToast('Déconnexion', 'info'); showAuth(); }

// ── Navigation ─────────────────────────────────────

function navigateTo(section, extra = {}) {
    currentSection = section;
    $$('.nav-tab').forEach(n => n.classList.toggle('active', n.dataset.section === section));
    $$('.ds-item').forEach(n => n.classList.toggle('active', n.dataset.section === section));
    if (!extra.keepBreadcrumb) { currentParentId = null; breadcrumbStack = []; }
    const content = $('#content-area'); content.scrollTop = 0;
    switch (section) {
        case 'dashboard': renderDashboard(); break;
        case 'files': renderFiles(); break;
        case 'images': renderCategoryFiles('image'); break;
        case 'videos': renderCategoryFiles('video'); break;
        case 'documents': renderCategoryFiles('document'); break;
        case 'audio': renderCategoryFiles('audio'); break;
        case 'favorites': renderFavorites(); break;
        case 'trash': renderTrash(); break;
        case 'settings': renderSettings(); break;
        case 'users': renderUsers(); break;
        case 'system': renderSystem(); break;
    }
}

function makeBreadcrumb() {
    let html = `<div class="breadcrumb"><button class="bc-item ${breadcrumbStack.length === 0 ? 'current' : ''}" onclick="navigateToRoot()">${icon('folder', 14)} Fichiers</button>`;
    breadcrumbStack.forEach((item, i) => {
        html += `<span class="bc-sep">›</span>`;
        const isCurrent = i === breadcrumbStack.length - 1;
        html += `<button class="bc-item ${isCurrent?'current':''}" onclick="navigateToBreadcrumb(${i})">${item.name}</button>`;
    });
    return html + '</div>';
}

function navigateToRoot() { currentParentId = null; breadcrumbStack = []; loadFiles(); }
function navigateToBreadcrumb(i) { currentParentId = breadcrumbStack[i].id; breadcrumbStack = breadcrumbStack.slice(0, i + 1); loadFiles(); }
function openFolder(folder) { currentParentId = folder.id; breadcrumbStack.push({ id: folder.id, name: folder.name }); loadFiles(); }

// ── Dashboard ──────────────────────────────────────

async function renderDashboard() {
    const content = $('#content-area');
    content.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
    try {
        const [stats, activity, sys] = await Promise.all([
            api('/files/stats').catch(() => ({ total_files:0, total_folders:0, storage_used:0, storage_quota:1, storage_used_formatted:'0 o', storage_quota_formatted:'—', storage_percent:0, by_category:{}, size_by_category:{} })),
            api('/files/activity?limit=6').catch(() => []),
            api('/system/info').catch(() => ({ hostname:'—', os:'—', cpu:{percent:0,cores:0}, memory:{percent:0,used_formatted:'—',total_formatted:'—'}, disk:{percent:0,used_formatted:'—',total_formatted:'—'}, nas_version:'1.0.0' })),
        ]);

        content.innerHTML = `
        <!-- Hero Storage -->
        <div class="hero-card">
            <div class="hero-title">${icon('storage', 22)}<h2>Stockage</h2></div>
            <div class="storage-bar"><div class="storage-fill" style="width:${stats.storage_percent}%"></div></div>
            <div class="storage-info"><span>${stats.storage_used_formatted} utilisés</span><span>${stats.storage_quota_formatted}</span></div>
        </div>

        <!-- Stat Pills -->
        <div class="stat-pills">
            <div class="stat-pill">${icon('file', 22)}<div class="stat-val">${stats.total_files}</div><div class="stat-lbl">Fichiers</div></div>
            <div class="stat-pill">${icon('folder', 22)}<div class="stat-val">${stats.total_folders}</div><div class="stat-lbl">Dossiers</div></div>
            <div class="stat-pill">${icon('cpu', 22)}<div class="stat-val">${sys.cpu.percent}%</div><div class="stat-lbl">CPU</div></div>
        </div>

        <!-- Categories -->
        <div class="section-title">${icon('grid', 16)} Catégories</div>
        <div class="cat-grid">
            <button class="cat-item" onclick="navigateTo('images')"><div class="cat-icon">${icon('image', 22)}</div><div class="cat-name">Images</div><div class="cat-count">${stats.by_category.image || 0}</div></button>
            <button class="cat-item" onclick="navigateTo('videos')"><div class="cat-icon">${icon('video', 22)}</div><div class="cat-name">Vidéos</div><div class="cat-count">${stats.by_category.video || 0}</div></button>
            <button class="cat-item" onclick="navigateTo('documents')"><div class="cat-icon">${icon('document', 22)}</div><div class="cat-name">Documents</div><div class="cat-count">${stats.by_category.document || 0}</div></button>
            <button class="cat-item" onclick="navigateTo('audio')"><div class="cat-icon">${icon('audio', 22)}</div><div class="cat-name">Audio</div><div class="cat-count">${stats.by_category.audio || 0}</div></button>
            <button class="cat-item" onclick="navigateTo('favorites')"><div class="cat-icon">${icon('star', 22)}</div><div class="cat-name">Favoris</div><div class="cat-count">—</div></button>
            <button class="cat-item" onclick="navigateTo('trash')"><div class="cat-icon">${icon('trash', 22)}</div><div class="cat-name">Corbeille</div><div class="cat-count">—</div></button>
        </div>

        <!-- Activity -->
        <div class="section-title">${icon('chart', 16)} Activité récente</div>
        <div class="activity-list">
            ${activity.length === 0 ? `<div class="activity-item" style="justify-content:center;color:var(--t3)">Aucune activité</div>` :
            activity.map(a => `<div class="activity-item">${getActionIcon(a.action)}<div class="activity-text"><strong>${getActionLabel(a.action)}</strong> ${escapeHtml(a.target_name || '')}</div><div class="activity-time">${timeAgo(a.created_at)}</div></div>`).join('')}
        </div>

        <!-- System Quick -->
        <div class="section-title">${icon('monitor', 16)} Système</div>
        <div class="sys-grid">
            <div class="sys-card">${icon('cpu', 20)}<div class="sys-label">CPU</div><div class="sys-value">${sys.cpu.percent}%</div><div class="sys-bar"><div class="sys-bar-fill" style="width:${sys.cpu.percent}%"></div></div></div>
            <div class="sys-card">${icon('memory', 20)}<div class="sys-label">RAM</div><div class="sys-value">${sys.memory.percent}%</div><div class="sys-bar"><div class="sys-bar-fill" style="width:${sys.memory.percent}%"></div></div></div>
            <div class="sys-card">${icon('disk', 20)}<div class="sys-label">Disque</div><div class="sys-value">${sys.disk.percent}%</div><div class="sys-bar"><div class="sys-bar-fill" style="width:${sys.disk.percent}%"></div></div></div>
            <div class="sys-card">${icon('network', 20)}<div class="sys-label">Version</div><div class="sys-value">v${sys.nas_version}</div></div>
        </div>`;
    } catch (err) {
        content.innerHTML = `<div class="empty-state">${icon('warning', 40)}<p>Erreur</p><small>${err.message}</small></div>`;
    }
}

// ── Files ──────────────────────────────────────────

async function loadFiles(opts = {}) {
    const params = new URLSearchParams();
    if (currentParentId) params.set('parent_id', currentParentId);
    if (opts.category) params.set('category', opts.category);
    if (opts.search) params.set('search', opts.search);
    if (opts.favorites) params.set('favorites_only', 'true');
    if (opts.trash) params.set('trash', 'true');
    try {
        filesCache = await api(`/files/list?${params}`);
        if (currentSection === 'files' && currentFileFilter !== 'all') {
            applyFileFilter();
        } else {
            renderFileList(filesCache, opts);
        }
    } catch (err) { showToast('Erreur: ' + err.message, 'error'); }
}

function renderFiles() {
    currentFileFilter = 'all';
    const content = $('#content-area');
    content.innerHTML = `${makeBreadcrumb()}
        <div class="filter-tabs">
            <button class="filter-tab active" data-filter="all" onclick="setFileFilter('all')">${icon('folder', 14)} Tout</button>
            <button class="filter-tab" data-filter="image" onclick="setFileFilter('image')">${icon('image', 14)} Photos</button>
            <button class="filter-tab" data-filter="video" onclick="setFileFilter('video')">${icon('video', 14)} Vidéos</button>
            <button class="filter-tab" data-filter="audio" onclick="setFileFilter('audio')">${icon('audio', 14)} Musique</button>
            <button class="filter-tab" data-filter="document" onclick="setFileFilter('document')">${icon('document', 14)} Documents</button>
            <button class="filter-tab" data-filter="archive" onclick="setFileFilter('archive')">${icon('archive', 14)} Archives</button>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
            <div class="section-title" style="margin:0;flex:1">${icon('folder', 16)} Mes fichiers</div>
            <button class="view-btn ${currentView==='grid'?'active':''}" onclick="switchView('grid')">${icon('grid', 16)}</button>
            <button class="view-btn ${currentView==='list'?'active':''}" onclick="switchView('list')">${icon('list', 16)}</button>
            <button class="btn btn-secondary btn-sm" onclick="openNewFolderModal()" style="width:auto;padding:6px 10px;">${icon('folderPlus', 16)}</button>
        </div>
        <div id="files-container"><div class="loading-center"><div class="spinner"></div></div></div>`;
    loadFiles();
}

function setFileFilter(filter) {
    currentFileFilter = filter;
    $$('.filter-tab').forEach(t => t.classList.toggle('active', t.dataset.filter === filter));
    applyFileFilter();
}

function applyFileFilter() {
    if (currentFileFilter === 'all') {
        renderFileList(filesCache);
    } else {
        const filtered = filesCache.filter(f => f.is_folder || f.category === currentFileFilter);
        renderFileList(filtered);
    }
}

function renderCategoryFiles(category) {
    const labels = { image:'Images', video:'Vidéos', audio:'Audio', document:'Documents' };
    const icons_map = { image:'image', video:'video', audio:'audio', document:'document' };
    const content = $('#content-area');
    content.innerHTML = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
            <div class="section-title" style="margin:0;flex:1">${icon(icons_map[category]||'file', 16)} ${labels[category]||category}</div>
            <button class="view-btn ${currentView==='grid'?'active':''}" onclick="switchView('grid')">${icon('grid', 16)}</button>
            <button class="view-btn ${currentView==='list'?'active':''}" onclick="switchView('list')">${icon('list', 16)}</button>
        </div>
        <div id="files-container"><div class="loading-center"><div class="spinner"></div></div></div>`;
    loadFiles({ category });
}

function renderFavorites() {
    const content = $('#content-area');
    content.innerHTML = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
            <div class="section-title" style="margin:0;flex:1">${icon('star', 16)} Favoris</div>
            <button class="view-btn ${currentView==='grid'?'active':''}" onclick="switchView('grid')">${icon('grid', 16)}</button>
            <button class="view-btn ${currentView==='list'?'active':''}" onclick="switchView('list')">${icon('list', 16)}</button>
        </div>
        <div id="files-container"><div class="loading-center"><div class="spinner"></div></div></div>`;
    loadFiles({ favorites: true });
}

function renderTrash() {
    const content = $('#content-area');
    content.innerHTML = `<div class="section-title" style="margin-bottom:12px">${icon('trash', 16)} Corbeille</div>
        <div id="files-container"><div class="loading-center"><div class="spinner"></div></div></div>`;
    loadFiles({ trash: true });
}

function renderFileList(files, opts = {}) {
    const container = $('#files-container');
    if (!container) return;
    if (files.length === 0) {
        container.innerHTML = `<div class="empty-state">${icon(opts.trash?'trash':'folder', 40)}
            <p>${opts.trash?'Corbeille vide':'Aucun fichier'}</p>
            <small>${opts.trash?'Les éléments supprimés apparaîtront ici.':'Glissez des fichiers ou utilisez Upload.'}</small>
        </div>`;
        return;
    }
    if (currentView === 'grid') {
        container.innerHTML = `<div class="file-grid">${files.map(f => {
            const isFolder = f.is_folder;
            const iconClass = isFolder ? 'file-icon folder-icon' : 'file-icon';
            return `<div class="file-card" data-id="${f.id}" onclick="handleFileClick(event,${f.id})" oncontextmenu="showContextMenu(event,${f.id})">
                ${f.thumbnail_url
                    ? `<img class="file-thumb" src="${f.thumbnail_url}" alt="" loading="lazy">`
                    : `<div class="${iconClass}" style="color:${getCategoryColor(f.category)}">${icon(isFolder?'folder':(f.category||'file'), 22)}</div>`
                }
                <div class="file-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>
                <div class="file-size">${isFolder?'':f.size_formatted}</div>
            </div>`;
        }).join('')}</div>`;
    } else {
        container.innerHTML = files.map(f => {
            const isFolder = f.is_folder;
            const iconClass = isFolder ? 'file-list-icon folder-icon' : 'file-list-icon';
            return `<div class="file-list-item" data-id="${f.id}" onclick="handleFileClick(event,${f.id})" oncontextmenu="showContextMenu(event,${f.id})">
                <div class="${iconClass}" style="color:${getCategoryColor(f.category)}">${icon(isFolder?'folder':(f.category||'file'), 18)}</div>
                <div class="file-list-info"><div class="file-list-name">${escapeHtml(f.name)}</div><div class="file-list-meta">${isFolder?'Dossier':f.size_formatted} · ${timeAgo(f.updated_at)}</div></div>
                <div class="file-list-actions">
                    ${!isFolder ? `<button class="file-action-btn" onclick="event.stopPropagation();downloadFile(${f.id})" title="Télécharger">${icon('download', 16)}</button>` : ''}
                    <button class="file-action-btn" onclick="event.stopPropagation();toggleFavorite(${f.id})">${f.is_favorite ? icon('star', 16) : icon('starOutline', 16)}</button>
                    <button class="file-action-btn" onclick="event.stopPropagation();showContextMenu(event,${f.id})">${icon('more', 16)}</button>
                </div>
            </div>`;
        }).join('');
    }
}

function switchView(view) {
    currentView = view;
    $$('.view-btn').forEach(b => b.classList.remove('active'));
    event && event.target && event.target.closest('.view-btn')?.classList.add('active');
    renderFileList(filesCache);
}

function handleFileClick(event, fileId) {
    const file = filesCache.find(f => f.id === fileId);
    if (!file) return;
    file.is_folder ? openFolder(file) : previewFile(file);
}

// ── File Operations ────────────────────────────────

async function toggleFavorite(id) {
    try {
        await api(`/files/${id}/favorite`, { method: 'PUT' });
        const f = filesCache.find(x => x.id === id);
        if (f) f.is_favorite = !f.is_favorite;
        renderFileList(filesCache);
        showToast(f?.is_favorite ? 'Ajouté aux favoris' : 'Retiré des favoris', 'success');
    } catch (err) { showToast(err.message, 'error'); }
}

async function trashFile(id) {
    try {
        await api(`/files/${id}/trash`, { method: 'PUT' });
        filesCache = filesCache.filter(f => f.id !== id);
        renderFileList(filesCache);
        showToast('Mis en corbeille', 'info');
    } catch (err) { showToast(err.message, 'error'); }
}

async function deleteFilePermanent(id) {
    if (!confirm('Supprimer définitivement ?')) return;
    try {
        await api(`/files/${id}`, { method: 'DELETE' });
        filesCache = filesCache.filter(f => f.id !== id);
        renderFileList(filesCache, { trash: currentSection === 'trash' });
        showToast('Supprimé', 'success');
    } catch (err) { showToast(err.message, 'error'); }
}

async function restoreFile(id) {
    try {
        await api(`/files/${id}/trash`, { method: 'PUT' });
        filesCache = filesCache.filter(f => f.id !== id);
        renderFileList(filesCache, { trash: true });
        showToast('Restauré', 'success');
    } catch (err) { showToast(err.message, 'error'); }
}

async function downloadFile(id) {
    const token = getToken();
    const file = filesCache.find(f => f.id === id);
    const fileName = file ? file.name : 'download';
    showToast('Téléchargement de ' + fileName + '...', 'info');
    try {
        const res = await fetch(`${API}/files/download/${id}`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) throw new Error('Erreur serveur');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
        showToast('Fichier enregistré : ' + fileName, 'success');
    } catch (err) { showToast('Erreur téléchargement: ' + err.message, 'error'); }
}

function renameFilePrompt(id) {
    const file = filesCache.find(f => f.id === id);
    if (!file) return;
    openModal('Renommer', `<div class="form-group"><label>Nouveau nom</label><input class="form-input" id="rename-input" value="${escapeHtml(file.name)}"></div>`,
        async () => {
            const name = $('#rename-input').value.trim();
            if (!name) return;
            try { await api(`/files/${id}/rename`, { method: 'PUT', body: { name } }); showToast('Renommé', 'success'); closeModal(); loadFiles(); }
            catch (err) { showToast(err.message, 'error'); }
        });
    setTimeout(() => { const inp = $('#rename-input'); inp.focus(); inp.select(); }, 100);
}

// ── Context Menu ───────────────────────────────────

function showContextMenu(event, id) {
    event.preventDefault(); event.stopPropagation();
    const file = filesCache.find(f => f.id === id); if (!file) return;
    const menu = $('#context-menu');
    const isTrash = file.is_trashed;

    if (isTrash) {
        menu.innerHTML = `<button class="ctx-item" onclick="restoreFile(${id});closeContextMenu()">${icon('restore', 18)} Restaurer</button>
            <div class="ctx-divider"></div>
            <button class="ctx-item danger" onclick="deleteFilePermanent(${id});closeContextMenu()">${icon('trash', 18)} Supprimer</button>`;
    } else {
        menu.innerHTML = `${!file.is_folder ? `<button class="ctx-item" onclick="previewFile(filesCache.find(f=>f.id===${id}));closeContextMenu()">${icon('preview', 18)} Aperçu</button>
            <button class="ctx-item" onclick="downloadFile(${id});closeContextMenu()">${icon('download', 18)} Télécharger</button>` : ''}
            <button class="ctx-item" onclick="renameFilePrompt(${id});closeContextMenu()">${icon('rename', 18)} Renommer</button>
            <button class="ctx-item" onclick="toggleFavorite(${id});closeContextMenu()">${file.is_favorite ? icon('star', 18)+' Retirer favori' : icon('starOutline', 18)+' Ajouter favori'}</button>
            <div class="ctx-divider"></div>
            <button class="ctx-item danger" onclick="trashFile(${id});closeContextMenu()">${icon('trash', 18)} Supprimer</button>`;
    }

    // Position
    const x = event.clientX || event.touches?.[0]?.clientX || 100;
    const y = event.clientY || event.touches?.[0]?.clientY || 100;
    menu.style.top = y + 'px'; menu.style.left = x + 'px';
    menu.classList.add('active');
    requestAnimationFrame(() => {
        const r = menu.getBoundingClientRect();
        if (r.right > window.innerWidth) menu.style.left = (window.innerWidth - r.width - 10) + 'px';
        if (r.bottom > window.innerHeight) menu.style.top = (window.innerHeight - r.height - 10) + 'px';
    });
}
function closeContextMenu() { $('#context-menu').classList.remove('active'); }
document.addEventListener('click', closeContextMenu);

// ── Upload ─────────────────────────────────────────

function openUploadOverlay() { $('#upload-overlay').classList.add('active'); }
function closeUploadOverlay() { $('#upload-overlay').classList.remove('active'); }

function initUpload() {
    const overlay = $('#upload-overlay'), zone = $('#upload-zone'), input = $('#upload-input');
    overlay.addEventListener('click', e => { if (e.target === overlay) closeUploadOverlay(); });
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag-over'); if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files); });
    zone.querySelector('.btn-secondary').addEventListener('click', e => { e.stopPropagation(); input.click(); });
    input.addEventListener('change', () => { if (input.files.length) uploadFiles(input.files); input.value = ''; });
    document.addEventListener('dragover', e => { e.preventDefault(); if (currentUser) openUploadOverlay(); });
}

async function uploadFiles(fileList) {
    closeUploadOverlay();
    const progress = $('#upload-progress'); progress.classList.add('active');
    const formData = new FormData();
    for (const f of fileList) formData.append('files', f);
    if (currentParentId) formData.append('parent_id', currentParentId);
    progress.innerHTML = `<div class="upload-progress-inner">
        <div style="font-size:.85rem;font-weight:600;">Upload en cours... (${fileList.length} fichier${fileList.length>1?'s':''})</div>
        <div class="progress-bar"><div class="progress-fill" style="width:60%;animation:pulse 1.5s infinite"></div></div>
    </div>`;
    try {
        await api('/files/upload', { method: 'POST', body: formData });
        showToast(`${fileList.length} fichier(s) uploadé(s)`, 'success');
        if (['files','dashboard'].includes(currentSection)) loadFiles();
    } catch (err) { showToast('Erreur upload: ' + err.message, 'error'); }
    finally { setTimeout(() => progress.classList.remove('active'), 1500); }
}

// ── Preview ────────────────────────────────────────

function previewFile(file) {
    if (!file || file.is_folder) return;
    currentPreviewFileId = file.id;
    const overlay = $('#preview-overlay'), body = $('#preview-body'), title = $('#preview-title');
    title.textContent = file.name;
    const token = getToken(), cat = file.category;
    if (cat === 'image') body.innerHTML = `<img src="${API}/files/preview/${file.id}" alt="${escapeHtml(file.name)}">`;
    else if (cat === 'video') body.innerHTML = `<video controls autoplay><source src="${API}/files/preview/${file.id}" type="${file.mime_type}"></video>`;
    else if (cat === 'audio') body.innerHTML = `<div style="text-align:center;">${icon('audio', 64)}<h3 style="margin:16px 0 8px">${escapeHtml(file.name)}</h3><audio controls autoplay style="width:min(360px,90vw);margin-top:12px;"><source src="${API}/files/preview/${file.id}" type="${file.mime_type}"></audio></div>`;
    else if (file.mime_type && file.mime_type.startsWith('text/')) {
        body.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
        fetch(`${API}/files/preview/${file.id}`, { headers: { 'Authorization': `Bearer ${token}` } }).then(r => r.text()).then(text => { body.innerHTML = `<pre style="white-space:pre-wrap;font-size:.82rem;padding:16px;width:100%;max-height:100%;overflow:auto;background:var(--card);border-radius:var(--radius-xs);">${escapeHtml(text)}</pre>`; });
    } else body.innerHTML = `<div style="text-align:center;">${icon(file.category||'file', 64)}<h3 style="margin:16px 0 8px">${escapeHtml(file.name)}</h3><p style="color:var(--t3);margin:4px 0 16px;">${file.size_formatted} · ${file.mime_type||'Inconnu'}</p><button class="btn btn-primary" style="width:auto;" onclick="downloadFile(${file.id})">${icon('download', 16)} Télécharger</button></div>`;
    overlay.classList.add('active');
    setTimeout(() => {
        const mediaFetch = (sel, tag) => {
            const el = body.querySelector(sel);
            if (!el) return;
            const src = el.getAttribute('src');
            fetch(src, { headers: { 'Authorization': `Bearer ${token}` } }).then(r => r.blob()).then(blob => {
                const target = tag ? body.querySelector(tag) : el;
                if (target) { target.src = URL.createObjectURL(blob); if (target.play) target.play(); }
            });
        };
        mediaFetch('img', null);
        mediaFetch('video source', 'video');
        mediaFetch('audio source', 'audio');
    }, 50);
}
function closePreview() { $('#preview-overlay').classList.remove('active'); $('#preview-body').innerHTML = ''; currentPreviewFileId = null; }
function downloadPreviewFile() { if (currentPreviewFileId) downloadFile(currentPreviewFileId); }

// ── Modal ──────────────────────────────────────────

let modalCallback = null;
function openModal(title, bodyHtml, onConfirm) {
    $('#modal-title').innerHTML = title; $('#modal-body').innerHTML = bodyHtml;
    modalCallback = onConfirm; $('#modal-overlay').classList.add('active');
}
function closeModal() { $('#modal-overlay').classList.remove('active'); modalCallback = null; }
function confirmModal() { if (modalCallback) modalCallback(); else closeModal(); }

function openNewFolderModal() {
    openModal(`${icon('folderPlus', 18)} Nouveau dossier`, '<div class="form-group"><label>Nom</label><input class="form-input" id="folder-name-input" placeholder="Mon dossier"></div>',
        async () => {
            const name = $('#folder-name-input').value.trim();
            if (!name) return showToast('Entrez un nom', 'warning');
            try { await api('/files/folder', { method: 'POST', body: { name, parent_id: currentParentId } }); showToast('Dossier créé', 'success'); closeModal(); loadFiles(); }
            catch (err) { showToast(err.message, 'error'); }
        });
    setTimeout(() => $('#folder-name-input')?.focus(), 100);
}

// ── Settings ───────────────────────────────────────

async function renderSettings() {
    const content = $('#content-area');
    const pct = ((currentUser.storage_used / currentUser.storage_quota) * 100).toFixed(1);
    content.innerHTML = `
        <div class="section-title" style="margin-bottom:16px">${icon('settings', 16)} Paramètres</div>
        <div class="settings-section">
            <div class="settings-card">
                <div class="settings-item" onclick="document.getElementById('profile-section').style.display=document.getElementById('profile-section').style.display==='none'?'block':'none'">
                    ${icon('user', 20)}<div class="settings-item-info"><div class="settings-item-title">Profil</div><div class="settings-item-desc">Nom, email, avatar</div></div><span class="settings-item-arrow">›</span>
                </div>
                <div id="profile-section" style="display:none;padding:16px;border-top:1px solid var(--border);">
                    <div class="form-group"><label>Nom d'affichage</label><input class="form-input" id="settings-displayname" value="${escapeHtml(currentUser.display_name||'')}"></div>
                    <div class="form-group"><label>Email</label><input class="form-input" id="settings-email" value="${escapeHtml(currentUser.email||'')}"></div>
                    <div class="form-group"><label>Couleur avatar</label><input type="color" id="settings-color" value="${currentUser.avatar_color||'#E63946'}" style="width:50px;height:36px;border:none;background:none;cursor:pointer;"></div>
                    <button class="btn btn-primary btn-sm" style="width:auto;" onclick="saveProfile()">${icon('check', 14)} Sauvegarder</button>
                </div>
            </div>
        </div>
        <div class="settings-section">
            <div class="settings-card">
                <div class="settings-item" onclick="document.getElementById('security-section').style.display=document.getElementById('security-section').style.display==='none'?'block':'none'">
                    ${icon('settings', 20)}<div class="settings-item-info"><div class="settings-item-title">Sécurité</div><div class="settings-item-desc">Modifier le mot de passe</div></div><span class="settings-item-arrow">›</span>
                </div>
                <div id="security-section" style="display:none;padding:16px;border-top:1px solid var(--border);">
                    <div class="form-group"><label>Mot de passe actuel</label><input class="form-input" type="password" id="settings-oldpw"></div>
                    <div class="form-group"><label>Nouveau mot de passe</label><input class="form-input" type="password" id="settings-newpw"></div>
                    <button class="btn btn-secondary btn-sm" style="width:auto;" onclick="changePassword()">Changer</button>
                </div>
            </div>
        </div>
        <div class="settings-section">
            <div class="settings-card">
                <div class="settings-item">
                    ${icon('storage', 20)}<div class="settings-item-info"><div class="settings-item-title">Stockage</div><div class="settings-item-desc">${formatSizeJS(currentUser.storage_used)} / ${formatSizeJS(currentUser.storage_quota)}</div></div><span style="font-weight:700;color:var(--red);font-size:.85rem">${pct}%</span>
                </div>
                <div style="padding:0 16px 14px"><div class="storage-bar" style="height:4px"><div class="storage-fill" style="width:${pct}%"></div></div></div>
            </div>
        </div>
        <div style="text-align:center;margin-top:20px;"><button class="btn btn-danger btn-sm" style="width:auto;" onclick="logout()">${icon('logout', 16)} Déconnexion</button></div>`;
}

async function saveProfile() {
    try {
        const data = { display_name: $('#settings-displayname').value.trim(), email: $('#settings-email').value.trim(), avatar_color: $('#settings-color').value };
        currentUser = await api('/auth/me', { method: 'PUT', body: data });
        updateUserUI(); showToast('Profil sauvegardé', 'success');
    } catch (err) { showToast(err.message, 'error'); }
}

async function changePassword() {
    const current = $('#settings-oldpw').value, newPw = $('#settings-newpw').value;
    if (!current || !newPw) return showToast('Remplissez les deux champs', 'warning');
    try { await api('/auth/change-password', { method: 'POST', body: { current_password: current, new_password: newPw } }); showToast('Mot de passe modifié', 'success'); $('#settings-oldpw').value = ''; $('#settings-newpw').value = ''; }
    catch (err) { showToast(err.message, 'error'); }
}

// ── Users (Admin) ──────────────────────────────────

async function renderUsers() {
    const content = $('#content-area');
    content.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
    try {
        const users = await api('/auth/users');
        content.innerHTML = `
            <div class="section-title" style="margin-bottom:16px">${icon('users', 16)} Utilisateurs</div>
            <div class="user-grid">${users.map(u => {
                const name = u.display_name || u.username;
                return `<div class="user-card">
                    <div class="user-avatar" style="background:${u.avatar_color||'#E63946'}">${name.charAt(0).toUpperCase()}</div>
                    <div class="user-card-info"><div class="user-card-name">${escapeHtml(name)}</div><div class="user-card-role">${u.is_admin?'Admin':'Utilisateur'} · ${escapeHtml(u.email)}</div></div>
                    <div class="user-card-actions">${u.id !== currentUser.id ? `<button class="btn btn-danger btn-sm" style="width:auto;padding:6px 10px;" onclick="deleteUser(${u.id})">${icon('trash', 14)}</button>` : '<span style="font-size:.72rem;color:var(--t3)">Vous</span>'}</div>
                </div>`;
            }).join('')}</div>`;
    } catch (err) { content.innerHTML = `<div class="empty-state">${icon('warning', 40)}<p>Accès refusé</p><small>${err.message}</small></div>`; }
}

async function deleteUser(id) {
    if (!confirm('Supprimer cet utilisateur ?')) return;
    try { await api(`/auth/users/${id}`, { method: 'DELETE' }); showToast('Supprimé', 'success'); renderUsers(); }
    catch (err) { showToast(err.message, 'error'); }
}

// ── System ─────────────────────────────────────────

async function renderSystem() {
    const content = $('#content-area');
    content.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';
    try {
        const [sys, net] = await Promise.all([api('/system/info'), api('/system/network')]);
        content.innerHTML = `
            <div class="section-title" style="margin-bottom:16px">${icon('monitor', 16)} Système</div>
            <div class="sys-grid" style="margin-bottom:20px">
                <div class="sys-card">${icon('cpu', 20)}<div class="sys-label">CPU (${sys.cpu.cores}c)</div><div class="sys-value">${sys.cpu.percent}%</div><div class="sys-bar"><div class="sys-bar-fill" style="width:${sys.cpu.percent}%"></div></div></div>
                <div class="sys-card">${icon('memory', 20)}<div class="sys-label">RAM</div><div class="sys-value">${sys.memory.percent}%</div><div class="sys-bar"><div class="sys-bar-fill" style="width:${sys.memory.percent}%"></div></div></div>
                <div class="sys-card">${icon('disk', 20)}<div class="sys-label">Disque</div><div class="sys-value">${sys.disk.percent}%</div><div class="sys-bar"><div class="sys-bar-fill" style="width:${sys.disk.percent}%"></div></div></div>
                <div class="sys-card">${icon('network', 20)}<div class="sys-label">Version</div><div class="sys-value">v${sys.nas_version}</div></div>
            </div>
            <div class="section-title" style="margin-bottom:12px">${icon('network', 16)} Réseau</div>
            <div class="settings-card" style="margin-bottom:20px">${net.interfaces.map(i => `<div class="settings-item" style="cursor:default">
                ${icon('network', 20)}<div class="settings-item-info"><div class="settings-item-title">${escapeHtml(i.name)}</div><div class="settings-item-desc">Masque: ${i.netmask}</div></div>
                <span style="font-family:monospace;color:var(--red);font-weight:600;font-size:.82rem">${i.ip}:${net.port}</span>
            </div>`).join('')}</div>
            <div class="section-title" style="margin-bottom:12px">${icon('info', 16)} Infos</div>
            <div class="settings-card">
                <div class="settings-item" style="cursor:default">${icon('monitor', 20)}<div class="settings-item-info"><div class="settings-item-title">Hostname</div><div class="settings-item-desc">${escapeHtml(sys.hostname)}</div></div></div>
                <div class="settings-item" style="cursor:default">${icon('storage', 20)}<div class="settings-item-info"><div class="settings-item-title">OS</div><div class="settings-item-desc">${escapeHtml(sys.os)}</div></div></div>
                <div class="settings-item" style="cursor:default">${icon('disk', 20)}<div class="settings-item-info"><div class="settings-item-title">Disque</div><div class="settings-item-desc">${sys.disk.used_formatted} / ${sys.disk.total_formatted}</div></div></div>
                <div class="settings-item" style="cursor:default">${icon('memory', 20)}<div class="settings-item-info"><div class="settings-item-title">RAM</div><div class="settings-item-desc">${sys.memory.used_formatted} / ${sys.memory.total_formatted}</div></div></div>
            </div>`;
    } catch (err) { content.innerHTML = `<div class="empty-state">${icon('warning', 40)}<p>Erreur</p><small>${err.message}</small></div>`; }
}

// ── Search ─────────────────────────────────────────

let searchTimeout = null;
function initSearch() {
    const input = $('#search-input');
    if (!input) return;
    input.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            const q = input.value.trim();
            if (q.length >= 2) {
                currentSection = 'files';
                const content = $('#content-area');
                content.innerHTML = `<div class="section-title" style="margin-bottom:12px">${icon('search', 16)} "${escapeHtml(q)}"</div><div id="files-container"><div class="loading-center"><div class="spinner"></div></div></div>`;
                loadFiles({ search: q });
            }
        }, 400);
    });
}

// ── Touch: long press for context menu ─────────────

let longPressTimer = null;
document.addEventListener('touchstart', e => {
    const card = e.target.closest('.file-card, .file-list-item');
    if (!card) return;
    const id = parseInt(card.dataset.id);
    if (isNaN(id)) return;
    longPressTimer = setTimeout(() => {
        longPressTimer = null;
        const touch = e.touches[0];
        showContextMenu({ preventDefault:()=>{}, stopPropagation:()=>{}, clientX: touch.clientX, clientY: touch.clientY }, id);
        // Prevent the click from firing
        card.dataset.longPressed = '1';
    }, 500);
}, { passive: true });

document.addEventListener('touchend', () => {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
});
document.addEventListener('touchmove', () => {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
});

// ── Keyboard ───────────────────────────────────────

document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closePreview(); closeModal(); closeUploadOverlay(); closeContextMenu(); }
});

// ── Init ───────────────────────────────────────────

async function init() {
    const token = getToken();
    if (token) {
        try { currentUser = await api('/auth/me'); showApp(); }
        catch { clearToken(); showAuth(); }
    } else showAuth();
    initUpload(); initSearch();
}

document.addEventListener('DOMContentLoaded', init);
