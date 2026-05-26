# OpenMAIC Cloudflare Deployment Guide

## Overview

This guide covers deploying OpenMAIC using a hybrid approach:
- **Frontend**: Cloudflare Pages (static Next.js export)
- **Backend API**: Railway/Render (Node.js server for LangGraph orchestration)

## Prerequisites

- Node.js v22+
- pnpm v10+
- Wrangler CLI installed
- Cloudflare account (free tier)
- Railway/Render account (free tier)

## Frontend Deployment (Cloudflare Pages)

### 1. Install Dependencies

\`\`\`bash
cd ~/Notebooks/workspace/OpenMAIC-main
pnpm install
\`\`\`

### 2. Configure Static Export

The `next.config.js` file is already configured for static export with:
- `output: 'export'` enabled
- Image optimization disabled
- Trailing slashes enabled

### 3. Build Static Site

\`\`\`bash
pnpm run build
\`\`\`

This generates the static files in the `./out` directory.

### 4. Deploy to Cloudflare Pages

Option A - Using Wrangler CLI:
\`\`\`bash
wrangler pages deploy ./out --project-name=openmaic-frontend
\`\`\`

Option B - Using Cloudflare Dashboard:
1. Go to Cloudflare Dashboard → Pages
2. Create new project → Upload assets
3. Upload the `./out` directory
4. Set environment variables (see below)

### 5. Environment Variables

Set these in Cloudflare Pages Settings → Environment Variables:
\`\`\`
NEXT_PUBLIC_API_URL=https://your-backend-url.railway.app
\`\`\`

## Backend Deployment (Railway/Render)

### Option A: Railway

1. Create new project on Railway
2. Connect to GitHub repo (THU-MAIC/OpenMAIC)
3. Configure build settings:
   - **Build Command**: `pnpm install && pnpm run build:api`
   - **Start Command**: `pnpm run start:api`
4. Set environment variables from `.env.example`
5. Deploy

### Option B: Render

1. Create new Web Service on Render
2. Connect GitHub repo
3. Configure:
   - **Environment**: Node
   - **Build Command**: `pnpm install && pnpm run build:api`
   - **Start Command**: `pnpm run start:api`
4. Set environment variables
5. Deploy

## API Backend Separation

The backend API needs to be separated from the frontend. Key points:

1. **API Routes**: Move `/app/api/*` to a standalone Express/Fastify server
2. **Environment Variables**: Configure LLM provider keys in Railway/Render
3. **CORS**: Enable CORS for Cloudflare Pages domain
4. **Database**: Use Cloudflare D1 or external Postgres/MySQL

## Post-Deployment Configuration

1. **Update Frontend API URL**:
   \`\`\`bash
   # In Cloudflare Pages settings
   NEXT_PUBLIC_API_URL=https://your-backend.railway.app
   \`\`\`

2. **Configure Backend CORS**:
   \`\`\`typescript
   // Add to backend API
   app.use(cors({
     origin: 'https://openmaic-frontend.pages.dev',
     credentials: true
   }));
   \`\`\`

3. **Test the Deployment**:
   - Visit Cloudflare Pages URL
   - Test API calls to Railway/Render backend
   - Verify real-time features work

## Troubleshooting

### Build Errors
- Ensure Node.js v22+ is installed
- Check that all dependencies install correctly
- Verify `output: 'export'` in next.config.js

### API Connection Issues
- Check CORS configuration on backend
- Verify NEXT_PUBLIC_API_URL is set correctly
- Check Railway/Render logs for errors

### Real-time Features Not Working
- Ensure WebSocket support is enabled on Railway/Render
- Verify LangGraph orchestration is running
- Check browser console for connection errors

## Cost Breakdown (Monthly)

| Service | Plan | Cost |
|---------|------|------|
| Cloudflare Pages | Free | $0 |
| Cloudflare Workers | Free (100k requests/day) | $0 |
| Railway | Free (512MB RAM, $5 free trial) | $0 |
| Render | Free (750 hours/month) | $0 |
| **Total** | | **$0** |

## Next Steps

1. ✅ Complete frontend static export setup
2. ⏳ Create standalone backend API server
3. ⏳ Deploy backend to Railway/Render
4. ⏳ Configure CORS and test integrations
5. ⏳ Update documentation with production URLs
