import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { OAuth2Client } from "google-auth-library";
import { type gmail_v1, google } from "googleapis";
import { AccountStorage } from "./account-storage.js";
import { GmailOAuthFlow } from "./gmail-oauth-flow.js";
import {
	filterSelfFromRecipients,
	formatGmailQuote,
	formatHtmlReplyBody,
	formatReplySubject,
	parseEmailAddress,
	parseEmailList,
} from "./reply-utils.js";
import type { EmailAccount } from "./types.js";

type GmailMessage = gmail_v1.Schema$Message;
type GmailThread = gmail_v1.Schema$Thread;
type GmailDraft = gmail_v1.Schema$Draft;

export interface ThreadSearchResult {
	threads: Array<{
		id: string;
		historyId: string;
		messages: Array<{
			id: string;
			threadId: string;
			labelIds: string[];
			snippet: string;
			historyId: string;
			internalDate: string;
			from: string | undefined;
			to: string | undefined;
			subject: string | undefined;
			date: string | undefined;
			hasAttachments: boolean;
		}>;
	}>;
	nextPageToken?: string;
}

export interface AttachmentDownloadResult {
	success: boolean;
	filename: string;
	path?: string;
	error?: string;
	cached?: boolean;
}

export interface DownloadedAttachment {
	messageId: string;
	filename: string;
	path: string;
	size: number;
	mimeType: string;
	cached: boolean;
}

export interface LabelOperationResult {
	threadId: string;
	success: boolean;
	error?: string;
}

export class GmailService {
	private accountStorage = new AccountStorage();
	private gmailClients: Map<string, any> = new Map();

	async addGmailAccount(email: string, clientId: string, clientSecret: string, manual = false): Promise<void> {
		if (this.accountStorage.hasAccount(email)) {
			throw new Error(`Account '${email}' already exists`);
		}

		const oauthFlow = new GmailOAuthFlow(clientId, clientSecret);
		const refreshToken = await oauthFlow.authorize(manual);

		const account: EmailAccount = {
			email,
			oauth2: { clientId, clientSecret, refreshToken },
		};

		this.accountStorage.addAccount(account);
	}

	deleteAccount(email: string): boolean {
		this.gmailClients.delete(email);
		return this.accountStorage.deleteAccount(email);
	}

	listAccounts(): EmailAccount[] {
		return this.accountStorage.getAllAccounts();
	}

	setCredentials(clientId: string, clientSecret: string): void {
		this.accountStorage.setCredentials(clientId, clientSecret);
	}

	getCredentials(): { clientId: string; clientSecret: string } | null {
		return this.accountStorage.getCredentials();
	}

	private getGmailClient(email: string): any {
		if (!this.gmailClients.has(email)) {
			const account = this.accountStorage.getAccount(email);
			if (!account) {
				throw new Error(`Account '${email}' not found`);
			}

			const oauth2Client = new OAuth2Client(
				account.oauth2.clientId,
				account.oauth2.clientSecret,
				"http://localhost",
			);

			oauth2Client.setCredentials({
				refresh_token: account.oauth2.refreshToken,
				access_token: account.oauth2.accessToken,
			});

			const gmail = google.gmail({ version: "v1", auth: oauth2Client });
			this.gmailClients.set(email, gmail);
		}

		return this.gmailClients.get(email)!;
	}

	async searchThreads(email: string, query: string, maxResults = 10, pageToken?: string): Promise<ThreadSearchResult> {
		const gmail = this.getGmailClient(email);
		const response = await gmail.users.threads.list({
			userId: "me",
			q: query,
			maxResults,
			pageToken,
		});

		const threads = response.data.threads || [];
		const detailedThreads: GmailThread[] = [];

		for (const thread of threads) {
			const detail = (await this.getThread(email, thread.id, false)) as GmailThread;
			detailedThreads.push(detail);
		}

		return {
			threads: detailedThreads.map((thread) => ({
				id: thread.id || "",
				historyId: thread.historyId || "",
				messages: (thread.messages || []).map((msg) => ({
					id: msg.id || "",
					threadId: msg.threadId || "",
					labelIds: msg.labelIds || [],
					snippet: msg.snippet || "",
					historyId: msg.historyId || "",
					internalDate: msg.internalDate || "",
					from: this.getHeaderValue(msg, "from"),
					to: this.getHeaderValue(msg, "to"),
					subject: this.getHeaderValue(msg, "subject"),
					date: this.getHeaderValue(msg, "date"),
					hasAttachments: msg.payload?.parts?.some((part) => part.filename && part.filename.length > 0) || false,
				})),
			})),
			nextPageToken: response.data.nextPageToken,
		};
	}

