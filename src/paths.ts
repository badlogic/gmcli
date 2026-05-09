import * as os from "os";
import * as path from "path";

const APP_NAME = "gmcli";
const LEGACY_DIR_NAME = ".gmcli";

export interface AppPaths {
	data: string;
	config: string;
	cache: string;
	log: string;
	temp: string;
	legacy: string;
}

function homePath(...parts: string[]): string {
	return path.join(os.homedir(), ...parts);
}

function windows(name: string): Omit<AppPaths, "legacy"> {
	const appData = process.env.APPDATA || homePath("AppData", "Roaming");
	const localAppData = process.env.LOCALAPPDATA || homePath("AppData", "Local");

	return {
		data: path.join(localAppData, name, "Data"),
		config: path.join(appData, name, "Config"),
		cache: path.join(localAppData, name, "Cache"),
		log: path.join(localAppData, name, "Log"),
		temp: path.join(os.tmpdir(), name),
	};
}

// https://specifications.freedesktop.org/basedir-spec/basedir-spec-latest.html
function linux(name: string): Omit<AppPaths, "legacy"> {
	const username = path.basename(os.homedir());

	return {
		data: path.join(process.env.XDG_DATA_HOME || homePath(".local", "share"), name),
		config: path.join(process.env.XDG_CONFIG_HOME || homePath(".config"), name),
		cache: path.join(process.env.XDG_CACHE_HOME || homePath(".cache"), name),
		log: path.join(process.env.XDG_STATE_HOME || homePath(".local", "state"), name),
		temp: path.join(os.tmpdir(), username, name),
	};
}

export function getAppPaths(name = APP_NAME): AppPaths {
	const base = process.platform === "win32" ? windows(name) : linux(name);

	return {
		...base,
		legacy: homePath(LEGACY_DIR_NAME),
	};
}

export function getAttachmentsDir(): string {
	return path.join(getAppPaths().data, "attachments");
}
