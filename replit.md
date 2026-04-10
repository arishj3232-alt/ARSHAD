# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Contains the OnlyTwo private messaging application.

## Projects

### OnlyTwo (`artifacts/only-two`)
A private 2-user real-time communication web app.

**Features:**
- Secret room code entry (code: stored in VITE_ROOM_CODE env var, default `ArshLovesTanvi`)
- Maximum 2 users enforced server-side via Firebase
- Real-time messaging via Firebase Firestore (onSnapshot, paginated)
- Presence system (online/offline, last seen, typing indicator) via Firebase RTDB
- Media sharing (images, videos, audio) via Cloudinary (NO Firebase Storage)
- Voice recording with MediaRecorder API
- WebRTC voice & video calls with signaling via Firestore
- Search messages with text highlighting (client-side filtering)
- Media gallery (shared images/videos, computed via useMemo from loaded messages)
- Cursor presence tracking (desktop only)
- **Delete for me** (hidden only for current user via `deletedFor.{userId}` map)
- **Delete for everyone** (soft delete with configurable text via admin settings)
- **View-once media** (tap to view in fullscreen, lock on close, no timer — `viewOnceViewed:true`)
- Message reply (tap or swipe, configurable via admin) with seen/delivered status
- **Reactions** with dynamic emojis set by admin, double-tap fast reaction, null-safe (`deleteField()`)
- **Link previews** — YouTube thumbnails, Spotify/Instagram cards, inline clickable links
- **Admin panel** (CTRL+SHIFT+S desktop / type adminKeyword mobile) — 4 tabs: Features, Reactions, Texts, Devices
  - Feature flag toggles: messaging, replies, reactions, uploads, view-once, video notes, voice, calls, presence, notifications
  - Custom reaction emoji set + fast reaction emoji selector
  - Reply mode: tap / swipe / both
  - Custom text: deleted message text, view-once limit reached text
  - Admin keyword (default: "laura")
  - Device management: shows logged-in devices from RTDB
- **Profile pictures** — Cloudinary upload with SHA-256 hash dedup, stored in RTDB `profiles/{userId}`
- **Activity status** — RTDB `status/{userId}` tracks: online / recording / viewingMedia / browsing / offline
  - Color dots in header: green=online, blue=recording, yellow=viewingMedia, white=browsing/offline
- **Device fingerprinting** — registered to RTDB `devices/{userId}/{deviceId}`
- Glassmorphism dark UI (pink/violet gradient theme)
- Mobile viewport: `100dvh` + `env(safe-area-inset-bottom)` padding
- Typing debounce: 1.5s before clearing typing indicator

**Production-grade features:**
- **Error boundary** — wraps the entire app; friendly error screen + reload on unhandled crashes
- **TURN server support** — ICE config includes open-relay TURN (Metered free tier) for calls across symmetric NAT. Override via `VITE_TURN_URL` / `VITE_TURN_USERNAME` / `VITE_TURN_CREDENTIAL` env vars
- **Network detection** — `useNetworkStatus` monitors RTDB `.info/connected`; shows yellow banner if connection drops
- **WebRTC listener cleanup** — all per-call `onSnapshot` unsub functions collected in `snapshotUnsubsRef`, flushed in `cleanup()`; zero listener leaks
- **Media permission errors** — classified (permission denied / no device / overconstrained) with dismissible UI
- **Rate limiting** — `useRateLimit(5, 10_000)` sliding-window limiter on message send; shows toast if exceeded
- **Soft disconnect** — on `leaveRoom()` or tab close, updates presence to `online: false + lastSeenTs` instead of deleting
- **Presence debounce** — 150ms batch on Firestore snapshots to prevent flicker

**Tech Stack:**
- React + Vite + TypeScript
- TailwindCSS v4
- Firebase (Firestore, Realtime Database — NO Storage, uses Cloudinary instead)
- WebRTC (browser native RTCPeerConnection)
- Framer Motion
- Wouter (routing)
- Cloudinary (cloud: `dwqgqkcac`, preset: `onlytwo_upload`)

**Firebase Project:** `arshlovestanvi`
**RTDB URL:** `https://arshlovestanvi-default-rtdb.asia-southeast1.firebasedatabase.app`

**Key Files:**
- `src/lib/firebase.ts` — Firebase initialization
- `src/hooks/useSession.ts` — Room entry, presence, typing
- `src/hooks/useMessages.ts` — Firestore chat with delete-for-me, delete-for-everyone, view-once, reactions (deleteField)
- `src/hooks/useAdmin.ts` — Admin settings from RTDB with full AdminSettings type
- `src/hooks/useProfile.ts` — Profile picture (Cloudinary upload + SHA-256 hash dedup via RTDB)
- `src/hooks/useUserStatus.ts` — RTDB activity tracking; useUserStatus (write) + useOtherUserStatus (read)
- `src/hooks/useWebRTC.ts` — WebRTC calls (audio/video)
- `src/hooks/useMediaUpload.ts` — Cloudinary upload
- `src/hooks/useCursorPresence.ts` — Live cursor tracking
- `src/pages/EntryPage.tsx` — Room code login
- `src/pages/ChatPage.tsx` — Main chat UI (safe-area, typing debounce, DP header, status dots)
- `src/components/ChatMessage.tsx` — Message bubble (double-tap fast react, delete context menu, view-once fullscreen, cyan deleted glow)
- `src/components/AdminPanel.tsx` — 4-tab admin panel (features, reactions, texts, devices)
- `src/components/CallOverlay.tsx` — Voice/video call UI
- `src/components/VoiceRecorder.tsx` — Audio recording
- `src/components/SearchPanel.tsx` — Message search
- `src/components/GalleryPanel.tsx` — Media gallery panel
- `src/components/CursorPresence.tsx` — Cursor overlay
- `src/components/LinkPreview.tsx` — Smart link previews

**RTDB Structure:**
- `admin/settings` — AdminSettings object
- `profiles/{userId}` — `{ dpUrl, dpHash }`
- `status/{userId}` — `{ status: UserActivityStatus, ts: number }`
- `devices/{userId}/{deviceId}` — `{ browser, platform, lastActive, online }`
- `presence/{roomId}/{userId}` — online/offline/lastSeen
- `typing/{roomId}/{userId}` — typing state

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/only-two run dev` — run OnlyTwo frontend locally
