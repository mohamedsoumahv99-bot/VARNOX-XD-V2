<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:7B2FBE,50:00D4FF,100:7B2FBE&height=200&section=header&text=VARNOX%20XD%20V2&fontSize=60&fontColor=ffffff&animation=fadeIn&fontAlignY=38&desc=WhatsApp%20Bot%20%7C%20Web%20Pairing%20Panel&descAlignY=60&descColor=00D4FF" width="100%"/>

<br/>

[![Typing SVG](https://readme-typing-svg.demolab.com?font=Fira+Code&size=22&pause=800&color=00D4FF&center=true&vCenter=true&width=600&lines=🤖+VARNOX+XD+V2+—+WhatsApp+Bot;🌐+Web+Pairing+Panel+on+Render;⚡+Deploy+in+1+Click+•+24%2F7+Online;✅+No+Errors+•+Pro+Grade+Code)](https://git.io/typing-svg)

<br/>

<a href="https://github.com/Med12-q/VARNOX-XD-V2/stargazers">
  <img src="https://img.shields.io/github/stars/Med12-q/VARNOX-XD-V2?style=for-the-badge&logo=github&color=7B2FBE&labelColor=0d1117" alt="Stars"/>
</a>
<a href="https://github.com/Med12-q/VARNOX-XD-V2/network/members">
  <img src="https://img.shields.io/github/forks/Med12-q/VARNOX-XD-V2?style=for-the-badge&logo=github&color=00D4FF&labelColor=0d1117" alt="Forks"/>
</a>
<img src="https://img.shields.io/badge/Node.js-18%2B-brightgreen?style=for-the-badge&logo=node.js&labelColor=0d1117"/>
<img src="https://img.shields.io/badge/Render-Deploy-46E3B7?style=for-the-badge&logo=render&labelColor=0d1117"/>
<img src="https://img.shields.io/badge/WhatsApp-Baileys-25D366?style=for-the-badge&logo=whatsapp&labelColor=0d1117"/>
<img src="https://img.shields.io/badge/Status-Online%20247-00ff88?style=for-the-badge&logo=statuspage&labelColor=0d1117"/>

</div>

---

<div align="center">

## 🌐 Deploy on Render — 1 Click

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Med12-q/VARNOX-XD-V2)

</div>

---

## ✨ Features

```
╔══════════════════════════════════════════════════════╗
║  🌐  Web Pairing Panel — deployed on Render          ║
║  ⚡  Instant pairing code via WhatsApp               ║
║  🛡️  100+ Commands — AI, Stickers, Media, Games     ║
║  🔒  Anti-Bad Word, Anti-Link, Anti-Delete           ║
║  🎵  Music & Video Download (YouTube, Spotify)       ║
║  🤖  AI Chatbot + Image Generation                   ║
║  👑  Full Admin Management                           ║
║  📊  Group Stats & Top Members                       ║
╚══════════════════════════════════════════════════════╝
```

---

## 🚀 Deploy on Render (Free, 24/7)

### Step 1 — Fork the Repository
```
https://github.com/Med12-q/VARNOX-XD-V2
```
Click **Fork** (top right) to copy the repo to your account.

### Step 2 — Deploy on Render
1. Go to **https://render.com** → Sign in / Sign up (free)
2. Click **New +** → **Web Service**
3. Connect your GitHub account and select: `VARNOX-XD-V2`
4. Fill in the settings:
   - **Name:** `varnox-xd-v2` (or any name you like)
   - **Region:** Choose the nearest to you
   - **Branch:** `main`
   - **Runtime:** `Node`
   - **Build Command:** `npm install --legacy-peer-deps`
   - **Start Command:** `npm start`
   - **Instance Type:** `Free`
5. Under **Environment Variables**, add:
   - `OWNER_NUMBER` → your WhatsApp number without `+` (e.g. `224610835573`)
6. Click **Create Web Service** ✅

> Render will automatically detect `render.yaml` in the repo and pre-fill the settings.

### Step 3 — Get Your Pairing Link
Your panel will be live at:
```
https://varnox-xd-v2.onrender.com
```
*(or the custom URL Render assigns you)*

Enter your WhatsApp number → Get the 8-digit pairing code → Link your bot!

---

## 🔗 How Pairing Works

```
┌─────────────────────────────────────────────────────┐
│  1. Visit your Render URL                           │
│  2. Enter your WhatsApp number (with country code)  │
│  3. Click "Get Pairing Code"                        │
│  4. Open WhatsApp → Linked Devices → Link a Device  │
│  5. Enter the 8-digit code                          │
│  6. Bot connected! ✅                               │
└─────────────────────────────────────────────────────┘
```

---

## 📋 Commands List

<details>
<summary><b>🛡️ Group Management</b></summary>

| Command | Description |
|---------|-------------|
| `.kick @user` | Kick a member |
| `.promote @user` | Promote to admin |
| `.demote @user` | Remove admin |
| `.ban @user` | Ban a member |
| `.tagall` | Tag all members |
| `.hidetag` | Tag all (hidden) |
| `.groupinfo` | Show group info |

</details>

<details>
<summary><b>🔒 Anti-Spam & Protection</b></summary>

| Command | Description |
|---------|-------------|
| `.antilink on/off` | Block links |
| `.antibadword on/off` | Block bad words |
| `.antidelete on/off` | Show deleted msgs |
| `.antibot on/off` | Block other bots |
| `.anticall on/off` | Reject calls |

</details>

<details>
<summary><b>🎵 Media & Download</b></summary>

| Command | Description |
|---------|-------------|
| `.play [song]` | Play music |
| `.song [name]` | Download audio |
| `.video [name]` | Download video |
| `.tiktok [url]` | Download TikTok |
| `.spotify [url]` | Spotify download |

</details>

<details>
<summary><b>🤖 AI & Fun</b></summary>

| Command | Description |
|---------|-------------|
| `.ai [question]` | Ask AI |
| `.imagine [prompt]` | Generate image |
| `.sticker` | Create sticker |
| `.attp [text]` | Animated sticker |
| `.joke` | Random joke |
| `.meme` | Random meme |
| `.tictactoe` | Play game |

</details>

---

## ⚙️ Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `OWNER_NUMBER` | Your WhatsApp number (no `+`) | ✅ Yes |
| `PORT` | Auto-set by Render (default `10000`) | Auto |
| `PREFIX` | Command prefix (default `.`) | No |
| `BOT_NAME` | Bot display name | No |

---

## 📁 Project Structure

```
VARNOX-XD-V2/
├── 📄 web.js              # Entry point — Express pairing server
├── 📄 index.js            # Bot core (WhatsApp connection)
├── 📄 main.js             # Message handler & commands router
├── 📄 config.js           # Bot configuration & API keys
├── 📄 settings.js         # Bot settings (name, owner, etc.)
├── 📄 render.yaml         # Render deployment config
├── 📄 package.json        # Node.js dependencies
├── 📁 public/
│   └── index.html         # Pairing panel UI
├── 📁 commands/           # 100+ command handlers
├── 📁 lib/                # Core utilities & helpers
├── 📁 data/               # JSON data stores
└── 📁 assets/             # Media assets
```

---

## 🛠️ Useful URLs (after deploy)

| URL | Description |
|-----|-------------|
| `/` | Pairing panel |
| `/health` | Service health check |
| `/debug` | Full diagnostic info |
| `/bot-logs` | Live bot logs |
| `/botStatus` | Bot connection status |
| `/reset` | Reset session (re-pair) |
| `/start-bot` | Force-start bot manually |

---

<div align="center">

## ⭐ Support

If this helped you, please **star the repo** 🌟

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:7B2FBE,50:00D4FF,100:7B2FBE&height=120&section=footer&animation=fadeIn" width="100%"/>

**Made with 💜 by ʋαɾɳσx ❍ғғɪᴄɪᴀʟ**

</div>
