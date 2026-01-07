# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm run build      # Compile TypeScript and make CLI executable
npm run check      # Lint with Biome and type-check with tsgo
npm test           # Run tests in watch mode
npm run test:run   # Run tests once
```

After building, test CLI directly: `node dist/cli.js <command>`

## Architecture

This is a Gmail CLI tool built on the Gmail API. Key files:

- **`src/cli.ts`** - Main entry point. Parses args and dispatches to handler functions (`handleSearch`, `handleThread`, `handleDrafts`, `handleSend`, etc.). Contains the `usage()` help text.

- **`src/gmail-service.ts`** - Core service class wrapping Gmail API. Handles OAuth client management, thread/message fetching, draft creation, sending. Key methods:
  - `getMessageForReply()` - Fetches message data for reply (always gets last message in thread)
  - `createDraft()` / `sendMessage()` - Build MIME messages with multipart/alternative (text + HTML) for proper Gmail quote rendering

- **`src/reply-utils.ts`** - Pure helper functions for reply formatting:
  - `formatGmailQuote()` / `formatHtmlGmailQuote()` - Format quoted text in Gmail style
  - `parseEmailAddress()` / `parseEmailList()` - Parse email headers
  - `formatReplySubject()` - Add "Re:" prefix

- **`src/account-storage.ts`** - Persists OAuth credentials and account tokens to `~/.gmcli/`

- **`src/gmail-oauth-flow.ts`** - OAuth2 authentication flow (browser or manual mode)

## Reply/Quote System

When replying to messages, the CLI sends `multipart/alternative` emails with both:
1. `text/plain` - Plain text with `>` quote markers
2. `text/html` - HTML with Gmail's blockquote styling (`gmail_quote` class)

The HTML body from the original message is preserved to maintain nested quote structure.

## Data Storage

All persistent data in `~/.gmcli/`:
- `credentials.json` - OAuth client credentials
- `accounts.json` - Account refresh tokens
- `attachments/` - Downloaded attachments
