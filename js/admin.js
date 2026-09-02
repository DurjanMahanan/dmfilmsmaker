/**
 * DM STUDIO - ADMIN DASHBOARD CONTROLLER
 * High-Speed Multi-Tenant Studio Portal
 */

const API_BASE = (typeof window !== 'undefined' && window.API_BASE) ? window.API_BASE : '';

let allClients = [];
var allInvoices = [];
var activeInvoiceFilter = 'all';
var currentActiveInvoice = null;
let currentUploadClientId = null;
let uploadQueue = [];
let isUploading = false;
let isUploadPaused = false;
let currentStudio = null;
let autoCopyTargetClientId = null;
let selectedLocalDirHandle = null;

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  initAdminDashboard();
});

async function initAdminDashboard() {
  const token = localStorage.getItem('dm_admin_token');
  if (!token) {
    window.location.href = 'login.html';
    return;
  }

  // 1. Attach all click and navigation event listeners immediately
  setupEventListeners();

  // 2. Load current studio profile from local storage for instant render
  try {
    const raw = localStorage.getItem('dm_current_studio');
    if (raw) currentStudio = JSON.parse(raw);
  } catch (e) {}

  applyStudioBranding();

  // 3. Render Profile Cards & Logo immediately
  loadAndRenderProfileSettings().catch(console.warn);

  // 4. Fetch fresh studio profile directly from backend server in background
  fetch(`${API_BASE}/api/admin/studio-profile`, {
    headers: (currentStudio && currentStudio.id) ? { 'X-Studio-Id': currentStudio.id } : {}
  })
    .then(r => r.json())
    .then(freshStudio => {
      if (freshStudio && freshStudio.studioName) {
        currentStudio = freshStudio;
        localStorage.setItem('dm_current_studio', JSON.stringify(freshStudio));
        applyStudioBranding();
        loadAndRenderProfileSettings().catch(console.warn);
      }
    })
    .catch(console.warn);

  // 5. Load Clients and Stats in background
  loadClientsAndStats().catch(console.warn);
  updateStorageSettingsVisibility();
}

function isDeveloperUser() {
  const token = localStorage.getItem('dm_admin_token') || '';
  const studio = currentStudio || JSON.parse(localStorage.getItem('dm_current_studio') || '{}');

  if (token === 'dm_admin_token_2026' || token.startsWith('dm_admin_token')) return true;
  if (studio && (studio.id === 'studio_master_dm' || studio.role === 'developer' || studio.role === 'master_admin' || studio.role === 'admin' || studio.isDeveloper === true || studio.email === 'contact@dmfilms.com' || studio.email === 'durjandancer9@gmail.com')) {
    return true;
  }
  return false;
}

function updateStorageSettingsVisibility() {
  const settingsNav = document.getElementById('nav-item-settings') || document.querySelector('.admin-sidebar .nav-item[data-view="settings"]');
  if (settingsNav) {
    settingsNav.style.display = isDeveloperUser() ? 'flex' : 'none';
  }
}

function applyStudioBranding() {
  updateStorageSettingsVisibility();
  const studio = currentStudio || JSON.parse(localStorage.getItem('dm_current_studio') || '{}');
  const studioName = (studio && studio.studioName) ? studio.studioName : 'DM Films & Photography';

  const nameEls = document.querySelectorAll('.studio-brand-name');
  nameEls.forEach(el => el.textContent = studioName);

  const titleEl = document.getElementById('admin-brand-title') || document.querySelector('.brand-title');
  if (titleEl) {
    titleEl.textContent = studioName.toUpperCase();
  }

  const logoImg = studio.logoUrl || studio.avatarUrl;
  const brandIconBox = document.getElementById('admin-brand-icon-box');
  const topAvatar = document.getElementById('top-badge-avatar');
  const topInitials = document.getElementById('top-badge-initials');
  const topName = document.getElementById('top-badge-name');
  const profAvatar = document.getElementById('prof-card-avatar');
  const logoBox = document.getElementById('prof-logo-preview-box');

  if (topName) topName.textContent = studioName;

  if (brandIconBox) {
    if (logoImg) {
      brandIconBox.innerHTML = `<img src="${logoImg}" alt="Logo" style="width:36px;height:36px;object-fit:cover;border-radius:8px;border:1.5px solid rgba(212,175,55,0.7);box-shadow:0 0 10px rgba(212,175,55,0.4);">`;
    } else {
      brandIconBox.innerHTML = `<svg id="admin-brand-default-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:32px;height:32px;color:var(--gold-400);"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>`;
    }
  }

  if (logoImg) {
    if (topAvatar) topAvatar.innerHTML = `<img src="${logoImg}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    if (profAvatar) profAvatar.innerHTML = `<img src="${logoImg}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    if (logoBox) logoBox.innerHTML = `<img src="${logoImg}" style="max-height:45px;max-width:90%;object-fit:contain;">`;
  } else {
    const clean = studioName.trim().replace(/[^a-zA-Z0-9\s]/g, '');
    const words = clean.split(/\s+/).filter(Boolean);
    const inits = words.length >= 2 ? (words[0][0] + words[1][0]).toUpperCase() : clean.substring(0, 2).toUpperCase();
    if (topInitials) topInitials.textContent = inits;
  }

  const phoneEl = document.getElementById('setting-studio-phone');
  const nameInput = document.getElementById('setting-studio-name');
  const taglineInput = document.getElementById('setting-studio-tagline');
  const logoInput = document.getElementById('setting-studio-logo');

  if (nameInput && studio.studioName) nameInput.value = studio.studioName;
  if (phoneEl && studio.phone) phoneEl.value = studio.phone || '';
  if (taglineInput && studio.tagline) taglineInput.value = studio.tagline || '';
  if (logoInput && studio.logoUrl) logoInput.value = studio.logoUrl || '';
}

async function saveStudioBranding() {
  const studioName = document.getElementById('setting-studio-name')?.value.trim();
  const phone = document.getElementById('setting-studio-phone')?.value.trim();
  const tagline = document.getElementById('setting-studio-tagline')?.value.trim();
  const logoUrl = document.getElementById('setting-studio-logo')?.value.trim();

  if (!studioName) {
    window.api.showToast('Studio name is required', 'error');
    return;
  }

  const updated = {
    ...(currentStudio || {}),
    studioId: currentStudio?.id || 'studio_master_dm',
    studioName,
    phone,
    tagline,
    logoUrl
  };

  try {
    await fetch(`${window.APP_CONFIG.WORKER_API_URL}/api/studio/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updated)
    });
    localStorage.setItem('dm_current_studio', JSON.stringify(updated));
    currentStudio = updated;
    applyStudioBranding();
    window.api.showToast('Studio profile saved successfully!', 'success');
  } catch (e) {
    window.api.showToast('Failed to save settings', 'error');
  }
}

// --- Navigation & View Switching ---
function setupEventListeners() {
  // Sidebar navigation
  document.querySelectorAll('.admin-sidebar .nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const targetView = item.getAttribute('data-view');
      switchView(targetView);
    });
  });

  // Create Client Form
  const createClientForm = document.getElementById('create-client-form');
  if (createClientForm) {
    createClientForm.addEventListener('submit', handleCreateClient);
  }

  // Drag and Drop Upload Handlers
  const dropzone = document.getElementById('upload-dropzone');
  const fileInput = document.getElementById('photo-file-input');
  const folderInput = document.getElementById('folder-file-input');

  if (dropzone) {
    ['dragenter', 'dragover'].forEach(eventName => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
      });
    });

    dropzone.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      const items = e.dataTransfer.items;
      if (items && items.length > 0) {
        const filesWithSubfolders = await scanDataTransferItems(items);
        handleFilesSelected(filesWithSubfolders);
      } else if (e.dataTransfer.files) {
        handleFilesSelected(e.dataTransfer.files);
      }
    });
  }

  if (fileInput) {
    fileInput.addEventListener('change', (e) => {
      handleFilesSelected(e.target.files);
      e.target.value = '';
    });
  }

  if (folderInput) {
    folderInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files);
      files.forEach(file => {
        if (file.webkitRelativePath) {
          const parts = file.webkitRelativePath.split('/');
          if (parts.length > 2) {
            file._subfolder = parts[parts.length - 2] || parts[0];
          } else if (parts.length === 2) {
            file._subfolder = parts[0]; // Original root folder name (e.g. "DEMO")
          } else {
            file._subfolder = parts[0] || 'Selected Folder';
          }
        } else {
          file._subfolder = 'Selected Folder';
        }
      });
      handleFilesSelected(files);
      e.target.value = '';
    });
  }

  // Auto-generate client code when typing name
  const nameInput = document.getElementById('client-name');
  const codeInput = document.getElementById('client-code');
  if (nameInput && codeInput) {
    nameInput.addEventListener('input', () => {
      if (!codeInput.dataset.userEdited) {
        const clean = nameInput.value.replace(/[^a-zA-Z0-9]/g, '').substring(0, 6).toUpperCase();
        if (clean) codeInput.value = clean + Math.floor(100 + Math.random() * 900);
      }
    });
    codeInput.addEventListener('input', () => {
      codeInput.dataset.userEdited = 'true';
    });
  }
}

function switchView(viewName) {
  if (viewName === 'settings' && !isDeveloperUser()) {
    if (window.api && window.api.showToast) {
      window.api.showToast('🔒 Access Restricted: Storage & Cloud Configuration is available only for Developer / Master Admin.', 'warning');
    }
    switchView('dashboard');
    return;
  }

  document.querySelectorAll('.admin-sidebar .nav-item').forEach(el => {
    el.classList.toggle('active', el.getAttribute('data-view') === viewName);
  });

  document.querySelectorAll('.view-panel').forEach(panel => {
    panel.style.display = panel.id === `view-${viewName}` ? 'block' : 'none';
  });

  if (viewName === 'clients') renderClientsTable();
  if (viewName === 'selections') {
    fetchClients().then(() => {
      populateClientSelectDropdowns();
      renderSelectionsView();
    });
  }
  if (viewName === 'flipbook') {
    populateClientSelectDropdowns();
    renderFlipbooksView();
    loadProFlipbookAudioList();
  }
  if (viewName === 'my-flipbooks') {
    renderMyFlipbooksGallery();
  }
  if (viewName === 'invoices') {
    renderInvoicesView();
  }
  if (viewName === 'website-editor') {
    loadAndRenderWebsiteEditor();
  }
  if (viewName === 'profile-settings') {
    loadAndRenderProfileSettings();
  }
  if (viewName === 'settings') populateSettingsView();
}

function populateSettingsView() {
  const driveInput = document.getElementById('setting-drive-folder');
  const linkDrive = document.getElementById('link-drive-folder');

  const studio = currentStudio || JSON.parse(localStorage.getItem('dm_current_studio') || '{}');

  const masterDriveId = studio.driveFolderId || "1Glh2NLXhJMIKO89jz2OsGBzI3fW8HZJf";
  if (driveInput) driveInput.value = masterDriveId;
  if (linkDrive) linkDrive.href = `https://drive.google.com/drive/folders/${masterDriveId}`;
}

// --- NO-CODE WEBSITE & PORTAL CONTENT EDITOR ---
let activeWebsiteConfig = null;

async function loadAndRenderWebsiteEditor() {
  try {
    const res = await fetch(`${API_BASE}/api/admin/website-config`, {
      headers: (currentStudio && currentStudio.id) ? { 'X-Studio-Id': currentStudio.id } : {}
    });
    if (res.ok) {
      activeWebsiteConfig = await res.json();
      populateWebsiteEditorForm(activeWebsiteConfig);
    }
  } catch (e) {
    console.warn('Error loading website config:', e);
  }
}

function populateWebsiteEditorForm(cfg) {
  if (!cfg) return;
  
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el && val !== undefined) el.value = val;
  };

  setVal('web-studio-name', cfg.studioName);
  setVal('web-studio-subtitle', cfg.studioSubtitle);
  setVal('web-phone', cfg.phone);
  setVal('web-address', cfg.address);
  setVal('web-hero-badge', cfg.heroBadge);
  setVal('web-hero-title', cfg.heroTitle);
  setVal('web-hero-subtitle', cfg.heroSubtitle);
  setVal('web-portal-heading', cfg.portalBoxHeading);
  setVal('web-portal-placeholder', cfg.portalBoxPlaceholder);
  setVal('web-portal-btn', cfg.portalBtnText);

  setVal('web-f1-icon', cfg.feature1Icon);
  setVal('web-f1-title', cfg.feature1Title);
  setVal('web-f1-desc', cfg.feature1Desc);

  setVal('web-f2-icon', cfg.feature2Icon);
  setVal('web-f2-title', cfg.feature2Title);
  setVal('web-f2-desc', cfg.feature2Desc);

  setVal('web-f3-icon', cfg.feature3Icon);
  setVal('web-f3-title', cfg.feature3Title);
  setVal('web-f3-desc', cfg.feature3Desc);

  setVal('web-accent-color', cfg.accentColor || '#d4af37');
  setVal('web-whatsapp', cfg.whatsapp);
  setVal('web-instagram', cfg.instagram);
  setVal('web-youtube', cfg.youtube);
  setVal('web-footer-text', cfg.footerText);

  updateWebsiteLivePreview();
}

function setAccentPreset(colorHex) {
  const el = document.getElementById('web-accent-color');
  if (el) {
    el.value = colorHex;
    updateWebsiteLivePreview();
  }
}

function updateWebsiteLivePreview() {
  const getVal = (id, fallback) => {
    const el = document.getElementById(id);
    return (el && el.value.trim()) ? el.value.trim() : fallback;
  };

  const badgeEl = document.getElementById('prev-badge');
  const titleEl = document.getElementById('prev-title');
  const subtitleEl = document.getElementById('prev-subtitle');
  const portalHeadingEl = document.getElementById('prev-portal-heading');
  const portalPlaceholderEl = document.getElementById('prev-portal-placeholder');
  const portalBtnEl = document.getElementById('prev-portal-btn');

  const badgeText = getVal('web-hero-badge', '✨ Luxury Wedding Photo Selection Portal');
  const heroTitle = getVal('web-hero-title', 'Cherish Every Moment, Select Your Favorites');
  const heroSub = getVal('web-hero-subtitle', 'Welcome to your private wedding photo gallery...');
  const portalHeading = getVal('web-portal-heading', 'Access Your Event Gallery');
  const portalPlaceholder = getVal('web-portal-placeholder', 'Enter Client Code (e.g. RAJ2026)');
  const portalBtn = getVal('web-portal-btn', 'Open My Gallery →');
  const color = getVal('web-accent-color', '#d4af37');

  if (badgeEl) {
    badgeEl.textContent = badgeText;
    badgeEl.style.borderColor = color;
    badgeEl.style.color = color;
  }
  if (titleEl) {
    const parts = heroTitle.split(',');
    if (parts.length > 1) {
      titleEl.innerHTML = `${escapeHtml(parts[0])}, <span style="color:${color};">${escapeHtml(parts.slice(1).join(','))}</span>`;
    } else {
      titleEl.innerHTML = `<span style="color:${color};">${escapeHtml(heroTitle)}</span>`;
    }
  }
  if (subtitleEl) subtitleEl.textContent = heroSub;
  if (portalHeadingEl) {
    portalHeadingEl.textContent = portalHeading;
    portalHeadingEl.style.color = color;
  }
  if (portalPlaceholderEl) portalPlaceholderEl.textContent = portalPlaceholder;
  if (portalBtnEl) {
    portalBtnEl.textContent = portalBtn;
    portalBtnEl.style.background = `linear-gradient(135deg, ${color}, #b8860b)`;
  }
}

async function saveWebsiteConfig(event) {
  if (event) event.preventDefault();
  
  const getVal = (id) => document.getElementById(id)?.value || '';
  const btn = document.getElementById('btn-save-website');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Publishing Website...';
  }

  const payload = {
    studioName: getVal('web-studio-name'),
    studioSubtitle: getVal('web-studio-subtitle'),
    phone: getVal('web-phone'),
    address: getVal('web-address'),
    heroBadge: getVal('web-hero-badge'),
    heroTitle: getVal('web-hero-title'),
    heroSubtitle: getVal('web-hero-subtitle'),
    portalBoxHeading: getVal('web-portal-heading'),
    portalBoxPlaceholder: getVal('web-portal-placeholder'),
    portalBtnText: getVal('web-portal-btn'),
    feature1Icon: getVal('web-f1-icon'),
    feature1Title: getVal('web-f1-title'),
    feature1Desc: getVal('web-f1-desc'),
    feature2Icon: getVal('web-f2-icon'),
    feature2Title: getVal('web-f2-title'),
    feature2Desc: getVal('web-f2-desc'),
    feature3Icon: getVal('web-f3-icon'),
    feature3Title: getVal('web-f3-title'),
    feature3Desc: getVal('web-f3-desc'),
    accentColor: getVal('web-accent-color'),
    whatsapp: getVal('web-whatsapp'),
    instagram: getVal('web-instagram'),
    youtube: getVal('web-youtube'),
    footerText: getVal('web-footer-text')
  };

  try {
    const res = await fetch(`${API_BASE}/api/admin/website-config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...((currentStudio && currentStudio.id) ? { 'X-Studio-Id': currentStudio.id } : {})
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (res.ok && data.success) {
      window.api.showToast('✨ Website content & design published live successfully!', 'success');
      if (currentStudio) {
        currentStudio.studioName = payload.studioName || currentStudio.studioName;
        currentStudio.websiteConfig = payload;
        localStorage.setItem('dm_current_studio', JSON.stringify(currentStudio));
        applyStudioBranding();
      }
    } else {
      window.api.showToast(data.error || 'Failed to save website config', 'error');
    }
  } catch (err) {
    window.api.showToast('Server error saving website config', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '✨ Save & Publish Website Changes';
    }
  }
}
window.saveWebsiteConfig = saveWebsiteConfig;
window.setAccentPreset = setAccentPreset;
window.updateWebsiteLivePreview = updateWebsiteLivePreview;

// --- Data Loading & Stats ---
async function loadClientsAndStats() {
  allClients = await window.api.getClients();
  updateStats();
  renderClientsTable();
  populateClientSelectDropdowns();
}

function updateStats() {
  const totalClients = allClients.length;
  let totalPhotos = 0;
  let totalSelected = 0;

  allClients.forEach(c => {
    totalPhotos += c.photosCount || (c.photos ? c.photos.length : 0);
    totalSelected += c.selectedCount || (c.selectedPhotoIds ? c.selectedPhotoIds.length : 0);
  });

  const elClients = document.getElementById('stat-total-clients');
  const elPhotos = document.getElementById('stat-total-photos');
  const elSelected = document.getElementById('stat-total-selected');

  if (elClients) elClients.textContent = totalClients;
  if (elPhotos) elPhotos.textContent = totalPhotos;
  if (elSelected) elSelected.textContent = totalSelected;
}

// --- Clients Table Rendering ---
function renderClientsTable() {
  const tbodyDashboard = document.getElementById('clients-table-body');
  const tbodyFull = document.getElementById('clients-table-body-full');

  if (allClients.length === 0) {
    const emptyRow = `<tr><td colspan="6" style="text-align:center;padding:3rem;color:var(--text-muted);">No clients created yet. Click "+ Create New Client" to start!</td></tr>`;
    if (tbodyDashboard) tbodyDashboard.innerHTML = emptyRow;
    if (tbodyFull) tbodyFull.innerHTML = emptyRow;
    return;
  }

  const rowsHtml = allClients.map(client => {
    const photosCount = client.photosCount || (client.photos ? client.photos.length : 0);
    const selectedCount = client.selectedCount || (client.selectedPhotoIds ? client.selectedPhotoIds.length : 0);
    const clientUrl = `${window.location.origin}/client.html?code=${client.code}`;
    const limit = client.selectionLimit || 350;

    return `
      <tr>
        <td>
          <strong style="color:var(--text-primary);font-size:1.05rem;">${escapeHtml(client.name)}</strong>
          <div style="font-size:0.75rem;color:var(--text-gold);margin-top:2px;">Code: <code>${client.code}</code></div>
        </td>
        <td>
          <div>${escapeHtml(client.eventName || 'Wedding')}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);">${client.eventDate || 'N/A'}</div>
        </td>
        <td>
          <div>${escapeHtml(client.mobile || 'N/A')}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);">${escapeHtml(client.email || '')}</div>
        </td>
        <td>
          <div style="font-weight:600;color:var(--text-primary);">${photosCount} Photos</div>
          <div style="font-size:0.75rem;color:var(--text-gold);">Selected: <strong>${selectedCount} / ${limit}</strong> Limit</div>
        </td>
        <td>
          <span class="badge ${client.selectionLocked || client.selectionSubmittedAt ? 'badge-success' : 'badge-gold'}">
            ${client.selectionLocked || client.selectionSubmittedAt ? '✔ SUBMITTED' : 'PENDING'}
          </span>
        </td>
        <td>
          <div style="display:flex;gap:0.4rem;flex-wrap:wrap;align-items:center;">
            ${client.selectionLocked ? `
              <button class="btn btn-sm" onclick="unlockClientSelectionPrompt('${client.id}')" title="Currently Locked - Click to Unlock Gallery" style="background:rgba(239,68,68,0.22);border:1.5px solid #ef4444;color:#fca5a5;font-weight:800;padding:4px 8px;font-size:0.75rem;border-radius:6px;cursor:pointer;box-shadow:0 0 10px rgba(239,68,68,0.3);">
                🔒 Lock
              </button>
            ` : `
              <button class="btn btn-sm" onclick="lockClientSelectionPrompt('${client.id}')" title="Currently Unlocked - Click to Lock Gallery" style="background:rgba(34,197,94,0.18);border:1.5px solid #22c55e;color:#86efac;font-weight:800;padding:4px 8px;font-size:0.75rem;border-radius:6px;cursor:pointer;box-shadow:0 0 10px rgba(34,197,94,0.25);">
                🔓 Unlock
              </button>
            `}
            <button class="btn btn-primary btn-sm" onclick="startUploadForClient('${client.id}')" title="Upload Photos">
              ⬆ Upload
            </button>
            <button class="btn btn-outline-gold btn-sm" onclick="openEditClientModal('${client.id}')" title="Edit Client & Selection Limit">
              ✏️ Edit
            </button>
            <button class="btn btn-secondary btn-sm" onclick="copyClientLink('${client.code}')" title="Copy Selection Link">
              📋 Link
            </button>
            <a href="${clientUrl}" target="_blank" class="btn btn-secondary btn-sm" title="View Client Gallery">
              👁 View
            </a>
            <button class="btn btn-danger btn-sm" onclick="deleteClientPrompt('${client.id}')" title="Delete Client" style="padding:4px 8px;font-size:0.8rem;">
              🗑️
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  if (tbodyDashboard) tbodyDashboard.innerHTML = rowsHtml;
  if (tbodyFull) tbodyFull.innerHTML = rowsHtml;
}

// --- Create Client Handler ---
async function handleCreateClient(e) {
  e.preventDefault();
  const name = (document.getElementById('client-name')?.value || '').trim();
  const code = (document.getElementById('client-code')?.value || '').trim();
  const eventName = (document.getElementById('client-event-name')?.value || document.getElementById('client-event')?.value || 'Wedding').trim();
  const eventDate = document.getElementById('client-event-date')?.value || document.getElementById('client-date')?.value || '';
  const mobile = (document.getElementById('client-mobile')?.value || document.getElementById('client-phone')?.value || '').trim();
  const email = (document.getElementById('client-email')?.value || '').trim();
  const selectionLimit = Number(document.getElementById('client-limit')?.value) || 350;

  if (!name || !code) {
    window.api.showToast('Client Name and Code are required', 'error');
    return;
  }

  const btn = e.target.querySelector('button[type="submit"]');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Creating Client Folders...';
  }

  try {
    const created = await window.api.createClient({
      name, code, eventName, eventDate, mobile, email, selectionLimit
    });

    if (created && created.id) {
      window.api.showToast(`✔ Client "${name}" created successfully!`, 'success');
      closeModal('create-client-modal');
      e.target.reset();
      await loadClientsAndStats();
      startUploadForClient(created.id);
    } else {
      window.api.showToast('Failed to create client', 'error');
    }
  } catch (err) {
    console.error('Error creating client:', err);
    window.api.showToast('Failed to create client: ' + (err.message || 'Server error'), 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '✨ Create Client';
    }
  }
}

// --- Upload Management & High-Speed Parallel Engine ---
function populateClientSelectDropdowns() {
  const uploadSelect = document.getElementById('upload-client-select');
  const selectionSelect = document.getElementById('selection-client-select');
  const fbSelect = document.getElementById('fb-client-select');

  if (uploadSelect) {
    const curVal = uploadSelect.value;
    uploadSelect.innerHTML = '<option value="">-- Select Client --</option>' + allClients.map(c => 
      `<option value="${c.id}">${escapeHtml(c.name)} (${c.code}) - ${c.eventName || 'Wedding'}</option>`
    ).join('');
    if (curVal) uploadSelect.value = curVal;
  }

  if (selectionSelect) {
    const curVal = selectionSelect.value;
    selectionSelect.innerHTML = '<option value="">-- Select Client --</option>' + allClients.map(c => 
      `<option value="${c.id}">${escapeHtml(c.name)} (${c.code}) - ${c.eventName || 'Wedding'}</option>`
    ).join('');
    
    if (curVal && allClients.some(c => c.id === curVal)) {
      selectionSelect.value = curVal;
    } else {
      selectionSelect.value = ""; // Default set to -- Select Client --
    }
  }

  if (fbSelect) {
    const curVal = fbSelect.value;
    fbSelect.innerHTML = '<option value="">-- Select Client Event --</option>' + allClients.map(c => 
      `<option value="${c.code}">${escapeHtml(c.name)} (${c.code}) - ${c.eventName || 'Wedding'}</option>`
    ).join('');
    if (curVal) fbSelect.value = curVal;
  }

  const fbProList = document.getElementById('fb-pro-client-list');
  if (fbProList) {
    fbProList.innerHTML = allClients.map(c => 
      `<option value="${escapeHtml(c.name)} (${c.code})">${escapeHtml(c.name)} - ${c.eventName || 'Wedding'}</option>`
    ).join('');
  }
}

function startUploadForClient(clientId) {
  switchView('upload');
  const select = document.getElementById('upload-client-select');
  if (select) select.value = clientId;
  currentUploadClientId = clientId;
}

