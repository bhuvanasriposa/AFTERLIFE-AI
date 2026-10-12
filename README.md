# AFTERLIFE AI

**Every object has a second story.**

AFTERLIFE AI helps you decide whether a damaged, unwanted or ordinary object should be **repaired, repurposed or recycled**. You upload a photo. An open-weight multimodal model (Gemma 4) reports only what it can see, says what it cannot tell, and asks for the single most useful extra photo or detail. You supply it, the model updates its assessment, and you get three practical pathways with steps, materials, difficulty and safety cautions.

> Status: early prototype (v0.1). The functional core is implemented and unit-tested. See [What works](#what-works-and-what-needs-setup).

## The Evidence Loop

```
Observation → Missing Evidence → User Input → Updated Assessment → Action Plan
```

1. **Observation**: the model lists what is *visible*, separately from what it merely *infers*.
2. **Missing evidence**: it names what is uncertain and asks for the one most useful photo or detail.
3. **User input**: you add a photo, a written detail, or choose to continue without more evidence.
4. **Updated assessment**: it revises its view, explains what changed, and you can compare initial and updated side by side.
5. **Action plan**: three pathways (repair, repurpose, recycle), each with a fit rating, steps, materials, tools, difficulty, time, safety cautions and what remains uncertain.

The model's "confidence" is its own estimate of how well the photos support its identification. It is not a measured accuracy.

## What works, and what needs setup

| Feature | Status |
| --- | --- |
| Image upload (drag and drop, browse, paste, phone camera), client-side resize, type and size checks | Works |
| Initial assessment: visible vs inferred vs uncertain | Works, needs your API key |
| Evidence request, with photo and/or text, or "proceed without evidence" | Works, needs your API key |
| Updated assessment and side-by-side comparison | Works, needs your API key |
| Three pathways with steps, materials, tools, difficulty, safety | Works, needs your API key |
| API key kept server-side, never in browser code | Works |
| Error handling (bad files, quota, timeouts, bad model output, missing key) | Works |
| Download report as JSON | Works |
| Automated tests (39) | Pass without a key; they use mocked model replies |
| Live Gemma 4 responses | **Not verified in this repository's CI.** Needs a real key; check it with your own photo |
| Accounts, saved history, multi-photo uploads, offline or self-hosted model | Not implemented |

Nothing is faked. If no key is configured, the app says so and analysis is switched off. It never invents a response.

## Quick start (beginner friendly)

You need **Node.js 18.17 or newer** (free). Install it from <https://nodejs.org> (choose the LTS version).

1. **Download this project** and unzip it. Open a terminal inside the `afterlife-ai` folder.
   - Windows: open the folder, click the address bar, type `cmd`, press Enter.
   - Mac: right-click the folder and choose "New Terminal at Folder".
2. **Get a free API key** at <https://aistudio.google.com/apikey> (sign in with a Google account). No payment details are required to create one. Free-tier limits and terms are set by Google and can change, so check them there.
3. **Create your settings file.**
   - Windows: `copy .env.example .env`
   - Mac or Linux: `cp .env.example .env`
4. **Open `.env`** in any text editor and replace `your_key_here` with your key. Save.
5. **Start the app:**
   ```
   npm start
   ```
6. Open <http://127.0.0.1:3000> in your browser. The pill at the top should say **Model ready**.

There is nothing to install with `npm install`: the project has no dependencies.

### Configuration

All settings live in `.env` (see `.env.example`).

| Variable | Default | Meaning |
| --- | --- | --- |
| `GEMINI_API_KEY` | none | Your key. Stays on the server. |
| `GEMMA_MODEL` | `gemma-4-26b-a4b-it` | Model ID. `gemma-4-31b-it` is stronger but slower. |
| `PORT` | `3000` | Port to listen on. |
| `HOST` | `127.0.0.1` | Use `0.0.0.0` only when deploying to a host that requires it. |
| `RATE_LIMIT_PER_MINUTE` | `12` | Per-visitor limit on analysis requests, to protect your free quota. |

## How the model is used

Gemma 4 is an open-weight model family. This project calls it through Google's hosted Gemini API, so you do not need a GPU. That means your photos are sent to Google to run the model. Do not upload sensitive images (faces, documents, addresses), and read Google's current terms for free-tier data use.

All model access lives in **one file**, `src/model/gemmaClient.js`. Prompts are in `src/model/prompts.js` and output checking is in `src/model/validate.js`. To use a different provider or a self-hosted model, replace `generate()` in `gemmaClient.js` and keep its signature. No such alternative is included yet.

## Honesty and safety design

- The prompt requires the model to separate **visible** facts from **inferences** and to list what is **uncertain**.
- Text found inside images, and your written notes, are passed as quoted, unverified data and are never treated as instructions.
- Every pathway has its own **safety cautions**. For electrics, batteries, gas, chemicals and similar hazards the model is told to recommend a professional or an authorised recycling point.
- Model replies are validated. Malformed output is retried once, then reported as an error. Nothing is silently patched in.
- The model cannot see inside an object. Treat results as a well-informed second opinion, not a guarantee.

## Architecture

```
public/            browser UI (plain HTML, CSS, JS; no build step, no keys)
server.js          small HTTP server: static files, /api routes, limits, security headers
src/handlers.js    application logic and error mapping
src/model/
  gemmaClient.js   the only code that talks to the model provider
  prompts.js       prompt text and schema
  validate.js      input and output validation
test/              Node's built-in test runner
```

API routes:

- `GET /api/health` returns `{ ok, configured, model }`.
- `POST /api/assess` takes `{ image, note? }` and returns `{ assessment }`.
- `POST /api/refine` takes `{ image, initial, evidence }` and returns `{ updated }`.

## Tests

```
npm test
```

The tests use Node's built-in runner and need no key or network. They check validation, the model client (with a mocked `fetch`), the handlers, and the HTTP server (security headers, path traversal, size and rate limits, error mapping). The canned model replies in `test/fixtures.js` are used only by tests, never by the app.

## Deploying publicly

- Never commit `.env`. It is already in `.gitignore`.
- Set `GEMINI_API_KEY` as an environment variable or secret on your host, and set `HOST=0.0.0.0`.
- A public site spends *your* free quota. Keep `RATE_LIMIT_PER_MINUTE` low, and consider adding authentication before sharing widely.
- The built-in rate limiter is per process and in memory. Put a real proxy or gateway in front for serious use.

## Known limitations

- iPhone HEIC photos may need converting to JPG before upload.
- One initial photo and one evidence photo per run.
- Output quality depends on photo quality and on the model. Results can be wrong.
- English-only interface and prompts.

## Contributing

Issues and pull requests are welcome. Please run `npm test` and `npm run check` first.

## License

MIT. See [LICENSE](LICENSE).
