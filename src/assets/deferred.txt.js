async function loadIncludes()
{
	// replace include tags with the contents of the file
	let includeTags = document.querySelectorAll("link[itemprop='include']");
	for (const includeTag of includeTags)
	{
		let includePath = includeTag.getAttribute("href");

		try
		{
			let includeText = "";
			
			if (includePath.startsWith("https:") || includePath.startsWith("http:") || window.location.protocol != "file:")
			{
				const request = await fetch(includePath);
				if (!request.ok) 
				{
					console.log("Could not include file: " + includePath);
					includeTag?.remove();
					continue;
				}
				
				includeText = await request.text();
			}
			else
			{
				const dataEl = document.getElementById(btoa(encodeURI(includePath)));
				if (dataEl)
				{
					const raw = dataEl.getAttribute("value") ?? "";
					let data;
					if (raw.indexOf("gz1.") === 0) {
						const b64 = raw.slice(4);
						const bin = atob(b64);
						const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
						const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
						data = JSON.parse(await new Response(stream).text());
					} else if (raw.indexOf("u8.") === 0) {
						const b64 = raw.slice(3);
						const bin = atob(b64);
						data = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
					} else {
						data = JSON.parse(decodeURI(atob(raw)));
					}
					includeText = data?.data ?? "";
				}
			}


			let docFrag = document.createRange().createContextualFragment(includeText);
			includeTag.before(docFrag);
			includeTag.remove();

			console.log("Included text: " + includeText);

			console.log("Included file: " + includePath);
		}
		catch (e)
		{
			includeTag?.remove();
			console.log("Could not include file: " + includePath, e);
			continue;
		}
	}
}

document.addEventListener("DOMContentLoaded", () => 
{
	loadIncludes();
});

let isFileProtocol = location.protocol == "file:";

function waitLoadScripts(scriptNames, callback)
{
	let scripts = scriptNames.map(name => document.getElementById(name + "-script"));

	function loadNext(index)
	{
		let script = scripts[index];
		let nextIndex = index + 1;
		if (!script)
		{
			if (index < scripts.length)
				loadNext(nextIndex);
			else
			{
				callback();
			}
			return;
		}

		if (!script || script.getAttribute('loaded') == "true") // if already loaded 
		{
			if (index < scripts.length)
				loadNext(nextIndex);
		}
		
		if (index < scripts.length) 
		{
			script.addEventListener("load", () => loadNext(nextIndex));
		}
	}

	loadNext(0);
}