// Helper to recursively scan dropped directories and preserve subfolder structure
async function scanDataTransferItems(items) {
  const fileList = [];

  async function traverseEntry(entry, currentSubfolder = '') {
    if (entry.isFile) {
      const file = await new Promise((resolve) => entry.file(resolve));
      if (file) {
        file._subfolder = currentSubfolder || entry.name || 'Selected Folder';
        fileList.push(file);
      }
    } else if (entry.isDirectory) {
      const dirReader = entry.createReader();
      const readEntries = async () => {
        return new Promise((resolve) => {
          dirReader.readEntries(async (entries) => {
            if (entries.length === 0) resolve();
            else {
              for (const child of entries) {
                const nextSub = currentSubfolder ? `${currentSubfolder} / ${child.name}` : child.name;
                if (child.isDirectory) {
                  await traverseEntry(child, nextSub);
                } else {
                  await traverseEntry(child, currentSubfolder);
                }
              }
              await readEntries();
              resolve();
            }
          });
        });
      };
      await readEntries();
    }
  }

  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry ? items[i].webkitGetAsEntry() : null;
    if (entry) {
      if (entry.isDirectory) {
        const dirReader = entry.createReader();
        const readTop = async () => {
          return new Promise((resolve) => {
            dirReader.readEntries(async (entries) => {
              for (const child of entries) {
                if (child.isDirectory) {
                  await traverseEntry(child, child.name);
                } else {
                  // Direct file in dropped folder: subfolder is the dropped folder name!
                  await traverseEntry(child, entry.name);
                }
              }
              resolve();
            });
          });
        };
        await readTop();
      } else {
        await traverseEntry(entry, 'Selected Photos');
      }
    }
  }

  return fileList;
}

function togglePauseUpload() {
  isUploadPaused = !isUploadPaused;
  const btnPause = document.getElementById('btn-pause-upload');
  const badge = document.getElementById('upload-status-badge');

  if (isUploadPaused) {
    // 1. Abort active network requests immediately
    if (window.api && window.api.abortAllUploads) {
      window.api.abortAllUploads();
    }
    isUploading = false;

    // 2. Freeze all in-flight items in 'paused' state (KEEP their exact progress!)
    uploadQueue.forEach(item => {
      if (item.status === 'uploading') {
        item.status = 'paused';
        item.pausedProgress = item.progress || 0;
      }
    });

    if (btnPause) {
      btnPause.innerHTML = '▶ Resume';
      btnPause.className = 'btn btn-primary';
    }
    if (badge) {
      badge.textContent = 'Paused';
      badge.className = 'badge badge-gold';
    }
    window.api.showToast('⏸ Upload Paused. Progress frozen exactly in place.', 'info');
  } else {
    isUploading = false; // Allow processUploadQueue to start
    if (btnPause) {
      btnPause.innerHTML = '⏸ Pause';
      btnPause.className = 'btn btn-outline-gold';
    }
    if (badge) {
      badge.textContent = 'Uploading';
      badge.className = 'badge badge-gold';
    }
    window.api.showToast('▶ Resuming upload from exact spot...', 'success');
    processUploadQueue();
  }
  updateMasterProgress();
}

function cancelUploadBatch() {
  if (uploadQueue.length === 0) return;
  if (confirm('Are you sure you want to cancel and clear this upload batch?')) {
    if (window.api && window.api.abortAllUploads) {
      window.api.abortAllUploads();
    }
    isUploadPaused = false;
    isUploading = false;
    uploadQueue = [];
    updateMasterProgress();
    window.api.showToast('Upload batch cleared', 'info');
  }
}

function updateMasterProgress() {
  const stagedPanel = document.getElementById('staged-folders-panel');
  const progressBox = document.getElementById('upload-progress-box');
  const btnStart = document.getElementById('btn-start-upload');
  const btnPause = document.getElementById('btn-pause-upload');
  const btnClear = document.getElementById('btn-clear-upload');

  let totalBytes = 0;
  let uploadedBytes = 0;
  let completedCount = 0;
  const folderStats = {};

  uploadQueue.forEach(item => {
    const fName = item.subfolder || 'Selected Folder';
    if (!folderStats[fName]) folderStats[fName] = { total: 0, done: 0, totalBytes: 0, uploadedBytes: 0 };
    folderStats[fName].total++;
    folderStats[fName].totalBytes += item.file.size;

    totalBytes += item.file.size;
    if (item.status === 'completed') {
      uploadedBytes += item.file.size;
      completedCount++;
      folderStats[fName].done++;
      folderStats[fName].uploadedBytes += item.file.size;
    } else if (item.status === 'uploading' || item.status === 'paused') {
      const partial = (item.file.size * (item.progress || 0)) / 100;
      uploadedBytes += partial;
      folderStats[fName].uploadedBytes += partial;
    }
  });

  const percent = totalBytes > 0 ? Math.min(100, Math.round((uploadedBytes / totalBytes) * 100)) : 0;
  const totalMb = (totalBytes / (1024 * 1024)).toFixed(1);
  const uploadedMb = (uploadedBytes / (1024 * 1024)).toFixed(1);
  const folderKeys = Object.keys(folderStats);
  const pendingPhotos = uploadQueue.filter(i => i.status === 'pending' || i.status === 'paused').length;
  const isAllComplete = uploadQueue.length > 0 && uploadQueue.every(i => i.status === 'completed');

  const stagedSummary = document.getElementById('staged-summary-text');
  const stagedList = document.getElementById('staged-folder-items-list');

  if (uploadQueue.length === 0) {
    if (stagedPanel) stagedPanel.style.display = 'none';
    if (stagedList) stagedList.innerHTML = '';
    if (progressBox) progressBox.style.display = 'none';
    if (btnStart) {
      btnStart.disabled = true;
      btnStart.innerHTML = '⚡ Start Upload (0 Folders Added)';
      btnStart.style.background = '';
    }
    if (btnPause) btnPause.style.display = 'none';
    if (btnClear) btnClear.style.display = 'none';
    return;
  }

  // 1. Staged Panel (Visible only before user starts upload)
  if (stagedPanel) {
    stagedPanel.style.display = (!isUploading && !isUploadPaused && !isAllComplete && completedCount === 0 && folderKeys.length > 0) ? 'block' : 'none';
  }

  if (stagedSummary) {
    stagedSummary.innerHTML = `📂 <strong>${folderKeys.length} Folders Ready</strong> &bull; ${uploadQueue.length} Photos (${totalMb} MB)`;
  }

  if (stagedList && (!isUploading && !isUploadPaused && completedCount === 0)) {
    stagedList.innerHTML = folderKeys.map(f => {
      const s = folderStats[f];
      return `
        <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(212,175,55,0.25);padding:0.6rem 0.9rem;border-radius:10px;display:flex;align-items:center;gap:0.6rem;font-size:0.85rem;">
          <span style="font-size:1.1rem;">📁</span>
          <div>
            <div style="font-weight:700;color:var(--text-primary);">${escapeHtml(f)}</div>
            <div style="font-size:0.75rem;color:var(--gold-400);">${s.total} Photos &bull; ${(s.totalBytes / (1024 * 1024)).toFixed(1)} MB</div>
          </div>
        </div>
      `;
    }).join('');
  }

  // 2. Progress Box (Stays 100% VISIBLE with FROZEN PERCENT when paused!)
  if (progressBox) {
    progressBox.style.display = (isUploading || isUploadPaused || isAllComplete || completedCount > 0) ? 'block' : 'none';
  }

  const barEl = document.getElementById('master-progress-bar');
  const percentEl = document.getElementById('master-progress-percent');
  const titleEl = document.getElementById('master-progress-title');
  const currentFileEl = document.getElementById('master-current-file');
  const badgeEl = document.getElementById('upload-status-badge');

  const elFCount = document.getElementById('stat-upload-folders-count');
  const elTP = document.getElementById('stat-upload-total-photos');
  const elDP = document.getElementById('stat-upload-done-photos');
  const elRP = document.getElementById('stat-upload-remaining-photos');
  const elMB = document.getElementById('stat-upload-total-mb');

  if (elFCount) elFCount.textContent = folderKeys.length;
  if (elTP) elTP.textContent = uploadQueue.length;
  if (elDP) elDP.textContent = completedCount;
  if (elRP) elRP.textContent = uploadQueue.length - completedCount;
  if (elMB) elMB.textContent = `${uploadedMb} / ${totalMb} MB`;

  if (barEl) {
    barEl.style.width = `${percent}%`;
    barEl.style.background = isAllComplete 
      ? 'linear-gradient(90deg, #10b981, #34d399)' 
      : 'linear-gradient(90deg, #d4af37, #fde047, #d4af37)';
  }

  if (percentEl) {
    if (isAllComplete) {
      percentEl.innerHTML = '<span style="color:var(--success);font-size:1.3rem;">✔ Completed</span>';
    } else {
      percentEl.textContent = `${percent}%`;
    }
  }

  if (isUploadPaused) {
    if (badgeEl) { badgeEl.textContent = 'Paused'; badgeEl.className = 'badge badge-gold'; }
    if (btnPause) {
      btnPause.innerHTML = '▶ Resume';
      btnPause.className = 'btn btn-primary';
      btnPause.style.display = 'inline-flex';
    }
  } else if (isUploading) {
    if (badgeEl) { badgeEl.textContent = 'Uploading'; badgeEl.className = 'badge badge-gold'; }
    if (btnPause) {
      btnPause.innerHTML = '⏸ Pause';
      btnPause.className = 'btn btn-outline-gold';
      btnPause.style.display = 'inline-flex';
    }
  } else if (isAllComplete) {
    if (titleEl) titleEl.innerHTML = `✔ All Photos Uploaded Successfully!`;
    if (badgeEl) { badgeEl.textContent = 'Completed'; badgeEl.className = 'badge badge-success'; }
    if (btnPause) btnPause.style.display = 'none';
  }

  // Folder Breakdown Pills Inside Progress Box
  const breakdownEl = document.getElementById('upload-folders-breakdown');
  if (breakdownEl) {
    breakdownEl.innerHTML = folderKeys.map(f => {
      const s = folderStats[f];
      const isDone = s.done === s.total;
      return `
        <div style="background:rgba(255,255,255,0.04);border:1px solid ${isDone ? 'rgba(16,185,129,0.4)' : 'rgba(212,175,55,0.25)'};padding:0.5rem 0.85rem;border-radius:8px;display:flex;align-items:center;gap:0.5rem;font-size:0.8rem;">
          <span>📁</span>
          <span style="font-weight:600;color:var(--text-primary);">${escapeHtml(f)}</span>
          <span style="color:${isDone ? 'var(--success)' : 'var(--text-gold)'};">${s.done}/${s.total} ${isDone ? '✔' : ''}</span>
        </div>
      `;
    }).join('');
  }

  // 3. Fixed Buttons in Bottom Action Row (Clear & Reliable States)
  if (btnStart) {
    if (uploadQueue.length === 0) {
      btnStart.disabled = true;
      btnStart.innerHTML = '⚡ Start Upload (0 Folders Added)';
      btnStart.style.background = '';
      if (btnPause) btnPause.style.display = 'none';
      if (btnClear) btnClear.style.display = 'none';
    } else if (isUploading || isUploadPaused) {
      btnStart.disabled = true;
      btnStart.innerHTML = `⚡ Uploading ${completedCount} / ${uploadQueue.length} Photos...`;
      btnStart.style.background = 'linear-gradient(135deg, #d4af37, #b8860b)';
      if (btnPause) { btnPause.style.display = 'inline-flex'; }
      if (btnClear) btnClear.style.display = 'inline-flex';
    } else if (isAllComplete) {
      btnStart.disabled = false;
      btnStart.innerHTML = `✨ All ${uploadQueue.length} Photos Uploaded! (Click to Re-upload)`;
      btnStart.style.background = 'linear-gradient(135deg, #10b981, #059669)';
      if (btnPause) btnPause.style.display = 'none';
      if (btnClear) btnClear.style.display = 'inline-flex';
    } else {
      btnStart.disabled = false;
      btnStart.innerHTML = `⚡ Start Upload (${pendingPhotos > 0 ? pendingPhotos : uploadQueue.length} Photos in ${folderKeys.length} Folders)`;
      btnStart.style.background = 'linear-gradient(135deg, #d4af37, #b8860b)';
      if (btnPause) btnPause.style.display = 'none';
      if (btnClear) btnClear.style.display = 'inline-flex';
    }
  }
}

function handleFilesSelected(files) {
  const clientSelect = document.getElementById('upload-client-select');
  if (clientSelect && clientSelect.value) {
    currentUploadClientId = clientSelect.value;
  }
  if (!currentUploadClientId && allClients && allClients.length > 0) {
    currentUploadClientId = allClients[0].id;
    if (clientSelect) clientSelect.value = currentUploadClientId;
  }

  const client = allClients.find(c => c.id === currentUploadClientId || c.code === currentUploadClientId) || allClients[0];
  if (client) currentUploadClientId = client.id;

  const validFiles = Array.from(files).filter(f => {
    return f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|heic|heif|tiff?|raw|cr2|cr3|nef|arw|dng|orf|rw2|pef|srw|raf)$/i.test(f.name);
  });

  if (validFiles.length === 0) {
    window.api.showToast('No valid photo files found in selected folder', 'error');
    return;
  }

  uploadQueue = uploadQueue.filter(i => i.status !== 'completed');

  let addedCount = 0;

  validFiles.forEach(file => {
    const subfolder = file._subfolder || 'Selected Folder';
    
    const inQueue = uploadQueue.some(i => i.file.name === file.name && i.subfolder === subfolder);
    if (inQueue) return;

    addedCount++;
    uploadQueue.push({
      id: 'up_' + Math.random().toString(36).substring(2, 9),
      file,
      subfolder,
      progress: 0,
      status: 'pending'
    });
  });

  updateMasterProgress();
}

function startBatchUpload() {
  const clientSelect = document.getElementById('upload-client-select');
  if (clientSelect && clientSelect.value) {
    currentUploadClientId = clientSelect.value;
  }
  if (!currentUploadClientId && allClients && allClients.length > 0) {
    currentUploadClientId = allClients[0].id;
    if (clientSelect) clientSelect.value = currentUploadClientId;
  }

  if (uploadQueue.length === 0) {
    window.api.showToast('Please click "Add Folder" to add photos first!', 'error');
    return;
  }

  let pendingCount = uploadQueue.filter(i => i.status === 'pending').length;
  if (pendingCount === 0) {
    uploadQueue.forEach(i => {
      i.status = 'pending';
      i.progress = 0;
    });
    pendingCount = uploadQueue.length;
  }

  isUploadPaused = false;
  isUploading = false;
  window.api.showToast(`⚡ Starting upload for ${pendingCount} photos...`, 'success');
  updateMasterProgress();
  processUploadQueue();
}

// Extract Embedded JPEG Preview from Camera RAW files (.ARW, .CR2, .CR3, .NEF, .DNG, etc.)
async function extractEmbeddedJpegFromRaw(file) {
  try {
    const readSize = Math.min(file.size, 24 * 1024 * 1024);
    const slice = file.slice(0, readSize);
    const arrayBuffer = await slice.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const len = bytes.length;

    const soiMarkers = [];
    const eoiMarkers = [];

    // Single linear pass over byte array (Blistering fast 2ms scan for 24MB RAW files)
    for (let i = 0; i < len - 1; i++) {
      if (bytes[i] === 0xFF) {
        if (bytes[i + 1] === 0xD8 && (i + 2 < len && bytes[i + 2] === 0xFF)) {
          soiMarkers.push(i);
        } else if (bytes[i + 1] === 0xD9) {
          eoiMarkers.push(i + 2);
        }
      }
    }

    const candidates = [];
    for (const start of soiMarkers) {
      for (const end of eoiMarkers) {
        if (end > start + 30 * 1024 && end - start < 12 * 1024 * 1024) {
          candidates.push({ start, end, size: end - start });
        }
      }
    }

    // Sort candidate JPEGs by size descending (largest HD preview first)
    candidates.sort((a, b) => b.size - a.size);

    for (const cand of candidates.slice(0, 10)) {
      try {
        const blob = new Blob([bytes.subarray(cand.start, cand.end)], { type: 'image/jpeg' });
        const testBmp = await createImageBitmap(blob);
        if (testBmp && testBmp.width > 200 && testBmp.height > 200) {
          if (testBmp.close) testBmp.close();
          return blob;
        }
        if (testBmp && testBmp.close) testBmp.close();
      } catch (e) {}
    }
  } catch (err) {
    console.warn('Linear RAW JPEG extraction fallback for:', file.name, err);
  }
  return null;
}

// High-Speed Local HD WebP Compression Helper (Converts multi-MB photos & RAW files ➔ ~60KB WebP on the fly before upload)
async function getOptimizedFileForUpload(file) {
  if (!file) return file;

  const isRaw = /\.(raw|cr2|cr3|nef|arw|dng|orf|rw2|pef|srw|raf)$/i.test(file.name);
  const isStandardImg = file.type.startsWith('image/') || /\.(jpe?g|png|webp|bmp|heic)$/i.test(file.name);

  if (!isRaw && !isStandardImg) return file;
  if (!isRaw && file.size <= 120 * 1024) return file;

  try {
    let sourceBlob = file;
    if (isRaw) {
      const extractedBlob = await extractEmbeddedJpegFromRaw(file);
      if (extractedBlob) {
        sourceBlob = extractedBlob;
      }
    }

    let bitmap;
    try {
      bitmap = await createImageBitmap(sourceBlob);
    } catch (e) {
      bitmap = null;
    }

    const maxDimension = 1600; // Crisp 1600px HD preview
    let width = bitmap ? bitmap.width : 1200;
    let height = bitmap ? bitmap.height : 800;

    if (width > maxDimension || height > maxDimension) {
      if (width > height) {
        height = Math.round((height * maxDimension) / width);
        width = maxDimension;
      } else {
        width = Math.round((width * maxDimension) / height);
        height = maxDimension;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    if (bitmap) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, width, height);
      if (bitmap.close) bitmap.close();
    } else {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#d4af37';
      ctx.font = 'bold 36px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(file.name, width / 2, height / 2);
    }

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.75));
    if (blob && blob.size > 0 && blob.size < file.size) {
      // Retain original filename (e.g. DSC08847.ARW) so auto-copy matches local RAW files!
      const compressedFile = new File([blob], file.name, { type: 'image/webp', lastModified: file.lastModified || Date.now() });
      compressedFile._subfolder = file._subfolder || '';
      return compressedFile;
    }
  } catch (err) {
    console.warn('Resizer fallback for:', file.name, err);
  }
  return file;
}

const CONCURRENT_UPLOADS = 6;

async function processUploadQueue() {
  if (isUploading) return;
  isUploading = true;

  const runWorker = async () => {
    while (uploadQueue.some(i => i.status === 'pending' || i.status === 'paused')) {
      if (isUploadPaused) break;

      const item = uploadQueue.find(i => i.status === 'pending' || i.status === 'paused');
      if (!item) break;

      item.status = 'uploading';
      updateMasterProgress();

      // Convert heavy photos on the fly to fast ~60KB KB files right before uploading
      const fileToSend = await getOptimizedFileForUpload(item.file);

      let attempts = 0;
      let success = false;

      while (attempts < 3 && !success && !isUploadPaused) {
        attempts++;
        try {
          await window.api.uploadPhoto(
            currentUploadClientId,
            fileToSend,
            (progress) => {
              if (!isUploadPaused) {
                const baseProgress = item.pausedProgress || 0;
                item.progress = Math.max(item.progress || 0, baseProgress, progress);
                updateMasterProgress();
              }
            },
            item.subfolder || ''
          );
          item.status = 'completed';
          item.progress = 100;
          success = true;
          updateMasterProgress();
        } catch (err) {
          if (err.message === 'Upload paused by user' || isUploadPaused) {
            item.status = 'paused';
            break;
          } else {
            console.warn(`Retry ${attempts}/3 for ${item.file.name}:`, err.message);
            if (attempts >= 3) {
              item.status = 'error';
              updateMasterProgress();
            }
          }
        }
      }
    }
  };

  const workers = [];
  for (let i = 0; i < CONCURRENT_UPLOADS; i++) {
    workers.push(runWorker());
  }
  await Promise.all(workers);

  if (!isUploadPaused) {
    isUploading = false;
    updateMasterProgress();

    if (uploadQueue.length > 0 && uploadQueue.every(i => i.status === 'completed')) {
      window.api.showToast('All folders and photos uploaded successfully!', 'success');
      loadClientsAndStats();
    }
  }
}

// --- Selections Inspector ---
function viewClientSelections(clientId) {
  switchView('selections');
  const select = document.getElementById('selection-client-select');
  if (select) select.value = clientId;
  renderSelectionsView();
}

let activeAdminSelectionFolder = 'all';

function setAdminSelectionFolder(folderName) {
  activeAdminSelectionFolder = folderName;
  renderSelectionsView();
}

function renderSelectionsView() {
  const select = document.getElementById('selection-client-select');
  const clientId = select ? select.value : null;

  const summaryEl = document.getElementById('selection-client-summary');
  const gridEl = document.getElementById('selection-photos-grid');

  if (!clientId) {
    if (summaryEl) summaryEl.innerHTML = '';
    if (gridEl) gridEl.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:4rem;color:var(--text-muted);">Please create or select a client above to review photo selections.</div>`;
    return;
  }

  const client = allClients.find(c => c.id === clientId || c.code === clientId);
  if (!client) return;

  const selectedIds = new Set(client.selectedPhotoIds || []);
  const photos = client.photos || [];
  const selectedPhotos = photos.filter(p => selectedIds.has(p.id));
  const limit = client.selectionLimit || 350;

  const favoriteIds = new Set(client.favoritePhotoIds || []);
  const photoComments = client.photoComments || {};

  // Extract unique subfolders from selected photos
  const subfoldersMap = {};
  selectedPhotos.forEach(p => {
    const f = p.subfolder || 'Main';
    subfoldersMap[f] = (subfoldersMap[f] || 0) + 1;
  });
  const subfolderKeys = Object.keys(subfoldersMap).sort((a, b) => 
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  );

  if (summaryEl) {
    const folderTabsHtml = (subfolderKeys.length > 0 || favoriteIds.size > 0) ? `
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:1rem;padding-top:1rem;border-top:1px solid rgba(255,255,255,0.08);">
        <button class="btn btn-sm ${activeAdminSelectionFolder === 'all' ? 'btn-primary' : 'btn-secondary'}" onclick="setAdminSelectionFolder('all')" style="border-radius:20px;padding:0.35rem 0.85rem;font-size:0.8rem;">
          📂 All Selected (${selectedPhotos.length})
        </button>
        ${favoriteIds.size > 0 ? `
          <button class="btn btn-sm ${activeAdminSelectionFolder === 'favorites' ? 'btn-primary' : 'btn-secondary'}" onclick="setAdminSelectionFolder('favorites')" style="border-radius:20px;padding:0.35rem 0.85rem;font-size:0.8rem;background:${activeAdminSelectionFolder === 'favorites' ? '#ec4899' : ''};border-color:#ec4899;color:#fff;">
            ❤️ Favorites (${favoriteIds.size})
          </button>
        ` : ''}
        ${subfolderKeys.map(f => `
          <button class="btn btn-sm ${activeAdminSelectionFolder === f ? 'btn-primary' : 'btn-secondary'}" onclick="setAdminSelectionFolder('${escapeHtml(f)}')" style="border-radius:20px;padding:0.35rem 0.85rem;font-size:0.8rem;">
            📁 ${escapeHtml(f)} (${subfoldersMap[f]})
          </button>
        `).join('')}
      </div>
    ` : '';

    summaryEl.innerHTML = `
      <div style="background:rgba(0,0,0,0.3);padding:1.25rem 1.5rem;border-radius:12px;border:1px solid rgba(212,175,55,0.2);">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;">
          <div>
            <h3 style="font-size:1.3rem;color:var(--text-primary);margin:0 0 4px 0;">${escapeHtml(client.name)}</h3>
            <p style="font-size:0.85rem;color:var(--text-secondary);margin:0;">
              ${client.eventName || 'Wedding'} &bull; Selected: <strong style="color:var(--gold-400);">${selectedPhotos.length}</strong> / <strong>${limit}</strong> photos allowed &bull; 
              ❤️ Favorites: <strong style="color:#f472b6;">${favoriteIds.size}</strong> &bull;
              Status: <span class="badge ${client.selectionLocked || client.selectionSubmittedAt ? 'badge-success' : 'badge-gold'}">${client.selectionLocked || client.selectionSubmittedAt ? '✔ SUBMITTED' : 'PENDING'}</span>
            </p>
          </div>
          <div style="display:flex;gap:0.75rem;flex-wrap:wrap;align-items:center;">
            ${client.selectionLocked ? `
              <button class="btn btn-sm" onclick="unlockClientSelectionPrompt('${client.id}')" style="background:linear-gradient(135deg, #ef4444, #dc2626);color:#fff;font-weight:800;padding:6px 14px;border:none;border-radius:8px;cursor:pointer;box-shadow:0 0 15px rgba(239,68,68,0.4);" title="Currently Locked - Click to Unlock">
                🔒 Lock (Click to Unlock)
              </button>
            ` : `
              <button class="btn btn-sm" onclick="lockClientSelectionPrompt('${client.id}')" style="background:linear-gradient(135deg, #22c55e, #16a34a);color:#fff;font-weight:800;padding:6px 14px;border:none;border-radius:8px;cursor:pointer;box-shadow:0 0 15px rgba(34,197,94,0.4);" title="Currently Unlocked - Click to Lock">
                🔓 Unlock (Click to Lock)
              </button>
            `}
            <button class="btn btn-primary btn-sm" onclick="openAutoCopyModal('${client.id}')" style="box-shadow: 0 0 15px rgba(212,175,55,0.4);">
              📁 Auto-Copy from Original Folder
            </button>
          </div>
        </div>
        ${folderTabsHtml}
      </div>
    `;
  }

  if (selectedPhotos.length === 0) {
    if (gridEl) gridEl.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:4rem;color:var(--text-muted);">
        <div style="font-size:2.5rem;margin-bottom:0.75rem;">📷</div>
        <div style="font-size:1.1rem;color:var(--text-primary);font-weight:600;">No photos selected by ${escapeHtml(client.name)} yet.</div>
        <div style="font-size:0.85rem;margin-top:4px;color:var(--text-secondary);">Client can open their selection link to pick their favorite photos!</div>
        <button class="btn btn-outline-gold btn-sm" style="margin-top:1rem;" onclick="copyClientLink('${client.code}')">📋 Copy Client Gallery Link</button>
      </div>
    `;
    return;
  }

  let displayedPhotos = selectedPhotos;
  if (activeAdminSelectionFolder === 'favorites') {
    displayedPhotos = selectedPhotos.filter(p => favoriteIds.has(p.id));
  } else if (activeAdminSelectionFolder !== 'all') {
    displayedPhotos = selectedPhotos.filter(p => (p.subfolder || 'Main') === activeAdminSelectionFolder);
  }

  if (gridEl) {
    gridEl.innerHTML = displayedPhotos.map(photo => {
      const isFav = favoriteIds.has(photo.id);
      const comment = photoComments[photo.id] || '';

      return `
        <div class="selection-card" style="position:relative;border-radius:12px;overflow:hidden;background:rgba(0,0,0,0.5);border:1px solid ${isFav ? '#ec4899' : 'rgba(212,175,55,0.3)'};box-shadow:${isFav ? '0 0 15px rgba(236,72,153,0.3)' : 'none'};">
          <img src="${photo.thumbnailUrl || photo.url}" alt="${photo.name}" loading="lazy" style="width:100%;height:180px;object-fit:cover;">
          ${isFav ? `<div style="position:absolute;top:0.5rem;right:0.5rem;background:#ec4899;color:#fff;border-radius:20px;padding:0.2rem 0.5rem;font-size:0.7rem;font-weight:700;box-shadow:0 0 10px rgba(0,0,0,0.5);">❤️ FAVORITE</div>` : ''}
          <div class="selection-card-footer" style="padding:0.6rem 0.8rem;background:rgba(0,0,0,0.7);">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div>
                <div class="selection-filename" style="font-size:0.8rem;font-weight:600;color:var(--text-primary);">${escapeHtml(photo.name)}</div>
                <div style="font-size:0.7rem;color:var(--gold-400);">📁 ${photo.subfolder || 'Main'}</div>
              </div>
            </div>
            ${comment ? `
              <div style="margin-top:0.4rem;padding:0.35rem 0.5rem;background:rgba(212,175,55,0.12);border-left:3px solid var(--gold-400);border-radius:4px;font-size:0.75rem;color:#fef08a;">
                💬 <strong>Client Note:</strong> ${escapeHtml(comment)}
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  }
}

// --- Client Edit & Delete Handlers ---
function openEditClientModal(clientId) {
  const client = allClients.find(c => c.id === clientId || c.code === clientId);
  if (!client) return;

  const idInput = document.getElementById('edit-client-id');
  const nameInput = document.getElementById('edit-client-name');
  const codeInput = document.getElementById('edit-client-code');
  const mobileInput = document.getElementById('edit-client-mobile');
  const eventNameInput = document.getElementById('edit-client-event-name');
  const eventDateInput = document.getElementById('edit-client-event-date');
  const limitInput = document.getElementById('edit-client-limit');
  const emailInput = document.getElementById('edit-client-email');

  if (idInput) idInput.value = client.id;
  if (nameInput) nameInput.value = client.name || '';
  if (codeInput) codeInput.value = client.code || '';
  if (mobileInput) mobileInput.value = client.mobile || '';
  if (eventNameInput) eventNameInput.value = client.eventName || 'Wedding';
  if (eventDateInput) eventDateInput.value = client.eventDate || '';
  if (limitInput) limitInput.value = client.selectionLimit || 350;
  if (emailInput) emailInput.value = client.email || '';

  openModal('edit-client-modal');
}

async function saveClientEdit(event) {
  event.preventDefault();
  const clientId = document.getElementById('edit-client-id').value;
  if (!clientId) return;

  const updates = {
    name: document.getElementById('edit-client-name').value.trim(),
    mobile: document.getElementById('edit-client-mobile').value.trim(),
    eventName: document.getElementById('edit-client-event-name').value.trim(),
    eventDate: document.getElementById('edit-client-event-date').value,
    selectionLimit: Number(document.getElementById('edit-client-limit').value) || 350,
    email: document.getElementById('edit-client-email').value.trim()
  };

  try {
    const updatedClient = await window.api.updateClient(clientId, updates);
    if (updatedClient) {
      const idx = allClients.findIndex(c => c.id === clientId || c.code === clientId);
      if (idx !== -1) allClients[idx] = { ...allClients[idx], ...updates };

      closeModal('edit-client-modal');
      renderClientsTable();
      populateClientSelectDropdowns();
      window.api.showToast(`✔ Client "${updates.name}" updated successfully! Selection limit: ${updates.selectionLimit}`, 'success');
    } else {
      window.api.showToast('Failed to update client', 'error');
    }
  } catch (err) {
    console.error('Error saving client edits:', err);
    window.api.showToast('Error updating client', 'error');
  }
}

async function deleteClientPrompt(clientId) {
  const client = allClients.find(c => c.id === clientId || c.code === clientId);
  if (!client) return;

  const confirmed = confirm(`⚠️ PERMANENT DELETE WARNING:\n\nAre you sure you want to delete client "${client.name}" (${client.code})?\n\nThis will PERMANENTLY DELETE:\n1. Client record & photo selections\n2. All uploaded event photos and albums forever!`);
  
  if (confirmed) {
    window.api.showToast(`Deleting "${client.name}" and all event photos...`, 'info');
    try {
      const res = await window.api.deleteClient(clientId);
      if (res) {
        allClients = allClients.filter(c => c.id !== clientId && c.code !== clientId);
        renderClientsTable();
        populateClientSelectDropdowns();
        updateStats();
        window.api.showToast(`✔ Client "${client.name}" and all photos deleted permanently!`, 'success');
      }
    } catch (err) {
      window.api.showToast('Failed to delete client', 'error');
    }
  }
}

async function unlockClientSelectionPrompt(clientId) {
  const client = allClients.find(c => c.id === clientId || c.code === clientId);
  if (!client) return;

  const confirmed = confirm(`🔓 RE-OPEN CLIENT SELECTION GALLERY:\n\nDo you want to re-open the photo selection gallery for "${client.name}" (${client.code})?\n\nThe client will be able to view their full gallery and select/unselect photos again!`);
  
  if (confirmed) {
    try {
      const res = await fetch(`${API_BASE}/api/clients/${clientId}/unlock-selection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (res.ok && data.success) {
        client.selectionLocked = false;
        client.selectionSubmittedAt = null;
        renderClientsTable();
        renderSelectionsView();
        window.api.showToast(`✔ Selection gallery re-opened for "${client.name}"! Client can now select photos again.`, 'success');
      } else {
        window.api.showToast(data.error || 'Failed to unlock gallery', 'error');
      }
    } catch (e) {
      window.api.showToast('Server error unlocking gallery', 'error');
    }
  }
}
window.unlockClientSelectionPrompt = unlockClientSelectionPrompt;

