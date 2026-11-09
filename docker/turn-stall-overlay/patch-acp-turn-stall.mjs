// Fail-closed patch of the OpenBot 0.65.0 app.asar silence watchdog.
// 0 turns the watchdog off. An absent value stays five minutes. Stop still ends the turn.
// The script checks the pinned bundle, then replaces one function. It does not scan the whole file for numbers.
import { createHash } from "node:crypto";
import { closeSync, openSync, readFileSync, readSync, renameSync, unlinkSync, writeSync } from "node:fs";

const EXPECTED_VERSION = "0.65.0";
const EXPECTED_LICENSE = "PolyForm-Noncommercial-1.0.0";
const EXPECTED_MAIN_SHA256 = "88efa4686246a2e46f8c7307968c9fe85cf4b22a29a1126336eac05b7ee01684";
const MARKER = "openbot-fork-acp-turn-stall-v1";
const MAIN_PATH = "/out/main/index.js";
const ANCHOR = "var ACP_TURN_STALL_MS = 3e5;\n";
const OLD_WATCH =
  '\t#watchStall = Effect.fn("AcpAgentClient.watchStall")(function* (thread, turn) {\n' +
  "\t\tconst limit = this.options.turnStallMs ?? ACP_TURN_STALL_MS;\n" +
  "\t\tlet answeredAt = 0;\n";
const NEW_WATCH =
  '\t#watchStall = Effect.fn("AcpAgentClient.watchStall")(function* (thread, turn) {\n' +
  "\t\tconst silenceMs = openbotResolveAcpModelSilenceMs(this.options.turnStallMs);\n" +
  "\t\tif (silenceMs === null && !this.#flavor.promptOpenForBackgroundTasks) return;\n" +
  "\t\tconst limit = silenceMs === null ? ACP_TURN_STALL_MS : silenceMs;\n" +
  "\t\tlet answeredAt = 0;\n";
const BACKGROUND_LINE = "const stallLimit = this.options.turnStallMs ?? ACP_TURN_STALL_MS;";
const PI_LINE = "Pi sent nothing for ";
const HELPER = `/* ${MARKER} */
var openbotAcpTurnStallWarned = false;
function openbotResolveAcpModelSilenceMs(configured) {
	if (typeof configured === "number") return openbotNormalizeAcpTurnStallNumber(configured, "turnStallMs");
	return openbotNormalizeAcpTurnStallText(process.env.OPENBOT_ACP_TURN_STALL_MS);
}
function openbotNormalizeAcpTurnStallNumber(value, source) {
	if (value === 0) return null;
	if (Number.isSafeInteger(value) && value > 0) return value;
	openbotWarnAcpTurnStall(source, String(value));
	return ACP_TURN_STALL_MS;
}
function openbotNormalizeAcpTurnStallText(raw) {
	if (raw === void 0 || String(raw).trim() === "") return ACP_TURN_STALL_MS;
	var text = String(raw).trim();
	if (!/^(?:0|[1-9]\\d*)$/.test(text)) {
		openbotWarnAcpTurnStall("OPENBOT_ACP_TURN_STALL_MS", text);
		return ACP_TURN_STALL_MS;
	}
	var value = Number(text);
	if (!Number.isSafeInteger(value)) {
		openbotWarnAcpTurnStall("OPENBOT_ACP_TURN_STALL_MS", text);
		return ACP_TURN_STALL_MS;
	}
	return value === 0 ? null : value;
}
function openbotWarnAcpTurnStall(source, text) {
	if (openbotAcpTurnStallWarned) return;
	openbotAcpTurnStallWarned = true;
	logger$79.warn(source + " is not a whole number of milliseconds. OpenBot keeps " + ACP_TURN_STALL_MS + " ms.", { value: text.slice(0, 64) });
}
`;

const archivePath = process.argv[2];
if (!archivePath) {
  fail("Use: node patch-acp-turn-stall.mjs <app.asar>");
}

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
let mainText;
let noticeHash;
try {
  packageJson = JSON.parse(readFileAt(readFd, dataStart, pkg).toString("utf8"));
  const mainBytes = readFileAt(readFd, dataStart, main);
  mainText = mainBytes.toString("utf8");
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
if (mainText.includes(MARKER)) fail("This archive is already patched. The script stops.");
const mainHash = sha256(Buffer.from(mainText));
if (mainHash !== EXPECTED_MAIN_SHA256) {
  fail(`out/main/index.js sha256 is ${mainHash}. The pinned 0.65.0 bundle is ${EXPECTED_MAIN_SHA256}.`);
}
assertCount(mainText, ANCHOR, 1, "ACP_TURN_STALL_MS anchor");
assertCount(mainText, OLD_WATCH, 1, "watchStall header");
assertCount(mainText, BACKGROUND_LINE, 1, "background stall line");
assertCount(mainText, PI_LINE, 1, "Pi stall line");

const patched = mainText.replace(ANCHOR, ANCHOR + HELPER).replace(OLD_WATCH, NEW_WATCH);
assertCount(patched, ANCHOR, 1, "ACP_TURN_STALL_MS anchor after the patch");
assertCount(patched, MARKER, 1, "patch marker");
assertCount(patched, OLD_WATCH, 0, "old watchStall header");
assertCount(patched, NEW_WATCH, 1, "new watchStall header");
assertCount(patched, "function openbotResolveAcpModelSilenceMs(", 1, "resolver");
assertCount(patched, BACKGROUND_LINE, 1, "background stall line after the patch");
assertCount(patched, PI_LINE, 1, "Pi stall line after the patch");
if (!patched.includes('process.env.OPENBOT_ACP_TURN_STALL_MS')) {
  fail("The patch did not keep the environment setting.");
}

const patchedBytes = Buffer.from(patched);
const delta = patchedBytes.length - main.size;
const ordered = files
  .filter((file) => file.offset !== undefined)
  .sort((left, right) => left.offset - right.offset);
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
      const bytes = readFileAt(copyFd, dataStart, {
        path: file.path,
        offset: file.originalOffset,
        size: file.size,
      });
      writeSync(out, bytes);
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
  const againText = readFileAt(checkFd, again.dataStart, againMain).toString("utf8");
  const againPackage = JSON.parse(readFileAt(checkFd, again.dataStart, againPkg).toString("utf8"));
  const againNoticeHash = sha256(readFileAt(checkFd, again.dataStart, againNotice));
  if (againPackage.version !== EXPECTED_VERSION) fail("The patched archive lost version 0.65.0.");
  if (againNoticeHash !== noticeHash) fail("The patch changed NOTICE.");
  assertCount(againText, MARKER, 1, "patched marker");
  assertCount(againText, NEW_WATCH, 1, "patched watchStall");
  assertCount(againText, OLD_WATCH, 0, "patched old watchStall");
  const againBytes = Buffer.from(againText);
  process.stdout.write(
    `patched ${MAIN_PATH} sha256 ${sha256(againBytes)} bytes ${againBytes.length} marker ${MARKER}\n`,
  );
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
  const header = JSON.parse(headerPickle.subarray(8, 8 + jsonLength).toString("utf8"));
  return { header, dataStart: 8 + headerPickleSize };
}

function encodeHeader(header) {
  const json = Buffer.from(JSON.stringify(header));
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

function readFileAt(fd, dataStart, file) {
  const bytes = Buffer.alloc(file.size);
  const read = readSync(fd, bytes, 0, file.size, dataStart + file.offset);
  if (read !== file.size) fail(`The read of ${file.path} was short.`);
  return bytes;
}
