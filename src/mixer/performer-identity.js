'use strict';
(() => {
  const $ = id => document.getElementById(id), bridge = globalThis.mixerIdentityBridge;
  const panel = $('performerIdentity'), menu = $('menuPerformerIdentity'), status = $('performerIdentityStatus'), select = $('performerIdentitySelect');
  const explicitAuxLink = new URLSearchParams(location.search).has('aux');
  let pendingAux = null, refreshing = false, busy = false;
  const apply = () => {
    if (pendingAux == null) return;
    if (bridge.selectAssigned(pendingAux)) pendingAux = null;
    else if (bridge.ready) {
      pendingAux = null; status.textContent = 'Your assigned aux is not available on this console. Choose a mix manually.';
      document.body.classList.add('auxPicker'); panel.open = true;
    }
  };
  document.addEventListener('jpm-config-ready', () => { apply(); if (!refreshing && !busy) refresh(false); });
  const showProfile = profile => { $('performerIdentityTitle').textContent = profile ? profile.name + ' · My performer' : 'Choose your performer'; };
  showProfile(bridge.profile);
  async function refresh(autoSelect = true) {
    if (refreshing || busy) return;
    refreshing = true;
    try {
      const response = await fetch('/performer-assignments', { cache: 'no-store' });
      if (!response.ok) throw Error('Planning Center is unavailable. Choose a mix manually.');
      const data = await response.json();
      if (data.enabled === false) { panel.hidden = true; menu.hidden = true; pendingAux = null; bridge.activate(null); return; }
      panel.hidden = false; menu.hidden = false;
      if (!data.ok) throw Error(data.error || 'Planning Center is unavailable. Choose a mix manually.');
      select.replaceChildren(new Option('Choose your name…', ''));
      for (const person of data.people || []) {
        const option = new Option(`${person.name} · ${person.roles.join(' / ')}${person.ambiguous ? ' — check mapping' : ' · Aux ' + person.aux}`, person.personId);
        option.disabled = person.ambiguous; select.add(option);
      }
      const profile = bridge.profile;
      const person = profile && data.people.find(p => p.personId === profile.personId && !p.ambiguous);
      if (person) {
        const assignmentChanged = profile.aux !== person.aux;
        bridge.activate(person); showProfile(person); select.value = person.personId;
        status.textContent = 'Assigned to Aux ' + person.aux + '. Your saved mixes are backed up under your name.';
        if ((autoSelect || assignmentChanged) && !explicitAuxLink) { pendingAux = person.aux; apply(); }
      } else {
        status.textContent = profile ? 'No single assignment for you in this service. Choose a mix manually or ask the engineer to check the mapping.' : 'Choose your name once to remember your assigned mix and person backup.';
        panel.open = !profile;
      }
    } catch (error) {
      status.textContent = error.message;
      if (bridge.profile) { panel.hidden = false; menu.hidden = false; }
    } finally { refreshing = false; }
  }
  $('usePerformerIdentity').addEventListener('click', async () => {
    if (!select.value || busy) return;
    busy = true; $('usePerformerIdentity').disabled = true;
    try {
      const response = await fetch('/performer-identity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ personId: select.value, deviceId: bridge.physicalDeviceId, copyExisting: $('performerLinkMixes').checked }) });
      const result = await response.json();
      if (!result.ok) throw Error(result.error || 'Could not select this performer.');
      bridge.activate(result); showProfile(result);
      status.textContent = 'Assigned to Aux ' + result.aux + '. Saved mixes are backed up under ' + result.name + '.';
      $('performerLinkMixes').checked = false; pendingAux = result.aux; apply(); panel.open = false;
    } catch (error) { status.textContent = error.message; }
    finally { busy = false; $('usePerformerIdentity').disabled = false; }
  });
  $('clearPerformerIdentity').addEventListener('click', () => {
    if (busy) return;
    pendingAux = null; bridge.activate(null); showProfile(null); select.value = '';
    status.textContent = 'Using this device’s saved mixes. Choose an aux manually, or choose your name to reconnect to your person backup.';
  });
  menu.addEventListener('click', () => { document.body.classList.remove('menuOpen'); document.body.classList.add('auxPicker'); panel.open = true; });
  globalThis.performerIdentity = { refresh };
})();
