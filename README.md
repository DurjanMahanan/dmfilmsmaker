# 📸 DM Films - Wedding Photo Selection Web App

एक complete, professional और luxury **Wedding Photo Management & Client Selection System** जिसे HTML5, CSS3, Vanilla JavaScript, **Cloudflare Worker**, और **Google Drive API (v3)** के साथ तैयार किया गया है।

---

## ✨ मुख्य विशेषताएँ (Key Features)

1. **Google Drive Storage Backend**:
   - सभी photos आपके Google Drive में सुरक्षित तरीके से upload होती हैं।
   - Google Drive का UI client को **कभी दिखाई नहीं देगा**; सिर्फ आपकी branded luxury dark-gold website दिखेगी।
2. **Zero Credential Exposure (100% Secure)**:
   - Google Service Account keys और Passwords केवल Cloudflare Worker environment में रहते हैं।
   - Frontend HTML/JS में कोई secret या API key expose नहीं होती।
3. **Automatic Folder Hierarchy**:
   - Admin जब भी नया client बनाता है, Google Drive में automatically nested folder structure बन जाता है:
     ```text
     Google Drive
     └── Wedding Photo Studio (Master Root Folder)
         └── [Client Name] - [Event Name] ([Client ID])
             ├── 01_Original_Photos
             ├── 02_Selected_Photos
             └── 03_Thumbnails
     ```
4. **Admin Studio Dashboard (`admin.html`)**:
   - Secure login & session management
   - Clients create / activate / deactivate
   - Multi-photo **Drag & Drop Uploader** with live percentage & progress bar
   - Client selection review & 1-click **Lightroom/Photoshop filename list copy**
   - **Export to CSV / Excel**
   - Direct link copy & WhatsApp sharing generator
5. **Client Selection Portal (`client.html?code=XYZ`)**:
   - Luxury header with Event Title & Couple Name
   - **Sticky live selection counter**: `Selected: 25 / 350` with progress bar
   - Instant Search & Filter tabs (`All Photos`, `Selected Only ⭐`, `Unselected`)
   - Studio Lightbox with full-screen zoom, keyboard arrows & spacebar selection
   - Submit Selection confirmation popup with custom client notes
   - Selection results synced automatically to Google Drive as `client_selection.json`
6. **Instant Offline / Demo Mode**:
   - Worker deploy करने से पहले भी आप सीधे `index.html` या `admin.html` खोलकर full UI, uploader, selection, और stats को locally test कर सकते हैं!

---

## 📁 Project Structure

```text
DM Photo Wapsite/
├── index.html                   # Luxury Home & Client Code Search Portal
├── admin.html                   # Studio Admin & Photo Management Dashboard
├── client.html                  # Client Gallery & Photo Selection Portal
├── css/
│   ├── main.css                 # Global Dark Gold Glassmorphic Design System
│   ├── admin.css                # Admin Dashboard, Uploader & Table Styles
│   └── client.css               # Gallery Grid, Sticky Bar, Lightbox Styles
├── js/
│   ├── config.js                # Dynamic API & Storage Configuration
│   ├── api.js                   # API Client & Google Drive Service Layer
│   ├── admin.js                 # Admin Controller, Queue Uploader & Stats
│   └── client.js                # Client Portal Controller, Filter & Selection Cart
├── worker/
│   ├── worker.js                # Cloudflare Worker API & Google Drive v3 Integration
│   ├── wrangler.toml            # Cloudflare Worker Config
│   └── package.json             # Worker Deployment Scripts
├── SETUP_GUIDE.md               # Step-by-Step Google Cloud & Cloudflare Deployment Guide (Hindi + English)
└── README.md                    # Project Overview & Quickstart
```

---

## 🚀 Quick Start (तुरंत चलाकर देखें)

1. इस folder में मौजूद `index.html` को किसी भी web browser (Chrome, Edge, Firefox) में double click करके खोलें।
2. **Admin Dashboard देखें**:
   - Right top पर **"Admin / Studio Login"** दबाएँ (या `admin.html` खोलें)।
   - Password डालें: `admin123`
   - **"+ Create New Client"** दबाएँ और नया client बनाएँ।
   - **"Upload Photos"** tab में जाकर photos drag & drop करें।
3. **Client Selection Portal देखें**:
   - `client.html?code=RAJ2026` खोलें (या Admin में client के सामने **"📋 Link"** copy करके खोलें)।
   - Photos पर click करके select करें, filter बदलें, और **"Submit Selection"** दबाएँ।
   - वापिस Admin Dashboard ➔ **"Client Selections"** में जाकर client के चुने हुए photos और Lightroom filter list देखें!

---

## ⚙️ Live Production Deployment (Google Drive & Cloudflare Worker)

पूरा step-by-step गाइड (Google Cloud Project बनाना, Service Account बनाना, Google Drive folder share करना, और Cloudflare Worker deploy करना) [SETUP_GUIDE.md](file:///c:/Users/DM%20Films%20Maker/Documents/DM%20Photo%20Wapsite/SETUP_GUIDE.md) में विस्तृत रूप से दिया गया है।
