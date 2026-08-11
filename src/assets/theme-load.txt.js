function applyBodyClasses()
{
	const body = document.body;
	if (!body) return false;

	let theme = localStorage.getItem("theme") || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
	if (theme == "dark")
	{
		body.classList.add("theme-dark");
		body.classList.remove("theme-light");
	}
	else
	{
		body.classList.add("theme-light");
		body.classList.remove("theme-dark");
	}

	if (window.innerWidth < 480) body.classList.add("is-phone");
	else if (window.innerWidth < 768) body.classList.add("is-tablet");
	else if (window.innerWidth < 1024) body.classList.add("is-small-screen");
	else body.classList.add("is-large-screen");

	return true;
}

// This script is inlined into <head>, where the defer attribute is ignored, so
// the body usually does not exist yet. Watch for it and apply the classes the
// moment it is parsed, otherwise the document renders with no theme variables
// at all and falls back to the bare loading background.
if (!applyBodyClasses())
{
	const observer = new MutationObserver(function ()
	{
		if (applyBodyClasses()) observer.disconnect();
	});

	observer.observe(document.documentElement, { childList: true });

	document.addEventListener("DOMContentLoaded", function ()
	{
		applyBodyClasses();
		observer.disconnect();
	}, { once: true });
}
