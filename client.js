/**
 * DM STUDIO - CLIENT PHOTO SELECTION CONTROLLER
 */

document.addEventListener('DOMContentLoaded', () => {
  initClientPortal();
});

let currentClient = null;
let currentFilter = 'all';
let searchQuery = '';
let currentLightboxIndex = -1;
let selectedPhotoIds = new Set();
let favoritePhotoIds = new Set();
let photoComments = {};
let isSubmitting = false;

// Zoom & Pan Interactive State
let zoomScale = 1.0;
let panX = 0;
let panY = 0;
let isPanning = false;
let startPanX = 0;
let startPanY = 0;

async function initClientPortal() {
  const urlParams = new URLSearchParams(window.location.search);
  const clientCode = urlParams.get('code') || urlParams.get('c') || urlParams.get('id') || 'RAJ2026';

  if (!clientCode) {
    showAccessCodePrompt();
    return;
  }

  showLoader(true);
  try {
    currentClient = await window.api.getClientData(clientCode);
    if (!currentClient) {
      showErrorState('Invalid Client Link or Code. Please check with the studio.');
      return;
    }

    // Check PIN Authentication State
    const isPinAuth = sessionStorage.getItem('client_pin_auth_' + currentClient.code);
    if (!isPinAuth) {
      showPinGateModal();
      return;
    }

    loadAndRenderClientGallery();
  } catch (err) {
    showErrorState('Could not load gallery. Please try again.');
  } finally {
    showLoader(false);
  }
}

function showPinGateModal() {
  showLoader(false);
  const modal = document.getElementById('pin-gate-modal');
  const subtitle = document.getElementById('pin-gate-subtitle');
  if (subtitle && currentClient) {
    const studioName = (currentClient.studio ? currentClient.studio.studioName : null) || currentClient.studioName || 'DM Films & Photography';
    subtitle.textContent = `Please enter the unique secure PIN provided by ${studioName}.`;
  }
  if (modal) {
    modal.style.display = 'flex';
    modal.classList.add('active');
  }
  const input = document.getElementById('client-pin-input');
  if (input) {
    input.value = '';
    setTimeout(() => input.focus(), 100);
  }
}

function verifyClientPin(e) {
  if (e) e.preventDefault();
  const input = document.getElementById('client-pin-input');
  const errorMsg = document.getElementById('pin-error-msg');
  const enteredPin = (input ? input.value : '').trim();

  if (!enteredPin || !currentClient) return;

  const validPin = (currentClient.code || '').toLowerCase();
  if (enteredPin.toLowerCase() === validPin) {
    sessionStorage.setItem('client_pin_auth_' + currentClient.code, 'true');
    const modal = document.getElementById('pin-gate-modal');
    if (modal) {
      modal.style.display = 'none';
      modal.classList.remove('active');
    }
    if (errorMsg) errorMsg.style.display = 'none';
    
    window.api.showToast('✔ PIN Verified! Gallery Unlocked.', 'success');
    loadAndRenderClientGallery();
  } else {
    if (errorMsg) {
      errorMsg.textContent = '❌ Incorrect PIN. Please enter the unique secure PIN sent on WhatsApp.';
      errorMsg.style.display = 'block';
    }
  }
}

function loadAndRenderClientGallery() {
  // Clean & filter only real photos (exclude folders / zero bytes)
  currentClient.photos = (currentClient.photos || []).filter(p => p.size > 0 && /\.(jpe?g|png|webp|gif|bmp|heic|raw|cr2|nef|arw)$/i.test(p.name));
  
  // Natural alphanumeric sort for photos (e.g. DSC_001, DSC_002, 1, 2, 10, A, B...)
  currentClient.photos.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' }));
  
  currentClient.photosCount = currentClient.photos.length;

  if (currentClient.selectedPhotoIds && Array.isArray(currentClient.selectedPhotoIds)) {
    selectedPhotoIds = new Set(currentClient.selectedPhotoIds);
  }
  if (currentClient.favoritePhotoIds && Array.isArray(currentClient.favoritePhotoIds)) {
    favoritePhotoIds = new Set(currentClient.favoritePhotoIds);
  }
  if (currentClient.photoComments && typeof currentClient.photoComments === 'object') {
    photoComments = { ...currentClient.photoComments };
  }

  renderClientHeader();

  const stickyControls = document.querySelector('.sticky-controls-wrapper');
  const lockedBanner = document.getElementById('locked-selection-banner');

  // If selection is already submitted and locked by client, show Thank You & Details screen immediately
  if (currentClient.selectionLocked) {
    showThankYouLockedScreen(currentClient.selectionSubmittedAt);
    return;
  }

  // If unlocked, ensure sticky controls and full gallery are interactive
  if (stickyControls) stickyControls.style.display = '';
  if (lockedBanner) lockedBanner.style.display = 'none';

  renderFolderTabs();
  updateStatusPillsCounts();
  renderGallery();
  updateSelectionCounter();
  setupClientEventListeners();
  initLightboxZoomEvents();
}