async function lockClientSelectionPrompt(clientId) {
  const client = allClients.find(c => c.id === clientId || c.code === clientId);
  if (!client) return;

  const confirmed = confirm(`🔒 LOCK CLIENT SELECTION GALLERY:\n\nDo you want to lock the photo selection gallery for "${client.name}" (${client.code})?\n\nThe client will see the Thank You & Submission Details screen and will not be able to change selections until unlocked.`);
  
  if (confirmed) {
    try {
      const res = await fetch(`${API_BASE}/api/clients/${clientId}/lock-selection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (res.ok && data.success) {
        client.selectionLocked = true;
        client.selectionSubmittedAt = client.selectionSubmittedAt || new Date().toISOString();
        renderClientsTable();
        renderSelectionsView();
        window.api.showToast(`🔒 Selection gallery locked for "${client.name}"!`, 'info');
      } else {
        window.api.showToast(data.error || 'Failed to lock gallery', 'error');
      }
    } catch (e) {
      window.api.showToast('Server error locking gallery', 'error');
    }
  }
}
window.lockClientSelectionPrompt = lockClientSelectionPrompt;

function copyLightroomFilenames(clientId) {
  const client = allClients.find(c => c.id === clientId || c.code === clientId);
  if (!client) return;

  const selectedIds = new Set(client.selectedPhotoIds || []);
  const selectedPhotos = (client.photos || []).filter(p => selectedIds.has(p.id));

  if (selectedPhotos.length === 0) {
    window.api.showToast('No photos selected yet', 'error');
    return;
  }

  const query = selectedPhotos.map(p => p.name).join(', ');
  navigator.clipboard.writeText(query).then(() => {
    window.api.showToast(`✔ Copied ${selectedPhotos.length} filenames to clipboard!`, 'success');
  }).catch(() => {
    prompt('Copy filenames for Lightroom/Photoshop filter:', query);
  });
}

function exportSelectionsCSV(clientId) {
  const client = allClients.find(c => c.id === clientId || c.code === clientId);
  if (!client) return;

  const selectedIds = new Set(client.selectedPhotoIds || []);
  const selectedPhotos = (client.photos || []).filter(p => selectedIds.has(p.id));

  if (selectedPhotos.length === 0) {
    window.api.showToast('No selections to export', 'error');
    return;
  }

  const headers = ['Index', 'Filename', 'Subfolder', 'Photo ID', 'Size (MB)'];
  const rows = selectedPhotos.map((p, idx) => [
    idx + 1,
    `"${p.name}"`,
    `"${p.subfolder || 'Main'}"`,
    `"${p.id}"`,
    (p.size / (1024 * 1024)).toFixed(2)
  ]);

  const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `${client.name}_Album_Selections.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  window.api.showToast('CSV downloaded successfully!', 'success');
}

// --- Auto-Copy Original Photos Engine ---
function openAutoCopyModal(clientId) {
  autoCopyTargetClientId = clientId;
  selectedLocalDirHandle = null;
  const client = allClients.find(c => c.id === clientId || c.code === clientId);
  if (!client) return;

  const count = client.selectedPhotoIds ? client.selectedPhotoIds.length : (client.selectedCount || 0);
  const infoEl = document.getElementById('auto-copy-client-info');
  if (infoEl) {
    infoEl.innerHTML = `Client: <strong>${escapeHtml(client.name)}</strong> (${count} photos selected)`;
  }

  const pathInput = document.getElementById('original-folder-path');
  if (pathInput) pathInput.value = '';

  const resEl = document.getElementById('auto-copy-result');
  if (resEl) resEl.style.display = 'none';

  const progressWrap = document.getElementById('auto-copy-progress-wrap');
  if (progressWrap) progressWrap.style.display = 'none';

  openModal('auto-copy-modal');
}

async function browseOriginalFolder() {
  const pathInput = document.getElementById('original-folder-path');

  try {
    if (window.showDirectoryPicker) {
      selectedLocalDirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      if (selectedLocalDirHandle) {
        if (pathInput) {
          pathInput.value = `Selected Folder: [ ${selectedLocalDirHandle.name} ]`;
          pathInput.dataset.hasHandle = 'true';
        }
        window.api.showToast(`Selected folder: ${selectedLocalDirHandle.name}`, 'success');
      }
    } else {
      document.getElementById('native-folder-input')?.click();
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      document.getElementById('native-folder-input')?.click();
    }
  }
}

function handleNativeFolderSelect(files) {
  const pathInput = document.getElementById('original-folder-path');
  if (files && files.length > 0) {
    const firstFile = files[0];
    const folderName = firstFile.webkitRelativePath.split('/')[0] || 'Selected Folder';
    if (pathInput) {
      pathInput.value = folderName;
      pathInput.dataset.filesCount = files.length;
    }
    window.api.showToast(`Selected folder with ${files.length} photos`, 'success');
  }
}

async function executeAutoCopy() {
  const pathInput = document.getElementById('original-folder-path');
  const manualPath = pathInput?.value.trim();
  const btn = document.getElementById('btn-start-auto-copy');
  const resEl = document.getElementById('auto-copy-result');

  const progressWrap = document.getElementById('auto-copy-progress-wrap');
  const progressFill = document.getElementById('auto-copy-progress-fill');
  const statusText = document.getElementById('auto-copy-status-text');
  const percentText = document.getElementById('auto-copy-percent-text');
  const substatusText = document.getElementById('auto-copy-substatus');

  const client = allClients.find(c => c.id === autoCopyTargetClientId || c.code === autoCopyTargetClientId);
  if (!client) return;

  const selectedPhotos = client.photos?.filter(p => client.selectedPhotoIds?.includes(p.id)) || [];
  if (selectedPhotos.length === 0) {
    window.api.showToast('No photos selected by client yet', 'error');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Copying Selected Photos...';
  if (resEl) resEl.style.display = 'none';

  // Initialize Progress Bar
  if (progressWrap) progressWrap.style.display = 'block';
  if (progressFill) progressFill.style.width = '0%';
  if (percentText) percentText.textContent = '0%';
  if (statusText) statusText.textContent = 'Scanning camera folder...';
  if (substatusText) substatusText.textContent = `0 / ${selectedPhotos.length} photos`;

  if (selectedLocalDirHandle) {
    try {
      const clientSafeName = (client.name || 'Client')
        .replace(/&/g, 'and')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .replace(/_+/g, '_');
      const newFolderHandle = await selectedLocalDirHandle.getDirectoryHandle(`Selected_Photos_${clientSafeName}`, { create: true });

      // Recursively scan selectedLocalDirHandle for all files on disk
      const allDiskFiles = [];
      async function scanDirectoryHandle(dirHandle) {
        for await (const entry of dirHandle.values()) {
          if (entry.kind === 'file') {
            allDiskFiles.push({ name: entry.name, handle: entry });
          } else if (entry.kind === 'directory') {
            if (!entry.name.startsWith('Selected_Photos_')) {
              await scanDirectoryHandle(entry);
            }
          }
        }
      }

      await scanDirectoryHandle(selectedLocalDirHandle);

      let copiedCount = 0;
      let favCopiedCount = 0;
      let commCopiedCount = 0;
      let processedIndex = 0;
      const totalToCopy = selectedPhotos.length;
      const subfolderHandles = {};
      const favSubfolderHandles = {};
      const commSubfolderHandles = {};
      const favoriteIds = new Set(client.favoritePhotoIds || []);
      const photoComments = client.photoComments || {};
      const allCommentsSummary = [];

      for (const p of selectedPhotos) {
        processedIndex++;
        const pct = Math.round((processedIndex / totalToCopy) * 100);

        if (statusText) statusText.textContent = `Copying: ${p.name}`;
        if (percentText) percentText.textContent = `${pct}%`;
        if (progressFill) progressFill.style.width = `${pct}%`;
        if (substatusText) substatusText.textContent = `${processedIndex} / ${totalToCopy} photos (${copiedCount} copied)`;

        // Yield to browser UI thread to smoothly animate progress bar
        await new Promise(r => setTimeout(r, 10));

        const targetBaseName = p.name.split('.')[0].toLowerCase();
        const matchedEntry = allDiskFiles.find(f => {
          const entryBase = f.name.split('.')[0].toLowerCase();
          return entryBase === targetBaseName || f.name.toLowerCase() === p.name.toLowerCase();
        });

        if (matchedEntry) {
          // Determine subfolder handle (e.g. "1 REGULAR PHOTO", "HALDI", "2 REGULAR RECEPTION")
          const subName = (p.subfolder && p.subfolder.trim() !== 'Main Photos' && p.subfolder.trim() !== 'Original') ? p.subfolder.trim() : '';

          let targetFolderHandle = newFolderHandle;
          if (subName) {
            if (!subfolderHandles[subName]) {
              subfolderHandles[subName] = await newFolderHandle.getDirectoryHandle(subName, { create: true });
            }
            targetFolderHandle = subfolderHandles[subName];
          }

          const fileData = await matchedEntry.handle.getFile();
          const destFileHandle = await targetFolderHandle.getFileHandle(matchedEntry.name, { create: true });
          const writable = await destFileHandle.createWritable();
          await writable.write(fileData);
          await writable.close();
          copiedCount++;

          // 1. If Heart / Favorite photo, copy into Favorites subfolder inside that event folder!
          if (favoriteIds.has(p.id)) {
            const handleKey = subName || '_main_';
            if (!favSubfolderHandles[handleKey]) {
              favSubfolderHandles[handleKey] = await targetFolderHandle.getDirectoryHandle('Favorites', { create: true });
            }
            const favDestHandle = await favSubfolderHandles[handleKey].getFileHandle(matchedEntry.name, { create: true });
            const favWritable = await favDestHandle.createWritable();
            await favWritable.write(fileData);
            await favWritable.close();
            favCopiedCount++;
          }

          // 2. If photo has a comment/note typed by client, copy photo + create .txt note inside Comments subfolder!
          const commentText = photoComments[p.id];
          if (commentText && commentText.trim()) {
            const handleKey = subName || '_main_';
            if (!commSubfolderHandles[handleKey]) {
              commSubfolderHandles[handleKey] = await targetFolderHandle.getDirectoryHandle('Comments', { create: true });
            }

            // Copy photo into Comments subfolder
            const commDestHandle = await commSubfolderHandles[handleKey].getFileHandle(matchedEntry.name, { create: true });
            const commWritable = await commDestHandle.createWritable();
            await commWritable.write(fileData);
            await commWritable.close();
            commCopiedCount++;

            // Create matching .txt instruction note file
            const parsedName = matchedEntry.name.split('.')[0];
            const txtFileName = `${parsedName}_comment.txt`;
            const txtFileHandle = await commSubfolderHandles[handleKey].getFileHandle(txtFileName, { create: true });
            const txtWritable = await txtFileHandle.createWritable();
            const txtContent = `==================================================\nCLIENT PHOTO INSTRUCTION / NOTE\nPhoto Name: ${matchedEntry.name}\nFolder: ${subName || 'Main'}\nClient: ${client.name || ''}\n==================================================\n\nCLIENT INSTRUCTION:\n"${commentText.trim()}"\n\nDate: ${new Date().toLocaleDateString()}\n==================================================\n`;
            await txtWritable.write(txtContent);
            await txtWritable.close();

            allCommentsSummary.push(`📷 ${matchedEntry.name} [Folder: ${subName || 'Main'}]:\n   Note: "${commentText.trim()}"\n`);
          }
        }
      }

      // Generate master ALL_PHOTO_INSTRUCTIONS.txt inside root output folder
      if (allCommentsSummary.length > 0) {
        try {
          const masterTxtHandle = await newFolderHandle.getFileHandle('ALL_PHOTO_INSTRUCTIONS.txt', { create: true });
          const masterWritable = await masterTxtHandle.createWritable();
          const masterContent = `==================================================\nMASTER CLIENT PHOTO INSTRUCTIONS & NOTES SUMMARY\nClient: ${client.name || ''}\nTotal Photo Notes: ${allCommentsSummary.length}\nDate: ${new Date().toLocaleDateString()}\n==================================================\n\n` + allCommentsSummary.join('\n') + `\n==================================================\n`;
          await masterWritable.write(masterContent);
          await masterWritable.close();
        } catch (mErr) {}
      }

      if (statusText) statusText.textContent = '✔ Copy Completed!';
      if (percentText) percentText.textContent = '100%';
      if (progressFill) progressFill.style.width = '100%';
      if (substatusText) substatusText.textContent = `${totalToCopy} / ${totalToCopy} photos (${copiedCount} copied, ${favCopiedCount} Favorites, ${commCopiedCount} Comments)`;

      let cleanInputPath = (manualPath || '').replace(/^Selected Folder:\s*\[\s*/, '').replace(/\s*\]$/, '').trim();
      const fullCreatedPath = (cleanInputPath.includes('\\') || cleanInputPath.includes('/') || cleanInputPath.includes(':'))
        ? `${cleanInputPath}\\Selected_Photos_${clientSafeName}`
        : '';

      const displayPath = `${selectedLocalDirHandle.name} / Selected_Photos_${clientSafeName}`;

      lastAutoCopyOutputFolder = fullCreatedPath || `Selected_Photos_${clientSafeName}`;
      lastAutoCopyClientName = client.name || '';

      window.api.showToast(`✔ Successfully copied ${copiedCount} photos (${favCopiedCount} in Favorites)!`, 'success');
      if (resEl) {
        resEl.style.display = 'block';
        resEl.innerHTML = `
          <div style="background:rgba(16,185,129,0.15);border:1px solid var(--success);color:#34d399;padding:1rem;border-radius:var(--radius-sm);margin-top:1rem;">
            <div style="font-weight:600;margin-bottom:0.4rem;font-size:1.05rem;">✔ Copy Completed Successfully!</div>
            <div style="font-size:0.85rem;color:#f8fafc;margin-bottom:0.6rem;">
              <strong>${copiedCount} of ${totalToCopy}</strong> selected photos copied (${favCopiedCount} in 💖 Favorites subfolders) into:
            </div>
            <div style="padding:0.6rem 0.85rem;background:rgba(0,0,0,0.5);border-radius:6px;border:1px solid rgba(212,175,55,0.3);font-family:monospace;color:var(--gold-400);font-weight:600;font-size:0.85rem;word-break:break-all;">
              📂 ${escapeHtml(displayPath)}
            </div>
          </div>
        `;
      }
    } catch (e) {
      console.error('Auto copy error:', e);
      window.api.showToast('Error copying files: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '⚡ Start Auto-Copy & Separate Folder';
    }
    return;
  }

  if (!manualPath) {
    window.api.showToast('Please click "📁 Browse Folder" to select your folder', 'error');
    btn.disabled = false;
    btn.innerHTML = '⚡ Start Auto-Copy & Separate Folder';
    return;
  }

  try {
    const response = await fetch(`${window.APP_CONFIG.WORKER_API_URL}/api/copy-selected-photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourcePath: manualPath, clientId: autoCopyTargetClientId })
    });

    const data = await response.json();
    if (response.ok && data.success) {
      lastAutoCopyOutputFolder = data.destDir || manualPath;
      lastAutoCopyClientName = client.name || '';

      window.api.showToast(`✔ Successfully copied ${data.copiedCount} photos!`, 'success');
      if (resEl) {
        resEl.style.display = 'block';
        resEl.innerHTML = `
          <div style="background:rgba(16,185,129,0.15);border:1px solid var(--success);color:#34d399;padding:1rem;border-radius:var(--radius-sm);margin-top:1rem;">
            <div style="font-weight:600;margin-bottom:0.4rem;font-size:1.05rem;">✔ Copy Completed Successfully!</div>
            <div style="font-size:0.85rem;color:#f8fafc;margin-bottom:0.6rem;">
              <strong>${data.copiedCount} of ${data.totalSelected}</strong> photos copied into:
            </div>
            <div style="padding:0.6rem 0.85rem;background:rgba(0,0,0,0.5);border-radius:6px;border:1px solid rgba(212,175,55,0.3);font-family:monospace;color:var(--gold-400);font-weight:600;font-size:0.85rem;word-break:break-all;">
              📂 ${escapeHtml(data.destDir)}
            </div>
          </div>
        `;
      }
    } else {
      window.api.showToast(data.error || 'Failed to copy photos', 'error');
    }
  } catch (e) {
    window.api.showToast('Error connecting to server', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '⚡ Start Auto-Copy & Separate Folder';
  }
}

let lastAutoCopyOutputFolder = '';
let lastAutoCopyClientName = '';

function escapeJs(str) {
  if (!str) return '';
  return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
}

function handleOpenOutputFolderClick() {
  openOutputFolder(lastAutoCopyOutputFolder, lastAutoCopyClientName);
}

async function openOutputFolder(folderPath, clientName) {
  try {
    const targetPath = folderPath || lastAutoCopyOutputFolder;
    const name = clientName || lastAutoCopyClientName;

    const res = await fetch(`${window.APP_CONFIG.WORKER_API_URL}/api/open-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath: targetPath, clientName: name || '' })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      window.api.showToast(`✔ Opened output folder in File Explorer!`, 'success');
    } else {
      window.api.showToast(data.error || 'Could not open folder', 'error');
    }
  } catch (err) {
    window.api.showToast('Error opening folder', 'error');
  }
}

// Modal Helpers
function openModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) {
    el.classList.add('active');
    el.style.display = 'flex';
  }
}

function closeModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) {
    el.classList.remove('active');
    el.style.display = 'none';
  }
}

let currentShareMessageText = '';
let currentShareClientMobile = '';

async function copyClientLink(clientCode) {
  const client = allClients.find(c => c.code === clientCode || c.id === clientCode) || {
    name: 'Valued Client',
    code: clientCode,
    eventName: 'Wedding',
    mobile: ''
  };

  const studio = currentStudio || JSON.parse(localStorage.getItem('dm_current_studio') || '{}');
  const studioName = studio.studioName || 'DM Films & Photography';
  const studioPhone = studio.phone || '+91 98765 43210';
  
  let baseOrigin = window.location.origin;
  
  // If running locally, fetch network Wi-Fi IP so link works on mobile phones
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    try {
      const netRes = await fetch(`${API_BASE}/api/network-info`);
      if (netRes.ok) {
        const netData = await netRes.json();
        if (netData.wifiBaseUrl) {
          baseOrigin = netData.wifiBaseUrl;
        }
      }
    } catch (err) {}
  }

  const clientUrl = `${baseOrigin}/client.html?code=${client.code}`;

  currentShareClientMobile = client.mobile || '';

  currentShareMessageText = `Hello Sir/Madam,

Your premium photo selection panel is ready for the event: *${client.eventName || 'Wedding'}*.

Please click the link below to view the gallery and select your favorite images:

${clientUrl}

🔑 Secure PIN: ${client.code}

Thank you for choosing ${studioName}.
Phone / WhatsApp: ${studioPhone}`;

  const previewEl = document.getElementById('share-message-preview');
  if (previewEl) {
    previewEl.textContent = currentShareMessageText;
  }

  openModal('share-invitation-modal');
}

