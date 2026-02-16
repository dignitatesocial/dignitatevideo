# Dignitate n8n Workflow

Single importable n8n workflow for automated content generation.

## Workflow File

`/Users/srikarreddy/Downloads/DemContent/dignitate-workflow-v3-stable.json`

## Optional Cleanup Workflow (Supabase)

To avoid Supabase Storage growing forever, import:

`/Users/srikarreddy/Downloads/DemContent/supabase-video-cleanup-workflow.json`

This runs daily and deletes videos older than `SUPABASE_VIDEO_RETENTION_DAYS` (default: `3` days).

## Setup

### 1. Import Workflow
In n8n: **Settings -> Import from File** -> select `dignitate-workflow-v3-stable.json`

### 2. Set Environment Variables
```
# NOTE: Current workflow build has API keys hardcoded for testing to avoid n8n env var issues.
# If you later want to switch back to env vars, revert the header/body expressions in the workflow.
#
# Optional Supabase cleanup workflow still expects env vars:
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
SUPABASE_VIDEO_RETENTION_DAYS=3
```

### 3. Add Credentials
Create these credentials in n8n:
- **Telegram Bot** - from @BotFather
- **OpenRouter** - [openrouter.ai](https://openrouter.ai)
- **fal.ai API Key** - [fal.ai](https://fal.ai)
- **ElevenLabs API Key** - [elevenlabs.io](https://elevenlabs.io)
- **Composio API Key** - [composio.dev](https://composio.dev)
- **Twitter OAuth** (optional - for trends)
- **Reddit OAuth** (optional - for trends)

## Commands

| Command | Action |
|---------|--------|
| `/carousel [topic]` | Generate a carousel |
| `/video [topic]` | Generate a video |
| `/trends` | Check trending topics |
| `/status` | System status |
| `Approve` (button) | Post approved content |
| `Regenerate` (button) | Regenerate content |