// --- Header & Information ---
function renderClientHeader() {
  const titleEl = document.getElementById('client-event-title');
  const namesEl = document.getElementById('client-names');
  const dateEl = document.getElementById('client-event-date');
  const limitEl = document.getElementById('selection-max-limit');
  const studioBrandEl = document.getElementById('client-studio-brand');

  if (titleEl) titleEl.textContent = (currentClient.eventName || 'Wedding').toUpperCase();
  if (namesEl) namesEl.textContent = currentClient.name || 'Valued Client';
  if (dateEl) dateEl.textContent = currentClient.eventDate ? `EVENT DATE: ${currentClient.eventDate}` : 'WEDDING COLLECTION';
  if (limitEl) limitEl.textContent = currentClient.selectionLimit || 350;

  // Apply Dynamic Studio Branding
  if (currentClient.studio) {
    if (studioBrandEl) studioBrandEl.textContent = currentClient.studio.studioName || 'STUDIO GALLERY';
    document.title = `${currentClient.name} - Photo Selection | ${currentClient.studio.studioName || 'Studio'}`;
  }

  if (currentClient.selectionSubmittedAt) {
    showLockedNotice(currentClient.selectionSubmittedAt);
  }
}

function showLockedNotice(dateStr) {
  const banner = document.getElementById('locked-selection-banner');
  if (banner) {
    banner.style.display = 'flex';
    banner.innerHTML = `
      <div style="font-size:1.2rem;">✔</div>
      <div>
        <strong>Selection Submitted!</strong>
        <div style="font-size:0.8rem;opacity:0.9;">Your selection of ${selectedPhotoIds.size} photos was saved on ${new Date(dateStr).toLocaleDateString()}. You can still review your picks.</div>
      </div>
    `;
  }
}

let activeFolderFilter = 'all';
let activeStatusFilter = 'all';

// --- Dedicated Folder Tabs Row on Top (Alphabetical & Numeric Sorting: 1.2.3 A.B.C...) ---
function renderFolderTabs() {
  const container = document.getElementById('folder-tabs-row');
  if (!container) return;

  const photos = currentClient?.photos || [];
  const folderCounts = {};
  photos.forEach(p => {
    const f = (p.subfolder && p.subfolder.trim()) || 'Main Photos';
    folderCounts[f] = (folderCounts[f] || 0) + 1;
  });

  // Natural numeric & alphabetical sort (e.g. 1, 2, 10, A, B, C, DEMO, New folder)
  const folderNames = Object.keys(folderCounts).sort((a, b) => 
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  );

  container.innerHTML = `
    <button class="folder-tab-btn ${activeFolderFilter === 'all' ? 'active' : ''}" onclick="setFolderFilter('all')">
      <span>📂 All Folders</span>
      <span class="folder-tab-badge">${photos.length}</span>
    </button>
    ${folderNames.map(name => `
      <button class="folder-tab-btn ${activeFolderFilter === name ? 'active' : ''}" onclick="setFolderFilter('${escapeHtml(name)}')">
        <span>📁 ${escapeHtml(name)}</span>
        <span class="folder-tab-badge">${folderCounts[name]}</span>
      </button>
    `).join('')}
  `;
}

function setFolderFilter(folder) {
  activeFolderFilter = folder;
  renderFolderTabs();
  updateStatusPillsCounts();
  renderGallery();
}

function setStatusFilter(status) {
  activeStatusFilter = status;
  const pills = document.querySelectorAll('#category-pills .filter-pill');
  pills.forEach(p => {
    if (p.getAttribute('onclick')?.includes(`'${status}'`)) {
      p.classList.add('active');
    } else {
      p.classList.remove('active');
    }
  });
  renderGallery();
}

function updateStatusPillsCounts() {
  const photos = currentClient?.photos || [];
  const inCurrentFolder = activeFolderFilter === 'all' 
    ? photos 
    : photos.filter(p => (p.subfolder || 'Main Photos') === activeFolderFilter);

  const selectedInFolder = inCurrentFolder.filter(p => selectedPhotoIds.has(p.id)).length;
  const unselectedInFolder = inCurrentFolder.length - selectedInFolder;
  const favoritedInFolder = inCurrentFolder.filter(p => favoritePhotoIds.has(p.id)).length;

  const countAll = document.getElementById('pill-count-all');
  const countFav = document.getElementById('pill-count-favorites');
  const countSel = document.getElementById('pill-count-selected');
  const countUnsel = document.getElementById('pill-count-unselected');

  if (countAll) countAll.textContent = inCurrentFolder.length;
  if (countFav) countFav.textContent = favoritedInFolder;
  if (countSel) countSel.textContent = selectedInFolder;
  if (countUnsel) countUnsel.textContent = unselectedInFolder;
}

