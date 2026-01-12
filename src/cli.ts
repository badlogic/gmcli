#!/usr/bin/env node

import * as fs from "fs";
import { parseArgs } from "util";
import { GmailService } from "./gmail-service.js";

const service = new GmailService();

// Global JSON output flag
let jsonOutput = false;

function usage(): never {
	console.log(`gmcli - Gmail CLI

USAGE

  gmcli accounts <action>                    Account management
  gmcli <email> <command> [options]          Gmail operations

GLOBAL OPTIONS

  --json                                     Output JSON instead of human-readable format

ACCOUNT COMMANDS

  gmcli accounts credentials <file.json>     Set OAuth credentials (once)
  gmcli accounts list                        List configured accounts
  gmcli accounts add <email> [--manual]      Add account (--manual for browserless OAuth)
  gmcli accounts remove <email>              Remove account

GMAIL COMMANDS

  gmcli <email> search <query> [--max N] [--page TOKEN]
  gmcli search <query> [--max N] [--page TOKEN]
      Search threads using Gmail query syntax.
      Returns: thread ID, date, sender, subject, labels.

      Query examples:
        in:inbox, in:sent, in:drafts, in:trash
        is:unread, is:starred, is:important
        from:sender@example.com, to:recipient@example.com
        subject:keyword, has:attachment, filename:pdf
        after:2024/01/01, before:2024/12/31
        label:Work, label:UNREAD
        Combine: "in:inbox is:unread from:boss@company.com"

  gmcli <email> thread <threadId> [--download]
  gmcli thread <threadId> [--download]
      Get thread with all messages.
      Shows: Message-ID, headers, body, attachments.
      --download saves attachments to ~/.gmcli/attachments/

  gmcli <email> setdefault
      Set default account for Gmail commands.

  gmcli setdefault
      Clear default account.

  gmcli <email> labels list
  gmcli labels list
      List all labels with ID, name, and type.

  gmcli <email> labels <threadIds...> [--add L] [--remove L]
      Modify labels on threads (comma-separated for multiple).
      Accepts label names or IDs (names are case-insensitive).
      System labels: INBOX, UNREAD, STARRED, IMPORTANT, TRASH, SPAM

  gmcli <email> drafts list
  gmcli drafts list
      List all drafts. Returns: draft ID, message ID.

  gmcli <email> drafts get <draftId> [--download]
  gmcli drafts get <draftId> [--download]
      View draft with attachments.
      --download saves attachments to ~/.gmcli/attachments/

  gmcli <email> drafts delete <draftId>
  gmcli drafts delete <draftId>
      Delete a draft.

  gmcli <email> drafts send <draftId>
  gmcli drafts send <draftId>
      Send a draft.

  gmcli <email> drafts create --to <emails> --subject <s> --body <b> [options]
  gmcli drafts create --to <emails> --subject <s> --body <b> [options]
      Create a new draft.

  gmcli <email> send --to <emails> --subject <s> --body <b> [options]
  gmcli send --to <emails> --subject <s> --body <b> [options]
      Send an email directly.

      Options for drafts create / send:
        --to <emails>           Recipients (comma-separated, required)
        --subject <s>           Subject line (required)
        --body <b>              Message body (required)
        --cc <emails>           CC recipients (comma-separated)
        --bcc <emails>          BCC recipients (comma-separated)
        --reply-to <messageId>  Reply to message (sets headers and thread)
        --attach <file>         Attach file (use multiple times for multiple files)

  gmcli <email> url <threadIds...>
  gmcli url <threadIds...>
      Generate Gmail web URLs for threads.
      Uses canonical URL format with email parameter.

EXAMPLES

  gmcli accounts list
  gmcli you@gmail.com setdefault
  gmcli search "in:inbox is:unread"
  gmcli search "from:boss@company.com" --max 50
  gmcli thread 19aea1f2f3532db5
  gmcli thread 19aea1f2f3532db5 --download
  gmcli labels list
  gmcli labels abc123 --add Work --remove UNREAD
  gmcli drafts create --to a@x.com --subject "Hi" --body "Hello"
  gmcli drafts send r1234567890
  gmcli send --to a@x.com --subject "Hi" --body "Hello"
  gmcli send --to a@x.com --subject "Re: Topic" \\
      --body "Reply text" --reply-to 19aea1f2f3532db5 --attach file.pdf
  gmcli url 19aea1f2f3532db5 19aea1f2f3532db6

DATA STORAGE

  ~/.gmcli/credentials.json   OAuth client credentials
  ~/.gmcli/accounts.json      Account tokens
  ~/.gmcli/default.json       Default account
  ~/.gmcli/attachments/       Downloaded attachments`);
	process.exit(1);
}