async function saveStudioBranding() {
  const studioName = document.getElementById('setting-studio-name')?.value.trim();
  const tagline = document.getElementById('setting-studio-tagline')?.value.trim();
  const phone = document.getElementById('setting-studio-phone')?.value.trim();
  const logoUrl = document.getElementById('setting-studio-logo')?.value.trim();

  const studio = currentStudio || JSON.parse(localStorage.getItem('dm_current_studio') || '{}');
  if (studioName) studio.studioName = studioName;
  if (tagline !== undefined) studio.tagline = tagline;
  if (phone !== undefined) studio.phone = phone;
  if (logoUrl !== undefined) studio.logoUrl = logoUrl;

  currentStudio = studio;
  localStorage.setItem('dm_current_studio', JSON.stringify(studio));

  try {
    const res = await fetch(`${API_BASE}/api/studio/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studioId: studio.id || 'studio_master_dm',
        studioName,
        tagline,
        phone,
        logoUrl
      })
    });
    window.api.showToast('✔ Studio branding saved!', 'success');
  } catch (err) {
    window.api.showToast('✔ Saved settings locally!', 'success');
  }
}

function copyShareTextFromModal() {
  if (!currentShareMessageText) return;
  navigator.clipboard.writeText(currentShareMessageText).then(() => {
    window.api.showToast('✔ Invitation message & link copied to clipboard!', 'success');
  }).catch(() => {
    prompt('Copy invitation message:', currentShareMessageText);
  });
}

function openWhatsAppShare() {
  if (!currentShareMessageText) return;
  let waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(currentShareMessageText)}`;
  
  if (currentShareClientMobile) {
    let cleanMobile = currentShareClientMobile.replace(/\D/g, '');
    if (cleanMobile.length === 10) cleanMobile = '91' + cleanMobile;
    if (cleanMobile.length >= 10) {
      waUrl = `https://api.whatsapp.com/send?phone=${cleanMobile}&text=${encodeURIComponent(currentShareMessageText)}`;
    }
  }

  window.open(waUrl, '_blank');
}

function connectGoogleOAuth() {
  const clientId = "333503774334-70rbhd2c4inamvsepc7q0qp8k2f14b0t.apps.googleusercontent.com";
  const redirectUri = "http://localhost:3000/oauth2callback";
  const scope = "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/drive.file";
  const authUrl = `https://accounts.google.com/o/oauth2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=consent`;
  window.location.href = authUrl;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeJs(str) {
  if (!str) return '';
  return String(str).replace(/'/g, "\\'").replace(/"/g, '\\"');
}

function logoutAdmin() {
  if (confirm('Are you sure you want to log out of Studio Admin?')) {
    localStorage.removeItem('dm_admin_token');
    localStorage.removeItem('dm_current_studio');
    sessionStorage.clear();
    window.location.href = 'login.html';
  }
}

// --- 3D Virtual Flipbook Engine ---
let allFlipbooks = [];

async function renderFlipbooksView() {
  const grid = document.getElementById('flipbooks-grid');
  if (!grid) return;

  try {
    const res = await fetch(`${API_BASE}/api/flipbooks`);
    if (res.ok) {
      allFlipbooks = await res.json();
    }
  } catch (err) {}

  if (allFlipbooks.length === 0 && allClients.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:4rem;color:var(--text-muted);">No 3D Flipbooks created yet. Click "+ Create 3D Flipbook" above to generate your first 3D virtual album!</div>`;
    return;
  }

  // Combine saved flipbooks and instant client flipbooks
  const combinedList = [...allFlipbooks];
  allClients.forEach(c => {
    if (!combinedList.some(f => f.clientCode === c.code || f.code === c.code)) {
      combinedList.push({
        id: 'client_' + c.code,
        code: c.code,
        clientCode: c.code,
        title: `${c.name} - ${c.eventName || 'Wedding'} Album`,
        subtitle: 'Interactive 3D Virtual Flipbook',
        pagesCount: c.selectedCount || (c.photos ? c.photos.length : 0),
        isAutoGenerated: true
      });
    }
  });

  grid.innerHTML = combinedList.map(fb => {
    const flipUrl = `${window.location.origin}/flipbook.html?code=${fb.code || fb.clientCode}`;
    const pageCount = fb.pages ? fb.pages.length : (fb.pagesCount || 0);

    return `
      <div class="glass-card" style="padding:1.5rem;display:flex;flex-direction:column;justify-content:space-between;border:1px solid rgba(212,175,55,0.3);position:relative;">
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem;">
            <span class="badge badge-gold" style="font-size:0.7rem;letter-spacing:0.06em;">
              ${fb.isAutoGenerated ? '⚡ AUTO-GENERATED 3D' : '📖 3D ALBUM'}
            </span>
            <span style="font-size:0.75rem;color:var(--gold-400);font-weight:700;">Code: ${fb.code || fb.clientCode}</span>
          </div>

          <h3 class="gold-gradient-text" style="font-size:1.15rem;margin-bottom:0.4rem;font-family:'Cinzel',serif;">
            ${escapeHtml(fb.title)}
          </h3>
          <p style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:1rem;">
            ${escapeHtml(fb.subtitle || 'Interactive 3D Page Flipping Album')} &bull; <strong style="color:#ffffff;">${pageCount} Pages</strong>
          </p>
        </div>

        <div style="display:flex;gap:0.4rem;flex-wrap:wrap;margin-top:1rem;padding-top:1rem;border-top:1px solid rgba(255,255,255,0.08);">
          <a href="${flipUrl}" target="_blank" class="btn btn-primary btn-sm" style="flex:1;display:flex;align-items:center;justify-content:center;gap:0.3rem;">
            👁 View 3D Flipbook
          </a>
          <button class="btn btn-secondary btn-sm" onclick="copyTextToClipboard('${flipUrl}')" title="Copy Flipbook Link">
            📋 Link
          </button>
          <button class="btn btn-secondary btn-sm" onclick="shareFlipbookWhatsApp('${escapeJs(fb.title)}', '${flipUrl}')" title="Share on WhatsApp">
            💬 WhatsApp
          </button>
          ${!fb.isAutoGenerated ? `
            <button class="btn btn-danger btn-sm" onclick="deleteFlipbookPrompt('${fb.id}')" title="Delete Flipbook" style="padding:4px 8px;">
              🗑️
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function deleteFlipbookPrompt(id) {
  if (confirm('Are you sure you want to delete this 3D Flipbook?')) {
    fetch(`${API_BASE}/api/flipbooks/${id}`, { method: 'DELETE' })
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          if (window.api && window.api.showToast) window.api.showToast('Flipbook deleted successfully', 'success');
          renderFlipbooksView();
        } else {
          if (window.api && window.api.showToast) window.api.showToast(data.error || 'Failed to delete flipbook', 'error');
        }
      })
      .catch(() => {
        if (window.api && window.api.showToast) window.api.showToast('Server error deleting flipbook', 'error');
      });
  }
}

function shareFlipbookWhatsApp(title, url) {
  const text = encodeURIComponent(`✨ *${title}* 📖\n\nExperience this magical 3D interactive photo flipbook album:\n👉 ${url}\n\nCaptured with love by DM Films`);
  window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
}

function copyTextToClipboard(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      if (window.api && window.api.showToast) window.api.showToast('Link copied to clipboard! 📋', 'success');
    });
  } else {
    prompt('Copy link:', text);
  }
}

function autoFillProFlipbook(clientCode) {
  if (!clientCode) return;
  const client = allClients.find(c => c.code === clientCode || c.id === clientCode);
  if (!client) return;

  const titleInput = document.getElementById('pro-fb-title');
  const subtitleInput = document.getElementById('pro-fb-subtitle');
  if (titleInput) titleInput.value = `${client.name} Luxury 3D Flipbook`;
  if (subtitleInput) subtitleInput.value = `Cinematic Virtual Album (${client.eventName || 'Wedding'})`;
}

function autoFillFlipbookTitle(clientCode) {
  if (!clientCode) return;
  const client = allClients.find(c => c.code === clientCode || c.id === clientCode);
  if (!client) return;

  const titleInput = document.getElementById('fb-title');
  const subtitleInput = document.getElementById('fb-subtitle');

  if (titleInput) titleInput.value = `${client.name} ${client.eventName || 'Wedding'} Album`;
  if (subtitleInput) subtitleInput.value = `Interactive 3D Virtual Album (${client.code})`;
}

async function handleSaveFlipbook(e) {
  e.preventDefault();
  if (typeof checkFlipbookLimit === 'function' && !checkFlipbookLimit()) return;

  const clientCode = document.getElementById('fb-client-select')?.value;
  const title = document.getElementById('fb-title')?.value.trim();
  const subtitle = document.getElementById('fb-subtitle')?.value.trim();

  if (!clientCode || !title) {
    window.api.showToast('Please select a client and enter an Album Title', 'error');
    return;
  }

  const client = allClients.find(c => c.code === clientCode || c.id === clientCode);
  let pages = [];
  if (client && client.photos) {
    const selSet = new Set(client.selectedPhotoIds || []);
    const selPhotos = client.photos.filter(p => selSet.has(p.id));
    const list = selPhotos.length > 0 ? selPhotos : client.photos;
    pages = list.map(p => p.url || `/api/image/${p.id}`);
  }

  try {
    const res = await fetch(`${API_BASE}/api/flipbooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientCode,
        title,
        subtitle,
        pages
      })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      window.api.showToast(`✔ 3D Virtual Flipbook "${title}" created!`, 'success');
      closeModal('create-flipbook-modal');
      document.getElementById('create-flipbook-form')?.reset();
      renderFlipbooksView();
    } else {
      window.api.showToast(data.error || 'Failed to create flipbook', 'error');
    }
  } catch (err) {
    window.api.showToast('Server error creating flipbook', 'error');
  }
}

let allMyFlipbooks = [];
let currentShareTarget = { code: '', title: '' };

async function renderMyFlipbooksGallery(filterText = '') {
  const container = document.getElementById('my-flipbooks-grid');
  if (!container) return;

  container.innerHTML = `
    <div style="grid-column:1/-1;text-align:center;padding:3rem;color:#94a3b8;">
      <div style="font-size:2rem;margin-bottom:0.5rem;animation:spin 1s linear infinite;">⏳</div>
      Loading 3D Flipbooks...
    </div>
  `;

  try {
    const res = await fetch(`${API_BASE}/api/flipbooks`);
    allMyFlipbooks = await res.json();
    displayFilteredFlipbooks(filterText);
  } catch (err) {
    container.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:3rem;color:#ef4444;">
        Failed to load flipbooks: ${err.message}
      </div>
    `;
  }
}

function filterMyFlipbooks(text) {
  displayFilteredFlipbooks(text);
}

function displayFilteredFlipbooks(filterText = '') {
  const container = document.getElementById('my-flipbooks-grid');
  if (!container) return;

  const query = filterText.toLowerCase().trim();
  const list = allMyFlipbooks.filter(fb => {
    if (!query) return true;
    return (
      (fb.title && fb.title.toLowerCase().includes(query)) ||
      (fb.subtitle && fb.subtitle.toLowerCase().includes(query)) ||
      (fb.code && fb.code.toLowerCase().includes(query)) ||
      (fb.clientCode && fb.clientCode.toLowerCase().includes(query))
    );
  });

  if (list.length === 0) {
    container.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:4rem 2rem;background:rgba(15,23,42,0.6);border:1px dashed rgba(212,175,55,0.3);border-radius:16px;">
        <div style="font-size:3rem;margin-bottom:0.5rem;">📖</div>
        <h3 class="gold-gradient-text" style="font-family:'Cinzel',serif;font-size:1.3rem;margin:0 0 0.5rem 0;">No 3D Flipbooks Found</h3>
        <p style="color:#94a3b8;font-size:0.85rem;margin-bottom:1.25rem;">
          ${query ? 'No flipbooks match your search query.' : 'You have not created any 3D Virtual Albums yet.'}
        </p>
        <button class="btn btn-primary" onclick="switchView('flipbook')">
          + Create Your First 3D Flipbook
        </button>
      </div>
    `;
    return;
  }

  let html = '';
  list.forEach(fb => {
    const pagesCount = (fb.pages && fb.pages.length) || 0;
    const cover = fb.coverImage || (fb.pages && fb.pages[0]) || '';
    const dateStr = fb.createdAt ? new Date(fb.createdAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
    const escapedTitle = escapeHtml(fb.title || 'Wedding Photo Album');
    const escapedSubtitle = escapeHtml(fb.subtitle || 'Interactive 3D Virtual Flipbook');
    const rawCode = fb.code || fb.clientCode || fb.id;
    const safeCode = encodeURIComponent(rawCode);
    const musicTag = fb.bgMusic ? (fb.bgMusic.includes('/') ? 'Custom Song' : fb.bgMusic.toUpperCase()) : 'ROMANTIC';

    html += `
      <div class="glass-card" style="background:rgba(12,16,28,0.9);border:1px solid rgba(212,175,55,0.35);border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,0.6);display:flex;flex-direction:column;transition:transform 0.2s, box-shadow 0.2s;">
        
        <!-- Cover Image Preview -->
        <div style="position:relative;width:100%;height:180px;background:#05070d;overflow:hidden;cursor:pointer;" onclick="viewFlipbookItem('${safeCode}', '${escapedTitle}')">
          ${cover ? `<img src="${cover}" style="width:100%;height:100%;object-fit:cover;transition:transform 0.3s;" onerror="this.src='';this.parentElement.innerHTML='<div style=\\'display:flex;align-items:center;justify-content:center;height:100%;color:#d4af37;font-size:3rem;\\'>📖</div>';">` : `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#d4af37;font-size:3rem;">📖</div>`}
          
          <div style="position:absolute;top:10px;right:10px;background:rgba(0,0,0,0.75);backdrop-filter:blur(4px);border:1px solid rgba(212,175,55,0.4);border-radius:20px;padding:3px 10px;font-size:0.75rem;color:#fde047;font-weight:700;">
            📄 ${pagesCount} Spreads
          </div>

          <div style="position:absolute;bottom:0;left:0;right:0;padding:8px 12px;background:linear-gradient(0deg, rgba(0,0,0,0.9) 0%, transparent 100%);color:#94a3b8;font-size:0.72rem;display:flex;justify-content:space-between;">
            <span>🎵 ${musicTag}</span>
            <span>📅 ${dateStr}</span>
          </div>
        </div>

        <!-- Album Info Details -->
        <div style="padding:1.25rem;flex:1;display:flex;flex-direction:column;justify-content:space-between;">
          <div>
            <h4 class="gold-gradient-text" style="font-family:'Cinzel',serif;font-size:1.15rem;margin:0 0 4px 0;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapedTitle}">
              ${escapedTitle}
            </h4>
            <p style="color:#94a3b8;font-size:0.8rem;margin:0 0 1rem 0;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${escapedSubtitle}
            </p>
          </div>

          <!-- Action Buttons Grid: VIEW, EDIT, SHARE, DELETE -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;">
            <button type="button" class="btn" style="height:36px;background:linear-gradient(135deg, #fde047 0%, #d4af37 100%);color:#000;font-weight:800;font-size:0.8rem;border:none;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;box-shadow:0 0 10px rgba(212,175,55,0.3);" onclick="viewFlipbookItem('${safeCode}', '${escapedTitle}')">
              👁️ VIEW
            </button>

            <button type="button" class="btn" style="height:36px;background:#25D366;color:#fff;font-weight:700;font-size:0.8rem;border:none;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;box-shadow:0 0 10px rgba(37,211,102,0.25);" onclick="openShareFlipbookModal('${safeCode}', '${escapedTitle}')">
              💬 SHARE
            </button>

            <button type="button" class="btn" style="height:36px;background:rgba(255,255,255,0.08);border:1px solid rgba(212,175,55,0.4);color:#fde047;font-weight:700;font-size:0.8rem;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;" onclick="openEditFlipbookModal('${fb.id || fb.code}')">
              ✏️ EDIT
            </button>

            <button type="button" class="btn" style="height:36px;background:rgba(220,38,38,0.15);border:1px solid rgba(220,38,38,0.4);color:#f87171;font-weight:700;font-size:0.8rem;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;" onclick="deleteFlipbookItemPrompt('${fb.id || fb.code}', '${escapedTitle}')">
              🗑️ DELETE
            </button>
          </div>

        </div>

      </div>
    `;
  });

  container.innerHTML = html;
}

function viewFlipbookItem(safeCode, title) {
  const decodedCode = decodeURIComponent(safeCode);
  const iframe = document.getElementById('fb-preview-iframe');
  const titleElModal = document.getElementById('fb-preview-modal-title');
  if (iframe) iframe.src = `flipbook.html?code=${encodeURIComponent(decodedCode)}`;
  if (titleElModal) titleElModal.textContent = `📖 ${title} - 3D Virtual Album Full Interactive Preview`;
  currentPreviewClientCode = decodedCode;
  openModal('flipbook-preview-modal');
}

function openEditFlipbookModal(id) {
  const fb = allMyFlipbooks.find(f => f.id === id || f.code === id);
  if (!fb) return;

  const idInput = document.getElementById('edit-fb-id');
  const titleInput = document.getElementById('edit-fb-title');
  const subtitleInput = document.getElementById('edit-fb-subtitle');
  const bgScoreInput = document.getElementById('edit-fb-bg-score');
  const soundInput = document.getElementById('edit-fb-sound-effects');

  if (idInput) idInput.value = fb.id || fb.code;
  if (titleInput) titleInput.value = fb.title || '';
  if (subtitleInput) subtitleInput.value = fb.subtitle || '';
  if (bgScoreInput) bgScoreInput.value = fb.bgMusic || 'romantic';
  if (soundInput) soundInput.checked = fb.soundEffects !== false;

  openModal('edit-flipbook-modal');
}

async function saveFlipbookEdit(event) {
  if (event) event.preventDefault();
  const id = document.getElementById('edit-fb-id')?.value;
  const title = document.getElementById('edit-fb-title')?.value.trim();
  const subtitle = document.getElementById('edit-fb-subtitle')?.value.trim();
  const bgMusic = document.getElementById('edit-fb-bg-score')?.value;
  const soundEffects = document.getElementById('edit-fb-sound-effects')?.checked;

  if (!id || !title) {
    window.api.showToast('Please provide an album title', 'error');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/flipbooks/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, subtitle, bgMusic, soundEffects })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      window.api.showToast('✔ 3D Flipbook updated successfully!', 'success');
      closeModal('edit-flipbook-modal');
      renderMyFlipbooksGallery();
    } else {
      window.api.showToast(data.error || 'Failed to update flipbook', 'error');
    }
  } catch (err) {
    window.api.showToast('Server error updating flipbook', 'error');
  }
}

function openShareFlipbookModal(safeCode, title) {
  const decodedCode = decodeURIComponent(safeCode);
  currentShareTarget = { code: decodedCode, title: title };
  const shareUrl = `${window.location.origin}/flipbook.html?code=${encodeURIComponent(decodedCode)}`;
  
  const titleEl = document.getElementById('share-modal-title');
  const linkInput = document.getElementById('share-modal-link-input');
  if (titleEl) titleEl.textContent = `💌 Share "${title}"`;
  if (linkInput) linkInput.value = shareUrl;

  openModal('share-flipbook-modal');
}

function copyShareModalLink() {
  if (!currentShareTarget.code) return;
  const link = `${window.location.origin}/flipbook.html?code=${encodeURIComponent(currentShareTarget.code)}`;
  navigator.clipboard.writeText(link).then(() => {
    window.api.showToast('📋 3D Flipbook link copied to clipboard!', 'success');
  }).catch(() => {
    const input = document.getElementById('share-modal-link-input');
    if (input) {
      input.select();
      document.execCommand('copy');
      window.api.showToast('📋 Link copied!', 'success');
    }
  });
}

function executeShareModalWhatsApp() {
  if (!currentShareTarget.code) return;
  const link = `${window.location.origin}/flipbook.html?code=${encodeURIComponent(currentShareTarget.code)}`;
  const text = encodeURIComponent(`✨ Check out our Interactive 3D Virtual Album Flipbook Pro: *${currentShareTarget.title}*\n\n📖 Click Link to View:\n${link}`);
  window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
}

function openShareModalPreview() {
  if (!currentShareTarget.code) return;
  closeModal('share-flipbook-modal');
  viewFlipbookItem(encodeURIComponent(currentShareTarget.code), currentShareTarget.title);
}

async function deleteFlipbookItemPrompt(id, title) {
  if (!confirm(`Are you sure you want to delete 3D Flipbook "${title}"?\n\n⚠️ This will permanently delete the album.`)) return;
  try {
    const res = await fetch(`${API_BASE}/api/flipbooks/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (res.ok) {
      window.api.showToast(`🗑️ "${title}" permanently deleted!`, 'success');
      renderMyFlipbooksGallery();
    } else {
      window.api.showToast('Failed to delete flipbook', 'error');
    }
  } catch (err) {
    window.api.showToast('Error deleting flipbook', 'error');
  }
}

function autoFillProFlipbookByInput(val) {
  if (!val) return;
  const match = allClients.find(c => val.includes(c.code) || val.toLowerCase().includes(c.name.toLowerCase()));
  if (match) {
    const dateInput = document.getElementById('fb-pro-event-date');
    if (dateInput && match.eventDate) dateInput.value = match.eventDate;

    const typeInput = document.getElementById('fb-pro-event-type');
    if (typeInput && match.eventName) typeInput.value = match.eventName;

    const countText = document.getElementById('pro-sheets-count-text');
    if (countText) {
      const count = match.selectedCount || (match.photos ? match.photos.length : 0);
      countText.textContent = `✔ ${count} Photos loaded from ${match.name}'s gallery`;
      countText.style.color = '#00d2ff';
    }
  }
}

let calCurrentDate = new Date();
const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

let activeCalendarTargetInputId = 'fb-pro-event-date';

function toggleDarkCalendar() {
  toggleDarkCalendarFor('fb-pro-event-date');
}

function toggleDarkCalendarFor(inputId, evt) {
  if (evt) evt.stopPropagation();
  activeCalendarTargetInputId = inputId || 'fb-pro-event-date';
  
  const targetEl = document.getElementById(activeCalendarTargetInputId);
  const popup = document.getElementById('dark-calendar-popup');
  if (!popup || !targetEl) return;

  targetEl.parentElement.appendChild(popup);
  popup.style.top = 'calc(100% + 5px)';
  popup.style.left = '0';
  popup.style.zIndex = '1000005';

  const isShown = popup.style.display === 'block';
  popup.style.display = isShown ? 'none' : 'block';

  if (!isShown) {
    // Always open calendar showing Today's current date (or the date inside target input)
    if (targetEl.value && targetEl.value.includes('-')) {
      const parts = targetEl.value.trim().split('-');
      if (parts.length === 3) {
        let d, m, y;
        if (parts[0].length === 4) { // YYYY-MM-DD
          y = parseInt(parts[0], 10);
          m = parseInt(parts[1], 10) - 1;
          d = parseInt(parts[2], 10);
        } else { // DD-MM-YYYY
          d = parseInt(parts[0], 10);
          m = parseInt(parts[1], 10) - 1;
          y = parseInt(parts[2], 10);
        }
        if (!isNaN(d) && !isNaN(m) && !isNaN(y) && y > 1900) {
          calCurrentDate = new Date(y, m, d);
        } else {
          calCurrentDate = new Date();
        }
      } else {
        calCurrentDate = new Date();
      }
    } else {
      calCurrentDate = new Date(); // Reset to Today's Current Date
    }
    renderDarkCalendar();
  }
}

function changeCalMonth(delta) {
  calCurrentDate.setMonth(calCurrentDate.getMonth() + delta);
  renderDarkCalendar();
}

function onCalMonthYearChange() {
  const monthSelect = document.getElementById('cal-month-select');
  const yearInput = document.getElementById('cal-year-input');
  if (monthSelect && yearInput) {
    const yVal = parseInt(yearInput.value, 10);
    if (!isNaN(yVal) && yVal > 1900 && yVal < 2100) {
      calCurrentDate.setFullYear(yVal);
    }
    calCurrentDate.setMonth(parseInt(monthSelect.value, 10));
    renderDarkCalendar();
  }
}

function renderDarkCalendar() {
  const monthSelect = document.getElementById('cal-month-select');
  const yearInput = document.getElementById('cal-year-input');
  const grid = document.getElementById('cal-days-grid');
  if (!grid) return;

  const year = calCurrentDate.getFullYear();
  const month = calCurrentDate.getMonth();

  if (monthSelect) {
    monthSelect.innerHTML = monthNames.map((name, idx) => 
      `<option value="${idx}" ${idx === month ? 'selected' : ''}>${name}</option>`
    ).join('');
  }

  if (yearInput && document.activeElement !== yearInput) {
    yearInput.value = year;
  }

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  let html = '';

  for (let i = firstDay - 1; i >= 0; i--) {
    html += `<div style="padding:0.4rem 0;color:#64748b;opacity:0.4;">${daysInPrevMonth - i}</div>`;
  }

  const today = new Date();
  for (let d = 1; d <= daysInMonth; d++) {
    const isToday = d === today.getDate() && month === today.getMonth() && year === today.getFullYear();
    const bgStyle = isToday ? 'background:#00d2ff;color:#000;font-weight:800;border-radius:6px;box-shadow:0 0 10px rgba(0,210,255,0.6);' : 'padding:0.4rem 0;color:#e2e8f0;cursor:pointer;border-radius:6px;';
    html += `<div style="${bgStyle}" onclick="selectCalDate('${String(d).padStart(2, '0')}-${String(month + 1).padStart(2, '0')}-${year}')">${d}</div>`;
  }

  const totalCells = firstDay + daysInMonth;
  const nextDays = (7 - (totalCells % 7)) % 7;
  for (let i = 1; i <= nextDays; i++) {
    html += `<div style="padding:0.4rem 0;color:#64748b;opacity:0.4;">${i}</div>`;
  }

  grid.innerHTML = html;
}

function selectCalDate(dateStr) {
  const input = document.getElementById(activeCalendarTargetInputId);
  if (input) input.value = dateStr;
    const popup = document.getElementById('dark-calendar-popup');
  if (popup) popup.style.display = 'none';
}

let pendingProFlipbookFiles = {
  front: null,
  intro: null,
  outro: null,
  back: null,
  innerSheets: []
};

let currentProFlipbookAssets = {
  front: '',
  intro: '',
  outro: '',
  back: '',
  innerSheets: []
};

let lastCreatedFlipbook = { code: '', title: '' };

function openCreatedFlipbookPreview() {
  if (!lastCreatedFlipbook.code) return;
  const iframe = document.getElementById('fb-preview-iframe');
  const titleElModal = document.getElementById('fb-preview-modal-title');
  if (iframe) iframe.src = `flipbook.html?code=${encodeURIComponent(lastCreatedFlipbook.code)}`;
  if (titleElModal) titleElModal.textContent = `📖 ${lastCreatedFlipbook.title} - 3D Virtual Album Full Interactive Preview`;
  
  closeModal('flipbook-upload-progress-modal');
  openModal('flipbook-preview-modal');
}

function copyCreatedFlipbookLink() {
  if (!lastCreatedFlipbook.code) return;
  const link = `${window.location.origin}/flipbook.html?code=${encodeURIComponent(lastCreatedFlipbook.code)}`;
  navigator.clipboard.writeText(link).then(() => {
    window.api.showToast('📋 3D Flipbook link copied to clipboard!', 'success');
  }).catch(() => {
    const input = document.getElementById('fb-success-share-link');
    if (input) {
      input.select();
      document.execCommand('copy');
      window.api.showToast('📋 Link copied!', 'success');
    }
  });
}

function shareCreatedFlipbookWhatsApp() {
  if (!lastCreatedFlipbook.code) return;
  const link = `${window.location.origin}/flipbook.html?code=${encodeURIComponent(lastCreatedFlipbook.code)}`;
  const text = encodeURIComponent(`✨ Check out our Interactive 3D Virtual Album Flipbook Pro:\n${link}`);
  window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
}

let isProFlipbookCancelled = false;
let currentProFlipbookXhr = null;

function cancelProFlipbookCreation() {
  isProFlipbookCancelled = true;
  if (currentProFlipbookXhr) {
    try {
      currentProFlipbookXhr.abort();
    } catch (e) {}
    currentProFlipbookXhr = null;
  }
  closeModal('flipbook-upload-progress-modal');
  window.api.showToast('🛑 3D Flipbook creation cancelled', 'warning');
}

async function executeCreate3DFlipbookPro() {
  if (typeof checkFlipbookLimit === 'function' && !checkFlipbookLimit()) return;

  isProFlipbookCancelled = false;
  currentProFlipbookXhr = null;

  const clientInputVal = document.getElementById('fb-pro-client-name')?.value.trim();
  const eventDate = document.getElementById('fb-pro-event-date')?.value;
  const eventTypeSelect = document.getElementById('fb-pro-event-type');
  const eventType = eventTypeSelect ? eventTypeSelect.value.trim() : '';
  const score = document.getElementById('fb-pro-bg-score')?.value || '';

  // 1. Mandatory Event Type Validation
  if (!eventType) {
    window.api.showToast('⚠️ Please select your Event Type first (Ring Ceremony, Haldi, Wedding, etc.)!', 'error');
    if (eventTypeSelect) {
      eventTypeSelect.focus();
      eventTypeSelect.style.borderColor = '#ef4444';
      eventTypeSelect.style.boxShadow = '0 0 15px rgba(239,68,68,0.7)';
      setTimeout(() => {
        eventTypeSelect.style.borderColor = 'rgba(212,175,55,0.4)';
        eventTypeSelect.style.boxShadow = 'none';
      }, 3500);
    }
    return;
  }

  const pendingList = [];
  if (pendingProFlipbookFiles.front) pendingList.push({ file: pendingProFlipbookFiles.front, type: 'front' });
  if (pendingProFlipbookFiles.intro) pendingList.push({ file: pendingProFlipbookFiles.intro, type: 'intro' });
  if (pendingProFlipbookFiles.innerSheets.length > 0) {
    pendingProFlipbookFiles.innerSheets.forEach(item => {
      const rawFile = item.file || item;
      if (rawFile) pendingList.push({ file: rawFile, type: 'sheet' });
    });
  }
  if (pendingProFlipbookFiles.outro) pendingList.push({ file: pendingProFlipbookFiles.outro, type: 'outro' });
  if (pendingProFlipbookFiles.back) pendingList.push({ file: pendingProFlipbookFiles.back, type: 'back' });

  const hasUploadedAssets = currentProFlipbookAssets.front || currentProFlipbookAssets.intro || currentProFlipbookAssets.innerSheets.length > 0 || currentProFlipbookAssets.outro || currentProFlipbookAssets.back;

  if (!clientInputVal && pendingList.length === 0 && !hasUploadedAssets) {
    window.api.showToast('Please type or select a Client Name or pick cover/inner sheets', 'error');
    return;
  }

  const client = allClients.find(c => clientInputVal && (clientInputVal.includes(c.code) || clientInputVal.toLowerCase().includes(c.name.toLowerCase())));
  const exactClientName = clientInputVal || (client ? client.name : 'Wedding Album');
  let clientCode = client ? client.code : exactClientName;
  const title = `${clientInputVal || 'Event'} - ${eventType} Album`;
  const subtitle = `Interactive 3D Virtual Album Pro (${eventDate || '2026'})`;

  // Reset Progress Modal to Upload State
  const progressState = document.getElementById('fb-upload-progress-state');
  const successState = document.getElementById('fb-upload-success-state');
  if (progressState) progressState.style.display = 'block';
  if (successState) successState.style.display = 'none';

  // UI Elements for Progress Bar Modal
  const titleEl = document.getElementById('fb-progress-title');
  const subtitleEl = document.getElementById('fb-progress-subtitle');
  const statusEl = document.getElementById('fb-progress-status');
  const filenameEl = document.getElementById('fb-progress-filename');
  const bytesEl = document.getElementById('fb-progress-bytes');
  const speedEl = document.getElementById('fb-progress-speed');
  const percentEl = document.getElementById('fb-progress-percent');
  const fillEl = document.getElementById('fb-progress-bar-fill');
  const countEl = document.getElementById('fb-progress-count');

  if (titleEl) titleEl.textContent = `Creating ${title}...`;
  if (subtitleEl) subtitleEl.textContent = 'Uploading & Processing Album Spreads in Real-Time';
  if (fillEl) fillEl.style.width = '0%';
  if (percentEl) percentEl.textContent = '0%';
  if (countEl) countEl.textContent = `0 / ${pendingList.length} Files Completed`;
  if (speedEl) speedEl.textContent = '0 MB/s';

  openModal('flipbook-upload-progress-modal');

  const studio = currentStudio || JSON.parse(localStorage.getItem('dm_current_studio') || '{}');
  const studioId = studio.id || '';
  const studioName = studio.studioName || 'DM STUDIO';

  // 1. Optimize pending files to crisp KB-sized web assets on the fly while tracking original MB
  const optimizedPendingList = [];
  let totalBatchBytes = 0;
  const totalOriginalBytes = pendingList.reduce((sum, item) => sum + (item.file.size || 0), 0) || 1;

  if (pendingList.length > 0) {
    if (statusEl) statusEl.textContent = '⚡ Preparing high-resolution spreads...';
    if (filenameEl) filenameEl.textContent = 'Processing album spreads...';

    for (let i = 0; i < pendingList.length; i++) {
      if (isProFlipbookCancelled) return;
      const item = pendingList[i];
      const origMB = (item.file.size / (1024 * 1024)).toFixed(1);
      if (filenameEl) filenameEl.textContent = `Processing: ${item.file.name} (${origMB} MB)...`;
      const optimizedFile = await getOptimizedFileForUpload(item.file);
      totalBatchBytes += optimizedFile.size;
      optimizedPendingList.push({ file: optimizedFile, origFile: item.file, origSize: item.file.size, type: item.type });
    }
  }

  if (isProFlipbookCancelled) return;

  // Real-Time XHR Upload with Live MB Progress Display & Speed Calculator
  let completedFilesBytes = 0;
  let lastSpeedCalcTime = Date.now();
  let lastLoadedBytes = 0;

  function uploadFileWithProgress(item, fileIndex, totalFiles) {
    if (isProFlipbookCancelled) return Promise.resolve('');
    const file = item.file;
    const origSize = item.origSize || file.size;
    const type = item.type;

    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      currentProFlipbookXhr = xhr;
      xhr.open('POST', `${API_BASE}/api/flipbooks/upload-asset`, true);
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.setRequestHeader('X-Client-Code', encodeURIComponent(clientCode));
      xhr.setRequestHeader('X-Asset-Type', type);
      xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name));
      xhr.setRequestHeader('X-Studio-Id', studioId);
      xhr.setRequestHeader('X-Studio-Name', encodeURIComponent(studioName));

      xhr.upload.onprogress = (e) => {
        if (isProFlipbookCancelled) return;
        if (e.lengthComputable) {
          const currentLoadedOverall = completedFilesBytes + e.loaded;
          const totalOverall = totalBatchBytes > 0 ? totalBatchBytes : 1;
          const pct = Math.min(99, Math.round((currentLoadedOverall / totalOverall) * 100));

          // Calculate Original MB representation
          const currentLoadedOriginalBytes = Math.round((currentLoadedOverall / totalOverall) * totalOriginalBytes);
          const currentMB = (currentLoadedOriginalBytes / (1024 * 1024)).toFixed(1);
          const totalMB = (totalOriginalBytes / (1024 * 1024)).toFixed(1);
          const origFileMB = (origSize / (1024 * 1024)).toFixed(1);

          // Speed Calculation in MB/s
          const now = Date.now();
          const timeDiff = (now - lastSpeedCalcTime) / 1000;
          if (timeDiff >= 0.3) {
            const bytesDiff = currentLoadedOverall - lastLoadedBytes;
            const origBytesDiff = (bytesDiff / totalOverall) * totalOriginalBytes;
            const speedMBps = ((origBytesDiff / timeDiff) / (1024 * 1024)).toFixed(1);
            if (speedEl) speedEl.textContent = `⚡ ${speedMBps} MB/s`;
            lastSpeedCalcTime = now;
            lastLoadedBytes = currentLoadedOverall;
          }

          if (fillEl) fillEl.style.width = pct + '%';
          if (percentEl) percentEl.textContent = pct + '%';
          if (statusEl) statusEl.textContent = `⚡ Uploading ${type.toUpperCase()} (${fileIndex + 1} of ${totalFiles})`;
          if (filenameEl) filenameEl.textContent = `${file.name} (${origFileMB} MB)`;
          if (bytesEl) bytesEl.textContent = `${currentMB} MB / ${totalMB} MB`;
          if (countEl) countEl.textContent = `✔ ${fileIndex} / ${totalFiles} Files Completed`;
        }
      };

      xhr.onload = () => {
        currentProFlipbookXhr = null;
        try {
          const data = JSON.parse(xhr.responseText);
          completedFilesBytes += file.size;
          resolve((xhr.status >= 200 && xhr.status < 300 && data.success) ? data.url : '');
        } catch (e) {
          resolve('');
        }
      };

      xhr.onerror = () => {
        currentProFlipbookXhr = null;
        resolve('');
      };
      xhr.onabort = () => {
        currentProFlipbookXhr = null;
        resolve('');
      };
      xhr.send(file);
    });
  }

  // Upload pending optimized files with live tracking
  const totalUploads = optimizedPendingList.length;

  for (let i = 0; i < optimizedPendingList.length; i++) {
    if (isProFlipbookCancelled) return;
    const item = optimizedPendingList[i];
    let url = await uploadFileWithProgress(item, i, totalUploads);
    if (isProFlipbookCancelled) return;

    if (!url) {
      // Fallback base64
      url = await new Promise(r => {
        const reader = new FileReader();
        reader.onload = () => r(reader.result);
        reader.onerror = () => r('');
        reader.readAsDataURL(item.file);
      });
    }

    if (url && !isProFlipbookCancelled) {
      if (item.type === 'sheet') {
        currentProFlipbookAssets.innerSheets.push(url);
      } else {
        currentProFlipbookAssets[item.type] = url;
      }
    }
  }

  if (isProFlipbookCancelled) return;

  if (fillEl) fillEl.style.width = '100%';
  if (percentEl) percentEl.textContent = '100%';
  if (countEl) countEl.textContent = `✔ ${totalUploads} / ${totalUploads} Files Completed`;
  if (statusEl) statusEl.textContent = '✨ Finalizing 3D Virtual Album in Google Drive...';

  // Clear pending after upload completes
  pendingProFlipbookFiles.front = null;
  pendingProFlipbookFiles.intro = null;
  pendingProFlipbookFiles.outro = null;
  pendingProFlipbookFiles.back = null;
  pendingProFlipbookFiles.innerSheets = [];

  // Assemble Final Pages List
  let pages = [];
  if (currentProFlipbookAssets.front) pages.push(currentProFlipbookAssets.front);
  if (currentProFlipbookAssets.intro) pages.push(currentProFlipbookAssets.intro);

  if (currentProFlipbookAssets.innerSheets.length > 0) {
    pages.push(...currentProFlipbookAssets.innerSheets);
  }

  // Fallback to client gallery photos if NO flipbook assets were uploaded
  if (pages.length === 0 && client && client.photos && client.photos.length > 0) {
    if (isProFlipbookCancelled) return;
    const selSet = new Set(client.selectedPhotoIds || []);
    const selPhotos = client.photos.filter(p => selSet.has(p.id));
    const list = selPhotos.length > 0 ? selPhotos : client.photos;
    const galleryPages = list.map(p => p.url || `/api/image/${p.id}`);
    pages.push(...galleryPages);
  }

  if (currentProFlipbookAssets.outro) pages.push(currentProFlipbookAssets.outro);
  if (currentProFlipbookAssets.back) pages.push(currentProFlipbookAssets.back);

  if (pages.length === 0) {
    closeModal('flipbook-upload-progress-modal');
    window.api.showToast('Please select cover/inner sheets or select a client with photos', 'error');
    return;
  }

  // Save 3D Flipbook DB Record
  try {
    const res = await fetch(`${API_BASE}/api/flipbooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: clientCode,
        clientCode: clientCode,
        title,
        subtitle,
        pages,
        bgMusic: score,
        soundEffects: true
      })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      lastCreatedFlipbook = { code: clientCode, title: title };
      currentPreviewClientCode = clientCode;
      
      const shareUrl = `${window.location.origin}/flipbook.html?code=${encodeURIComponent(clientCode)}`;
      const linkInput = document.getElementById('fb-success-share-link');
      const titleElSuccess = document.getElementById('fb-success-album-title');
      const subtitleElSuccess = document.getElementById('fb-success-album-subtitle');
      
      if (linkInput) linkInput.value = shareUrl;
      if (titleElSuccess) titleElSuccess.textContent = `✨ ${title}`;
      if (subtitleElSuccess) subtitleElSuccess.textContent = `✔ All ${pages.length} album spreads ready!`;
      
      // Smoothly transition from Progress Bar to Success State (View & Share Link Options)
      if (progressState) progressState.style.display = 'none';
      if (successState) successState.style.display = 'block';

      window.api.showToast(`✨ 3D Flipbook generated for ${title}! Click View Preview to open.`, 'success');
    } else {
      closeModal('flipbook-upload-progress-modal');
      window.api.showToast(data.error || 'Failed to create 3D Flipbook', 'error');
    }
  } catch (err) {
    closeModal('flipbook-upload-progress-modal');
    console.error('Error creating 3D Flipbook:', err);
    window.api.showToast('Server error creating 3D Flipbook: ' + err.message, 'error');
  }
}

function triggerAudioUpload() {
  let fileInput = document.getElementById('pro-audio-file-input');
  if (fileInput) {
    fileInput.value = '';
    fileInput.click();
  } else {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*, .mp3, .wav, .m4a, .aac, .ogg';
    input.onchange = (e) => uploadProAudioFile(e.target);
    input.click();
  }
}

async function uploadProAudioFile(inputEl) {
  if (!inputEl || !inputEl.files || !inputEl.files[0]) return;
  const file = inputEl.files[0];
  
  window.api.showToast(`🎵 Uploading audio "${file.name}"...`, 'info');

  try {
    const studio = currentStudio || JSON.parse(localStorage.getItem('dm_current_studio') || '{}');
    const studioId = studio.id || '';
    const studioName = studio.studioName || 'DM STUDIO';

    const res = await fetch(`${API_BASE}/api/flipbooks/upload-asset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Client-Code': 'audio',
        'X-Asset-Type': 'audio',
        'X-Filename': encodeURIComponent(file.name),
        'X-Studio-Id': studioId,
        'X-Studio-Name': encodeURIComponent(studioName)
      },
      body: file
    });
    const data = await res.json();
    if (res.ok && data.success) {
      window.api.showToast(`✨ Audio uploaded successfully: ${data.name}!`, 'success');
      await loadProFlipbookAudioList(data.url);
    } else {
      window.api.showToast('Failed to upload audio file: ' + (data.error || res.statusText), 'error');
    }
  } catch (err) {
    window.api.showToast('Audio upload error: ' + err.message, 'error');
  } finally {
    if (inputEl) inputEl.value = '';
  }
}

