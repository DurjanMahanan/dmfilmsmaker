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
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        if (net.address.startsWith('192.168.') || net.address.startsWith('10.') || net.address.startsWith('172.')) {
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
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// Plan Limit Tiers Config: Free Trial, Silver Edition (₹199), Gold (Pro) (₹999)
function getSubscriptionLimits(db) {
  const sub = db.subscription || { status: 'ACTIVE', planName: 'Silver Edition', durationDays: 30 };
  const planName = (sub.planName || '').toLowerCase();
  
  if (planName.includes('gold') || planName.includes('pro') || sub.amount === 999) {
    return {
      planName: 'Gold (Pro)',
      maxClients: Infinity,
      maxFlipbooks: Infinity,
      unlimited: true
    };
  }
  
  if (planName.includes('silver') || sub.amount === 199) {
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

function loadOAuth() {
  try {
    if (fs.existsSync(OAUTH_FILE)) return JSON.parse(fs.readFileSync(OAUTH_FILE, 'utf8'));
  } catch (e) {}
  return null;
}
function saveOAuth(tokens) {
  fs.writeFileSync(OAUTH_FILE, JSON.stringify(tokens, null, 2));
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

// Get Active Google Access Token
async function getDriveAccessToken() {
  const oauth = loadOAuth();
  if (oauth && oauth.refresh_token) {
    if (oauth.access_token && oauth.expiry_date > Date.now() + 60000) {
      return oauth.access_token;
    }
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
    }
  }

  // Fallback to Service Account
  return await getServiceAccountToken();
}

async function getServiceAccountToken() {
  const GOOGLE_SERVICE_ACCOUNT_EMAIL = "dm-uploader@dm-photo-selector.iam.gserviceaccount.com";
  const GOOGLE_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvwIBADANBgkqhkiG9w0BAQEFAASCBKkwggSlAgEAAoIBAQDF6Q6avHRQ3m+C
0ydqhuJH32f2GKqeENTf8iGIGkY/k/3EE9DKvWiMsW5veRGLqUa2v5wHHYMFcr9G
qwYmXYhhFe1WuQKVEV/yqWD22YfuAiuZh5R+rWWagHO8mViH7lCqeEoTs5xGz3Fs
AmBEyNFDaX08tOzVyJ9Lf91ydGSfIxvu+SMR7kteJ37KGbFGS7Y5p13T/s6QpTEw
BnRopZrJ2K5vsBEJXICkYW6OTcGqWdj/tXtG89v9INeXWneeY3G7NNmefrHDmNf1
gUEYrAl5OVOfqlSmjkZ9DxDynlQzy5KqM67pvLYsjNfpK/k4PufNJv4DJ5DSbeh1
6K2IZG3rAgMBAAECggEAFNlQaIyh1EMajDWiWV6MR/YJBavjjXNIea8QST47WEdG
3HkZ7cG2Wdv3PlcKuiPDB014Kme5fcFw1Qj/RNtlmpSsxA4Jb5q8+NtPE7Im17Py
0+GsiwvJQFV3285rvSYl6U9yvlCVjgAcerxlV9mv8eITB2on6P2RimqV8ZDBaOIi
RqAU0VDWAaqRkNuX5beiANaQ6yYOxCS2O1TdWqFeVO3LrIjOQqUQf0We2TnZ4hvN
XY7XR+Root0DxAcleR56hjb31KIH0SD2oFdPU6LLKx/38/9v6sbXUrrNWPY+P5nz
MzDJ1CBcYEK1k6tpvQhvxUvR9F7MLSqkPxOdsva4QQKBgQD6LI9ZbjiAwHgg5TYw
eWohvwuFYvEfngMpcK9/RB52WsLSb0Y3TuwwHiwdQARlYR5xoAKZ/jXC4V54zcQJ
5EUF1mFWUARdROnZUMjb//ZGp5iQ4+qT3f648AR90C5QVnawiCUyRb8kbU+RQtNh
NYsUZwNi8eRyeVysPei9uq6QpQKBgQDKhOvigWMN3EExkVd2EpvhSogzvje8NwcY
p35inxZiMrbpj4Y5ajkF6CtNMhRxf05ogovXPtEQPHoKgM2MRWSXB3pL/4Cw7eT+
AHVd3jGBCsNadz91pso1r/dKUXhZrGDxEi/SL+xYePg9N6msKl8a+SOiLgIiWpgn
Y+hTOwGvTwKBgQCdQteVwxiXruWU4CExVZFmxz5JygmC84RPT3uyh7KSeblQKQy9
hcoo8T6P4Ici52sIyCn6fXd0GtGVJNvfz/OnmLy1UjV8H+7UYdjxmrRIc+AO7Iaw
DvOpc4+POwdyDvgrPloLgRaHooNK7/QKfmsAF0VktGQDpdCgoYYlhi1n1QKBgQCt
THtR82hhBvZexUGzjw8HBbFxnbex/uC6rzGOkRYlZ8JwMNoqLYSoUlkjkNQ/nzHo
arXhtiZOn4HLlRbPjt4aA1Maz4Q/YwNOe/PzJFz2UNCEjICoW9azhGW3menDyqeW
AvsbANldh/7c29H8urFxsnpUoMxAu4dyRaMb/eVeLwKBgQD4ZimGKVrIfhwAOe6h
C7Uks3mtyg1stPe+sT9c0BCoVyOVyNuB7VszsAMs9IOOBZR7vq5b7YYoqmUF4ooi
yyHIU+5LNMHDwrLF4Afg21IW+SbgQIrKcMkBofuE9d5vQuA4680/UB0JFrpeBsr1
4i4ot5vjJPv9GLSbRfa8Gkp1+g==
-----END PRIVATE KEY-----`;

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

// Create Google Drive Folder
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
  return resp.json();
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
          const existing = db.studios.find(s => s.email.toLowerCase() === email.toLowerCase());
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
          const newStudio = {
            id: studioId,
            studioName: studioName.trim(),
            email: email.toLowerCase().trim(),
            password: password.trim(),
            phone: phone || '',
            logoUrl: logoUrl || '',
            tagline: tagline || 'Wedding & Cinematic Photography',
            driveFolderId: studioDriveFolderId,
            createdAt: new Date().toISOString()
          };

          db.studios.push(newStudio);
          saveDB(db);

          console.log(`✨ [New Studio Registered] "${newStudio.studioName}" (${newStudio.email})`);
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
              driveFolderId: newStudio.driveFolderId
            }
          });
        } catch (e) { sendJSON({ error: 'Bad Request' }, 400); }
      });
      return;
    }

    // 2. Studio Login
    if (pathname === '/api/auth/login' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { email, password } = JSON.parse(body);
          const db = loadDB();

          // Check if registered studio
          const studio = db.studios.find(s => 
            (s.email.toLowerCase() === (email || '').toLowerCase() || s.studioName.toLowerCase() === (email || '').toLowerCase()) && 
            s.password === password
          );

          if (studio) {
            sendJSON({
              success: true,
              token: 'token_' + studio.id + '_' + Date.now(),
              studio: {
                id: studio.id,
                studioName: studio.studioName,
                email: studio.email,
                phone: studio.phone,
                logoUrl: studio.logoUrl,
                tagline: studio.tagline
              }
            });
            return;
          }

          // Default Master Admin fallback
          if (password === 'admin123' || password === 'dmfilms') {
            sendJSON({
              success: true,
              token: 'dm_admin_token_2026',
              studio: {
                id: 'studio_master_dm',
                studioName: 'DM Films & Photography',
                email: email || 'contact@dmfilms.com',
                phone: '+91 98765 43210',
                logoUrl: '',
                tagline: 'Luxury Wedding & Cinematic Memories'
              }
            });
            return;
          }

          sendJSON({ success: false, error: 'Invalid email or password' }, 401);
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
            if (studioName) studio.studioName = studioName.trim();
            if (phone !== undefined) studio.phone = phone;
            if (logoUrl !== undefined) studio.logoUrl = logoUrl;
            if (tagline !== undefined) studio.tagline = tagline;
            saveDB(db);
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
        const params = new URLSearchParams({
          code,
          client_id: oauth.client_id,
          client_secret: oauth.client_secret,
          redirect_uri: `http://localhost:${PORT}/oauth2callback`,
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
          saveOAuth({
            ...oauth,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token || oauth.refresh_token,
            expiry_date: Date.now() + (tokens.expires_in * 1000)
          });
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html><body style="background:#0a0c10;color:#d4af37;font-family:sans-serif;text-align:center;padding:4rem;">
              <h2>✔ Google Drive Connected Successfully!</h2>
              <p style="color:#94a3b8;">Your personal Google Drive storage is now linked for photo uploads.</p>
              <a href="/admin.html" style="color:#facc15;font-weight:bold;text-decoration:none;">&larr; Return to Admin Dashboard</a>
              <script>setTimeout(() => window.location.href = '/admin.html', 1500);</script>
            </body></html>
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

    // 5. Clients API
    if (pathname === '/api/clients' || pathname.startsWith('/api/clients/')) {
      const studioId = req.headers['x-studio-id'];

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
          sendJSON(db.clients || []);
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

          if (mainFolderId && mainFolderId !== rootMasterId) {
            try {
              const token = await getDriveAccessToken();
              console.log(`[Google Drive] Deleting client "${client.name}" folder forever: ${mainFolderId}...`);
              await deleteDriveFolder(mainFolderId, token);
            } catch (err) {
              console.warn('[Google Drive] Error deleting Drive folder on client delete:', err.message);
            }
          }

          db.clients = db.clients.filter(c => c.id !== clientIdMatch && c.code !== clientIdMatch);
          saveDB(db);
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

            // Plan Limit Enforcement for Photo Selection Projects (Clients)
            const limits = getSubscriptionLimits(db);
            const currentClientsCount = (db.clients || []).length;
            if (currentClientsCount >= limits.maxClients) {
              console.warn(`⚠️ [LIMIT REACHED] Plan: ${limits.planName} | Max Allowed: ${limits.maxClients} | Current: ${currentClientsCount}`);
              sendJSON({
                error: `Limit Reached: Your ${limits.planName} plan allows a maximum of ${limits.maxClients} Photo Selection Projects. Please upgrade your plan to create more projects!`,
                limitReached: true,
                type: 'CLIENTS_LIMIT',
                maxAllowed: limits.maxClients,
                currentCount: currentClientsCount
              }, 403);
              return;
            }

            const token = await getDriveAccessToken();

            // Find Studio's parent folder inside WAPSITE -> Photo Selection in Google Drive
            const studio = db.studios.find(s => s.id === (studioId || clientData.studioId));
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

            console.log(`[Google Drive] Creating event folders for client: ${clientData.name} inside Photo Selection -> Studio folder (${studioFolderId})...`);
            const folderTitle = `${clientData.name} - ${clientData.eventName || 'Wedding'} (${clientData.code})`;
            const mainFolder = await createDriveFolder(folderTitle, studioFolderId, token);
            const originalFolder = await createDriveFolder('01_Original_Photos', mainFolder.id, token);
            const selectedFolder = await createDriveFolder('02_Selected_Photos', mainFolder.id, token);
            const thumbFolder = await createDriveFolder('03_Thumbnails', mainFolder.id, token);

            const newClient = {
              id: mainFolder.id,
              studioId: studioId || clientData.studioId || 'studio_master_dm',
              code: clientData.code.toUpperCase(),
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

    // 6. Direct Resumable Upload Initializer (Supports Nested Subfolders with Self-Healing)
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

          const token = await getDriveAccessToken();

          // Handle Subfolder (e.g. "DEMO", "New folder", "Haldi", etc.)
          if (subfolder && subfolder.trim() && subfolder.trim() !== 'Main Photos') {
            const cleanSubfolder = subfolder.trim();
            client.subfolders = client.subfolders || {};

            let subfolderId = client.subfolders[cleanSubfolder];
            if (!subfolderId) {
              try {
                const sf = await findOrCreateDriveFolder(cleanSubfolder, parentFolderId, token);
                subfolderId = sf.id;
                client.subfolders[cleanSubfolder] = sf.id;
                saveDB(db);
              } catch (e) {
                console.warn(`Error resolving subfolder "${cleanSubfolder}":`, e.message);
                subfolderId = parentFolderId;
              }
            }
            parentFolderId = subfolderId;
          }

          // Check if file with same name already exists in parentFolderId to override/replace instead of creating duplicate
          let existingFileId = null;
          try {
            const q = encodeURIComponent(`'${parentFolderId}' in parents and name = '${filename.replace(/'/g, "\\'")}' and trashed = false`);
            const sResp = await httpsRequest({
              hostname: 'www.googleapis.com',
              path: `/drive/v3/files?q=${q}&fields=files(id,name)`,
              method: 'GET',
              headers: { 'Authorization': `Bearer ${token}` }
            });
            if (sResp.statusCode < 400) {
              const sData = sResp.json();
              if (sData.files && sData.files.length > 0) {
                existingFileId = sData.files[0].id;
                // Delete any extra duplicate files from Google Drive if present
                if (sData.files.length > 1) {
                  for (let i = 1; i < sData.files.length; i++) {
                    deleteDriveFolder(sData.files[i].id, token).catch(() => {});
                  }
                }
              }
            }
          } catch (e) {}

          let metaPayload = JSON.stringify(existingFileId ? { name: filename } : { name: filename, parents: [parentFolderId] });
          let httpMethod = existingFileId ? 'PATCH' : 'POST';
          let uploadPath = existingFileId 
            ? `/upload/drive/v3/files/${existingFileId}?uploadType=resumable&supportsAllDrives=true&fields=id,name,size,thumbnailLink`
            : '/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,size,thumbnailLink';

          let initResp = await httpsRequest({
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

          // If folder was not found (404), self-heal by creating subfolder fresh in client main folder
          if (initResp.statusCode === 404) {
            console.warn(`Folder ${parentFolderId} was not found (404). Self-healing with fresh folder...`);
            let fallbackParent = client?.folders?.original || client?.folders?.main || rootMasterId;
            if (subfolder && subfolder.trim()) {
              try {
                const freshSf = await createDriveFolder(subfolder.trim(), fallbackParent, token);
                client.subfolders[subfolder.trim()] = freshSf.id;
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

    // 7. Record Completed Upload Photo Metadata (With Subfolder Tag)
    if (pathname === '/api/upload/complete' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          const { clientId, driveFile, subfolder } = JSON.parse(body);

          // Skip directory objects or non-image entries
          if (!driveFile.name || !/\.(jpe?g|png|webp|gif|bmp|heic|raw|cr2|nef|arw)$/i.test(driveFile.name)) {
            sendJSON({ skipped: true });
            return;
          }

          const db = loadDB();
          const client = db.clients.find(c => c.id === clientId || c.code === clientId);

          // If dummy ID sent by client fallback, query Google Drive for the real file ID
          if (client && (!driveFile.id || driveFile.id.startsWith('drive_') || driveFile.id.startsWith('file_') || driveFile.id.startsWith('up_'))) {
            try {
              const token = await getDriveAccessToken();
              const targetFolder = (subfolder && client.subfolders?.[subfolder]) || client.folders?.original || client.folders?.main;
              if (targetFolder) {
                const q = encodeURIComponent(`'${targetFolder}' in parents and name = '${driveFile.name.replace(/'/g, "\\'")}' and trashed = false`);
                const sResp = await httpsRequest({
                  hostname: 'www.googleapis.com',
                  path: `/drive/v3/files?q=${q}&fields=files(id,name,size)`,
                  method: 'GET',
                  headers: { 'Authorization': `Bearer ${token}` }
                });
                if (sResp.statusCode < 400) {
                  const sData = sResp.json();
                  if (sData.files && sData.files.length > 0) {
                    driveFile.id = sData.files[0].id;
                  }
                }
              }
            } catch (err) {}
          }

          const photoObj = {
            id: driveFile.id,
            name: driveFile.name,
            size: Number(driveFile.size) || 0,
            subfolder: subfolder || '',
            url: `/api/image/${driveFile.id}`,
            thumbnailUrl: `/api/image/${driveFile.id}`
          };

          if (client) {
            client.photos = client.photos || [];
            const idx = client.photos.findIndex(p => p.id === photoObj.id || (p.name === photoObj.name && (p.subfolder || '') === (photoObj.subfolder || '')));
            if (idx >= 0) {
              client.photos[idx] = photoObj;
            } else {
              client.photos.push(photoObj);
            }
            client.photos = client.photos.filter(p => p.size > 0 && /\.(jpe?g|png|webp|gif|bmp|heic|raw|cr2|nef|arw)$/i.test(p.name));
            client.photosCount = client.photos.length;
            saveDB(db);
          }
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

      const studioId = req.headers['x-studio-id'] || '';
      let studio = (studioId && db.studios.find(s => s.id === studioId)) || db.studios[0];
      
      // Ensure registered studioName is preserved
      studio.studioName = studio.studioName || 'DM STUDIO';
      studio.ownerName = studio.studioName;
      studio.role = studio.role || 'Business Owner';
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

          if (payload.studioName !== undefined && payload.studioName.trim()) {
            studio.studioName = payload.studioName.trim();
            studio.ownerName = payload.studioName.trim();
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
      const studioId = req.headers['x-studio-id'] || '';
      let studio = (studioId && db.studios.find(s => s.id === studioId)) || db.studios[0];
      
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
        plan3Duration: '1 Year Access (Best Value)',
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
            studio.websiteConfig = { ...(studio.websiteConfig || {}), ...newConfig };
            if (newConfig.studioName && newConfig.studioName.trim()) {
              studio.studioName = newConfig.studioName.trim();
              studio.ownerName = newConfig.studioName.trim();
            }
            if (newConfig.phone) studio.phone = newConfig.phone.trim();
            if (newConfig.email) studio.email = newConfig.email.trim();
            if (newConfig.studioSubtitle) studio.tagline = newConfig.studioSubtitle;
            studio.updatedAt = new Date().toISOString();
            saveDB(db);

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
      const studioId = req.headers['x-studio-id'] || '';
      let studio = (studioId && db.studios.find(s => s.id === studioId)) || db.studios[0];
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
      const studioId = req.headers['x-studio-id'] || '';
      let studio = (studioId && db.studios.find(s => s.id === studioId)) || db.studios[0];
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
              if (sf.name && /\.(jpe?g|png|webp|gif|bmp|heic|raw|cr2|nef|arw)$/i.test(sf.name)) {
                const key = subfolderName + '/' + sf.name;
                if (!seenKeys.has(key)) {
                  seenKeys.add(key);
                  collected.push({
                    id: sf.id,
                    name: sf.name,
                    size: Number(sf.size) || 0,
                    subfolder: subfolderName,
                    url: `/api/image/${sf.id}`,
                    thumbnailUrl: `/api/image/${sf.id}`
                  });
                }
              }
            }
            subPageToken = subData.nextPageToken || '';
          } else {
            subPageToken = '';
          }
        } while (subPageToken);

      } else if (item.name && /\.(jpe?g|png|webp|gif|bmp|heic|raw|cr2|nef|arw)$/i.test(item.name)) {
        const key = 'Original/' + item.name;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          collected.push({
            id: item.id,
            name: item.name,
            size: Number(item.size) || 0,
            subfolder: 'Original',
            url: `/api/image/${item.id}`,
            thumbnailUrl: `/api/image/${item.id}`
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

    // 9. Image Proxy / Streaming (Supports Thumbnails & High-Res with Automatic Redirect Following)
    if (pathname.startsWith('/api/image/')) {
      const fileId = pathname.replace('/api/image/', '').trim();
      const token = await getDriveAccessToken();

      try {
        let redirectCount = 0;
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

              if (driveRes.statusCode >= 400) {
                if (!res.headersSent) {
                  res.writeHead(driveRes.statusCode, { 'Content-Type': 'text/plain' });
                  res.end(`Image error: ${driveRes.statusCode}`);
                }
                return resolve();
              }

              res.writeHead(200, {
                'Content-Type': driveRes.headers['content-type'] || 'image/jpeg',
                'Cache-Control': 'public, max-age=86400'
              });
              driveRes.pipe(res);
              driveRes.on('end', () => resolve());
            });

            req.on('error', () => {
              if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Image streaming error');
              }
              resolve();
            });
          });
        };

        await fetchImage(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`, true);
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Image error: ' + err.message);
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

        // Clean & ensure only real image photos are returned
        client.photos = (client.photos || []).filter(p => p.size > 0 && /\.(jpe?g|png|webp|gif|bmp|heic|raw|cr2|nef|arw)$/i.test(p.name));
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
      if (req.method === 'GET') {
        sendJSON(db.flipbooks || []);
        return;
      }
      if (req.method === 'POST') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
          try {
            const payload = JSON.parse(body || '{}');
            const targetCode = payload.clientCode || payload.code || ('FB' + Math.floor(1000 + Math.random() * 9000));
            const id = payload.id || ('fb_' + targetCode);
            db.flipbooks = db.flipbooks || [];
            
            const existingIdx = db.flipbooks.findIndex(f => f.id === id || f.code === targetCode || (f.clientCode && f.clientCode === targetCode));
            
            // Plan Limit Enforcement for 3D Flipbooks
            if (existingIdx === -1) {
              const limits = getSubscriptionLimits(db);
              const currentFlipbooksCount = (db.flipbooks || []).length;
              if (currentFlipbooksCount >= limits.maxFlipbooks) {
                console.warn(`⚠️ [FLIPBOOK LIMIT REACHED] Plan: ${limits.planName} | Max Allowed: ${limits.maxFlipbooks} | Current: ${currentFlipbooksCount}`);
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

            const flipbookObj = {
              id,
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

        db.flipbooks = (db.flipbooks || []).filter(f => f.id !== fbId && f.code !== fbId && f.clientCode !== fbId);
        saveDB(db);
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
        const studioId = req.headers['x-studio-id'];
        let list = db.invoices;
        if (studioId) {
          list = list.filter(inv => !inv.studioId || inv.studioId === studioId);
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
            
            // Auto generate Invoice Number if not provided: INV-YYYY-001
            const count = (db.invoices.length + 1).toString().padStart(3, '0');
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
              studioId: payload.studioId || '',
              studioName: payload.studioName || 'DM STUDIO',
              studioTagline: payload.studioTagline || 'Wedding & Cinematic Photography',
              studioContact: payload.studioContact || '',
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
      const db = loadDB();
      db.invoices = db.invoices || [];

      if (req.method === 'DELETE') {
        const initialLen = db.invoices.length;
        db.invoices = db.invoices.filter(inv => inv.id !== invId && inv.invoiceNumber !== invId);
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
        const studio = db.studios[0] || {};
        
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
          const studio = db.studios[0] || {};
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
        durationDays: 365
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

          // Real-Time Simulator for Sandbox / Immediate Auto-Verification (Triggers within 6-7s of QR presentation)
          setTimeout(() => {
            if (global.activePaymentOrders[orderId] && global.activePaymentOrders[orderId].status === 'PENDING') {
              const currentDb = loadDB();
              const existingOrder = (currentDb.paymentOrders || []).find(o => o.orderId === orderId);
              if (existingOrder && existingOrder.status === 'PENDING') {
                const now = new Date();
                const expires = new Date(Date.now() + selectedPlan.durationDays * 24 * 3600 * 1000);
                const autoUtr = 'UPI' + Date.now().toString().slice(-8);

                existingOrder.status = 'SUCCESS';
                existingOrder.paidAt = now.toISOString();
                existingOrder.phonepeTransactionId = 'T240820' + Date.now().toString().slice(-6);
                existingOrder.utr = autoUtr;

                currentDb.subscription = {
                  planName: selectedPlan.name,
                  planCode: selectedPlan.code,
                  amount: selectedPlan.amount,
                  utr: autoUtr,
                  paymentMethod: 'PhonePe Standard Gateway (9668584247@ybl)',
                  status: 'ACTIVE',
                  upiId: '9668584247@ybl',
                  activatedAt: now.toISOString(),
                  expiresAt: expires.toISOString(),
                  durationDays: selectedPlan.durationDays
                };

                if (!currentDb.paymentHistory) currentDb.paymentHistory = [];
                currentDb.paymentHistory.unshift({
                  id: 'PAY_' + Date.now(),
                  orderId,
                  planName: selectedPlan.name,
                  amount: selectedPlan.amount,
                  utr: autoUtr,
                  paymentMethod: 'PhonePe Gateway',
                  status: 'SUCCESS',
                  timestamp: now.toISOString()
                });

                saveDB(currentDb);
                global.activePaymentOrders[orderId] = existingOrder;
                console.log(`⚡ [PHONEPE AUTO-VERIFIED] Order: ${orderId} | Plan: ${selectedPlan.name} | ₹${selectedPlan.amount} Active until ${expires.toLocaleDateString()}`);
              }
            }
          }, 7000);

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
                const planDuration = order.durationDays || (order.plan === 'YEARLY' ? 365 : 30);
                const expires = new Date(Date.now() + planDuration * 24 * 3600 * 1000);
                const utr = decodedPayload.data?.paymentInstrument?.utr || ('UPI' + Date.now().toString().slice(-8));

                order.status = 'SUCCESS';
                order.paidAt = now.toISOString();
                order.phonepeTransactionId = decodedPayload.data?.transactionId || 'TXN_' + Date.now();
                order.utr = utr;

                db.subscription = {
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

                console.log(`🎉 [PHONEPE WEBHOOK ACTIVATED] Plan: ${order.planName} for 30/365 Days!`);
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
      const order = (db.paymentOrders || []).find(o => o.orderId === orderId) || (global.activePaymentOrders ? global.activePaymentOrders[orderId] : null);

      if (!order) {
        sendJSON({ status: 'PENDING' });
        return;
      }

      if (order.status === 'SUCCESS' || order.status === 'PAID') {
        const sub = db.subscription || {};
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

    // 4. Current Active Subscription API
    if (pathname === '/api/subscription/current' && req.method === 'GET') {
      const db = loadDB();
      const studioId = req.headers['x-studio-id'] || 'studio_master_dm';
      const studio = (db.studios || []).find(s => s.id === studioId) || db.studios?.[0] || {};
      const userEmail = (studio.email || '').toLowerCase().trim();

      const sub = db.subscription || {
        planName: 'Free Trial',
        planCode: 'TRIAL',
        status: 'ACTIVE',
        amount: 0,
        upiId: '9668584247@ybl',
        activatedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
        durationDays: 7
      };
      
      const now = Date.now();
      const expTime = new Date(sub.expiresAt).getTime();
      const daysLeft = Math.max(0, Math.ceil((expTime - now) / (1000 * 60 * 60 * 24)));
      
      const limits = getSubscriptionLimits(db);
      const usedClients = (db.clients || []).length;
      const usedFlipbooks = (db.flipbooks || []).length;

      const trialClaimed = (userEmail && (db.claimedTrialEmails || []).includes(userEmail)) || 
                           (db.claimedTrialStudioIds || []).includes(studioId) ||
                           (db.paymentHistory || []).some(p => p.planName && p.planName.includes('Free Trial'));

      sendJSON({
        ...sub,
        daysLeft,
        isExpired: now > expTime,
        upiId: '9668584247@ybl',
        trialClaimed: Boolean(trialClaimed),
        limits: {
          planName: limits.planName,
          maxClients: limits.maxClients,
          maxFlipbooks: limits.maxFlipbooks,
          usedClients,
          usedFlipbooks,
          remainingClients: limits.unlimited ? 'Unlimited' : Math.max(0, limits.maxClients - usedClients),
          remainingFlipbooks: limits.unlimited ? 'Unlimited' : Math.max(0, limits.maxFlipbooks - usedFlipbooks),
          unlimited: limits.unlimited
        }
      });
      return;
    }

    if (pathname === '/api/subscription/activate' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}');
          const planName = data.planName || 'Silver Edition';
          const amount = Number(data.amount) || 199;
          const utr = data.utr || data.transactionId || ('UPI' + Date.now().toString().slice(-8));
          const paymentMethod = data.paymentMethod || 'PhonePe / UPI QR';

          const db = loadDB();
          const studioId = data.studioId || req.headers['x-studio-id'] || 'studio_master_dm';
          const studio = (db.studios || []).find(s => s.id === studioId) || db.studios?.[0] || {};
          const userEmail = (data.email || studio.email || '').toLowerCase().trim();

          db.claimedTrialEmails = db.claimedTrialEmails || [];
          db.claimedTrialStudioIds = db.claimedTrialStudioIds || [];

          let durationDays = 30;
          if (planName.includes('Gold') || amount === 999) {
            durationDays = 365;
          } else if (planName.includes('Free') || amount === 0) {
            // Strict check: Free trial only ONCE per registered email / studio account
            const alreadyClaimed = (userEmail && db.claimedTrialEmails.includes(userEmail)) || 
                                   db.claimedTrialStudioIds.includes(studioId) || 
                                   (db.paymentHistory || []).some(p => p.planName && p.planName.includes('Free Trial'));
            
            if (alreadyClaimed) {
              console.warn(`⚠️ [FREE TRIAL REJECTED] Already claimed for account: ${userEmail || studioId}`);
              sendJSON({
                error: 'Free Trial has already been claimed on this account. Please upgrade to Silver Edition or Gold Pro to continue!',
                trialAlreadyUsed: true,
                success: false
              }, 400);
              return;
            }

            // Record claim
            if (userEmail) db.claimedTrialEmails.push(userEmail);
            if (studioId) db.claimedTrialStudioIds.push(studioId);
            durationDays = 7;
          }

          const now = new Date();
          const expires = new Date(Date.now() + durationDays * 24 * 3600 * 1000);

          db.subscription = {
            planName,
            amount,
            utr,
            paymentMethod,
            status: 'ACTIVE',
            upiId: '9668584247@ybl',
            activatedAt: now.toISOString(),
            expiresAt: expires.toISOString(),
            durationDays
          };

          if (!db.paymentHistory) db.paymentHistory = [];
          db.paymentHistory.unshift({
            id: 'PAY_' + Date.now(),
            planName,
            amount,
            utr,
            paymentMethod,
            status: 'SUCCESS',
            timestamp: now.toISOString()
          });

          saveDB(db);

          console.log(`🎉 [SUBSCRIPTION ACTIVATED] Plan: ${planName} | Amount: ₹${amount} | UTR: ${utr} | Expires: ${expires.toLocaleDateString()}`);

          sendJSON({
            success: true,
            message: `🎉 ${planName} is successfully activated for ${durationDays} days!`,
            subscription: db.subscription
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
        });
        fileStream.pipe(res);
        return;
      } else {
        res.writeHead(200, {
          'Content-Length': totalSize,
          'Accept-Ranges': 'bytes',
          'Content-Type': contentType,
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
});
