/**
 * Pure helper functions for reply functionality
 */

/**
 * Format Gmail-style attribution line
 * @param date - RFC 2822 format like "Mon, 6 Jan 2025 10:30:00 -0800"
 * @param sender - Email sender like "John Doe <john@example.com>"
 * @returns Attribution line like "On Mon, Jan 6, 2025 at 10:30 AM, John Doe <john@example.com> wrote:"
 */
export function formatAttributionLine(date: string, sender: string): string {
	const parsed = new Date(date);

	const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
	const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

	const dayName = days[parsed.getDay()];
	const month = months[parsed.getMonth()];
	const day = parsed.getDate();
	const year = parsed.getFullYear();

	let hours = parsed.getHours();
	const minutes = parsed.getMinutes();
	const ampm = hours >= 12 ? "PM" : "AM";
	hours = hours % 12;
	if (hours === 0) hours = 12;

	const minuteStr = minutes.toString().padStart(2, "0");
	// Gmail uses narrow non-breaking space (U+202F) before AM/PM
	const timeStr = `${hours}:${minuteStr}\u202F${ampm}`;

	// Format sender: if just email (no name), wrap in angle brackets
	const { name, email } = parseEmailAddress(sender);
	const formattedSender = name ? sender : `<${email}>`;

	// Gmail format: no comma after time
	return `On ${dayName}, ${month} ${day}, ${year} at ${timeStr} ${formattedSender} wrote:`;
}

/**
 * Format quoted body by prefixing each line with "> "
 * @param body - Original email body
 * @returns Quoted body with each line prefixed
 */
export function formatQuotedBody(body: string): string {
	if (!body) {
		return "";
	}

	return body
		.split("\n")
		.map((line) => `> ${line}`)
		.join("\n");
}

/**
 * Format a complete Gmail-style quote block
 * @param date - RFC 2822 format date
 * @param sender - Email sender
 * @param body - Original email body
 * @returns Formatted quote block
 */
export function formatGmailQuote(date: string, sender: string, body: string): string {
	const attributionLine = formatAttributionLine(date, sender);
	const quotedBody = formatQuotedBody(body);

	// Gmail format: blank line between attribution and quoted text
	return `\n\n${attributionLine}\n\n${quotedBody}`;
}

/**
 * Parse an email address header into name and email components
 * @param header - Email header like "John Doe <john@example.com>" or "john@example.com"
 * @returns Object with name and email properties
 */
export function parseEmailAddress(header: string): { name: string; email: string } {
	const trimmed = header.trim();

	// Match "Name <email>" format
	const match = trimmed.match(/^(.+?)\s*<([^>]+)>$/);

	if (match) {
		return {
			name: match[1].trim(),
			email: match[2].trim(),
		};
	}

	// Plain email address
	return {
		name: "",
		email: trimmed,
	};
}

/**
 * Parse a comma-separated email list and extract email addresses
 * @param header - Comma-separated email list
 * @returns Array of email addresses
 */
export function parseEmailList(header: string): string[] {
	if (!header || !header.trim()) {
		return [];
	}

	return header
		.split(",")
		.map((entry) => parseEmailAddress(entry.trim()).email)
		.filter((email) => email.length > 0);
}

/**
 * Format reply subject by adding "Re: " prefix if not present
 * @param subject - Original subject line
 * @returns Subject with "Re: " prefix
 */
export function formatReplySubject(subject: string): string {
	const trimmed = subject.trim();

	// Check if already has Re: prefix (case-insensitive)
	if (/^re:\s*/i.test(trimmed)) {
		return trimmed;
	}

	return `Re: ${trimmed}`;
}

/**
 * Filter self email from recipient list
 * @param recipients - Array of email addresses
 * @param selfEmail - Email address to remove
 * @returns Filtered array without self email
 */
export function filterSelfFromRecipients(recipients: string[], selfEmail: string): string[] {
	const selfLower = selfEmail.toLowerCase();

	return recipients.filter((email) => email.toLowerCase() !== selfLower);
}

/**
 * Escape HTML special characters
 * @param text - Text to escape
 * @returns HTML-safe text
 */
export function escapeHtml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Convert plain text to simple HTML (preserving line breaks)
 * @param text - Plain text
 * @returns HTML with <br> for line breaks
 */
export function textToHtml(text: string): string {
	return escapeHtml(text).replace(/\n/g, "<br>");
}

/**
 * Format Gmail-style HTML attribution line
 * @param date - RFC 2822 format date
 * @param sender - Email sender
 * @returns HTML attribution div
 */
export function formatHtmlAttributionLine(date: string, sender: string): string {
	const parsed = new Date(date);

	const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
	const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

	const dayName = days[parsed.getDay()];
	const month = months[parsed.getMonth()];
	const day = parsed.getDate();
	const year = parsed.getFullYear();

	let hours = parsed.getHours();
	const minutes = parsed.getMinutes();
	const ampm = hours >= 12 ? "PM" : "AM";
	hours = hours % 12;
	if (hours === 0) hours = 12;

	const minuteStr = minutes.toString().padStart(2, "0");
	// Use narrow non-breaking space (U+202F) before AM/PM
	const timeStr = `${hours}:${minuteStr}\u202F${ampm}`;

	// Format sender: if just email (no name), wrap in angle brackets
	const { name, email } = parseEmailAddress(sender);
	const emailLink = `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`;
	const formattedSender = name ? `${escapeHtml(name)} &lt;${emailLink}&gt;` : `&lt;${emailLink}&gt;`;

	return `On ${dayName}, ${month} ${day}, ${year} at ${timeStr} ${formattedSender} wrote:`;
}

/**
 * Format Gmail-style HTML quote block
 * @param date - RFC 2822 format date
 * @param sender - Email sender
 * @param body - Original email body (plain text)
 * @param htmlBody - Optional HTML body (already contains proper HTML with nested blockquotes)
 * @returns HTML quote block matching Gmail's format
 */
export function formatHtmlGmailQuote(date: string, sender: string, body: string, htmlBody?: string): string {
	const attributionLine = formatHtmlAttributionLine(date, sender);
	// Use HTML body directly if provided, otherwise escape plain text
	const quotedContent = htmlBody ? htmlBody : escapeHtml(body);

	return (
		`<div class="gmail_quote gmail_quote_container">` +
		`<div dir="ltr" class="gmail_attr">${attributionLine}<br></div>` +
		`<blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">` +
		`${quotedContent}</blockquote></div>`
	);
}

/**
 * Format complete HTML email body with reply
 * @param replyText - The reply text (plain)
 * @param date - Original message date
 * @param sender - Original sender
 * @param originalBody - Original message body (plain text)
 * @param originalHtmlBody - Optional HTML body (already contains proper HTML with nested blockquotes)
 * @returns Complete HTML body
 */
export function formatHtmlReplyBody(
	replyText: string,
	date: string,
	sender: string,
	originalBody: string,
	originalHtmlBody?: string,
): string {
	const htmlReply = textToHtml(replyText);
	const htmlQuote = formatHtmlGmailQuote(date, sender, originalBody, originalHtmlBody);

	return `<div dir="ltr"><div>${htmlReply}</div><br>${htmlQuote}</div>`;
}
