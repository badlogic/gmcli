import { describe, expect, it } from "vitest";
import {
	escapeHtml,
	filterSelfFromRecipients,
	formatAttributionLine,
	formatGmailQuote,
	formatHtmlAttributionLine,
	formatHtmlGmailQuote,
	formatHtmlReplyBody,
	formatQuotedBody,
	formatReplySubject,
	parseEmailAddress,
	parseEmailList,
	textToHtml,
} from "./reply-utils.js";

describe("formatAttributionLine", () => {
	it('formats RFC 2822 date with "Name <email>" sender', () => {
		// Use a fixed UTC date to avoid timezone issues in tests
		const date = "Mon, 6 Jan 2025 18:30:00 +0000";
		const sender = "John Doe <john@example.com>";

		const result = formatAttributionLine(date, sender);

		// The exact time depends on local timezone, so we check the format
		// Gmail format: no comma after time, uses narrow non-breaking space before AM/PM
		expect(result).toMatch(/^On Mon, Jan 6, 2025 at \d{1,2}:\d{2}\u202F(AM|PM) John Doe <john@example\.com> wrote:$/);
	});

	it("produces Gmail-style format with AM time", () => {
		// Early morning UTC time
		const date = "Wed, 15 Mar 2023 08:05:00 +0000";
		const sender = "Jane Smith <jane@test.org>";

		const result = formatAttributionLine(date, sender);

		expect(result).toMatch(
			/^On \w+, \w+ \d+, \d{4} at \d{1,2}:\d{2}\u202F(AM|PM) Jane Smith <jane@test\.org> wrote:$/,
		);
		expect(result).toContain("Jane Smith <jane@test.org> wrote:");
	});

	it("produces Gmail-style format with PM time", () => {
		// Afternoon UTC time
		const date = "Fri, 20 Dec 2024 14:45:00 +0000";
		const sender = "Bob Wilson <bob@company.com>";

		const result = formatAttributionLine(date, sender);

		expect(result).toMatch(
			/^On \w+, \w+ \d+, \d{4} at \d{1,2}:\d{2}\u202F(AM|PM) Bob Wilson <bob@company\.com> wrote:$/,
		);
		expect(result).toContain("Bob Wilson <bob@company.com> wrote:");
	});

	it("handles plain email sender without name - wraps in angle brackets", () => {
		const date = "Tue, 1 Feb 2022 12:00:00 +0000";
		const sender = "noreply@service.com";

		const result = formatAttributionLine(date, sender);

		// Gmail wraps plain email in angle brackets
		expect(result).toContain("<noreply@service.com> wrote:");
	});

	it("pads minutes with leading zero", () => {
		const date = "Sun, 10 Jul 2024 09:05:00 +0000";
		const sender = "Test <test@example.com>";

		const result = formatAttributionLine(date, sender);

		// Should have :05 not :5, with narrow non-breaking space before AM/PM
		expect(result).toMatch(/:0\d\u202F(AM|PM)/);
	});
});

describe("formatQuotedBody", () => {
	it('prefixes each line with "> "', () => {
		const body = "Hello\nWorld\nTest";

		const result = formatQuotedBody(body);

		expect(result).toBe("> Hello\n> World\n> Test");
	});

	it("returns empty string for empty body", () => {
		expect(formatQuotedBody("")).toBe("");
	});

	it("returns empty string for falsy body", () => {
		// @ts-expect-error testing falsy values
		expect(formatQuotedBody(null)).toBe("");
		// @ts-expect-error testing falsy values
		expect(formatQuotedBody(undefined)).toBe("");
	});

	it("handles single line body", () => {
		const body = "Just one line";

		const result = formatQuotedBody(body);

		expect(result).toBe("> Just one line");
	});

	it("handles multiple lines with empty lines", () => {
		const body = "First line\n\nThird line";

		const result = formatQuotedBody(body);

		expect(result).toBe("> First line\n> \n> Third line");
	});

	it("preserves trailing newlines", () => {
		const body = "Line one\nLine two\n";

		const result = formatQuotedBody(body);

		expect(result).toBe("> Line one\n> Line two\n> ");
	});
});