// --- Gallery Grid Rendering ---
function renderGallery() {
  const container = document.getElementById('client-gallery-grid');
  if (!container) return;

  const photos = currentClient.photos || [];
  let filtered = photos.filter(photo => {
    const isSelected = selectedPhotoIds.has(photo.id);
    const isFavorite = favoritePhotoIds.has(photo.id);
    const photoFolder = photo.subfolder || 'Main Photos';

    if (activeFolderFilter !== 'all' && photoFolder !== activeFolderFilter) return false;
    if (activeStatusFilter === 'favorites' && !isFavorite) return false;
    if (activeStatusFilter === 'selected' && !isSelected) return false;
    if (activeStatusFilter === 'unselected' && isSelected) return false;
    if (searchQuery && !photo.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:4rem;color:var(--text-muted);">
        ${photos.length === 0 ? 'No photos uploaded to this album yet. Studio is processing your pictures.' : 'No photos found matching your current filter.'}
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map((photo, index) => {
    const isSelected = selectedPhotoIds.has(photo.id);
    const isFavorite = favoritePhotoIds.has(photo.id);
    const originalIndex = photos.findIndex(p => p.id === photo.id);

    return `
      <div class="gallery-item ${isSelected ? 'selected' : ''}" id="photo-${photo.id}" data-id="${photo.id}">
        <div class="gallery-img-wrap" onclick="openLightbox(${originalIndex})">
          <img src="${photo.thumbnailUrl || photo.url}" class="gallery-img" alt="${escapeHtml(photo.name)}" loading="lazy">
          <span class="photo-number-badge">#${String(originalIndex + 1).padStart(3, '0')}</span>
        </div>
        <button class="photo-select-btn" onclick="toggleSelectPhoto('${photo.id}', event)" title="${isSelected ? 'Unselect Photo' : 'Select Photo'}">
          ${isSelected ? '✔' : '+'}
        </button>
        <button class="photo-heart-btn ${isFavorite ? 'favorited' : ''}" onclick="toggleFavoritePhoto('${photo.id}', event)" title="${isFavorite ? 'Remove Favorite' : 'Mark as Special Favorite'}">
          ${isFavorite ? '❤️' : '🤍'}
        </button>
        <div class="photo-meta-bar">
          <span class="photo-name" title="${escapeHtml(photo.name)}">${escapeHtml(photo.name)}</span>
          <button class="photo-expand-btn" onclick="openLightbox(${originalIndex})">🔍 View</button>
        </div>
      </div>
    `;
  }).join('');
}

// --- Selection & Favorites State Handlers ---
function toggleSelectPhoto(photoId, event) {
  if (event) event.stopPropagation();

  if (selectedPhotoIds.has(photoId)) {
    selectedPhotoIds.delete(photoId);
  } else {
    const limit = Number(currentClient.selectionLimit) || 500;
    if (selectedPhotoIds.size >= limit) {
      window.api.showToast(`Selection limit of ${limit} photos reached!`, 'error');
      return;
    }
    selectedPhotoIds.add(photoId);
  }

  updatePhotoCardUI(photoId);
  updateSelectionCounter();
  updateLightboxSelectButton();
}

function toggleFavoritePhoto(photoId, event) {
  if (event) event.stopPropagation();

  if (favoritePhotoIds.has(photoId)) {
    favoritePhotoIds.delete(photoId);
  } else {
    favoritePhotoIds.add(photoId);
  }

  updatePhotoCardUI(photoId);
  updateStatusPillsCounts();
  updateLightboxHeartButton();
}

function updatePhotoCardUI(photoId) {
  const el = document.getElementById(`photo-${photoId}`);
  if (el) {
    const isSelected = selectedPhotoIds.has(photoId);
    const isFavorite = favoritePhotoIds.has(photoId);
    el.classList.toggle('selected', isSelected);

    const selectBtn = el.querySelector('.photo-select-btn');
    if (selectBtn) selectBtn.innerHTML = isSelected ? '✔' : '+';

    const heartBtn = el.querySelector('.photo-heart-btn');
    if (heartBtn) {
      heartBtn.classList.toggle('favorited', isFavorite);
      heartBtn.innerHTML = isFavorite ? '❤️' : '🤍';
    }
  }
}

function updateSelectionCounter() {
  const countEl = document.getElementById('selected-count-display');
  const fillEl = document.getElementById('selection-progress-fill');
  const submitBtn = document.getElementById('submit-selection-btn');

  const count = selectedPhotoIds.size;
  const limit = Number(currentClient.selectionLimit) || 500;
  const percent = Math.min(100, Math.round((count / limit) * 100));

  if (countEl) countEl.textContent = count;
  if (fillEl) fillEl.style.width = `${percent}%`;
  if (submitBtn) {
    submitBtn.disabled = count === 0;
    submitBtn.innerHTML = `Submit Selection (${count})`;
  }
}

// --- Lightbox Fullscreen Viewer & Zoom/Pan Engine ---
function resetLightboxTransform() {
  zoomScale = 1.0;
  panX = 0;
  panY = 0;
  isPanning = false;
  applyLightboxTransform();
}

function applyLightboxTransform() {
  const container = document.getElementById('lightbox-image-stage');
  const badge = document.getElementById('lightbox-zoom-badge');
  if (container) {
    container.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomScale})`;
    container.style.cursor = zoomScale > 1.0 ? (isPanning ? 'grabbing' : 'grab') : 'default';
  }
  if (badge) {
    const percent = Math.round(zoomScale * 100);
    badge.textContent = `🔍 ${percent}% ${zoomScale > 1.0 ? '(Drag to Pan)' : '(Scroll wheel to Zoom &bull; Drag to Pan)'}`;
  }
}

function initLightboxZoomEvents() {
  const stage = document.querySelector('.lightbox-stage');
  const container = document.getElementById('lightbox-image-stage');
  if (!stage || !container) return;

  // 1. Mouse Scroll Wheel Zoom In / Out
  stage.addEventListener('wheel', (e) => {
    const modal = document.getElementById('lightbox-modal');
    if (!modal || !modal.classList.contains('active')) return;
    e.preventDefault();

    const delta = e.deltaY < 0 ? 0.25 : -0.25;
    const newScale = Math.min(4.0, Math.max(1.0, zoomScale + delta));

    if (newScale === 1.0) {
      panX = 0;
      panY = 0;
    }
    zoomScale = newScale;
    applyLightboxTransform();
  }, { passive: false });

  // 2. Double Click / Double Tap Quick Zoom (1.0x ↔ 2.5x)
  let lastTapTime = 0;
  container.addEventListener('dblclick', (e) => {
    e.preventDefault();
    toggleDoubleZoom();
  });

  function toggleDoubleZoom() {
    if (zoomScale > 1.2) {
      zoomScale = 1.0;
      panX = 0;
      panY = 0;
    } else {
      zoomScale = 2.5;
    }
    applyLightboxTransform();
  }

  // 3. Mouse Click & Drag Pan
  stage.addEventListener('mousedown', (e) => {
    if (zoomScale <= 1.0) return;
    isPanning = true;
    startPanX = e.clientX - panX;
    startPanY = e.clientY - panY;
    applyLightboxTransform();
  });

  window.addEventListener('mousemove', (e) => {
    if (!isPanning || zoomScale <= 1.0) return;
    panX = e.clientX - startPanX;
    panY = e.clientY - startPanY;
    applyLightboxTransform();
  });

  window.addEventListener('mouseup', () => {
    if (isPanning) {
      isPanning = false;
      applyLightboxTransform();
    }
  });

  // 4. Touch & Mobile Finger Swipe / Pinch-to-Zoom Engine
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;
  let isSwiping = false;
  let isTouchPanning = false;
  let touchStartPanX = 0;
  let touchStartPanY = 0;
  let initialPinchDistance = 0;
  let initialPinchScale = 1.0;

  stage.addEventListener('touchstart', (e) => {
    const modal = document.getElementById('lightbox-modal');
    if (!modal || !modal.classList.contains('active')) return;

    if (e.touches.length === 1) {
      const now = Date.now();
      if (now - lastTapTime < 300) {
        e.preventDefault();
        toggleDoubleZoom();
        lastTapTime = 0;
        return;
      }
      lastTapTime = now;

      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchStartTime = Date.now();

      if (zoomScale > 1.0) {
        isTouchPanning = true;
        touchStartPanX = touchStartX - panX;
        touchStartPanY = touchStartY - panY;
      } else {
        isSwiping = true;
      }
    } else if (e.touches.length === 2) {
      isSwiping = false;
      isTouchPanning = false;
      initialPinchDistance = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      initialPinchScale = zoomScale;
    }
  }, { passive: false });

  stage.addEventListener('touchmove', (e) => {
    const modal = document.getElementById('lightbox-modal');
    if (!modal || !modal.classList.contains('active')) return;

    if (e.touches.length === 1) {
      const currentX = e.touches[0].clientX;
      const currentY = e.touches[0].clientY;
      const diffX = currentX - touchStartX;
      const diffY = currentY - touchStartY;

      if (zoomScale > 1.0 && isTouchPanning) {
        e.preventDefault();
        panX = currentX - touchStartPanX;
        panY = currentY - touchStartPanY;
        applyLightboxTransform();
      } else if (isSwiping && zoomScale === 1.0) {
        if (Math.abs(diffX) > Math.abs(diffY)) {
          e.preventDefault();
          container.style.transform = `translate(${diffX * 0.35}px, 0px) scale(1)`;
        }
      }
    } else if (e.touches.length === 2 && initialPinchDistance > 0) {
      e.preventDefault();
      const currentDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const scaleFactor = currentDist / initialPinchDistance;
      zoomScale = Math.min(4.0, Math.max(1.0, initialPinchScale * scaleFactor));
      if (zoomScale === 1.0) {
        panX = 0;
        panY = 0;
      }
      applyLightboxTransform();
    }
  }, { passive: false });

  stage.addEventListener('touchend', (e) => {
    const modal = document.getElementById('lightbox-modal');
    if (!modal || !modal.classList.contains('active')) return;

    if (isSwiping && zoomScale === 1.0 && e.changedTouches && e.changedTouches.length > 0) {
      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;
      const totalDiffX = touchEndX - touchStartX;
      const totalDiffY = touchEndY - touchStartY;
      const swipeDuration = Date.now() - touchStartTime;

      container.style.transition = 'transform 0.2s ease-out';
      container.style.transform = 'translate(0px, 0px) scale(1)';
      setTimeout(() => {
        container.style.transition = '';
      }, 200);

      // Trigger swipe if finger moved >= 40px horizontally
      if (Math.abs(totalDiffX) > 40 && Math.abs(totalDiffX) > Math.abs(totalDiffY) * 1.1 && swipeDuration < 750) {
        if (totalDiffX < 0) {
          // Swipe Left -> Next Photo
          nextLightboxPhoto();
        } else {
          // Swipe Right -> Previous Photo
          prevLightboxPhoto();
        }
      }
    }

    isSwiping = false;
    isTouchPanning = false;
    initialPinchDistance = 0;
  });

  // 5. Keyboard Navigation (Arrow keys & Escape)
  window.addEventListener('keydown', (e) => {
    const modal = document.getElementById('lightbox-modal');
    if (!modal || !modal.classList.contains('active')) return;

    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;

    if (e.key === 'ArrowRight' || e.key === 'KeyD') {
      e.preventDefault();
      nextLightboxPhoto();
    } else if (e.key === 'ArrowLeft' || e.key === 'KeyA') {
      e.preventDefault();
      prevLightboxPhoto();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeLightbox();
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      toggleCurrentLightboxPhoto();
    }
  });
}

function openLightbox(index) {
  const photos = currentClient.photos || [];
  if (index < 0 || index >= photos.length) return;

  currentLightboxIndex = index;
  const photo = photos[index];

  const modal = document.getElementById('lightbox-modal');
  const img = document.getElementById('lightbox-image');
  const title = document.getElementById('lightbox-photo-title');
  const num = document.getElementById('lightbox-photo-number');
  const commentInput = document.getElementById('lightbox-photo-comment');

  resetLightboxTransform();

  if (img) {
    img.src = '';
    img.src = photo.url || photo.thumbnailUrl;
  }
  if (title) title.textContent = photo.name;
  if (num) num.textContent = `#${String(index + 1).padStart(3, '0')} of ${photos.length}`;
  if (commentInput) {
    commentInput.value = photoComments[photo.id] || '';
  }

  updateLightboxSelectButton();
  updateLightboxHeartButton();
  if (modal) modal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  const modal = document.getElementById('lightbox-modal');
  if (modal) modal.classList.remove('active');
  document.body.style.overflow = '';
  resetLightboxTransform();
}

function nextLightboxPhoto() {
  const photos = currentClient.photos || [];
  if (photos.length === 0) return;
  const nextIdx = (currentLightboxIndex + 1) % photos.length;
  openLightbox(nextIdx);
}

function prevLightboxPhoto() {
  const photos = currentClient.photos || [];
  if (photos.length === 0) return;
  const prevIdx = (currentLightboxIndex - 1 + photos.length) % photos.length;
  openLightbox(prevIdx);
}

function updateLightboxSelectButton() {
  const btn = document.getElementById('lightbox-toggle-select');
  if (!btn || currentLightboxIndex === -1) return;

  const photos = currentClient.photos || [];
  const photo = photos[currentLightboxIndex];
  if (!photo) return;

  const isSelected = selectedPhotoIds.has(photo.id);
  btn.className = isSelected ? 'btn btn-primary' : 'btn btn-outline-gold';
  btn.innerHTML = isSelected ? '✔ Photo Selected' : '+ Select This Photo';
}

function updateLightboxHeartButton() {
  const btn = document.getElementById('lightbox-toggle-heart');
  if (!btn || currentLightboxIndex === -1) return;

  const photos = currentClient.photos || [];
  const photo = photos[currentLightboxIndex];
  if (!photo) return;

  const isFavorite = favoritePhotoIds.has(photo.id);
  btn.style.background = isFavorite ? '#ec4899' : '';
  btn.style.borderColor = isFavorite ? '#f472b6' : '#ec4899';
  btn.style.color = isFavorite ? '#fff' : '#f472b6';
  btn.innerHTML = isFavorite ? '❤️ Special Favorite' : '🤍 Special Favorite';
}

function toggleCurrentLightboxPhoto() {
  const photos = currentClient.photos || [];
  const photo = photos[currentLightboxIndex];
  if (photo) {
    toggleSelectPhoto(photo.id);
  }
}

function toggleCurrentLightboxFavorite() {
  const photos = currentClient.photos || [];
  const photo = photos[currentLightboxIndex];
  if (photo) {
    toggleFavoritePhoto(photo.id);
  }
}

function saveCurrentLightboxComment(text) {
  const photos = currentClient.photos || [];
  const photo = photos[currentLightboxIndex];
  if (photo) {
    if (text && text.trim()) {
      photoComments[photo.id] = text.trim();
    } else {
      delete photoComments[photo.id];
    }
  }
}

// --- Submit Selection Workflow ---
function openSubmitModal() {
  if (selectedPhotoIds.size === 0) {
    window.api.showToast('Please select at least 1 photo first!', 'info');
    return;
  }

  const modal = document.getElementById('submit-confirm-modal');
  const countEl = document.getElementById('confirm-selected-count');
  if (countEl) countEl.textContent = selectedPhotoIds.size;
  if (modal) modal.classList.add('active');
}

// --- Celebration Blast Animation (Canvas Confetti Cannon) ---
function triggerCelebrationConfettiBlast() {
  let canvas = document.getElementById('celebration-confetti-canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'celebration-confetti-canvas';
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '999999';
    document.body.appendChild(canvas);
  }

  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const particles = [];
  const colors = ['#fde047', '#d4af37', '#ec4899', '#f43f5e', '#3b82f6', '#8b5cf6', '#10b981', '#ffffff', '#fb923c'];

  // Left & Right Cannons explosion (250+ particles bursting from both sides)
  for (let i = 0; i < 140; i++) {
    particles.push({
      x: canvas.width * 0.15,
      y: canvas.height * 0.65,
      vx: (Math.random() * 14 + 6),
      vy: -(Math.random() * 18 + 10),
      size: Math.random() * 11 + 6,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * 360,
      rotationSpeed: (Math.random() - 0.5) * 18,
      gravity: 0.38,
      alpha: 1,
      shape: Math.random() > 0.3 ? 'rect' : 'circle'
    });

    particles.push({
      x: canvas.width * 0.85,
      y: canvas.height * 0.65,
      vx: -(Math.random() * 14 + 6),
      vy: -(Math.random() * 18 + 10),
      size: Math.random() * 11 + 6,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * 360,
      rotationSpeed: (Math.random() - 0.5) * 18,
      gravity: 0.38,
      alpha: 1,
      shape: Math.random() > 0.3 ? 'rect' : 'circle'
    });
  }

  // Center gold sparkles
  for (let i = 0; i < 60; i++) {
    particles.push({
      x: canvas.width * 0.5,
      y: canvas.height * 0.5,
      vx: (Math.random() - 0.5) * 16,
      vy: -(Math.random() * 16 + 6),
      size: Math.random() * 8 + 4,
      color: '#fde047',
      rotation: Math.random() * 360,
      rotationSpeed: (Math.random() - 0.5) * 20,
      gravity: 0.3,
      alpha: 1,
      shape: 'circle'
    });
  }

  let animationFrame;
  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;

    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      p.vx *= 0.985;
      p.rotation += p.rotationSpeed;
      p.alpha -= 0.0045;

      if (p.alpha > 0) {
        alive = true;
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;

        if (p.shape === 'circle') {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        }
        ctx.restore();
      }
    });

    if (alive) {
      animationFrame = requestAnimationFrame(animate);
    } else {
      cancelAnimationFrame(animationFrame);
      if (canvas.parentElement) canvas.remove();
    }
  }

  animate();
}