	async getThread(
		email: string,
		threadId: string,
		downloadAttachments = false,
	): Promise<GmailThread | DownloadedAttachment[]> {
		const gmail = this.getGmailClient(email);
		const response = await gmail.users.threads.get({
			userId: "me",
			id: threadId,
		});

		const thread = response.data;

		if (!downloadAttachments) {
			return thread;
		}

		const attachmentsToDownload: Array<{
			messageId: string;
			attachmentId: string;
			filename: string;
			size: number;
			mimeType: string;
		}> = [];

		for (const message of thread.messages || []) {
			if (message.payload?.parts) {
				for (const part of message.payload.parts) {
					if (part.body?.attachmentId && part.filename) {
						attachmentsToDownload.push({
							messageId: message.id!,
							attachmentId: part.body.attachmentId,
							filename: part.filename,
							size: part.body.size || 0,
							mimeType: part.mimeType || "application/octet-stream",
						});
					}
				}
			}
		}

		const downloadResults = await this.downloadAttachments(
			email,
			attachmentsToDownload.map((att) => ({
				messageId: att.messageId,
				attachmentId: att.attachmentId,
				filename: att.filename,
			})),
		);

		const downloadedAttachments: DownloadedAttachment[] = [];

		for (let i = 0; i < attachmentsToDownload.length; i++) {
			const attachment = attachmentsToDownload[i];
			const result = downloadResults[i];

			if (result.success && result.path) {
				downloadedAttachments.push({
					messageId: attachment.messageId,
					filename: attachment.filename,
					path: result.path,
					size: attachment.size,
					mimeType: attachment.mimeType,
					cached: result.cached || false,
				});
			}
		}

		return downloadedAttachments;
	}

	async downloadAttachments(
		email: string,
		attachments: Array<{ messageId: string; attachmentId: string; filename: string }>,
	): Promise<AttachmentDownloadResult[]> {
		const gmail = this.getGmailClient(email);
		const results: AttachmentDownloadResult[] = [];

		const attachmentDir = path.join(os.homedir(), ".gmcli", "attachments");
		if (!fs.existsSync(attachmentDir)) {
			fs.mkdirSync(attachmentDir, { recursive: true });
		}

		for (const attachment of attachments) {
			try {
				const shortAttachmentId = attachment.attachmentId.substring(0, 8);
				const filename = `${attachment.messageId}_${shortAttachmentId}_${attachment.filename}`;
				const filePath = path.join(attachmentDir, filename);

				if (fs.existsSync(filePath)) {
					const existingSize = fs.statSync(filePath).size;
					const attachmentInfo = await gmail.users.messages.attachments.get({
						userId: "me",
						messageId: attachment.messageId,
						id: attachment.attachmentId,
					});

					if (existingSize === attachmentInfo.data.size) {
						results.push({ success: true, filename: attachment.filename, path: filePath, cached: true });
						continue;
					}
				}

				const response = await gmail.users.messages.attachments.get({
					userId: "me",
					messageId: attachment.messageId,
					id: attachment.attachmentId,
				});

				const data = Buffer.from(response.data.data, "base64url");
				fs.writeFileSync(filePath, data);

				results.push({ success: true, filename: attachment.filename, path: filePath, cached: false });
			} catch (e) {
				results.push({
					success: false,
					filename: attachment.filename,
					error: e instanceof Error ? e.message : String(e),
				});
			}
		}

		return results;
	}