async function loadProFlipbookAudioList(selectedUrl = '') {
  const select = document.getElementById('fb-pro-bg-score');
  if (!select) return;

  try {
    const res = await fetch(`${API_BASE}/api/flipbooks/audio-list`);
    const audios = await res.json();

    let optionsHtml = `<option value="">🔇 No Audio / Mute</option>`;

    if (audios && audios.length > 0) {
      optionsHtml += audios.map(a => 
        `<option value="${a.url}">🎵 ${escapeHtml(a.name)}</option>`
      ).join('');
    }

    select.innerHTML = optionsHtml;
    if (selectedUrl) {
      select.value = selectedUrl;
    } else if (audios && audios.length > 0) {
      select.value = audios[0].url;
    }
  } catch (err) {
    console.warn('loadProFlipbookAudioList Error:', err);
  }
}

let currentPreviewClientCode = '';

// High-Clarity 2x Retina Downsampled Thumbnail Generator (Crisp Details + Super Fast)
function createFastThumbnailDataUrl(file, maxWidth = 320, maxHeight = 150, quality = 0.82) {
  return new Promise((resolve) => {
    if (!file || !file.type || !file.type.startsWith('image/')) return resolve('');
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      let width = img.width || 320;
      let height = img.height || 150;

      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.max(1, Math.round(width * ratio));
        height = Math.max(1, Math.round(height * ratio));
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { alpha: false });
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);
        // Try WebP first for ultra-sharp clarity at low KB, fallback to high-quality JPEG
        try {
          resolve(canvas.toDataURL('image/webp', quality));
        } catch (err) {
          resolve(canvas.toDataURL('image/jpeg', quality));
        }
      } else {
        resolve('');
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve('');
    };
    img.src = url;
  });
}

function uploadProCover(type) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    pendingProFlipbookFiles[type] = file;

    // Show crisp High-Clarity Retina preview (480x200) with zero scroll lag
    const boxEl = document.getElementById(`pro-cover-${type}-box`);
    if (boxEl) {
      boxEl.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#fde047;font-size:0.75rem;">⏳ Loading HD Preview...</div>`;
      const thumbData = await createFastThumbnailDataUrl(file, 480, 200, 0.85);
      boxEl.innerHTML = `<img src="${thumbData}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;transform:translateZ(0);"><div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.75);color:#facc15;font-size:0.65rem;font-weight:800;text-align:center;padding:2px 0;">📷 ${type.toUpperCase()} SELECTED</div>`;
    }
  };
  input.click();
}

function addMoreInnerSheets() {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.accept = 'image/*';
  input.onchange = async (e) => {
    const files = Array.from(e.target.files);
    if (!files || files.length === 0) return;

    // Generate crisp 2x Retina thumbnails (320x150) in parallel for crystal clear clarity + zero lag
    const thumbPromises = files.map(file => createFastThumbnailDataUrl(file, 320, 150, 0.82).then(thumbUrl => ({ file, thumbUrl })));
    const processedItems = await Promise.all(thumbPromises);

    pendingProFlipbookFiles.innerSheets.push(...processedItems);
    renderProInnerSheetsTray();
  };
  input.click();
}

function sharePreviewFlipbookWhatsApp() {
  if (!currentPreviewClientCode) return;
  const link = `${window.location.origin}/flipbook.html?code=${currentPreviewClientCode}`;
  const text = encodeURIComponent(`✨ Check out our Interactive 3D Virtual Album Flipbook Pro:\n${link}`);
  window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
}

function scrollInnerSheetsTray(amount) {
  const tray = document.getElementById('pro-inner-sheets-tray');
  if (tray) tray.scrollBy({ left: amount, behavior: 'smooth' });
}

function renderProInnerSheetsTray() {
  const tray = document.getElementById('pro-inner-sheets-tray');
  const countText = document.getElementById('pro-sheets-count-text');
  if (!tray) return;

  let html = `
    <div style="width:56px;height:64px;min-width:56px;border-radius:10px;background:rgba(212,175,55,0.12);border:1.5px dashed var(--gold-400);display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--gold-400);cursor:pointer;transition:transform 0.2s;flex-shrink:0;" onclick="addMoreInnerSheets()" title="Add more sheets">
      <div style="width:26px;height:26px;border-radius:50%;background:linear-gradient(135deg, #fde047 0%, #d4af37 100%);color:#000;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:1.1rem;line-height:1;box-shadow:0 0 8px rgba(212,175,55,0.4);">+</div>
    </div>
  `;

  const totalCount = currentProFlipbookAssets.innerSheets.length + pendingProFlipbookFiles.innerSheets.length;

  currentProFlipbookAssets.innerSheets.forEach((url, idx) => {
    html += `
      <div style="position:relative;width:140px;height:64px;min-width:140px;border-radius:10px;overflow:hidden;border:1.5px solid rgba(212,175,55,0.4);background:#05070d;box-shadow:0 4px 12px rgba(0,0,0,0.6);flex-shrink:0;contain:paint;transform:translateZ(0);">
        <img src="${url}" style="width:100%;height:100%;object-fit:cover;will-change:transform;" loading="lazy">
        <span style="position:absolute;top:4px;right:4px;background:#ef4444;color:#fff;border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;cursor:pointer;box-shadow:0 0 6px rgba(0,0,0,0.9);z-index:2;" onclick="removeUploadedInnerSheet(${idx})" title="Remove">&times;</span>
      </div>
    `;
  });

  pendingProFlipbookFiles.innerSheets.forEach((item, idx) => {
    const thumbUrl = item.thumbUrl || '';
    html += `
      <div style="position:relative;width:140px;height:64px;min-width:140px;border-radius:10px;overflow:hidden;border:1.5px solid rgba(212,175,55,0.4);background:#05070d;box-shadow:0 4px 12px rgba(0,0,0,0.6);flex-shrink:0;contain:paint;transform:translateZ(0);">
        <img src="${thumbUrl}" style="width:100%;height:100%;object-fit:cover;will-change:transform;" loading="lazy">
        <span style="position:absolute;top:4px;right:4px;background:#ef4444;color:#fff;border-radius:50%;width:18px;height:18px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;cursor:pointer;box-shadow:0 0 6px rgba(0,0,0,0.9);z-index:2;" onclick="removePendingInnerSheet(${idx})" title="Remove">&times;</span>
      </div>
    `;
  });

  if (totalCount === 0) {
    html += `
      <div style="color:rgba(212,175,55,0.7);font-size:0.75rem;white-space:nowrap;" id="pro-sheets-placeholder">
        + Click to select inner sheet photos
      </div>
    `;
  }

  if (countText) {
    countText.textContent = totalCount > 0 ? `✔ ${totalCount} Sheets Selected` : '0 Sheets Selected';
    countText.style.color = totalCount > 0 ? '#fde047' : 'rgba(212,175,55,0.7)';
  }

  tray.innerHTML = html;
}

function removePendingInnerSheet(idx) {
  pendingProFlipbookFiles.innerSheets.splice(idx, 1);
  renderProInnerSheetsTray();
}

function removeUploadedInnerSheet(idx) {
  currentProFlipbookAssets.innerSheets.splice(idx, 1);
  renderProInnerSheetsTray();
}

// --- HTML5 Professional Audio Preview Engine & Spectrum Visualizer ---
let proAudioPlayer = null;
let proAudioSpectrumInterval = null;

function formatAudioTime(seconds) {
  if (isNaN(seconds) || seconds <= 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function initProAudioPlayer() {
  if (!proAudioPlayer) {
    proAudioPlayer = new Audio();
    proAudioPlayer.preload = 'auto';

    proAudioPlayer.addEventListener('timeupdate', () => {
      const progressBar = document.getElementById('pro-audio-progress-bar');
      const timeDisplay = document.getElementById('pro-audio-time-display');
      if (proAudioPlayer.duration) {
        const pct = (proAudioPlayer.currentTime / proAudioPlayer.duration) * 100;
        if (progressBar) progressBar.style.width = pct + '%';
        if (timeDisplay) timeDisplay.textContent = `${formatAudioTime(proAudioPlayer.currentTime)} / ${formatAudioTime(proAudioPlayer.duration)}`;
      }
    });

    proAudioPlayer.addEventListener('ended', () => {
      stopProAudioSpectrum();
      const playBtn = document.getElementById('pro-audio-play-btn');
      if (playBtn) playBtn.textContent = '▶';
      const progressBar = document.getElementById('pro-audio-progress-bar');
      if (progressBar) progressBar.style.width = '0%';
    });

    proAudioPlayer.addEventListener('pause', () => {
      stopProAudioSpectrum();
      const playBtn = document.getElementById('pro-audio-play-btn');
      if (playBtn) playBtn.textContent = '▶';
    });

    proAudioPlayer.addEventListener('play', () => {
      startProAudioSpectrum();
      const playBtn = document.getElementById('pro-audio-play-btn');
      if (playBtn) playBtn.textContent = '⏸';
    });
  }
}

function startProAudioSpectrum() {
  stopProAudioSpectrum();
  const bars = document.querySelectorAll('#pro-audio-spectrum-bars div');
  if (!bars || bars.length === 0) return;

  proAudioSpectrumInterval = setInterval(() => {
    bars.forEach((bar) => {
      const randomHeight = Math.floor(Math.random() * 80) + 15;
      bar.style.height = randomHeight + '%';
    });
  }, 100);
}

function stopProAudioSpectrum() {
  if (proAudioSpectrumInterval) {
    clearInterval(proAudioSpectrumInterval);
    proAudioSpectrumInterval = null;
  }
  const bars = document.querySelectorAll('#pro-audio-spectrum-bars div');
  bars.forEach(bar => { bar.style.height = '20%'; });
}

function toggleProAudioPlay() {
  initProAudioPlayer();

  // 1. If currently playing, clicking the button ALWAYS pauses immediately, no matter what is selected!
  if (proAudioPlayer && !proAudioPlayer.paused) {
    proAudioPlayer.pause();
    stopProAudioSpectrum();
    const playBtn = document.getElementById('pro-audio-play-btn');
    if (playBtn) playBtn.textContent = '▶';
    return;
  }

  // 2. If trying to play from idle/paused state, check if a valid audio track is selected
  const select = document.getElementById('fb-pro-bg-score');
  const audioUrl = select ? select.value : '';

  if (!audioUrl) {
    window.api.showToast('Please select or upload an audio track from the dropdown first (currently Muted)', 'warning');
    return;
  }

  // 3. Resolve target URL and play silently
  const fullUrl = new URL(audioUrl, window.location.origin).href;
  if (proAudioPlayer.src !== fullUrl) {
    proAudioPlayer.src = fullUrl;
    proAudioPlayer.load();
  }

  proAudioPlayer.play().catch((err) => {
    console.warn('Audio playback error:', err);
    window.api.showToast('Could not play audio track. Please check file.', 'error');
  });
}

function seekProAudio(event) {
  initProAudioPlayer();
  if (!proAudioPlayer || isNaN(proAudioPlayer.duration) || proAudioPlayer.duration <= 0) return;
  const rect = event.currentTarget.getBoundingClientRect();
  const clickX = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
  const pct = clickX / rect.width;
  const seekTime = pct * proAudioPlayer.duration;
  
  proAudioPlayer.currentTime = seekTime;
  
  const progressBar = document.getElementById('pro-audio-progress-bar');
  const timeDisplay = document.getElementById('pro-audio-time-display');
  if (progressBar) progressBar.style.width = (pct * 100) + '%';
  if (timeDisplay) timeDisplay.textContent = `${formatAudioTime(seekTime)} / ${formatAudioTime(proAudioPlayer.duration)}`;
}

function onProAudioSelectChange() {
  initProAudioPlayer();
  const select = document.getElementById('fb-pro-bg-score');
  const audioUrl = select ? select.value : '';

  if (!audioUrl) {
    // User selected "No Audio / Mute" -> Immediately stop, pause & reset audio silently!
    if (proAudioPlayer) {
      proAudioPlayer.pause();
      proAudioPlayer.currentTime = 0;
      stopProAudioSpectrum();
      const playBtn = document.getElementById('pro-audio-play-btn');
      if (playBtn) playBtn.textContent = '▶';
      const progressBar = document.getElementById('pro-audio-progress-bar');
      if (progressBar) progressBar.style.width = '0%';
      const timeDisplay = document.getElementById('pro-audio-time-display');
      if (timeDisplay) timeDisplay.textContent = '0:00 / 0:00';
    }
    return;
  }

  // If already playing another song, switch directly to the newly selected song silently!
  if (proAudioPlayer && !proAudioPlayer.paused) {
    const fullUrl = new URL(audioUrl, window.location.origin).href;
    proAudioPlayer.src = fullUrl;
    proAudioPlayer.load();
    proAudioPlayer.play().catch(() => {});
  }
}

function openLiveFlipbookDemo() {
  const select = document.getElementById('fb-pro-client-select');
  const code = (select && select.value) ? select.value : 'PS253';
  window.open(`flipbook.html?code=${code}`, '_blank');
}

// Expose globals for inline HTML event handlers
window.switchView = switchView;
window.openModal = openModal;
window.closeModal = closeModal;
window.startUploadForClient = startUploadForClient;
window.copyClientLink = copyClientLink;
window.copyShareTextFromModal = copyShareTextFromModal;
window.openWhatsAppShare = openWhatsAppShare;
window.viewClientSelections = viewClientSelections;
window.copyLightroomFilenames = copyLightroomFilenames;
window.exportSelectionsCSV = exportSelectionsCSV;
window.openAutoCopyModal = openAutoCopyModal;
window.browseOriginalFolder = browseOriginalFolder;
window.handleNativeFolderSelect = handleNativeFolderSelect;
window.executeAutoCopy = executeAutoCopy;
window.togglePauseUpload = togglePauseUpload;
window.cancelUploadBatch = cancelUploadBatch;
window.startBatchUpload = startBatchUpload;
window.saveStudioBranding = saveStudioBranding;
window.connectGoogleOAuth = connectGoogleOAuth;
window.openEditClientModal = openEditClientModal;
window.saveClientEdit = saveClientEdit;
window.deleteClientPrompt = deleteClientPrompt;
window.setAdminSelectionFolder = setAdminSelectionFolder;
window.logoutAdmin = logoutAdmin;
window.renderFlipbooksView = renderFlipbooksView;
window.autoFillFlipbookTitle = autoFillFlipbookTitle;
window.handleSaveFlipbook = handleSaveFlipbook;
window.deleteFlipbookPrompt = deleteFlipbookPrompt;
window.shareFlipbookWhatsApp = shareFlipbookWhatsApp;
window.copyTextToClipboard = copyTextToClipboard;
window.autoFillProFlipbook = autoFillProFlipbook;
window.executeCreate3DFlipbookPro = executeCreate3DFlipbookPro;
window.cancelProFlipbookCreation = cancelProFlipbookCreation;
window.triggerAudioUpload = triggerAudioUpload;
window.uploadProAudioFile = uploadProAudioFile;
window.loadProFlipbookAudioList = loadProFlipbookAudioList;
window.uploadProCover = uploadProCover;
window.addMoreInnerSheets = addMoreInnerSheets;
window.renderProInnerSheetsTray = renderProInnerSheetsTray;
window.removePendingInnerSheet = removePendingInnerSheet;
window.removeUploadedInnerSheet = removeUploadedInnerSheet;
window.sharePreviewFlipbookWhatsApp = sharePreviewFlipbookWhatsApp;
window.toggleProAudioPlay = toggleProAudioPlay;
window.seekProAudio = seekProAudio;
window.onProAudioSelectChange = onProAudioSelectChange;
window.openLiveFlipbookDemo = openLiveFlipbookDemo;
window.toggleDarkCalendar = toggleDarkCalendar;
window.toggleDarkCalendarFor = toggleDarkCalendarFor;
window.changeCalMonth = changeCalMonth;
window.selectCalDate = selectCalDate;
window.onCalMonthYearChange = onCalMonthYearChange;
window.openCreatedFlipbookPreview = openCreatedFlipbookPreview;
window.copyCreatedFlipbookLink = copyCreatedFlipbookLink;
window.shareCreatedFlipbookWhatsApp = shareCreatedFlipbookWhatsApp;
window.renderMyFlipbooksGallery = renderMyFlipbooksGallery;
window.filterMyFlipbooks = filterMyFlipbooks;
window.viewFlipbookItem = viewFlipbookItem;
window.openEditFlipbookModal = openEditFlipbookModal;
window.saveFlipbookEdit = saveFlipbookEdit;
window.openShareFlipbookModal = openShareFlipbookModal;
window.copyShareModalLink = copyShareModalLink;
window.executeShareModalWhatsApp = executeShareModalWhatsApp;
window.openShareModalPreview = openShareModalPreview;
window.deleteFlipbookItemPrompt = deleteFlipbookItemPrompt;
window.scrollInnerSheetsTray = scrollInnerSheetsTray;

// Global Modal Helpers
function openModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) {
    el.classList.add('active');
    el.style.opacity = '1';
    el.style.visibility = 'visible';
  }
}

function closeModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) {
    el.classList.remove('active');
    el.style.opacity = '0';
    el.style.visibility = 'hidden';
  }
}

// Click on modal backdrop to close
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.remove('active');
        overlay.style.opacity = '0';
        overlay.style.visibility = 'hidden';
      }
    });
  });
});

// --- Profile Settings Management (Golden Dashboard) ---
let activeProfileData = null;

function getStudioInitials(name) {
  if (!name) return 'DM';
  const clean = name.trim().replace(/[^a-zA-Z0-9\s]/g, '');
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return clean.substring(0, 2).toUpperCase() || 'DM';
}

async function loadAndRenderProfileSettings() {
  const studio = currentStudio || JSON.parse(localStorage.getItem('dm_current_studio') || '{}');
  
  try {
    const res = await fetch(`${API_BASE}/api/admin/studio-profile`, {
      headers: (studio && studio.id) ? { 'X-Studio-Id': studio.id } : {}
    });
    if (res.ok) {
      activeProfileData = await res.json();
    }
  } catch (e) {}

  if (!activeProfileData) {
    activeProfileData = studio;
  }

  // Registered studio name is primary!
  const studioName = activeProfileData.studioName || studio.studioName || 'DM STUDIO';
  const role = activeProfileData.role || 'Business Owner';
  const email = activeProfileData.email || studio.email || '';
  const phone = activeProfileData.phone || studio.phone || '';

  const initials = getStudioInitials(studioName);

  const logoImage = activeProfileData.logoUrl || activeProfileData.avatarUrl;

  // Top Right Badge
  const topInitials = document.getElementById('top-badge-initials');
  const topName = document.getElementById('top-badge-name');
  const topRole = document.getElementById('top-badge-role');
  const topAvatar = document.getElementById('top-badge-avatar');

  if (topName) topName.textContent = studioName;
  if (topRole) topRole.textContent = role;
  if (topAvatar) {
    if (logoImage) {
      topAvatar.innerHTML = `<img src="${logoImage}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    } else {
      topAvatar.innerHTML = `<span id="top-badge-initials">${initials}</span>`;
    }
  }

  // Card 1: Profile Information
  const profInitials = document.getElementById('prof-card-initials');
  const profAvatar = document.getElementById('prof-card-avatar');
  const profName = document.getElementById('prof-display-name');
  const profEmail = document.getElementById('prof-display-email');
  const profPhone = document.getElementById('prof-display-phone');

  if (profName) profName.textContent = studioName;
  if (profEmail) profEmail.textContent = email || 'Not Set';
  if (profPhone) profPhone.textContent = phone || 'Not Set';
  if (profAvatar) {
    if (logoImage) {
      profAvatar.innerHTML = `<img src="${logoImage}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    } else {
      profAvatar.innerHTML = `<span id="prof-card-initials">${initials}</span>`;
    }
  }

  // Card 2: Social Media Links
  const social = activeProfileData.socialLinks || {};
  const linkFb = document.getElementById('prof-link-facebook');
  const linkIg = document.getElementById('prof-link-instagram');
  const linkYt = document.getElementById('prof-link-youtube');
  const linkWeb = document.getElementById('prof-link-website');

  if (linkFb) linkFb.innerHTML = social.facebook ? `<a href="${social.facebook}" target="_blank" style="color:#fde047;text-decoration:none;font-weight:600;">Linked ↗</a>` : 'Not Linked';
  if (linkIg) linkIg.innerHTML = social.instagram ? `<a href="${social.instagram}" target="_blank" style="color:#fde047;text-decoration:none;font-weight:600;">Linked ↗</a>` : 'Not Linked';
  if (linkYt) linkYt.innerHTML = social.youtube ? `<a href="${social.youtube}" target="_blank" style="color:#fde047;text-decoration:none;font-weight:600;">Linked ↗</a>` : 'Not Linked';
  if (linkWeb) linkWeb.innerHTML = social.website ? `<a href="${social.website}" target="_blank" style="color:#fde047;text-decoration:none;font-weight:600;">Linked ↗</a>` : 'Not Linked';

  // Card 4: Logo & Signature Preview Boxes
  const logoBox = document.getElementById('prof-logo-preview-box');
  const sigBox = document.getElementById('prof-sig-preview-box');

  if (logoBox) {
    if (logoImage) {
      logoBox.innerHTML = `<img src="${logoImage}" style="max-height:45px;max-width:90%;object-fit:contain;">`;
    } else {
      logoBox.textContent = 'NO LOGO';
    }
  }

  if (sigBox) {
    if (activeProfileData.signatureUrl) {
      sigBox.innerHTML = `<img src="${activeProfileData.signatureUrl}" style="max-height:45px;max-width:90%;object-fit:contain;">`;
    } else {
      sigBox.textContent = 'NO SIGNATURE';
    }
  }

  // Card 5: Payment Information
  const pay = activeProfileData.paymentInfo || {};
  const payHolder = document.getElementById('prof-pay-holder');
  const payBank = document.getElementById('prof-pay-bank');
  const payUpi = document.getElementById('prof-pay-upi');

  if (payHolder) payHolder.textContent = pay.accountHolder || studioName || '---';
  if (payBank) payBank.textContent = pay.bankName || '---';
  if (payUpi) payUpi.textContent = pay.upiId || '---';
}

function toggleInlineProfileEdit(show) {
  const viewMode = document.getElementById('prof-card-view-mode');
  const editMode = document.getElementById('prof-card-edit-mode');
  if (!viewMode || !editMode) return;

  if (show) {
    const studio = currentStudio || JSON.parse(localStorage.getItem('dm_current_studio') || '{}');
    const p = activeProfileData || studio;
    
    const inStudio = document.getElementById('inline-prof-studio');
    const inEmail = document.getElementById('inline-prof-email');
    const inPhone = document.getElementById('inline-prof-phone');

    if (inStudio) inStudio.value = p.studioName || studio.studioName || 'DM STUDIO';
    if (inEmail) inEmail.value = p.email || studio.email || '';
    if (inPhone) inPhone.value = p.phone || studio.phone || '';

    viewMode.style.display = 'none';
    editMode.style.display = 'block';
  } else {
    viewMode.style.display = 'block';
    editMode.style.display = 'none';
  }
}

async function saveInlineProfileInfo(e) {
  e.preventDefault();
  const studioName = document.getElementById('inline-prof-studio')?.value.trim();
  const email = document.getElementById('inline-prof-email')?.value.trim();
  const phone = document.getElementById('inline-prof-phone')?.value.trim();

  if (!studioName) {
    window.api.showToast('Studio Name is required', 'error');
    return;
  }

  const payload = {
    ...(activeProfileData || {}),
    studioName,
    ownerName: studioName,
    email,
    phone
  };

  try {
    const res = await fetch(`${API_BASE}/api/admin/studio-profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok && data.success) {
      activeProfileData = data.studio;
      localStorage.setItem('dm_current_studio', JSON.stringify(data.studio));
      currentStudio = data.studio;
      applyStudioBranding();
      loadAndRenderProfileSettings();
      toggleInlineProfileEdit(false);
      window.api.showToast('Studio profile saved successfully! ✨', 'success');
    } else {
      window.api.showToast(data.error || 'Failed to save profile', 'error');
    }
  } catch (err) {
    window.api.showToast('Server error saving profile', 'error');
  }
}

function openEditProfileModal() {
  const p = activeProfileData || currentStudio || JSON.parse(localStorage.getItem('dm_current_studio') || '{}');
  const inStudio = document.getElementById('modal-prof-studio');
  const inEmail = document.getElementById('modal-prof-email');
  const inPhone = document.getElementById('modal-prof-phone');
  const inRole = document.getElementById('modal-prof-role');

  if (inStudio) inStudio.value = p.studioName || 'DM STUDIO';
  if (inEmail) inEmail.value = p.email || '';
  if (inPhone) inPhone.value = p.phone || '';
  if (inRole) inRole.value = p.role || 'Business Owner';

  openModal('edit-profile-modal');
}

async function handleSaveProfileInfo(e) {
  e.preventDefault();
  const studioName = document.getElementById('modal-prof-studio')?.value.trim();
  const email = document.getElementById('modal-prof-email')?.value.trim();
  const phone = document.getElementById('modal-prof-phone')?.value.trim();
  const role = document.getElementById('modal-prof-role')?.value.trim();

  if (!studioName) {
    window.api.showToast('Studio Name is required', 'error');
    return;
  }

  const payload = {
    ...(activeProfileData || {}),
    studioName,
    ownerName: studioName,
    email,
    phone,
    role
  };

  try {
    const res = await fetch(`${API_BASE}/api/admin/studio-profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok && data.success) {
      activeProfileData = data.studio;
      localStorage.setItem('dm_current_studio', JSON.stringify(data.studio));
      currentStudio = data.studio;
      applyStudioBranding();
      loadAndRenderProfileSettings();
      closeModal('edit-profile-modal');
      window.api.showToast('Studio profile saved successfully! ✨', 'success');
    } else {
      window.api.showToast(data.error || 'Failed to save profile', 'error');
    }
  } catch (err) {
    window.api.showToast('Server error saving profile', 'error');
  }
}

function openEditSocialModal() {
  const p = activeProfileData?.socialLinks || {};
  const inFb = document.getElementById('modal-social-facebook');
  const inIg = document.getElementById('modal-social-instagram');
  const inYt = document.getElementById('modal-social-youtube');
  const inWeb = document.getElementById('modal-social-website');

  if (inFb) inFb.value = p.facebook || '';
  if (inIg) inIg.value = p.instagram || '';
  if (inYt) inYt.value = p.youtube || '';
  if (inWeb) inWeb.value = p.website || '';

  openModal('edit-social-modal');
}

async function handleSaveSocialLinks(e) {
  e.preventDefault();
  const facebook = document.getElementById('modal-social-facebook')?.value.trim();
  const instagram = document.getElementById('modal-social-instagram')?.value.trim();
  const youtube = document.getElementById('modal-social-youtube')?.value.trim();
  const website = document.getElementById('modal-social-website')?.value.trim();

  const payload = {
    ...(activeProfileData || {}),
    socialLinks: { facebook, instagram, youtube, website }
  };

  try {
    const res = await fetch(`${API_BASE}/api/admin/studio-profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok && data.success) {
      activeProfileData = data.studio;
      loadAndRenderProfileSettings();
      closeModal('edit-social-modal');
      window.api.showToast('Social media links updated! 🌐', 'success');
    } else {
      window.api.showToast(data.error || 'Failed to update links', 'error');
    }
  } catch (err) {
    window.api.showToast('Server error updating links', 'error');
  }
}

function openChangePasswordModal() {
  const inCur = document.getElementById('modal-pass-current');
  const inNew = document.getElementById('modal-pass-new');
  const inConf = document.getElementById('modal-pass-confirm');

  if (inCur) inCur.value = '';
  if (inNew) inNew.value = '';
  if (inConf) inConf.value = '';

  openModal('change-password-modal');
}

async function handleSavePassword(e) {
  e.preventDefault();
  const currentPassword = document.getElementById('modal-pass-current')?.value.trim();
  const newPassword = document.getElementById('modal-pass-new')?.value.trim();
  const confirmPassword = document.getElementById('modal-pass-confirm')?.value.trim();

  if (newPassword !== confirmPassword) {
    window.api.showToast('New passwords do not match!', 'error');
    return;
  }

  if (newPassword.length < 6) {
    window.api.showToast('Password must be at least 6 characters', 'error');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/admin/studio-profile/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      closeModal('change-password-modal');
      window.api.showToast('Password changed successfully! 🔐', 'success');
    } else {
      window.api.showToast(data.error || 'Failed to change password', 'error');
    }
  } catch (err) {
    window.api.showToast('Server error changing password', 'error');
  }
}

function openUpdateFilesModal() {
  const prevLogo = document.getElementById('modal-preview-logo');
  const prevSig = document.getElementById('modal-preview-sig');
  const inLogo = document.getElementById('modal-file-logo');
  const inSig = document.getElementById('modal-file-sig');

  if (inLogo) inLogo.value = '';
  if (inSig) inSig.value = '';

  if (prevLogo) {
    prevLogo.innerHTML = activeProfileData?.logoUrl 
      ? `<img src="${activeProfileData.logoUrl}" style="max-height:50px;">` 
      : 'No Logo Selected';
  }
  if (prevSig) {
    prevSig.innerHTML = activeProfileData?.signatureUrl 
      ? `<img src="${activeProfileData.signatureUrl}" style="max-height:50px;">` 
      : 'No Signature Selected';
  }

  openModal('update-files-modal');
}

function previewSelectedModalFile(input, previewId) {
  const file = input.files?.[0];
  const container = document.getElementById(previewId);
  if (!container) return;

  if (file) {
    const url = URL.createObjectURL(file);
    container.innerHTML = `<img src="${url}" style="max-height:50px;max-width:90%;object-fit:contain;">`;
  }
}

async function handleSaveFiles(e) {
  e.preventDefault();
  const fileLogo = document.getElementById('modal-file-logo')?.files?.[0];
  const fileSig = document.getElementById('modal-file-sig')?.files?.[0];

  if (!fileLogo && !fileSig) {
    window.api.showToast('Please select a Logo or Signature file to upload', 'info');
    closeModal('update-files-modal');
    return;
  }

  try {
    if (fileLogo) {
      const resp = await fetch(`${API_BASE}/api/admin/studio-profile/upload-media`, {
        method: 'POST',
        headers: {
          'x-media-type': 'logo',
          'x-filename': encodeURIComponent(fileLogo.name)
        },
        body: fileLogo
      });
      const data = await resp.json();
      if (data.url) activeProfileData.logoUrl = data.url;
    }

    if (fileSig) {
      const resp = await fetch(`${API_BASE}/api/admin/studio-profile/upload-media`, {
        method: 'POST',
        headers: {
          'x-media-type': 'signature',
          'x-filename': encodeURIComponent(fileSig.name)
        },
        body: fileSig
      });
      const data = await resp.json();
      if (data.url) activeProfileData.signatureUrl = data.url;
    }

    loadAndRenderProfileSettings();
    closeModal('update-files-modal');
    window.api.showToast('Logo & Signature files uploaded and saved! 🎨', 'success');
  } catch (err) {
    window.api.showToast('Error uploading files: ' + err.message, 'error');
  }
}

function triggerAvatarUpload() {
  const input = document.getElementById('input-avatar-file');
  if (input) input.click();
}

async function handleAvatarFileSelected(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    window.api.showToast('Uploading profile avatar...', 'info');
    const resp = await fetch(`${API_BASE}/api/admin/studio-profile/upload-media`, {
      method: 'POST',
      headers: {
        'x-media-type': 'avatar',
        'x-filename': encodeURIComponent(file.name)
      },
      body: file
    });
    const data = await resp.json();
    if (data.url) {
      activeProfileData.avatarUrl = data.url;
      loadAndRenderProfileSettings();
      window.api.showToast('Profile photo updated! 📷✨', 'success');
    }
  } catch (err) {
    window.api.showToast('Failed to upload avatar', 'error');
  }
}

function openEditPaymentModal() {
  const p = activeProfileData?.paymentInfo || {};
  const inHolder = document.getElementById('modal-pay-holder');
  const inBank = document.getElementById('modal-pay-bank');
  const inAcc = document.getElementById('modal-pay-accnum');
  const inIfsc = document.getElementById('modal-pay-ifsc');
  const inUpi = document.getElementById('modal-pay-upi');

  if (inHolder) inHolder.value = p.accountHolder || activeProfileData?.studioName || 'DM STUDIO';
  if (inBank) inBank.value = p.bankName || '';
  if (inAcc) inAcc.value = p.accountNumber || '';
  if (inIfsc) inIfsc.value = p.ifsc || '';
  if (inUpi) inUpi.value = p.upiId || '8249861208@upi';

  openModal('edit-payment-modal');
}

async function handleSavePaymentInfo(e) {
  e.preventDefault();
  const accountHolder = document.getElementById('modal-pay-holder')?.value.trim();
  const bankName = document.getElementById('modal-pay-bank')?.value.trim();
  const accountNumber = document.getElementById('modal-pay-accnum')?.value.trim();
  const ifsc = document.getElementById('modal-pay-ifsc')?.value.trim();
  const upiId = document.getElementById('modal-pay-upi')?.value.trim();

  const payload = {
    ...(activeProfileData || {}),
    paymentInfo: { accountHolder, bankName, accountNumber, ifsc, upiId }
  };

  try {
    const res = await fetch(`${API_BASE}/api/admin/studio-profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok && data.success) {
      activeProfileData = data.studio;
      loadAndRenderProfileSettings();
      closeModal('edit-payment-modal');
      window.api.showToast('Payment information updated! 💳', 'success');
    } else {
      window.api.showToast(data.error || 'Failed to update payment info', 'error');
    }
  } catch (err) {
    window.api.showToast('Server error saving payment details', 'error');
  }
}

function toggleInlineSocialEdit(show) {
  const viewMode = document.getElementById('social-card-view-mode');
  const editMode = document.getElementById('social-card-edit-mode');
  if (!viewMode || !editMode) return;

  if (show) {
    const s = activeProfileData?.socialLinks || {};
    const inFb = document.getElementById('inline-social-fb');
    const inIg = document.getElementById('inline-social-ig');
    const inYt = document.getElementById('inline-social-yt');
    const inWeb = document.getElementById('inline-social-web');

    if (inFb) inFb.value = s.facebook || '';
    if (inIg) inIg.value = s.instagram || '';
    if (inYt) inYt.value = s.youtube || '';
    if (inWeb) inWeb.value = s.website || '';

    viewMode.style.display = 'none';
    editMode.style.display = 'block';
  } else {
    viewMode.style.display = 'block';
    editMode.style.display = 'none';
  }
}

async function saveInlineSocialLinks(e) {
  if (e) e.preventDefault();
  const facebook = document.getElementById('inline-social-fb')?.value.trim();
  const instagram = document.getElementById('inline-social-ig')?.value.trim();
  const youtube = document.getElementById('inline-social-yt')?.value.trim();
  const website = document.getElementById('inline-social-web')?.value.trim();

  const payload = {
    ...(activeProfileData || {}),
    socialLinks: { facebook, instagram, youtube, website }
  };

  try {
    const res = await fetch(`${API_BASE}/api/admin/studio-profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok && data.success) {
      activeProfileData = data.studio;
      localStorage.setItem('dm_current_studio', JSON.stringify(data.studio));
      loadAndRenderProfileSettings();
      toggleInlineSocialEdit(false);
      window.api.showToast('Social links updated! 🌐', 'success');
    } else {
      window.api.showToast(data.error || 'Failed to update links', 'error');
    }
  } catch (err) {
    window.api.showToast('Server error updating links', 'error');
  }
}

function toggleInlinePassEdit(show) {
  const viewMode = document.getElementById('pass-card-view-mode');
  const editMode = document.getElementById('pass-card-edit-mode');
  if (!viewMode || !editMode) return;

  if (show) {
    const cur = document.getElementById('inline-pass-cur');
    const n = document.getElementById('inline-pass-new');
    const conf = document.getElementById('inline-pass-conf');
    if (cur) cur.value = '';
    if (n) n.value = '';
    if (conf) conf.value = '';

    viewMode.style.display = 'none';
    editMode.style.display = 'block';
  } else {
    viewMode.style.display = 'block';
    editMode.style.display = 'none';
  }
}

async function saveInlinePassword(e) {
  if (e) e.preventDefault();
  const currentPassword = document.getElementById('inline-pass-cur')?.value.trim();
  const newPassword = document.getElementById('inline-pass-new')?.value.trim();
  const confirmPassword = document.getElementById('inline-pass-conf')?.value.trim();

  if (newPassword !== confirmPassword) {
    window.api.showToast('New passwords do not match!', 'error');
    return;
  }
  if (newPassword.length < 6) {
    window.api.showToast('Password must be at least 6 characters', 'error');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/admin/studio-profile/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      toggleInlinePassEdit(false);
      window.api.showToast('Password changed successfully! 🔐', 'success');
    } else {
      window.api.showToast(data.error || 'Failed to change password', 'error');
    }
  } catch (err) {
    window.api.showToast('Server error changing password', 'error');
  }
}

function toggleInlineFilesEdit(show) {
  const viewMode = document.getElementById('files-card-view-mode');
  const editMode = document.getElementById('files-card-edit-mode');
  if (!viewMode || !editMode) return;

  if (show) {
    viewMode.style.display = 'none';
    editMode.style.display = 'block';
  } else {
    viewMode.style.display = 'block';
    editMode.style.display = 'none';
  }
}

async function saveInlineFiles(e) {
  if (e) e.preventDefault();
  const fileLogo = document.getElementById('inline-file-logo')?.files?.[0];
  const fileSig = document.getElementById('inline-file-sig')?.files?.[0];

  if (!fileLogo && !fileSig) {
    window.api.showToast('Please select a Logo or Signature file to upload', 'info');
    toggleInlineFilesEdit(false);
    return;
  }

  try {
    if (fileLogo) {
      window.api.showToast('Uploading Logo...', 'info');
      const resp = await fetch(`${API_BASE}/api/admin/studio-profile/upload-media`, {
        method: 'POST',
        headers: {
          'x-media-type': 'logo',
          'x-filename': encodeURIComponent(fileLogo.name)
        },
        body: fileLogo
      });
      const data = await resp.json();
      if (data.url) {
        if (activeProfileData) activeProfileData.logoUrl = data.url;
        let studio = JSON.parse(localStorage.getItem('dm_current_studio') || '{}');
        studio.logoUrl = data.url;
        localStorage.setItem('dm_current_studio', JSON.stringify(studio));
      }
    }

    if (fileSig) {
      window.api.showToast('Uploading Signature...', 'info');
      const resp = await fetch(`${API_BASE}/api/admin/studio-profile/upload-media`, {
        method: 'POST',
        headers: {
          'x-media-type': 'signature',
          'x-filename': encodeURIComponent(fileSig.name)
        },
        body: fileSig
      });
      const data = await resp.json();
      if (data.url) {
        if (activeProfileData) activeProfileData.signatureUrl = data.url;
        let studio = JSON.parse(localStorage.getItem('dm_current_studio') || '{}');
        studio.signatureUrl = data.url;
        localStorage.setItem('dm_current_studio', JSON.stringify(studio));
      }
    }

    loadAndRenderProfileSettings();
    toggleInlineFilesEdit(false);
    window.api.showToast('Files uploaded to Studio Drive successfully! 🎨✨', 'success');
  } catch (err) {
    window.api.showToast('Error uploading files: ' + err.message, 'error');
  }
}

function toggleInlinePayEdit(show) {
  const viewMode = document.getElementById('pay-card-view-mode');
  const editMode = document.getElementById('pay-card-edit-mode');
  if (!viewMode || !editMode) return;

  if (show) {
    const pay = activeProfileData?.paymentInfo || {};
    const inHolder = document.getElementById('inline-pay-holder');
    const inBank = document.getElementById('inline-pay-bank');
    const inAcc = document.getElementById('inline-pay-accnum');
    const inIfsc = document.getElementById('inline-pay-ifsc');
    const inUpi = document.getElementById('inline-pay-upi');

    if (inHolder) inHolder.value = pay.accountHolder || activeProfileData?.studioName || 'DM STUDIO';
    if (inBank) inBank.value = pay.bankName || '';
    if (inAcc) inAcc.value = pay.accountNumber || '';
    if (inIfsc) inIfsc.value = pay.ifsc || '';
    if (inUpi) inUpi.value = pay.upiId || '8249861208@upi';

    viewMode.style.display = 'none';
    editMode.style.display = 'block';
  } else {
    viewMode.style.display = 'block';
    editMode.style.display = 'none';
  }
}

async function saveInlinePayInfo(e) {
  if (e) e.preventDefault();
  const accountHolder = document.getElementById('inline-pay-holder')?.value.trim();
  const bankName = document.getElementById('inline-pay-bank')?.value.trim();
  const accountNumber = document.getElementById('inline-pay-accnum')?.value.trim();
  const ifsc = document.getElementById('inline-pay-ifsc')?.value.trim();
  const upiId = document.getElementById('inline-pay-upi')?.value.trim();

  const payload = {
    ...(activeProfileData || {}),
    paymentInfo: { accountHolder, bankName, accountNumber, ifsc, upiId }
  };

  try {
    const res = await fetch(`${API_BASE}/api/admin/studio-profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok && data.success) {
      activeProfileData = data.studio;
      localStorage.setItem('dm_current_studio', JSON.stringify(data.studio));
      loadAndRenderProfileSettings();
      toggleInlinePayEdit(false);
      window.api.showToast('Payment information updated! 💳', 'success');
    } else {
      window.api.showToast(data.error || 'Failed to update payment info', 'error');
    }
  } catch (err) {
    window.api.showToast('Server error saving payment details', 'error');
  }
}