// --- Luxury Thank You Screen (Hides Gallery & Shows Full Submission Details) ---
function showThankYouLockedScreen(submittedAt = null) {
  // Hide sticky controls bar completely
  const stickyControls = document.querySelector('.sticky-controls-wrapper');
  if (stickyControls) stickyControls.style.display = 'none';

  const subTime = submittedAt || currentClient.selectionSubmittedAt || new Date().toISOString();
  const dateObj = new Date(subTime);
  const formattedDate = !isNaN(dateObj.getTime()) 
    ? dateObj.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })
    : 'Recently Submitted';

  const studioName = (currentClient.studio ? currentClient.studio.studioName : null) || currentClient.studioName || 'DM Films & Photography';
  const studioPhone = (currentClient.studio ? currentClient.studio.phone : null) || currentClient.studioPhone || '8249861208';
  const cleanPhone = studioPhone.replace(/[^0-9]/g, '');

  const totalSelected = selectedPhotoIds.size || (currentClient.selectedPhotoIds ? currentClient.selectedPhotoIds.length : 0) || currentClient.selectedCount || 0;
  const totalFavorites = favoritePhotoIds.size || (currentClient.favoritePhotoIds ? currentClient.favoritePhotoIds.length : 0) || currentClient.favoriteCount || 0;
  const totalComments = Object.keys(photoComments || currentClient.photoComments || {}).length;
  const maxLimit = currentClient.selectionLimit || 350;

  const mainView = document.getElementById('client-main-view');
  if (!mainView) return;

  mainView.innerHTML = `
    <div class="thank-you-container" style="max-width:880px;margin:1.5rem auto 4rem auto;padding:0 1.25rem;animation:fadeInUp 0.6s ease-out;">
      
      <!-- Top Celebration Card -->
      <div style="background:radial-gradient(circle at 50% 15%, rgba(30,22,56,0.95) 0%, rgba(10,8,22,0.98) 100%);border:2px solid rgba(212,175,55,0.45);border-radius:26px;padding:3rem 2rem 2.5rem 2rem;text-align:center;box-shadow:0 0 60px rgba(0,0,0,0.9), 0 0 35px rgba(212,175,55,0.25);position:relative;overflow:hidden;">
        
        <!-- Glow Badge -->
        <div style="display:inline-flex;align-items:center;gap:0.5rem;background:linear-gradient(135deg, rgba(34,197,94,0.2), rgba(16,185,129,0.1));border:1.5px solid #22c55e;color:#86efac;padding:6px 18px;border-radius:30px;font-size:0.85rem;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:1.5rem;box-shadow:0 0 20px rgba(34,197,94,0.35);">
          <span>✔ SELECTION SUBMITTED & LOCKED</span>
        </div>

        <!-- Big Celebration Icon -->
        <div style="font-size:4rem;line-height:1;margin-bottom:1rem;">
          🎉 📸 ✨
        </div>

        <!-- Main Headline -->
        <h1 style="font-family:'Cinzel',serif;font-size:2.2rem;font-weight:900;background:linear-gradient(135deg, #ffffff 0%, #fde047 50%, #d4af37 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin:0 0 0.75rem 0;line-height:1.2;letter-spacing:0.02em;">
          THANK YOU! YOUR SELECTED PHOTOS ARE SUBMITTED
        </h1>

        <p style="font-size:1.05rem;color:#cbd5e1;max-width:620px;margin:0 auto 2rem auto;line-height:1.6;">
          Your photo selection has been successfully received by <strong>${escapeHtml(studioName)}</strong>. The selection is now locked for album designing, color grading, and final album production.
        </p>

        <!-- 4-Metric Grid Details -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:1rem;margin-bottom:2rem;">
          
          <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(212,175,55,0.3);border-radius:16px;padding:1.25rem 1rem;text-align:center;">
            <div style="font-size:1.6rem;margin-bottom:0.25rem;">⭐</div>
            <div style="font-size:1.8rem;font-weight:900;color:#fde047;font-family:'Outfit',sans-serif;line-height:1.1;">
              ${totalSelected} <span style="font-size:0.95rem;color:#94a3b8;font-weight:500;">/ ${maxLimit}</span>
            </div>
            <div style="font-size:0.78rem;color:#cbd5e1;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;margin-top:4px;">
              Photos Selected
            </div>
          </div>

          <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(236,72,153,0.3);border-radius:16px;padding:1.25rem 1rem;text-align:center;">
            <div style="font-size:1.6rem;margin-bottom:0.25rem;">❤️</div>
            <div style="font-size:1.8rem;font-weight:900;color:#f472b6;font-family:'Outfit',sans-serif;line-height:1.1;">
              ${totalFavorites}
            </div>
            <div style="font-size:0.78rem;color:#cbd5e1;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;margin-top:4px;">
              Special Favorites
            </div>
          </div>

          <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(59,130,246,0.3);border-radius:16px;padding:1.25rem 1rem;text-align:center;">
            <div style="font-size:1.6rem;margin-bottom:0.25rem;">💬</div>
            <div style="font-size:1.8rem;font-weight:900;color:#60a5fa;font-family:'Outfit',sans-serif;line-height:1.1;">
              ${totalComments}
            </div>
            <div style="font-size:0.78rem;color:#cbd5e1;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;margin-top:4px;">
              Photo Instructions
            </div>
          </div>

          <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(34,197,94,0.3);border-radius:16px;padding:1.25rem 1rem;text-align:center;">
            <div style="font-size:1.6rem;margin-bottom:0.25rem;">📅</div>
            <div style="font-size:0.95rem;font-weight:800;color:#86efac;font-family:'Outfit',sans-serif;line-height:1.3;margin-top:4px;">
              ${formattedDate}
            </div>
            <div style="font-size:0.78rem;color:#cbd5e1;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;margin-top:4px;">
              Submitted On
            </div>
          </div>

        </div>

        <!-- Event & Client Summary Banner -->
        <div style="background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.1);border-radius:14px;padding:1rem 1.5rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem;margin-bottom:2rem;text-align:left;">
          <div>
            <div style="font-size:0.75rem;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">CLIENT / COUPLE</div>
            <div style="font-size:1.15rem;font-weight:800;color:#fff;">${escapeHtml(currentClient.name || 'Valued Client')}</div>
          </div>
          <div>
            <div style="font-size:0.75rem;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">EVENT OCCASION</div>
            <div style="font-size:1.05rem;font-weight:700;color:#fde047;">${escapeHtml(currentClient.eventName || 'Wedding')}</div>
          </div>
          <div>
            <div style="font-size:0.75rem;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">STUDIO PORTAL</div>
            <div style="font-size:1.05rem;font-weight:700;color:#fff;">${escapeHtml(studioName)}</div>
          </div>
        </div>

        ${currentClient.selectionNotes ? `
          <div style="background:rgba(212,175,55,0.08);border:1px solid rgba(212,175,55,0.25);border-radius:12px;padding:1rem;margin-bottom:2rem;text-align:left;">
            <div style="font-size:0.78rem;font-weight:800;color:#fde047;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px;">
              📝 YOUR INSTRUCTIONS TO STUDIO:
            </div>
            <div style="font-size:0.9rem;color:#e2e8f0;line-height:1.5;white-space:pre-line;">
              ${escapeHtml(currentClient.selectionNotes)}
            </div>
          </div>
        ` : ''}

        <!-- Studio Contact / Re-open Instruction Notice -->
        <div style="border-top:1px solid rgba(255,255,255,0.12);padding-top:1.5rem;display:flex;flex-direction:column;align-items:center;gap:1rem;">
          <div style="font-size:0.9rem;color:#94a3b8;display:flex;align-items:center;gap:6px;">
            <span>🔒</span>
            <span>Need to change or add more photos? Please contact <strong>${escapeHtml(studioName)}</strong> to re-open gallery access.</span>
          </div>

          <div style="display:flex;gap:1rem;flex-wrap:wrap;justify-content:center;">
            ${cleanPhone ? `
              <a href="https://api.whatsapp.com/send?phone=91${cleanPhone}&text=${encodeURIComponent('Hello ' + studioName + ', I have submitted my wedding photo selection for ' + (currentClient.name || '') + ' (' + (currentClient.code || '') + ').')}" target="_blank" class="btn" style="background:#25D366;color:#fff;font-weight:700;padding:10px 22px;border-radius:10px;text-decoration:none;display:inline-flex;align-items:center;gap:8px;box-shadow:0 0 20px rgba(37,211,102,0.4);">
                💬 Contact on WhatsApp
              </a>
            ` : ''}
          </div>
        </div>

      </div>

    </div>
  `;
}