	async modifyLabels(
		email: string,
		threadIds: string[],
		addLabels: string[] = [],
		removeLabels: string[] = [],
	): Promise<LabelOperationResult[]> {
		const gmail = this.getGmailClient(email);
		const results: LabelOperationResult[] = [];

		for (const threadId of threadIds) {
			try {
				if (addLabels.length > 0) {
					await gmail.users.threads.modify({
						userId: "me",
						id: threadId,
						requestBody: { addLabelIds: addLabels },
					});
				}
				if (removeLabels.length > 0) {
					await gmail.users.threads.modify({
						userId: "me",
						id: threadId,
						requestBody: { removeLabelIds: removeLabels },
					});
				}
				results.push({ threadId, success: true });
			} catch (e) {
				results.push({ threadId, success: false, error: e instanceof Error ? e.message : String(e) });
			}
		}

		return results;
	}

	async listDrafts(email: string): Promise<GmailDraft[]> {
		const gmail = this.getGmailClient(email);
		const response = await gmail.users.drafts.list({ userId: "me" });
		return response.data.drafts || [];
	}

	async listLabels(email: string): Promise<Array<{ id: string; name: string; type: string }>> {
		const gmail = this.getGmailClient(email);
		const response = await gmail.users.labels.list({ userId: "me" });
		return (response.data.labels || []).map((l: any) => ({
			id: l.id || "",
			name: l.name || "",
			type: l.type || "",
		}));
	}

	async getLabelMap(email: string): Promise<{ idToName: Map<string, string>; nameToId: Map<string, string> }> {
		const labels = await this.listLabels(email);
		const idToName = new Map<string, string>();
		const nameToId = new Map<string, string>();
		for (const l of labels) {
			idToName.set(l.id, l.name);
			nameToId.set(l.name.toLowerCase(), l.id);
		}
		return { idToName, nameToId };
	}

	resolveLabelIds(labels: string[], nameToId: Map<string, string>): string[] {
		return labels.map((l) => nameToId.get(l.toLowerCase()) || l);
	}

