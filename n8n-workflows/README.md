# Dignitate n8n Workflow

Single importable n8n workflow for automated content generation.

## Workflow File

`/Users/srikarreddy/Downloads/DemContent/dignitate-workflow-v3-stable.json`

## Setup

### 1. Import Workflow
In n8n: **Settings -> Import from File** -> select `dignitate-workflow-v3-stable.json`

### 2. Set Environment Variables
```
ADMIN_CHAT_ID=your_telegram_chat_id
OPENROUTER_API_KEY=your_openrouter_api_key
FAL_KEY=your_fal_api_key
ELEVENLABS_API_KEY=your_elevenlabs_api_key
ELEVENLABS_VOICE_ID=your_cloned_voice_id
REMOTION_SERVICE_URL=https://your-remotion-service.railway.app
COMPOSIO_API_KEY=your_composio_api_key

# Composio Connection IDs (get from Composio dashboard)
COMPOSIO_INSTAGRAM_CONNECTION_ID=
COMPOSIO_LINKEDIN_CONNECTION_ID=
COMPOSIO_TWITTER_CONNECTION_ID=
COMPOSIO_TIKTOK_CONNECTION_ID=
COMPOSIO_YOUTUBE_CONNECTION_ID=
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
| `/approve` | Post approved content |
| `/reject` | Discard content |
