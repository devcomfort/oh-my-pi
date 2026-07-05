import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { filterProcessEnv, parseEnvFile } from "@oh-my-pi/pi-utils/env";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { force: true, recursive: true });
	}
});

function writeTempEnv(content: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-utils-env-"));
	tempDirs.push(dir);
	const filePath = path.join(dir, ".env");
	fs.writeFileSync(filePath, content);
	return filePath;
}

async function probeProjectEnv(cwd: string, ignore: boolean): Promise<string> {
	const env = { ...process.env } as Record<string, string | undefined>;
	if (ignore) env.PI_IGNORE_PROJECT_ENV = "1";
	else delete env.PI_IGNORE_PROJECT_ENV;
	delete env.OMP_TEST_MARKER;
	const proc = Bun.spawn({
		cmd: [
			"bun",
			"-e",
			"import '/mnt/workspace/omp-fork/oh-my-pi/packages/utils/src/env.ts'; console.log(Bun.env.OMP_TEST_MARKER ?? '(unset)');",
		],
		cwd,
		env: env as Record<string, string>,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exit] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (exit !== 0) throw new Error(stderr || `exit ${exit}`);
	return stdout.trim();
}

describe("parseEnvFile", () => {
	it("ignores malformed names and nul-containing values", () => {
		const filePath = writeTempEnv(
			[
				"GOOD=value",
				"_ALSO_GOOD='quoted value'",
				"1BAD=value",
				"BAD-NAME=value",
				"BAD NAME=value",
				"BAD_VALUE=before\0after",
				"# comment",
				"NO_EQUALS",
			].join("\n"),
		);

		expect(parseEnvFile(filePath)).toEqual({
			GOOD: "value",
			_ALSO_GOOD: "quoted value",
		});
	});

	it("mirrors valid OMP_ variables to PI_ variables", () => {
		const filePath = writeTempEnv("OMP_FEATURE=enabled\nOMP_BAD=before\0after\n");

		expect(parseEnvFile(filePath)).toEqual({
			OMP_FEATURE: "enabled",
			PI_FEATURE: "enabled",
		});
	});
});

describe("filterProcessEnv", () => {
	it("drops entries that cannot be passed to process spawn env", () => {
		expect(
			filterProcessEnv({
				GOOD: "value",
				EMPTY: "",
				"BAD=NAME": "value",
				BAD_VALUE: "before\0after",
				MISSING: undefined,
			}),
		).toEqual({
			GOOD: "value",
			EMPTY: "",
		});
	});

	it("drops macOS malloc stack logging toggles instead of forwarding disabled values", () => {
		expect(
			filterProcessEnv({
				GOOD: "value",
				MallocStackLogging: "0",
				MallocStackLoggingNoCompact: "0",
			}),
		).toEqual({
			GOOD: "value",
		});
	});

	it("preserves Windows-style variable names containing parentheses", () => {
		expect(
			filterProcessEnv({
				"ProgramFiles(x86)": "C:\\Program Files (x86)",
				"CommonProgramFiles(x86)": "C:\\Program Files (x86)\\Common Files",
			}),
		).toEqual({
			"ProgramFiles(x86)": "C:\\Program Files (x86)",
			"CommonProgramFiles(x86)": "C:\\Program Files (x86)\\Common Files",
		});
	});
});

describe("PI_IGNORE_PROJECT_ENV", () => {
	it("strips Bun pre-loaded project .env keys when PI_IGNORE_PROJECT_ENV=1", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-utils-env-"));
		tempDirs.push(dir);
		fs.writeFileSync(path.join(dir, ".env"), "OMP_TEST_MARKER=from-project\n");
		expect(await probeProjectEnv(dir, true)).toBe("(unset)");
	});

	it("keeps project .env keys when PI_IGNORE_PROJECT_ENV is unset", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-utils-env-"));
		tempDirs.push(dir);
		fs.writeFileSync(path.join(dir, ".env"), "OMP_TEST_MARKER=from-project\n");
		expect(await probeProjectEnv(dir, false)).toBe("from-project");
	});
});
