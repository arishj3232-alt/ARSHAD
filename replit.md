# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Contains the OnlyTwo private messaging application.

## Projects

### OnlyTwo (`artifacts/only-two`)
A private 2-user real-time communication web app.

**Features:**
- Secret room code entry (code: stored in VITE_ROOM_CODE env var)
- Maximum 2 users enforced server-side via Firebase
- Real-time messaging via Firebase Firestore (onSnapshot)
- Presence system (online/offline, last seen, typing indicator) via Firebase RTDB
- Media sharing (images, videos, audio) via Firebase Storage
- Voice recording with MediaRecorder API
- WebRTC voice & video calls with signaling via Firestore
- Search messages with text highlighting
- Media gallery (shared images/videos)
- Cursor presence tracking
- Delete for everyone (soft delete, marks as deleted)
- Message reply / seen/delivered status
- Glassmorphism dark UI (pink/violet gradient theme)

**Tech Stack:**
- React + Vite + TypeScript
- TailwindCSS v4
- Firebase (Firestore, Storage, Realtime Database)
- WebRTC (simple-peer)
- Framer Motion
- Wouter (routing)

**Firebase Project:** arshlovestanvi
**RTDB URL:** https://arshlovestanvi-default-rtdb.firebaseio.com

**Key Files:**
- `src/lib/firebase.ts` — Firebase initialization
- `src/hooks/useSession.ts` — Room entry, presence, typing
- `src/hooks/useMessages.ts` — Firestore chat (paginated)
- `src/hooks/useWebRTC.ts` — WebRTC calls (audio/video)
- `src/hooks/useMediaUpload.ts` — Firebase Storage upload
- `src/hooks/useCursorPresence.ts` — Live cursor tracking
- `src/hooks/useGallery.ts` — Media gallery
- `src/pages/EntryPage.tsx` — Room code login
- `src/pages/ChatPage.tsx` — Main chat UI
- `src/components/ChatMessage.tsx` — Message bubble
- `src/components/CallOverlay.tsx` — Voice/video call UI
- `src/components/VoiceRecorder.tsx` — Audio recording
- `src/components/SearchPanel.tsx` — Message search
- `src/components/GalleryPanel.tsx` — Media gallery panel
- `src/components/CursorPresence.tsx` — Cursor overlay

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM (for API server)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally
