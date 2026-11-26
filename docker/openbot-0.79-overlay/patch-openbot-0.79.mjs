// Fail-closed patch of the OpenBot 0.79.0 app.asar. Author: TheWalkingGlitch.
// (a) OPENBOT_ACP_TURN_STALL_MS: 0 turns off the ACP model-silence watchdog for a normal turn,
//     and gives custom endpoints a 24 hour OpenCode request timeout. The background stall value stays 30 minutes.
//     A positive whole number is an exact silence limit in milliseconds, and it replaces the 30 minute stall value.
//     Absent or invalid: upstream behaviour.
// (b) OPENBOT_CONTEXT_COMPACTION_THRESHOLD: share of the context window where OpenBot compacts or hands off.
//     "0.9" or "90". Default 0.9. Allowed 0.55 to 0.98.
// The script checks the pinned bundle, then replaces exact strings that must each occur once.
import { createHash } from "node:crypto";
import { closeSync, openSync, readSync, renameSync, unlinkSync, writeSync } from "node:fs";

const EXPECTED_VERSION = "0.79.0";
const EXPECTED_LICENSE = "PolyForm-Noncommercial-1.0.0";
const EXPECTED_MAIN_SHA256 = "95ac587b765dea90a910866915aa3dd66e01398f3f73c5cb55eb857086261646";
const MARKER = "openbot-fork-acp-turn-stall-v2-compaction-v1";
const MAIN_PATH = "/out/main/index.js";

const HELPER = `/* ${MARKER} */
var openbotForkWarned = {};
function openbotForkWarn(name, text) {
	if (openbotForkWarned[name]) return;
	openbotForkWarned[name] = true;
	console.warn("[openbot-fork] " + name + " is not valid; OpenBot keeps its default.", String(text).slice(0, 64));
}
function openbotAcpTurnStallEnv() {
	var raw = process.env.OPENBOT_ACP_TURN_STALL_MS;
	if (raw === void 0 || String(raw).trim() === "") return void 0;
	var text = String(raw).trim();
	if (!/^(?:0|[1-9]\\d*)$/.test(text) || !Number.isSafeInteger(Number(text))) {
		openbotForkWarn("OPENBOT_ACP_TURN_STALL_MS", text);
		return void 0;
	}
	var value = Number(text);
	return value === 0 ? null : value;
}
function openbotResolveAcpModelSilenceMs(configured) {
	if (typeof configured === "number") {
		if (configured === 0) return null;
		if (Number.isSafeInteger(configured) && configured > 0) return configured;
		openbotForkWarn("turnStallMs", configured);
		return void 0;
	}
	return openbotAcpTurnStallEnv();
}
function openbotCustomEndpointSilenceMs(upstream) {
	var value = openbotAcpTurnStallEnv();
	if (value === null) return 864e5;
	return typeof value === "number" ? value : upstream;
}
function openbotStallLimitMs(upstream) {
	var value = openbotAcpTurnStallEnv();
	return typeof value === "number" ? value : upstream;
}
function openbotCompactionThreshold() {
	var raw = process.env.OPENBOT_CONTEXT_COMPACTION_THRESHOLD;
	if (raw === void 0 || String(raw).trim() === "") return .9;
	var text = String(raw).trim();
	var value = /^\\d+(?:\\.\\d+)?$/.test(text) ? Number(text) : NaN;
	if (value > 1) value = value / 100;
	if (!(value >= .55 && value <= .98)) {
		openbotForkWarn("OPENBOT_CONTEXT_COMPACTION_THRESHOLD", text);
		return .9;
	}
	return value;
}
`;

const WATCH_OLD =
  '\t#watchStall = Effect.fn("AcpAgentClient.watchStall")(function* (thread, turn) {\n' +
  "\t\tconst agentLimit = this.options.turnStallMs ?? this.#flavor.turnStallMs ?? ACP_TURN_STALL_MS;\n" +
  "\t\tconst grace = this.#flavor.modelRetryUpdate ? ACP_MODEL_RETRY_GRACE : 1;\n" +
  "\t\tlet answeredAt = 0;\n" +
  "\t\twhile (thread.activeTurn === turn && !turn.completing && !turn.stopped) {\n" +
  "\t\t\tconst limit = (this.options.customEndpoint?.(thread.currentModelId)?.stallMs ?? agentLimit) * grace;\n";
const WATCH_NEW =
  '\t#watchStall = Effect.fn("AcpAgentClient.watchStall")(function* (thread, turn) {\n' +
  "\t\tconst openbotSilenceMs = openbotResolveAcpModelSilenceMs(this.options.turnStallMs);\n" +
  "\t\tif (openbotSilenceMs === null && !this.#flavor.promptOpenForBackgroundTasks) return;\n" +
  "\t\tconst agentLimit = this.options.turnStallMs ?? this.#flavor.turnStallMs ?? ACP_TURN_STALL_MS;\n" +
  "\t\tconst grace = this.#flavor.modelRetryUpdate ? ACP_MODEL_RETRY_GRACE : 1;\n" +
  "\t\tlet answeredAt = 0;\n" +
  "\t\twhile (thread.activeTurn === turn && !turn.completing && !turn.stopped) {\n" +
  '\t\t\tconst limit = typeof openbotSilenceMs === "number" ? openbotSilenceMs : (this.options.customEndpoint?.(thread.currentModelId)?.stallMs ?? agentLimit) * grace;\n';

const SITES = [
  [
    "S1 helper + compaction threshold",
    "var CONTEXT_COMPACTION_THRESHOLD = .8;\nvar INEFFECTIVE_COMPACTION_SHARE = .7000000000000001;\n",
    `${HELPER}var CONTEXT_COMPACTION_THRESHOLD = openbotCompactionThreshold();\nvar INEFFECTIVE_COMPACTION_SHARE = CONTEXT_COMPACTION_THRESHOLD - .1;\n`,
  ],
  [
    "S2 updateBudget pressured check",
    "\t\tif (!(usedTokens / contextWindow >= .8)) {\n",
    "\t\tif (!(usedTokens / contextWindow >= CONTEXT_COMPACTION_THRESHOLD)) {\n",
  ],
  [
    "S3 expectInput check",
    "\t\tif (estimated / budget.contextWindow < .8) return;\n",
    "\t\tif (estimated / budget.contextWindow < CONTEXT_COMPACTION_THRESHOLD) return;\n",
  ],
  [
    "S4 context meter autoCompactAt",
    "compactsOnRequest(source.contextCompaction) ? .8 : null",
    "compactsOnRequest(source.contextCompaction) ? CONTEXT_COMPACTION_THRESHOLD : null",
  ],
  ["S5 acp-client watchStall", WATCH_OLD, WATCH_NEW],
  [
    "S6 opencode request timeouts",
    "var CUSTOM_ENDPOINT_SILENCE_MS = 18e5;\n",
    "var CUSTOM_ENDPOINT_SILENCE_MS = openbotCustomEndpointSilenceMs(18e5);\n",
  ],
  [
    "S7 stall value stays upstream when the watchdog is off",
    "stallMs: CUSTOM_ENDPOINT_SILENCE_MS,",
    "stallMs: openbotStallLimitMs(18e5),",
  ],
];

const KEPT = [
  "var ACP_TURN_STALL_MS = 3e5;\n",
  "var ACP_MODEL_RETRY_GRACE = 1.2;\n",
  "\t\tif (turn.openbotToolCalls > 0 || this.#flavor.openToolStallMs === void 0) return Number.POSITIVE_INFINITY;\n",
  "headerTimeout: CUSTOM_ENDPOINT_SILENCE_MS,",
  "chunkTimeout: CUSTOM_ENDPOINT_SILENCE_MS,",
  '\tcontextCompaction: "handoff",\n\treopenKeepsPrompts: true,\n',
];

const archivePath = process.argv[2];
if (!archivePath) fail("Use: node patch-openbot-0.79.mjs <app.asar>");

const fd = openSync(archivePath, "r");
let header;
let dataStart;
try {
  ({ header, dataStart } = readHeader(fd));
} finally {
  closeSync(fd);
}