async function confirmSubmitSelection() {
  if (isSubmitting) return;
  isSubmitting = true;

  const notes = document.getElementById('selection-client-notes')?.value || '';
  const btn = document.getElementById('btn-confirm-submit');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Saving Selection to Studio Cloud...';
  }

  try {
    const res = await window.api.submitClientSelection(
      currentClient.code,
      Array.from(selectedPhotoIds),
      notes,
      Array.from(favoritePhotoIds),
      photoComments
    );
    if (res.success) {
      window.api.showToast('🎉 Selection submitted successfully to studio!', 'success');
      closeModal('submit-confirm-modal');
      currentClient.selectionSubmittedAt = new Date().toISOString();
      currentClient.selectionNotes = notes;
      currentClient.selectionLocked = true;
      triggerCelebrationConfettiBlast();
      showThankYouLockedScreen(currentClient.selectionSubmittedAt);
    } else {
      window.api.showToast(res.error || 'Failed to submit selection', 'error');
    }
  } catch (e) {
    window.api.showToast('Error saving selection', 'error');
  } finally {
    isSubmitting = false;
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = 'Confirm & Send to Studio';
    }
  }
}

// --- Event Listeners Setup ---
function setupClientEventListeners() {
  // Search
  const searchInput = document.getElementById('gallery-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.trim();
      renderGallery();
    });
  }

  // Keyboard navigation for Lightbox
  document.addEventListener('keydown', (e) => {
    // Do NOT intercept keyboard shortcuts if user is typing in a comment input or text box!
    const activeTag = document.activeElement ? document.activeElement.tagName : '';
    if (activeTag === 'INPUT' || activeTag === 'TEXTAREA' || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      return;
    }

    const modal = document.getElementById('lightbox-modal');
    if (modal && modal.classList.contains('active')) {
      if (e.key === 'ArrowRight') nextLightboxPhoto();
      if (e.key === 'ArrowLeft') prevLightboxPhoto();
      if (e.key === 'Escape') closeLightbox();
      if (e.key === ' ') {
        e.preventDefault();
        toggleCurrentLightboxPhoto();
      }
    }
  });
}