function error(msg: string): never {
	console.error("Error:", msg);
	process.exit(1);
}

async function main() {
	const args = process.argv.slice(2);
	if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
		usage();
	}

	jsonOutput = args.includes("--json");
	const filteredArgs = args.filter((a) => a !== "--json");

	const first = filteredArgs[0];
	const rest = filteredArgs.slice(1);

	try {
		if (first === "accounts") {
			await handleAccounts(rest);
			return;
		}

		const commandNames = new Set(["search", "thread", "labels", "drafts", "send", "url", "setdefault"]);
		const firstIsCommand = commandNames.has(first);

		const account = firstIsCommand ? service.getDefaultEmail() : first;
		const command = firstIsCommand ? first : rest[0];
		const commandArgs = firstIsCommand ? rest : rest.slice(1);

		if (!command) {
			error("Missing command. Use --help for usage.");
		}

		if (command === "setdefault" && firstIsCommand) {
			service.clearDefaultEmail();
			console.log("Default account cleared");
			return;
		}

		if (!account) {
			error("No default account set. Run: gmcli you@gmail.com setdefault");
		}

		switch (command) {
			case "search":
				await handleSearch(account, commandArgs);
				break;
			case "thread":
				await handleThread(account, commandArgs);
				break;
			case "labels":
				await handleLabels(account, commandArgs);
				break;
			case "drafts":
				await handleDrafts(account, commandArgs);
				break;
			case "send":
				await handleSend(account, commandArgs);
				break;
			case "url":
				handleUrl(account, commandArgs);
				break;
			case "setdefault":
				service.setDefaultEmail(account);
				console.log(`Default account set to ${account}`);
				break;
			default:
				error(`Unknown command: ${command}`);
		}
	} catch (e) {
		error(e instanceof Error ? e.message : String(e));
	}
}

async function handleAccounts(args: string[]) {
	const action = args[0];
	if (!action) error("Missing action: list|add|remove|credentials");

	switch (action) {
		case "list": {
			const accounts = service.listAccounts();
			if (jsonOutput) {
				console.log(JSON.stringify(accounts.map((a) => a.email)));
			} else if (accounts.length === 0) {
				console.log("No accounts configured");
			} else {
				for (const a of accounts) {
					console.log(a.email);
				}
			}
			break;
		}
		case "credentials": {
			const credFile = args[1];
			if (!credFile) error("Usage: accounts credentials <credentials.json>");
			const creds = JSON.parse(fs.readFileSync(credFile, "utf8"));
			const installed = creds.installed || creds.web;
			if (!installed) error("Invalid credentials file");
			service.setCredentials(installed.client_id, installed.client_secret);
			console.log("Credentials saved");
			break;
		}
		case "add": {
			const manual = args.includes("--manual");
			const filtered = args.slice(1).filter((a) => a !== "--manual");
			const email = filtered[0];
			if (!email) error("Usage: accounts add <email> [--manual]");
			const creds = service.getCredentials();
			if (!creds) error("No credentials configured. Run: gmcli accounts credentials <credentials.json>");
			await service.addGmailAccount(email, creds.clientId, creds.clientSecret, manual);
			console.log(`Account '${email}' added`);
			break;
		}
		case "remove": {
			const email = args[1];
			if (!email) error("Usage: accounts remove <email>");
			const deleted = service.deleteAccount(email);
			console.log(deleted ? `Removed '${email}'` : `Not found: ${email}`);
			break;
		}
		default:
			error(`Unknown action: ${action}`);
	}
}

async function handleSearch(account: string, args: string[]) {
	const { values, positionals } = parseArgs({
		args,
		options: {
			max: { type: "string", short: "m" },
			page: { type: "string", short: "p" },
		},
		allowPositionals: true,
	});

	const query = positionals.join(" ");
	if (!query) error("Usage: <email> search <query>");

	const results = await service.searchThreads(account, query, Number(values.max) || 10, values.page);

	if (jsonOutput) {
		console.log(JSON.stringify(results));
		return;
	}

	const { idToName } = await service.getLabelMap(account);

	if (results.threads.length === 0) {
		console.log("No results");
	} else {
		console.log("ID\tDATE\tFROM\tSUBJECT\tLABELS");
		for (const t of results.threads) {
			const msg = t.messages[0];
			const date = msg?.date ? new Date(msg.date).toISOString().slice(0, 16).replace("T", " ") : "";
			const from = msg?.from?.replace(/\t/g, " ") || "";
			const subject = msg?.subject?.replace(/\t/g, " ") || "(no subject)";
			const labels = msg?.labelIds?.map((id) => idToName.get(id) || id).join(",") || "";
			console.log(`${t.id}\t${date}\t${from}\t${subject}\t${labels}`);
		}
		if (results.nextPageToken) {
			console.log(`\n# Next page: --page ${results.nextPageToken}`);
		}
	}
}

