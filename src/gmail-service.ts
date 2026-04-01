import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { OAuth2Client } from "google-auth-library";
import { type gmail_v1, google } from "googleapis";
import { AccountStorage } from "./account-storage.js";
import { GmailOAuthFlow } from "./gmail-oauth-flow.js";
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

	/**
	 * Encode a header value per RFC 2047 if it contains non-ASCII characters.
	 * Uses Base64 encoded-word syntax: =?UTF-8?B?<base64>?=
	 */
	private encodeHeaderValue(value: string): string {
		if (/[^\x00-\x7F]/.test(value)) {
			return `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;
		}
		return value;
	}

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
		} = {},
	): Promise<GmailDraft> {
		const gmail = this.getGmailClient(email);

		let inReplyTo: string | undefined;
		let references: string | undefined;
		let threadId = options.threadId;

		// If replying to a specific message, fetch its headers
		if (options.replyToMessageId) {
			const msg = await gmail.users.messages.get({
				userId: "me",
				id: options.replyToMessageId,
				format: "metadata",
				metadataHeaders: ["Message-ID", "References"],
			});
			const headers = msg.data.payload?.headers || [];
			const messageId = headers.find((h: any) => h.name === "Message-ID")?.value;
			const existingRefs = headers.find((h: any) => h.name === "References")?.value;

			if (messageId) {
				inReplyTo = messageId;
				references = existingRefs ? `${existingRefs} ${messageId}` : messageId;
			}
			threadId = threadId || msg.data.threadId;
		}

		const hasAttachments = options.attachments && options.attachments.length > 0;
		const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;

		const headers = [
			`From: ${email}`,
			`To: ${to.join(", ")}`,
			options.cc?.length ? `Cc: ${options.cc.join(", ")}` : "",
			options.bcc?.length ? `Bcc: ${options.bcc.join(", ")}` : "",
			`Subject: ${this.encodeHeaderValue(subject)}`,
			inReplyTo ? `In-Reply-To: ${inReplyTo}` : "",
			references ? `References: ${references}` : "",
			"MIME-Version: 1.0",
			hasAttachments
				? `Content-Type: multipart/mixed; boundary="${boundary}"`
				: "Content-Type: text/plain; charset=UTF-8",
		].filter(Boolean);

		let emailContent: string;

		if (hasAttachments) {
			const parts: string[] = [];

			// Text body part
			parts.push(`--${boundary}\r\n` + "Content-Type: text/plain; charset=UTF-8\r\n\r\n" + body);

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
		} else {
			emailContent = headers.join("\r\n") + "\r\n\r\n" + body;
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
		return response.data.message!;
	}

	async sendMessage(
		email: string,
		to: string[],
		subject: string,
		body: string,
		options: { cc?: string[]; bcc?: string[]; replyToMessageId?: string; attachments?: string[] } = {},
	): Promise<GmailMessage> {
		const gmail = this.getGmailClient(email);

		let inReplyTo: string | undefined;
		let references: string | undefined;
		let threadId: string | undefined;

		// If replying to a specific message, fetch its headers
		if (options.replyToMessageId) {
			const msg = await gmail.users.messages.get({
				userId: "me",
				id: options.replyToMessageId,
				format: "metadata",
				metadataHeaders: ["Message-ID", "References"],
			});
			const headers = msg.data.payload?.headers || [];
			const messageId = headers.find((h: any) => h.name === "Message-ID")?.value;
			const existingRefs = headers.find((h: any) => h.name === "References")?.value;

			if (messageId) {
				inReplyTo = messageId;
				references = existingRefs ? `${existingRefs} ${messageId}` : messageId;
			}
			threadId = msg.data.threadId || undefined;
		}

		const hasAttachments = options.attachments && options.attachments.length > 0;
		const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;

		const headers = [
			`From: ${email}`,
			`To: ${to.join(", ")}`,
			options.cc?.length ? `Cc: ${options.cc.join(", ")}` : "",
			options.bcc?.length ? `Bcc: ${options.bcc.join(", ")}` : "",
			`Subject: ${this.encodeHeaderValue(subject)}`,
			inReplyTo ? `In-Reply-To: ${inReplyTo}` : "",
			references ? `References: ${references}` : "",
			"MIME-Version: 1.0",
			hasAttachments
				? `Content-Type: multipart/mixed; boundary="${boundary}"`
				: "Content-Type: text/plain; charset=UTF-8",
		].filter(Boolean);

		let emailContent: string;

		if (hasAttachments) {
			const parts: string[] = [];

			// Text body part
			parts.push(`--${boundary}\r\n` + "Content-Type: text/plain; charset=UTF-8\r\n\r\n" + body);

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
		} else {
			emailContent = headers.join("\r\n") + "\r\n\r\n" + body;
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
