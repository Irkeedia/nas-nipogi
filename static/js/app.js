/* ═══════════════════════════════════════════════════════
   NexusNAS — Application JavaScript (SPA)
   ═══════════════════════════════════════════════════════ */

const API = '/api';
let currentUser = null;
let currentView = 'grid'; // 'grid' | 'list'
let currentSection = 'dashboard';
let currentParentId = null;
let breadcrumbStack = [];
let filesCache = [];
let _appShowTime = 0; // Timestamp pour éviter la redirection auth après login

// ── Helpers ────────────────────────────────────────────

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
        // Ne pas rediriger vers login si on vient juste de se connecter (< 8s)
        // Cela évite une race condition au chargement du dashboard
        const elapsed = Date.now() - _appShowTime;
        if (_appShowTime === 0 || elapsed > 8000) {
            showAuth();
        }
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
    const icons = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
    toast.innerHTML = `
        <span>${icons[type] || 'ℹ'}</span>
        <span style="flex:1">${message}</span>
        <button class="toast-close" onclick="this.parentElement.remove()">✕</button>
    `;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

function timeAgo(dateStr) {
    if (!dateStr) return '';
    // Le serveur envoie des dates UTC sans suffixe 'Z', on l'ajoute
    let isoStr = dateStr;
    if (!isoStr.endsWith('Z') && !isoStr.includes('+')) {
        isoStr += 'Z';
    }
    const d = new Date(isoStr);
    const now = new Date();
    const diff = Math.max(0, Math.floor((now - d) / 1000));
    if (diff < 10) return 'à l\'instant';
    if (diff < 60) return `il y a ${diff}s`;
    if (diff < 3600) return `il y a ${Math.floor(diff/60)}min`;
    if (diff < 86400) return `il y a ${Math.floor(diff/3600)}h`;
    if (diff < 604800) return `il y a ${Math.floor(diff/86400)}j`;
    return d.toLocaleDateString('fr-FR');
}

function getCategoryIcon(cat) {
    const icons = {
        folder: '📁', image: '🖼️', video: '🎬', audio: '🎵',
        document: '📄', archive: '📦', other: '📎'
    };
    return icons[cat] || '📎';
}

function getCategoryColor(cat) {
    const colors = {
        image: '#E63946', video: '#3B82F6', audio: '#8B5CF6',
        document: '#22C55E', archive: '#F59E0B', folder: '#F59E0B', other: '#6E6E7A'
    };
    return colors[cat] || '#6E6E7A';
}

// ── Auth ───────────────────────────────────────────────

function showAuth() {
    currentUser = null;
    _appShowTime = 0;
    $('#auth-screen').style.display = 'flex';
    $('#app-layout').style.display = 'none';
    switchAuthTab('login');
}