const files = [];
walk(header, "", files);
const main = files.find((file) => file.path === MAIN_PATH);
const pkg = files.find((file) => file.path === "/package.json");
const notice = files.find((file) => file.path === "/NOTICE");
if (!main || main.offset === undefined) fail(`The archive has no ${MAIN_PATH}.`);
if (!pkg) fail("The archive has no /package.json.");
if (!notice) fail("The archive has no /NOTICE.");

const readFd = openSync(archivePath, "r");
let packageJson;
let mainBytes;
let noticeHash;
try {
  packageJson = JSON.parse(readFileAt(readFd, dataStart, pkg).toString("utf8"));
  mainBytes = readFileAt(readFd, dataStart, main);
  noticeHash = sha256(readFileAt(readFd, dataStart, notice));
} finally {
  closeSync(readFd);
}

if (packageJson.version !== EXPECTED_VERSION) {
  fail(`OpenBot version is ${packageJson.version}. This patch accepts only ${EXPECTED_VERSION}.`);
}
if (packageJson.license !== EXPECTED_LICENSE) {
  fail(`The license is ${packageJson.license}. This patch accepts only ${EXPECTED_LICENSE}.`);
}
const mainText = mainBytes.toString("utf8");
if (!Buffer.from(mainText).equals(mainBytes)) fail("out/main/index.js is not valid UTF-8. The patch stops.");
if (mainText.includes("openbot-fork-")) fail("This archive is already patched. The script stops.");
const mainHash = sha256(mainBytes);
if (mainHash !== EXPECTED_MAIN_SHA256) {
  fail(`out/main/index.js sha256 is ${mainHash}. The pinned ${EXPECTED_VERSION} bundle is ${EXPECTED_MAIN_SHA256}.`);
}
for (const [label, before] of SITES) assertCount(mainText, before, 1, label);
for (const line of KEPT) assertCount(mainText, line, 1, `kept line ${JSON.stringify(line.slice(0, 50))}`);

let patched = mainText;
for (const [label, before, after] of SITES) {
  patched = patched.replace(before, () => after);
  assertCount(patched, before, 0, `${label} (old text after the patch)`);
  assertCount(patched, after, 1, `${label} (new text)`);
}
for (const line of KEPT) assertCount(patched, line, 1, `kept line after the patch ${JSON.stringify(line.slice(0, 50))}`);
assertCount(patched, MARKER, 1, "patch marker");
for (const fn of [
  "openbotResolveAcpModelSilenceMs",
  "openbotCustomEndpointSilenceMs",
  "openbotStallLimitMs",
  "openbotCompactionThreshold",
])
  assertCount(patched, `function ${fn}(`, 1, fn);
for (const env of ["process.env.OPENBOT_ACP_TURN_STALL_MS", "process.env.OPENBOT_CONTEXT_COMPACTION_THRESHOLD"])
  assertCount(patched, env, 1, env);

const patchedBytes = Buffer.from(patched);
if (!patchedBytes.equals(Buffer.from(patchedBytes.toString("utf8")))) fail("The patched bundle is not valid UTF-8.");
const delta = patchedBytes.length - main.size;
const ordered = files.filter((file) => file.offset !== undefined).sort((left, right) => left.offset - right.offset);
let cursor = 0;
for (const file of ordered) {
  if (file.offset !== cursor) fail(`The archive has a gap before ${file.path}.`);
  file.originalOffset = file.offset;
  cursor += file.size;
}
for (const file of ordered) {
  if (file.originalOffset > main.offset) file.offset = file.originalOffset + delta;
  file.node.offset = String(file.offset);
}
main.node.size = patchedBytes.length;

const headerBytes = encodeHeader(header);
const tempPath = `${archivePath}.patching`;
const out = openSync(tempPath, "w");
try {
  writeSync(out, headerBytes);
  const copyFd = openSync(archivePath, "r");
  try {
    for (const file of ordered) {
      if (file.path === MAIN_PATH) {
        writeSync(out, patchedBytes);
        continue;
      }
      writeSync(
        out,
        readFileAt(copyFd, dataStart, { path: file.path, offset: file.originalOffset, size: file.size }),
      );
    }
  } finally {
    closeSync(copyFd);
  }
} catch (error) {
  closeSync(out);
  unlinkSync(tempPath);
  throw error;
}
closeSync(out);
renameSync(tempPath, archivePath);