async function handleThread(account: string, args: string[]) {
	const download = args.includes("--download");
	const filtered = args.filter((a) => a !== "--download");
	const threadId = filtered[0];

	if (!threadId) error("Usage: <email> thread <threadId>");

	const result = await service.getThread(account, threadId, download);

	if (jsonOutput) {
		console.log(JSON.stringify(result));
		return;
	}

	if (download) {
		const attachments = result as any[];
		if (attachments.length === 0) {
			console.log("No attachments");
		} else {
			console.log("FILENAME\tPATH\tSIZE");
			for (const a of attachments) {
				console.log(`${a.filename}\t${a.path}\t${a.size}`);
			}
		}
	} else {
		const thread = result as any;
		for (const msg of thread.messages || []) {
			const headers = msg.payload?.headers || [];
			const getHeader = (name: string) =>
				headers.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
			console.log(`Message-ID: ${msg.id}`);
			console.log(`From: ${getHeader("from")}`);
			console.log(`To: ${getHeader("to")}`);
			console.log(`Date: ${getHeader("date")}`);
			console.log(`Subject: ${getHeader("subject")}`);
			console.log("");
			console.log(decodeBody(msg.payload));
			console.log("");
			const attachments = getAttachments(msg.payload);
			if (attachments.length > 0) {
				console.log("Attachments:");
				for (const att of attachments) {
					console.log(`  - ${att.filename} (${formatSize(att.size)}, ${att.mimeType})`);
				}
				console.log("");
			}
			console.log("---");
		}
	}
}