// --- Utilities ---
function showLoader(show) {
  const loader = document.getElementById('client-loading-spinner');
  if (loader) loader.style.display = show ? 'flex' : 'none';
}

function showErrorState(msg) {
  const main = document.getElementById('client-main-view');
  if (main) {
    main.innerHTML = `
      <div style="text-align:center;padding:5rem 1.5rem;">
        <h2 style="color:var(--danger);font-size:2rem;margin-bottom:1rem;">Gallery Unavailable</h2>
        <p style="color:var(--text-secondary);max-width:500px;margin:0 auto 2rem;">${escapeHtml(msg)}</p>
        <a href="index.html" class="btn btn-outline-gold">Return to Home</a>
      </div>
    `;
  }
}

function showAccessCodePrompt() {
  const code = prompt('Please enter your Client Access Code (e.g. RAJ2026):');
  if (code) {
    window.location.href = `client.html?code=${encodeURIComponent(code.trim())}`;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('active');
}

// Expose globals for HTML triggers
window.openLightbox = openLightbox;
window.closeLightbox = closeLightbox;
window.nextLightboxPhoto = nextLightboxPhoto;
window.prevLightboxPhoto = prevLightboxPhoto;
window.toggleSelectPhoto = toggleSelectPhoto;
window.toggleFavoritePhoto = toggleFavoritePhoto;
window.toggleCurrentLightboxPhoto = toggleCurrentLightboxPhoto;
window.toggleCurrentLightboxFavorite = toggleCurrentLightboxFavorite;
window.saveCurrentLightboxComment = saveCurrentLightboxComment;
window.openSubmitModal = openSubmitModal;
window.confirmSubmitSelection = confirmSubmitSelection;
window.closeModal = closeModal;
window.setFolderFilter = setFolderFilter;
window.setStatusFilter = setStatusFilter;
window.verifyClientPin = verifyClientPin;