describe("formatGmailQuote", () => {
	it("combines attribution and quoted body correctly", () => {
		const date = "Mon, 6 Jan 2025 10:30:00 +0000";
		const sender = "Alice <alice@example.com>";
		const body = "Hello there!\nHow are you?";

		const result = formatGmailQuote(date, sender, body);

		// Should start with two newlines
		expect(result.startsWith("\n\n")).toBe(true);

		// Should contain attribution line
		expect(result).toContain("Alice <alice@example.com> wrote:");

		// Should contain quoted body
		expect(result).toContain("> Hello there!");
		expect(result).toContain("> How are you?");
	});

	it('format starts with "\\n\\n"', () => {
		const date = "Tue, 7 Jan 2025 15:00:00 +0000";
		const sender = "Bob <bob@test.com>";
		const body = "Test message";

		const result = formatGmailQuote(date, sender, body);

		expect(result.slice(0, 2)).toBe("\n\n");
	});

	it("has blank line between attribution and quoted body", () => {
		const date = "Wed, 8 Jan 2025 09:00:00 +0000";
		const sender = "Carol <carol@mail.com>";
		const body = "Message content";

		const result = formatGmailQuote(date, sender, body);

		// Gmail format: blank line between attribution and quoted content
		expect(result).toMatch(/wrote:\n\n>/);
	});

	it("handles empty body", () => {
		const date = "Thu, 9 Jan 2025 12:00:00 +0000";
		const sender = "Dave <dave@example.com>";
		const body = "";

		const result = formatGmailQuote(date, sender, body);

		expect(result.startsWith("\n\n")).toBe(true);
		expect(result).toContain("wrote:");
		// Empty body should produce empty quoted section with blank line
		expect(result.endsWith("wrote:\n\n")).toBe(true);
	});
});

describe("formatReplySubject", () => {
	it('adds "Re: " prefix to plain subject', () => {
		const subject = "Meeting tomorrow";

		const result = formatReplySubject(subject);

		expect(result).toBe("Re: Meeting tomorrow");
	});

	it('does not double-add "Re: " prefix', () => {
		const subject = "Re: Meeting tomorrow";

		const result = formatReplySubject(subject);

		expect(result).toBe("Re: Meeting tomorrow");
	});

	it('handles "RE: " (uppercase)', () => {
		const subject = "RE: Important update";

		const result = formatReplySubject(subject);

		expect(result).toBe("RE: Important update");
	});

	it('handles "re: " (lowercase)', () => {
		const subject = "re: Quick question";

		const result = formatReplySubject(subject);

		expect(result).toBe("re: Quick question");
	});

	it('handles mixed case "Re:" variations', () => {
		expect(formatReplySubject("Re:Hello")).toBe("Re:Hello");
		expect(formatReplySubject("rE: Test")).toBe("rE: Test");
	});

	it("trims whitespace from subject", () => {
		const subject = "  Important message  ";

		const result = formatReplySubject(subject);

		expect(result).toBe("Re: Important message");
	});

	it("handles empty subject", () => {
		const result = formatReplySubject("");

		expect(result).toBe("Re: ");
	});
});

describe("parseEmailAddress", () => {
	it('parses "Name <email>" format', () => {
		const header = "John Doe <john@example.com>";

		const result = parseEmailAddress(header);

		expect(result).toEqual({
			name: "John Doe",
			email: "john@example.com",
		});
	});

	it("parses plain email format", () => {
		const header = "john@example.com";

		const result = parseEmailAddress(header);

		expect(result).toEqual({
			name: "",
			email: "john@example.com",
		});
	});

	it("handles spaces in name", () => {
		const header = "Mary Jane Watson <mary.jane@example.com>";

		const result = parseEmailAddress(header);

		expect(result).toEqual({
			name: "Mary Jane Watson",
			email: "mary.jane@example.com",
		});
	});

	it("trims whitespace from header", () => {
		const header = "  Jane Doe <jane@test.com>  ";

		const result = parseEmailAddress(header);

		expect(result).toEqual({
			name: "Jane Doe",
			email: "jane@test.com",
		});
	});

	it("handles extra spaces around angle brackets", () => {
		const header = "Bob Smith   <bob@company.org>";

		const result = parseEmailAddress(header);

		expect(result).toEqual({
			name: "Bob Smith",
			email: "bob@company.org",
		});
	});

	it("handles quoted display name", () => {
		const header = '"Last, First" <first.last@example.com>';

		const result = parseEmailAddress(header);

		expect(result).toEqual({
			name: '"Last, First"',
			email: "first.last@example.com",
		});
	});
});

