# Changelog

## 0.2.0

Fork of @mariozechner/gmcli with bug fixes.

### Fixed
- `--reply-to` now accepts both thread IDs and message IDs. Previously it only worked with message IDs, but `search` returns thread IDs. Now automatically detects thread IDs and fetches the last message in the thread for proper reply threading.
- `drafts send` no longer crashes with "Cannot read property 'id' of undefined". Fixed response handling from Gmail API.

### Changed
- Published as `@willtmc/gmcli` (fork of `@mariozechner/gmcli`)

## 0.1.0

Initial release (original author: Mario Zechner).

- Account management (add, remove, list)
  - `--manual` flag for browserless OAuth (paste redirect URL)
- Search threads with Gmail query syntax
  - Returns thread ID, date, sender, subject, labels (human-readable names)
- View threads with message IDs and attachment info
- Download attachments
- Labels management
  - List all labels with `labels list`
  - Modify labels by name or ID (case-insensitive)
- Drafts (create, list, get, delete, send)
  - Support for replies (`--reply-to <messageId>`)
  - Support for attachments (`--attach <file>`)
- Send emails directly
  - Same options as draft creation
- Generate Gmail web URLs for threads (`url` command)
  - Uses canonical URL format with `authuser` parameter
