# TAW YouTube — Live YouTube Translation

Hear any YouTube video in your language. Live AI dubbing runs in a Chrome MV3 extension using your own OpenAI API key.

Chrome extension features:

- **Smart captions** — default mode. Reuses English YouTube captions when available, briefly pauses to pre-translate a buffer, then shows English + Vietnamese together without dubbing.
- Click any English word in Smart captions to see a short Vietnamese meaning in context.
- 13 target languages.
- No app server, account system, analytics, or telemetry.
- The API key is stored locally in Chrome extension storage.

## Install

1. Clone or download this repo.
2. Open `chrome://extensions`.
3. Toggle **Developer mode**.
4. Click **Load unpacked**.
5. Select this folder.
6. Pin **TAW YouTube** to the toolbar.

## Use

1. Open any YouTube video.
2. Click the TAW YouTube icon.
3. Paste your OpenAI API key from <https://platform.openai.com/api-keys>.
4. Pick a target language.
5. Click **Start**.
6. Drag or resize the in-page translation panel as needed.

## How It Works

```
popup <--BACKGROUND_STATE_UPDATE-- background <--CONTENT_STATE-- content (YouTube page)
       ----START / UPDATE_SETTINGS-->          ----CONTENT_START-->
```

- `popup.html` / `popup.js` render settings and send user actions.
- `background.js` owns session state, persists settings, and injects the content script when needed.
- `content.js` renders the overlay and runs the OpenAI caption translation pipeline:
  - **Smart captions**: gets English YouTube caption text and timestamps, translates captions in batches with `chat/completions`, then updates the dual-sub overlay based on `video.currentTime`.

## Privacy

TAW YouTube does not collect, store, or sell personal data. Your OpenAI API key stays in local Chrome extension storage and is only sent to `api.openai.com` for requests you start. Captured YouTube audio is sent to OpenAI for translation and speech generation.

## Build A Release Zip

```bash
./pack.sh
```

The script reads the version from `manifest.json`, excludes `.git`, `.DS_Store`, and `node_modules`, then writes a zip to your home directory.

## Development Checks

```bash
node --check content.js
node --check background.js
node --check popup.js
```

Manual test by loading the folder as an unpacked extension and trying both tiers on a YouTube video.

## License

[MIT](LICENSE)