describe("parseEmailList", () => {
	it("parses comma-separated emails", () => {
		const header = "alice@example.com, bob@test.com, carol@mail.org";

		const result = parseEmailList(header);

		expect(result).toEqual(["alice@example.com", "bob@test.com", "carol@mail.org"]);
	});

	it("parses mixed formats (plain + name<email>)", () => {
		const header = "Alice Smith <alice@example.com>, bob@test.com, Carol Jones <carol@mail.org>";

		const result = parseEmailList(header);

		expect(result).toEqual(["alice@example.com", "bob@test.com", "carol@mail.org"]);
	});

	it("parses single email", () => {
		const header = "only@one.com";

		const result = parseEmailList(header);

		expect(result).toEqual(["only@one.com"]);
	});

	it("parses single named email", () => {
		const header = "Only Person <only@one.com>";

		const result = parseEmailList(header);

		expect(result).toEqual(["only@one.com"]);
	});

	it("returns empty array for empty string", () => {
		expect(parseEmailList("")).toEqual([]);
	});

	it("returns empty array for whitespace-only string", () => {
		expect(parseEmailList("   ")).toEqual([]);
	});

	it("handles extra whitespace around commas", () => {
		const header = "a@example.com  ,  b@example.com  ,  c@example.com";

		const result = parseEmailList(header);

		expect(result).toEqual(["a@example.com", "b@example.com", "c@example.com"]);
	});
});

describe("filterSelfFromRecipients", () => {
	it("removes self from list", () => {
		const recipients = ["alice@example.com", "bob@test.com", "carol@mail.org"];
		const selfEmail = "bob@test.com";

		const result = filterSelfFromRecipients(recipients, selfEmail);

		expect(result).toEqual(["alice@example.com", "carol@mail.org"]);
	});

	it("uses case-insensitive matching", () => {
		const recipients = ["Alice@Example.COM", "bob@test.com"];
		const selfEmail = "alice@example.com";

		const result = filterSelfFromRecipients(recipients, selfEmail);

		expect(result).toEqual(["bob@test.com"]);
	});

	it("handles self not in list (no change)", () => {
		const recipients = ["alice@example.com", "bob@test.com"];
		const selfEmail = "other@somewhere.com";

		const result = filterSelfFromRecipients(recipients, selfEmail);

		expect(result).toEqual(["alice@example.com", "bob@test.com"]);
	});

	it("returns empty array when only self in list", () => {
		const recipients = ["me@example.com"];
		const selfEmail = "me@example.com";

		const result = filterSelfFromRecipients(recipients, selfEmail);

		expect(result).toEqual([]);
	});

	it("handles empty recipient list", () => {
		const recipients: string[] = [];
		const selfEmail = "me@example.com";

		const result = filterSelfFromRecipients(recipients, selfEmail);

		expect(result).toEqual([]);
	});

	it("removes multiple occurrences of self", () => {
		const recipients = ["me@example.com", "other@test.com", "ME@EXAMPLE.COM"];
		const selfEmail = "me@example.com";

		const result = filterSelfFromRecipients(recipients, selfEmail);

		expect(result).toEqual(["other@test.com"]);
	});
});

