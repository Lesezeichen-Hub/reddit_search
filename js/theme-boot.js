// Setzt das Farbschema vor dem ersten Rendern, um ein Aufblitzen zu vermeiden.
(function () {
  var mode = 'system';
  try { mode = localStorage.getItem('ri-theme') || 'system'; } catch (e) { /* privater Modus */ }
  var dark = mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
})();
