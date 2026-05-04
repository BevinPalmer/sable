# Claude Retouching Brief Chat (Next.js 14)

Minimal full-screen chat UI that streams responses from Anthropic Claude.

## Setup

1) Install dependencies:

```bash
npm install
```

2) Create `.env.local`:

```bash
cp .env.local.example .env.local
```

Then edit `.env.local` and set `ANTHROPIC_API_KEY`.

3) Run dev server:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Notes

- Deployable to Vercel: add `ANTHROPIC_API_KEY` as a Project Environment Variable.
- The API route `app/api/chat/route.ts` runs on the Edge runtime for streaming.