describe("escapeHtml", () => {
	it("escapes ampersand", () => {
		expect(escapeHtml("Tom & Jerry")).toBe("Tom &amp; Jerry");
	});

	it("escapes less than sign", () => {
		expect(escapeHtml("a < b")).toBe("a &lt; b");
	});

	it("escapes greater than sign", () => {
		expect(escapeHtml("a > b")).toBe("a &gt; b");
	});

	it("escapes double quotes", () => {
		expect(escapeHtml('say "hello"')).toBe("say &quot;hello&quot;");
	});

	it("escapes all special characters together", () => {
		const input = '<div class="test">Tom & Jerry</div>';
		const expected = "&lt;div class=&quot;test&quot;&gt;Tom &amp; Jerry&lt;/div&gt;";
		expect(escapeHtml(input)).toBe(expected);
	});

	it("returns text unchanged when no special chars", () => {
		const input = "Hello World! This is a test.";
		expect(escapeHtml(input)).toBe(input);
	});

	it("returns empty string for empty input", () => {
		expect(escapeHtml("")).toBe("");
	});
});

describe("textToHtml", () => {
	it("converts newlines to <br>", () => {
		const input = "Line one\nLine two\nLine three";
		const expected = "Line one<br>Line two<br>Line three";
		expect(textToHtml(input)).toBe(expected);
	});

	it("escapes special chars while converting", () => {
		const input = "Hello <World>\nTom & Jerry";
		const expected = "Hello &lt;World&gt;<br>Tom &amp; Jerry";
		expect(textToHtml(input)).toBe(expected);
	});

	it("handles text with no newlines", () => {
		const input = "Just one line";
		expect(textToHtml(input)).toBe("Just one line");
	});

	it("handles empty string", () => {
		expect(textToHtml("")).toBe("");
	});

	it("handles multiple consecutive newlines", () => {
		const input = "Line one\n\n\nLine two";
		const expected = "Line one<br><br><br>Line two";
		expect(textToHtml(input)).toBe(expected);
	});
});

describe("formatHtmlAttributionLine", () => {
	it("produces HTML with mailto link", () => {
		const date = "Mon, 6 Jan 2025 18:30:00 +0000";
		const sender = "John Doe <john@example.com>";

		const result = formatHtmlAttributionLine(date, sender);

		expect(result).toContain('<a href="mailto:john@example.com">john@example.com</a>');
		expect(result).toContain("wrote:");
	});

	it("handles plain email (no name)", () => {
		const date = "Tue, 7 Jan 2025 10:00:00 +0000";
		const sender = "noreply@service.com";

		const result = formatHtmlAttributionLine(date, sender);

		expect(result).toContain('<a href="mailto:noreply@service.com">noreply@service.com</a>');
		// Plain email should be wrapped in escaped angle brackets
		expect(result).toContain('&lt;<a href="mailto:noreply@service.com">noreply@service.com</a>&gt;');
		expect(result).toContain("wrote:");
	});

	it('handles "Name <email>" format', () => {
		const date = "Wed, 8 Jan 2025 14:00:00 +0000";
		const sender = "Alice Smith <alice@example.com>";

		const result = formatHtmlAttributionLine(date, sender);

		expect(result).toContain("Alice Smith");
		expect(result).toContain('&lt;<a href="mailto:alice@example.com">alice@example.com</a>&gt;');
		expect(result).toContain("wrote:");
	});

	it("escapes special characters in name", () => {
		const date = "Thu, 9 Jan 2025 09:00:00 +0000";
		const sender = "Tom & Jerry <tom@example.com>";

		const result = formatHtmlAttributionLine(date, sender);

		expect(result).toContain("Tom &amp; Jerry");
		expect(result).toContain('<a href="mailto:tom@example.com">tom@example.com</a>');
	});
});

