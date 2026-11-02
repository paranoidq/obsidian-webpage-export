import { promises as fs } from "fs";
import { join } from "path";

/** Reserve one output directory per export, using local time and atomic mkdir. */
export async function createTimestampedExportDirectory(parent: string, now: Date = new Date()): Promise<string>
{
	const pad = (value: number, length = 2) => String(value).padStart(length, "0");
	const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
		+ `_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}`;
	await fs.mkdir(parent, { recursive: true });
	for (let suffix = 0; ; suffix++)
	{
		const destination = join(parent, timestamp + (suffix ? `-${suffix}` : ""));
		try
		{
			await fs.mkdir(destination);
			return destination;
		}
		catch (error)
		{
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
	}
}