async function handleDeleteLogo() {
  if (!confirm('Are you sure you want to remove the logo and show default camera icon?')) return;

  try {
    window.api.showToast('Deleting Logo...', 'info');
    const res = await fetch(`${API_BASE}/api/admin/studio-profile/delete-logo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (res.ok && data.success) {
      activeProfileData = data.studio;
      localStorage.setItem('dm_current_studio', JSON.stringify(data.studio));
      currentStudio = data.studio;
      loadAndRenderProfileSettings();
      window.api.showToast('Logo removed! Default icon restored ✨', 'success');
    } else {
      window.api.showToast(data.error || 'Failed to delete logo', 'error');
    }
  } catch (err) {
    window.api.showToast('Server error deleting logo', 'error');
  }
}

// Window Exports for Profile Settings & Modals
window.openModal = openModal;
window.closeModal = closeModal;
window.loadAndRenderProfileSettings = loadAndRenderProfileSettings;
window.openEditProfileModal = openEditProfileModal;
window.handleSaveProfileInfo = handleSaveProfileInfo;
window.openEditSocialModal = openEditSocialModal;
window.handleSaveSocialLinks = handleSaveSocialLinks;
window.openChangePasswordModal = openChangePasswordModal;
window.handleSavePassword = handleSavePassword;
window.openUpdateFilesModal = openUpdateFilesModal;
window.previewSelectedModalFile = previewSelectedModalFile;
window.handleSaveFiles = handleSaveFiles;
window.triggerAvatarUpload = triggerAvatarUpload;
window.handleAvatarFileSelected = handleAvatarFileSelected;
window.handleDeleteLogo = handleDeleteLogo;
window.openEditPaymentModal = openEditPaymentModal;
window.handleSavePaymentInfo = handleSavePaymentInfo;
window.toggleInlineProfileEdit = toggleInlineProfileEdit;
window.saveInlineProfileInfo = saveInlineProfileInfo;
window.toggleInlineSocialEdit = toggleInlineSocialEdit;
window.saveInlineSocialLinks = saveInlineSocialLinks;
window.toggleInlinePassEdit = toggleInlinePassEdit;
window.saveInlinePassword = saveInlinePassword;
window.toggleInlineFilesEdit = toggleInlineFilesEdit;
window.saveInlineFiles = saveInlineFiles;
window.toggleInlinePayEdit = toggleInlinePayEdit;
window.saveInlinePayInfo = saveInlinePayInfo;

// ============================================================================
// --- STUDIO INVOICING & BILLING SYSTEM (NEW) ---
// ============================================================================

async function renderInvoicesView() {
  const container = document.getElementById('invoices-list-grid');
  if (!container) return;

  container.innerHTML = `
    <div style="grid-column:1/-1;text-align:center;padding:3rem;color:#94a3b8;">
      <div style="font-size:2rem;margin-bottom:0.5rem;animation:spin 1s linear infinite;">⏳</div>
      Loading Invoices...
    </div>
  `;

  try {
    const res = await fetch(`${API_BASE}/api/invoices`);
    allInvoices = await res.json();
    updateInvoiceStats();
    displayFilteredInvoices();
  } catch (err) {
    container.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:3rem;color:#ef4444;">
        Failed to load invoices: ${err.message}
      </div>
    `;
  }
}

function updateInvoiceStats() {
  const statTotal = document.getElementById('stat-invoice-total');
  const statReceived = document.getElementById('stat-invoice-received');
  const statBalance = document.getElementById('stat-invoice-balance');
  const statCount = document.getElementById('stat-invoice-count');

  let totalBilled = 0;
  let totalReceived = 0;
  let totalBalance = 0;

  allInvoices.forEach(inv => {
    totalBilled += Number(inv.grandTotal) || 0;
    totalReceived += Number(inv.advancePaid) || 0;
    totalBalance += Number(inv.balanceDue) || 0;
  });

  if (statTotal) statTotal.textContent = `₹${totalBilled.toLocaleString('en-IN')}`;
  if (statReceived) statReceived.textContent = `₹${totalReceived.toLocaleString('en-IN')}`;
  if (statBalance) statBalance.textContent = `₹${totalBalance.toLocaleString('en-IN')}`;
  if (statCount) statCount.textContent = `${allInvoices.length} Invoices`;
}

function filterInvoices(text) {
  displayFilteredInvoices(text);
}

function setInvoiceFilter(filter, btn) {
  activeInvoiceFilter = filter;
  document.querySelectorAll('.invoice-filter-btn').forEach(b => {
    b.style.background = 'rgba(255,255,255,0.05)';
    b.style.borderColor = 'rgba(255,255,255,0.12)';
    b.style.color = '#cbd5e1';
  });
  if (btn) {
    btn.style.background = 'rgba(212,175,55,0.15)';
    btn.style.borderColor = 'var(--gold-400)';
    btn.style.color = '#fde047';
  }
  const query = document.getElementById('search-invoices-input')?.value || '';
  displayFilteredInvoices(query);
}

function displayFilteredInvoices(queryText = '') {
  const container = document.getElementById('invoices-list-grid');
  if (!container) return;

  const query = queryText.toLowerCase().trim();
  const list = allInvoices.filter(inv => {
    // Status Filter
    if (activeInvoiceFilter === 'paid' && inv.status !== 'Paid') return false;
    if (activeInvoiceFilter === 'partial' && inv.status !== 'Partial') return false;
    if (activeInvoiceFilter === 'unpaid' && inv.status !== 'Unpaid') return false;

    // Search Query
    if (!query) return true;
    return (
      (inv.invoiceNumber && inv.invoiceNumber.toLowerCase().includes(query)) ||
      (inv.clientName && inv.clientName.toLowerCase().includes(query)) ||
      (inv.clientPhone && inv.clientPhone.includes(query)) ||
      (inv.eventName && inv.eventName.toLowerCase().includes(query))
    );
  });

  if (list.length === 0) {
    container.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:4rem 2rem;background:rgba(15,23,42,0.6);border:1px dashed rgba(212,175,55,0.3);border-radius:16px;">
        <div style="font-size:3rem;margin-bottom:0.5rem;">📄</div>
        <h3 class="gold-gradient-text" style="font-family:'Cinzel',serif;font-size:1.3rem;margin:0 0 0.5rem 0;">No Invoices Found</h3>
        <p style="color:#94a3b8;font-size:0.85rem;margin-bottom:1.25rem;">
          ${query ? 'No bills match your search or filter.' : 'You have not created any client invoices yet.'}
        </p>
        <button class="btn btn-primary" onclick="openCreateInvoiceModal()">
          + Create Your First Invoice
        </button>
      </div>
    `;
    return;
  }

  let html = '';
  list.forEach(inv => {
    const isPaid = inv.status === 'Paid';
    const isPartial = inv.status === 'Partial';
    const statusBg = isPaid ? 'rgba(34,197,94,0.15)' : (isPartial ? 'rgba(234,179,8,0.15)' : 'rgba(239,68,68,0.15)');
    const statusBorder = isPaid ? '#22c55e' : (isPartial ? '#eab308' : '#ef4444');
    const statusColor = isPaid ? '#86efac' : (isPartial ? '#fde047' : '#fca5a5');
    const statusLabel = isPaid ? '🟢 PAID' : (isPartial ? '🟡 PARTIAL' : '🔴 UNPAID');

    const totalStr = Number(inv.grandTotal || 0).toLocaleString('en-IN');
    const advanceStr = Number(inv.advancePaid || 0).toLocaleString('en-IN');
    const balanceStr = Number(inv.balanceDue || 0).toLocaleString('en-IN');

    html += `
      <div class="glass-card" style="background:linear-gradient(145deg, rgba(15,23,42,0.92) 0%, rgba(9,13,22,0.98) 100%);border:1.5px solid rgba(212,175,55,0.3);border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,0.6);display:flex;flex-direction:column;justify-content:space-between;padding:1.4rem;gap:1.25rem;">
        
        <!-- Invoice Header -->
        <div>
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:0.75rem;">
            <div>
              <span style="font-family:monospace;font-size:0.95rem;font-weight:900;color:#fde047;letter-spacing:0.04em;">
                ${escapeHtml(inv.invoiceNumber)}
              </span>
              <div style="font-size:0.75rem;color:#94a3b8;margin-top:2px;">
                📅 ${inv.invoiceDate || 'No Date'}
              </div>
            </div>
            <span style="background:${statusBg};border:1px solid ${statusBorder};color:${statusColor};font-size:0.7rem;font-weight:800;padding:3px 10px;border-radius:20px;letter-spacing:0.05em;">
              ${statusLabel}
            </span>
          </div>

          <!-- Client & Event Info -->
          <div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:0.75rem;margin-bottom:0.75rem;">
            <h4 style="font-family:'Cinzel',serif;font-size:1.2rem;font-weight:800;color:#ffffff;margin:0 0 3px 0;line-height:1.3;">
              ${escapeHtml(inv.clientName)}
            </h4>
            <div style="font-size:0.8rem;color:#94a3b8;display:flex;align-items:center;gap:0.4rem;">
              <span>📞 ${escapeHtml(inv.clientPhone || 'No Phone')}</span>
              ${inv.eventName ? `<span>• 🎪 ${escapeHtml(inv.eventName)}</span>` : ''}
            </div>
          </div>

          <!-- Financial Breakdown Box -->
          <div style="background:rgba(0,0,0,0.4);border:1px solid rgba(212,175,55,0.2);border-radius:10px;padding:0.75rem 0.9rem;display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.5rem;text-align:center;">
            <div>
              <div style="font-size:0.68rem;color:#94a3b8;font-weight:700;">TOTAL</div>
              <div style="font-size:0.95rem;font-weight:800;color:#fff;font-family:monospace;">₹${totalStr}</div>
            </div>
            <div>
              <div style="font-size:0.68rem;color:#86efac;font-weight:700;">ADVANCE</div>
              <div style="font-size:0.95rem;font-weight:800;color:#22c55e;font-family:monospace;">₹${advanceStr}</div>
            </div>
            <div>
              <div style="font-size:0.68rem;color:#fca5a5;font-weight:700;">BALANCE</div>
              <div style="font-size:0.95rem;font-weight:800;color:#ef4444;font-family:monospace;">₹${balanceStr}</div>
            </div>
          </div>
        </div>

        <!-- Action Buttons: VIEW/PRINT, EDIT, WHATSAPP, DELETE -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;border-top:1px solid rgba(255,255,255,0.08);padding-top:0.9rem;">
          <button type="button" class="btn" style="height:36px;background:linear-gradient(135deg, #fde047 0%, #d4af37 100%);color:#000;font-weight:800;font-size:0.8rem;border:none;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;" onclick="openInvoicePreview('${inv.id}')">
            🖨️ PRINT / PDF
          </button>
          
          <button type="button" class="btn" style="height:36px;background:#25D366;color:#fff;font-weight:700;font-size:0.8rem;border:none;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;" onclick="shareInvoiceWhatsApp('${inv.id}')">
            💬 WHATSAPP
          </button>

          <button type="button" class="btn" style="height:36px;background:rgba(255,255,255,0.08);border:1px solid rgba(212,175,55,0.4);color:#fde047;font-weight:700;font-size:0.8rem;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;" onclick="openEditInvoiceModal('${inv.id}')">
            ✏️ EDIT BILL
          </button>

          <button type="button" class="btn" style="height:36px;background:rgba(220,38,38,0.15);border:1px solid rgba(220,38,38,0.4);color:#f87171;font-weight:700;font-size:0.8rem;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;" onclick="deleteInvoicePrompt('${inv.id}', '${inv.invoiceNumber}')">
            🗑️ DELETE
          </button>
        </div>

      </div>
    `;
  });

  container.innerHTML = html;
}

function openCreateInvoiceModal() {
  const heading = document.getElementById('invoice-modal-heading');
  const formId = document.getElementById('inv-form-id');
  const invNumber = document.getElementById('inv-form-number');
  const invDate = document.getElementById('inv-form-date');
  const dueDate = document.getElementById('inv-form-due-date');
  const clientSelect = document.getElementById('inv-form-client-select');
  const clientName = document.getElementById('inv-form-client-name');
  const clientPhone = document.getElementById('inv-form-client-phone');
  const clientEmail = document.getElementById('inv-form-client-email');
  const eventName = document.getElementById('inv-form-event-name');
  const discount = document.getElementById('inv-form-discount');
  const taxPct = document.getElementById('inv-form-tax-pct');
  const advance = document.getElementById('inv-form-advance');

  if (heading) heading.textContent = 'Create Client Invoice';
  if (formId) formId.value = '';

  const studio = currentStudio || JSON.parse(localStorage.getItem('dm_current_studio') || '{}');
  const inStudioName = document.getElementById('inv-form-studio-name');
  const inStudioTagline = document.getElementById('inv-form-studio-tagline');
  const inStudioContact = document.getElementById('inv-form-studio-contact');

  if (inStudioName) inStudioName.value = studio.studioName || 'DM STUDIO';
  if (inStudioTagline) inStudioTagline.value = studio.tagline || 'Wedding & Cinematic Photography';
  if (inStudioContact) inStudioContact.value = `${studio.phone || '8249861208'} | ${studio.email || 'dmfilmsmaker@gmail.com'}`;

  const now = new Date();
  const year = now.getFullYear();
  const count = (allInvoices.length + 1).toString().padStart(3, '0');
  if (invNumber) invNumber.value = `INV-${year}-${count}`;
  
  const dStr = String(now.getDate()).padStart(2, '0');
  const mStr = String(now.getMonth() + 1).padStart(2, '0');
  if (invDate) invDate.value = `${dStr}-${mStr}-${year}`;
  
  const due = new Date();
  due.setDate(due.getDate() + 15);
  const dueD = String(due.getDate()).padStart(2, '0');
  const dueM = String(due.getMonth() + 1).padStart(2, '0');
  const dueY = due.getFullYear();
  if (dueDate) dueDate.value = `${dueD}-${dueM}-${dueY}`;

  if (clientName) clientName.value = '';
  if (clientPhone) clientPhone.value = '';
  if (clientEmail) clientEmail.value = '';
  if (eventName) eventName.value = 'Wedding & Reception Photography';
  if (discount) discount.value = '0';
  if (taxPct) taxPct.value = '0';
  if (advance) advance.value = '0';

  // Populate client dropdown
  if (clientSelect) {
    clientSelect.innerHTML = `<option value="">-- Select Client to Auto-Fill --</option>` +
      (allClients || []).map(c => `<option value="${c.code}">${escapeHtml(c.name)} (${c.code})</option>`).join('');
  }

  // Set default initial service rows
  const tbody = document.getElementById('invoice-items-body');
  if (tbody) {
    tbody.innerHTML = '';
    addInvoiceItemRow({ description: 'Traditional & Candid Wedding Photography (Full Day)', qty: 1, rate: 25000 });
    addInvoiceItemRow({ description: 'Cinematic 4K Wedding Film & Highlights', qty: 1, rate: 20000 });
    addInvoiceItemRow({ description: 'Interactive 3D Virtual Album Flipbook Pro', qty: 1, rate: 5000 });
  }

  recalcInvoiceTotals();
  openModal('create-invoice-modal');
}

function openEditInvoiceModal(id) {
  const inv = allInvoices.find(i => i.id === id || i.invoiceNumber === id);
  if (!inv) return;

  const studio = currentStudio || JSON.parse(localStorage.getItem('dm_current_studio') || '{}');
  const inStudioName = document.getElementById('inv-form-studio-name');
  const inStudioTagline = document.getElementById('inv-form-studio-tagline');
  const inStudioContact = document.getElementById('inv-form-studio-contact');

  if (inStudioName) inStudioName.value = inv.studioName || studio.studioName || 'DM STUDIO';
  if (inStudioTagline) inStudioTagline.value = inv.studioTagline || studio.tagline || 'Wedding & Cinematic Photography';
  if (inStudioContact) inStudioContact.value = inv.studioContact || `${studio.phone || '8249861208'} | ${studio.email || 'dmfilmsmaker@gmail.com'}`;

  const heading = document.getElementById('invoice-modal-heading');
  const formId = document.getElementById('inv-form-id');
  const invNumber = document.getElementById('inv-form-number');
  const invDate = document.getElementById('inv-form-date');
  const dueDate = document.getElementById('inv-form-due-date');
  const clientSelect = document.getElementById('inv-form-client-select');
  const clientName = document.getElementById('inv-form-client-name');
  const clientPhone = document.getElementById('inv-form-client-phone');
  const clientEmail = document.getElementById('inv-form-client-email');
  const eventName = document.getElementById('inv-form-event-name');
  const payMethod = document.getElementById('inv-form-pay-method');
  const terms = document.getElementById('inv-form-terms');
  const discount = document.getElementById('inv-form-discount');
  const taxPct = document.getElementById('inv-form-tax-pct');
  const advance = document.getElementById('inv-form-advance');

  if (heading) heading.textContent = `Edit Invoice (${inv.invoiceNumber})`;
  if (formId) formId.value = inv.id;
  if (invNumber) invNumber.value = inv.invoiceNumber;
  if (invDate) invDate.value = inv.invoiceDate || '';
  if (dueDate) dueDate.value = inv.dueDate || '';
  if (clientName) clientName.value = inv.clientName || '';
  if (clientPhone) clientPhone.value = inv.clientPhone || '';
  if (clientEmail) clientEmail.value = inv.clientEmail || '';
  if (eventName) eventName.value = inv.eventName || '';
  if (payMethod) payMethod.value = inv.paymentMethod || 'UPI / Bank Transfer';
  if (terms) terms.value = inv.terms || '';
  if (discount) discount.value = inv.discount || '0';
  if (taxPct) taxPct.value = inv.taxPercent || '0';
  if (advance) advance.value = inv.advancePaid || '0';

  if (clientSelect) {
    clientSelect.innerHTML = `<option value="">-- Select Client to Auto-Fill --</option>` +
      (allClients || []).map(c => `<option value="${c.code}" ${c.code === inv.clientCode ? 'selected' : ''}>${escapeHtml(c.name)} (${c.code})</option>`).join('');
  }

  // Populate items
  const tbody = document.getElementById('invoice-items-body');
  if (tbody) {
    tbody.innerHTML = '';
    if (inv.items && inv.items.length > 0) {
      inv.items.forEach(it => addInvoiceItemRow(it));
    } else {
      addInvoiceItemRow({ description: 'Photography Services', qty: 1, rate: inv.grandTotal || 0 });
    }
  }

  recalcInvoiceTotals();
  openModal('create-invoice-modal');
}

function onInvoiceClientSelectChange(code) {
  if (!code) return;
  const client = (allClients || []).find(c => c.code === code || c.id === code);
  if (!client) return;

  const clientName = document.getElementById('inv-form-client-name');
  const clientPhone = document.getElementById('inv-form-client-phone');
  const clientEmail = document.getElementById('inv-form-client-email');
  const eventName = document.getElementById('inv-form-event-name');

  if (clientName) clientName.value = client.name || '';
  if (clientPhone) clientPhone.value = client.phone || '';
  if (clientEmail) clientEmail.value = client.email || '';
  if (eventName) eventName.value = `${client.name}'s Wedding & Reception Photography`;
}

function addInvoiceItemRow(item = {}) {
  const tbody = document.getElementById('invoice-items-body');
  if (!tbody) return;

  const row = document.createElement('tr');
  row.className = 'invoice-item-row';
  row.style.borderBottom = '1px solid rgba(255,255,255,0.06)';

  const desc = item.description || '';
  const qty = Number(item.qty) || 1;
  const rate = Number(item.rate) || 0;
  const total = qty * rate;

  row.innerHTML = `
    <td style="padding:6px;">
      <input type="text" class="form-control inv-item-desc" placeholder="e.g. Candid Photography" value="${escapeHtml(desc)}" style="background:#05070d;border:1px solid rgba(255,255,255,0.15);color:#fff;font-size:0.85rem;padding:5px 8px;" required>
    </td>
    <td style="padding:6px;">
      <input type="number" class="form-control inv-item-qty" min="1" value="${qty}" style="background:#05070d;border:1px solid rgba(255,255,255,0.15);color:#fff;font-size:0.85rem;padding:5px 8px;" oninput="recalcInvoiceTotals()" required>
    </td>
    <td style="padding:6px;">
      <input type="number" class="form-control inv-item-rate" min="0" value="${rate}" style="background:#05070d;border:1px solid rgba(255,255,255,0.15);color:#ffffff;font-weight:600;font-size:0.85rem;padding:5px 8px;" oninput="recalcInvoiceTotals()" required>
    </td>
    <td style="padding:6px;text-align:right;font-family:monospace;font-weight:800;color:#fff;">
      <span class="inv-item-total-display">₹${total.toLocaleString('en-IN')}</span>
    </td>
    <td style="padding:6px;text-align:center;">
      <button type="button" style="background:rgba(239,68,68,0.2);border:none;color:#ef4444;border-radius:4px;width:26px;height:26px;cursor:pointer;font-weight:900;" onclick="removeInvoiceItemRow(this)" title="Remove item">✕</button>
    </td>
  `;

  tbody.appendChild(row);
  recalcInvoiceTotals();
}

function removeInvoiceItemRow(btn) {
  const row = btn.closest('tr');
  if (row) row.remove();
  recalcInvoiceTotals();
}

function recalcInvoiceTotals() {
  const rows = document.querySelectorAll('.invoice-item-row');
  let subtotal = 0;

  rows.forEach(row => {
    const qty = Number(row.querySelector('.inv-item-qty')?.value) || 0;
    const rate = Number(row.querySelector('.inv-item-rate')?.value) || 0;
    const total = qty * rate;
    subtotal += total;

    const display = row.querySelector('.inv-item-total-display');
    if (display) display.textContent = `₹${total.toLocaleString('en-IN')}`;
  });

  const discount = Number(document.getElementById('inv-form-discount')?.value) || 0;
  const taxPct = Number(document.getElementById('inv-form-tax-pct')?.value) || 0;
  const advance = Number(document.getElementById('inv-form-advance')?.value) || 0;

  const afterDiscount = Math.max(0, subtotal - discount);
  const taxAmount = taxPct > 0 ? Math.round((afterDiscount * taxPct) / 100) : 0;
  const grandTotal = Math.max(0, afterDiscount + taxAmount);
  const balanceDue = Math.max(0, grandTotal - advance);

  const subEl = document.getElementById('inv-calc-subtotal');
  const grandEl = document.getElementById('inv-calc-grand-total');
  const balEl = document.getElementById('inv-calc-balance-due');

  if (subEl) subEl.textContent = `₹${subtotal.toLocaleString('en-IN')}`;
  if (grandEl) grandEl.textContent = `₹${grandTotal.toLocaleString('en-IN')}`;
  if (balEl) balEl.textContent = `₹${balanceDue.toLocaleString('en-IN')}`;
}

async function handleSaveInvoice(e) {
  if (e) e.preventDefault();

  const formId = document.getElementById('inv-form-id')?.value;
  const invoiceNumber = document.getElementById('inv-form-number')?.value.trim();
  const invoiceDate = document.getElementById('inv-form-date')?.value;
  const dueDate = document.getElementById('inv-form-due-date')?.value;
  const clientCode = document.getElementById('inv-form-client-select')?.value || '';
  const clientName = document.getElementById('inv-form-client-name')?.value.trim();
  const clientPhone = document.getElementById('inv-form-client-phone')?.value.trim();
  const clientEmail = document.getElementById('inv-form-client-email')?.value.trim();
  const eventName = document.getElementById('inv-form-event-name')?.value.trim();
  const paymentMethod = document.getElementById('inv-form-pay-method')?.value.trim();
  const terms = document.getElementById('inv-form-terms')?.value.trim();

  const discount = Number(document.getElementById('inv-form-discount')?.value) || 0;
  const taxPercent = Number(document.getElementById('inv-form-tax-pct')?.value) || 0;
  const advancePaid = Number(document.getElementById('inv-form-advance')?.value) || 0;

  const rows = document.querySelectorAll('.invoice-item-row');
  const items = [];
  rows.forEach((row, i) => {
    const description = row.querySelector('.inv-item-desc')?.value.trim() || `Service #${i + 1}`;
    const qty = Number(row.querySelector('.inv-item-qty')?.value) || 1;
    const rate = Number(row.querySelector('.inv-item-rate')?.value) || 0;
    items.push({ id: `item_${i + 1}`, description, qty, rate, total: qty * rate });
  });

  if (items.length === 0) {
    window.api.showToast('Please add at least one service item row', 'error');
    return;
  }

  const studio = currentStudio || JSON.parse(localStorage.getItem('dm_current_studio') || '{}');
  const customStudioName = document.getElementById('inv-form-studio-name')?.value.trim() || studio.studioName || 'DM STUDIO';
  const customStudioTagline = document.getElementById('inv-form-studio-tagline')?.value.trim() || studio.tagline || 'Wedding & Cinematic Photography';
  const customStudioContact = document.getElementById('inv-form-studio-contact')?.value.trim() || `${studio.phone || '8249861208'} | ${studio.email || 'dmfilmsmaker@gmail.com'}`;
  const studioId = studio.id || '';

  const payload = {
    id: formId || undefined,
    invoiceNumber,
    invoiceDate,
    dueDate,
    clientCode,
    clientName,
    clientPhone,
    clientEmail,
    eventName,
    paymentMethod,
    terms,
    items,
    discount,
    taxPercent,
    advancePaid,
    studioId,
    studioName: customStudioName,
    studioTagline: customStudioTagline,
    studioContact: customStudioContact
  };

  try {
    const isEdit = Boolean(formId);
    const url = isEdit ? `${API_BASE}/api/invoices/${encodeURIComponent(formId)}` : `${API_BASE}/api/invoices`;
    const method = isEdit ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (res.ok && data.success) {
      window.api.showToast(`✔ Invoice ${invoiceNumber} saved successfully! ✨`, 'success');
      closeModal('create-invoice-modal');
      renderInvoicesView();
    } else {
      window.api.showToast(data.error || 'Failed to save invoice', 'error');
    }
  } catch (err) {
    window.api.showToast('Server error saving invoice', 'error');
  }
}

async function deleteInvoicePrompt(id, invoiceNumber) {
  if (!confirm(`Are you sure you want to delete invoice ${invoiceNumber}?`)) return;

  try {
    const res = await fetch(`${API_BASE}/api/invoices/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (res.ok) {
      window.api.showToast(`🗑️ Invoice ${invoiceNumber} deleted!`, 'success');
      renderInvoicesView();
    } else {
      window.api.showToast('Failed to delete invoice', 'error');
    }
  } catch (err) {
    window.api.showToast('Server error deleting invoice', 'error');
  }
}

function openInvoicePreview(id) {
  const inv = allInvoices.find(i => i.id === id || i.invoiceNumber === id);
  if (!inv) return;

  currentActiveInvoice = inv;
  const studio = currentStudio || JSON.parse(localStorage.getItem('dm_current_studio') || '{}');
  const pay = studio.paymentInfo || {};
  const logoUrl = studio.logoUrl || studio.avatarUrl || '';
  const sigUrl = studio.signatureUrl || '';

  const displayStudioName = inv.studioName || studio.studioName || 'DM STUDIO';
  const displayStudioTagline = inv.studioTagline || studio.tagline || 'Wedding & Cinematic Photography';
  const displayStudioContact = inv.studioContact || `📞 ${studio.phone || '8249861208'} | 📧 ${studio.email || 'dmfilmsmaker@gmail.com'}`;

  const heading = document.getElementById('inv-preview-heading');
  if (heading) heading.textContent = `Invoice #${inv.invoiceNumber} - ${inv.clientName}`;

  const container = document.getElementById('invoice-printable-container');
  if (!container) return;

  const totalStr = Number(inv.grandTotal || 0).toLocaleString('en-IN');
  const subtotalStr = Number(inv.subtotal || 0).toLocaleString('en-IN');
  const advanceStr = Number(inv.advancePaid || 0).toLocaleString('en-IN');
  const balanceStr = Number(inv.balanceDue || 0).toLocaleString('en-IN');
  const discountStr = Number(inv.discount || 0).toLocaleString('en-IN');
  const isPaid = inv.status === 'Paid';
  const isPartial = inv.status === 'Partial';
  const statusColor = isPaid ? '#15803d' : (isPartial ? '#b45309' : '#b91c1c');
  const statusBg = isPaid ? '#dcfce7' : (isPartial ? '#fef3c7' : '#fee2e2');

  let itemsHtml = '';
  (inv.items || []).forEach((item, index) => {
    itemsHtml += `
      <tr style="border-bottom:1px solid #e2e8f0;">
        <td style="padding:10px 12px;font-size:0.9rem;color:#0f172a;font-weight:600;">
          ${index + 1}. ${escapeHtml(item.description)}
        </td>
        <td style="padding:10px 12px;font-size:0.9rem;color:#475569;text-align:center;">
          ${item.qty}
        </td>
        <td style="padding:10px 12px;font-size:0.9rem;color:#475569;text-align:right;">
          ₹${Number(item.rate).toLocaleString('en-IN')}
        </td>
        <td style="padding:10px 12px;font-size:0.95rem;color:#0f172a;font-weight:800;text-align:right;font-family:monospace;">
          ₹${Number(item.total).toLocaleString('en-IN')}
        </td>
      </tr>
    `;
  });

  container.innerHTML = `
    <div id="print-invoice-sheet" style="max-width:760px;margin:0 auto;background:#ffffff;padding:2.5rem;border-radius:12px;box-shadow:0 4px 25px rgba(0,0,0,0.06);color:#0f172a;line-height:1.5;">
      
      <!-- Invoice Header: Studio Branding & Invoice Details -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #b8860b;padding-bottom:1.5rem;margin-bottom:1.5rem;">
        <div>
          ${logoUrl ? `<img src="${logoUrl}" style="height:55px;object-fit:contain;margin-bottom:0.5rem;">` : ''}
          <h2 style="font-family:'Cinzel',serif;font-size:1.6rem;font-weight:900;color:#0f172a;margin:0 0 4px 0;letter-spacing:0.02em;">
            ${escapeHtml(displayStudioName)}
          </h2>
          <div style="font-size:0.85rem;color:#64748b;font-weight:600;">
            ${escapeHtml(displayStudioTagline)}
          </div>
          <div style="font-size:0.85rem;color:#475569;margin-top:4px;">
            ${escapeHtml(displayStudioContact)}
          </div>
        </div>

        <div style="text-align:right;">
          <div style="font-family:'Cinzel',serif;font-size:1.8rem;font-weight:900;color:#b8860b;letter-spacing:0.04em;">
            INVOICE
          </div>
          <div style="font-size:1.05rem;font-weight:800;color:#0f172a;font-family:monospace;margin-top:2px;">
            ${escapeHtml(inv.invoiceNumber)}
          </div>
          <div style="font-size:0.85rem;color:#64748b;margin-top:4px;">
            <strong>Date:</strong> ${inv.invoiceDate || '---'}
          </div>
          ${inv.dueDate ? `<div style="font-size:0.85rem;color:#64748b;"><strong>Due Date:</strong> ${inv.dueDate}</div>` : ''}
          <div style="margin-top:6px;">
            <span style="background:${statusBg};color:${statusColor};border:1px solid ${statusColor};font-size:0.75rem;font-weight:800;padding:3px 10px;border-radius:4px;">
              ${inv.status?.toUpperCase() || 'UNPAID'}
            </span>
          </div>
        </div>
      </div>

      <!-- Bill To & Event Details Grid -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:2rem;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:1.25rem;margin-bottom:1.75rem;">
        <div>
          <div style="font-size:0.75rem;font-weight:800;color:#94a3b8;text-transform:uppercase;margin-bottom:4px;">BILL TO CLIENT:</div>
          <div style="font-size:1.15rem;font-weight:800;color:#0f172a;">${escapeHtml(inv.clientName)}</div>
          <div style="font-size:0.85rem;color:#475569;margin-top:2px;">📞 ${escapeHtml(inv.clientPhone || '---')}</div>
          ${inv.clientEmail ? `<div style="font-size:0.85rem;color:#475569;">📧 ${escapeHtml(inv.clientEmail)}</div>` : ''}
        </div>

        <div>
          <div style="font-size:0.75rem;font-weight:800;color:#94a3b8;text-transform:uppercase;margin-bottom:4px;">EVENT OCCASION:</div>
          <div style="font-size:1.05rem;font-weight:800;color:#0f172a;">${escapeHtml(inv.eventName || 'Wedding Photography')}</div>
          ${inv.eventDate ? `<div style="font-size:0.85rem;color:#475569;margin-top:2px;">📅 Event Date: ${inv.eventDate}</div>` : ''}
          ${inv.venue ? `<div style="font-size:0.85rem;color:#475569;">📍 Venue: ${escapeHtml(inv.venue)}</div>` : ''}
        </div>
      </div>

      <!-- Itemized Services Table -->
      <table style="width:100%;border-collapse:collapse;margin-bottom:1.5rem;">
        <thead>
          <tr style="background:#0f172a;color:#ffffff;text-align:left;">
            <th style="padding:10px 12px;font-size:0.8rem;border-top-left-radius:6px;">DESCRIPTION</th>
            <th style="padding:10px 12px;font-size:0.8rem;text-align:center;">QTY</th>
            <th style="padding:10px 12px;font-size:0.8rem;text-align:right;">RATE</th>
            <th style="padding:10px 12px;font-size:0.8rem;text-align:right;border-top-right-radius:6px;">AMOUNT (₹)</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>

      <!-- Totals & Payment Summary Grid -->
      <div style="display:grid;grid-template-columns:1.2fr 1fr;gap:2rem;margin-bottom:1.75rem;">
        
        <!-- Left: Bank Account / UPI Details -->
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:1.1rem;font-size:0.85rem;">
          <div style="font-size:0.78rem;font-weight:800;color:#b8860b;text-transform:uppercase;margin-bottom:6px;">
            💳 PAYMENT DETAILS
          </div>
          <div><strong>Account Holder:</strong> ${escapeHtml(pay.accountHolder || studio.studioName || 'DM STUDIO')}</div>
          ${pay.bankName ? `<div><strong>Bank:</strong> ${escapeHtml(pay.bankName)}</div>` : ''}
          ${pay.accountNumber ? `<div><strong>Acc Number:</strong> ${escapeHtml(pay.accountNumber)}</div>` : ''}
          ${pay.ifsc ? `<div><strong>IFSC Code:</strong> ${escapeHtml(pay.ifsc)}</div>` : ''}
          <div style="margin-top:6px;font-weight:800;color:#0284c7;font-size:0.95rem;">
            📱 UPI ID: ${escapeHtml(pay.upiId || '8249861208@upi')}
          </div>
        </div>

        <!-- Right: Financial Summary -->
        <div style="display:flex;flex-direction:column;gap:6px;font-size:0.9rem;">
          <div style="display:flex;justify-content:space-between;color:#64748b;">
            <span>Subtotal:</span>
            <span style="font-family:monospace;color:#0f172a;">₹${subtotalStr}</span>
          </div>
          ${inv.discount > 0 ? `
          <div style="display:flex;justify-content:space-between;color:#64748b;">
            <span>Discount:</span>
            <span style="font-family:monospace;color:#dc2626;">-₹${discountStr}</span>
          </div>` : ''}
          ${inv.taxPercent > 0 ? `
          <div style="display:flex;justify-content:space-between;color:#64748b;">
            <span>GST / Tax (${inv.taxPercent}%):</span>
            <span style="font-family:monospace;color:#0f172a;">+₹${Number(inv.taxAmount || 0).toLocaleString('en-IN')}</span>
          </div>` : ''}
          <div style="display:flex;justify-content:space-between;font-size:1.15rem;font-weight:900;border-top:2px solid #0f172a;padding-top:6px;color:#0f172a;">
            <span>Grand Total:</span>
            <span style="font-family:monospace;color:#b8860b;">₹${totalStr}</span>
          </div>
          <div style="display:flex;justify-content:space-between;background:#dcfce7;color:#15803d;padding:6px 10px;border-radius:6px;font-weight:800;">
            <span>Advance Received:</span>
            <span style="font-family:monospace;">₹${advanceStr}</span>
          </div>
          <div style="display:flex;justify-content:space-between;background:#fee2e2;color:#b91c1c;padding:6px 10px;border-radius:6px;font-weight:900;font-size:1.05rem;">
            <span>Balance Due:</span>
            <span style="font-family:monospace;">₹${balanceStr}</span>
          </div>
        </div>

      </div>

      <!-- Terms & Signature Footer -->
      <div style="display:flex;justify-content:space-between;align-items:flex-end;border-top:1px solid #e2e8f0;padding-top:1.25rem;font-size:0.78rem;color:#64748b;">
        <div style="max-width:60%;">
          <div style="font-weight:800;color:#0f172a;margin-bottom:3px;">Terms & Conditions:</div>
          <div style="white-space:pre-line;line-height:1.4;">${escapeHtml(inv.terms || 'Payment due on delivery.')}</div>
        </div>

        <div style="text-align:center;">
          ${sigUrl ? `<img src="${sigUrl}" style="height:42px;object-fit:contain;margin-bottom:4px;">` : ''}
          <div style="border-top:1px solid #0f172a;width:140px;padding-top:3px;font-weight:800;color:#0f172a;">
            Authorized Signatory
          </div>
          <div style="font-size:0.75rem;color:#94a3b8;">${escapeHtml(studio.studioName || 'DM STUDIO')}</div>
        </div>
      </div>

    </div>
  `;

  openModal('invoice-preview-modal');
}

function editCurrentActiveInvoice() {
  if (!currentActiveInvoice) return;
  closeModal('invoice-preview-modal');
  openEditInvoiceModal(currentActiveInvoice.id);
}
window.editCurrentActiveInvoice = editCurrentActiveInvoice;

function printActiveInvoice() {
  const container = document.getElementById('invoice-printable-container');
  if (!container) return;

  const printWindow = window.open('', '_blank', 'width=850,height=900');
  if (!printWindow) {
    window.print();
    return;
  }

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Invoice - ${escapeHtml(currentActiveInvoice?.invoiceNumber || 'Bill')}</title>
        <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@700;900&family=Inter:wght@400;600;700;800;900&display=swap" rel="stylesheet">
        <style>
          body { font-family: 'Inter', sans-serif; margin: 0; padding: 20px; background: #fff; color: #0f172a; }
          @media print {
            body { padding: 0; }
            @page { margin: 1.5cm; }
          }
        </style>
      </head>
      <body>
        ${container.innerHTML}
        <script>
          window.onload = function() {
            window.print();
            setTimeout(function() { window.close(); }, 500);
          };
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

function shareInvoiceWhatsApp(id) {
  const inv = allInvoices.find(i => i.id === id || i.invoiceNumber === id);
  if (!inv) return;

  const studio = currentStudio || JSON.parse(localStorage.getItem('dm_current_studio') || '{}');
  const pay = studio.paymentInfo || {};
  const totalStr = Number(inv.grandTotal || 0).toLocaleString('en-IN');
  const advanceStr = Number(inv.advancePaid || 0).toLocaleString('en-IN');
  const balanceStr = Number(inv.balanceDue || 0).toLocaleString('en-IN');

  const text = encodeURIComponent(
    `📸 *INVOICE FROM ${studio.studioName ? studio.studioName.toUpperCase() : 'DM STUDIO'}*\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📄 *Invoice No:* ${inv.invoiceNumber}\n` +
    `👤 *Client Name:* ${inv.clientName}\n` +
    `📅 *Date:* ${inv.invoiceDate || '---'}\n` +
    `🎪 *Event:* ${inv.eventName || 'Wedding Photography'}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `💰 *Grand Total:* ₹${totalStr}\n` +
    `🟢 *Advance Paid:* ₹${advanceStr}\n` +
    `🔴 *Balance Due:* ₹${balanceStr}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `💳 *UPI Payment ID:* ${pay.upiId || '8249861208@upi'}\n` +
    `🏦 *Bank Transfer:* ${pay.accountNumber ? `${pay.bankName} (A/C: ${pay.accountNumber}, IFSC: ${pay.ifsc})` : 'Contact studio for bank details'}\n\n` +
    `✨ _Thank you for choosing ${studio.studioName || 'DM STUDIO'}!_`
  );

  const phone = (inv.clientPhone || '').replace(/[^0-9]/g, '');
  const url = phone ? `https://api.whatsapp.com/send?phone=91${phone}&text=${text}` : `https://api.whatsapp.com/send?text=${text}`;
  window.open(url, '_blank');
}

function executeActiveInvoiceWhatsApp() {
  if (currentActiveInvoice) {
    shareInvoiceWhatsApp(currentActiveInvoice.id);
  }
}

// Window Exports for Invoices
window.renderInvoicesView = renderInvoicesView;
window.filterInvoices = filterInvoices;
window.setInvoiceFilter = setInvoiceFilter;
window.openCreateInvoiceModal = openCreateInvoiceModal;
window.openEditInvoiceModal = openEditInvoiceModal;
window.onInvoiceClientSelectChange = onInvoiceClientSelectChange;
window.addInvoiceItemRow = addInvoiceItemRow;
window.removeInvoiceItemRow = removeInvoiceItemRow;
window.recalcInvoiceTotals = recalcInvoiceTotals;
window.handleSaveInvoice = handleSaveInvoice;
window.deleteInvoicePrompt = deleteInvoicePrompt;
window.openInvoicePreview = openInvoicePreview;
window.printActiveInvoice = printActiveInvoice;
window.shareInvoiceWhatsApp = shareInvoiceWhatsApp;
window.executeActiveInvoiceWhatsApp = executeActiveInvoiceWhatsApp;

// ============================================================================
// --- SUBSCRIPTION & PAYMENT GATEWAY CONTROLLER (PHONEPE / UPI AUTO ACTIVATION) ---
// ============================================================================

let currentCheckoutPlan = { name: 'Silver Edition', amount: 199, durationDays: 30 };
let currentOrderId = null;
let checkoutTimerInterval = null;
let livePaymentPollingInterval = null;
let checkoutTimerSeconds = 15 * 60;
let currentActiveSubscription = null;

function openUpgradeModal() {
  openModal('upgrade-plan-modal');
}

function selectPlanUpgrade(planName, price) {
  if (price === 0) {
    executeActivateSubscription('Free Trial', 0, 'FREE_TRIAL_START');
    closeModal('upgrade-plan-modal');
    return;
  }

  currentCheckoutPlan = {
    name: planName,
    amount: price,
    durationDays: (price === 999 ? 365 : 30)
  };

  const studio = currentStudio || JSON.parse(localStorage.getItem('dm_current_studio') || '{}');
  const studioName = studio.studioName || 'DM FILMS MAKER';

  // 1. Immediately reset views and populate UI elements
  const checkoutView = document.getElementById('payment-checkout-view');
  const successView = document.getElementById('payment-success-view');
  if (checkoutView) checkoutView.style.display = 'grid';
  if (successView) successView.style.display = 'none';

  const studioNameEl = document.getElementById('pay-studio-name');
  const totalAmountEl = document.getElementById('pay-total-amount');
  const planBadgeEl = document.getElementById('pay-plan-badge');
  const qrImgEl = document.getElementById('pay-upi-qr-image');
  const mobileBtnEl = document.getElementById('pay-mobile-upi-btn');
  const liveStatusText = document.getElementById('pay-live-status-text');

  if (studioNameEl) studioNameEl.textContent = studioName;
  if (totalAmountEl) totalAmountEl.textContent = `₹${price}.00`;
  if (planBadgeEl) {
    planBadgeEl.textContent = planName === 'Silver Edition' 
      ? '💎 Silver Edition (30 Days Unlimited Access)' 
      : '👑 Gold Pro VIP (365 Days Unlimited Access)';
  }
  if (liveStatusText) {
    liveStatusText.textContent = 'Waiting for UPI payment... Auto-detecting live';
  }

  // Pre-render local QR immediately so user sees it with 0 latency
  const directUpi = `upi://pay?pa=9668584247@ybl&pn=DURJAN%20MAHANAND&am=${price}&cu=INR&tn=${encodeURIComponent('DM Photo SaaS - ' + planName)}`;
  if (qrImgEl) {
    qrImgEl.src = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(directUpi)}`;
  }
  if (mobileBtnEl) {
    mobileBtnEl.href = directUpi;
  }

  // 2. Open Modal Immediately!
  closeModal('upgrade-plan-modal');
  openModal('checkout-payment-modal');
  startCheckoutCountdown();

  // 3. Register live PhonePe backend order and start automatic polling
  const planType = (price === 999 || planName.includes('Gold')) ? 'YEARLY' : 'MONTHLY';
  fetch('/api/payment/phonepe/create-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      plan: planType,
      planName: planName,
      studioId: studio.id || 'studio_master_dm'
    })
  })
  .then(res => res.json())
  .then(orderData => {
    if (orderData && orderData.orderId) {
      currentOrderId = orderData.orderId;
      if (orderData.upiUri && qrImgEl) {
        qrImgEl.src = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(orderData.upiUri)}`;
      }
      if (orderData.upiUri && mobileBtnEl) {
        mobileBtnEl.href = orderData.upiUri;
      }
      startLivePaymentPolling(currentOrderId);
    }
  })
  .catch(err => {
    console.error('Failed to create PhonePe payment order:', err);
    currentOrderId = 'DM_' + Date.now();
    startLivePaymentPolling(currentOrderId);
  });
}

function startLivePaymentPolling(orderId) {
  if (livePaymentPollingInterval) clearInterval(livePaymentPollingInterval);

  livePaymentPollingInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/payment/status?orderId=${encodeURIComponent(orderId)}`);
      const data = await res.json();

      if (data && (data.status === 'SUCCESS' || data.status === 'PAID')) {
        clearInterval(livePaymentPollingInterval);
        if (checkoutTimerInterval) clearInterval(checkoutTimerInterval);

        currentActiveSubscription = data.subscription;
        updateSidebarSubscriptionBadge(data.subscription);

        // Automatic Live Payment Success Trigger!
        showLivePaymentSuccess(data.planName || data.plan, data.amount, data.utr, data.durationDays || 30);
      } else if (data && data.status === 'FAILED') {
        clearInterval(livePaymentPollingInterval);
        if (window.api && window.api.showToast) {
          window.api.showToast(data.message || 'Payment was not successful. Please try again.', 'error');
        }
      }
    } catch (e) {
      console.warn('PhonePe status polling check:', e);
    }
  }, 1800);
}

function startCheckoutCountdown() {
  if (checkoutTimerInterval) clearInterval(checkoutTimerInterval);
  checkoutTimerSeconds = 15 * 60; // 15:00

  const pill = document.getElementById('pay-countdown-pill');
  const timeoutClock = document.getElementById('phonepe-timeout-clock');
  
  function updatePill() {
    const mins = Math.floor(checkoutTimerSeconds / 60);
    const secs = checkoutTimerSeconds % 60;
    const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    if (pill) pill.textContent = `This QR will expire in ${formatted}`;
    if (timeoutClock) timeoutClock.textContent = formatted;
  }

  updatePill();

  checkoutTimerInterval = setInterval(() => {
    checkoutTimerSeconds--;
    if (checkoutTimerSeconds <= 0) {
      clearInterval(checkoutTimerInterval);
      if (pill) pill.textContent = 'This QR has expired';
      if (timeoutClock) timeoutClock.textContent = '00:00';
    } else {
      updatePill();
    }
  }, 1000);
}

async function submitPaymentVerification() {
  const utrInput = document.getElementById('pay-utr-input');
  const utrVal = (utrInput?.value || '').trim() || ('UPI' + Date.now().toString().slice(-8));

  await executeActivateSubscription(currentCheckoutPlan.name, currentCheckoutPlan.amount, utrVal);
}

async function executeActivateSubscription(planName, amount, utr) {
  try {
    const res = await fetch('/api/subscription/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planName,
        amount,
        utr: utr || ('UPI' + Date.now().toString().slice(-8)),
        paymentMethod: 'PhonePe / UPI QR (9668584247@ybl)'
      })
    });

    const data = await res.json();
    if (data.success) {
      currentActiveSubscription = data.subscription;
      updateSidebarSubscriptionBadge(data.subscription);

      if (checkoutTimerInterval) clearInterval(checkoutTimerInterval);

      if (amount === 0) {
        if (window.api && window.api.showToast) {
          window.api.showToast('🎉 Free Trial Plan is currently active!', 'success');
        }
      } else {
        // Trigger Live Green Payment Success Screen
        showLivePaymentSuccess(planName, amount, utr, data.subscription.durationDays || (amount === 999 ? 365 : 30));
      }
    } else {
      if (window.api && window.api.showToast) {
        window.api.showToast('Could not activate: ' + (data.error || 'Server error'), 'error');
      }
    }
  } catch (err) {
    console.error('Subscription activation failed:', err);
    if (window.api && window.api.showToast) {
      window.api.showToast('Network error activating plan', 'error');
    }
  }
}

function showLivePaymentSuccess(planName, amount, utr, durationDays) {
  const checkoutView = document.getElementById('payment-checkout-view');
  const successView = document.getElementById('payment-success-view');

  if (checkoutView) checkoutView.style.display = 'none';
  if (successView) {
    successView.style.display = 'block';
    
    const paidAmtEl = document.getElementById('success-paid-amount');
    const planNameEl = document.getElementById('success-plan-name');
    const utrEl = document.getElementById('success-utr-code');
    const validityEl = document.getElementById('success-validity');

    if (paidAmtEl) paidAmtEl.textContent = `₹${amount}.00`;
    if (planNameEl) planNameEl.textContent = planName;
    if (utrEl) utrEl.textContent = utr || ('UPI' + Date.now().toString().slice(-8));
    if (validityEl) validityEl.textContent = `${durationDays} Days Unlimited Access`;

    // Trigger celebration confetti
    triggerCelebrationConfetti();
  }
}

function triggerCelebrationConfetti() {
  const colors = ['#22c55e', '#16a34a', '#facc15', '#ec4899', '#8b5cf6', '#38bdf8'];
  for (let i = 0; i < 50; i++) {
    const el = document.createElement('div');
    el.style.position = 'fixed';
    el.style.zIndex = '99999999';
    el.style.width = (Math.random() * 9 + 6) + 'px';
    el.style.height = (Math.random() * 9 + 6) + 'px';
    el.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    el.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    el.style.left = (Math.random() * 85 + 5) + 'vw';
    el.style.top = '-20px';
    el.style.pointerEvents = 'none';
    el.style.transition = `all ${(Math.random() * 2 + 1.5).toFixed(2)}s cubic-bezier(0.25, 1, 0.5, 1)`;
    document.body.appendChild(el);

    setTimeout(() => {
      el.style.top = (Math.random() * 65 + 35) + 'vh';
      el.style.transform = `rotate(${Math.random() * 720 - 360}deg) scale(0)`;
      el.style.opacity = '0';
    }, 50);

    setTimeout(() => {
      el.remove();
    }, 3500);
  }
}

async function loadCurrentSubscription() {
  try {
    const res = await fetch('/api/subscription/current');
    const data = await res.json();
    if (data && data.status === 'ACTIVE') {
      currentActiveSubscription = data;
      updateSidebarSubscriptionBadge(data);
    }
  } catch (err) {
    console.error('Failed to load subscription:', err);
  }
}

function updateSidebarSubscriptionBadge(sub) {
  const banner = document.querySelector('.upgrade-sidebar-card');
  if (!banner || !sub) return;

  if (sub.planName === 'Free Trial' || sub.amount === 0) {
    banner.innerHTML = `
      <div style="display:flex;align-items:center;gap:0.6rem;">
        <div class="upgrade-crown-icon">👑</div>
        <div>
          <div style="color:#000;font-weight:900;font-size:0.8rem;line-height:1.1;letter-spacing:0.04em;">UPGRADE YOUR PLAN</div>
          <div style="color:#3a2903;font-weight:800;font-size:0.64rem;letter-spacing:0.08em;margin-top:2px;">UNLIMITED ACCESS</div>
        </div>
      </div>
      <div class="upgrade-arrow-icon">›</div>
    `;
    return;
  }

  const isGold = sub.planName.includes('Gold');
  const icon = isGold ? '👑' : '💎';
  const title = isGold ? 'GOLD VIP ACTIVE' : 'SILVER ACTIVE';
  const subtitle = sub.daysLeft !== undefined ? `${sub.daysLeft} DAYS LEFT` : 'ACTIVE ACCESS';

  banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:0.6rem;">
      <div class="upgrade-crown-icon">${icon}</div>
      <div>
        <div style="color:#000;font-weight:900;font-size:0.78rem;line-height:1.1;letter-spacing:0.04em;">${title}</div>
        <div style="color:#3a2903;font-weight:800;font-size:0.62rem;letter-spacing:0.08em;margin-top:2px;">${subtitle}</div>
      </div>
    </div>
    <div class="upgrade-arrow-icon" style="color:#000;font-size:0.9rem;font-weight:900;">✔</div>
  `;
}

// Window Exports
window.openUpgradeModal = openUpgradeModal;
window.selectPlanUpgrade = selectPlanUpgrade;
window.submitPaymentVerification = submitPaymentVerification;
window.loadCurrentSubscription = loadCurrentSubscription;
window.showLivePaymentSuccess = showLivePaymentSuccess;

// Auto-load subscription on page load
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(loadCurrentSubscription, 800);
});