describe("formatHtmlGmailQuote", () => {
	it("escapes plain text body", () => {
		const date = "Mon, 6 Jan 2025 18:30:00 +0000";
		const sender = "John Doe <john@example.com>";
		const body = "Hello <World> & everyone";

		const result = formatHtmlGmailQuote(date, sender, body);

		expect(result).toContain("Hello &lt;World&gt; &amp; everyone");
	});

	it("uses HTML body directly without escaping", () => {
		const date = "Tue, 7 Jan 2025 10:00:00 +0000";
		const sender = "Alice <alice@example.com>";
		const body = "Plain text fallback";
		const htmlBody = "<div>Already <strong>formatted</strong> HTML</div>";

		const result = formatHtmlGmailQuote(date, sender, body, htmlBody);

		expect(result).toContain("<div>Already <strong>formatted</strong> HTML</div>");
		expect(result).not.toContain("Plain text fallback");
	});

	it("includes blockquote CSS styles", () => {
		const date = "Wed, 8 Jan 2025 14:00:00 +0000";
		const sender = "Bob <bob@example.com>";
		const body = "Test message";

		const result = formatHtmlGmailQuote(date, sender, body);

		expect(result).toContain(
			'style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex"',
		);
	});

	it("includes gmail_quote class", () => {
		const date = "Thu, 9 Jan 2025 09:00:00 +0000";
		const sender = "Carol <carol@example.com>";
		const body = "Another test";

		const result = formatHtmlGmailQuote(date, sender, body);

		expect(result).toContain('class="gmail_quote gmail_quote_container"');
		expect(result).toContain('class="gmail_attr"');
		expect(result).toContain('<blockquote class="gmail_quote"');
	});

	it("includes attribution line with wrote:", () => {
		const date = "Fri, 10 Jan 2025 12:00:00 +0000";
		const sender = "Dave <dave@example.com>";
		const body = "Message content";

		const result = formatHtmlGmailQuote(date, sender, body);

		expect(result).toContain("wrote:<br>");
	});
});

describe("formatHtmlReplyBody", () => {
	it("formats reply with plain text only", () => {
		const replyText = "Thanks for your message!";
		const date = "Mon, 6 Jan 2025 18:30:00 +0000";
		const sender = "John Doe <john@example.com>";
		const originalBody = "Original message here";

		const result = formatHtmlReplyBody(replyText, date, sender, originalBody);

		expect(result).toContain("Thanks for your message!");
		expect(result).toContain("Original message here");
		expect(result).toContain("wrote:");
	});

	it("uses HTML body for nested quotes", () => {
		const replyText = "My reply";
		const date = "Tue, 7 Jan 2025 10:00:00 +0000";
		const sender = "Alice <alice@example.com>";
		const originalBody = "Plain text fallback";
		const originalHtmlBody = "<div>HTML with <blockquote>nested quote</blockquote></div>";

		const result = formatHtmlReplyBody(replyText, date, sender, originalBody, originalHtmlBody);

		expect(result).toContain("My reply");
		expect(result).toContain("<div>HTML with <blockquote>nested quote</blockquote></div>");
		expect(result).not.toContain("Plain text fallback");
	});

	it("includes correct structure with reply text and quote", () => {
		const replyText = "Hello!";
		const date = "Wed, 8 Jan 2025 14:00:00 +0000";
		const sender = "Bob <bob@example.com>";
		const originalBody = "Hi there";

		const result = formatHtmlReplyBody(replyText, date, sender, originalBody);

		// Check overall structure
		expect(result).toMatch(/^<div dir="ltr">/);
		expect(result).toMatch(/<\/div>$/);
		expect(result).toContain("<div>Hello!</div>");
		expect(result).toContain('<br><div class="gmail_quote gmail_quote_container">');
	});

	it("escapes special chars in reply text", () => {
		const replyText = "Check this: <script> & more";
		const date = "Thu, 9 Jan 2025 09:00:00 +0000";
		const sender = "Carol <carol@example.com>";
		const originalBody = "Original";

		const result = formatHtmlReplyBody(replyText, date, sender, originalBody);

		expect(result).toContain("Check this: &lt;script&gt; &amp; more");
	});

	it("converts newlines in reply text to <br>", () => {
		const replyText = "Line one\nLine two\nLine three";
		const date = "Fri, 10 Jan 2025 12:00:00 +0000";
		const sender = "Dave <dave@example.com>";
		const originalBody = "Original message";

		const result = formatHtmlReplyBody(replyText, date, sender, originalBody);

		expect(result).toContain("Line one<br>Line two<br>Line three");
	});
});
