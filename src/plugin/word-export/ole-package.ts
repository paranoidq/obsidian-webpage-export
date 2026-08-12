import * as CFB from "cfb";

const OLE10_NATIVE = "\u0001Ole10Native";
const OLE_MARKER = "\u0001Ole";
/** Minimal \u0001Ole marker used by Word Package embeds (from Apache POI). */
const OLE_MARKER_BYTES = Buffer.from([
	1, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
]);

export interface OlePackageOptions
{
	/** Display label / attachment name shown in Word (e.g. note.html). */
	label: string;
	/** File name stored in the package (usually same as label). */
	fileName: string;
	/** File bytes to embed. */
	data: Buffer;
}

function writeAsciiZ(chunks: Buffer[], value: string): void
{
	chunks.push(Buffer.from(value, "utf8"));
	chunks.push(Buffer.from([0]));
}

function writeUInt16LE(chunks: Buffer[], value: number): void
{
	const buf = Buffer.alloc(2);
	buf.writeUInt16LE(value, 0);
	chunks.push(buf);
}

function writeUInt32LE(chunks: Buffer[], value: number): void
{
	const buf = Buffer.alloc(4);
	buf.writeUInt32LE(value, 0);
	chunks.push(buf);
}

/**
 * Build an Ole10Native stream (parsed Package encoding) wrapping a file.
 * Layout matches Apache POI Ole10Native.writeOut for EncodingMode.parsed.
 */
export function buildOle10NativeStream(options: OlePackageOptions): Buffer
{
	const label = options.label || options.fileName;
	const fileName = options.fileName || label;
	const command = fileName;
	const body: Buffer[] = [];

	writeUInt16LE(body, 2); // flags1
	writeAsciiZ(body, label);
	writeAsciiZ(body, fileName);
	writeUInt16LE(body, 0); // flags2
	writeUInt16LE(body, 3); // unknown1
	writeUInt32LE(body, Buffer.byteLength(command, "utf8") + 1);
	writeAsciiZ(body, command);
	writeUInt32LE(body, options.data.length);
	body.push(options.data);
	writeUInt16LE(body, 0); // no UTF16 extended strings

	const payload = Buffer.concat(body);
	const out = Buffer.alloc(4 + payload.length);
	out.writeUInt32LE(payload.length, 0);
	payload.copy(out, 4);
	return out;
}

/**
 * Create a Word-compatible OLE Package compound file (oleObjectN.bin contents).
 */
export function createOlePackageBin(options: OlePackageOptions): Buffer
{
	const cfb = CFB.utils.cfb_new();
	CFB.utils.cfb_add(cfb, OLE_MARKER, OLE_MARKER_BYTES);
	CFB.utils.cfb_add(cfb, OLE10_NATIVE, buildOle10NativeStream(options));
	const written = CFB.write(cfb, { type: "buffer" }) as Buffer;
	return Buffer.from(written);
}
