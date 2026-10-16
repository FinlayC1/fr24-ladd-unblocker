// The page where the user allows the extension to reach a monitor of their own (the address in the URL's #): a click on
// the button is what the browser requires before it grants a host the manifest only lists as optional.
// (#consent - Firefox: the same for the count of installs, "technical and interaction data", optional in the manifest)
const consent = location.hash === '#consent';
const origin = consent ? '' : decodeURIComponent(location.hash.slice(1)), ok = consent || /^https:\/\/[^/\s]+$/.test(origin);
const msg = t => { document.getElementById('msg').textContent = t; };
document.getElementById('origin').textContent = ok ? origin : '(no address)';
if (consent) {
  document.title = 'FR24 LADD Unblocker: count this install';
  document.querySelector('h1').textContent = 'Count this install (anonymous)';
  document.getElementById('what').textContent = 'You left "Count this install" on in the LADD Unblock window. Once a day it sends the monitor a random number, the version and your browser and system by name - no IP kept, nothing about flights. Firefox calls this technical and interaction data and needs your permission first. To stop it instead, switch it off in the LADD Unblock window.';
}
if (!ok) document.getElementById('allow').disabled = true;
document.getElementById('allow').addEventListener('click', () => {
  const done = granted => {
    msg(consent ? (granted ? 'Allowed. It is sent the next time Flightradar24 is open.' : 'Not allowed. Nothing is sent.') : granted ? 'Allowed. Go back to Flightradar24: the monitor is used within half a minute, or at once if you reload the page.' : 'Not allowed. The extension will not use this monitor.');
    if (granted) document.getElementById('allow').disabled = true;
  };
  if (consent) chrome.permissions.request({ data_collection: ['technicalAndInteraction'] }, done);
  else chrome.permissions.request({ origins: [origin + '/*'] }, done);
});
