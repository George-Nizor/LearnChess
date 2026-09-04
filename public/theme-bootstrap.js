// Extracted from index.html so the Content-Security-Policy can keep script-src at 'self'.
// Loaded synchronously from <head>, so it still runs before the first paint.
(function () {
  try {
    var stored = localStorage.getItem('learnchess.theme');
    var prefersDark =
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;
    var dark = stored === 'dark' || (!stored && prefersDark);
    if (dark) document.documentElement.classList.add('dark');
  } catch {
    /* localStorage unavailable — fall back to OS preference only. */
  }
})();
