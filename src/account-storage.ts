import * as fs from "fs";
import * as path from "path";
import { getAppPaths } from "./paths.js";
import type { EmailAccount } from "./types.js";

const PATHS = getAppPaths();
const CONFIG_DIR = PATHS.config;
const LEGACY_CONFIG_DIR = PATHS.legacy;
const ACCOUNTS_FILE = path.join(CONFIG_DIR, "accounts.json");
const CREDENTIALS_FILE = path.join(CONFIG_DIR, "credentials.json");
const LEGACY_ACCOUNTS_FILE = path.join(LEGACY_CONFIG_DIR, "accounts.json");
const LEGACY_CREDENTIALS_FILE = path.join(LEGACY_CONFIG_DIR, "credentials.json");

export class AccountStorage {
	private accounts: Map<string, EmailAccount> = new Map();

	constructor() {
		this.ensureConfigDir();
		this.loadAccounts();
	}

	private ensureConfigDir(): void {
		if (!fs.existsSync(CONFIG_DIR)) {
			fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
		}
	}

	private loadAccounts(): void {
		const accountsFile = fs.existsSync(ACCOUNTS_FILE) ? ACCOUNTS_FILE : LEGACY_ACCOUNTS_FILE;
		if (fs.existsSync(accountsFile)) {
			try {
				const data = JSON.parse(fs.readFileSync(accountsFile, "utf8"));
				for (const account of data) {
					this.accounts.set(account.email, account);
				}
			} catch {
				// Ignore
			}
		}
	}

	private saveAccounts(): void {
		fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(Array.from(this.accounts.values()), null, 2), { mode: 0o600 });
	}

	addAccount(account: EmailAccount): void {
		this.accounts.set(account.email, account);
		this.saveAccounts();
	}

	getAccount(email: string): EmailAccount | undefined {
		return this.accounts.get(email);
	}

	getAllAccounts(): EmailAccount[] {
		return Array.from(this.accounts.values());
	}

	deleteAccount(email: string): boolean {
		const deleted = this.accounts.delete(email);
		if (deleted) this.saveAccounts();
		return deleted;
	}

	hasAccount(email: string): boolean {
		return this.accounts.has(email);
	}

	setCredentials(clientId: string, clientSecret: string): void {
		fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify({ clientId, clientSecret }, null, 2), { mode: 0o600 });
	}

	getCredentials(): { clientId: string; clientSecret: string } | null {
		const credentialsFile = fs.existsSync(CREDENTIALS_FILE) ? CREDENTIALS_FILE : LEGACY_CREDENTIALS_FILE;
		if (!fs.existsSync(credentialsFile)) return null;
		try {
			return JSON.parse(fs.readFileSync(credentialsFile, "utf8"));
		} catch {
			return null;
		}
	}
}
