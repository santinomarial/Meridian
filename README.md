# Meridian

Meridian is a real-time collaborative browser IDE for engineering teams. It provides a polished workspace where developers can edit code, manage project files, view live collaborators, discuss changes, review notes, and work inside an IDE-style interface from the browser.

## Overview

Meridian is built as a production-style frontend for a collaborative code editor. It focuses on the frontend workspace experience: a professional IDE layout, file explorer, editor tabs, terminal panel, collaboration sidebar, live chat, review notes, theme support, and a premium landing/auth screen.

The long-term goal is to connect this frontend to a real-time backend using WebSockets, Yjs, Redis, PostgreSQL, and Prisma.

## Features

- Professional browser IDE workspace
- File explorer with nested project structure
- Editor tabs and active file navigation
- Monaco-powered code editor experience
- Dark and light theme support
- Live collaborator panel with user presence
- Mock live chat for collaboration sessions
- Review notes panel for code feedback
- Terminal/output/debug/AI assistant bottom panel
- Status bar with editor metadata
- Premium split-screen landing and auth UI
- Responsive frontend structure built for future backend integration

## Tech Stack

### Frontend

- React 18
- TypeScript
- Vite
- Tailwind CSS
- Zustand
- Monaco Editor
- React Router

### Planned Backend

- NestJS
- WebSockets / Socket.IO
- Yjs
- Redis Pub/Sub or Redis Streams
- PostgreSQL
- Prisma
- Authentication with Clerk or custom auth

## Project Structure

```text
client/
  src/
    components/
      layout/
      workspace/
    constants/
    data/
    hooks/
    pages/
    store/
    types/
    App.tsx
    index.css
