# gmcli

Minimal Gmail CLI for searching, reading threads, managing labels, drafts, and sending emails.

> **Fork Notice:** This is a fork of [@mariozechner/gmcli](https://github.com/badlogic/gmcli) by Mario Zechner with bug fixes for `--reply-to` thread ID handling and `drafts send` crash. See [CHANGELOG.md](CHANGELOG.md) for details.

## Install

```bash
npm install -g @willtmc/gmcli
```

## Setup

Before adding an account, you need OAuth2 credentials from Google Cloud Console:

1. [Create a new project](https://console.cloud.google.com/projectcreate) (or select existing)
2. [Enable the Gmail API](https://console.cloud.google.com/apis/api/gmail.googleapis.com)
3. [Set app name](https://console.cloud.google.com/auth/branding) in OAuth branding
4. [Add test users](https://console.cloud.google.com/auth/audience) (all Gmail addresses you want to use with gmcli)
5. [Create OAuth client](https://console.cloud.google.com/auth/clients):
   - Click "Create Client"
   - Application type: "Desktop app"
   - Download the JSON file

Then:

```bash
gmcli accounts credentials ~/path/to/credentials.json
gmcli accounts add you@gmail.com
```

## Usage

```
gmcli accounts <action>                Account management
gmcli <email> <command> [options]      Gmail operations
```

## Commands

### accounts

```bash
gmcli accounts credentials <file.json>   # Set OAuth credentials (once)
gmcli accounts list                      # List configured accounts
gmcli accounts add <email>               # Add account (opens browser)
gmcli accounts add <email> --manual      # Add account (browserless, paste redirect URL)
gmcli accounts remove <email>            # Remove account
```

### search

Search threads using Gmail query syntax. Returns thread ID, date, sender, subject, and labels.

```bash
gmcli <email> search <query> [--max N] [--page TOKEN]
```

Query examples:
- `in:inbox`, `in:sent`, `in:drafts`, `in:trash`, `in:spam`
- `is:unread`, `is:starred`, `is:important`
- `from:sender@example.com`, `to:recipient@example.com`
- `subject:keyword`
- `has:attachment`, `filename:pdf`
- `after:2024/01/01`, `before:2024/12/31`
- `label:Work`, `label:UNREAD`
- Combine with spaces: `in:inbox is:unread from:boss@company.com`

Examples:
```bash
gmcli you@gmail.com search "in:inbox"
gmcli you@gmail.com search "is:unread" --max 50
gmcli you@gmail.com search "from:someone@example.com has:attachment"
```

### thread

Get a thread with all messages. Shows Message-ID, headers, body, and attachments for each message.

```bash
gmcli <email> thread <threadId>              # View thread
gmcli <email> thread <threadId> --download   # Download attachments
```

Attachments are saved to `~/.gmcli/attachments/`.

### labels

```bash
gmcli <email> labels list                              # List all labels (ID, name, type)
gmcli <email> labels <threadIds...> [--add L] [--remove L]  # Modify labels on threads
```

You can use label names or IDs when modifying (names are case-insensitive).

System labels: `INBOX`, `UNREAD`, `STARRED`, `IMPORTANT`, `TRASH`, `SPAM`

Examples:
```bash
gmcli you@gmail.com labels list
gmcli you@gmail.com labels abc123 --remove UNREAD
gmcli you@gmail.com labels abc123 --add Work --remove INBOX
gmcli you@gmail.com labels abc123 def456 --add STARRED
```

### drafts

```bash
gmcli <email> drafts list                      # List all drafts
gmcli <email> drafts get <draftId>             # View draft with attachments
gmcli <email> drafts get <draftId> --download  # Download draft attachments
gmcli <email> drafts delete <draftId>          # Delete draft
gmcli <email> drafts send <draftId>            # Send draft

gmcli <email> drafts create --to <emails> --subject <s> --body <b> [options]
```

### send

Send an email directly.

```bash
gmcli <email> send --to <emails> --subject <s> --body <b> [options]
```

Options for `drafts create` and `send`:
- `--to <emails>` - Recipients (comma-separated, required)
- `--subject <s>` - Subject line (required)
- `--body <b>` - Message body (required)
- `--cc <emails>` - CC recipients (comma-separated)
- `--bcc <emails>` - BCC recipients (comma-separated)
- `--reply-to <messageId>` - Reply to message (sets In-Reply-To/References headers and thread)
- `--attach <file>` - Attach file (can be used multiple times)

Examples:
```bash
# Create draft
gmcli you@gmail.com drafts create --to a@x.com --subject "Hi" --body "Hello"

# Create reply draft
gmcli you@gmail.com drafts create --to a@x.com --subject "Re: Topic" \
    --body "My reply" --reply-to 19aea1f2f3532db5

# Send draft
gmcli you@gmail.com drafts send r1234567890

# Send directly
gmcli you@gmail.com send --to a@x.com --subject "Hi" --body "Hello"

# Send reply with attachment
gmcli you@gmail.com send --to a@x.com --subject "Re: Topic" \
    --body "See attached" --reply-to 19aea1f2f3532db5 --attach doc.pdf
```

### url

Generate Gmail web URLs for threads. Uses canonical URL format with email parameter (works regardless of account order in browser).

```bash
gmcli <email> url <threadIds...>
```

Example:
```bash
gmcli you@gmail.com url 19aea1f2f3532db5 19aea1f2f3532db6
```

## Data Storage

All data is stored in `~/.gmcli/`:
- `credentials.json` - OAuth client credentials
- `accounts.json` - Account tokens
- `attachments/` - Downloaded attachments

## Development

```bash
npm install
npm run build
npm run check
```

## Publishing

```bash
# Update version in package.json and CHANGELOG.md
npm run build
npm publish --access public
git tag v<version>
git push --tags
```

## License

MIT
