# TAW YouTube — Chrome Web Store Submission Metadata

## Name

```
TAW YouTube — Live Translation
```

## Short Description

```
Hear YouTube videos in your language with OpenAI-powered live dubbing. Bring your own OpenAI API key.
```

## Category

`Productivity`

## Long Description

```
TAW YouTube translates YouTube videos in the language you choose. Click the extension icon, paste your OpenAI API key, pick a mode and target language, then press Start.

Features
• Smart captions mode reuses English YouTube captions when available, briefly pauses to pre-translate a buffer, and shows English + Vietnamese together without dubbing.
• Click an English word to get a short Vietnamese meaning in context.
• 13 target languages: English, Vietnamese, Japanese, Korean, Chinese, French, Spanish, German, Portuguese, Hindi, Indonesian, Italian, Russian.
• Optional source captions.
• Translation history.
• Draggable, resizable in-page panel.
• 60-minute auto-stop.

Privacy
• No app account.
• No telemetry or analytics.
• Your OpenAI API key is stored locally in Chrome extension storage.
• Audio is sent to OpenAI only while a translation session is running.
• The extension does not download videos or save transcripts.
```

## Single Purpose Statement

```
TAW YouTube translates available YouTube captions on the active tab into a language the user picks and displays the source and translation together.
```

## Permission Justifications

### `activeTab`

Used so that when the user clicks the toolbar icon and presses Start, the extension can run on the YouTube tab they are viewing.

### `scripting`

Used by the background service worker to inject the content script into an existing YouTube tab after the user presses Start.

### `storage`

Used to remember the user's OpenAI API key and local preferences such as mode, target language, voice, volume, and source-caption toggle.

### `webRequest`

Used to observe YouTube caption requests so the extension can reuse signed caption URLs for subtitle-first translation. It does not collect browsing history.

### YouTube host permissions

Required to capture audio from the active YouTube video and render the translation overlay.

### `https://api.openai.com/*`

Required to translate caption text and provide contextual word lookup.