	async createDraft(
		email: string,
		to: string[],
		subject: string,
		body: string,
		options: {
			cc?: string[];
			bcc?: string[];
			threadId?: string;
			replyToMessageId?: string;
			attachments?: string[];
			replyAll?: boolean;
			includeQuote?: boolean;
		} = {},
	): Promise<GmailDraft> {
		const gmail = this.getGmailClient(email);

		let inReplyTo: string | undefined;
		let references: string | undefined;
		let threadId = options.threadId;
		let replyData: Awaited<ReturnType<typeof this.getMessageForReply>> | undefined;
		const originalBody = body; // Keep original reply text for HTML generation

		// Use local variables to avoid parameter reassignment
		let recipientList = to;
		let subjectLine = subject;
		let bodyText = body;

		// If replying to a specific message, use getMessageForReply for auto-fill
		if (options.replyToMessageId) {
			replyData = await this.getMessageForReply(email, options.replyToMessageId);

			// Auto-fill To if not provided
			if (!recipientList || recipientList.length === 0 || (recipientList.length === 1 && !recipientList[0])) {
				const senderEmail = parseEmailAddress(replyData.from).email;
				recipientList = [senderEmail];

				if (options.replyAll) {
					// Add original To + Cc (minus self) to Cc
					const allRecipients = [...replyData.to, ...replyData.cc];
					const filtered = filterSelfFromRecipients(allRecipients, email);
					options.cc = [...(options.cc || []), ...filtered];
				}
			}

			// Auto-fill subject if not provided
			if (!subjectLine) {
				subjectLine = formatReplySubject(replyData.subject);
			}

			// Append quoted text to plain text body if includeQuote !== false
			if (options.includeQuote !== false) {
				bodyText = bodyText + formatGmailQuote(replyData.date, replyData.from, replyData.body);
			}

			inReplyTo = replyData.inReplyTo;
			references = replyData.references;
			threadId = replyData.threadId;
		}

		const hasAttachments = options.attachments && options.attachments.length > 0;
		const hasHtmlQuote = replyData && options.includeQuote !== false;
		const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
		const altBoundary = `alt_${Date.now()}_${Math.random().toString(36).slice(2)}`;

		// Determine content type based on attachments and HTML quote
		let contentType: string;
		if (hasAttachments) {
			contentType = `multipart/mixed; boundary="${boundary}"`;
		} else if (hasHtmlQuote) {
			contentType = `multipart/alternative; boundary="${altBoundary}"`;
		} else {
			contentType = "text/plain; charset=UTF-8";
		}

		const headers = [
			`From: ${email}`,
			`To: ${recipientList.join(", ")}`,
			options.cc?.length ? `Cc: ${options.cc.join(", ")}` : "",
			options.bcc?.length ? `Bcc: ${options.bcc.join(", ")}` : "",
			`Subject: ${subjectLine}`,
			inReplyTo ? `In-Reply-To: ${inReplyTo}` : "",
			references ? `References: ${references}` : "",
			"MIME-Version: 1.0",
			`Content-Type: ${contentType}`,
		].filter(Boolean);

		let emailContent: string;

		if (hasAttachments) {
			const parts: string[] = [];

			if (hasHtmlQuote) {
				// Multipart/alternative inside multipart/mixed
				const htmlBody = formatHtmlReplyBody(
					originalBody,
					replyData!.date,
					replyData!.from,
					replyData!.body,
					replyData!.htmlBody,
				);
				parts.push(
					`--${boundary}\r\n` +
						`Content-Type: multipart/alternative; boundary="${altBoundary}"\r\n\r\n` +
						`--${altBoundary}\r\n` +
						"Content-Type: text/plain; charset=UTF-8\r\n\r\n" +
						bodyText +
						`\r\n--${altBoundary}\r\n` +
						"Content-Type: text/html; charset=UTF-8\r\n\r\n" +
						htmlBody +
						`\r\n--${altBoundary}--`,
				);
			} else {
				// Text body part only
				parts.push(`--${boundary}\r\n` + "Content-Type: text/plain; charset=UTF-8\r\n\r\n" + bodyText);
			}

			// Attachment parts
			for (const filePath of options.attachments!) {
				const filename = path.basename(filePath);
				const fileContent = fs.readFileSync(filePath);
				const base64Content = fileContent.toString("base64");
				const mimeType = this.getMimeType(filename);

				parts.push(
					`--${boundary}\r\n` +
						`Content-Type: ${mimeType}\r\n` +
						"Content-Transfer-Encoding: base64\r\n" +
						`Content-Disposition: attachment; filename="${filename}"\r\n\r\n` +
						base64Content,
				);
			}

			emailContent = headers.join("\r\n") + "\r\n\r\n" + parts.join("\r\n") + `\r\n--${boundary}--`;
		} else if (hasHtmlQuote) {
			// Multipart/alternative with text and HTML
			const htmlBody = formatHtmlReplyBody(
				originalBody,
				replyData!.date,
				replyData!.from,
				replyData!.body,
				replyData!.htmlBody,
			);
			const parts = [
				`--${altBoundary}\r\n` + "Content-Type: text/plain; charset=UTF-8\r\n\r\n" + bodyText,
				`--${altBoundary}\r\n` + "Content-Type: text/html; charset=UTF-8\r\n\r\n" + htmlBody,
			];
			emailContent = headers.join("\r\n") + "\r\n\r\n" + parts.join("\r\n") + `\r\n--${altBoundary}--`;
		} else {
			emailContent = headers.join("\r\n") + "\r\n\r\n" + bodyText;
		}

		const encodedEmail = Buffer.from(emailContent).toString("base64url");

		const response = await gmail.users.drafts.create({
			userId: "me",
			requestBody: {
				message: { raw: encodedEmail, threadId },
			},
		});

		return response.data;
	}

	private getMimeType(filename: string): string {
		const ext = path.extname(filename).toLowerCase();
		const mimeTypes: Record<string, string> = {
			".pdf": "application/pdf",
			".doc": "application/msword",
			".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			".xls": "application/vnd.ms-excel",
			".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			".png": "image/png",
			".jpg": "image/jpeg",
			".jpeg": "image/jpeg",
			".gif": "image/gif",
			".txt": "text/plain",
			".html": "text/html",
			".zip": "application/zip",
			".json": "application/json",
		};
		return mimeTypes[ext] || "application/octet-stream";
	}

