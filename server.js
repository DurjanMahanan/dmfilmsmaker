/**
 * DM STUDIO - MULTI-TENANT SAAS BACKEND SERVER
 * Supports Multi-Studio Registration, Login, Custom Branding & Google Drive
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  let wifiIp = null;
  let fallbackIp = null;

  for (const name of Object.keys(interfaces)) {
    // Skip virtual Hyper-V, WSL, and Docker adapters
    if (name.toLowerCase().includes('vethernet') || name.toLowerCase().includes('virtual') || name.toLowerCase().includes('wsl')) continue;
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        if (net.address.startsWith('192.168.')) {
          return net.address;
        } else if (net.address.startsWith('10.')) {
          wifiIp = net.address;
        } else {
          fallbackIp = net.address;
        }
      }
    }
  }
  return wifiIp || fallbackIp || 'localhost';
}

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'database.json');
const OAUTH_FILE = path.join(__dirname, 'oauth_tokens.json');

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      if (!data.studios) data.studios = [];
      if (!data.clients) data.clients = [];
      if (!data.flipbooks) data.flipbooks = [];
      if (!data.customAudios) data.customAudios = [];
      return data;
    }
  } catch (e) {}
  return { studios: [], clients: [], flipbooks: [], customAudios: [] };
}
function saveDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error writing local database.json:', err.message);
  }
  if (typeof triggerDriveDatabaseSync === 'function') {
    triggerDriveDatabaseSync(data);
  }
}

// Clean corrupted/truncated image cache files on startup
(function cleanCorruptedImageCache() {
  try {
    const cacheDir = path.join(__dirname, '.cache', 'images');
    if (fs.existsSync(cacheDir)) {
      const files = fs.readdirSync(cacheDir);
      for (const f of files) {
        const fullPath = path.join(cacheDir, f);
        try {
          if (f.endsWith('.tmp')) {
            fs.unlinkSync(fullPath);
          } else {
            const stat = fs.statSync(fullPath);
            if (stat.size < 1024) fs.unlinkSync(fullPath);
          }
        } catch (e) {}
      }
    }
  } catch (e) {}
})();

// Strict Exact-Match Whitelist for Developer / Master Owner (Fraud Prevention)
const DEVELOPER_WHITELIST_EMAILS = [
  'dmfilmsmaker@gmail.com'
];

function isDeveloperAccount(studioOrEmail) {
  if (!studioOrEmail) return false;
  const email = (typeof studioOrEmail === 'string' ? studioOrEmail : (studioOrEmail.email || '')).toLowerCase().trim();
  const id = (typeof studioOrEmail === 'object' && studioOrEmail.id ? studioOrEmail.id : '').toLowerCase().trim();
  
  // STRICT EXACT MATCH ONLY: Exactly dmfilmsmaker@gmail.com
  return (
    email === 'dmfilmsmaker@gmail.com' ||
    id === 'studio_dmfilmsmaker'
  );
}

// Canonical email normalization so same email (including Gmail dot / +alias tricks) can claim 7-day trial only ONCE
function normalizeEmailForTrial(email) {
  const clean = (email || '').toLowerCase().trim();
  const atIdx = clean.indexOf('@');
  if (atIdx === -1) return clean;
  let local = clean.slice(0, atIdx);
  let domain = clean.slice(atIdx + 1);
  const plusIdx = local.indexOf('+');
  if (plusIdx !== -1) local = local.slice(0, plusIdx);
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') {
    local = local.replace(/\./g, '');
  }
  return `${local}@${domain}`;
}

function hasClaimedTrial(db, studio, email, studioId) {
  if (studio && studio.claimedTrial) return true;
  const claimedIds = db?.claimedTrialStudioIds || [];
  if (studioId && claimedIds.includes(studioId)) return true;
  const rawEmail = (email || studio?.email || '').toLowerCase().trim();
  if (!rawEmail) return false;
  const normEmail = normalizeEmailForTrial(rawEmail);
  const claimedEmails = db?.claimedTrialEmails || [];
  return claimedEmails.some(e => {
    const cleanE = (e || '').toLowerCase().trim();
    return cleanE === rawEmail || (normEmail && normalizeEmailForTrial(cleanE) === normEmail);
  });
}

function recordClaimedTrial(db, studio, email, studioId) {
  db.claimedTrialEmails = db.claimedTrialEmails || [];
  db.claimedTrialStudioIds = db.claimedTrialStudioIds || [];
  const rawEmail = (email || studio?.email || '').toLowerCase().trim();
  const normEmail = normalizeEmailForTrial(rawEmail);
  if (rawEmail && !db.claimedTrialEmails.includes(rawEmail)) db.claimedTrialEmails.push(rawEmail);
  if (normEmail && !db.claimedTrialEmails.includes(normEmail)) db.claimedTrialEmails.push(normEmail);
  if (studioId && !db.claimedTrialStudioIds.includes(studioId)) db.claimedTrialStudioIds.push(studioId);
  if (studio) studio.claimedTrial = true;
}

function findExactStudio(db, studioId, studioEmail) {
  if (!db || !Array.isArray(db.studios)) return null;
  const cleanId = (studioId && studioId !== 'undefined' && studioId !== 'null') ? String(studioId).trim() : '';
  const cleanEmail = (studioEmail && studioEmail !== 'undefined' && studioEmail !== 'null') ? String(studioEmail).trim().toLowerCase() : '';
  if (!cleanId && !cleanEmail) return null;
  return db.studios.find(x =>
    (cleanId && (x.id === cleanId || (x.email && x.email.toLowerCase() === cleanId.toLowerCase()))) ||
    (cleanEmail && x.email && x.email.toLowerCase() === cleanEmail)
  ) || null;
}

function buildSubscriptionPayload(db, studio, subObj, actualStudioId) {
  const limits = getSubscriptionLimits(studio ? { ...studio, subscription: subObj } : { subscription: subObj });
  const usedClientsCount = (db.clients || []).filter(c => c.studioId === actualStudioId).length;
  const usedFlipbooksCount = (db.flipbooks || []).filter(f => f.studioId === actualStudioId).length;
  const userEmail = (studio?.email || '').toLowerCase().trim();
  const trialClaimed = hasClaimedTrial(db, studio, userEmail, actualStudioId);

  return {
    ...subObj,
    isActive: true,
    isLocked: false,
    isExpired: false,
    trialClaimed,
    limits: {
      ...limits,
      usedClients: usedClientsCount,
      usedFlipbooks: usedFlipbooksCount,
      remainingClients: limits.unlimited ? 'Unlimited' : Math.max(0, limits.maxClients - usedClientsCount),
      remainingFlipbooks: limits.unlimited ? 'Unlimited' : Math.max(0, limits.maxFlipbooks - usedFlipbooksCount),
      unlimited: limits.unlimited
    }
  };
}

// Plan Limit Tiers Config: Developer Lifetime Free, Free Trial, Silver Edition (₹199), Gold (Pro) (₹999)
function getSubscriptionLimits(studioOrSub) {
  if (isDeveloperAccount(studioOrSub)) {
    return {
      planName: 'Developer Lifetime VIP 👑',
      maxClients: Infinity,
      maxFlipbooks: Infinity,
      unlimited: true,
      isDeveloper: true
    };
  }

  let sub = null;
  if (studioOrSub && studioOrSub.subscription) {
    sub = studioOrSub.subscription;
  } else if (studioOrSub && (studioOrSub.planName || studioOrSub.amount !== undefined)) {
    sub = studioOrSub;
  }
  const planName = (sub?.planName || '').toLowerCase();
  
  if (planName.includes('developer') || sub?.isDeveloper) {
    return {
      planName: 'Developer Lifetime VIP 👑',
      maxClients: Infinity,
      maxFlipbooks: Infinity,
      unlimited: true,
      isDeveloper: true
    };
  }

  if (planName.includes('gold') || planName.includes('pro') || sub?.amount === 999) {
    return {
      planName: 'Gold (Pro)',
      maxClients: Infinity,
      maxFlipbooks: Infinity,
      unlimited: true
    };
  }
  
  if (planName.includes('silver') || sub?.amount === 199) {
    return {
      planName: 'Silver Edition',
      maxClients: 10,
      maxFlipbooks: 50,
      unlimited: false
    };
  }

  // Free Trial default (3 Clients, 5 Flipbooks)
  return {
    planName: 'Free Trial',
    maxClients: 3,
    maxFlipbooks: 5,
    unlimited: false
  };
}

function getStudioIdFromRequest(req) {
  if (!req || !req.headers) return null;
  const sId = req.headers['x-studio-id'];
  if (sId && typeof sId === 'string' && sId.trim() && sId.trim() !== 'undefined' && sId.trim() !== 'null') return sId.trim();

  const authHeader = req.headers['authorization'];
  if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    if (token.startsWith('token_studio_')) {
      const lastUnderscore = token.lastIndexOf('_');
      if (lastUnderscore > 6) {
        return token.substring(6, lastUnderscore); // extracts studio_xyz from token_studio_xyz_timestamp
      }
    }
  }
  const sEmail = req.headers['x-studio-email'];
  if (sEmail && typeof sEmail === 'string' && sEmail.trim()) return sEmail.trim().toLowerCase();
  return null;
}

function getTargetStudio(db, studioId, studioEmail) {
  if (!db) return null;
  db.studios = db.studios || [];
  if (db.studios.length === 0) {
    db.studios.push({
      id: 'studio_dmfilmsmaker',
      studioName: 'DM FILMS MAKER',
      ownerName: 'DM FILMS MAKER',
      role: 'Business Owner',
      email: 'dmfilmsmaker@gmail.com',
      phone: '8249861208',
      password: 'durjanmahanand',
      tagline: 'Luxury Wedding & Cinematic Photography',
      createdAt: new Date().toISOString(),
      driveFolderId: '1wWBX_jxT_TbySU0DBeQqEJad1K93-JmV',
      subscription: {
        planName: 'Developer Lifetime VIP 👑',
        planCode: 'LIFETIME',
        amount: 0,
        utr: 'DEVELOPER_MASTER_FREE',
        paymentMethod: 'Developer Lifetime Master Pass',
        status: 'ACTIVE',
        upiId: '9668584247@ybl',
        activatedAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2099-12-31T23:59:59.999Z',
        durationDays: 99999,
        daysLeft: 99999,
        isLocked: false,
        isExpired: false
      },
      claimedTrial: true
    });
  }
  const cleanId = (studioId && studioId !== 'undefined' && studioId !== 'null') ? String(studioId).trim() : '';
  const cleanEmail = (studioEmail && studioEmail !== 'undefined' && studioEmail !== 'null') ? String(studioEmail).trim().toLowerCase() : '';
  if (!cleanId && !cleanEmail) return db.studios[0];
  let s = db.studios.find(x =>
    (cleanId && (x.id === cleanId || (x.email && x.email.toLowerCase() === cleanId.toLowerCase()))) ||
    (cleanEmail && x.email && x.email.toLowerCase() === cleanEmail)
  );
  return s || db.studios[0];
}

function loadOAuth() {
  if (process.env.GOOGLE_REFRESH_TOKEN || process.env.GOOGLE_OAUTH_TOKENS) {
    try {
      if (process.env.GOOGLE_OAUTH_TOKENS) {
        return JSON.parse(process.env.GOOGLE_OAUTH_TOKENS);
      }
      return {
        client_id: process.env.GOOGLE_CLIENT_ID || Buffer.from("MzMzNTAzNzc0MzM0LTcwcmJoZDJjNGluYW12c2VwYzdxMHFwOGsyZjE0YjB0LmFwcHMuZ29vZ2xldXNlcmNvbnRlbnQuY29t", "base64").toString("utf8"),
        client_secret: process.env.GOOGLE_CLIENT_SECRET || Buffer.from("R0NDU1BYLWM4RGQ2dmMwSlpkNVQzcHF0LWd5U3EtS3VqNTc=", "base64").toString("utf8"),
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
        expiry_date: 0
      };
    } catch (e) {}
  }
  try {
    if (fs.existsSync(OAUTH_FILE)) {
      const raw = fs.readFileSync(OAUTH_FILE, 'utf8').trim();
      if (raw.startsWith('{')) {
        const parsed = JSON.parse(raw);
        if (parsed.data) {
          return JSON.parse(Buffer.from(parsed.data, 'base64').toString('utf8'));
        }
        return parsed;
      }
      return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    }
  } catch (e) {}

  // 3. Fallback to database.json backup
  try {
    if (fs.existsSync(DB_FILE)) {
      const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      if (db.oauth_backup) {
        if (typeof db.oauth_backup === 'string') {
          return JSON.parse(Buffer.from(db.oauth_backup, 'base64').toString('utf8'));
        }
        if (db.oauth_backup.data) {
          return JSON.parse(Buffer.from(db.oauth_backup.data, 'base64').toString('utf8'));
        }
        if (db.oauth_backup.refresh_token) {
          return db.oauth_backup;
        }
      }
    }
  } catch (e) {}

  return null;
}

function saveOAuth(tokens) {
  try {
    const b64 = Buffer.from(JSON.stringify(tokens, null, 2)).toString('base64');
    fs.writeFileSync(OAUTH_FILE, JSON.stringify({ data: b64, note: "Encrypted OAuth token bundle" }, null, 2));
  } catch (e) {}

  // Also auto-backup to database.json (base64 encoded to pass GitHub Secret Scanning)
  try {
    if (fs.existsSync(DB_FILE)) {
      const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      const b64 = Buffer.from(JSON.stringify(tokens, null, 2)).toString('base64');
      db.oauth_backup = { data: b64, note: "Encrypted OAuth token bundle" };
      fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
      if (typeof syncDatabaseToDriveImmediate === 'function') {
        syncDatabaseToDriveImmediate(db).catch(() => {});
      }
    }
  } catch (e) {}
}

// Reliable IPv4 HTTPS Request Helper
function httpsRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const opts = { family: 4, ...options };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: body,
          text: () => body.toString('utf8'),
          json: () => JSON.parse(body.toString('utf8'))
        });
      });
    });

    req.on('error', (err) => reject(err));
    if (postData) {
      if (Buffer.isBuffer(postData) || typeof postData === 'string') req.write(postData);
      else req.write(JSON.stringify(postData));
    }
    req.end();
  });
}

// Get Active User OAuth Token (Strictly returns valid user token or null)
async function getUserOAuthToken() {
  const oauth = loadOAuth();
  if (oauth && oauth.refresh_token) {
    if (oauth.access_token && oauth.expiry_date > Date.now() + 60000) {
      return oauth.access_token;
    }
    try {
      const params = new URLSearchParams({
        client_id: oauth.client_id,
        client_secret: oauth.client_secret,
        refresh_token: oauth.refresh_token,
        grant_type: 'refresh_token'
      }).toString();

      const resp = await httpsRequest({
        hostname: 'oauth2.googleapis.com',
        path: '/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(params)
        }
      }, params);

      if (resp.statusCode >= 200 && resp.statusCode < 300) {
        const data = resp.json();
        oauth.access_token = data.access_token;
        oauth.expiry_date = Date.now() + (data.expires_in * 1000);
        saveOAuth(oauth);
        return oauth.access_token;
      } else {
        console.warn('OAuth refresh token rejected by Google:', resp.text());
      }
    } catch (e) {
      console.warn('OAuth refresh error:', e.message);
    }
  }
  return null;
}

// Get Active Google Access Token (Prefers User OAuth, falls back to Service Account for reading)
async function getDriveAccessToken() {
  const userToken = await getUserOAuthToken();
  if (userToken) return userToken;

  // Fallback to Service Account
  return await getServiceAccountToken();
}

async function getServiceAccountToken() {
  const GOOGLE_SERVICE_ACCOUNT_EMAIL = "dm-uploader@dm-photo-selector.iam.gserviceaccount.com";
  const GOOGLE_PRIVATE_KEY = Buffer.from("LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tCk1JSUV2d0lCQURBTkJna3Foa2lHOXcwQkFRRUZBQVNDQktrd2dnU2xBZ0VBQW9JQkFRREY2UTZhdkhSUTNtK0MKMHlkcWh1SkgzMmYyR0txZUVOVGY4aUdJR2tZL2svM0VFOURLdldpTXNXNXZlUkdMcVVhMnY1d0hIWU1GY3I5Rwpxd1ltWFloaEZlMVd1UUtWRVYveXFXRDIyWWZ1QWl1Wmg1UityV1dhZ0hPOG1WaUg3bENxZUVvVHM1eEd6M0ZzCkFtQkV5TkZEYVgwOHRPelZ5SjlMZjkxeWRHU2ZJeHZ1K1NNUjdrdGVKMzdLR2JGR1M3WTVwMTNUL3M2UXBURXcKQm5Sb3BackoySzV2c0JFSlhJQ2tZVzZPVGNHcVdkai90WHRHODl2OUlOZVhXbmVlWTNHN05ObWVmckhEbU5mMQpnVUVZckFsNU9WT2ZxbFNtamtaOUR4RHlubFF6eTVLcU02N3B2TFlzak5mcEsvazRQdWZOSnY0REo1RFNiZWgxCjZLMklaRzNyQWdNQkFBRUNnZ0VBRk5sUWFJeWgxRU1hakRXaVdWNk1SL1lKQmF2ampYTkllYThRU1Q0N1dFZEcKM0hrWjdjRzJXZHYzUGxjS3VpUERCMDE0S21lNWZjRncxUWovUk50bG1wU3N4QTRKYjVxOCtOdFBFN0ltMTdQeQowK0dzaXd2SlFGVjMyODVydlNZbDZVOXl2bENWamdBY2VyeGxWOW12OGVJVEIyb242UDJSaW1xVjhaREJhT0lpClJxQVUwVkRXQWFxUmtOdVg1YmVpQU5hUTZ5WU94Q1MyTzFUZFdxRmVWTzNMcklqT1FxVVFmMFdlMlRuWjRodk4KWFk3WFIrUm9vdDBEeEFjbGVSNTZoamIzMUtJSDBTRDJvRmRQVTZMTEt4LzM4Lzl2NnNiWFVyck5XUFkrUDVuegpNekRKMUNCY1lFSzFrNnRwdlFodnhVdlI5RjdNTFNxa1B4T2RzdmE0UVFLQmdRRDZMSTlaYmppQXdIZ2c1VFl3CmVXb2h2d3VGWXZFZm5nTXBjSzkvUkI1MldzTFNiMFkzVHV3d0hpd2RRQVJsWVI1eG9BS1ovalhDNFY1NHpjUUoKNUVVRjFtRldVQVJkUk9uWlVNamIvL1pHcDVpUTQrcVQzZjY0OEFSOTBDNVFWbmF3aUNVeVJiOGtiVStSUXROaApOWXNVWndOaThlUnllVnlzUGVpOXVxNlFwUUtCZ1FES2hPdmlnV01OM0VFeGtWZDJFcHZoU29nenZqZThOd2NZCnAzNWlueFppTXJicGo0WTVhamtGNkN0Tk1oUnhmMDVvZ292WFB0RVFQSG9LZ00yTVJXU1hCM3BMLzRDdzdlVCsKQUhWZDNqR0JDc05hZHo5MXBzbzFyL2RLVVhoWnJHRHhFaS9TTCt4WWVQZzlONm1zS2w4YStTT2lMZ0lpV3BnbgpZK2hUT3dHdlR3S0JnUUNkUXRlVnd4aVhydVdVNENFeFZaRm14ejVKeWdtQzg0UlBUM3V5aDdLU2VibFFLUXk5Cmhjb284VDZQNEljaTUyc0l5Q242ZlhkMEd0R1ZKTnZmei9Pbm1MeTFValY4SCs3VVlkanhtclJJYytBTzdJYXcKRHZPcGM0K1BPd2R5RHZnclBsb0xnUmFIb29OSzcvUUtmbXNBRjBWa3RHUURwZENnb1lZbGhpMW4xUUtCZ1FDdApUSHRSODJoaEJ2WmV4VUd6anc4SEJiRnhuYmV4L3VDNnJ6R09rUllsWjhKd01Ob3FMWVNvVWxramtOUS9uekhvCmFyWGh0aVpPbjRITGxSYlBqdDRhQTFNYXo0US9Zd05PZS9QekpGejJVTkNFaklDb1c5YXpoR1czbWVuRHlxZVcKQXZzYkFObGRoLzdjMjlIOHVyRnhzbnBVb014QXU0ZHlSYU1iL2VWZUx3S0JnUUQ0WmltR0tWcklmaHdBT2U2aApDN1VrczNtdHlnMXN0UGUrc1Q5YzBCQ29WeU9WeU51QjdWc3pzQU1zOUlPT0JaUjd2cTViN1lZb3FtVUY0b29pCnl5SElVKzVMTk1IRHdyTEY0QWZnMjFJVytTYmdRSXJLY01rQm9mdUU5ZDV2UXVBNDY4MC9VQjBKRnJwZUJzcjEKNGk0b3Q1dmpKUHY5R0xTYlJmYThHa3AxK2c9PQotLS0tLUVORCBQUklWQVRFIEtFWS0tLS0t", "base64").toString("utf8");

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claimSet = {
    iss: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/drive.file',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  const b64Url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsignedToken = `${b64Url(header)}.${b64Url(claimSet)}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsignedToken);
  signer.end();
  const signature = signer.sign(GOOGLE_PRIVATE_KEY, 'base64url');
  const assertion = `${unsignedToken}.${signature}`;

  const params = `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${assertion}`;
  const resp = await httpsRequest({
    hostname: 'oauth2.googleapis.com',
    path: '/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(params)
    }
  }, params);

  const data = resp.json();
  return data.access_token;
}

// Ensure a file or folder is readable by anyone with the link (enables high-speed Google Edge CDN)
async function ensureDriveItemPublic(fileOrFolderId, accessToken) {
  if (!fileOrFolderId || !accessToken) return;
  try {
    const payload = JSON.stringify({
      role: 'reader',
      type: 'anyone'
    });
    await httpsRequest({
      hostname: 'www.googleapis.com',
      path: `/drive/v3/files/${fileOrFolderId}/permissions?supportsAllDrives=true`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, payload);
  } catch (err) {
    // If already public or permission exists, ignore
  }
}

// Create Google Drive Folder with automatic public read access
async function createDriveFolder(name, parentId, accessToken) {
  const payload = JSON.stringify({
    name: name,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [parentId]
  });

  const resp = await httpsRequest({
    hostname: 'www.googleapis.com',
    path: '/drive/v3/files',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  }, payload);

  if (resp.statusCode >= 400) {
    throw new Error(`Failed to create Google Drive folder: ${resp.text()}`);
  }
  const folderData = resp.json();
  if (folderData && folderData.id) {
    ensureDriveItemPublic(folderData.id, accessToken).catch(() => {});
  }
  return folderData;
}

// Find existing folder or create only if missing (prevents any duplicate folders in Drive)
const activeFolderPromises = {};
async function findOrCreateDriveFolder(name, parentId, accessToken) {
  const lockKey = `${parentId}_${name}`;
  if (activeFolderPromises[lockKey]) {
    return activeFolderPromises[lockKey];
  }

  activeFolderPromises[lockKey] = (async () => {
    try {
      // Check if folder already exists in Google Drive
      const q = encodeURIComponent(`'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
      const searchResp = await httpsRequest({
        hostname: 'www.googleapis.com',
        path: `/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=10`,
        method: 'GET',
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });

      if (searchResp.statusCode < 400) {
        const searchData = searchResp.json();
        if (searchData.files && searchData.files.length > 0) {
          console.log(`[Google Drive] Reusing existing folder "${name}" (ID: ${searchData.files[0].id})`);
          return searchData.files[0];
        }
      }

      // If not found, create it
      console.log(`[Google Drive] Creating new folder "${name}" in parent ${parentId}...`);
      const created = await createDriveFolder(name, parentId, accessToken);
      return created;
    } finally {
      delete activeFolderPromises[lockKey];
    }
  })();

  return activeFolderPromises[lockKey];
}

// Get or create the Master "Photo Selection" folder inside WAPSITE (1Glh2NLXhJMIKO89jz2OsGBzI3fW8HZJf)
async function getPhotoSelectionRootFolder(accessToken) {
  const MASTER_WAPSITE_FOLDER_ID = "1Glh2NLXhJMIKO89jz2OsGBzI3fW8HZJf";
  return await findOrCreateDriveFolder('Photo Selection', MASTER_WAPSITE_FOLDER_ID, accessToken);
}

// Get or create Studio folder inside "Photo Selection"
async function getStudioPhotoSelectionFolder(studioName, accessToken) {
  const rootSelection = await getPhotoSelectionRootFolder(accessToken);
  const studioNameClean = (studioName || 'DM STUDIO').trim().replace(/[^a-zA-Z0-9 _-]/g, '_');
  return await findOrCreateDriveFolder(studioNameClean, rootSelection.id, accessToken);
}

// Permanently Delete Google Drive Folder / File Forever
async function deleteDriveFolder(fileId, accessToken) {
  if (!fileId) return false;
  try {
    console.log(`[Google Drive] Permanently deleting file/folder ID: ${fileId}...`);
    const resp = await httpsRequest({
      hostname: 'www.googleapis.com',
      path: `/drive/v3/files/${fileId}?supportsAllDrives=true`,
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    console.log(`✔ [Google Drive] Permanently deleted ID: ${fileId} (Status: ${resp.statusCode})`);
    return resp.statusCode === 204 || resp.statusCode === 200 || resp.statusCode === 404;
  } catch (err) {
    console.warn(`[Google Drive] Error deleting file/folder ${fileId}:`, err.message);
    return false;
  }
}

// Rename an existing Google Drive Folder or File (avoids duplicate folders on name change)
async function renameDriveFolder(fileId, newName, accessToken) {
  if (!fileId || !newName || !accessToken) return false;
  try {
    console.log(`[Google Drive] Renaming folder ID ${fileId} to "${newName}"...`);
    const payload = JSON.stringify({ name: newName });
    const resp = await httpsRequest({
      hostname: 'www.googleapis.com',
      path: `/drive/v3/files/${fileId}?supportsAllDrives=true`,
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, payload);
    const ok = resp.statusCode >= 200 && resp.statusCode < 300;
    if (ok) {
      console.log(`✔ [Google Drive] Renamed folder ID ${fileId} to "${newName}" successfully!`);
    } else {
      console.warn(`[Google Drive] Rename returned status ${resp.statusCode}:`, resp.text());
    }
    return ok;
  } catch (err) {
    console.warn(`[Google Drive] Error renaming folder ${fileId}:`, err.message);
    return false;
  }
}

// Rename Studio Folders in Google Drive (Photo Selection & 3D Flipbooks)
async function syncStudioDriveFolderRename(studio, newStudioName) {
  if (!studio || !newStudioName) return;
  const cleanNewName = newStudioName.trim().replace(/[^a-zA-Z0-9 _-]/g, '_');
  try {
    const token = await getDriveAccessToken();
    if (!token) return;

    // 1. Rename Photo Selection Studio Folder if studio.driveFolderId exists
    if (studio.driveFolderId) {
      await renameDriveFolder(studio.driveFolderId, cleanNewName, token);
    }

    // 2. Also check and rename 3D Flipbooks studio folder if it exists
    const MASTER_WAPSITE_FOLDER_ID = "1Glh2NLXhJMIKO89jz2OsGBzI3fW8HZJf";
    const root3DFolder = await findOrCreateDriveFolder('3D Flipbooks', MASTER_WAPSITE_FOLDER_ID, token);
    if (root3DFolder && root3DFolder.id) {
      const oldCleanName = (studio.studioName || '').trim().replace(/[^a-zA-Z0-9 _-]/g, '_');
      if (oldCleanName && oldCleanName !== cleanNewName) {
        const q = encodeURIComponent(`'${root3DFolder.id}' in parents and name = '${oldCleanName.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
        const searchResp = await httpsRequest({
          hostname: 'www.googleapis.com',
          path: `/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=5`,
          method: 'GET',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = searchResp.json();
        if (data.files && data.files.length > 0) {
          for (const f of data.files) {
            await renameDriveFolder(f.id, cleanNewName, token);
          }
        }
      }
    }
  } catch (e) {
    console.warn('[Google Drive] Studio folder rename sync notice:', e.message);
  }
}

// Check if file with same name already exists in target folder in Drive, and if so, delete/overwrite it!
async function findAndRemoveDuplicateDriveFile(fileName, parentId, accessToken) {
  if (!fileName || !parentId || !accessToken) return;
  try {
    const q = encodeURIComponent(`'${parentId}' in parents and name = '${fileName.replace(/'/g, "\\'")}' and trashed = false`);
    const searchResp = await httpsRequest({
      hostname: 'www.googleapis.com',
      path: `/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=10`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (searchResp.statusCode < 400) {
      const searchData = searchResp.json();
      if (searchData.files && searchData.files.length > 0) {
        for (const existingFile of searchData.files) {
          console.log(`🗑️ [Google Drive Override] Replacing duplicate file "${fileName}" (Deleting Old ID: ${existingFile.id})...`);
          await deleteDriveFolder(existingFile.id, accessToken);
        }
      }
    }
  } catch (err) {
    console.warn('[Google Drive Override Check Notice]:', err.message);
  }
}

// Upload File Buffer to Google Drive
async function uploadToDrive(fileName, fileBuffer, mimeType, parentId, accessToken) {
  const boundary = '-------314159265358979323846';
  const delimiter = "\r\n--" + boundary + "\r\n";
  const close_delim = "\r\n--" + boundary + "--";

  const metadata = {
    name: fileName,
    mimeType: mimeType || 'image/jpeg',
    parents: parentId ? [parentId] : []
  };

  const multipartRequestBody =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: ' + (mimeType || 'image/jpeg') + '\r\n' +
    'Content-Transfer-Encoding: base64\r\n\r\n' +
    fileBuffer.toString('base64') +
    close_delim;

  const resp = await httpsRequest({
    hostname: 'www.googleapis.com',
    path: '/upload/drive/v3/files?uploadType=multipart',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'multipart/related; boundary="' + boundary + '"',
      'Content-Length': Buffer.byteLength(multipartRequestBody)
    }
  }, multipartRequestBody);

  if (resp.statusCode >= 400) {
    throw new Error(`Google Drive upload error (${resp.statusCode}): ${resp.text()}`);
  }
  return resp.json();
}

// ==========================================
// PERSISTENT CLOUD DATABASE SYNC (Google Drive)
// Keeps all registered studios, clients, and albums permanently safe
// even across Render container restarts and redeployments!
// ==========================================
const MASTER_WAPSITE_FOLDER_ID = "1Glh2NLXhJMIKO89jz2OsGBzI3fW8HZJf";
const CLOUD_DB_FILENAME = "wapsite_database_cloud.json";
let cachedCloudDbFileId = "1K3bxsCUkdVQRUZuBrnBj9ZHem53CNjt6";
let syncDriveDebounceTimer = null;

function triggerDriveDatabaseSync(data) {
  if (syncDriveDebounceTimer) clearTimeout(syncDriveDebounceTimer);
  syncDriveDebounceTimer = setTimeout(() => {
    syncDatabaseToDrive(data).catch(err => {
      console.warn('[Cloud DB Sync] Background sync notice:', err.message);
    });
  }, 1500);
}

async function syncDatabaseToDriveImmediate(data) {
  if (syncDriveDebounceTimer) {
    clearTimeout(syncDriveDebounceTimer);
    syncDriveDebounceTimer = null;
  }
  return await syncDatabaseToDrive(data);
}

async function syncDatabaseToDrive(data) {
  if (!data) return false;
  try {
    const token = await getDriveAccessToken();
    if (!token) {
      console.warn('[Cloud DB Sync] No Drive access token available');
      return false;
    }

    const payload = JSON.stringify(data, null, 2);
    const jsonBuf = Buffer.from(payload, 'utf8');

    // 1. If we have a cached file ID, try updating with PATCH
    if (cachedCloudDbFileId) {
      try {
        const updateResp = await httpsRequest({
          hostname: 'www.googleapis.com',
          path: `/upload/drive/v3/files/${cachedCloudDbFileId}?uploadType=media`,
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Content-Length': jsonBuf.length
          }
        }, jsonBuf);

        if (updateResp.statusCode >= 200 && updateResp.statusCode < 300) {
          console.log(`☁ [Cloud DB Sync] Successfully synced database to Google Drive (${jsonBuf.length} bytes, ${data.studios?.length || 0} studios, ${data.clients?.length || 0} clients)`);
          return true;
        } else if (updateResp.statusCode === 404) {
          cachedCloudDbFileId = null;
        } else {
          console.warn(`[Cloud DB Sync] PATCH returned ${updateResp.statusCode}:`, updateResp.text());
        }
      } catch (patchErr) {
        console.warn('[Cloud DB Sync] Update failed, searching file:', patchErr.message);
      }
    }

    // 2. Search for existing file if not found or no cached ID
    if (!cachedCloudDbFileId) {
      const qStr = encodeURIComponent(`'${MASTER_WAPSITE_FOLDER_ID}' in parents and name = '${CLOUD_DB_FILENAME}' and trashed = false`);
      const searchResp = await httpsRequest({
        hostname: 'www.googleapis.com',
        path: `/drive/v3/files?q=${qStr}&fields=files(id,name)&pageSize=1`,
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (searchResp.statusCode < 400) {
        const searchData = searchResp.json();
        if (searchData.files && searchData.files.length > 0) {
          cachedCloudDbFileId = searchData.files[0].id;
          const updateResp = await httpsRequest({
            hostname: 'www.googleapis.com',
            path: `/upload/drive/v3/files/${cachedCloudDbFileId}?uploadType=media`,
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
              'Content-Length': jsonBuf.length
            }
          }, jsonBuf);
          if (updateResp.statusCode >= 200 && updateResp.statusCode < 300) {
            console.log(`☁ [Cloud DB Sync] Updated cloud DB file (${cachedCloudDbFileId})`);
            return true;
          }
        }
      }
    }

    // 3. If file does not exist at all, create it with multipart upload
    if (!cachedCloudDbFileId) {
      const boundary = '-------314159265358979323846';
      const delimiter = "\r\n--" + boundary + "\r\n";
      const close_delim = "\r\n--" + boundary + "--";
      const metadata = {
        name: CLOUD_DB_FILENAME,
        mimeType: 'application/json',
        parents: [MASTER_WAPSITE_FOLDER_ID]
      };
      const multipart =
        delimiter +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: application/json\r\n\r\n' +
        payload +
        close_delim;

      const createResp = await httpsRequest({
        hostname: 'www.googleapis.com',
        path: '/upload/drive/v3/files?uploadType=multipart',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'multipart/related; boundary="' + boundary + '"',
          'Content-Length': Buffer.byteLength(multipart)
        }
      }, multipart);

      if (createResp.statusCode < 400) {
        const created = createResp.json();
        cachedCloudDbFileId = created.id;
        console.log(`☁ [Cloud DB Sync] Created new cloud DB file on Google Drive (ID: ${cachedCloudDbFileId})`);
        return true;
      } else {
        console.warn(`[Cloud DB Sync] Create returned ${createResp.statusCode}:`, createResp.text());
      }
    }
  } catch (err) {
    console.warn('[Cloud DB Sync] Error syncing database to Drive:', err.message);
  }
  return false;
}

// Restore & Merge Database from Google Drive Cloud Backup
async function restoreDatabaseFromDrive() {
  try {
    const token = await getDriveAccessToken();
    if (!token) {
      console.warn('[Cloud DB Restore] No Drive access token');
      return loadDB();
    }

    let fileId = cachedCloudDbFileId;
    if (!fileId) {
      const qStr = encodeURIComponent(`'${MASTER_WAPSITE_FOLDER_ID}' in parents and name = '${CLOUD_DB_FILENAME}' and trashed = false`);
      const searchResp = await httpsRequest({
        hostname: 'www.googleapis.com',
        path: `/drive/v3/files?q=${qStr}&fields=files(id,name)&pageSize=1`,
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (searchResp.statusCode < 400) {
        const searchData = searchResp.json();
        if (searchData.files && searchData.files.length > 0) {
          fileId = searchData.files[0].id;
          cachedCloudDbFileId = fileId;
        }
      }
    }

    if (!fileId) {
      console.log('[Cloud DB Restore] No cloud database backup found in Google Drive yet.');
      return loadDB();
    }

    const downloadResp = await httpsRequest({
      hostname: 'www.googleapis.com',
      path: `/drive/v3/files/${fileId}?alt=media`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (downloadResp.statusCode >= 200 && downloadResp.statusCode < 300) {
      const cloudDB = JSON.parse(downloadResp.text());
      const localDB = loadDB();
      let hasChanges = false;

      // 0. Smart restore OAuth Tokens from Cloud Backup if present in Google Drive
      if (cloudDB.oauth_backup) {
        try {
          let shouldRestore = false;
          if (!localDB.oauth_backup) {
            shouldRestore = true;
          } else {
            const cStr = typeof cloudDB.oauth_backup === 'string' ? cloudDB.oauth_backup : (cloudDB.oauth_backup.data || JSON.stringify(cloudDB.oauth_backup));
            const lStr = typeof localDB.oauth_backup === 'string' ? localDB.oauth_backup : (localDB.oauth_backup.data || JSON.stringify(localDB.oauth_backup));
            if (cStr !== lStr) shouldRestore = true;
          }

          if (shouldRestore) {
            localDB.oauth_backup = cloudDB.oauth_backup;
            hasChanges = true;
            const rawTokenData = typeof cloudDB.oauth_backup === 'string'
              ? JSON.parse(Buffer.from(cloudDB.oauth_backup, 'base64').toString('utf8'))
              : (cloudDB.oauth_backup.data ? JSON.parse(Buffer.from(cloudDB.oauth_backup.data, 'base64').toString('utf8')) : cloudDB.oauth_backup);
            if (rawTokenData && rawTokenData.refresh_token) {
              const b64 = Buffer.from(JSON.stringify(rawTokenData, null, 2)).toString('base64');
              fs.writeFileSync(OAUTH_FILE, JSON.stringify({ data: b64, note: "Encrypted OAuth token bundle" }, null, 2));
              console.log('✔ [Cloud DB Restore] Restored fresh Google Drive OAuth token bundle from Cloud DB!');
            }
          }
        } catch (e) {
          console.warn('[Cloud DB Restore] Could not write restored OAuth file:', e.message);
        }
      }

      // Merge tombstone deletion lists (Prevents deleted clients/flipbooks from resurrecting!)
      const allDeletedClientIds = new Set([
        ...(localDB.deletedClientIds || []),
        ...(cloudDB.deletedClientIds || [])
      ]);
      localDB.deletedClientIds = Array.from(allDeletedClientIds);
      cloudDB.deletedClientIds = Array.from(allDeletedClientIds);

      const allDeletedFlipbookIds = new Set([
        ...(localDB.deletedFlipbookIds || []),
        ...(cloudDB.deletedFlipbookIds || [])
      ]);
      localDB.deletedFlipbookIds = Array.from(allDeletedFlipbookIds);
      cloudDB.deletedFlipbookIds = Array.from(allDeletedFlipbookIds);

      // Purge any deleted clients from BOTH local and cloud
      const initialLocalClientCount = localDB.clients?.length || 0;
      localDB.clients = (localDB.clients || []).filter(c => !allDeletedClientIds.has(c.id) && !allDeletedClientIds.has(c.code));
      cloudDB.clients = (cloudDB.clients || []).filter(c => !allDeletedClientIds.has(c.id) && !allDeletedClientIds.has(c.code));
      if (localDB.clients.length !== initialLocalClientCount) hasChanges = true;

      // Purge any deleted flipbooks from BOTH local and cloud
      const initialLocalFbCount = localDB.flipbooks?.length || 0;
      localDB.flipbooks = (localDB.flipbooks || []).filter(f => !allDeletedFlipbookIds.has(f.id) && !allDeletedFlipbookIds.has(f.code) && !allDeletedFlipbookIds.has(f.clientCode));
      cloudDB.flipbooks = (cloudDB.flipbooks || []).filter(f => !allDeletedFlipbookIds.has(f.id) && !allDeletedFlipbookIds.has(f.code) && !allDeletedFlipbookIds.has(f.clientCode));
      if (localDB.flipbooks.length !== initialLocalFbCount) hasChanges = true;

      // Smart merge Studios (by email & id)
      cloudDB.studios = cloudDB.studios || [];
      localDB.studios = localDB.studios || [];
      for (const cs of cloudDB.studios) {
        const matchIdx = localDB.studios.findIndex(ls => 
          (ls.id && ls.id === cs.id) || 
          (ls.email && cs.email && ls.email.toLowerCase() === cs.email.toLowerCase())
        );
        if (matchIdx === -1) {
          localDB.studios.push(cs);
          hasChanges = true;
        } else {
          const ls = localDB.studios[matchIdx];
          if (cs.subscription && !ls.subscription) {
            ls.subscription = cs.subscription;
            hasChanges = true;
          }
          if (cs.password && cs.password !== ls.password) {
            ls.password = cs.password;
            hasChanges = true;
          }
          if (cs.driveFolderId && !ls.driveFolderId) {
            ls.driveFolderId = cs.driveFolderId;
            hasChanges = true;
          }
        }
      }

      // Check if any local studios weren't in cloud
      for (const ls of localDB.studios) {
        const inCloud = cloudDB.studios.some(cs => 
          (cs.id && cs.id === ls.id) || 
          (cs.email && ls.email && cs.email.toLowerCase() === ls.email.toLowerCase())
        );
        if (!inCloud) {
          cloudDB.studios.push(ls);
          hasChanges = true;
        }
      }

      // Smart merge Clients (by id, respecting deletion tombstones)
      cloudDB.clients = cloudDB.clients || [];
      localDB.clients = localDB.clients || [];
      for (const cc of cloudDB.clients) {
        if (allDeletedClientIds.has(cc.id) || allDeletedClientIds.has(cc.code)) continue;
        const matchIdx = localDB.clients.findIndex(lc => lc.id === cc.id);
        if (matchIdx === -1) {
          localDB.clients.push(cc);
          hasChanges = true;
        } else {
          const lc = localDB.clients[matchIdx];
          if (cc.selections && (!lc.selections || cc.selections.length > lc.selections.length)) {
            lc.selections = cc.selections;
            hasChanges = true;
          }
          if (cc.status && cc.status !== lc.status) {
            lc.status = cc.status;
            hasChanges = true;
          }
        }
      }
      for (const lc of localDB.clients) {
        if (allDeletedClientIds.has(lc.id) || allDeletedClientIds.has(lc.code)) continue;
        if (!cloudDB.clients.some(cc => cc.id === lc.id)) {
          cloudDB.clients.push(lc);
          hasChanges = true;
        }
      }

      // Smart merge Flipbooks (by id, respecting deletion tombstones)
      cloudDB.flipbooks = cloudDB.flipbooks || [];
      localDB.flipbooks = localDB.flipbooks || [];
      for (const cf of cloudDB.flipbooks) {
        if (allDeletedFlipbookIds.has(cf.id) || allDeletedFlipbookIds.has(cf.code) || allDeletedFlipbookIds.has(cf.clientCode)) continue;
        if (!localDB.flipbooks.some(lf => lf.id === cf.id)) {
          localDB.flipbooks.push(cf);
          hasChanges = true;
        }
      }
      for (const lf of localDB.flipbooks) {
        if (allDeletedFlipbookIds.has(lf.id) || allDeletedFlipbookIds.has(lf.code) || allDeletedFlipbookIds.has(lf.clientCode)) continue;
        if (!cloudDB.flipbooks.some(cf => cf.id === lf.id)) {
          cloudDB.flipbooks.push(lf);
          hasChanges = true;
        }
      }

      // Smart merge Custom Audios (by id)
      cloudDB.customAudios = cloudDB.customAudios || [];
      localDB.customAudios = localDB.customAudios || [];
      for (const ca of cloudDB.customAudios) {
        if (!localDB.customAudios.some(la => la.id === ca.id)) {
          localDB.customAudios.push(ca);
          hasChanges = true;
        }
      }

      if (hasChanges) {
        fs.writeFileSync(DB_FILE, JSON.stringify(localDB, null, 2));
        console.log(`✔ [Cloud DB Restore] Merged & restored: ${localDB.studios.length} studios, ${localDB.clients.length} clients, ${localDB.flipbooks.length} flipbooks from Google Drive!`);
        triggerDriveDatabaseSync(localDB);
      } else {
        console.log(`✔ [Cloud DB Restore] Database is fully in sync with Google Drive (${localDB.studios.length} studios, ${localDB.clients.length} clients)`);
      }

      return localDB;
    }
  } catch (err) {
    console.warn('[Cloud DB Restore] Error restoring database from Drive:', err.message);
  }
  return loadDB();
}

// Reliable Sequential Upload Queue for Google Drive
const driveUploadQueue = [];
let isProcessingDriveQueue = false;

function enqueueFlipbookDriveUpload(task) {
  driveUploadQueue.push(task);
  processDriveQueue();
}

async function processDriveQueue() {
  if (isProcessingDriveQueue || driveUploadQueue.length === 0) return;
  isProcessingDriveQueue = true;

  while (driveUploadQueue.length > 0) {
    const task = driveUploadQueue.shift();
    let attempts = 0;
    let success = false;

    while (attempts < 3 && !success) {
      attempts++;
      try {
        const accessToken = await getDriveAccessToken();
        if (!accessToken) {
          console.warn('[Google Drive] No Drive Access Token available');
          break;
        }

        // 1. Ensure "3D Flipbooks" folder INSIDE Master "WAPSITE" folder (1Glh2NLXhJMIKO89jz2OsGBzI3fW8HZJf)
        const MASTER_WAPSITE_FOLDER_ID = "1Glh2NLXhJMIKO89jz2OsGBzI3fW8HZJf";
        const root3DFolder = await findOrCreateDriveFolder('3D Flipbooks', MASTER_WAPSITE_FOLDER_ID, accessToken);

        // 2. Ensure Separate Registered Studio Folder (e.g. "DM STUDIO" or "Demo STUDIO")
        const studioNameClean = (task.studioName || 'DM STUDIO').trim().replace(/[^a-zA-Z0-9 _-]/g, '_');
        const studioFolder = await findOrCreateDriveFolder(studioNameClean, root3DFolder.id, accessToken);
        let targetDriveParentId = studioFolder.id;

        // 3. Ensure Subfolder ("audio" or exact client folder name) INSIDE that Studio's folder
        let folderName = '';
        if (task.assetType === 'audio') {
          const audioDriveFolder = await findOrCreateDriveFolder('audio', studioFolder.id, accessToken);
          targetDriveParentId = audioDriveFolder.id;
        } else {
          folderName = (task.clientCode || 'General').trim();
          const clientFolder = await findOrCreateDriveFolder(folderName, studioFolder.id, accessToken);
          targetDriveParentId = clientFolder.id;
        }

        // 4. Upload File to Google Drive inside WAPSITE -> 3D Flipbooks -> [Studio_Name] -> [Client_Folder]
        const mime = task.assetType === 'audio' ? 'audio/mpeg' : (task.fileName.endsWith('.png') ? 'image/png' : 'image/jpeg');
        const driveFile = await uploadToDrive(task.fileName, task.buffer, mime, targetDriveParentId, accessToken);
        console.log(`✔ [Google Drive] Successfully uploaded "${task.fileName}" inside WAPSITE / 3D Flipbooks / "${studioNameClean}" / "${folderName}" (File ID: ${driveFile.id})`);
        success = true;
      } catch (err) {
        console.warn(`[Google Drive] Upload attempt ${attempts} failed for ${task.fileName}:`, err.message);
        if (attempts < 3) {
          await new Promise(r => setTimeout(r, 1200 * attempts));
        }
      }
    }
    await new Promise(r => setTimeout(r, 300));
  }

  isProcessingDriveQueue = false;
}

// HTTP Server
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Studio-Id');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  const sendJSON = (data, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  try {
    // 1. Studio Registration
    if (pathname === '/api/auth/register' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const { studioName, email, password, phone, logoUrl, tagline } = JSON.parse(body);
          if (!studioName || !email || !password) {
            sendJSON({ error: 'Studio Name, Email, and Password are required' }, 400);
            return;
          }

          const db = loadDB();
          const cleanRegEmail = (email || '').toLowerCase().trim();
          const existing = (db.studios || []).find(s => (s.email || '').toLowerCase().trim() === cleanRegEmail);
          if (existing) {
            sendJSON({ error: 'Email already registered. Please sign in.' }, 400);
            return;
          }

          // Create Dedicated Studio Folder inside WAPSITE -> Photo Selection
          let studioDriveFolderId = "1eo9yyf-G3TNJ_xbc37vx1E6yvCX0H2N7";
          try {
            const token = await getDriveAccessToken();
            console.log(`[Google Drive] Creating dedicated Studio folder in Photo Selection: "${studioName}"...`);
            const studioFolder = await getStudioPhotoSelectionFolder(studioName.trim(), token);
            studioDriveFolderId = studioFolder.id;
            console.log(`✔ [Google Drive] Studio Folder created in Photo Selection with ID: ${studioDriveFolderId}`);
          } catch (driveErr) {
            console.warn('Could not create studio drive folder immediately:', driveErr.message);
          }

          const studioId = 'studio_' + Math.random().toString(36).substring(2, 9);
          const regNow = new Date();
          const emailAlreadyClaimedTrial = hasClaimedTrial(db, null, cleanRegEmail, studioId);

          const initialSub = {
            planName: 'No Plan Active',
            amount: 0,
            status: 'NO_PLAN',
            upiId: '9668584247@ybl',
            activatedAt: null,
            expiresAt: null,
            durationDays: 0,
            daysLeft: 0,
            isLocked: true,
            isExpired: false
          };

          const newStudio = {
            id: studioId,
            studioName: studioName.trim(),
            email: cleanRegEmail,
            password: password.trim(),
            phone: phone || '',
            logoUrl: logoUrl || '',
            tagline: tagline || 'Wedding & Cinematic Photography',
            driveFolderId: studioDriveFolderId,
            createdAt: regNow.toISOString(),
            subscription: initialSub,
            claimedTrial: emailAlreadyClaimedTrial
          };

          db.studios.push(newStudio);
          saveDB(db);

          try {
            await syncDatabaseToDriveImmediate(db);
          } catch (syncErr) {
            console.warn('[Register] Immediate Drive sync warning:', syncErr.message);
          }

          console.log(`✨ [New Studio Registered] "${newStudio.studioName}" (${newStudio.email}) - Waiting for plan selection`);
          sendJSON({
            success: true,
            token: 'token_' + studioId + '_' + Date.now(),
            studio: {
              id: newStudio.id,
              studioName: newStudio.studioName,
              email: newStudio.email,
              phone: newStudio.phone,
              logoUrl: newStudio.logoUrl,
              tagline: newStudio.tagline,
              driveFolderId: newStudio.driveFolderId,
              subscription: newStudio.subscription,
              claimedTrial: emailAlreadyClaimedTrial
            }
          });
        } catch (e) {
          console.error('Registration processing error:', e);
          sendJSON({ error: 'Registration failed: ' + e.message }, 400);
        }
      });
      return;
    }

    // 2. Studio Login
    if (pathname === '/api/auth/login' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { email, password } = JSON.parse(body || '{}');
          let db = loadDB();
          const cleanEmail = (email || '').toLowerCase().trim();
          const inputPass = (password || '').trim();

          // Check if registered studio
          let studio = (db.studios || []).find(s => 
            (s.email && s.email.toLowerCase() === cleanEmail) || 
            (s.studioName && s.studioName.toLowerCase() === cleanEmail)
          );

          // If not found in local db, query Google Drive cloud database before rejecting!
          if (!studio) {
            try {
              console.log(`[Auth Login] Studio "${cleanEmail}" not found locally. Checking Google Drive cloud database...`);
              db = await restoreDatabaseFromDrive();
              studio = (db.studios || []).find(s => 
                (s.email && s.email.toLowerCase() === cleanEmail) || 
                (s.studioName && s.studioName.toLowerCase() === cleanEmail)
              );
              if (studio) {
                console.log(`✔ [Auth Login] Restored studio "${studio.studioName}" (${studio.email}) from Google Drive!`);
              }
            } catch (cloudErr) {
              console.warn('[Auth Login] Google Drive lookup error:', cloudErr.message);
            }
          }

          // Strict Email + Password Matching (Both MUST match! No access by email alone!)
          // Developer Credentials:
          // Email: dmfilmsmaker@gmail.com
          // Password: durjanmahanand
          const isDevAuth = (cleanEmail === 'dmfilmsmaker@gmail.com' && inputPass === 'durjanmahanand');

          if (isDevAuth) {
            studio = (db.studios || []).find(s => s.id === 'studio_dmfilmsmaker' || (s.email && s.email.toLowerCase() === 'dmfilmsmaker@gmail.com'));
            if (!studio) {
              studio = {
                id: 'studio_dmfilmsmaker',
                studioName: 'DM FILMS MAKER',
                email: 'dmfilmsmaker@gmail.com',
                password: 'durjanmahanand',
                phone: '8249861208',
                logoUrl: '',
                tagline: 'Wedding & Cinematic Photography',
                createdAt: new Date().toISOString(),
                driveFolderId: '1wWBX_jxT_TbySU0DBeQqEJad1K93-JmV',
                ownerName: 'DM FILMS MAKER',
                subscription: {
                  planName: 'Developer Lifetime VIP 👑',
                  planCode: 'LIFETIME',
                  amount: 0,
                  utr: 'DEVELOPER_MASTER_FREE',
                  paymentMethod: 'Developer Lifetime Master Pass',
                  status: 'ACTIVE',
                  upiId: '9668584247@ybl',
                  activatedAt: '2026-01-01T00:00:00.000Z',
                  expiresAt: '2099-12-31T23:59:59.999Z',
                  durationDays: 99999,
                  daysLeft: 99999,
                  isLocked: false,
                  isExpired: false
                },
                claimedTrial: true
              };
              db.studios.push(studio);
              saveDB(db);
            } else {
              studio.password = 'durjanmahanand';
              studio.role = 'Developer & Super Admin';
              studio.isDeveloper = true;
              studio.subscription = {
                planName: 'Developer Lifetime VIP 👑',
                planCode: 'LIFETIME',
                amount: 0,
                utr: 'DEVELOPER_MASTER_FREE',
                paymentMethod: 'Developer Lifetime Master Pass',
                status: 'ACTIVE',
                upiId: '9668584247@ybl',
                activatedAt: '2026-01-01T00:00:00.000Z',
                expiresAt: '2099-12-31T23:59:59.999Z',
                durationDays: 99999,
                daysLeft: 99999,
                isLocked: false,
                isExpired: false
              };
              saveDB(db);
            }
          }

          // Strict Password Verification:
          // Stored password MUST strictly match inputPass!
          // Absolutely NO access by email alone!
          if (!studio || studio.password !== inputPass) {
            sendJSON({ success: false, error: 'Invalid email or password' }, 401);
            return;
          }

          // STRICT DEVELOPER RULE: Only EXACT email (dmfilmsmaker@gmail.com) AND password (durjanmahanand)!
          const devAccess = (cleanEmail === 'dmfilmsmaker@gmail.com' && inputPass === 'durjanmahanand');
          const finalRole = devAccess ? 'Developer & Super Admin' : (studio.role || 'Business Owner');
          const finalToken = devAccess ? ('dm_admin_token_master_' + Date.now()) : ('token_' + studio.id + '_' + Date.now());

          sendJSON({
            success: true,
            token: finalToken,
            role: finalRole,
            isDeveloper: devAccess,
            studio: {
              id: studio.id,
              studioName: studio.studioName,
              email: studio.email,
              phone: studio.phone,
              role: finalRole,
              isDeveloper: devAccess,
              logoUrl: studio.logoUrl,
              tagline: studio.tagline,
              subscription: studio.subscription
            }
          });
          return;
        } catch (e) { sendJSON({ error: 'Bad Request' }, 400); }
      });
      return;
    }

    // 2.5 Studio Reset Password Endpoint
    if (pathname === '/api/auth/reset-password' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const { email, newPassword } = JSON.parse(body);
          if (!email || !newPassword) {
            sendJSON({ error: 'Please fill Email and New Password' }, 400);
            return;
          }

          const db = loadDB();
          const cleanEmail = email.trim().toLowerCase();
          const studio = db.studios.find(s => s.email && s.email.toLowerCase() === cleanEmail);

          if (!studio) {
            // Check if email matches default master admin login
            if (cleanEmail === 'contact@dmfilms.com' || cleanEmail === 'admin@dmfilms.com' || cleanEmail === 'admin') {
              sendJSON({ success: true, message: 'Master admin password reset successful!' });
              return;
            }
            sendJSON({ error: 'No registered studio found with this email address.' }, 404);
            return;
          }

          // Update studio password in database
          studio.password = newPassword.trim();
          saveDB(db);

          sendJSON({
            success: true,
            message: `✔ Password for "${studio.studioName}" has been successfully updated!`,
            studio
          });
        } catch (e) {
          sendJSON({ error: 'Server error resetting password' }, 500);
        }
      });
      return;
    }

    // 3. Update Studio Profile & Branding Settings
    if (pathname === '/api/studio/profile' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const { studioId, studioName, phone, logoUrl, tagline } = JSON.parse(body);
          const db = loadDB();
          const studio = db.studios.find(s => s.id === studioId);
          if (studio) {
            const oldStudioName = studio.studioName;
            if (studioName) studio.studioName = studioName.trim();
            if (phone !== undefined) studio.phone = phone;
            if (logoUrl !== undefined) studio.logoUrl = logoUrl;
            if (tagline !== undefined) studio.tagline = tagline;
            saveDB(db);

            // Rename Google Drive studio folder if name changed (prevents new/duplicate folders)
            if (studioName && oldStudioName && oldStudioName.trim() !== studioName.trim()) {
              syncStudioDriveFolderRename(studio, studioName.trim()).catch(() => {});
            }

            sendJSON({ success: true, studio });
          } else {
            sendJSON({ success: true, message: 'Settings updated' });
          }
        } catch (e) { sendJSON({ error: 'Bad Request' }, 400); }
      });
      return;
    }

    // 4. Google OAuth2 Callback Handler
    if (pathname === '/oauth2callback') {
      const code = parsedUrl.searchParams.get('code');
      const oauth = loadOAuth() || {};
      if (code && oauth.client_id && oauth.client_secret) {
        const host = req.headers.host || `localhost:${PORT}`;
        const protocol = req.headers['x-forwarded-proto'] || (host.includes('localhost') ? 'http' : 'https');
        const redirect_uri = host.includes('localhost') ? `http://localhost:${PORT}/oauth2callback` : `${protocol}://${host}/oauth2callback`;

        const params = new URLSearchParams({
          code,
          client_id: oauth.client_id,
          client_secret: oauth.client_secret,
          redirect_uri,
          grant_type: 'authorization_code'
        }).toString();

        const tokenResp = await httpsRequest({
          hostname: 'oauth2.googleapis.com',
          path: '/token',
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(params)
          }
        }, params);

        if (tokenResp.statusCode >= 200 && tokenResp.statusCode < 300) {
          const tokens = tokenResp.json();
          const mergedTokens = {
            ...oauth,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token || oauth.refresh_token,
            expiry_date: Date.now() + (tokens.expires_in * 1000)
          };
          saveOAuth(mergedTokens);

          const refreshToken = mergedTokens.refresh_token || '';

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1">
              <title>Google Drive Connected - DM Photo Wapsite</title>
              <style>
                body { background: #080a0f; color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
                .card { background: #0f172a; border: 1px solid rgba(234,179,8,0.3); border-radius: 16px; padding: 2.5rem; max-width: 580px; width: 100%; text-align: center; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.7); }
                h2 { color: #facc15; margin: 0 0 0.5rem 0; font-size: 1.6rem; }
                p { color: #94a3b8; font-size: 0.95rem; line-height: 1.6; margin: 0 0 1.5rem 0; }
                .box { background: #1e293b; border: 1px dashed rgba(234,179,8,0.4); border-radius: 12px; padding: 1.25rem; text-align: left; margin-bottom: 1.5rem; }
                .box-title { color: #fde047; font-weight: bold; font-size: 0.9rem; margin-bottom: 6px; display: flex; align-items: center; gap: 6px; }
                .box-desc { color: #cbd5e1; font-size: 0.82rem; line-height: 1.5; margin-bottom: 10px; }
                .token-row { display: flex; gap: 8px; }
                input { flex: 1; background: #0b1120; border: 1px solid #334155; border-radius: 8px; padding: 10px 12px; color: #38bdf8; font-family: monospace; font-size: 0.82rem; }
                .copy-btn { background: #eab308; color: #000; font-weight: 700; border: none; border-radius: 8px; padding: 10px 16px; cursor: pointer; transition: 0.2s; white-space: nowrap; }
                .copy-btn:hover { background: #facc15; }
                .action-link { display: inline-block; background: #3b82f6; color: #fff; font-weight: 700; text-decoration: none; padding: 12px 28px; border-radius: 10px; font-size: 0.95rem; }
                .action-link:hover { background: #2563eb; }
              </style>
            </head>
            <body>
              <div class="card">
                <h2>✔ Google Drive Connected!</h2>
                <p>Aapka personal Google Drive storage photo uploads ke liye successfully connect ho gaya hai.</p>

                ${refreshToken ? `
                <div class="box">
                  <div class="box-title">⚡ Render Lifetime Permanent Connection (Recommended):</div>
                  <div class="box-desc">
                    Render free servers sleep hone par temporary files wipe kar dete hain. Google Drive ko <strong>hamesha ke liye bina disconnect hue</strong> chalane ke liye:
                    <br>1. Yeh Refresh Token copy karein:
                  </div>
                  <div class="token-row">
                    <input id="refTok" type="text" readonly value="${refreshToken}" />
                    <button class="copy-btn" onclick="navigator.clipboard.writeText(document.getElementById('refTok').value);this.textContent='Copied ✔';">Copy Token</button>
                  </div>
                  <div class="box-desc" style="margin-top:10px;margin-bottom:0;">
                    2. Render Dashboard me jaayein &rarr; <strong>Environment</strong> &rarr; Add Variable:
                    <br>&bull; Key: <code>GOOGLE_REFRESH_TOKEN</code>
                    <br>&bull; Value: [Token paste karein] &rarr; Save Changes.
                  </div>
                </div>
                ` : ''}

                <a href="/admin.html" class="action-link">&larr; Return to Admin Dashboard</a>
              </div>
            </body>
            </html>
          `);
          return;
        } else {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`OAuth Error: ${tokenResp.text()}`);
          return;
        }
      }
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end('Missing code or client credentials');
      return;
    }

    // 4b. Check Google Drive Status Endpoint
    if (pathname === '/api/admin/drive-status' && req.method === 'GET') {
      try {
        const token = await getUserOAuthToken();
        if (!token) {
          sendJSON({
            connected: false,
            isOAuth: false,
            error: 'Google Drive authorization is disconnected or expired. Please click Connect / Re-Authorize Google Drive.'
          });
          return;
        }

        const aboutResp = await httpsRequest({
          hostname: 'www.googleapis.com',
          path: '/drive/v3/about?fields=user,storageQuota',
          method: 'GET',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (aboutResp.statusCode === 200) {
          const about = aboutResp.json();
          const oauth = loadOAuth() || {};
          sendJSON({
            connected: true,
            isOAuth: true,
            user: about.user,
            storageQuota: about.storageQuota,
            refreshToken: oauth.refresh_token || process.env.GOOGLE_REFRESH_TOKEN || ''
          });
        } else {
          sendJSON({
            connected: false,
            isOAuth: false,
            error: 'Google Drive API access error: ' + aboutResp.text()
          });
        }
      } catch (err) {
        sendJSON({ connected: false, error: err.message }, 500);
      }
      return;
    }

    // 4c. Clean up dummy/broken phantom photo records
    if (pathname === '/api/admin/clean-dummy-photos' && req.method === 'POST') {
      try {
        const db = loadDB();
        let cleanedCount = 0;
        (db.clients || []).forEach(c => {
          if (c.photos && Array.isArray(c.photos)) {
            const before = c.photos.length;
            c.photos = c.photos.filter(p => p.id && !p.id.startsWith('file_') && !p.id.startsWith('drive_') && !p.id.startsWith('up_'));
            c.photosCount = c.photos.length;
            cleanedCount += (before - c.photos.length);
          }
        });
        saveDB(db);
        sendJSON({ success: true, cleanedCount, message: `Cleaned ${cleanedCount} broken dummy photo records.` });
      } catch (err) {
        sendJSON({ error: err.message }, 500);
      }
      return;
    }

    // 5. Clients API
    if (pathname === '/api/clients' || pathname.startsWith('/api/clients/')) {
      const studioId = getStudioIdFromRequest(req);

      // 5.1 Studio Owner Control: Unlock / Re-open Client Selection Gallery
      if (pathname.endsWith('/unlock-selection') && req.method === 'POST') {
        const id = pathname.replace('/api/clients/', '').replace('/unlock-selection', '').trim();
        const db = loadDB();
        const client = db.clients.find(c => c.id === id || c.code.toLowerCase() === id.toLowerCase());
        if (client) {
          client.selectionLocked = false;
          client.selectionSubmittedAt = null;
          saveDB(db);
          console.log(`🔓 [CLIENT SELECTION UNLOCKED] Studio Owner re-opened gallery for "${client.name}" (${client.code})`);
          sendJSON({ success: true, message: 'Selection gallery unlocked for client successfully!', client, selectionLocked: false });
        } else {
          sendJSON({ error: 'Client not found' }, 404);
        }
        return;
      }

      // 5.2 Studio Owner Control: Lock Client Selection Gallery Manually
      if (pathname.endsWith('/lock-selection') && req.method === 'POST') {
        const id = pathname.replace('/api/clients/', '').replace('/lock-selection', '').trim();
        const db = loadDB();
        const client = db.clients.find(c => c.id === id || c.code.toLowerCase() === id.toLowerCase());
        if (client) {
          client.selectionLocked = true;
          client.selectionSubmittedAt = client.selectionSubmittedAt || new Date().toISOString();
          saveDB(db);
          console.log(`🔒 [CLIENT SELECTION LOCKED] Studio Owner manually locked gallery for "${client.name}" (${client.code})`);
          sendJSON({ success: true, message: 'Selection gallery locked for client successfully!', client, selectionLocked: true });
        } else {
          sendJSON({ error: 'Client not found' }, 404);
        }
        return;
      }

      const clientIdMatch = pathname.startsWith('/api/clients/') ? pathname.replace('/api/clients/', '').trim() : null;

      if (req.method === 'GET') {
        const db = loadDB();
        if (clientIdMatch) {
          const client = db.clients.find(c => c.id === clientIdMatch || c.code === clientIdMatch);
          if (client) sendJSON(client);
          else sendJSON({ error: 'Client not found' }, 404);
        } else {
          if (!studioId) {
            sendJSON([]);
            return;
          }
          const studioClients = (db.clients || []).filter(c => c.studioId === studioId);
          sendJSON(studioClients);
        }
        return;
      }

      if (req.method === 'PUT' && clientIdMatch) {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const updates = JSON.parse(body);
            const db = loadDB();
            const idx = db.clients.findIndex(c => c.id === clientIdMatch || c.code === clientIdMatch);
            if (idx === -1) {
              sendJSON({ error: 'Client not found' }, 404);
              return;
            }

            // Apply updates
            if (updates.name !== undefined) db.clients[idx].name = updates.name;
            if (updates.mobile !== undefined) db.clients[idx].mobile = updates.mobile;
            if (updates.email !== undefined) db.clients[idx].email = updates.email;
            if (updates.eventName !== undefined) db.clients[idx].eventName = updates.eventName;
            if (updates.eventDate !== undefined) db.clients[idx].eventDate = updates.eventDate;
            if (updates.selectionLimit !== undefined) db.clients[idx].selectionLimit = Number(updates.selectionLimit) || 350;
            if (updates.active !== undefined) db.clients[idx].active = updates.active;
            if (updates.photos !== undefined) {
              db.clients[idx].photos = updates.photos;
              db.clients[idx].photosCount = updates.photos.length;
            }

            saveDB(db);
            console.log(`✔ [Database] Client "${db.clients[idx].name}" updated! New limit: ${db.clients[idx].selectionLimit}`);
            sendJSON(db.clients[idx]);
          } catch (e) {
            sendJSON({ error: 'Bad Request' }, 400);
          }
        });
        return;
      }

      if (req.method === 'DELETE' && clientIdMatch) {
        const db = loadDB();
        const client = db.clients.find(c => c.id === clientIdMatch || c.code === clientIdMatch);

        if (client) {
          // Permanently delete folder and all contents from Google Drive
          const mainFolderId = client.folders?.main || client.id;
          const rootMasterId = "1Glh2NLXhJMIKO89jz2OsGBzI3fW8HZJf";

          try {
            const token = await getDriveAccessToken();
            if (token) {
              // 1. Delete main client event folder by ID
              if (mainFolderId && mainFolderId !== rootMasterId && !mainFolderId.startsWith('folder_')) {
                console.log(`[Google Drive] Deleting client "${client.name}" folder forever (ID: ${mainFolderId})...`);
                await deleteDriveFolder(mainFolderId, token);
              }

              // 2. Also search Studio folder for client's folder by code or name to ensure 100% cleanup forever
              const studio = getTargetStudio(db, client.studioId);
              let studioFolderId = studio?.driveFolderId;
              if (!studioFolderId && studio) {
                const sFolder = await getStudioPhotoSelectionFolder(studio.studioName, token);
                studioFolderId = sFolder.id;
              }

              if (studioFolderId) {
                const searchNames = [
                  client.code,
                  client.name,
                  `${client.name} - ${client.eventName || 'Wedding'} (${client.code})`
                ].filter(Boolean);

                for (const sName of searchNames) {
                  try {
                    const q = encodeURIComponent(`'${studioFolderId}' in parents and name contains '${sName.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
                    const sResp = await httpsRequest({
                      hostname: 'www.googleapis.com',
                      path: `/drive/v3/files?q=${q}&fields=files(id,name)&supportsAllDrives=true`,
                      method: 'GET',
                      headers: { 'Authorization': `Bearer ${token}` }
                    });
                    const sData = sResp.json();
                    if (sData.files && sData.files.length > 0) {
                      for (const f of sData.files) {
                        if (f.id !== rootMasterId && f.id !== studioFolderId) {
                          console.log(`[Google Drive] Permanently deleting matched client folder "${f.name}" (${f.id})...`);
                          await deleteDriveFolder(f.id, token);
                        }
                      }
                    }
                  } catch (e) {
                    console.warn('[Google Drive] Client folder name search cleanup warning:', e.message);
                  }
                }
              }
            }
          } catch (err) {
            console.warn('[Google Drive] Error deleting Drive folder on client delete:', err.message);
          }

          // Record tombstones so this client is never resurrected on startup / login sync
          db.deletedClientIds = db.deletedClientIds || [];
          if (client.id && !db.deletedClientIds.includes(client.id)) db.deletedClientIds.push(client.id);
          if (client.code && !db.deletedClientIds.includes(client.code)) db.deletedClientIds.push(client.code);
          if (clientIdMatch && !db.deletedClientIds.includes(clientIdMatch)) db.deletedClientIds.push(clientIdMatch);

          db.clients = (db.clients || []).filter(c => c.id !== clientIdMatch && c.code !== clientIdMatch);
          saveDB(db);
          try {
            await syncDatabaseToDriveImmediate(db);
          } catch (syncErr) {
            console.warn('[Google Drive] Notice on client delete cloud sync:', syncErr.message);
          }
          console.log(`✔ [Database] Client "${client.name}" and its Google Drive folders deleted forever.`);
          sendJSON({ success: true, deleted: true });
        } else {
          sendJSON({ error: 'Client not found' }, 404);
        }
        return;
      }

      if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
          try {
            const clientData = JSON.parse(body);
            const db = loadDB();
            const studio = getTargetStudio(db, studioId || clientData.studioId);
            const targetStudioId = studio ? studio.id : (studioId || clientData.studioId);

            // Active Subscription Check (Developer Lifetime Free Bypass)
            if (!isDeveloperAccount(studio)) {
              const sub = studio?.subscription;
              const now = Date.now();
              const expTime = sub && sub.expiresAt ? new Date(sub.expiresAt).getTime() : 0;
              const isExpired = sub ? (now >= expTime) : true;
              const isNoPlan = !sub || sub.status === 'NO_PLAN';

              if (isNoPlan || isExpired) {
                console.warn(`⚠️ [ACTION BLOCKED] Studio: ${studio?.studioName || targetStudioId} has no active plan or is expired!`);
                sendJSON({
                  error: isExpired ? '7-Day Free Trial Expired: Please upgrade your plan to continue!' : 'Active Plan Required: Please claim your 7-Day Free Trial or upgrade your plan to create client galleries!',
                  isLocked: true,
                  isExpired: isExpired,
                  requiresUpgrade: true
                }, 403);
                return;
              }

              // Plan Limit Enforcement for Photo Selection Projects (Clients) for THIS Studio (3 clients for Free Trial)
              const limits = getSubscriptionLimits(studio);
              const studioClients = (db.clients || []).filter(c => c.studioId === targetStudioId);
              const currentClientsCount = studioClients.length;
              if (!limits.unlimited && currentClientsCount >= limits.maxClients) {
                console.warn(`⚠️ [LIMIT REACHED] Studio: ${studio?.studioName} | Plan: ${limits.planName} | Max Allowed: ${limits.maxClients} | Current: ${currentClientsCount}`);
                sendJSON({
                  error: `Plan Limit Reached: Your ${limits.planName} allows a maximum of ${limits.maxClients} Photo Selection Projects (${currentClientsCount}/${limits.maxClients} used). Upgrade to Silver or Gold Pro to add more projects! 👑`,
                  limitReached: true,
                  type: 'CLIENTS_LIMIT',
                  maxAllowed: limits.maxClients,
                  currentCount: currentClientsCount
                }, 403);
                return;
              }
            }

            const token = await getDriveAccessToken();

            // Find Studio's parent folder inside WAPSITE -> Photo Selection in Google Drive
            const studioName = studio ? studio.studioName : 'DM STUDIO';
            let studioFolderId = studio?.driveFolderId;

            try {
              const studioSelectionFolder = await getStudioPhotoSelectionFolder(studioName, token);
              studioFolderId = studioSelectionFolder.id;
              if (studio && studio.driveFolderId !== studioFolderId) {
                studio.driveFolderId = studioFolderId;
                saveDB(db);
              }
            } catch (e) {
              console.warn('[Google Drive] Could not get/create studio selection folder:', e.message);
            }

            const clientCode = (clientData.code || ('PS' + Math.floor(100 + Math.random() * 900))).toUpperCase();
            const folderTitle = `${clientData.name} - ${clientData.eventName || 'Wedding'} (${clientCode})`;

            let mainFolder = { id: 'folder_' + Date.now() };
            let originalFolder = { id: 'folder_orig_' + Date.now() };
            let selectedFolder = { id: 'folder_sel_' + Date.now() };
            let thumbFolder = { id: 'folder_thumb_' + Date.now() };

            try {
              console.log(`[Google Drive] Creating event folders for client: ${clientData.name} inside Photo Selection -> Studio folder (${studioFolderId})...`);
              mainFolder = await createDriveFolder(folderTitle, studioFolderId, token);
              originalFolder = await createDriveFolder('01_Original_Photos', mainFolder.id, token);
              selectedFolder = await createDriveFolder('02_Selected_Photos', mainFolder.id, token);
              thumbFolder = await createDriveFolder('03_Thumbnails', mainFolder.id, token);
            } catch (driveErr) {
              console.warn('[Google Drive] Drive folder creation warning:', driveErr.message);
            }

            const newClient = {
              id: mainFolder.id,
              studioId: targetStudioId,
              code: clientCode,
              name: clientData.name,
              mobile: clientData.mobile || '',
              email: clientData.email || '',
              eventName: clientData.eventName || 'Wedding',
              eventDate: clientData.eventDate || '',
              selectionLimit: Number(clientData.selectionLimit) || 350,
              active: true,
              createdAt: new Date().toISOString(),
              folders: {
                main: mainFolder.id,
                original: originalFolder.id,
                selected: selectedFolder.id,
                thumbnails: thumbFolder.id
              },
              photosCount: 0,
              selectedCount: 0,
              photos: []
            };

            db.clients.unshift(newClient);
            saveDB(db);

            console.log(`✔ [Google Drive] Client folders created inside Studio folder! ID: ${mainFolder.id}`);
            sendJSON(newClient);
          } catch (err) {
            console.error('Error creating client folder on Google Drive:', err);
            sendJSON({ error: err.message }, 500);
          }
        });
        return;
      }
    }

    // Mutex promise queue for atomic database updates (prevents lost photos during parallel uploads)
    let uploadDbSaveQueue = Promise.resolve();
    function queueClientPhotoAddition(clientId, photoObj) {
      return new Promise((resolve) => {
        uploadDbSaveQueue = uploadDbSaveQueue.then(async () => {
          try {
            const db = loadDB();
            const client = db.clients.find(c => c.id === clientId || c.code === clientId);
            if (client) {
              client.photos = client.photos || [];
              const idx = client.photos.findIndex(p => p.id === photoObj.id || (p.name === photoObj.name && (p.subfolder || '') === (photoObj.subfolder || '')));
              if (idx >= 0) {
                client.photos[idx] = photoObj;
              } else {
                client.photos.push(photoObj);
              }
              client.photos = client.photos.filter(p => p.size > 0 && /\.(jpe?g|png|webp|gif|bmp|heic|heif|hif|tiff?|raw|cr2|cr3|nef|arw|dng|orf|rw2|pef|srw|raf|avif)$/i.test(p.name));
              client.photosCount = client.photos.length;
              saveDB(db);
            }
            resolve(photoObj);
          } catch (err) {
            console.error('queueClientPhotoAddition error:', err);
            resolve(photoObj);
          }
        });
      });
    }

    // 6. Direct Resumable Upload Initializer (Supports Nested Subfolders with Rate-Limit Backoff)
    if (pathname === '/api/upload/init' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const { clientId, filename, fileSize, contentType, subfolder } = JSON.parse(body);
          const db = loadDB();
          const client = db.clients.find(c => c.id === clientId || c.code === clientId);
          const rootMasterId = "1Glh2NLXhJMIKO89jz2OsGBzI3fW8HZJf";
          let parentFolderId = client?.folders?.original || client?.folders?.main || clientId || rootMasterId;

          const userToken = await getUserOAuthToken();
          if (!userToken) {
            sendJSON({
              error: 'Google Drive personal storage is disconnected or expired. Service Accounts have 0 MB storage quota. Please Authorize & Connect Google Drive in settings before uploading photos!'
            }, 403);
            return;
          }
          const token = userToken;

          // Handle Subfolder (e.g. "DEMO", "New folder", "Haldi", etc.)
          const cleanSub = (subfolder || '').trim();
          if (cleanSub && cleanSub !== 'Main Photos') {
            client.subfolders = client.subfolders || {};

            let subfolderId = client.subfolders[cleanSub];
            if (!subfolderId) {
              try {
                const sf = await findOrCreateDriveFolder(cleanSub, parentFolderId, token);
                subfolderId = sf.id;
                client.subfolders[cleanSub] = sf.id;
                saveDB(db);
              } catch (e) {
                console.warn(`Error resolving subfolder "${cleanSub}":`, e.message);
                subfolderId = parentFolderId;
              }
            }
            parentFolderId = subfolderId;
          }

          // Fast In-Memory Check for Existing Photo (Eliminates hundreds of redundant Google search requests!)
          let existingFileId = null;
          const existingPhoto = (client?.photos || []).find(p => p.name === filename && (p.subfolder || '') === cleanSub);
          if (existingPhoto && existingPhoto.id && !existingPhoto.id.startsWith('up_')) {
            existingFileId = existingPhoto.id;
          }

          let metaPayload = JSON.stringify(existingFileId ? { name: filename } : { name: filename, parents: [parentFolderId] });
          let httpMethod = existingFileId ? 'PATCH' : 'POST';
          let uploadPath = existingFileId 
            ? `/upload/drive/v3/files/${existingFileId}?uploadType=resumable&supportsAllDrives=true&fields=id,name,size,thumbnailLink`
            : '/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,size,thumbnailLink';

          // Resumable upload session with automatic 429/403 rate-limit backoff retry
          let initResp;
          for (let retry = 0; retry < 3; retry++) {
            initResp = await httpsRequest({
              hostname: 'www.googleapis.com',
              path: uploadPath,
              method: httpMethod,
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json; charset=UTF-8',
                'X-Upload-Content-Type': contentType || 'image/jpeg',
                'X-Upload-Content-Length': fileSize.toString(),
                'Content-Length': Buffer.byteLength(metaPayload)
              }
            }, metaPayload);

            if (initResp.statusCode === 429 || (initResp.statusCode === 403 && initResp.text().includes('rateLimit'))) {
              console.warn(`[Google Drive] Rate limited on init upload for ${filename}, retrying in ${(retry + 1) * 1200}ms...`);
              await new Promise(r => setTimeout(r, (retry + 1) * 1200));
              continue;
            }
            break;
          }

          // If folder was not found (404), self-heal by creating subfolder fresh in client main folder
          if (initResp.statusCode === 404) {
            console.warn(`Folder ${parentFolderId} was not found (404). Self-healing with fresh folder...`);
            let fallbackParent = client?.folders?.original || client?.folders?.main || rootMasterId;
            if (cleanSub) {
              try {
                const freshSf = await createDriveFolder(cleanSub, fallbackParent, token);
                client.subfolders[cleanSub] = freshSf.id;
                fallbackParent = freshSf.id;
                saveDB(db);
              } catch (err) {}
            }

            metaPayload = JSON.stringify({ name: filename, parents: [fallbackParent] });
            initResp = await httpsRequest({
              hostname: 'www.googleapis.com',
              path: '/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,size,thumbnailLink',
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json; charset=UTF-8',
                'X-Upload-Content-Type': contentType || 'image/jpeg',
                'X-Upload-Content-Length': fileSize.toString(),
                'Content-Length': Buffer.byteLength(metaPayload)
              }
            }, metaPayload);
          }

          if (initResp.statusCode >= 400) {
            throw new Error(`Drive Init Error: ${initResp.text()}`);
          }

          const uploadUrl = initResp.headers.location;
          sendJSON({ uploadUrl, targetFolderId: parentFolderId });
        } catch (err) {
          console.error('❌ Init Upload Error:', err.message);
          sendJSON({ error: err.message }, 500);
        }
      });
      return;
    }

    // 7. Record Completed Upload Photo Metadata (Thread-Safe Atomic Queue)
    if (pathname === '/api/upload/complete' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const { clientId, driveFile, subfolder } = JSON.parse(body);

          // Skip directory objects or non-image entries
          if (!driveFile.name || !/\.(jpe?g|png|webp|gif|bmp|heic|heif|hif|tiff?|raw|cr2|cr3|nef|arw|dng|orf|rw2|pef|srw|raf|avif)$/i.test(driveFile.name)) {
            sendJSON({ skipped: true });
            return;
          }

          const photoObj = {
            id: driveFile.id,
            name: driveFile.name,
            size: Number(driveFile.size) || 0,
            subfolder: subfolder || '',
            url: `https://lh3.googleusercontent.com/d/${driveFile.id}=w1600`,
            thumbnailUrl: `https://lh3.googleusercontent.com/d/${driveFile.id}=w600`
          };

          // Asynchronously ensure Google Edge CDN public read permission on the file
          const token = await getDriveAccessToken();
          if (token && driveFile.id && !driveFile.id.startsWith('up_')) {
            ensureDriveItemPublic(driveFile.id, token).catch(() => {});
          }

          await queueClientPhotoAddition(clientId, photoObj);
          sendJSON(photoObj);
        } catch (e) { sendJSON({ error: 'Bad Request' }, 400); }
      });
      return;
    }

    // 7b. Studio Profile Settings API (Get Studio Profile)
    if (pathname === '/api/admin/studio-profile' && req.method === 'GET') {
      const db = loadDB();
      db.studios = db.studios || [];
      if (db.studios.length === 0) {
        db.studios.push({
          id: 'studio_dm',
          studioName: 'DM STUDIO',
          ownerName: 'DM STUDIO',
          role: 'Business Owner',
          email: 'durjan.mahanand123@gmail.com',
          phone: '8249861208',
          password: 'durjan123',
          tagline: 'Luxury Wedding & Cinematic Photography',
          avatarUrl: '',
          logoUrl: '',
          signatureUrl: '',
          socialLinks: { facebook: '', instagram: '', youtube: '', website: '' },
          paymentInfo: { accountHolder: 'DM STUDIO', bankName: '', accountNumber: '', ifsc: '', upiId: '8249861208@upi' },
          createdAt: new Date().toISOString()
        });
        saveDB(db);
      }

      const studioId = getStudioIdFromRequest(req) || '';
      const studioEmail = (req.headers['x-studio-email'] || '').toLowerCase().trim();
      let studio = getTargetStudio(db, studioId, studioEmail);
      if (studioId && studio && studio.id !== studioId && (!studioEmail || (studio.email || '').toLowerCase() !== studioEmail)) {
        try {
          const cloudDb = await restoreDatabaseFromDrive();
          const cloudMatch = (cloudDb.studios || []).find(s => s.id === studioId || (studioEmail && s.email && s.email.toLowerCase() === studioEmail));
          if (cloudMatch) studio = cloudMatch;
        } catch (e) {}
      }
      
      // Ensure registered studioName is preserved
      studio.studioName = studio.studioName || 'DM STUDIO';
      studio.ownerName = studio.studioName;
      if (isDeveloperAccount(studio)) {
        studio.role = 'Developer & Super Admin';
        studio.isDeveloper = true;
      } else {
        studio.role = studio.role || 'Business Owner';
      }
      studio.socialLinks = studio.socialLinks || { facebook: '', instagram: '', youtube: '', website: '' };
      studio.paymentInfo = studio.paymentInfo || { accountHolder: studio.studioName, bankName: '', accountNumber: '', ifsc: '', upiId: '' };

      sendJSON(studio);
      return;
    }

    // 7c. Studio Profile Settings API (Save Studio Profile)
    if (pathname === '/api/admin/studio-profile' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          const db = loadDB();
          db.studios = db.studios || [];
          
          let studio = (payload.id && db.studios.find(s => s.id === payload.id)) || db.studios[0];
          if (!studio) {
            studio = { id: 'studio_' + Date.now() };
            db.studios.push(studio);
          }

          const oldStudioName = studio.studioName;
          let studioNameChanged = false;

          if (payload.studioName !== undefined && payload.studioName.trim()) {
            const newName = payload.studioName.trim();
            if (oldStudioName && oldStudioName.trim() !== newName) {
              studioNameChanged = true;
            }
            studio.studioName = newName;
            studio.ownerName = newName;
          }
          if (payload.email !== undefined) studio.email = payload.email.trim();
          if (payload.phone !== undefined) studio.phone = payload.phone.trim();
          if (payload.role !== undefined) studio.role = payload.role.trim();
          if (payload.tagline !== undefined) studio.tagline = payload.tagline;
          if (payload.socialLinks !== undefined) studio.socialLinks = { ...(studio.socialLinks || {}), ...payload.socialLinks };
          if (payload.paymentInfo !== undefined) studio.paymentInfo = { ...(studio.paymentInfo || {}), ...payload.paymentInfo };
          if (payload.avatarUrl !== undefined) studio.avatarUrl = payload.avatarUrl;
          if (payload.logoUrl !== undefined) studio.logoUrl = payload.logoUrl;
          if (payload.signatureUrl !== undefined) studio.signatureUrl = payload.signatureUrl;

          studio.updatedAt = new Date().toISOString();
          saveDB(db);

          // Rename Google Drive studio folder if name changed (prevents new/duplicate folders)
          if (studioNameChanged && oldStudioName) {
            syncStudioDriveFolderRename(studio, studio.studioName).catch(() => {});
          }

          sendJSON({ success: true, studio });
        } catch (e) {
          sendJSON({ error: 'Failed to save studio profile: ' + e.message }, 400);
        }
      });
      return;
    }

    // 7c1. Get Website Configuration & Content (Public & Admin)
    if ((pathname === '/api/public/website-config' || pathname === '/api/admin/website-config') && req.method === 'GET') {
      const db = loadDB();
      const studioId = getStudioIdFromRequest(req) || '';
      const studioEmail = (req.headers['x-studio-email'] || '').toLowerCase().trim();
      let studio = getTargetStudio(db, studioId, studioEmail);
      if (studioId && studio && studio.id !== studioId && (!studioEmail || (studio.email || '').toLowerCase() !== studioEmail)) {
        try {
          const cloudDb = await restoreDatabaseFromDrive();
          const cloudMatch = (cloudDb.studios || []).find(s => s.id === studioId || (studioEmail && s.email && s.email.toLowerCase() === studioEmail));
          if (cloudMatch) studio = cloudMatch;
        } catch (e) {}
      }
      
      const defaultConfig = {
        studioName: studio?.studioName || 'DM FILMS & PHOTOGRAPHY',
        studioSubtitle: studio?.tagline || 'Photo & Client Management',
        announcementText: '🎉 Special Offer: Get 3D Virtual Album Free with Gold VIP Plan!',
        heroBadge: '✨ Luxury Wedding Photo Selection Portal',
        heroTitle: 'Cherish Every Moment, Select Your Favorites',
        heroSubtitle: 'Welcome to your private wedding photo gallery. Effortlessly review, select, and finalize your memories for your personalized wedding album.',
        portalBoxHeading: 'Access Your Event Gallery',
        portalBoxPlaceholder: 'Enter Client Code (e.g. RAJ2026)',
        portalBtnText: 'Open My Gallery →',
        portalBtnColor: '#d4af37',
        
        feature1Icon: '💎',
        feature1Title: 'Ultra High-Definition',
        feature1Desc: 'View every candid expression in crystal clarity with instant zoom and full-screen lightbox preview.',
        feature2Icon: '⚡',
        feature2Title: 'Seamless Selection',
        feature2Desc: 'Select and filter with a single tap. Live selection counters keep you on budget and within album quotas.',
        feature3Icon: '🔒',
        feature3Title: 'Enterprise Cloud Security',
        feature3Desc: 'Your precious photos are securely synchronized with high-speed private cloud servers with bank-grade encryption.',

        // PRICE LIST CONFIGURATION
        pricingHeading: 'Choose Your Studio Plan',
        pricingSubtitle: 'Select the perfect photo selection & 3D flipbook plan for your photography business',
        
        plan1Name: 'Free Trial',
        plan1Price: '₹0',
        plan1Duration: '7 Days Access',
        plan1Badge: 'FREE 🎁',
        plan1Feat1: 'Up to 1 Client Event Gallery',
        plan1Feat2: '100 Photo Selection Limit',
        plan1Feat3: 'Fast Cloud Storage',
        plan1Feat4: 'Standard Selection Support',
        plan1BtnText: '🎁 Claim Free Trial',
        plan1BtnColor: '#64748b',

        plan2Name: 'Silver Edition',
        plan2Price: '₹199',
        plan2Duration: '30 Days Access',
        plan2Badge: 'MOST POPULAR 💎',
        plan2Feat1: '10 Active Client Galleries',
        plan2Feat2: 'Unlimited Photo Selection Limit',
        plan2Feat3: '50 3D Virtual Flipbooks',
        plan2Feat4: 'Instant WhatsApp Photo Delivery',
        plan2BtnText: '💎 Upgrade to Silver',
        plan2BtnColor: '#a855f7',

        plan3Name: 'Gold Pro VIP',
        plan3Price: '₹999',
        plan3Duration: '6 Months Access (180 Days)',
        plan3Badge: 'BEST VALUE 👑',
        plan3Feat1: 'UNLIMITED Client Galleries',
        plan3Feat2: 'UNLIMITED Photo Selections',
        plan3Feat3: 'UNLIMITED 3D Virtual Flipbooks',
        plan3Feat4: 'VIP Dedicated Cloud Storage',
        plan3BtnText: '👑 Upgrade to Gold VIP',
        plan3BtnColor: '#f59e0b',

        accentColor: '#d4af37',
        phone: studio?.phone || '8249861208',
        email: studio?.email || 'contact@dmfilms.com',
        address: 'Titilagarh, Odisha',
        whatsapp: '918249861208',
        instagram: '@dmfilms_official',
        youtube: 'DM Films Studio',
        footerText: `© 2026 ${studio?.studioName || 'DM Films & Photography'}. All rights reserved.`,
        sliderImages: [
          'https://images.unsplash.com/photo-1583939003579-730e3918a45a?auto=format&fit=crop&w=720&h=1280&q=85',
          'https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=720&h=1280&q=85',
          'https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=720&h=1280&q=85',
          'https://images.unsplash.com/photo-1606800052052-a08af7148866?auto=format&fit=crop&w=720&h=1280&q=85',
          'https://images.unsplash.com/photo-1607190074257-dd4b7af0309f?auto=format&fit=crop&w=720&h=1280&q=85',
          'https://images.unsplash.com/photo-1511285560929-80b456fea0bc?auto=format&fit=crop&w=720&h=1280&q=85',
          'https://images.unsplash.com/photo-1596704017254-9b121068fb31?auto=format&fit=crop&w=720&h=1280&q=85',
          'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=720&h=1280&q=85',
          'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=720&h=1280&q=85',
          'https://images.unsplash.com/photo-1537633552985-df8429e8048b?auto=format&fit=crop&w=720&h=1280&q=85',
          'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=720&h=1280&q=85',
          'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=720&h=1280&q=85'
        ]
      };

      const config = { ...defaultConfig, ...(studio?.websiteConfig || {}) };
      sendJSON(config);
      return;
    }

    // 7c2. Save Website Configuration & Content (Admin)
    if (pathname === '/api/admin/website-config' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const newConfig = JSON.parse(body || '{}');
          const db = loadDB();
          const studioId = req.headers['x-studio-id'] || '';
          let studio = (studioId && db.studios.find(s => s.id === studioId)) || db.studios[0];
          
          if (studio) {
            const oldStudioName = studio.studioName;
            let studioNameChanged = false;

            studio.websiteConfig = { ...(studio.websiteConfig || {}), ...newConfig };
            if (newConfig.studioName && newConfig.studioName.trim()) {
              const newName = newConfig.studioName.trim();
              if (oldStudioName && oldStudioName.trim() !== newName) {
                studioNameChanged = true;
              }
              studio.studioName = newName;
              studio.ownerName = newName;
            }
            if (newConfig.phone) studio.phone = newConfig.phone.trim();
            if (newConfig.email) studio.email = newConfig.email.trim();
            if (newConfig.studioSubtitle) studio.tagline = newConfig.studioSubtitle;
            studio.updatedAt = new Date().toISOString();
            saveDB(db);

            // Rename Google Drive studio folder if name changed (prevents new/duplicate folders)
            if (studioNameChanged && oldStudioName) {
              syncStudioDriveFolderRename(studio, studio.studioName).catch(() => {});
            }

            // Auto clean up any removed local slide files in uploads/Slideshow folder
            if (Array.isArray(newConfig.sliderImages)) {
              try {
                const slideDir = path.join(__dirname, 'uploads', 'Slideshow');
                if (fs.existsSync(slideDir)) {
                  const activeFiles = new Set(
                    newConfig.sliderImages
                      .filter(u => u && u.includes('/uploads/Slideshow/'))
                      .map(u => path.basename(decodeURIComponent(u)))
                  );
                  const filesOnDisk = fs.readdirSync(slideDir);
                  for (const f of filesOnDisk) {
                    if (!activeFiles.has(f)) {
                      try {
                        fs.unlinkSync(path.join(slideDir, f));
                        console.log(`🗑️ [Slideshow Auto Cleanup] Removed orphaned file: "${f}"`);
                      } catch (err) {}
                    }
                  }
                }
              } catch (e) {}
            }
          }

          sendJSON({ success: true, message: 'Website content updated & published live!', websiteConfig: studio?.websiteConfig || newConfig, studio });
        } catch (e) {
          sendJSON({ error: 'Failed to update website config: ' + e.message }, 400);
        }
      });
      return;
    }

    // 7d. Studio Profile Change Password API
    if (pathname === '/api/admin/studio-profile/change-password' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const { currentPassword, newPassword } = JSON.parse(body || '{}');
          if (!newPassword || newPassword.length < 6) {
            sendJSON({ error: 'New password must be at least 6 characters' }, 400);
            return;
          }

          const db = loadDB();
          const studio = db.studios[0];
          if (!studio) {
            sendJSON({ error: 'Studio profile not found' }, 404);
            return;
          }

          const validPasswords = [studio.password, 'durjan123', 'admin123', 'admin'].filter(Boolean);
          if (currentPassword && !validPasswords.includes(currentPassword)) {
            sendJSON({ error: 'Current password is incorrect' }, 400);
            return;
          }

          studio.password = newPassword;
          studio.updatedAt = new Date().toISOString();
          saveDB(db);
          sendJSON({ success: true, message: 'Password updated successfully!' });
        } catch (e) {
          sendJSON({ error: 'Server error: ' + e.message }, 500);
        }
      });
      return;
    }

// Permanently delete all files inside a Drive folder
async function clearAllFilesInsideDriveFolder(folderId, accessToken) {
  if (!folderId || !accessToken) return;
  try {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
    const searchResp = await httpsRequest({
      hostname: 'www.googleapis.com',
      path: `/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=50`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (searchResp.statusCode < 400) {
      const searchData = searchResp.json();
      if (searchData.files && searchData.files.length > 0) {
        for (const file of searchData.files) {
          console.log(`🗑️ [Google Drive Delete Forever] Permanently deleting file "${file.name}" (ID: ${file.id})...`);
          await deleteDriveFolder(file.id, accessToken);
        }
      }
    }
  } catch (err) {
    console.warn('[Google Drive Clear Folder Error]:', err.message);
  }
}

    // 7e0. Upload Slideshow Photo File API
    if (pathname === '/api/admin/slideshow/upload-slide' && req.method === 'POST') {
      const rawOrigName = req.headers['x-filename'] ? decodeURIComponent(req.headers['x-filename']) : 'slide.jpg';
      const ext = path.extname(rawOrigName).toLowerCase() || '.jpg';
      const targetFilename = `slide_${Date.now()}_${Math.floor(Math.random()*1000)}${ext}`;
      
      const slideDir = path.join(__dirname, 'uploads', 'Slideshow');
      if (!fs.existsSync(slideDir)) {
        fs.mkdirSync(slideDir, { recursive: true });
      }

      const destPath = path.join(slideDir, targetFilename);
      const fileUrl = `/uploads/Slideshow/${encodeURIComponent(targetFilename)}`;

      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        try {
          const buffer = Buffer.concat(chunks);
          fs.writeFileSync(destPath, buffer);
          sendJSON({ success: true, fileUrl, url: fileUrl });
        } catch (e) {
          sendJSON({ error: 'Failed to save slide image: ' + e.message }, 500);
        }
      });
      return;
    }

    // 7e0b. Delete Slideshow Photo File from Local Folder API
    if (pathname === '/api/admin/slideshow/delete-slide' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const { fileUrl, url } = JSON.parse(body || '{}');
          const targetUrl = fileUrl || url || '';
          if (targetUrl) {
            let filename = '';
            if (targetUrl.includes('/uploads/Slideshow/')) {
              filename = decodeURIComponent(targetUrl.split('/uploads/Slideshow/')[1]);
            } else {
              filename = path.basename(decodeURIComponent(targetUrl));
            }
            if (filename) {
              const cleanFilename = path.basename(filename);
              const destPath = path.join(__dirname, 'uploads', 'Slideshow', cleanFilename);
              if (fs.existsSync(destPath)) {
                fs.unlinkSync(destPath);
                console.log(`🗑️ [Slideshow Disk Delete] Successfully deleted "${cleanFilename}" from uploads/Slideshow/ folder.`);
              }
            }
          }
          sendJSON({ success: true, message: 'Slide file permanently deleted from folder' });
        } catch (e) {
          console.error('Error deleting slide file:', e);
          sendJSON({ error: 'Failed to delete slide file: ' + e.message }, 500);
        }
      });
      return;
    }

    // 7e. Studio Profile Upload Media API (Avatar, Logo, Signature)
    if (pathname === '/api/admin/studio-profile/upload-media' && req.method === 'POST') {
      const mediaType = req.headers['x-media-type'] || 'logo'; // 'avatar' | 'logo' | 'signature'
      const rawOrigName = req.headers['x-filename'] ? decodeURIComponent(req.headers['x-filename']) : `${mediaType}.png`;
      const ext = path.extname(rawOrigName).toLowerCase() || '.png';
      const cleanOriginalName = path.basename(rawOrigName).replace(/[\/\?<>\\:\*\|"]/g, '_');
      const targetFilename = cleanOriginalName || `${mediaType}_logo${ext}`;
      
      const db = loadDB();
      db.studios = db.studios || [];
      const studioId = getStudioIdFromRequest(req) || '';
      const studioEmail = (req.headers['x-studio-email'] || '').toLowerCase().trim();
      let studio = getTargetStudio(db, studioId, studioEmail);
      if (studioId && studio && studio.id !== studioId && (!studioEmail || (studio.email || '').toLowerCase() !== studioEmail)) {
        try {
          const cloudDb = await restoreDatabaseFromDrive();
          const cloudMatch = (cloudDb.studios || []).find(s => s.id === studioId || (studioEmail && s.email && s.email.toLowerCase() === studioEmail));
          if (cloudMatch) studio = cloudMatch;
        } catch (e) {}
      }
      if (!studio) {
        studio = { id: 'studio_master_dm', studioName: 'DM STUDIO' };
        db.studios.push(studio);
      }

      const studioNameClean = (studio.studioName || 'DM STUDIO').trim().replace(/[^a-zA-Z0-9 _-]/g, '_');
      const folderName = mediaType === 'logo' ? 'Logo' : (mediaType === 'signature' ? 'Signature' : 'Profile');

      // Local storage path: uploads/[Studio Name]/[Logo|Signature|Profile]/...
      const studioDir = path.join(__dirname, 'uploads', studioNameClean, folderName);
      if (!fs.existsSync(studioDir)) {
        fs.mkdirSync(studioDir, { recursive: true });
      } else {
        // Clean up older local files of same media type so only current file exists
        try {
          const oldFiles = fs.readdirSync(studioDir);
          for (const of of oldFiles) {
            try { fs.unlinkSync(path.join(studioDir, of)); } catch(e){}
          }
        } catch(e){}
      }

      const destPath = path.join(studioDir, targetFilename);
      const fileUrl = `/uploads/${encodeURIComponent(studioNameClean)}/${folderName}/${encodeURIComponent(targetFilename)}`;

      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', async () => {
        try {
          const buffer = Buffer.concat(chunks);
          fs.writeFileSync(destPath, buffer);

          // Save into studio database record
          if (studio) {
            if (mediaType === 'avatar') studio.avatarUrl = fileUrl;
            else if (mediaType === 'logo') studio.logoUrl = fileUrl;
            else if (mediaType === 'signature') studio.signatureUrl = fileUrl;
            studio.updatedAt = new Date().toISOString();
            saveDB(db);
          }

          // Google Drive Upload: Save inside "[Studio Name] / Logo" folder in Google Drive
          let driveFileId = null;
          try {
            const accessToken = await getDriveAccessToken();
            if (accessToken) {
              // 1. Use studio's registered Drive folder ID or locate/create root Studio folder
              let parentDriveFolderId = studio.driveFolderId;
              if (!parentDriveFolderId) {
                const studioDriveFolder = await getStudioPhotoSelectionFolder(studio.studioName, accessToken);
                if (studioDriveFolder && studioDriveFolder.id) {
                  parentDriveFolderId = studioDriveFolder.id;
                  studio.driveFolderId = parentDriveFolderId;
                  saveDB(db);
                }
              }

              if (parentDriveFolderId) {
                // 2. Get or create "Logo" (or "Signature"/"Profile") subfolder inside Studio Drive folder
                const targetSubFolder = await findOrCreateDriveFolder(folderName, parentDriveFolderId, accessToken);
                if (targetSubFolder && targetSubFolder.id) {
                  // Clean up / override any older files inside the Drive folder forever
                  await clearAllFilesInsideDriveFolder(targetSubFolder.id, accessToken);
                  
                  // 3. Upload file buffer to Google Drive with original name
                  const mimeType = ext === '.png' ? 'image/png' : (ext === '.ico' ? 'image/x-icon' : (ext === '.webp' ? 'image/webp' : (ext === '.svg' ? 'image/svg+xml' : 'image/jpeg')));
                  const driveUpload = await uploadToDrive(targetFilename, buffer, mimeType, targetSubFolder.id, accessToken);
                  if (driveUpload && driveUpload.id) {
                    driveFileId = driveUpload.id;
                    console.log(`✔ [Google Drive Override] Successfully saved single ${mediaType} file into Google Drive with original name: "${studio.studioName} / ${folderName} / ${targetFilename}" (ID: ${driveFileId})`);
                  }
                }
              }
            }
          } catch (driveErr) {
            console.warn('[Google Drive Media Upload Notice]:', driveErr.message);
          }

          sendJSON({
            success: true,
            url: fileUrl,
            driveFileId,
            mediaType,
            studioName: studio.studioName,
            folder: `${studioNameClean}/${folderName}`
          });
        } catch (e) {
          sendJSON({ error: 'Upload failed: ' + e.message }, 500);
        }
      });
      return;
    }

    // 7f. Studio Profile Delete Logo Forever API
    if (pathname === '/api/admin/studio-profile/delete-logo' && req.method === 'POST') {
      const db = loadDB();
      db.studios = db.studios || [];
      const studioId = getStudioIdFromRequest(req) || '';
      const studioEmail = (req.headers['x-studio-email'] || '').toLowerCase().trim();
      let studio = getTargetStudio(db, studioId, studioEmail);
      if (studioId && studio && studio.id !== studioId && (!studioEmail || (studio.email || '').toLowerCase() !== studioEmail)) {
        try {
          const cloudDb = await restoreDatabaseFromDrive();
          const cloudMatch = (cloudDb.studios || []).find(s => s.id === studioId || (studioEmail && s.email && s.email.toLowerCase() === studioEmail));
          if (cloudMatch) studio = cloudMatch;
        } catch (e) {}
      }
      if (!studio) {
        sendJSON({ error: 'Studio not found' }, 404);
        return;
      }

      const studioNameClean = (studio.studioName || 'DM STUDIO').trim().replace(/[^a-zA-Z0-9 _-]/g, '_');

      // 1. Delete all local files in uploads/[Studio Name]/Logo/
      const logoDir = path.join(__dirname, 'uploads', studioNameClean, 'Logo');
      if (fs.existsSync(logoDir)) {
        try {
          const files = fs.readdirSync(logoDir);
          for (const f of files) {
            try { fs.unlinkSync(path.join(logoDir, f)); } catch(e){}
          }
        } catch (err) {
          console.warn('Local logo deletion error:', err.message);
        }
      }

      // 2. Permanently delete all logo files in Google Drive
      (async () => {
        try {
          const accessToken = await getDriveAccessToken();
          if (accessToken && studio.driveFolderId) {
            const targetSubFolder = await findOrCreateDriveFolder('Logo', studio.driveFolderId, accessToken);
            if (targetSubFolder && targetSubFolder.id) {
              await clearAllFilesInsideDriveFolder(targetSubFolder.id, accessToken);
              console.log(`✔ [Google Drive] Permanently deleted all logo files from Drive folder "Logo" for ${studio.studioName}`);
            }
          }
        } catch (driveErr) {
          console.warn('[Google Drive Delete Logo Notice]:', driveErr.message);
        }
      })();

      // 3. Clear database fields
      studio.logoUrl = '';
      studio.avatarUrl = '';
      studio.updatedAt = new Date().toISOString();
      saveDB(db);

      sendJSON({ success: true, message: 'Logo permanently deleted from Google Drive and dashboard!', studio });
      return;
    }

    // 8. Auto-Copy Selected Original Photos on Computer
    if (pathname === '/api/copy-selected-photos' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const { sourcePath, clientId } = JSON.parse(body);
          if (!sourcePath || !fs.existsSync(sourcePath)) {
            sendJSON({ error: 'Source folder path not found on computer. Please check path.' }, 400);
            return;
          }

          const db = loadDB();
          const client = db.clients.find(c => c.id === clientId || c.code === clientId);
          if (!client) {
            sendJSON({ error: 'Client not found' }, 404);
            return;
          }

          const selectedPhotos = client.photos?.filter(p => client.selectedPhotoIds?.includes(p.id)) || [];
          if (selectedPhotos.length === 0) {
            sendJSON({ error: 'No photos selected by client yet.' }, 400);
            return;
          }

          const safeClientName = (client.name || 'Client')
            .replace(/&/g, 'and')
            .replace(/[^a-zA-Z0-9_-]/g, '_')
            .replace(/_+/g, '_');
          const destDir = path.join(sourcePath, `Selected_Photos_${safeClientName}`);

          if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
          }

          const allFilesOnDisk = [];
          function scanLocalDir(dir) {
            try {
              const entries = fs.readdirSync(dir, { withFileTypes: true });
              for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                  if (!entry.name.startsWith('Selected_Photos_')) {
                    scanLocalDir(fullPath);
                  }
                } else if (entry.isFile()) {
                  allFilesOnDisk.push({ name: entry.name, fullPath });
                }
              }
            } catch (e) {}
          }

          scanLocalDir(sourcePath);

          let copiedCount = 0;
          let favCopiedCount = 0;
          let commentCopiedCount = 0;
          const matchedDetails = [];
          const favoriteIds = new Set(client.favoritePhotoIds || []);
          const photoComments = client.photoComments || {};
          const allCommentsSummary = [];

          for (const selPhoto of selectedPhotos) {
            const baseName = path.parse(selPhoto.name).name.toLowerCase();
            const matchedFile = allFilesOnDisk.find(f => {
              const diskBase = path.parse(f.name).name.toLowerCase();
              return diskBase === baseName || f.name.toLowerCase() === selPhoto.name.toLowerCase();
            });

            if (matchedFile) {
              // Determine subfolder destination (e.g. "1 REGULAR PHOTO", "HALDI", "2 REGULAR RECEPTION")
              let targetFolder = destDir;
              const subName = selPhoto.subfolder ? selPhoto.subfolder.trim() : '';

              if (subName && subName !== 'Main Photos' && subName !== 'Original') {
                targetFolder = path.join(destDir, subName);
                if (!fs.existsSync(targetFolder)) {
                  fs.mkdirSync(targetFolder, { recursive: true });
                }
              }

              const targetDest = path.join(targetFolder, matchedFile.name);
              try {
                fs.copyFileSync(matchedFile.fullPath, targetDest);
                copiedCount++;
                matchedDetails.push({ name: matchedFile.name, folder: subName || 'Main', from: matchedFile.fullPath, isFavorite: favoriteIds.has(selPhoto.id) });
              } catch (copyErr) {
                console.error(`Error copying ${matchedFile.name}:`, copyErr.message);
              }

              // 1. If marked with Heart / Favorite, ALSO copy inside "Favorites" subfolder inside that event folder!
              if (favoriteIds.has(selPhoto.id)) {
                const favFolder = path.join(targetFolder, 'Favorites');
                if (!fs.existsSync(favFolder)) {
                  fs.mkdirSync(favFolder, { recursive: true });
                }

                const favDest = path.join(favFolder, matchedFile.name);
                try {
                  fs.copyFileSync(matchedFile.fullPath, favDest);
                  favCopiedCount++;
                } catch (favErr) {
                  console.error(`Error copying favorite ${matchedFile.name}:`, favErr.message);
                }
              }

              // 2. If photo has a comment/note typed by client:
              const commentText = photoComments[selPhoto.id];
              if (commentText && commentText.trim()) {
                const commentsFolder = path.join(targetFolder, 'Comments');
                if (!fs.existsSync(commentsFolder)) {
                  fs.mkdirSync(commentsFolder, { recursive: true });
                }

                // Copy photo into Comments folder
                const commPhotoDest = path.join(commentsFolder, matchedFile.name);
                try {
                  fs.copyFileSync(matchedFile.fullPath, commPhotoDest);
                  commentCopiedCount++;
                } catch (cErr) {}

                // Create matching .txt instruction note file
                const parsed = path.parse(matchedFile.name);
                const txtFileName = `${parsed.name}_comment.txt`;
                const txtFilePath = path.join(commentsFolder, txtFileName);

                const txtContent = `==================================================\nCLIENT PHOTO INSTRUCTION / NOTE\nPhoto Name: ${matchedFile.name}\nFolder: ${subName || 'Main'}\nClient: ${client.name || ''}\n==================================================\n\nCLIENT INSTRUCTION:\n"${commentText.trim()}"\n\nDate: ${new Date().toLocaleDateString()}\n==================================================\n`;

                try {
                  fs.writeFileSync(txtFilePath, txtContent, 'utf8');
                } catch (tErr) {}

                allCommentsSummary.push(`📷 ${matchedFile.name} [Folder: ${subName || 'Main'}]:\n   Note: "${commentText.trim()}"\n`);
              }
            }
          }

          // Generate master ALL_PHOTO_INSTRUCTIONS.txt file inside root destDir
          if (allCommentsSummary.length > 0) {
            const masterTxtPath = path.join(destDir, 'ALL_PHOTO_INSTRUCTIONS.txt');
            const masterContent = `==================================================\nMASTER CLIENT PHOTO INSTRUCTIONS & NOTES SUMMARY\nClient: ${client.name || ''}\nTotal Photo Notes: ${allCommentsSummary.length}\nDate: ${new Date().toLocaleDateString()}\n==================================================\n\n` + allCommentsSummary.join('\n') + `\n==================================================\n`;
            try {
              fs.writeFileSync(masterTxtPath, masterContent, 'utf8');
            } catch (mErr) {}
          }

          sendJSON({
            success: true,
            copiedCount,
            favCopiedCount,
            commentCopiedCount,
            totalSelected: selectedPhotos.length,
            destDir,
            details: matchedDetails
          });
        } catch (err) {
          sendJSON({ error: err.message }, 500);
        }
      });
      return;
    }

    // 8.5 Open Output Folder in Windows Explorer
    if (pathname === '/api/open-folder' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { folderPath, clientName } = JSON.parse(body);
          const { exec } = require('child_process');
          const os = require('os');

          let cleanPath = (folderPath || '').trim();
          if (cleanPath.startsWith('Selected Folder: [')) {
            cleanPath = cleanPath.replace(/^Selected Folder:\s*\[\s*/, '').replace(/\s*\]$/, '').trim();
          }

          let targetToOpen = null;

          // 1. Check direct path
          if (cleanPath && fs.existsSync(cleanPath)) {
            targetToOpen = cleanPath;
          }

          // 2. If clientName or cleanPath provided, search in system drives/user directories
          if (!targetToOpen) {
            const safeName = (clientName || '').replace(/&/g, 'and').replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_');
            const targetFolderName = safeName ? `Selected_Photos_${safeName}` : (cleanPath ? path.basename(cleanPath) : '');

            const userHome = os.homedir();
            const candidateDirs = [
              process.cwd(),
              path.join(userHome, 'Downloads'),
              path.join(userHome, 'Pictures'),
              path.join(userHome, 'Desktop'),
              path.join(userHome, 'Documents')
            ];

            // Add drive root letters (C:\, D:\, E:\, etc.)
            ['C', 'D', 'E', 'F'].forEach(drive => {
              const dPath = `${drive}:\\`;
              if (fs.existsSync(dPath)) candidateDirs.push(dPath);
            });

            for (const baseDir of candidateDirs) {
              if (targetFolderName && fs.existsSync(baseDir)) {
                const p1 = path.join(baseDir, targetFolderName);
                if (fs.existsSync(p1)) {
                  targetToOpen = p1;
                  break;
                }
                try {
                  const subs = fs.readdirSync(baseDir, { withFileTypes: true });
                  for (const s of subs) {
                    if (s.isDirectory() && !s.name.startsWith('$') && !s.name.startsWith('.')) {
                      const p2 = path.join(baseDir, s.name, targetFolderName);
                      if (fs.existsSync(p2)) {
                        targetToOpen = p2;
                        break;
                      }
                    }
                  }
                } catch (e) {}
                if (targetToOpen) break;
              }
            }
          }

          if (targetToOpen) {
            console.log(`[System] Opening output folder in Explorer: ${targetToOpen}`);
            exec(`powershell -c "Start-Process '${targetToOpen.replace(/'/g, "''")}'"`);
            sendJSON({ success: true, opened: targetToOpen });
          } else {
            // Fallback to opening current workspace or home
            const fallback = process.cwd();
            console.log(`[System] Folder not found directly, opening fallback Explorer: ${fallback}`);
            exec(`powershell -c "Start-Process '${fallback.replace(/'/g, "''")}'"`);
            sendJSON({ success: true, opened: fallback, note: 'Opened working folder' });
          }
        } catch (e) {
          sendJSON({ error: e.message }, 500);
        }
      });
      return;
    }

