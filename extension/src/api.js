// api.js - the only file that knows the server exists.
// everything else calls these functions and never touches fetch.

const vscode = require('vscode');

const BASE = 'http://localhost:3000';

let secrets;  // set once in activate(), so we can read the saved token

function init(context) {
  secrets = context.secrets;
}

async function getToken(forceAsk) {
  if (!forceAsk) {
    const saved = await secrets.get('flagpilot.token');
    if (saved) return saved;
  }

  const typed = await vscode.window.showInputBox({
    prompt: 'Paste the API_TOKEN from server/.env',
    password: true,
    ignoreFocusOut: true,
  });
  if (!typed) throw new Error('no API token, so nothing can be changed');
  await secrets.store('flagpilot.token', typed);
  return typed;
}

async function call(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  // only write requests need the token; reading flags is harmless
  if (method !== 'GET') {
    headers.Authorization = 'Bearer ' + (await getToken());
  }

  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    // this is what you see when the server isn't running
    throw new Error('cannot reach the server at ' + BASE + ' - is it running?');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `${method} ${path} returned ${res.status}`);
  }
  return data;
}

module.exports = {
  init,
  getToken,
  getProjects: () => call('GET', '/api/projects'),
  getEnvironments: (projectId) => call('GET', '/api/environments?project_id=' + projectId),
  getFlags: (projectId, env) => call('GET', `/api/flags?project_id=${projectId}&env=${env}`),
  createFlag: (flag) => call('POST', '/api/flags', flag),
  toggleFlag: (flagId, environmentId, isEnabled) =>
    call('PATCH', `/api/flags/${flagId}/state`, {
      environment_id: environmentId,
      is_enabled: isEnabled,
      changed_by: 'vscode',
    }),
  getHistory: (flagId) => call('GET', '/api/history?flag_id=' + flagId),
};
