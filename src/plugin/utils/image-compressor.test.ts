import assert from "assert";
import { parseDataUri, toDataUri } from "./image-compressor";

let failed = 0;

function test(name: string, fn: () => void)
{
	try
	{
		fn();
		console.log("ok -", name);
	}
	catch (error)
	{
		failed++;
		console.error("not ok -", name);
		console.error(error);
	}
}

test("round-trips a small png buffer through toDataUri/parseDataUri", () =>
{
	const original = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	const parsed = parseDataUri(toDataUri("image/png", original));
	assert.ok(parsed);
	assert.strictEqual(parsed.mime, "image/png");
	assert.ok(original.equals(parsed.buffer));
});

test("accepts case-insensitive data: and ;base64 markers", () =>
{
	const parsed = parseDataUri("DATA:IMAGE/JPEG;BASE64,QQ==");
	assert.ok(parsed);
	assert.strictEqual(parsed.mime, "IMAGE/JPEG");
	assert.strictEqual(parsed.buffer.toString("utf8"), "A");
});

test("returns undefined for invalid input instead of throwing", () =>
{
	assert.strictEqual(parseDataUri(""), undefined);
	assert.strictEqual(parseDataUri("https://example.com/a.png"), undefined);
	assert.strictEqual(parseDataUri("data:image/png,not-base64"), undefined);
	assert.strictEqual(parseDataUri("data:;base64,QQ=="), undefined);
	assert.strictEqual(parseDataUri("data:image/png;base64,"), undefined);
	assert.doesNotThrow(() => parseDataUri("data:image/png;base64,"));
});

test("does not throw RangeError on a multi-megabyte data URI", () =>
{
	// ~4.7MB payload matches the HD poster that overflowed V8's regex stack
	const payload = "A".repeat(5 * 1024 * 1024);
	const dataUri = `data:image/png;base64,${payload}`;
	const parsed = parseDataUri(dataUri);
	assert.ok(parsed);
	assert.strictEqual(parsed.mime, "image/png");
	assert.ok(parsed.buffer.byteLength > 0);
	assert.ok(parsed.buffer.equals(Buffer.from(payload, "base64")));
});

if (failed > 0)
{
	console.error(`\n${failed} failed`);
	process.exit(1);
}

console.log("\nall passed");