	async updateDraft(email: string, draftId: string, body: string): Promise<GmailDraft> {
		const gmail = this.getGmailClient(email);
		const draft = await this.getDraft(email, draftId);
		const message = draft.message;

		if (!message) throw new Error("Draft message not found");

		const existingRaw = message.raw ? Buffer.from(message.raw, "base64url").toString() : "";
		const headerEnd = existingRaw.indexOf("\n\n");
		const headers = headerEnd > 0 ? existingRaw.substring(0, headerEnd) : "";

		const updatedEmail = `${headers}\n\n${body}`;
		const encodedEmail = Buffer.from(updatedEmail).toString("base64url");

		const response = await gmail.users.drafts.update({
			userId: "me",
			id: draftId,
			requestBody: {
				message: { raw: encodedEmail, threadId: message.threadId },
			},
		});

		return response.data;
	}

	async getDraft(email: string, draftId: string): Promise<GmailDraft> {
		const gmail = this.getGmailClient(email);
		const response = await gmail.users.drafts.get({ userId: "me", id: draftId });
		return response.data;
	}

	async getMessageForReply(
		email: string,
		messageOrThreadId: string,
	): Promise<{
		messageId: string;
		threadId: string;
		from: string;
		to: string[];
		cc: string[];
		subject: string;
		date: string;
		body: string;
		htmlBody: string;
		inReplyTo: string;
		references: string;
	}> {
		const gmail = this.getGmailClient(email);

		let messageIdToFetch = messageOrThreadId;

		// Try to get as a thread first to get the LAST message (for proper reply threading)
		// This is important because thread IDs are often the same as the first message ID
		try {
			const thread = await gmail.users.threads.get({
				userId: "me",
				id: messageOrThreadId,
				format: "minimal",
			});
			if (thread.data.messages && thread.data.messages.length > 0) {
				// Use the last message in the thread
				messageIdToFetch = thread.data.messages[thread.data.messages.length - 1].id!;
			}
		} catch {
			// Not a thread ID - treat as a direct message ID
			messageIdToFetch = messageOrThreadId;
		}

		// Fetch the message with full format to get body
		const msg = await gmail.users.messages.get({
			userId: "me",
			id: messageIdToFetch,
			format: "full",
		});

		const headers = msg.data.payload?.headers || [];
		const getHeader = (name: string): string =>
			headers.find((h: any) => h.name?.toLowerCase() === name.toLowerCase())?.value || "";

		const from = getHeader("From");
		const to = parseEmailList(getHeader("To"));
		const cc = parseEmailList(getHeader("Cc"));
		const subject = getHeader("Subject");
		const date = getHeader("Date");
		const rfc822MessageId = getHeader("Message-ID");
		const existingRefs = getHeader("References");

		// Build references: existing References + Message-ID
		const references = existingRefs ? `${existingRefs} ${rfc822MessageId}` : rfc822MessageId;

		// Decode body from payload
		const body = this.decodeMessageBody(msg.data.payload);
		const htmlBody = this.decodeHtmlBody(msg.data.payload);

		return {
			messageId: msg.data.id || "",
			threadId: msg.data.threadId || "",
			from,
			to,
			cc,
			subject,
			date,
			body,
			htmlBody,
			inReplyTo: rfc822MessageId,
			references,
		};
	}

