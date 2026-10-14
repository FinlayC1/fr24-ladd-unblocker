// The page where the user allows the extension to reach a monitor of their own (the address in the URL's #): a click on
// the button is what the browser requires before it grants a host the manifest only lists as optional.
const origin = decodeURIComponent(location.hash.slice(1)), ok = /^https:\/\/[^/\s]+$/.test(origin);
const msg = t => { document.getElementById('msg').textContent = t; };
document.getElementById('origin').textContent = ok ? origin : '(no address)';
if (!ok) document.getElementById('allow').disabled = true;
document.getElementById('allow').addEventListener('click', () => {
  chrome.permissions.request({ origins: [origin + '/*'] }, granted => {
    msg(granted ? 'Allowed. Go back to Flightradar24: the monitor is used within half a minute, or at once if you reload the page.' : 'Not allowed. The extension will not use this monitor.');
    if (granted) document.getElementById('allow').disabled = true;
  });
});