const checkFd = openSync(archivePath, "r");
try {
  const again = readHeader(checkFd);
  const againFiles = [];
  walk(again.header, "", againFiles);
  const againMain = againFiles.find((file) => file.path === MAIN_PATH);
  const againPkg = againFiles.find((file) => file.path === "/package.json");
  const againNotice = againFiles.find((file) => file.path === "/NOTICE");
  const againBytes = readFileAt(checkFd, again.dataStart, againMain);
  const againText = againBytes.toString("utf8");
  const againPackage = JSON.parse(readFileAt(checkFd, again.dataStart, againPkg).toString("utf8"));
  const againNoticeHash = sha256(readFileAt(checkFd, again.dataStart, againNotice));
  if (againPackage.version !== EXPECTED_VERSION) fail(`The patched archive lost version ${EXPECTED_VERSION}.`);
  if (againPackage.license !== EXPECTED_LICENSE) fail("The patched archive lost the license.");
  if (againNoticeHash !== noticeHash) fail("The patch changed NOTICE.");
  if (!Buffer.from(againText).equals(againBytes)) fail("The written bundle is not valid UTF-8.");
  assertCount(againText, MARKER, 1, "patched marker");
  for (const [label, before, after] of SITES) {
    assertCount(againText, before, 0, `${label} in the written archive (old)`);
    assertCount(againText, after, 1, `${label} in the written archive (new)`);
  }
  process.stdout.write(`patched ${MAIN_PATH} sha256 ${sha256(againBytes)} bytes ${againBytes.length} marker ${MARKER}\n`);
} finally {
  closeSync(checkFd);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function assertCount(text, needle, expected, label) {
  const count = text.split(needle).length - 1;
  if (count !== expected) fail(`${label} occurs ${count} times. The patch requires ${expected}.`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function readHeader(fd) {
  const sizeBuf = Buffer.alloc(8);
  if (readSync(fd, sizeBuf, 0, 8, 0) !== 8) fail("The ASAR size pickle is short.");
  if (sizeBuf.readUInt32LE(0) !== 4) fail("The ASAR size pickle is not 4 bytes.");
  const headerPickleSize = sizeBuf.readUInt32LE(4);
  const headerPickle = Buffer.alloc(headerPickleSize);
  if (readSync(fd, headerPickle, 0, headerPickleSize, 8) !== headerPickleSize) fail("The ASAR header is short.");
  const payloadSize = headerPickle.readUInt32LE(0);
  const jsonLength = headerPickle.readUInt32LE(4);
  if (payloadSize !== headerPickleSize - 4) fail("The ASAR header pickle size does not match.");
  if (8 + jsonLength > headerPickle.length) fail("The ASAR header JSON is past the pickle.");
  return {
    header: JSON.parse(headerPickle.subarray(8, 8 + jsonLength).toString("utf8")),
    dataStart: 8 + headerPickleSize,
  };
}

function encodeHeader(value) {
  const json = Buffer.from(JSON.stringify(value));
  const pad = (4 - (json.length % 4)) % 4;
  const payloadSize = 4 + json.length + pad;
  const headerPickleSize = 4 + payloadSize;
  const out = Buffer.alloc(8 + headerPickleSize);
  out.writeUInt32LE(4, 0);
  out.writeUInt32LE(headerPickleSize, 4);
  out.writeUInt32LE(payloadSize, 8);
  out.writeUInt32LE(json.length, 12);
  json.copy(out, 16);
  return out;
}

function walk(node, path, out) {
  if (node.files) {
    for (const [name, child] of Object.entries(node.files)) walk(child, `${path}/${name}`, out);
    return;
  }
  out.push({
    path,
    size: node.size,
    offset: node.offset === undefined ? undefined : Number(node.offset),
    node,
  });
}

function readFileAt(fd, start, file) {
  const bytes = Buffer.alloc(file.size);
  const read = readSync(fd, bytes, 0, file.size, start + file.offset);
  if (read !== file.size) fail(`The read of ${file.path} was short.`);
  return bytes;
}
