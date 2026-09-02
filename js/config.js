/**
 * DM STUDIO - RUNTIME CONFIGURATION
 * Configure your Cloudflare Worker URL here once deployed.
 */

const APP_CONFIG = {
  // Backend API URL (Local Node Server or Cloudflare Worker)
  WORKER_API_URL: window.location.origin.includes('localhost') || window.location.protocol === 'file:'
    ? 'http://localhost:3000' 
    : window.location.origin,

  STUDIO_NAME: 'DM Films & Photography',
  STUDIO_TAGLINE: 'Luxury Wedding & Cinematic Memories',
  STUDIO_PHONE: '+91 98765 43210',
  STUDIO_EMAIL: 'contact@dmfilms.com',
  GOOGLE_DRIVE_ROOT_FOLDER_ID: '1Glh2NLXhJMIKO89jz2OsGBzI3fW8HZJf',
  GOOGLE_DRIVE_ROOT_FOLDER_URL: 'https://drive.google.com/drive/folders/1Glh2NLXhJMIKO89jz2OsGBzI3fW8HZJf',

  // Configurable Storage & Upload Limits
  LIMITS: {
    MAX_FILE_SIZE_MB: 100, // Maximum single photo upload size (MB)
    MAX_PHOTOS_PER_CLIENT: 1000,
    ALLOWED_FILE_TYPES: ['image/jpeg', 'image/png', 'image/webp', 'image/heic'],
    CHUNK_SIZE_MB: 5 // Chunk size for large file uploads
  },

  // Fallback / Offline Mock Demo Mode: enabled if worker is not yet connected
  ENABLE_DEMO_FALLBACK: true
};

// Expose globally
window.APP_CONFIG = APP_CONFIG;