	private decodeMessageBody(payload: any): string {
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
				const nested = this.decodeMessageBody(part);
				if (nested) return nested;
			}
		}
		return "";
	}

	private decodeHtmlBody(payload: any): string {
		if (!payload) return "";
		if (payload.body?.data && payload.mimeType === "text/html") {
			return Buffer.from(payload.body.data, "base64url").toString();
		}
		if (payload.parts) {
			for (const part of payload.parts) {
				if (part.mimeType === "text/html" && part.body?.data) {
					return Buffer.from(part.body.data, "base64url").toString();
				}
			}
			for (const part of payload.parts) {
				const nested = this.decodeHtmlBody(part);
				if (nested) return nested;
			}
		}
		return "";
	}

	async deleteDraft(email: string, draftId: string): Promise<void> {
		const gmail = this.getGmailClient(email);
		await gmail.users.drafts.delete({ userId: "me", id: draftId });
	}

	async sendDraft(email: string, draftId: string): Promise<GmailMessage> {
		const gmail = this.getGmailClient(email);
		const response = await gmail.users.drafts.send({
			userId: "me",
			requestBody: { id: draftId },
		});
		// Gmail API returns the sent Message directly in response.data
		return response.data;
	}

	async sendMessage(
		email: string,
		to: string[],
		subject: string,
		body: string,
		options: {
			cc?: string[];
			bcc?: string[];
			replyToMessageId?: string;
			attachments?: string[];
			replyAll?: boolean;
			includeQuote?: boolean;
		} = {},
	): Promise<GmailMessage> {
		const gmail = this.getGmailClient(email);

		let inReplyTo: string | undefined;
		let references: string | undefined;
		let threadId: string | undefined;
		let replyData: Awaited<ReturnType<typeof this.getMessageForReply>> | undefined;
		const originalBody = body; // Keep original reply text for HTML generation

		// Use local variables to avoid parameter reassignment
		let recipientList = to;
		let subjectLine = subject;
		let bodyText = body;

		// If replying to a specific message, use getMessageForReply for auto-fill
		if (options.replyToMessageId) {
			replyData = await this.getMessageForReply(email, options.replyToMessageId);

			// Auto-fill To if not provided
			if (!recipientList || recipientList.length === 0 || (recipientList.length === 1 && !recipientList[0])) {
				const senderEmail = parseEmailAddress(replyData.from).email;
				recipientList = [senderEmail];

				if (options.replyAll) {
					// Add original To + Cc (minus self) to Cc
					const allRecipients = [...replyData.to, ...replyData.cc];
					const filtered = filterSelfFromRecipients(allRecipients, email);
					options.cc = [...(options.cc || []), ...filtered];
				}
			}

			// Auto-fill subject if not provided
			if (!subjectLine) {
				subjectLine = formatReplySubject(replyData.subject);
			}

			// Append quoted text to plain text body if includeQuote !== false
			if (options.includeQuote !== false) {
				bodyText = bodyText + formatGmailQuote(replyData.date, replyData.from, replyData.body);
			}

			inReplyTo = replyData.inReplyTo;
			references = replyData.references;
			threadId = replyData.threadId;
		}

		const hasAttachments = options.attachments && options.attachments.length > 0;
		const hasHtmlQuote = replyData && options.includeQuote !== false;
		const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
		const altBoundary = `alt_${Date.now()}_${Math.random().toString(36).slice(2)}`;

		// Determine content type based on attachments and HTML quote
		let contentType: string;
		if (hasAttachments) {
			contentType = `multipart/mixed; boundary="${boundary}"`;
		} else if (hasHtmlQuote) {
			contentType = `multipart/alternative; boundary="${altBoundary}"`;
		} else {
			contentType = "text/plain; charset=UTF-8";
		}

		const headers = [
			`From: ${email}`,
			`To: ${recipientList.join(", ")}`,
			options.cc?.length ? `Cc: ${options.cc.join(", ")}` : "",
			options.bcc?.length ? `Bcc: ${options.bcc.join(", ")}` : "",
			`Subject: ${subjectLine}`,
			inReplyTo ? `In-Reply-To: ${inReplyTo}` : "",
			references ? `References: ${references}` : "",
			"MIME-Version: 1.0",
			`Content-Type: ${contentType}`,
		].filter(Boolean);

		let emailContent: string;

		if (hasAttachments) {
			const parts: string[] = [];

			if (hasHtmlQuote) {
				// Multipart/alternative inside multipart/mixed
				const htmlBody = formatHtmlReplyBody(
					originalBody,
					replyData!.date,
					replyData!.from,
					replyData!.body,
					replyData!.htmlBody,
				);
				parts.push(
					`--${boundary}\r\n` +
						`Content-Type: multipart/alternative; boundary="${altBoundary}"\r\n\r\n` +
						`--${altBoundary}\r\n` +
						"Content-Type: text/plain; charset=UTF-8\r\n\r\n" +
						bodyText +
						`\r\n--${altBoundary}\r\n` +
						"Content-Type: text/html; charset=UTF-8\r\n\r\n" +
						htmlBody +
						`\r\n--${altBoundary}--`,
				);
			} else {
				// Text body part only
				parts.push(`--${boundary}\r\n` + "Content-Type: text/plain; charset=UTF-8\r\n\r\n" + bodyText);
			}

			// Attachment parts
			for (const filePath of options.attachments!) {
				const filename = path.basename(filePath);
				const fileContent = fs.readFileSync(filePath);
				const base64Content = fileContent.toString("base64");
				const mimeType = this.getMimeType(filename);

				parts.push(
					`--${boundary}\r\n` +
						`Content-Type: ${mimeType}\r\n` +
						"Content-Transfer-Encoding: base64\r\n" +
						`Content-Disposition: attachment; filename="${filename}"\r\n\r\n` +
						base64Content,
				);
			}

			emailContent = headers.join("\r\n") + "\r\n\r\n" + parts.join("\r\n") + `\r\n--${boundary}--`;
		} else if (hasHtmlQuote) {
			// Multipart/alternative with text and HTML
			const htmlBody = formatHtmlReplyBody(
				originalBody,
				replyData!.date,
				replyData!.from,
				replyData!.body,
				replyData!.htmlBody,
			);
			const parts = [
				`--${altBoundary}\r\n` + "Content-Type: text/plain; charset=UTF-8\r\n\r\n" + bodyText,
				`--${altBoundary}\r\n` + "Content-Type: text/html; charset=UTF-8\r\n\r\n" + htmlBody,
			];
			emailContent = headers.join("\r\n") + "\r\n\r\n" + parts.join("\r\n") + `\r\n--${altBoundary}--`;
		} else {
			emailContent = headers.join("\r\n") + "\r\n\r\n" + bodyText;
		}

		const encodedEmail = Buffer.from(emailContent).toString("base64url");

		const response = await gmail.users.messages.send({
			userId: "me",
			requestBody: { raw: encodedEmail, threadId },
		});

		return response.data;
	}

	async downloadMessageAttachments(email: string, messageId: string): Promise<DownloadedAttachment[]> {
		const gmail = this.getGmailClient(email);
		const response = await gmail.users.messages.get({ userId: "me", id: messageId });
		const message = response.data;

		const attachmentsToDownload: Array<{
			messageId: string;
			attachmentId: string;
			filename: string;
			size: number;
			mimeType: string;
		}> = [];

		const collectAttachments = (payload: any) => {
			if (payload?.parts) {
				for (const part of payload.parts) {
					if (part.body?.attachmentId && part.filename) {
						attachmentsToDownload.push({
							messageId,
							attachmentId: part.body.attachmentId,
							filename: part.filename,
							size: part.body.size || 0,
							mimeType: part.mimeType || "application/octet-stream",
						});
					}
					collectAttachments(part);
				}
			}
		};
		collectAttachments(message.payload);

		const downloadResults = await this.downloadAttachments(
			email,
			attachmentsToDownload.map((att) => ({
				messageId: att.messageId,
				attachmentId: att.attachmentId,
				filename: att.filename,
			})),
		);

		const downloadedAttachments: DownloadedAttachment[] = [];
		for (let i = 0; i < attachmentsToDownload.length; i++) {
			const attachment = attachmentsToDownload[i];
			const result = downloadResults[i];
			if (result.success && result.path) {
				downloadedAttachments.push({
					messageId: attachment.messageId,
					filename: attachment.filename,
					path: result.path,
					size: attachment.size,
					mimeType: attachment.mimeType,
					cached: result.cached || false,
				});
			}
		}

		return downloadedAttachments;
	}

	private getHeaderValue(message: GmailMessage, headerName: string): string | undefined {
		const header = message.payload?.headers?.find((h) => h.name?.toLowerCase() === headerName.toLowerCase());
		return header?.value || undefined;
	}
}
