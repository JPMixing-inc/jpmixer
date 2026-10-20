'use strict';

// Presentation only. The existing settings handlers continue to own config,
// navigation, IPC, and server lifecycle.
(() => {
  const pages = {
    general: ['General', 'The web server, and what JPMixer does when this computer starts.'],
    console: ['Console', 'Choose your console, connect to it, and set snapshot behavior.'],
    channels: ['Channels', 'Rename, group, show or hide channels. Drag rows to change their order.'],
    auxes: ['Aux mixes', 'Set mix names, colors, visibility, and EQ access.'],
    performers: ['Performers', 'What performers see on their phones, and their saved My Mixes.'],
    views: ['Pages', 'Every page JPMixer serves, with each Home page’s own setup.'],
    branding: ['Branding', 'Your logo and accent color on the pages JPMixer serves.'],
    pco: ['Planning Center', 'Connect your schedule and map team positions to mixes.'],
    backup: ['Backup & restore', 'Save your configuration or restore a previous backup.'],
    api: ['Control API', 'Connect Companion, Stream Deck, and external tools.'],
    osclog: ['OSC log', 'Inspect traffic between JPMixer and your console.']
  };
  const tabs = document.querySelectorAll('.tab');
  const update = tab => {
    const [title, description] = pages[tab.dataset.tab];
    document.getElementById('settingsPageTitle').textContent = title;
    document.getElementById('settingsPageDescription').textContent = description;
    for (const other of tabs) {
      if (other === tab) other.setAttribute('aria-current', 'page');
      else other.removeAttribute('aria-current');
    }
    document.querySelector('main').scrollTop = 0;
  };
  for (const tab of tabs) tab.addEventListener('click', () => update(tab));
  update(document.querySelector('.tab.active'));

  // Header wordmark: once the opening intro has finished, hovering the logo
  // plays the slow glare across it again (see .jp-wordmark-fx).
  const wordmark = document.getElementById('wordmarkFx');
  let introDone = false;
  setTimeout(() => { introDone = true; wordmark.classList.remove('intro'); }, 6400);
  wordmark.addEventListener('mouseenter', () => {
    if (!introDone || wordmark.classList.contains('shine')) return;
    wordmark.classList.add('shine');
  });
  wordmark.addEventListener('animationend', (event) => {
    if (event.animationName === 'wmGlareOnce') wordmark.classList.remove('shine');
  });

  // Jump within the scrollable settings pane without changing the window URL.
  for (const link of document.querySelectorAll('.settings-section-nav a, .settings-inline-link, .pco-section-nav a')) {
    link.addEventListener('click', event => {
      const target = document.getElementById(link.getAttribute('href').slice(1));
      if (!target) return;
      event.preventDefault();
      if (target.tagName === 'DETAILS') target.open = true;
      target.scrollIntoView({ block: 'start' });
    });
  }
})();