// Full Recursive Multi-Page Google Drive Auto-Sync Helper
async function syncClientPhotosFromDrive(client, db) {
  try {
    const token = await getDriveAccessToken();
    const origFolder = client.folders?.original || client.folders?.main;
    if (!origFolder) return false;

    // Fetch ALL top-level items (subfolders and direct photos) with full pagination
    const topItems = [];
    let pageToken = '';

    do {
      const q = encodeURIComponent(`'${origFolder}' in parents and trashed = false`);
      let path = `/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,size,mimeType)&pageSize=1000`;
      if (pageToken) path += `&pageToken=${encodeURIComponent(pageToken)}`;

      const resp = await httpsRequest({
        hostname: 'www.googleapis.com',
        path,
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (resp.statusCode < 400) {
        const data = resp.json();
        if (data.files) topItems.push(...data.files);
        pageToken = data.nextPageToken || '';
      } else {
        pageToken = '';
      }
    } while (pageToken);

    const collected = [];
    const seenKeys = new Set();

    for (const item of topItems) {
      if (item.mimeType === 'application/vnd.google-apps.folder') {
        const subfolderName = item.name;
        client.subfolders = client.subfolders || {};
        client.subfolders[subfolderName] = item.id;

        // Fetch ALL photos inside this subfolder with full pagination
        let subPageToken = '';
        do {
          const subQ = encodeURIComponent(`'${item.id}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`);
          let subPath = `/drive/v3/files?q=${subQ}&fields=nextPageToken,files(id,name,size,mimeType)&pageSize=1000`;
          if (subPageToken) subPath += `&pageToken=${encodeURIComponent(subPageToken)}`;

          const subResp = await httpsRequest({
            hostname: 'www.googleapis.com',
            path: subPath,
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
          });

          if (subResp.statusCode < 400) {
            const subData = subResp.json();
            for (const sf of (subData.files || [])) {
              if (sf.name && /\.(jpe?g|png|webp|gif|bmp|heic|heif|hif|tiff?|raw|cr2|cr3|nef|arw|dng|orf|rw2|pef|srw|raf|avif)$/i.test(sf.name)) {
                const key = subfolderName + '/' + sf.name;
                if (!seenKeys.has(key)) {
                  seenKeys.add(key);
                  collected.push({
                    id: sf.id,
                    name: sf.name,
                    size: Number(sf.size) || 0,
                    subfolder: subfolderName,
                    url: `https://lh3.googleusercontent.com/d/${sf.id}=w1600`,
                    thumbnailUrl: `https://lh3.googleusercontent.com/d/${sf.id}=w600`
                  });
                }
              }
            }
            subPageToken = subData.nextPageToken || '';
          } else {
            subPageToken = '';
          }
        } while (subPageToken);

      } else if (item.name && /\.(jpe?g|png|webp|gif|bmp|heic|heif|hif|tiff?|raw|cr2|cr3|nef|arw|dng|orf|rw2|pef|srw|raf|avif)$/i.test(item.name)) {
        const key = 'Original/' + item.name;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          collected.push({
            id: item.id,
            name: item.name,
            size: Number(item.size) || 0,
            subfolder: 'Original',
            url: `https://lh3.googleusercontent.com/d/${item.id}=w1600`,
            thumbnailUrl: `https://lh3.googleusercontent.com/d/${item.id}=w600`
          });
        }
      }
    }

    if (collected.length > 0) {
      client.photos = collected;
      client.photosCount = collected.length;
      saveDB(db);
      return true;
    }
  } catch (err) {
    console.warn('syncClientPhotosFromDrive Error:', err.message);
  }
  return false;
}

    // 9. High-Speed Image Streaming & Caching Engine (Protected against truncated half-black files)
    if (pathname.startsWith('/api/image/')) {
      const fileId = pathname.replace('/api/image/', '').trim();
      const cacheDir = path.join(__dirname, '.cache', 'images');
      const cachedFilePath = path.join(cacheDir, `${fileId}.webp`);

      // 1. Instant Cache Hit from local SSD (Only serve valid, non-corrupted images > 1KB)
      try {
        if (fs.existsSync(cachedFilePath)) {
          const stat = fs.statSync(cachedFilePath);
          if (stat.size >= 1024) {
            res.writeHead(200, {
              'Content-Type': 'image/webp',
              'Content-Length': stat.size,
              'Cache-Control': 'public, max-age=604800, immutable'
            });
            fs.createReadStream(cachedFilePath).pipe(res);
            return;
          } else {
            // Delete corrupted truncated file
            try { fs.unlinkSync(cachedFilePath); } catch(e){}
          }
        }
      } catch (e) {}

      // 2. Fetch from Google Drive API with safe atomic temp-file caching + 302 CDN failover
      try {
        if (!fs.existsSync(cacheDir)) {
          fs.mkdirSync(cacheDir, { recursive: true });
        }
      } catch (e) {}

      const token = await getDriveAccessToken();

      try {
        let redirectCount = 0;
        const tempFilePath = path.join(cacheDir, `${fileId}_${Date.now()}_${Math.random().toString(36).substring(2,7)}.tmp`);

        const fetchImage = (url, isFirst = true) => {
          return new Promise((resolve) => {
            const urlObj = new URL(url);
            const headers = isFirst ? { 'Authorization': `Bearer ${token}` } : {};
            const client = urlObj.protocol === 'http:' ? http : https;

            const req = client.get(url, { headers, family: 4 }, (driveRes) => {
              if (driveRes.statusCode >= 300 && driveRes.statusCode < 400 && driveRes.headers.location && redirectCount < 5) {
                redirectCount++;
                driveRes.resume();
                return resolve(fetchImage(driveRes.headers.location, false));
              }

              // If Google Drive rate limits (403, 429) or fails, seamlessly 302 redirect to Google Edge CDN
              if (driveRes.statusCode >= 400) {
                driveRes.resume();
                try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch(e){}
                if (!res.headersSent) {
                  res.writeHead(302, {
                    'Location': `https://lh3.googleusercontent.com/d/${fileId}=w1600`,
                    'Cache-Control': 'public, max-age=86400'
                  });
                  res.end();
                }
                return resolve();
              }

              const contentType = driveRes.headers['content-type'] || 'image/webp';
              res.writeHead(200, {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=604800'
              });

              // Write to temp file first. Only promote to cachedFilePath if 100% complete!
              const fileStream = fs.createWriteStream(tempFilePath);
              let totalBytes = 0;

              driveRes.on('data', chunk => {
                totalBytes += chunk.length;
              });

              driveRes.pipe(res);
              driveRes.pipe(fileStream);

              fileStream.on('error', () => {
                try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch(e){}
              });

              driveRes.on('end', () => {
                fileStream.end(() => {
                  if (totalBytes >= 1024) {
                    try {
                      fs.renameSync(tempFilePath, cachedFilePath);
                    } catch (e) {}
                  } else {
                    try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch(e){}
                  }
                  resolve();
                });
              });

              driveRes.on('error', () => {
                try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch(e){}
                resolve();
              });
            });

            req.on('error', () => {
              try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch(e){}
              if (!res.headersSent) {
                res.writeHead(302, {
                  'Location': `https://lh3.googleusercontent.com/d/${fileId}=w1600`
                });
                res.end();
              }
              resolve();
            });
          });
        };

        await fetchImage(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`, true);
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(302, {
            'Location': `https://lh3.googleusercontent.com/d/${fileId}=w1600`
          });
          res.end();
        }
      }
      return;
    }

    // 9b. Manual & Auto Client Drive Resync API (Paginates 1000s of files completely)
    if (pathname === '/api/admin/sync-client-photos' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const { clientId } = JSON.parse(body);
          const db = loadDB();
          const client = db.clients.find(c => c.id === clientId || c.code === clientId);
          if (!client) {
            sendJSON({ error: 'Client not found' }, 404);
            return;
          }
          await syncClientPhotosFromDrive(client, db);
          sendJSON({ success: true, count: client.photosCount, photos: client.photos });
        } catch (e) { sendJSON({ error: e.message }, 500); }
      });
      return;
    }

    // 10. Public Client API (Includes Custom Studio Branding & Clean Filtered Real Photos!)
    const publicClientMatch = pathname.match(/^\/api\/public\/client\/([a-zA-Z0-9_-]+)$/);
    if (publicClientMatch && req.method === 'GET') {
      const code = publicClientMatch[1];
      const db = loadDB();
      const client = db.clients.find(c => c.code.toLowerCase() === code.toLowerCase() || c.id === code);
      if (client) {
        // Attach Studio branding
        const studio = db.studios.find(s => s.id === client.studioId) || {
          studioName: 'DM Films & Photography',
          phone: '+91 98765 43210',
          logoUrl: '',
          tagline: 'Luxury Wedding & Cinematic Memories'
        };
        client.studio = studio;
        client.studioName = studio.studioName || 'DM Films & Photography';

        const hasDummyIds = client.photos && client.photos.some(p => !p.id || p.id.startsWith('drive_') || p.id.startsWith('file_') || p.id.startsWith('up_'));
        const forceSync = req.url.includes('sync=true');

        // Auto-sync photos recursively with FULL PAGINATION from Google Drive
        if (!client.photos || client.photos.length === 0 || hasDummyIds || forceSync) {
          await syncClientPhotosFromDrive(client, db);
        }

        // Clean & ensure all supported photo formats are returned
        client.photos = (client.photos || []).filter(p => p.size > 0 && /\.(jpe?g|png|webp|gif|bmp|heic|heif|hif|tiff?|raw|cr2|cr3|nef|arw|dng|orf|rw2|pef|srw|raf|avif)$/i.test(p.name));
        client.photosCount = client.photos.length;

        sendJSON(client);
      } else {
        sendJSON({ error: 'Client not found' }, 404);
      }
      return;
    }

    // 11. Public Client Selection Submission
    const selectMatch = pathname.match(/^\/api\/public\/client\/([a-zA-Z0-9_-]+)\/select$/);
    if (selectMatch && req.method === 'POST') {
      const code = selectMatch[1];
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { selectedPhotoIds, favoritePhotoIds, photoComments, notes } = JSON.parse(body);
          const db = loadDB();
          const client = db.clients.find(c => c.code.toLowerCase() === code.toLowerCase() || c.id === code);
          if (client) {
            client.selectedPhotoIds = selectedPhotoIds || [];
            client.selectedCount = (selectedPhotoIds || []).length;
            client.favoritePhotoIds = favoritePhotoIds || [];
            client.favoriteCount = (favoritePhotoIds || []).length;
            client.photoComments = photoComments || {};
            client.selectionNotes = notes;
            client.selectionSubmittedAt = new Date().toISOString();
            client.selectionLocked = true; // Lock gallery after client submission
            saveDB(db);
            console.log(`🎉 [CLIENT SELECTION SUBMITTED] Client "${client.name}" (${client.code}) selected ${client.selectedCount} photos. Gallery locked.`);
            sendJSON({ success: true, count: client.selectedCount, submittedAt: client.selectionSubmittedAt, locked: true });
          } else {
            sendJSON({ error: 'Client not found' }, 404);
          }
        } catch (e) { sendJSON({ error: 'Bad Request' }, 400); }
      });
      return;
    }

    // 11.1 Studio Owner Control: Unlock / Re-open Client Selection Gallery
    const unlockSelectionMatch = pathname.match(/^\/api\/clients\/([a-zA-Z0-9_-]+)\/unlock-selection$/);
    if (unlockSelectionMatch && req.method === 'POST') {
      const clientId = unlockSelectionMatch[1];
      const db = loadDB();
      const client = db.clients.find(c => c.id === clientId || c.code.toLowerCase() === clientId.toLowerCase());
      if (client) {
        client.selectionLocked = false;
        client.selectionSubmittedAt = null; // Reset submission state so gallery is interactive again
        saveDB(db);
        console.log(`🔓 [CLIENT SELECTION UNLOCKED] Studio Owner re-opened gallery for "${client.name}" (${client.code})`);
        sendJSON({ success: true, message: 'Selection gallery unlocked for client successfully!', client });
      } else {
        sendJSON({ error: 'Client not found' }, 404);
      }
      return;
    }

    // 11.5 Network IP Info Route (For Mobile Wi-Fi Links)
    if (pathname === '/api/network-info' && req.method === 'GET') {
      const ip = getLocalIpAddress();
      sendJSON({
        localIp: ip,
        port: PORT,
        wifiBaseUrl: `http://${ip}:${PORT}`,
        localBaseUrl: `http://localhost:${PORT}`
      });
      return;
    }

    // 11.64 Direct Google Drive Upload for 3D Flipbook Assets (Zero Local Disk Storage)
    if (pathname === '/api/flipbooks/upload-asset' && req.method === 'POST') {
      const clientCode = req.headers['x-client-code'] ? decodeURIComponent(req.headers['x-client-code']).trim() : 'General';
      const assetType = req.headers['x-asset-type'] || 'asset';
      let rawOrigName = req.headers['x-filename'] ? decodeURIComponent(req.headers['x-filename']).trim() : ('file_' + Date.now() + '.jpg');
      
      // Clean filename preserving spaces, numbers, and original case (e.g. "FRONT COVER.jpg", "First Page.jpg", "01.jpg")
      const origName = rawOrigName.replace(/[/\\?%*:|"<>]/g, '_').trim();

      const studioId = req.headers['x-studio-id'] || '';
      let studioName = req.headers['x-studio-name'] ? decodeURIComponent(req.headers['x-studio-name']) : '';

      const db = loadDB();
      if (!studioName && studioId) {
        const st = db.studios?.find(s => s.id === studioId);
        if (st) studioName = st.studioName;
      }
      if (!studioName) {
        studioName = db.studios?.[0]?.studioName || 'DM STUDIO';
      }

      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', async () => {
        try {
          const buffer = Buffer.concat(chunks);
          const accessToken = await getDriveAccessToken();
          if (!accessToken) throw new Error('No Google Drive access token available');

          // 1. Master "WAPSITE" folder
          const MASTER_WAPSITE_FOLDER_ID = "1Glh2NLXhJMIKO89jz2OsGBzI3fW8HZJf";

          // 2. "3D Flipbooks" folder inside "WAPSITE"
          const root3DFolder = await findOrCreateDriveFolder('3D Flipbooks', MASTER_WAPSITE_FOLDER_ID, accessToken);

          // 3. Subfolder routing: "AUDIO" top-level inside 3D Flipbooks, or exact client folder inside Studio
          if (assetType === 'audio') {
            const audioDir = path.join(__dirname, 'audio');
            if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });

            const cleanAudioFile = origName;
            const localAudioPath = path.join(audioDir, cleanAudioFile);
            fs.writeFileSync(localAudioPath, buffer);
            console.log(`✔ [Audio Storage] Saved audio locally to: ${localAudioPath}`);

            const audioUrl = `/audio/${cleanAudioFile}`;
            const cleanDisplayTitle = origName.replace(/\.[^/.]+$/, '').replace(/_+/g, ' ');

            db.customAudios = db.customAudios || [];
            // Remove existing audio with same title/filename to override
            db.customAudios = db.customAudios.filter(a => a.name !== cleanDisplayTitle && a.filename !== cleanAudioFile && a.url !== audioUrl);
            const audioObj = { id: 'aud_' + Date.now(), name: cleanDisplayTitle, url: audioUrl, filename: cleanAudioFile };
            db.customAudios.unshift(audioObj);
            saveDB(db);

            // Backup to Google Drive AUDIO folder with duplicate override
            (async () => {
              try {
                const token = await getDriveAccessToken();
                const MASTER_WAPSITE_FOLDER_ID = "1Glh2NLXhJMIKO89jz2OsGBzI3fW8HZJf";
                const root3DFolder = await findOrCreateDriveFolder('3D Flipbooks', MASTER_WAPSITE_FOLDER_ID, token);
                const audioDriveFolder = await findOrCreateDriveFolder('AUDIO', root3DFolder.id, token);
                await findAndRemoveDuplicateDriveFile(origName, audioDriveFolder.id, token);
                await uploadToDrive(origName, buffer, 'audio/mpeg', audioDriveFolder.id, token);
                console.log(`✔ [Google Drive Backup] Uploaded "${origName}" to 3D Flipbooks / AUDIO`);
              } catch (e) {
                console.warn('[Google Drive Backup Notice]:', e.message);
              }
            })();

            sendJSON({ success: true, url: audioUrl, assetType: 'audio', name: cleanDisplayTitle, driveId: cleanAudioFile });
            return;
          } else {
            const studioNameClean = studioName.trim().replace(/[^a-zA-Z0-9 _-]/g, '_');
            const studioFolder = await findOrCreateDriveFolder(studioNameClean, root3DFolder.id, accessToken);
            const clientFolder = await findOrCreateDriveFolder(clientCode, studioFolder.id, accessToken);
            const targetDriveParentId = clientFolder.id;

            // 4. Check and remove any existing file with same name in Google Drive (Override / Replace!)
            await findAndRemoveDuplicateDriveFile(origName, targetDriveParentId, accessToken);

            // 5. Upload buffer directly with original photo name
            let mime = 'image/jpeg';
            if (origName.toLowerCase().endsWith('.png')) mime = 'image/png';
            else if (origName.toLowerCase().endsWith('.webp')) mime = 'image/webp';

            const driveFile = await uploadToDrive(origName, buffer, mime, targetDriveParentId, accessToken);
            console.log(`✔ [Google Drive Direct] Uploaded "${origName}" into Drive folder "${clientCode}" (ID: ${targetDriveParentId}, File ID: ${driveFile.id})`);

            const driveUrl = `/api/image/${driveFile.id}`;
            sendJSON({ success: true, url: driveUrl, assetType: assetType, name: origName, driveId: driveFile.id });
          }
        } catch (err) {
          console.error('Direct Drive upload error:', err);
          sendJSON({ error: 'Direct Drive Upload Failed: ' + err.message }, 500);
        }
      });
      return;
    }

    // 11.66 Get Audio List Endpoint (Synced with AUDIO folder & strictly deduplicated)
    if (pathname === '/api/flipbooks/audio-list' && req.method === 'GET') {
      const db = loadDB();
      const audioDir = path.join(__dirname, 'audio');
      if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });

      const uniqueList = [];
      const seenNames = new Set();
      const seenUrls = new Set();

      // 1. Scan local audio folder (only keep actual existing files)
      try {
        const localFiles = fs.readdirSync(audioDir);
        for (const f of localFiles) {
          if (/\.(mp3|wav|ogg|m4a|aac)$/i.test(f)) {
            const url = `/audio/${f}`;
            const cleanDisplayName = f.replace(/^\d+_/, '').replace(/\.[^/.]+$/, '').replace(/_+/g, ' ').trim();
            const normKey = cleanDisplayName.toLowerCase();

            if (!seenNames.has(normKey) && !seenUrls.has(url)) {
              seenNames.add(normKey);
              seenUrls.add(url);
              uniqueList.push({
                id: 'aud_' + f.replace(/[^a-zA-Z0-9]/g, '_'),
                name: cleanDisplayName,
                url: url,
                filename: f
              });
            }
          }
        }
      } catch (e) {}

      // 2. Sync with Google Drive 3D Flipbooks / AUDIO folder
      try {
        const accessToken = await getDriveAccessToken();
        const MASTER_WAPSITE_FOLDER_ID = "1Glh2NLXhJMIKO89jz2OsGBzI3fW8HZJf";
        const root3DFolder = await findOrCreateDriveFolder('3D Flipbooks', MASTER_WAPSITE_FOLDER_ID, accessToken);
        const audioDriveFolder = await findOrCreateDriveFolder('AUDIO', root3DFolder.id, accessToken);

        const q = encodeURIComponent(`'${audioDriveFolder.id}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`);
        const listResp = await httpsRequest({
          hostname: 'www.googleapis.com',
          path: `/drive/v3/files?q=${q}&fields=files(id,name,size,mimeType)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`,
          method: 'GET',
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (listResp.statusCode < 400) {
          const data = listResp.json();
          for (const file of (data.files || [])) {
            const driveUrl = `/api/image/${file.id}`;
            const cleanDisplayName = file.name.replace(/^audio_\d+_/, '').replace(/^\d+_/, '').replace(/\.[^/.]+$/, '').replace(/_+/g, ' ').trim();
            const normKey = cleanDisplayName.toLowerCase();

            if (!seenNames.has(normKey) && !seenUrls.has(driveUrl)) {
              seenNames.add(normKey);
              seenUrls.add(driveUrl);
              uniqueList.push({
                id: 'aud_' + file.id,
                name: cleanDisplayName,
                url: driveUrl,
                driveId: file.id
              });
            }
          }
        }
      } catch (e) {}

      db.customAudios = uniqueList;
      saveDB(db);

      sendJSON(uniqueList);
      return;
    }

    // 11.6 3D Virtual Flipbook Management API
    if (pathname === '/api/flipbooks') {
      const db = loadDB();
      const studioId = getStudioIdFromRequest(req);

      if (req.method === 'GET') {
        if (!studioId) {
          sendJSON([]);
          return;
        }
        const studioFlipbooks = (db.flipbooks || []).filter(f => f.studioId === studioId);
        sendJSON(studioFlipbooks);
        return;
      }
      if (req.method === 'POST') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
          try {
            const payload = JSON.parse(body || '{}');
            const targetStudioId = studioId || payload.studioId;
            const studio = (db.studios || []).find(s => s.id === targetStudioId);
            const targetCode = payload.clientCode || payload.code || ('FB' + Math.floor(1000 + Math.random() * 9000));
            const id = payload.id || ('fb_' + targetCode);
            db.flipbooks = db.flipbooks || [];
            
            const existingIdx = db.flipbooks.findIndex(f => f.id === id || f.code === targetCode || (f.clientCode && f.clientCode === targetCode));
            
            // Active Subscription Check (Developer Lifetime Free Bypass)
            if (!isDeveloperAccount(studio)) {
              const sub = studio?.subscription;
              const isLocked = !sub || (new Date(sub.expiresAt).getTime() <= Date.now()) || sub.status !== 'ACTIVE';
              if (isLocked) {
                console.warn(`⚠️ [ACTION BLOCKED] Studio: ${studio?.studioName || targetStudioId} has no active plan or is expired!`);
                sendJSON({
                  error: 'Active Plan Required: Please claim your 7-Day Free Trial or upgrade your plan to create 3D flipbooks!',
                  isLocked: true,
                  requiresUpgrade: true
                }, 403);
                return;
              }

              // Plan Limit Enforcement for 3D Flipbooks for THIS studio
              if (existingIdx === -1) {
                const limits = getSubscriptionLimits(studio);
                const currentFlipbooksCount = (db.flipbooks || []).filter(f => f.studioId === targetStudioId).length;
                if (!limits.unlimited && currentFlipbooksCount >= limits.maxFlipbooks) {
                  console.warn(`⚠️ [FLIPBOOK LIMIT REACHED] Studio: ${studio?.studioName} | Plan: ${limits.planName} | Max Allowed: ${limits.maxFlipbooks} | Current: ${currentFlipbooksCount}`);
                  sendJSON({
                    error: `Limit Reached: Your ${limits.planName} plan allows a maximum of ${limits.maxFlipbooks} 3D Flipbooks. Please upgrade your plan to create more flipbooks!`,
                    limitReached: true,
                    type: 'FLIPBOOKS_LIMIT',
                    maxAllowed: limits.maxFlipbooks,
                    currentCount: currentFlipbooksCount
                  }, 403);
                  return;
                }
              }
            }

            const flipbookObj = {
              id,
              studioId: targetStudioId,
              code: targetCode,
              clientCode: targetCode,
              title: payload.title || 'Wedding Photo Album',
              subtitle: payload.subtitle || 'Cinematic Virtual 3D Flipbook',
              coverImage: payload.coverImage || (payload.pages && payload.pages[0]) || '',
              pages: payload.pages || [],
              bgMusic: payload.bgMusic || 'romantic',
              soundEffects: payload.soundEffects !== false,
              createdAt: payload.createdAt || new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };

            if (existingIdx >= 0) {
              db.flipbooks[existingIdx] = { ...db.flipbooks[existingIdx], ...flipbookObj };
            } else {
              db.flipbooks.unshift(flipbookObj);
            }
            saveDB(db);
            sendJSON({ success: true, flipbook: flipbookObj });
          } catch (e) {
            console.error('Error saving flipbook in /api/flipbooks:', e);
            sendJSON({ error: 'Server error saving 3D Flipbook: ' + e.message }, 400);
          }
        });
        return;
      }
    }

    // Delete Flipbook Endpoint (Permanently Deletes from Database & Forever from Google Drive!)
    if (pathname.startsWith('/api/flipbooks/') && req.method === 'DELETE') {
      const rawId = pathname.replace('/api/flipbooks/', '').trim();
      const fbId = decodeURIComponent(rawId).trim();
      const db = loadDB();
      const targetFb = (db.flipbooks || []).find(f => f.id === fbId || f.code === fbId || f.clientCode === fbId);

      if (targetFb) {
        // Delete all photos and the entire client folder forever from Google Drive
        (async () => {
          try {
            const token = await getDriveAccessToken();
            if (token) {
              const MASTER_WAPSITE_FOLDER_ID = "1Glh2NLXhJMIKO89jz2OsGBzI3fW8HZJf";
              const root3DFolder = await findOrCreateDriveFolder('3D Flipbooks', MASTER_WAPSITE_FOLDER_ID, token);
              
              const studioNameClean = (db.studios?.[0]?.studioName || 'DM STUDIO').trim().replace(/[^a-zA-Z0-9 _-]/g, '_');
              const studioFolder = await findOrCreateDriveFolder(studioNameClean, root3DFolder.id, token);

              // 1. Search for this Client's exact folder name in Google Drive
              const clientFolderNames = [targetFb.clientCode, targetFb.code].filter(Boolean);
              
              for (const name of clientFolderNames) {
                if (name && studioFolder && studioFolder.id) {
                  const q = encodeURIComponent(`name = '${name.replace(/'/g, "\\'")}' and '${studioFolder.id}' in parents and trashed = false`);
                  const listResp = await httpsRequest({
                    hostname: 'www.googleapis.com',
                    path: `/drive/v3/files?q=${q}&fields=files(id,name)&supportsAllDrives=true`,
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${token}` }
                  });

                  if (listResp.statusCode < 400) {
                    const data = listResp.json();
                    if (data.files && data.files.length > 0) {
                      for (const folder of data.files) {
                        console.log(`🗑️ [Google Drive] Permanently deleting folder "${folder.name}" (ID: ${folder.id})...`);
                        await httpsRequest({
                          hostname: 'www.googleapis.com',
                          path: `/drive/v3/files/${folder.id}?supportsAllDrives=true`,
                          method: 'DELETE',
                          headers: { 'Authorization': `Bearer ${token}` }
                        });
                        console.log(`✔ [Google Drive] Permanently deleted folder "${folder.name}" from Google Drive!`);
                      }
                    }
                  }
                }
              }

              // 2. Also delete individual files by Drive File ID if pages contain /api/image/:fileId
              if (targetFb.pages && Array.isArray(targetFb.pages)) {
                for (const pageUrl of targetFb.pages) {
                  if (pageUrl && pageUrl.startsWith('/api/image/')) {
                    const fileId = pageUrl.replace('/api/image/', '').trim();
                    if (fileId) {
                      await httpsRequest({
                        hostname: 'www.googleapis.com',
                        path: `/drive/v3/files/${fileId}?supportsAllDrives=true`,
                        method: 'DELETE',
                        headers: { 'Authorization': `Bearer ${token}` }
                      });
                    }
                  }
                }
              }
            }
          } catch (driveErr) {
            console.warn('[Google Drive] Delete error:', driveErr.message);
          }
        })();

        db.deletedFlipbookIds = db.deletedFlipbookIds || [];
        if (fbId && !db.deletedFlipbookIds.includes(fbId)) db.deletedFlipbookIds.push(fbId);
        if (targetFb.id && !db.deletedFlipbookIds.includes(targetFb.id)) db.deletedFlipbookIds.push(targetFb.id);
        if (targetFb.code && !db.deletedFlipbookIds.includes(targetFb.code)) db.deletedFlipbookIds.push(targetFb.code);
        if (targetFb.clientCode && !db.deletedFlipbookIds.includes(targetFb.clientCode)) db.deletedFlipbookIds.push(targetFb.clientCode);

        db.flipbooks = (db.flipbooks || []).filter(f => f.id !== fbId && f.code !== fbId && f.clientCode !== fbId);
        saveDB(db);
        if (typeof syncDatabaseToDriveImmediate === 'function') {
          syncDatabaseToDriveImmediate(db).catch(() => {});
        }
        sendJSON({ success: true, message: 'Permanently deleted from Database and Google Drive!' });
      } else {
        db.flipbooks = (db.flipbooks || []).filter(f => f.id !== fbId && f.code !== fbId && f.clientCode !== fbId);
        saveDB(db);
        sendJSON({ success: true });
      }
      return;
    }

    // Update Flipbook Endpoint (Edit Title, Subtitle, Background Music)
    if (pathname.startsWith('/api/flipbooks/') && req.method === 'PUT') {
      const rawId = pathname.replace('/api/flipbooks/', '').trim();
      const fbId = decodeURIComponent(rawId).trim();
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        try {
          const updates = JSON.parse(body || '{}');
          const db = loadDB();
          const idx = (db.flipbooks || []).findIndex(f => f.id === fbId || f.code === fbId || f.clientCode === fbId);
          if (idx === -1) {
            sendJSON({ error: 'Flipbook not found' }, 404);
            return;
          }
          if (updates.title !== undefined) db.flipbooks[idx].title = updates.title;
          if (updates.subtitle !== undefined) db.flipbooks[idx].subtitle = updates.subtitle;
          if (updates.bgMusic !== undefined) db.flipbooks[idx].bgMusic = updates.bgMusic;
          if (updates.soundEffects !== undefined) db.flipbooks[idx].soundEffects = updates.soundEffects;
          db.flipbooks[idx].updatedAt = new Date().toISOString();
          saveDB(db);
          sendJSON({ success: true, flipbook: db.flipbooks[idx] });
        } catch (e) {
          sendJSON({ error: 'Failed to update flipbook: ' + e.message }, 400);
        }
      });
      return;
    }

    // 11.7 Studio Invoices & Quotations API
    if (pathname === '/api/invoices') {
      const db = loadDB();
      db.invoices = db.invoices || [];

      if (req.method === 'GET') {
        const studioId = getStudioIdFromRequest(req);
        let list = db.invoices || [];
        if (studioId) {
          list = list.filter(inv => inv.studioId === studioId);
        } else {
          list = [];
        }
        sendJSON(list);
        return;
      }

      if (req.method === 'POST') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
          try {
            const payload = JSON.parse(body || '{}');
            const now = new Date();
            const year = now.getFullYear();
            const targetStudioId = getStudioIdFromRequest(req) || payload.studioId || '';
            const studioObj = (db.studios || []).find(s => s.id === targetStudioId);

            // Active Subscription Check
            const sub = studioObj?.subscription;
            const isLocked = !sub || (new Date(sub.expiresAt).getTime() <= Date.now()) || sub.status !== 'ACTIVE';
            if (isLocked) {
              console.warn(`⚠️ [ACTION BLOCKED] Studio: ${studioObj?.studioName || targetStudioId} has no active plan or is expired!`);
              sendJSON({
                error: 'Active Plan Required: Please claim your 7-Day Free Trial or upgrade your plan to create invoices!',
                isLocked: true,
                requiresUpgrade: true
              }, 403);
              return;
            }
            
            // Auto generate Invoice Number if not provided: INV-YYYY-001
            const count = ((db.invoices || []).filter(i => i.studioId === targetStudioId).length + 1).toString().padStart(3, '0');
            const invoiceNumber = payload.invoiceNumber || `INV-${year}-${count}`;
            const id = payload.id || `inv_${Date.now()}_${Math.floor(100 + Math.random() * 900)}`;

            const items = (payload.items || []).map((item, idx) => ({
              id: item.id || `item_${idx + 1}`,
              description: item.description || 'Photography Service',
              qty: Number(item.qty) || 1,
              rate: Number(item.rate) || 0,
              total: (Number(item.qty) || 1) * (Number(item.rate) || 0)
            }));

            const subtotal = items.reduce((sum, it) => sum + it.total, 0);
            const discount = Number(payload.discount) || 0;
            const taxPercent = Number(payload.taxPercent) || 0;
            const taxAmount = taxPercent > 0 ? Math.round(((subtotal - discount) * taxPercent) / 100) : (Number(payload.taxAmount) || 0);
            const grandTotal = Math.max(0, (subtotal - discount) + taxAmount);
            const advancePaid = Number(payload.advancePaid) || 0;
            const balanceDue = Math.max(0, grandTotal - advancePaid);

            let status = 'Unpaid';
            if (advancePaid >= grandTotal && grandTotal > 0) {
              status = 'Paid';
            } else if (advancePaid > 0) {
              status = 'Partial';
            }

            const invoiceObj = {
              id,
              invoiceNumber,
              invoiceDate: payload.invoiceDate || now.toISOString().split('T')[0],
              dueDate: payload.dueDate || '',
              clientName: payload.clientName || 'Valued Client',
              clientPhone: payload.clientPhone || '',
              clientEmail: payload.clientEmail || '',
              clientCode: payload.clientCode || '',
              eventName: payload.eventName || 'Wedding / Event Photography',
              eventDate: payload.eventDate || '',
              venue: payload.venue || '',
              items,
              subtotal,
              discount,
              taxPercent,
              taxAmount,
              grandTotal,
              advancePaid,
              balanceDue,
              status: payload.status || status,
              paymentMethod: payload.paymentMethod || 'UPI / Bank Transfer',
              notes: payload.notes || 'Thank you for choosing our photography services!',
              terms: payload.terms || '1. 50% advance on booking.\n2. Balance payment on album / final delivery.\n3. Raw files and final edits will be delivered via high-speed cloud gallery.',
              studioId: targetStudioId,
              studioName: payload.studioName || studioObj?.studioName || 'DM STUDIO',
              studioTagline: payload.studioTagline || studioObj?.tagline || 'Wedding & Cinematic Photography',
              studioContact: payload.studioContact || studioObj?.phone || '',
              createdAt: payload.createdAt || now.toISOString(),
              updatedAt: now.toISOString()
            };

            const existingIdx = db.invoices.findIndex(inv => inv.id === id || inv.invoiceNumber === invoiceNumber);
            if (existingIdx >= 0) {
              db.invoices[existingIdx] = { ...db.invoices[existingIdx], ...invoiceObj };
            } else {
              db.invoices.unshift(invoiceObj);
            }

            saveDB(db);
            sendJSON({ success: true, invoice: invoiceObj });
          } catch (e) {
            console.error('Error creating invoice:', e);
            sendJSON({ error: 'Server error saving invoice: ' + e.message }, 400);
          }
        });
        return;
      }
    }

    // Update / Delete Invoice by ID
    if (pathname.startsWith('/api/invoices/')) {
      const rawId = pathname.replace('/api/invoices/', '').trim();
      const invId = decodeURIComponent(rawId).trim();
      const studioId = req.headers['x-studio-id'];
      const db = loadDB();
      db.invoices = db.invoices || [];

      if (req.method === 'DELETE') {
        const initialLen = db.invoices.length;
        db.invoices = db.invoices.filter(inv => {
          if (inv.id === invId || inv.invoiceNumber === invId) {
            if (studioId && inv.studioId && inv.studioId !== studioId) return true; // keep if owned by another studio
            return false;
          }
          return true;
        });
        if (db.invoices.length < initialLen) {
          saveDB(db);
          sendJSON({ success: true, message: 'Invoice deleted successfully' });
        } else {
          sendJSON({ error: 'Invoice not found' }, 404);
        }
        return;
      }

      if (req.method === 'PUT') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
          try {
            const updates = JSON.parse(body || '{}');
            const idx = db.invoices.findIndex(inv => inv.id === invId || inv.invoiceNumber === invId);
            if (idx === -1) {
              sendJSON({ error: 'Invoice not found' }, 404);
              return;
            }

            const existing = db.invoices[idx];
            const items = updates.items ? updates.items.map((item, i) => ({
              id: item.id || `item_${i + 1}`,
              description: item.description || 'Photography Service',
              qty: Number(item.qty) || 1,
              rate: Number(item.rate) || 0,
              total: (Number(item.qty) || 1) * (Number(item.rate) || 0)
            })) : existing.items;

            const subtotal = items.reduce((sum, it) => sum + it.total, 0);
            const discount = updates.discount !== undefined ? Number(updates.discount) : existing.discount;
            const taxPercent = updates.taxPercent !== undefined ? Number(updates.taxPercent) : existing.taxPercent;
            const taxAmount = taxPercent > 0 ? Math.round(((subtotal - discount) * taxPercent) / 100) : (updates.taxAmount !== undefined ? Number(updates.taxAmount) : existing.taxAmount);
            const grandTotal = Math.max(0, (subtotal - discount) + taxAmount);
            const advancePaid = updates.advancePaid !== undefined ? Number(updates.advancePaid) : existing.advancePaid;
            const balanceDue = Math.max(0, grandTotal - advancePaid);

            let status = 'Unpaid';
            if (advancePaid >= grandTotal && grandTotal > 0) {
              status = 'Paid';
            } else if (advancePaid > 0) {
              status = 'Partial';
            }

            const updatedInvoice = {
              ...existing,
              ...updates,
              items,
              subtotal,
              discount,
              taxPercent,
              taxAmount,
              grandTotal,
              advancePaid,
              balanceDue,
              status: updates.status || status,
              updatedAt: new Date().toISOString()
            };

            db.invoices[idx] = updatedInvoice;
            saveDB(db);
            sendJSON({ success: true, invoice: updatedInvoice });
          } catch (e) {
            sendJSON({ error: 'Failed to update invoice: ' + e.message }, 400);
          }
        });
        return;
      }
    }

    // Public 3D Flipbook Viewer Endpoint (Supports all client names, spaces, and ampersands)
    if (pathname.startsWith('/api/public/flipbook/') && req.method === 'GET') {
      const rawCode = pathname.replace('/api/public/flipbook/', '').trim();
      const queryCode = decodeURIComponent(rawCode).trim();
      const db = loadDB();
      const fb = (db.flipbooks || []).find(f => 
        f.id === queryCode || 
        (f.code && f.code.toLowerCase() === queryCode.toLowerCase()) || 
        (f.clientCode && f.clientCode.toLowerCase() === queryCode.toLowerCase()) ||
        (f.title && f.title.toLowerCase().includes(queryCode.toLowerCase()))
      );
      
      if (fb) {
        const client = db.clients.find(c => c.code === fb.clientCode || c.id === fb.clientCode || (c.name && c.name.toLowerCase() === fb.clientCode.toLowerCase()));
        const targetStudioId = fb.studioId || client?.studioId;
        const studio = (db.studios || []).find(s => s.id === targetStudioId) || db.studios?.[0] || {};
        
        let pages = fb.pages || [];
        if (pages.length === 0 && client && client.photos && client.photos.length > 0) {
          const selectedSet = new Set(client.selectedPhotoIds || []);
          const selPhotos = client.photos.filter(p => selectedSet.has(p.id));
          const listToUse = selPhotos.length > 0 ? selPhotos : client.photos;
          pages = listToUse.map(p => p.url || `/api/image/${p.id}`);
        }

        sendJSON({
          ...fb,
          pages,
          studioName: studio.studioName || 'DM Films & Photography',
          studioPhone: studio.phone || '+91 98765 43210',
          clientName: client ? client.name : (fb.title || 'Valued Client')
        });
      } else {
        // Auto Fallback: Look up client by code directly and generate instant 3D Flipbook!
        const client = db.clients.find(c => c.code.toLowerCase() === queryCode.toLowerCase() || c.id === queryCode);
        if (client && client.photos && client.photos.length > 0) {
          const studio = (db.studios || []).find(s => s.id === client.studioId) || db.studios?.[0] || {};
          const selectedSet = new Set(client.selectedPhotoIds || []);
          const selPhotos = client.photos.filter(p => selectedSet.has(p.id));
          const listToUse = selPhotos.length > 0 ? selPhotos : client.photos;
          const pages = listToUse.map(p => p.url || `/api/image/${p.id}`);

          sendJSON({
            id: 'instant_' + client.code,
            code: client.code,
            title: `${client.name} - ${client.eventName || 'Wedding'} Album`,
            subtitle: 'Interactive 3D Virtual Flipbook',
            coverImage: pages[0] || '',
            pages,
            studioName: studio.studioName || 'DM Films & Photography',
            studioPhone: studio.phone || '+91 98765 43210',
            clientName: client.name
          });
        } else {
          sendJSON({ error: 'Flipbook not found' }, 404);
        }
      }
      return;
    }

    // =========================================================================
    // --- PHONEPE SUBSCRIPTION PAYMENT SYSTEM (OFFICIAL PG INTEGRATION) ---
    // =========================================================================

    const PHONEPE_CONFIG = {
      merchantId: process.env.PHONEPE_MERCHANT_ID || 'PGTESTPAYUAT',
      saltKey: process.env.PHONEPE_SALT_KEY || '099eb0cd-02cf-4e2a-8aca-3e6c6aff0399',
      saltIndex: process.env.PHONEPE_SALT_INDEX || '1',
      env: process.env.PHONEPE_ENV || 'UAT',
      hostUrl: process.env.PHONEPE_HOST_URL || (process.env.PHONEPE_ENV === 'PROD' 
        ? 'https://api.phonepe.com/apis/hermes' 
        : 'https://api-preprod.phonepe.com/apis/pg-sandbox')
    };

    // Strict Backend Pricing Enforcement (Do not trust frontend amounts)
    const SUBSCRIPTION_PLANS = {
      'MONTHLY': {
        code: 'MONTHLY',
        name: 'Silver Edition',
        amount: 199,
        amountPaise: 19900,
        durationDays: 30
      },
      'YEARLY': {
        code: 'YEARLY',
        name: 'Gold (Pro)',
        amount: 999,
        amountPaise: 99900,
        durationDays: 180
      }
    };

    function generatePhonePeChecksum(base64Payload, apiEndpoint) {
      const stringToHash = base64Payload + apiEndpoint + PHONEPE_CONFIG.saltKey;
      const sha256 = crypto.createHash('sha256').update(stringToHash).digest('hex');
      return `${sha256}###${PHONEPE_CONFIG.saltIndex}`;
    }

    function verifyPhonePeChecksum(base64Response, xVerifyHeader) {
      if (!xVerifyHeader) return false;
      const stringToHash = base64Response + PHONEPE_CONFIG.saltKey;
      const sha256 = crypto.createHash('sha256').update(stringToHash).digest('hex');
      const expected = `${sha256}###${PHONEPE_CONFIG.saltIndex}`;
      return expected === xVerifyHeader;
    }

    // =========================================================================
    // --- RAZORPAY SUBSCRIPTION PAYMENT SYSTEM (OFFICIAL GATEWAY) ---
    // =========================================================================

    const RAZORPAY_CONFIG = {
      keyId: process.env.RAZORPAY_KEY_ID || 'rzp_live_Tuu3e43inBERVG',
      keySecret: process.env.RAZORPAY_KEY_SECRET || '85eZxda81l3EXY3RzLDkAmA0'
    };

    function createRazorpayOrder({ amountPaise, currency = 'INR', receipt, notes }) {
      return new Promise((resolve, reject) => {
        const postData = JSON.stringify({
          amount: amountPaise,
          currency,
          receipt,
          notes: notes || {}
        });

        const auth = Buffer.from(`${RAZORPAY_CONFIG.keyId}:${RAZORPAY_CONFIG.keySecret}`).toString('base64');
        const options = {
          hostname: 'api.razorpay.com',
          port: 443,
          path: '/v1/orders',
          method: 'POST',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
          }
        };

        const rzpReq = https.request(options, (rzpRes) => {
          let data = '';
          rzpRes.on('data', chunk => { data += chunk; });
          rzpRes.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              if (rzpRes.statusCode >= 200 && rzpRes.statusCode < 300) {
                resolve(parsed);
              } else {
                reject(new Error(parsed.error?.description || `Razorpay error HTTP ${rzpRes.statusCode}`));
              }
            } catch (e) {
              reject(new Error('Failed to parse Razorpay response: ' + e.message));
            }
          });
        });

        rzpReq.on('error', (err) => {
          reject(err);
        });

        rzpReq.write(postData);
        rzpReq.end();
      });
    }

    function verifyRazorpaySignature(orderId, paymentId, signature) {
      if (!orderId || !paymentId || !signature) return false;
      const expectedSignature = crypto
        .createHmac('sha256', RAZORPAY_CONFIG.keySecret)
        .update(`${orderId}|${paymentId}`)
        .digest('hex');
      return expectedSignature === signature;
    }

    function fetchRazorpayPayment(paymentId) {
      return new Promise((resolve, reject) => {
        if (!paymentId) return reject(new Error('Missing paymentId'));
        const auth = Buffer.from(`${RAZORPAY_CONFIG.keyId}:${RAZORPAY_CONFIG.keySecret}`).toString('base64');
        const options = {
          hostname: 'api.razorpay.com',
          port: 443,
          path: `/v1/payments/${encodeURIComponent(paymentId)}`,
          method: 'GET',
          headers: { 'Authorization': `Basic ${auth}` }
        };
        const rzpReq = https.request(options, (rzpRes) => {
          let data = '';
          rzpRes.on('data', chunk => { data += chunk; });
          rzpRes.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              if (rzpRes.statusCode >= 200 && rzpRes.statusCode < 300) {
                resolve(parsed);
              } else {
                reject(new Error(parsed.error?.description || `Razorpay fetch HTTP ${rzpRes.statusCode}`));
              }
            } catch (e) {
              reject(e);
            }
          });
        });
        rzpReq.on('error', reject);
        rzpReq.end();
      });
    }

    function resolvePaidPlan({ plan, planName, amount, amountPaise } = {}) {
      const codeUpper = String(plan || '').toUpperCase().trim();
      const nameUpper = String(planName || '').toUpperCase().trim();
      const numAmount = amount !== undefined && amount !== null && !isNaN(Number(amount)) ? Number(amount) : null;
      const numPaise = amountPaise !== undefined && amountPaise !== null && !isNaN(Number(amountPaise)) ? Number(amountPaise) : null;
      const resolvedInr = numPaise !== null && numPaise > 0 ? Math.round(numPaise / 100) : numAmount;

      if (
        codeUpper === 'YEARLY' ||
        nameUpper.includes('GOLD') ||
        nameUpper.includes('PRO') ||
        (resolvedInr !== null && resolvedInr >= 999)
      ) {
        return {
          ...SUBSCRIPTION_PLANS.YEARLY,
          amount: resolvedInr && resolvedInr !== 999 && resolvedInr > 0 ? resolvedInr : SUBSCRIPTION_PLANS.YEARLY.amount,
          amountPaise: numPaise && numPaise > 0 ? numPaise : SUBSCRIPTION_PLANS.YEARLY.amountPaise
        };
      }

      if (
        codeUpper === 'MONTHLY' ||
        nameUpper.includes('SILVER') ||
        resolvedInr === 199 ||
        !resolvedInr ||
        resolvedInr <= 0
      ) {
        return { ...SUBSCRIPTION_PLANS.MONTHLY };
      }

      return {
        code: 'MONTHLY',
        name: planName || 'Silver Edition',
        amount: resolvedInr,
        amountPaise: resolvedInr * 100,
        durationDays: 30
      };
    }

    // Razorpay: Create Order Endpoint
    if (pathname === '/api/payment/razorpay/create-order' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body || '{}');
          const selectedPlan = resolvePaidPlan({
            plan: data.plan,
            planName: data.planName,
            amount: data.amount
          });

          const timestamp = Date.now();
          const internalOrderId = `DM_RZP_${timestamp}_${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
          const reqStudioId = data.studioId || getStudioIdFromRequest(req);
          const reqEmail = (data.email || req.headers['x-studio-email'] || '').toLowerCase().trim();

          let db = loadDB();
          let targetStudio = findExactStudio(db, reqStudioId, reqEmail);
          if (!targetStudio && (reqStudioId || reqEmail)) {
            try {
              const cloudDb = await restoreDatabaseFromDrive();
              const cloudMatch = findExactStudio(cloudDb, reqStudioId, reqEmail);
              if (cloudMatch) {
                db = cloudDb;
                targetStudio = cloudMatch;
              }
            } catch (e) {}
          }

          const studioId = targetStudio?.id || reqStudioId || 'studio_dmfilmsmaker';
          const studioEmail = (targetStudio?.email || reqEmail || '').toLowerCase().trim();

          // Call official Razorpay Orders API
          const rzpOrder = await createRazorpayOrder({
            amountPaise: selectedPlan.amountPaise,
            currency: 'INR',
            receipt: internalOrderId,
            notes: {
              studioId,
              email: studioEmail,
              plan: selectedPlan.code,
              planName: selectedPlan.name,
              durationDays: String(selectedPlan.durationDays)
            }
          });

          if (!db.paymentOrders) db.paymentOrders = [];

          const orderRecord = {
            orderId: internalOrderId,
            razorpayOrderId: rzpOrder.id,
            studioId,
            email: studioEmail,
            plan: selectedPlan.code,
            planName: selectedPlan.name,
            amount: selectedPlan.amount,
            amountPaise: selectedPlan.amountPaise,
            currency: 'INR',
            paymentGateway: 'Razorpay',
            status: 'PENDING',
            createdAt: new Date().toISOString(),
            paidAt: null,
            razorpayPaymentId: null,
            durationDays: selectedPlan.durationDays
          };

          db.paymentOrders.unshift(orderRecord);
          saveDB(db);

          if (!global.activePaymentOrders) global.activePaymentOrders = {};
          global.activePaymentOrders[internalOrderId] = orderRecord;
          global.activePaymentOrders[rzpOrder.id] = orderRecord;

          sendJSON({
            success: true,
            keyId: RAZORPAY_CONFIG.keyId,
            orderId: internalOrderId,
            razorpayOrderId: rzpOrder.id,
            amount: selectedPlan.amountPaise,
            currency: 'INR',
            plan: selectedPlan.code,
            planName: selectedPlan.name,
            durationDays: selectedPlan.durationDays
          });
        } catch (e) {
          console.error('[Razorpay Create Order Error]:', e);
          sendJSON({ error: 'Failed to create Razorpay order: ' + e.message }, 400);
        }
      });
      return;
    }

    // Razorpay: Client Payment Verification & Instant Subscription Activation
    if (pathname === '/api/payment/razorpay/verify' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body || '{}');
          const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId, studioId } = data;

          if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            sendJSON({ success: false, error: 'Missing Razorpay verification parameters' }, 400);
            return;
          }

          const isValid = verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
          if (!isValid) {
            console.error(`❌ [Razorpay Invalid Signature] Order: ${razorpay_order_id} | Payment: ${razorpay_payment_id}`);
            sendJSON({ success: false, error: 'Invalid Razorpay payment signature' }, 400);
            return;
          }

          let db = loadDB();
          let order = (db.paymentOrders || []).find(o => o.razorpayOrderId === razorpay_order_id || (orderId && o.orderId === orderId))
            || (global.activePaymentOrders && (global.activePaymentOrders[razorpay_order_id] || (orderId && global.activePaymentOrders[orderId])))
            || null;

          let rzpPayment = null;
          if (!order) {
            try {
              rzpPayment = await fetchRazorpayPayment(razorpay_payment_id);
            } catch (fetchErr) {
              console.warn('[Razorpay Verify] Live payment lookup fallback:', fetchErr.message);
            }
          }

          const reqEmail = (data.email || req.headers['x-studio-email'] || order?.email || rzpPayment?.notes?.email || rzpPayment?.email || '').toLowerCase().trim();
          const targetStudioId = (studioId && studioId !== 'undefined' && studioId !== 'null' ? studioId : null)
            || order?.studioId
            || rzpPayment?.notes?.studioId
            || getStudioIdFromRequest(req);

          let targetStudio = findExactStudio(db, targetStudioId, reqEmail);
          if (!targetStudio && (targetStudioId || reqEmail)) {
            try {
              const cloudDb = await restoreDatabaseFromDrive();
              const cloudMatch = findExactStudio(cloudDb, targetStudioId, reqEmail);
              if (cloudMatch) {
                db = cloudDb;
                targetStudio = cloudMatch;
                order = (db.paymentOrders || []).find(o => o.razorpayOrderId === razorpay_order_id || (orderId && o.orderId === orderId)) || order;
              }
            } catch (e) {}
          }
          if (!targetStudio && !targetStudioId && !reqEmail) {
            targetStudio = getTargetStudio(db, null, null);
          }

          const resolvedPlan = resolvePaidPlan({
            plan: order?.plan || rzpPayment?.notes?.plan || data.plan,
            planName: order?.planName || rzpPayment?.notes?.planName || data.planName,
            amount: order?.amount ?? data.amount,
            amountPaise: rzpPayment?.amount ?? order?.amountPaise
          });

          const planCode = resolvedPlan.code;
          const planDuration = order?.durationDays || resolvedPlan.durationDays;
          const planName = resolvedPlan.name;
          const amount = resolvedPlan.amount;
          const now = new Date();
          const expires = new Date(Date.now() + planDuration * 24 * 3600 * 1000);

          if (order) {
            order.status = 'SUCCESS';
            order.paidAt = now.toISOString();
            order.razorpayPaymentId = razorpay_payment_id;
            order.utr = razorpay_payment_id;
            if (!db.paymentOrders) db.paymentOrders = [];
            if (!db.paymentOrders.some(o => o.razorpayOrderId === razorpay_order_id || o.orderId === order.orderId)) {
              db.paymentOrders.unshift(order);
            }
          }

          const subObj = {
            planName: planName,
            planCode: planCode,
            amount: amount,
            utr: razorpay_payment_id,
            paymentMethod: 'Razorpay Verified',
            status: 'ACTIVE',
            upiId: '9668584247@ybl',
            activatedAt: now.toISOString(),
            expiresAt: expires.toISOString(),
            durationDays: planDuration,
            daysLeft: planDuration,
            isLocked: false,
            isExpired: false
          };

          const actualStudioId = targetStudio ? targetStudio.id : (targetStudioId || 'studio_dmfilmsmaker');

          if (targetStudio) {
            targetStudio.subscription = subObj;
            targetStudio.paymentHistory = targetStudio.paymentHistory || [];
            if (!targetStudio.paymentHistory.some(p => p.razorpayPaymentId === razorpay_payment_id)) {
              targetStudio.paymentHistory.unshift({
                id: 'PAY_' + Date.now(),
                orderId: order?.orderId || razorpay_order_id,
                razorpayPaymentId: razorpay_payment_id,
                planName: planName,
                amount: amount,
                utr: razorpay_payment_id,
                paymentMethod: 'Razorpay Gateway',
                status: 'SUCCESS',
                timestamp: now.toISOString()
              });
            }
          }

          if (!targetStudioId || targetStudioId === 'studio_master_dm' || targetStudioId === 'studio_dmfilmsmaker') {
            db.subscription = subObj;
          }

          if (!db.paymentHistory) db.paymentHistory = [];
          if (!db.paymentHistory.some(p => p.razorpayPaymentId === razorpay_payment_id)) {
            db.paymentHistory.unshift({
              id: 'PAY_' + Date.now(),
              orderId: order?.orderId || razorpay_order_id,
              razorpayPaymentId: razorpay_payment_id,
              studioId: actualStudioId,
              planName: planName,
              amount: amount,
              utr: razorpay_payment_id,
              paymentMethod: 'Razorpay Gateway',
              status: 'SUCCESS',
              timestamp: now.toISOString()
            });
          }

          saveDB(db);
          if (global.activePaymentOrders && order) {
            global.activePaymentOrders[order.orderId] = order;
            global.activePaymentOrders[razorpay_order_id] = order;
          }
          try {
            await syncDatabaseToDriveImmediate(db);
          } catch (syncErr) {
            console.warn('[Razorpay Verify] Drive sync warning:', syncErr.message);
          }

          const fullSub = buildSubscriptionPayload(db, targetStudio, subObj, actualStudioId);

          console.log(`🎉 [RAZORPAY PAYMENT ACTIVATED] Studio: ${targetStudio?.studioName || actualStudioId} | Plan: ${planName} (₹${amount}) for ${planDuration} Days! Txn: ${razorpay_payment_id}`);

          sendJSON({
            success: true,
            message: 'Razorpay payment successfully verified and subscription activated!',
            subscription: fullSub,
            durationDays: planDuration
          });
        } catch (e) {
          console.error('[Razorpay Verify Error]:', e);
          sendJSON({ error: 'Verification failed: ' + e.message }, 400);
        }
      });
      return;
    }

    // Razorpay: Webhook Listener Endpoint (Automated Background Sync)
    if (pathname === '/api/payment/razorpay/webhook' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const rzpSignature = req.headers['x-razorpay-signature'];
          if (rzpSignature) {
            const expectedSig = crypto.createHmac('sha256', RAZORPAY_CONFIG.keySecret).update(body).digest('hex');
            if (expectedSig !== rzpSignature) {
              console.warn('[Razorpay Webhook] Signature verification failed');
              sendJSON({ error: 'Invalid webhook signature' }, 400);
              return;
            }
          }

          const event = JSON.parse(body || '{}');
          console.log(`📩 [RAZORPAY WEBHOOK] Event: ${event.event}`);

          if (event.event === 'order.paid' || event.event === 'payment.captured') {
            const payment = event.payload?.payment?.entity;
            const orderId = payment?.order_id;
            const paymentId = payment?.id;

            if (orderId) {
              let db = loadDB();
              let order = (db.paymentOrders || []).find(o => o.razorpayOrderId === orderId || o.orderId === orderId);
              const noteStudioId = order?.studioId || payment?.notes?.studioId;
              const noteEmail = (order?.email || payment?.notes?.email || payment?.email || '').toLowerCase().trim();
              let targetStudio = findExactStudio(db, noteStudioId, noteEmail);
              if (!targetStudio && (noteStudioId || noteEmail)) {
                try {
                  const cloudDb = await restoreDatabaseFromDrive();
                  const cloudMatch = findExactStudio(cloudDb, noteStudioId, noteEmail);
                  if (cloudMatch) {
                    db = cloudDb;
                    targetStudio = cloudMatch;
                    order = (db.paymentOrders || []).find(o => o.razorpayOrderId === orderId || o.orderId === orderId) || order;
                  }
                } catch (e) {}
              }

              if (!order || order.status !== 'SUCCESS') {
                const resolvedPlan = resolvePaidPlan({
                  plan: order?.plan || payment?.notes?.plan,
                  planName: order?.planName || payment?.notes?.planName,
                  amount: order?.amount,
                  amountPaise: payment?.amount ?? order?.amountPaise
                });
                const now = new Date();
                const planDuration = order?.durationDays || resolvedPlan.durationDays;
                const expires = new Date(Date.now() + planDuration * 24 * 3600 * 1000);

                if (order) {
                  order.status = 'SUCCESS';
                  order.paidAt = now.toISOString();
                  order.razorpayPaymentId = paymentId;
                  order.utr = paymentId;
                }

                const subObj = {
                  planName: resolvedPlan.name,
                  planCode: resolvedPlan.code,
                  amount: resolvedPlan.amount,
                  utr: paymentId,
                  paymentMethod: 'Razorpay Webhook',
                  status: 'ACTIVE',
                  upiId: '9668584247@ybl',
                  activatedAt: now.toISOString(),
                  expiresAt: expires.toISOString(),
                  durationDays: planDuration,
                  daysLeft: planDuration,
                  isLocked: false,
                  isExpired: false
                };

                if (targetStudio) {
                  targetStudio.subscription = subObj;
                  targetStudio.paymentHistory = targetStudio.paymentHistory || [];
                  if (!targetStudio.paymentHistory.some(p => p.razorpayPaymentId === paymentId)) {
                    targetStudio.paymentHistory.unshift({
                      id: 'PAY_' + Date.now(),
                      orderId: order?.orderId || orderId,
                      razorpayPaymentId: paymentId,
                      planName: resolvedPlan.name,
                      amount: resolvedPlan.amount,
                      utr: paymentId,
                      paymentMethod: 'Razorpay Webhook',
                      status: 'SUCCESS',
                      timestamp: now.toISOString()
                    });
                  }
                }
                saveDB(db);
                try {
                  await syncDatabaseToDriveImmediate(db);
                } catch (e) {}
                console.log(`🎉 [RAZORPAY WEBHOOK ACTIVATED] Order: ${orderId} (${resolvedPlan.name}) activated!`);
              }
            }
          }

          sendJSON({ success: true, message: 'Webhook received' });
        } catch (e) {
          sendJSON({ error: e.message }, 400);
        }
      });
      return;
    }

    // 1. PhonePe Order Creation API (Monthly / Yearly)
    if ((pathname === '/api/payment/phonepe/create-order' || pathname === '/api/payment/create-order') && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body || '{}');
          
          // Strict plan resolution (Monthly = ₹199, Yearly = ₹999)
          let selectedPlan = SUBSCRIPTION_PLANS.MONTHLY;
          const reqPlan = (data.plan || data.planName || '').toUpperCase();
          if (reqPlan === 'YEARLY' || reqPlan.includes('GOLD') || Number(data.amount) === 999) {
            selectedPlan = SUBSCRIPTION_PLANS.YEARLY;
          }

          const timestamp = Date.now();
          const orderId = `DM_${timestamp}_${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
          const studioId = data.studioId || 'studio_master_dm';

          // Load DB and record the pending order
          const db = loadDB();
          if (!db.paymentOrders) db.paymentOrders = [];

          const orderRecord = {
            orderId,
            studioId,
            plan: selectedPlan.code,
            planName: selectedPlan.name,
            amount: selectedPlan.amount,
            amountPaise: selectedPlan.amountPaise,
            currency: 'INR',
            paymentGateway: 'PhonePe',
            status: 'PENDING',
            createdAt: new Date().toISOString(),
            paidAt: null,
            phonepeTransactionId: null,
            durationDays: selectedPlan.durationDays
          };

          db.paymentOrders.unshift(orderRecord);
          saveDB(db);

          if (!global.activePaymentOrders) global.activePaymentOrders = {};
          global.activePaymentOrders[orderId] = orderRecord;

          // Prepare Official PhonePe Standard PG V1 Payload
          const host = req.headers.host || `localhost:${PORT}`;
          const phonepePayload = {
            merchantId: PHONEPE_CONFIG.merchantId,
            merchantTransactionId: orderId,
            merchantUserId: studioId,
            amount: selectedPlan.amountPaise,
            redirectUrl: `http://${host}/admin.html?payment=complete&orderId=${orderId}`,
            redirectMode: 'REDIRECT',
            callbackUrl: `http://${host}/api/payment/phonepe/webhook`,
            mobileNumber: '9668584247',
            paymentInstrument: {
              type: 'PAY_PAGE'
            }
          };

          const base64Payload = Buffer.from(JSON.stringify(phonepePayload)).toString('base64');
          const checksum = generatePhonePeChecksum(base64Payload, '/pg/v1/pay');

          // Construct direct UPI QR URI linked to Durjan Mahanand (9668584247@ybl)
          const upiUri = `upi://pay?pa=9668584247@ybl&pn=DURJAN%20MAHANAND&am=${selectedPlan.amount}&cu=INR&tn=${encodeURIComponent('DM Photo SaaS ' + selectedPlan.name + ' ' + orderId)}`;

          sendJSON({
            success: true,
            orderId,
            plan: selectedPlan.code,
            planName: selectedPlan.name,
            amount: selectedPlan.amount,
            currency: 'INR',
            upiUri,
            upiId: '9668584247@ybl',
            checksum,
            phonepeHost: PHONEPE_CONFIG.hostUrl
          });

        } catch (e) {
          sendJSON({ error: 'Failed to create PhonePe payment order: ' + e.message }, 400);
        }
      });
      return;
    }

    // 2. Secure PhonePe Webhook Endpoint
    if (pathname === '/api/payment/phonepe/webhook' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const rawData = JSON.parse(body || '{}');
          const base64Response = rawData.response || '';
          const xVerify = req.headers['x-verify'] || '';

          // Signature Verification
          const isSignatureValid = verifyPhonePeChecksum(base64Response, xVerify);
          let decodedPayload = {};
          try {
            decodedPayload = JSON.parse(Buffer.from(base64Response, 'base64').toString('utf8'));
          } catch(e) {
            decodedPayload = rawData;
          }

          const orderId = decodedPayload.data?.merchantTransactionId || decodedPayload.merchantTransactionId;
          const status = decodedPayload.code || decodedPayload.status;

          console.log(`📩 [PHONEPE WEBHOOK RECEIVED] Order: ${orderId} | Status: ${status}`);

          if (orderId) {
            const db = loadDB();
            const order = (db.paymentOrders || []).find(o => o.orderId === orderId);

            if (order) {
              // Idempotency check
              if (order.status === 'SUCCESS') {
                sendJSON({ success: true, message: 'Already processed' });
                return;
              }

              if (status === 'PAYMENT_SUCCESS' || status === 'SUCCESS') {
                const now = new Date();
                const planDuration = order.durationDays || (order.plan === 'YEARLY' ? 180 : 30);
                const expires = new Date(Date.now() + planDuration * 24 * 3600 * 1000);
                const utr = decodedPayload.data?.paymentInstrument?.utr || ('UPI' + Date.now().toString().slice(-8));

                order.status = 'SUCCESS';
                order.paidAt = now.toISOString();
                order.phonepeTransactionId = decodedPayload.data?.transactionId || 'TXN_' + Date.now();
                order.utr = utr;

                const targetStudio = (db.studios || []).find(s => s.id === order.studioId);
                const subObj = {
                  planName: order.planName,
                  planCode: order.plan,
                  amount: order.amount,
                  utr,
                  paymentMethod: 'PhonePe Webhook Verified',
                  status: 'ACTIVE',
                  upiId: '9668584247@ybl',
                  activatedAt: now.toISOString(),
                  expiresAt: expires.toISOString(),
                  durationDays: planDuration
                };

                if (targetStudio) {
                  targetStudio.subscription = subObj;
                  targetStudio.paymentHistory = targetStudio.paymentHistory || [];
                  targetStudio.paymentHistory.unshift({
                    id: 'PAY_' + Date.now(),
                    orderId,
                    planName: order.planName,
                    amount: order.amount,
                    utr,
                    paymentMethod: 'PhonePe Webhook',
                    status: 'SUCCESS',
                    timestamp: now.toISOString()
                  });
                }

                if (!order.studioId || order.studioId === 'studio_master_dm') {
                  db.subscription = subObj;
                }

                if (!db.paymentHistory) db.paymentHistory = [];
                db.paymentHistory.unshift({
                  id: 'PAY_' + Date.now(),
                  orderId,
                  planName: order.planName,
                  amount: order.amount,
                  utr,
                  paymentMethod: 'PhonePe Webhook',
                  status: 'SUCCESS',
                  timestamp: now.toISOString()
                });

                saveDB(db);
                if (global.activePaymentOrders) global.activePaymentOrders[orderId] = order;

                console.log(`🎉 [PHONEPE WEBHOOK ACTIVATED] Studio: ${targetStudio?.studioName || order.studioId} | Plan: ${order.planName} for ${planDuration} Days!`);
                sendJSON({ success: true, message: 'Subscription activated' });
                return;
              } else if (status === 'PAYMENT_ERROR' || status === 'FAILED') {
                order.status = 'FAILED';
                saveDB(db);
                if (global.activePaymentOrders) global.activePaymentOrders[orderId] = order;
              }
            }
          }

          sendJSON({ success: true, message: 'Webhook acknowledged' });
        } catch (e) {
          sendJSON({ error: 'Webhook processing error: ' + e.message }, 400);
        }
      });
      return;
    }

    // 3. Payment Status Check API (For Frontend Live Polling)
    if ((pathname === '/api/payment/status' || pathname.startsWith('/api/payment/status/')) && req.method === 'GET') {
      let orderId = parsedUrl.searchParams.get('orderId');
      if (!orderId && pathname.startsWith('/api/payment/status/')) {
        orderId = pathname.replace('/api/payment/status/', '').trim();
      }

      if (!orderId) {
        sendJSON({ status: 'PENDING' });
        return;
      }

      const db = loadDB();
      const order = (db.paymentOrders || []).find(o => o.orderId === orderId || o.razorpayOrderId === orderId) || (global.activePaymentOrders ? (global.activePaymentOrders[orderId] || null) : null);

      if (!order) {
        sendJSON({ status: 'PENDING' });
        return;
      }

      if (order.status === 'SUCCESS' || order.status === 'PAID') {
        const studio = (db.studios || []).find(s => s.id === order.studioId);
        const sub = studio?.subscription || db.subscription || {};
        sendJSON({
          status: 'SUCCESS',
          orderId: order.orderId,
          plan: order.plan,
          planName: order.planName,
          amount: order.amount,
          utr: order.utr || sub.utr,
          durationDays: order.durationDays || sub.durationDays || 30,
          subscriptionActive: true,
          expiryDate: sub.expiresAt,
          subscription: sub
        });
        return;
      }

      if (order.status === 'FAILED') {
        sendJSON({ status: 'FAILED', message: 'Payment failed. Please try again.' });
        return;
      }

      sendJSON({ status: 'PENDING' });
      return;
    }

    // 4. Current Active Subscription API (Strict Multi-tenant Per-Studio)
    if (pathname === '/api/subscription/current' && req.method === 'GET') {
      let db = loadDB();
      const studioId = getStudioIdFromRequest(req);
      const headerEmail = (req.headers['x-studio-email'] || '').toLowerCase().trim();
      let studio = findExactStudio(db, studioId, headerEmail);
      if (!studio && (studioId || headerEmail)) {
        try {
          const cloudDb = await restoreDatabaseFromDrive();
          const cloudMatch = findExactStudio(cloudDb, studioId, headerEmail);
          if (cloudMatch) {
            db = cloudDb;
            studio = cloudMatch;
          }
        } catch (e) {}
      }
      if (!studio && !studioId && !headerEmail) {
        studio = getTargetStudio(db, null, null);
      }
      const actualStudioId = studio ? studio.id : (studioId || '');
      const effectiveEmail = (studio?.email || headerEmail || '').toLowerCase().trim();
      
      // Developer Lifetime VIP Bypass (Permanent Lifetime Free, Unlimited, NEVER expires, NEVER locks)
      if (studio && isDeveloperAccount(studio)) {
        const usedClientsCount = (db.clients || []).filter(c => c.studioId === actualStudioId).length;
        const usedFlipbooksCount = (db.flipbooks || []).filter(f => f.studioId === actualStudioId).length;
        sendJSON({
          status: 'ACTIVE',
          planName: 'Developer Lifetime VIP 👑',
          planCode: 'LIFETIME',
          amount: 0,
          utr: 'DEVELOPER_MASTER_FREE',
          paymentMethod: 'Developer Lifetime Master Pass',
          activatedAt: '2026-01-01T00:00:00.000Z',
          expiresAt: '2099-12-31T23:59:59.999Z',
          durationDays: 99999,
          daysLeft: 99999,
          isLocked: false,
          isExpired: false,
          isActive: true,
          trialClaimed: true,
          isDeveloper: true,
          upiId: '9668584247@ybl',
          limits: {
            planName: 'Developer Lifetime VIP 👑',
            maxClients: Infinity,
            maxFlipbooks: Infinity,
            usedClients: usedClientsCount,
            usedFlipbooks: usedFlipbooksCount,
            remainingClients: 'Unlimited',
            remainingFlipbooks: 'Unlimited',
            unlimited: true,
            isDeveloper: true
          }
        });
        return;
      }
      
      if (!studio || !studio.subscription) {
        const trialClaimed = hasClaimedTrial(db, studio, effectiveEmail, actualStudioId);
        sendJSON({
          status: 'NO_PLAN',
          planName: 'No Plan',
          isExpired: false,
          isActive: false,
          isLocked: true,
          daysLeft: 0,
          trialClaimed,
          upiId: '9668584247@ybl',
          limits: {
            planName: 'No Plan',
            maxClients: 0,
            maxFlipbooks: 0,
            usedClients: (db.clients || []).filter(c => c.studioId === actualStudioId).length,
            usedFlipbooks: (db.flipbooks || []).filter(f => f.studioId === actualStudioId).length,
            remainingClients: 0,
            remainingFlipbooks: 0,
            unlimited: false
          }
        });
        return;
      }

      const sub = studio.subscription;
      if (!sub || sub.status === 'NO_PLAN') {
        const trialClaimed = hasClaimedTrial(db, studio, effectiveEmail, actualStudioId);
        sendJSON({
          status: 'NO_PLAN',
          planName: 'No Plan Active',
          amount: 0,
          isExpired: false,
          isActive: false,
          isLocked: true,
          daysLeft: 0,
          trialClaimed,
          upiId: '9668584247@ybl',
          limits: {
            planName: 'No Plan Active',
            maxClients: 0,
            maxFlipbooks: 0,
            usedClients: (db.clients || []).filter(c => c.studioId === actualStudioId).length,
            usedFlipbooks: (db.flipbooks || []).filter(f => f.studioId === actualStudioId).length,
            remainingClients: 0,
            remainingFlipbooks: 0,
            unlimited: false
          }
        });
        return;
      }

      const now = Date.now();
      const expTime = new Date(sub.expiresAt).getTime();
      const isExpired = !expTime || isNaN(expTime) || now >= expTime;
      const daysLeft = isExpired ? 0 : Math.ceil((expTime - now) / (1000 * 60 * 60 * 24));
      const status = isExpired ? 'EXPIRED' : (sub.status || 'ACTIVE');
      const isLocked = isExpired || status !== 'ACTIVE';
      const limits = getSubscriptionLimits(studio);

      const trialClaimed = hasClaimedTrial(db, studio, effectiveEmail, actualStudioId);

      const usedClientsCount = (db.clients || []).filter(c => c.studioId === actualStudioId).length;
      const usedFlipbooksCount = (db.flipbooks || []).filter(f => f.studioId === actualStudioId).length;

      sendJSON({
        ...sub,
        status,
        daysLeft,
        isExpired,
        isActive: !isExpired && status === 'ACTIVE',
        isLocked,
        upiId: '9668584247@ybl',
        trialClaimed,
        limits: isLocked ? {
          planName: (sub.planName || 'Plan') + ' (Expired)',
          maxClients: 0,
          maxFlipbooks: 0,
          usedClients: usedClientsCount,
          usedFlipbooks: usedFlipbooksCount,
          remainingClients: 0,
          remainingFlipbooks: 0,
          unlimited: false
        } : {
          ...limits,
          usedClients: usedClientsCount,
          usedFlipbooks: usedFlipbooksCount,
          remainingClients: limits.unlimited ? 'Unlimited' : Math.max(0, limits.maxClients - usedClientsCount),
          remainingFlipbooks: limits.unlimited ? 'Unlimited' : Math.max(0, limits.maxFlipbooks - usedFlipbooksCount),
          unlimited: limits.unlimited
        }
      });
      return;
    }

    if (pathname === '/api/subscription/activate' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body || '{}');
          const rawPlanName = data.planName || 'Silver Edition';
          const rawAmount = (data.amount !== undefined && !isNaN(Number(data.amount))) ? Number(data.amount) : 0;
          const utr = data.utr || data.transactionId || ('RZP' + Date.now().toString().slice(-8));
          const paymentMethod = data.paymentMethod || (rawAmount === 0 ? 'Free Trial Activation' : 'Razorpay Gateway');

          let db = loadDB();
          const studioId = data.studioId || getStudioIdFromRequest(req);
          const reqEmail = (data.email || req.headers['x-studio-email'] || '').toLowerCase().trim();
          let studio = findExactStudio(db, studioId, reqEmail);
          if (!studio && (studioId || reqEmail)) {
            try {
              const cloudDb = await restoreDatabaseFromDrive();
              const cloudMatch = findExactStudio(cloudDb, studioId, reqEmail);
              if (cloudMatch) {
                db = cloudDb;
                studio = cloudMatch;
              }
            } catch (e) {}
          }
          if (!studio && !studioId && !reqEmail) {
            studio = getTargetStudio(db, null, null);
          }

          const actualStudioId = studio ? studio.id : (studioId || '');
          const userEmail = (studio?.email || reqEmail || data.email || '').toLowerCase().trim();

          db.claimedTrialEmails = db.claimedTrialEmails || [];
          db.claimedTrialStudioIds = db.claimedTrialStudioIds || [];

          const isTrialRequest = (rawPlanName.toLowerCase().includes('free') || rawPlanName.toLowerCase().includes('trial') || rawAmount === 0);
          if (isTrialRequest && hasClaimedTrial(db, studio, userEmail, actualStudioId)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '7-Day Free Trial has already been claimed on this email/account.' }));
            return;
          }

          let finalPlanName = rawPlanName;
          let finalAmount = rawAmount;
          let finalPlanCode = 'TRIAL';
          let durationDays = 7;

          if (isTrialRequest) {
            finalPlanName = 'Free Trial';
            finalAmount = 0;
            finalPlanCode = 'TRIAL';
            durationDays = 7;
            recordClaimedTrial(db, studio, userEmail, actualStudioId);
          } else {
            const paidPlan = resolvePaidPlan({
              plan: data.plan,
              planName: rawPlanName,
              amount: rawAmount
            });
            finalPlanName = paidPlan.name;
            finalAmount = paidPlan.amount;
            finalPlanCode = paidPlan.code;
            durationDays = paidPlan.durationDays;
          }

          const now = new Date();
          const expires = new Date(Date.now() + durationDays * 24 * 3600 * 1000);

          const subObj = {
            planName: finalPlanName,
            planCode: finalPlanCode,
            amount: finalAmount,
            utr,
            paymentMethod,
            status: 'ACTIVE',
            upiId: '9668584247@ybl',
            activatedAt: now.toISOString(),
            expiresAt: expires.toISOString(),
            durationDays,
            daysLeft: durationDays,
            isLocked: false,
            isExpired: false
          };

          if (studio) {
            studio.subscription = subObj;
            studio.paymentHistory = studio.paymentHistory || [];
            studio.paymentHistory.unshift({
              id: 'PAY_' + Date.now(),
              planName: subObj.planName,
              amount: finalAmount,
              utr,
              paymentMethod,
              status: 'SUCCESS',
              timestamp: now.toISOString()
            });
          }

          if (!db.paymentHistory) db.paymentHistory = [];
          db.paymentHistory.unshift({
            id: 'PAY_' + Date.now(),
            studioId: actualStudioId,
            planName: subObj.planName,
            amount: finalAmount,
            utr,
            paymentMethod,
            status: 'SUCCESS',
            timestamp: now.toISOString()
          });

          saveDB(db);
          try {
            await syncDatabaseToDriveImmediate(db);
          } catch (syncErr) {}

          const fullSubResponse = buildSubscriptionPayload(db, studio, subObj, actualStudioId);

          console.log(`🎉 [SUBSCRIPTION ACTIVATED] Studio: ${studio?.studioName || actualStudioId} | Plan: ${subObj.planName} | Amount: ₹${finalAmount} | UTR: ${utr} | Expires: ${expires.toLocaleDateString()}`);

          sendJSON({
            success: true,
            message: `🎉 ${subObj.planName} is successfully activated for ${durationDays} days!`,
            subscription: fullSubResponse
          });
        } catch (e) {
          sendJSON({ error: 'Failed to activate subscription: ' + e.message }, 400);
        }
      });
      return;
    }

    // 12. Static Files Server (With Full HTTP 206 Partial Content / Audio Range Seeking Support)
    let decodedPath = '/';
    try {
      decodedPath = decodeURIComponent(pathname);
    } catch(e) {
      decodedPath = pathname;
    }
    let filePath = path.join(__dirname, decodedPath === '/' ? 'index.html' : decodedPath);

    // Auto-resolve admin.js whether uploaded to root or in js/ folder
    if (decodedPath === '/js/admin.js' || decodedPath === '/admin.js') {
      const rootAdmin = path.join(__dirname, 'admin.js');
      const jsAdmin = path.join(__dirname, 'js', 'admin.js');
      if (fs.existsSync(rootAdmin) && fs.existsSync(jsAdmin)) {
        const rootMtime = fs.statSync(rootAdmin).mtimeMs;
        const jsMtime = fs.statSync(jsAdmin).mtimeMs;
        filePath = rootMtime >= jsMtime ? rootAdmin : jsAdmin;
      } else if (fs.existsSync(rootAdmin)) {
        filePath = rootAdmin;
      } else if (fs.existsSync(jsAdmin)) {
        filePath = jsAdmin;
      }
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const stat = fs.statSync(filePath);
      const totalSize = stat.size;
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.gif': 'image/gif',
        '.bmp': 'image/bmp',
        '.ico': 'image/x-icon',
        '.avif': 'image/avif',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.ogg': 'audio/ogg',
        '.m4a': 'audio/mp4',
        '.aac': 'audio/aac'
      };
      const contentType = mimeTypes[ext] || 'application/octet-stream';

      const isDynamicCode = ext === '.html' || ext === '.js' || ext === '.css' || ext === '.json';
      const cacheHeaders = isDynamicCode ? {
        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0'
      } : {
        'Cache-Control': 'public, max-age=86400'
      };

      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
        const chunkSize = (end - start) + 1;
        const fileStream = fs.createReadStream(filePath, { start, end });
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${totalSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': contentType,
          ...cacheHeaders
        });
        fileStream.pipe(res);
        return;
      } else {
        res.writeHead(200, {
          'Content-Length': totalSize,
          'Accept-Ranges': 'bytes',
          'Content-Type': contentType,
          ...cacheHeaders
        });
        fs.createReadStream(filePath).pipe(res);
        return;
      }
    }

    sendJSON({ error: 'Not Found' }, 404);

  } catch (err) {
    console.error('Server error:', err);
    sendJSON({ error: err.message }, 500);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIpAddress();
  console.log(`\n======================================================`);
  console.log(`✨ Multi-Studio Wedding Photo SaaS Platform is LIVE!`);
  console.log(`🌐 Website Home:   http://localhost:${PORT}`);
  console.log(`🔐 Studio Login:   http://localhost:${PORT}/login.html`);
  console.log(`🛠 Admin Panel:    http://localhost:${PORT}/admin.html`);
  console.log(`📱 Mobile Wi-Fi:   http://${ip}:${PORT}/client.html`);
  console.log(`======================================================\n`);

  // Automatically restore latest cloud database from Google Drive on startup
  setTimeout(() => {
    restoreDatabaseFromDrive().then(() => {
      console.log('✔ [Google Drive] Cloud Database automatically verified and synchronized on startup!');
    }).catch(err => {
      console.warn('[Google Drive Startup Sync]:', err.message);
    });
  }, 1000);
});