function showApp() {
    _appShowTime = Date.now();
    $('#auth-screen').style.display = 'none';
    $('#app-layout').style.display = 'flex';
    updateUserUI();
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
    const username = form.username.value.trim();
    const password = form.password.value;
    if (!username || !password) return showToast('Remplissez tous les champs', 'warning');

    try {
        const formData = new URLSearchParams();
        formData.append('username', username);
        formData.append('password', password);

        const res = await fetch(`${API}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData,
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail);
        }
        const data = await res.json();
        setToken(data.access_token);
        currentUser = data.user;
        showToast(`Bienvenue ${currentUser.display_name} !`, 'success');
        showApp();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const form = e.target;
    const username = form.username.value.trim();
    const email = form.email.value.trim();
    const password = form.password.value;
    const confirm = form.confirm.value;

    if (!username || !email || !password) return showToast('Remplissez tous les champs', 'warning');
    if (password !== confirm) return showToast('Les mots de passe ne correspondent pas', 'warning');
    if (password.length < 4) return showToast('Mot de passe trop court (min 4)', 'warning');

    try {
        const data = await api('/auth/register', {
            method: 'POST',
            body: { username, email, password, display_name: username },
        });
        setToken(data.access_token);
        currentUser = data.user;
        showToast('Compte créé avec succès !', 'success');
        showApp();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function updateUserUI() {
    if (!currentUser) return;
    const avatar = $('#sidebar-avatar');
    avatar.style.backgroundColor = currentUser.avatar_color || '#E63946';
    avatar.textContent = (currentUser.display_name || currentUser.username).charAt(0).toUpperCase();
    $('#sidebar-username').textContent = currentUser.display_name || currentUser.username;
    $('#sidebar-role').textContent = currentUser.is_admin ? 'Administrateur' : 'Utilisateur';

    // Show/hide admin nav
    const adminNav = $('#admin-nav');
    if (adminNav) adminNav.style.display = currentUser.is_admin ? 'block' : 'none';
}

function logout() {
    clearToken();
    showToast('Déconnexion réussie', 'info');
    showAuth();
}

// ── Navigation ─────────────────────────────────────────

function navigateTo(section, extra = {}) {
    currentSection = section;
    $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.section === section));

    // Fermer la sidebar sur mobile
    if (window.innerWidth <= 768) {
        const sidebar = $('.sidebar');
        if (sidebar) sidebar.classList.remove('open');
        const overlay = $('#sidebar-overlay');
        if (overlay) overlay.classList.remove('active');
    }

    // Reset breadcrumb if navigating to a new section
    if (!extra.keepBreadcrumb) {
        currentParentId = null;
        breadcrumbStack = [];
    }

    const content = $('#content-area');
    content.scrollTop = 0;

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

function updateBreadcrumb() {
    const bc = $('#header-breadcrumb');
    let html = `<span class="breadcrumb-item ${breadcrumbStack.length === 0 ? 'current' : ''}" onclick="navigateToRoot()">🏠 NexusNAS</span>`;

    breadcrumbStack.forEach((item, i) => {
        html += `<span class="breadcrumb-sep">›</span>`;
        const isCurrent = i === breadcrumbStack.length - 1;
        html += `<span class="breadcrumb-item ${isCurrent ? 'current' : ''}" onclick="navigateToBreadcrumb(${i})">${item.name}</span>`;
    });

    bc.innerHTML = html;
}

function navigateToRoot() {
    currentParentId = null;
    breadcrumbStack = [];
    updateBreadcrumb();
    loadFiles();
}

function navigateToBreadcrumb(index) {
    const item = breadcrumbStack[index];
    currentParentId = item.id;
    breadcrumbStack = breadcrumbStack.slice(0, index + 1);
    updateBreadcrumb();
    loadFiles();
}

function openFolder(folder) {
    currentParentId = folder.id;
    breadcrumbStack.push({ id: folder.id, name: folder.name });
    updateBreadcrumb();
    loadFiles();
}

// ── Dashboard ──────────────────────────────────────────

async function renderDashboard() {
    const content = $('#content-area');
    content.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';

    try {
        // Charger les données avec fallback individuel pour éviter qu'un échec bloque tout
        const [stats, activity, sysInfo] = await Promise.all([
            api('/files/stats').catch(() => ({ total_files: 0, total_folders: 0, storage_used: 0, storage_quota: 1, storage_used_formatted: '0 o', storage_quota_formatted: '—', storage_percent: 0, by_category: {}, size_by_category: {} })),
            api('/files/activity?limit=10').catch(() => []),
            api('/system/info').catch(() => ({ hostname: '—', os: '—', cpu: { percent: 0, cores: 0 }, memory: { percent: 0, used_formatted: '—', total_formatted: '—' }, disk: { percent: 0, used_formatted: '—', total_formatted: '—' }, nas_version: '1.0.0' })),
        ]);

        content.innerHTML = `
            <div class="fade-in">
                <h2 style="font-size:1.5rem;font-weight:800;margin-bottom:24px;">Tableau de bord</h2>

                <div class="dashboard-grid">
                    <div class="stat-card">
                        <div class="stat-icon red">📊</div>
                        <div class="stat-value">${stats.total_files}</div>
                        <div class="stat-label">Fichiers au total</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon blue">📁</div>
                        <div class="stat-value">${stats.total_folders}</div>
                        <div class="stat-label">Dossiers</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon green">💾</div>
                        <div class="stat-value">${stats.storage_used_formatted}</div>
                        <div class="stat-label">Espace utilisé</div>
                        <div class="storage-bar-container">
                            <div class="storage-bar">
                                <div class="storage-bar-fill" style="width:${stats.storage_percent}%"></div>
                            </div>
                            <div class="storage-labels">
                                <span>${stats.storage_used_formatted}</span>
                                <span>${stats.storage_quota_formatted}</span>
                            </div>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon yellow">⚡</div>
                        <div class="stat-value">${sysInfo.cpu.percent}%</div>
                        <div class="stat-label">CPU · ${sysInfo.cpu.cores} cœurs</div>
                    </div>
                </div>

                <h3 style="font-size:1.1rem;font-weight:700;margin-bottom:16px;">Catégories</h3>
                <div class="category-grid">
                    <div class="category-card" onclick="navigateTo('images')">
                        <div class="cat-icon">🖼️</div>
                        <div class="cat-name">Images</div>
                        <div class="cat-count">${stats.by_category.image || 0} · ${stats.size_by_category.image || '0 o'}</div>
                    </div>
                    <div class="category-card" onclick="navigateTo('videos')">
                        <div class="cat-icon">🎬</div>
                        <div class="cat-name">Vidéos</div>
                        <div class="cat-count">${stats.by_category.video || 0} · ${stats.size_by_category.video || '0 o'}</div>
                    </div>
                    <div class="category-card" onclick="navigateTo('documents')">
                        <div class="cat-icon">📄</div>
                        <div class="cat-name">Documents</div>
                        <div class="cat-count">${stats.by_category.document || 0} · ${stats.size_by_category.document || '0 o'}</div>
                    </div>
                    <div class="category-card" onclick="navigateTo('audio')">
                        <div class="cat-icon">🎵</div>
                        <div class="cat-name">Audio</div>
                        <div class="cat-count">${stats.by_category.audio || 0} · ${stats.size_by_category.audio || '0 o'}</div>
                    </div>
                    <div class="category-card" onclick="navigateTo('favorites')">
                        <div class="cat-icon">⭐</div>
                        <div class="cat-name">Favoris</div>
                        <div class="cat-count">Accès rapide</div>
                    </div>
                    <div class="category-card" onclick="navigateTo('trash')">
                        <div class="cat-icon">🗑️</div>
                        <div class="cat-name">Corbeille</div>
                        <div class="cat-count">Éléments supprimés</div>
                    </div>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
                    <div>
                        <h3 style="font-size:1.1rem;font-weight:700;margin-bottom:16px;">Activité récente</h3>
                        <div class="settings-section" style="padding:16px;">
                            <ul class="activity-list">
                                ${activity.length === 0 ? '<li class="activity-item" style="border:none;justify-content:center;color:var(--white-muted);">Aucune activité</li>' :
                                activity.map(a => `
                                    <li class="activity-item">
                                        <div class="activity-icon ${a.action}">${getActionIcon(a.action)}</div>
                                        <div class="activity-text">
                                            <div><strong>${getActionLabel(a.action)}</strong> ${a.target_name || ''}</div>
                                            <div class="activity-time">${timeAgo(a.created_at)}</div>
                                        </div>
                                    </li>
                                `).join('')}
                            </ul>
                        </div>
                    </div>
                    <div>
                        <h3 style="font-size:1.1rem;font-weight:700;margin-bottom:16px;">Système</h3>
                        <div class="settings-section" style="padding:16px;">
                            <div class="settings-row">
                                <div><label>🖥️ Machine</label><div class="desc">${sysInfo.hostname}</div></div>
                                <span style="color:var(--white-muted);font-size:0.85rem;">${sysInfo.os}</span>
                            </div>
                            <div class="settings-row">
                                <div><label>🧠 RAM</label><div class="desc">${sysInfo.memory.used_formatted} / ${sysInfo.memory.total_formatted}</div></div>
                                <span style="color:${sysInfo.memory.percent > 80 ? 'var(--error)' : 'var(--success)'};font-weight:700;">${sysInfo.memory.percent}%</span>
                            </div>
                            <div class="settings-row">
                                <div><label>💿 Disque</label><div class="desc">${sysInfo.disk.used_formatted} / ${sysInfo.disk.total_formatted}</div></div>
                                <span style="color:${sysInfo.disk.percent > 80 ? 'var(--error)' : 'var(--success)'};font-weight:700;">${sysInfo.disk.percent}%</span>
                            </div>
                            <div class="settings-row" style="border:none;">
                                <div><label>🌐 Version NAS</label></div>
                                <span style="color:var(--red-primary);font-weight:700;">v${sysInfo.nas_version}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    } catch (err) {
        content.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><h3>Erreur de chargement</h3><p>${err.message}</p></div>`;
    }
}

function getActionIcon(action) {
    const icons = {
        upload: '⬆️', download: '⬇️', delete: '🗑️', trash: '🗑️',
        restore: '♻️', create_folder: '📁', register: '👤', share: '🔗'
    };
    return icons[action] || '📋';
}

function getActionLabel(action) {
    const labels = {
        upload: 'Upload', download: 'Téléchargement', delete: 'Suppression',
        trash: 'Mis en corbeille', restore: 'Restauré', create_folder: 'Dossier créé',
        register: 'Inscription', share: 'Partagé'
    };
    return labels[action] || action;
}

// ── Files ──────────────────────────────────────────────

async function loadFiles(opts = {}) {
    const content = $('#content-area');
    const params = new URLSearchParams();

    if (currentParentId) params.set('parent_id', currentParentId);
    if (opts.category) params.set('category', opts.category);
    if (opts.search) params.set('search', opts.search);
    if (opts.favorites) params.set('favorites_only', 'true');
    if (opts.trash) params.set('trash', 'true');

    try {
        filesCache = await api(`/files/list?${params}`);
        renderFileList(filesCache, opts);
    } catch (err) {
        showToast('Erreur de chargement: ' + err.message, 'error');
    }
}

function renderFiles() {
    updateBreadcrumb();
    const content = $('#content-area');
    content.innerHTML = `
        <div class="fade-in">
            <div class="files-toolbar">
                <h2 class="toolbar-title">📂 Mes fichiers</h2>
                <button class="btn btn-primary btn-sm" onclick="openUploadOverlay()" style="width:auto;">
                    ⬆️ Upload
                </button>
                <button class="btn btn-secondary btn-sm" onclick="openNewFolderModal()">
                    📁 Nouveau dossier
                </button>
                <div class="view-toggle">
                    <button class="${currentView === 'grid' ? 'active' : ''}" onclick="switchView('grid')">▦</button>
                    <button class="${currentView === 'list' ? 'active' : ''}" onclick="switchView('list')">☰</button>
                </div>
            </div>
            <div id="files-container"><div class="loading-center"><div class="spinner"></div></div></div>
        </div>
    `;
    loadFiles();
}

function renderCategoryFiles(category) {
    const labels = { image: 'Images', video: 'Vidéos', audio: 'Audio', document: 'Documents' };
    const content = $('#content-area');
    content.innerHTML = `
        <div class="fade-in">
            <div class="files-toolbar">
                <h2 class="toolbar-title">${getCategoryIcon(category)} ${labels[category] || category}</h2>
                <div class="view-toggle">
                    <button class="${currentView === 'grid' ? 'active' : ''}" onclick="switchView('grid')">▦</button>
                    <button class="${currentView === 'list' ? 'active' : ''}" onclick="switchView('list')">☰</button>
                </div>
            </div>
            <div id="files-container"><div class="loading-center"><div class="spinner"></div></div></div>
        </div>
    `;
    loadFiles({ category });
}

function renderFavorites() {
    const content = $('#content-area');
    content.innerHTML = `
        <div class="fade-in">
            <div class="files-toolbar">
                <h2 class="toolbar-title">⭐ Favoris</h2>
                <div class="view-toggle">
                    <button class="${currentView === 'grid' ? 'active' : ''}" onclick="switchView('grid')">▦</button>
                    <button class="${currentView === 'list' ? 'active' : ''}" onclick="switchView('list')">☰</button>
                </div>
            </div>
            <div id="files-container"><div class="loading-center"><div class="spinner"></div></div></div>
        </div>
    `;
    loadFiles({ favorites: true });
}

function renderTrash() {
    const content = $('#content-area');
    content.innerHTML = `
        <div class="fade-in">
            <div class="files-toolbar">
                <h2 class="toolbar-title">🗑️ Corbeille</h2>
            </div>
            <div id="files-container"><div class="loading-center"><div class="spinner"></div></div></div>
        </div>
    `;
    loadFiles({ trash: true });
}

function renderFileList(files, opts = {}) {
    const container = $('#files-container');
    if (!container) return;

    if (files.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">${opts.trash ? '🗑️' : '📂'}</div>
                <h3>${opts.trash ? 'Corbeille vide' : 'Aucun fichier'}</h3>
                <p>${opts.trash ? 'Les éléments supprimés apparaîtront ici.' : 'Glissez-déposez des fichiers ou utilisez le bouton Upload.'}</p>
                ${!opts.trash && !opts.category && !opts.favorites ? '<button class="btn btn-primary btn-sm" onclick="openUploadOverlay()" style="width:auto;">⬆️ Uploader des fichiers</button>' : ''}
            </div>
        `;
        return;
    }

    if (currentView === 'grid') {
        container.innerHTML = `
            <div class="file-grid">
                ${files.map(f => `
                    <div class="file-card" data-id="${f.id}" 
                         onclick="handleFileClick(event, ${f.id})"
                         oncontextmenu="showContextMenu(event, ${f.id})">
                        <div class="file-actions">
                            <button class="file-action-btn ${f.is_favorite ? 'fav-active' : ''}" title="Favori"
                                    onclick="event.stopPropagation(); toggleFavorite(${f.id})">
                                ${f.is_favorite ? '★' : '☆'}
                            </button>
                            <button class="file-action-btn" title="Plus" 
                                    onclick="event.stopPropagation(); showContextMenu(event, ${f.id})">⋯</button>
                        </div>
                        <div class="file-preview">
                            ${f.thumbnail_url
                                ? `<img src="${f.thumbnail_url}" alt="${f.name}" loading="lazy">`
                                : `<span class="file-icon-large" style="color:${getCategoryColor(f.category)}">${getCategoryIcon(f.category)}</span>`
                            }
                        </div>
                        <div class="file-name" title="${f.name}">${f.name}</div>
                        <div class="file-meta">
                            <span>${f.is_folder ? '' : f.size_formatted}</span>
                            <span>${timeAgo(f.updated_at)}</span>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    } else {
        container.innerHTML = `
            <div class="file-list">
                <div class="file-list-header">
                    <span>Nom</span>
                    <span>Taille</span>
                    <span>Modifié</span>
                    <span>Actions</span>
                </div>
                ${files.map(f => `
                    <div class="file-list-row" data-id="${f.id}"
                         onclick="handleFileClick(event, ${f.id})"
                         oncontextmenu="showContextMenu(event, ${f.id})">
                        <div class="file-name-col">
                            <span class="file-icon-sm" style="color:${getCategoryColor(f.category)}">${getCategoryIcon(f.category)}</span>
                            <span>${f.name}</span>
                        </div>
                        <span style="color:var(--white-muted);font-size:0.85rem;">${f.is_folder ? '—' : f.size_formatted}</span>
                        <span style="color:var(--white-muted);font-size:0.85rem;">${timeAgo(f.updated_at)}</span>
                        <div style="display:flex;gap:4px;">
                            <button class="file-action-btn ${f.is_favorite ? 'fav-active' : ''}" 
                                    onclick="event.stopPropagation(); toggleFavorite(${f.id})">${f.is_favorite ? '★' : '☆'}</button>
                            <button class="file-action-btn" 
                                    onclick="event.stopPropagation(); showContextMenu(event, ${f.id})">⋯</button>
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }
}

function switchView(view) {
    currentView = view;
    $$('.view-toggle button').forEach(b => b.classList.remove('active'));
    $$('.view-toggle button').forEach(b => {
        if ((view === 'grid' && b.textContent === '▦') || (view === 'list' && b.textContent === '☰'))
            b.classList.add('active');
    });
    renderFileList(filesCache);
}

function handleFileClick(event, fileId) {
    const file = filesCache.find(f => f.id === fileId);
    if (!file) return;

    if (file.is_folder) {
        openFolder(file);
    } else {
        previewFile(file);
    }
}

// ── File Operations ────────────────────────────────────

async function toggleFavorite(fileId) {
    try {
        await api(`/files/${fileId}/favorite`, { method: 'PUT' });
        const file = filesCache.find(f => f.id === fileId);
        if (file) file.is_favorite = !file.is_favorite;
        renderFileList(filesCache);
        showToast(file?.is_favorite ? 'Ajouté aux favoris' : 'Retiré des favoris', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function trashFile(fileId) {
    try {
        await api(`/files/${fileId}/trash`, { method: 'PUT' });
        filesCache = filesCache.filter(f => f.id !== fileId);
        renderFileList(filesCache);
        showToast('Déplacé dans la corbeille', 'info');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function deleteFilePermanent(fileId) {
    if (!confirm('Supprimer définitivement ce fichier ?')) return;
    try {
        await api(`/files/${fileId}`, { method: 'DELETE' });
        filesCache = filesCache.filter(f => f.id !== fileId);
        renderFileList(filesCache, { trash: currentSection === 'trash' });
        showToast('Supprimé définitivement', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function restoreFile(fileId) {
    try {
        await api(`/files/${fileId}/trash`, { method: 'PUT' });
        filesCache = filesCache.filter(f => f.id !== fileId);
        renderFileList(filesCache, { trash: true });
        showToast('Fichier restauré', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function downloadFile(fileId) {
    const token = getToken();
    const a = document.createElement('a');
    a.href = `${API}/files/download/${fileId}?token=${token}`;

    // Trigger via fetch to include auth header
    try {
        const res = await fetch(`${API}/files/download/${fileId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const file = filesCache.find(f => f.id === fileId);
        a.href = url;
        a.download = file ? file.name : 'download';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('Téléchargement lancé', 'success');
    } catch (err) {
        showToast('Erreur de téléchargement', 'error');
    }
}

function renameFilePrompt(fileId) {
    const file = filesCache.find(f => f.id === fileId);
    if (!file) return;
    openModal('Renommer', `
        <div class="form-group">
            <label>Nouveau nom</label>
            <input class="form-input" id="rename-input" value="${file.name}">
        </div>
    `, async () => {
        const newName = $('#rename-input').value.trim();
        if (!newName) return;
        try {
            await api(`/files/${fileId}/rename`, { method: 'PUT', body: { name: newName } });
            showToast('Renommé !', 'success');
            closeModal();
            loadFiles();
        } catch (err) {
            showToast(err.message, 'error');
        }
    });
    setTimeout(() => {
        const input = $('#rename-input');
        input.focus();
        input.select();
    }, 100);
}

// ── Context Menu ───────────────────────────────────────

function showContextMenu(event, fileId) {
    event.preventDefault();
    event.stopPropagation();
    const file = filesCache.find(f => f.id === fileId);
    if (!file) return;

    const menu = $('#context-menu');
    const isTrash = file.is_trashed;

    menu.innerHTML = `
        ${!isTrash ? `
            ${!file.is_folder ? `<button class="context-item" onclick="previewFile(filesCache.find(f=>f.id===${fileId})); closeContextMenu()">👁️ Aperçu</button>` : ''}
            ${!file.is_folder ? `<button class="context-item" onclick="downloadFile(${fileId}); closeContextMenu()">⬇️ Télécharger</button>` : ''}
            <button class="context-item" onclick="renameFilePrompt(${fileId}); closeContextMenu()">✏️ Renommer</button>
            <button class="context-item" onclick="toggleFavorite(${fileId}); closeContextMenu()">
                ${file.is_favorite ? '★ Retirer des favoris' : '☆ Ajouter aux favoris'}
            </button>
            <div class="context-divider"></div>
            <button class="context-item danger" onclick="trashFile(${fileId}); closeContextMenu()">🗑️ Supprimer</button>
        ` : `
            <button class="context-item" onclick="restoreFile(${fileId}); closeContextMenu()">♻️ Restaurer</button>
            <div class="context-divider"></div>
            <button class="context-item danger" onclick="deleteFilePermanent(${fileId}); closeContextMenu()">🗑️ Supprimer définitivement</button>
        `}
    `;

    menu.style.top = event.clientY + 'px';
    menu.style.left = event.clientX + 'px';
    menu.classList.add('active');

    // Adjust if menu goes off screen
    setTimeout(() => {
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 10) + 'px';
        if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 10) + 'px';
    }, 0);
}

function closeContextMenu() {
    $('#context-menu').classList.remove('active');
}

document.addEventListener('click', closeContextMenu);

// ── Upload ─────────────────────────────────────────────

function openUploadOverlay() {
    $('#upload-overlay').classList.add('active');
}

function closeUploadOverlay() {
    $('#upload-overlay').classList.remove('active');
}

function initUpload() {
    const overlay = $('#upload-overlay');
    const zone = $('#upload-zone');
    const fileInput = $('#upload-input');

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeUploadOverlay();
    });

    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('dragover');
    });

    zone.addEventListener('dragleave', () => {
        zone.classList.remove('dragover');
    });

    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
        const files = e.dataTransfer.files;
        if (files.length) uploadFiles(files);
    });

    zone.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', () => {
        if (fileInput.files.length) uploadFiles(fileInput.files);
        fileInput.value = '';
    });

    // Global drag & drop
    document.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (currentUser) openUploadOverlay();
    });
}

async function uploadFiles(fileList) {
    closeUploadOverlay();
    const progress = $('#upload-progress');
    progress.classList.add('active');

    const formData = new FormData();
    for (const f of fileList) {
        formData.append('files', f);
    }
    if (currentParentId) formData.append('parent_id', currentParentId);

    progress.innerHTML = `
        <div class="upload-progress-title">⬆️ Upload en cours...</div>
        ${[...fileList].map(f => `
            <div class="upload-item">
                <span class="upload-name">${f.name}</span>
                <div class="upload-bar"><div class="upload-bar-fill pulse" style="width:60%"></div></div>
            </div>
        `).join('')}
    `;

    try {
        await api('/files/upload', { method: 'POST', body: formData });
        showToast(`${fileList.length} fichier(s) uploadé(s)`, 'success');
        if (currentSection === 'files' || currentSection === 'dashboard') {
            loadFiles();
        }
    } catch (err) {
        showToast('Erreur upload: ' + err.message, 'error');
    } finally {
        setTimeout(() => progress.classList.remove('active'), 1500);
    }
}

// ── Preview ────────────────────────────────────────────

function previewFile(file) {
    if (!file || file.is_folder) return;

    const overlay = $('#preview-overlay');
    const body = $('#preview-body');
    const title = $('#preview-title');

    title.textContent = file.name;
    const token = getToken();

    const cat = file.category;
    if (cat === 'image') {
        body.innerHTML = `<img src="${API}/files/preview/${file.id}" alt="${file.name}">`;
    } else if (cat === 'video') {
        body.innerHTML = `<video controls autoplay><source src="${API}/files/preview/${file.id}" type="${file.mime_type}"></video>`;
    } else if (cat === 'audio') {
        body.innerHTML = `
            <div style="text-align:center;">
                <div style="font-size:6rem;margin-bottom:30px;">🎵</div>
                <h3 style="margin-bottom:20px;">${file.name}</h3>
                <audio controls autoplay style="width:400px;"><source src="${API}/files/preview/${file.id}" type="${file.mime_type}"></audio>
            </div>
        `;
    } else if (file.mime_type && file.mime_type.startsWith('text/')) {
        fetch(`${API}/files/preview/${file.id}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        }).then(r => r.text()).then(text => {
            body.innerHTML = `<div class="text-preview">${escapeHtml(text)}</div>`;
        });
    } else {
        body.innerHTML = `
            <div style="text-align:center;">
                <div style="font-size:6rem;margin-bottom:20px;">${getCategoryIcon(cat)}</div>
                <h3>${file.name}</h3>
                <p style="color:var(--white-muted);margin:10px 0;">${file.size_formatted} · ${file.mime_type || 'Type inconnu'}</p>
                <button class="btn btn-primary" style="width:auto;" onclick="downloadFile(${file.id})">⬇️ Télécharger</button>
            </div>
        `;
    }

    overlay.classList.add('active');

    // Add authorization to media elements
    setTimeout(() => {
        const img = body.querySelector('img');
        if (img) {
            const src = img.getAttribute('src');
            fetch(src, { headers: { 'Authorization': `Bearer ${token}` } })
                .then(r => r.blob())
                .then(blob => img.src = URL.createObjectURL(blob));
        }
        const video = body.querySelector('video source');
        if (video) {
            const src = video.getAttribute('src');
            fetch(src, { headers: { 'Authorization': `Bearer ${token}` } })
                .then(r => r.blob())
                .then(blob => {
                    const videoEl = body.querySelector('video');
                    videoEl.src = URL.createObjectURL(blob);
                    videoEl.play();
                });
        }
        const audio = body.querySelector('audio source');
        if (audio) {
            const src = audio.getAttribute('src');
            fetch(src, { headers: { 'Authorization': `Bearer ${token}` } })
                .then(r => r.blob())
                .then(blob => {
                    const audioEl = body.querySelector('audio');
                    audioEl.src = URL.createObjectURL(blob);
                    audioEl.play();
                });
        }
    }, 50);
}

function closePreview() {
    const overlay = $('#preview-overlay');
    overlay.classList.remove('active');
    const body = $('#preview-body');
    body.innerHTML = '';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ── Modal ──────────────────────────────────────────────

let modalCallback = null;

function openModal(title, bodyHtml, onConfirm) {
    const overlay = $('#modal-overlay');
    $('#modal-title').innerHTML = title;
    $('#modal-body').innerHTML = bodyHtml;
    modalCallback = onConfirm;
    overlay.classList.add('active');
}

function closeModal() {
    $('#modal-overlay').classList.remove('active');
    modalCallback = null;
}

function confirmModal() {
    if (modalCallback) modalCallback();
    else closeModal();
}

function openNewFolderModal() {
    openModal('📁 Nouveau dossier', `
        <div class="form-group">
            <label>Nom du dossier</label>
            <input class="form-input" id="folder-name-input" placeholder="Mon dossier">
        </div>
    `, async () => {
        const name = $('#folder-name-input').value.trim();
        if (!name) return showToast('Entrez un nom', 'warning');
        try {
            await api('/files/folder', {
                method: 'POST',
                body: { name, parent_id: currentParentId },
            });
            showToast('Dossier créé !', 'success');
            closeModal();
            loadFiles();
        } catch (err) {
            showToast(err.message, 'error');
        }
    });
    setTimeout(() => $('#folder-name-input')?.focus(), 100);
}

// ── Settings ───────────────────────────────────────────

async function renderSettings() {
    const content = $('#content-area');
    content.innerHTML = `
        <div class="fade-in">
            <h2 style="font-size:1.5rem;font-weight:800;margin-bottom:24px;">⚙️ Paramètres</h2>

            <div class="settings-section">
                <h3>👤 Profil</h3>
                <div class="form-group">
                    <label>Nom d'affichage</label>
                    <input class="form-input" id="settings-displayname" value="${currentUser.display_name || ''}">
                </div>
                <div class="form-group">
                    <label>Email</label>
                    <input class="form-input" id="settings-email" value="${currentUser.email || ''}">
                </div>
                <div class="form-group">
                    <label>Couleur de l'avatar</label>
                    <input type="color" id="settings-color" value="${currentUser.avatar_color || '#E63946'}" 
                           style="width:60px;height:40px;border:none;background:none;cursor:pointer;">
                </div>
                <button class="btn btn-primary" style="width:auto;margin-top:8px;" onclick="saveProfile()">
                    💾 Sauvegarder
                </button>
            </div>

            <div class="settings-section">
                <h3>🔒 Sécurité</h3>
                <div class="form-group">
                    <label>Mot de passe actuel</label>
                    <input class="form-input" type="password" id="settings-oldpw">
                </div>
                <div class="form-group">
                    <label>Nouveau mot de passe</label>
                    <input class="form-input" type="password" id="settings-newpw">
                </div>
                <button class="btn btn-secondary" style="width:auto;margin-top:8px;" onclick="changePassword()">
                    🔑 Changer le mot de passe
                </button>
            </div>

            <div class="settings-section">
                <h3>📊 Stockage</h3>
                <div class="storage-bar-container">
                    <div class="storage-bar" style="height:12px;">
                        <div class="storage-bar-fill" style="width:${((currentUser.storage_used / currentUser.storage_quota) * 100).toFixed(1)}%"></div>
                    </div>
                    <div class="storage-labels" style="font-size:0.85rem;margin-top:8px;">
                        <span>Utilisé: <strong>${formatSizeJS(currentUser.storage_used)}</strong></span>
                        <span>Quota: <strong>${formatSizeJS(currentUser.storage_quota)}</strong></span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

async function saveProfile() {
    try {
        const data = {
            display_name: $('#settings-displayname').value.trim(),
            email: $('#settings-email').value.trim(),
            avatar_color: $('#settings-color').value,
        };
        currentUser = await api('/auth/me', { method: 'PUT', body: data });
        updateUserUI();
        showToast('Profil mis à jour', 'success');
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function changePassword() {
    const current = $('#settings-oldpw').value;
    const newPw = $('#settings-newpw').value;
    if (!current || !newPw) return showToast('Remplissez les deux champs', 'warning');
    try {
        await api('/auth/change-password', {
            method: 'POST',
            body: { current_password: current, new_password: newPw },
        });
        showToast('Mot de passe modifié', 'success');
        $('#settings-oldpw').value = '';
        $('#settings-newpw').value = '';
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ── Users (Admin) ──────────────────────────────────────

async function renderUsers() {
    const content = $('#content-area');
    content.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';

    try {
        const users = await api('/auth/users');
        content.innerHTML = `
            <div class="fade-in">
                <h2 style="font-size:1.5rem;font-weight:800;margin-bottom:24px;">👥 Gestion des utilisateurs</h2>
                <div class="settings-section">
                    <table class="users-table">
                        <thead>
                            <tr>
                                <th>Utilisateur</th>
                                <th>Email</th>
                                <th>Rôle</th>
                                <th>Statut</th>
                                <th>Inscription</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${users.map(u => `
                                <tr>
                                    <td>
                                        <div style="display:flex;align-items:center;gap:10px;">
                                            <div class="user-avatar" style="background:${u.avatar_color};width:32px;height:32px;font-size:0.75rem;">
                                                ${(u.display_name || u.username).charAt(0).toUpperCase()}
                                            </div>
                                            <span style="font-weight:600;">${u.display_name || u.username}</span>
                                        </div>
                                    </td>
                                    <td style="color:var(--white-muted);">${u.email}</td>
                                    <td>${u.is_admin ? '<span class="badge-admin">Admin</span>' : 'Utilisateur'}</td>
                                    <td>
                                        <span class="user-status">
                                            <span class="dot active"></span>
                                            Actif
                                        </span>
                                    </td>
                                    <td style="color:var(--white-muted);font-size:0.85rem;">${new Date(u.created_at).toLocaleDateString('fr-FR')}</td>
                                    <td>
                                        ${u.id !== currentUser.id ? `
                                            <button class="btn btn-ghost btn-sm" onclick="toggleUserActive(${u.id})">⏸️</button>
                                            <button class="btn btn-ghost btn-sm" style="color:var(--error);" onclick="deleteUser(${u.id})">🗑️</button>
                                        ` : '<span style="color:var(--white-ghost);font-size:0.8rem;">Vous</span>'}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    } catch (err) {
        content.innerHTML = `<div class="empty-state"><div class="empty-icon">🔒</div><h3>Accès refusé</h3><p>${err.message}</p></div>`;
    }
}

async function deleteUser(userId) {
    if (!confirm('Supprimer cet utilisateur et tous ses fichiers ?')) return;
    try {
        await api(`/auth/users/${userId}`, { method: 'DELETE' });
        showToast('Utilisateur supprimé', 'success');
        renderUsers();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

async function toggleUserActive(userId) {
    try {
        await api(`/auth/users/${userId}/toggle-active`, { method: 'PUT' });
        showToast('Statut modifié', 'success');
        renderUsers();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ── System ─────────────────────────────────────────────

async function renderSystem() {
    const content = $('#content-area');
    content.innerHTML = '<div class="loading-center"><div class="spinner"></div></div>';

    try {
        const [sys, net] = await Promise.all([
            api('/system/info'),
            api('/system/network'),
        ]);

        content.innerHTML = `
            <div class="fade-in">
                <h2 style="font-size:1.5rem;font-weight:800;margin-bottom:24px;">🖥️ Système</h2>

                <div class="dashboard-grid">
                    <div class="stat-card">
                        <div class="stat-icon red">⚡</div>
                        <div class="stat-value">${sys.cpu.percent}%</div>
                        <div class="stat-label">CPU (${sys.cpu.cores} cœurs)</div>
                        <div class="storage-bar-container" style="margin-top:12px;">
                            <div class="storage-bar"><div class="storage-bar-fill" style="width:${sys.cpu.percent}%"></div></div>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon blue">🧠</div>
                        <div class="stat-value">${sys.memory.percent}%</div>
                        <div class="stat-label">RAM · ${sys.memory.used_formatted} / ${sys.memory.total_formatted}</div>
                        <div class="storage-bar-container" style="margin-top:12px;">
                            <div class="storage-bar"><div class="storage-bar-fill" style="width:${sys.memory.percent}%"></div></div>
                        </div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon green">💿</div>
                        <div class="stat-value">${sys.disk.percent}%</div>
                        <div class="stat-label">Disque · ${sys.disk.used_formatted} / ${sys.disk.total_formatted}</div>
                        <div class="storage-bar-container" style="margin-top:12px;">
                            <div class="storage-bar"><div class="storage-bar-fill" style="width:${sys.disk.percent}%"></div></div>
                        </div>
                    </div>
                </div>

                <div class="settings-section">
                    <h3>🌐 Réseau</h3>
                    ${net.interfaces.map(iface => `
                        <div class="settings-row">
                            <div>
                                <label>${iface.name}</label>
                                <div class="desc">Masque: ${iface.netmask}</div>
                            </div>
                            <span style="font-family:'JetBrains Mono',monospace;color:var(--red-primary);font-weight:600;">
                                ${iface.ip}:${net.port}
                            </span>
                        </div>
                    `).join('')}
                    <div class="settings-row" style="border:none;margin-top:8px;">
                        <div class="desc">Accédez à votre NAS depuis un autre appareil via l'adresse ci-dessus</div>
                    </div>
                </div>

                <div class="settings-section">
                    <h3>ℹ️ Informations</h3>
                    <div class="settings-row">
                        <label>Hostname</label>
                        <span style="color:var(--white-muted);">${sys.hostname}</span>
                    </div>
                    <div class="settings-row">
                        <label>OS</label>
                        <span style="color:var(--white-muted);">${sys.os}</span>
                    </div>
                    <div class="settings-row" style="border:none;">
                        <label>NexusNAS</label>
                        <span style="color:var(--red-primary);font-weight:700;">v${sys.nas_version}</span>
                    </div>
                </div>
            </div>
        `;
    } catch (err) {
        content.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><h3>Erreur</h3><p>${err.message}</p></div>`;
    }
}

// ── Search ─────────────────────────────────────────────

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
                content.innerHTML = `
                    <div class="fade-in">
                        <div class="files-toolbar">
                            <h2 class="toolbar-title">🔍 Résultats pour "${escapeHtml(q)}"</h2>
                        </div>
                        <div id="files-container"><div class="loading-center"><div class="spinner"></div></div></div>
                    </div>
                `;
                loadFiles({ search: q });
            }
        }, 400);
    });
}

// ── Util ───────────────────────────────────────────────

function formatSizeJS(bytes) {
    const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
    let i = 0;
    let size = bytes;
    while (size >= 1024 && i < units.length - 1) {
        size /= 1024;
        i++;
    }
    return `${size.toFixed(1)} ${units[i]}`;
}

// ── Keyboard shortcuts ─────────────────────────────────

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closePreview();
        closeModal();
        closeUploadOverlay();
        closeContextMenu();
    }
});

// ── Sidebar Toggle (mobile) ───────────────────────────

function toggleSidebar() {
    const sidebar = $('.sidebar');
    const overlay = $('#sidebar-overlay');
    sidebar.classList.toggle('open');
    if (overlay) overlay.classList.toggle('active');
}

// ── Init ───────────────────────────────────────────────

async function init() {
    const token = getToken();
    if (token) {
        try {
            currentUser = await api('/auth/me');
            showApp();
        } catch {
            clearToken();
            showAuth();
        }
    } else {
        showAuth();
    }
    initUpload();
    initSearch();
}

document.addEventListener('DOMContentLoaded', init);