function formatSize(bytes: number): string {
	if (bytes === 0) return "0 B";
	const units = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	return `${(bytes / 1024 ** i).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function decodeBody(payload: any): string {
	if (!payload) return "";
	if (payload.body?.data) {
		return Buffer.from(payload.body.data, "base64url").toString();
	}
	if (payload.parts) {
		for (const part of payload.parts) {
			if (part.mimeType === "text/plain" && part.body?.data) {
				return Buffer.from(part.body.data, "base64url").toString();
			}
		}
		for (const part of payload.parts) {
			const nested = decodeBody(part);
			if (nested) return nested;
		}
	}
	return "";
}

interface AttachmentInfo {
	filename: string;
	size: number;
	mimeType: string;
}

function getAttachments(payload: any): AttachmentInfo[] {
	const attachments: AttachmentInfo[] = [];
	if (!payload?.parts) return attachments;
	for (const part of payload.parts) {
		if (part.filename && part.body?.attachmentId) {
			attachments.push({
				filename: part.filename,
				size: part.body.size || 0,
				mimeType: part.mimeType || "application/octet-stream",
			});
		}
		attachments.push(...getAttachments(part));
	}
	return attachments;
}

async function handleLabels(account: string, args: string[]) {
	const { values, positionals } = parseArgs({
		args,
		options: {
			add: { type: "string", short: "a" },
			remove: { type: "string", short: "r" },
		},
		allowPositionals: true,
	});

	if (positionals.length === 0) {
		error("Usage: <email> labels list | <email> labels <threadIds...> [--add L] [--remove L]");
	}

	// labels list
	if (positionals[0] === "list") {
		const labels = await service.listLabels(account);
		console.log("ID\tNAME\tTYPE");
		for (const l of labels) {
			console.log(`${l.id}\t${l.name}\t${l.type}`);
		}
		return;
	}

	// labels <threadIds...> [--add] [--remove]
	const threadIds = positionals;

	const { nameToId } = await service.getLabelMap(account);
	const addLabels = values.add ? service.resolveLabelIds(values.add.split(","), nameToId) : [];
	const removeLabels = values.remove ? service.resolveLabelIds(values.remove.split(","), nameToId) : [];

	const results = await service.modifyLabels(account, threadIds, addLabels, removeLabels);

	for (const r of results) {
		console.log(`${r.threadId}: ${r.success ? "ok" : r.error}`);
	}
}

async function handleDrafts(account: string, args: string[]) {
	const action = args[0];
	const rest = args.slice(1);
	if (!action) error("Usage: <email> drafts <action>");

	switch (action) {
		case "list": {
			const drafts = await service.listDrafts(account);
			if (drafts.length === 0) {
				console.log("No drafts");
			} else {
				console.log("ID\tMESSAGE_ID");
				for (const d of drafts) {
					console.log(`${d.id}\t${d.message?.id || ""}`);
				}
			}
			break;
		}
		case "get": {
			const download = rest.includes("--download");
			const filtered = rest.filter((a) => a !== "--download");
			const draftId = filtered[0];
			if (!draftId) error("Usage: <email> drafts get <draftId> [--download]");
			const draft = await service.getDraft(account, draftId);
			const msg = draft.message;
			if (msg) {
				if (download) {
					const downloaded = await service.downloadMessageAttachments(account, msg.id!);
					if (downloaded.length === 0) {
						console.log("No attachments");
					} else {
						console.log("FILENAME\tPATH\tSIZE");
						for (const a of downloaded) {
							console.log(`${a.filename}\t${a.path}\t${a.size}`);
						}
					}
				} else {
					const headers = msg.payload?.headers || [];
					const getHeader = (name: string) =>
						headers.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";
					console.log(`Draft-ID: ${draft.id}`);
					console.log(`To: ${getHeader("to")}`);
					console.log(`Cc: ${getHeader("cc")}`);
					console.log(`Subject: ${getHeader("subject")}`);
					console.log("");
					console.log(decodeBody(msg.payload));
					console.log("");
					const attachments = getAttachments(msg.payload);
					if (attachments.length > 0) {
						console.log("Attachments:");
						for (const att of attachments) {
							console.log(`  - ${att.filename} (${formatSize(att.size)}, ${att.mimeType})`);
						}
					}
				}
			}
			break;
		}
		case "delete": {
			const draftId = rest[0];
			if (!draftId) error("Usage: <email> drafts delete <draftId>");
			await service.deleteDraft(account, draftId);
			console.log("Deleted");
			break;
		}
		case "send": {
			const draftId = rest[0];
			if (!draftId) error("Usage: <email> drafts send <draftId>");
			const msg = await service.sendDraft(account, draftId);
			console.log(`Sent: ${msg.id}`);
			break;
		}
		case "create": {
			const { values } = parseArgs({
				args: rest,
				options: {
					to: { type: "string" },
					cc: { type: "string" },
					bcc: { type: "string" },
					subject: { type: "string" },
					body: { type: "string" },
					thread: { type: "string" },
					"reply-to": { type: "string" },
					attach: { type: "string", multiple: true },
				},
			});
			if (!values.to || !values.subject || !values.body) {
				error("Usage: <email> drafts create --to <emails> --subject <subj> --body <body>");
			}
			const draft = await service.createDraft(account, values.to.split(","), values.subject, values.body, {
				cc: values.cc?.split(","),
				bcc: values.bcc?.split(","),
				threadId: values.thread,
				replyToMessageId: values["reply-to"],
				attachments: values.attach,
			});
			console.log(`Draft created: ${draft.id}`);
			break;
		}
		default:
			error(`Unknown action: ${action}`);
	}
}

async function handleSend(account: string, args: string[]) {
	const { values } = parseArgs({
		args,
		options: {
			to: { type: "string" },
			cc: { type: "string" },
			bcc: { type: "string" },
			subject: { type: "string" },
			body: { type: "string" },
			"reply-to": { type: "string" },
			attach: { type: "string", multiple: true },
		},
	});

	if (!values.to || !values.subject || !values.body) {
		error("Usage: <email> send --to <emails> --subject <subj> --body <body>");
	}

	const msg = await service.sendMessage(account, values.to.split(","), values.subject, values.body, {
		cc: values.cc?.split(","),
		bcc: values.bcc?.split(","),
		replyToMessageId: values["reply-to"],
		attachments: values.attach,
	});
	console.log(`Sent: ${msg.id}`);
}

function handleUrl(account: string, args: string[]) {
	if (args.length === 0) {
		error("Usage: <email> url <threadIds...>");
	}

	for (const id of args) {
		const url = `https://mail.google.com/mail/?authuser=${encodeURIComponent(account)}#all/${id}`;
		console.log(`${id}\t${url}`);
	}
}

main();
