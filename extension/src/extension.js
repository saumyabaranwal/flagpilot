// extension.js - where VS Code starts. registers the tree and the commands.
// keep this file thin: it wires things together, api.js does the talking.

const vscode = require('vscode');
const api = require('./api');
const { FlagTree } = require('./tree');

function activate(context) {
  api.init(context);

  const tree = new FlagTree();
  const view = vscode.window.createTreeView('flagpilot.flags', {
    treeDataProvider: tree,
    showCollapseAll: true,
  });
  context.subscriptions.push(view);

  context.subscriptions.push(
    vscode.commands.registerCommand('flagpilot.refresh', () => tree.refresh()),

    vscode.commands.registerCommand('flagpilot.setToken', async () => {
      try {
        await api.getToken(true);
        vscode.window.showInformationMessage('FlagPilot: token saved');
      } catch (err) {
        vscode.window.showErrorMessage('FlagPilot: ' + err.message);
      }
    }),

    // clicking a flag runs this. we send the opposite of what it is now.
    vscode.commands.registerCommand('flagpilot.toggleFlag', async (node) => {
      if (!node || node.kind !== 'flag') return;
      const f = node.flag;
      const wanted = f.is_enabled !== 1;

      try {
        await api.toggleFlag(f.flag_id, f.environment_id, wanted);
        tree.refresh();
      } catch (err) {
        vscode.window.showErrorMessage('FlagPilot: ' + err.message);
      }
    }),

    vscode.commands.registerCommand('flagpilot.createFlag', async () => {
      try {
        const projects = await api.getProjects();
        if (projects.length === 0) {
          vscode.window.showErrorMessage('FlagPilot: no projects found');
          return;
        }

        const picked = await vscode.window.showQuickPick(
          projects.map((p) => ({ label: p.project_name, id: p.project_id })),
          { placeHolder: 'Which project does this flag belong to?' }
        );
        if (!picked) return;

        const key = await vscode.window.showInputBox({
          prompt: 'Flag key, as you will type it in your code',
          placeHolder: 'dark_mode',
          validateInput: (v) =>
            /^[a-z0-9_]+$/.test(v) ? null : 'lowercase letters, numbers and _ only',
        });
        if (!key) return;

        const description = await vscode.window.showInputBox({
          prompt: 'Short description (optional)',
        });

        await api.createFlag({
          project_id: picked.id,
          flag_key: key,
          description: description || null,
          changed_by: 'vscode',
        });

        tree.refresh();
        vscode.window.showInformationMessage(`FlagPilot: created ${key}`);
      } catch (err) {
        vscode.window.showErrorMessage('FlagPilot: ' + err.message);
      }
    }),

    vscode.commands.registerCommand('flagpilot.showHistory', async (node) => {
      if (!node || node.kind !== 'flag') return;
      const f = node.flag;

      try {
        const rows = await api.getHistory(f.flag_id);
        showHistoryPanel(f, rows);
      } catch (err) {
        vscode.window.showErrorMessage('FlagPilot: ' + err.message);
      }
    }),

    // two templates, because where the code runs changes the answer.
    // a node server can call the API directly. a browser can't read a
    // response from another origin (CORS), so it has to ask its own
    // server, and let that server do the call. same shape as demo-app.
    vscode.commands.registerCommand('flagpilot.copySnippet', async (node) => {
      if (!node || node.kind !== 'flag') return;
      const f = node.flag;
      const env = node.env.environment_name;

      const choice = await vscode.window.showQuickPick(
        [
          { label: 'Node / server-side', description: 'calls the API directly', id: 'node' },
          { label: 'Browser', description: 'asks your own server, which calls the API', id: 'browser' },
        ],
        { placeHolder: 'Where will this code run?' }
      );
      if (!choice) return;

      const snippet =
        choice.id === 'node' ? nodeSnippet(f.flag_key, env) : browserSnippet(f.flag_key);

      await vscode.env.clipboard.writeText(snippet);
      vscode.window.showInformationMessage(`FlagPilot: ${choice.label} snippet for ${f.flag_key} copied`);
    })
  );
}

// server-side: node 18+ can call the API directly, no CORS involved
function nodeSnippet(key, env) {
  return `// FlagPilot — is "${key}" on for this user?
// run this on your server (Node 18+), not in a browser
const res = await fetch(
  'http://localhost:3000/api/check?key=${key}&env=${env}&user=' + userId
);
const flag = await res.json();   // { enabled: true, reason: 'environment_default' }

if (flag.enabled) {
  // show the new feature
} else {
  // fall back to the old behaviour
}
`;
}

// browser: the page can't read a response from the API's origin, so it
// asks its own backend and the backend calls FlagPilot. this is what
// demo-app/server.js does - look at its /state route.
function browserSnippet(key) {
  return `// FlagPilot — is "${key}" on for this user?
// a browser is blocked from reading another origin's response (CORS),
// so this asks your own server, and your server calls FlagPilot.
// see demo-app/server.js for the same pattern.
const flag = await fetch('/api/my-app/flags?key=${key}&user=' + userId)
  .then((r) => r.json());

if (flag.enabled) {
  // show the new feature
} else {
  // fall back to the old behaviour
}
`;
}

function showHistoryPanel(flag, rows) {
  const panel = vscode.window.createWebviewPanel(
    'flagpilotHistory',
    `History: ${flag.flag_key}`,
    vscode.ViewColumn.One,
    { enableScripts: false }
  );

  // escaping matters here: these strings come from the database, and a
  // flag description containing < or > would otherwise break the page.
  const esc = (s) => String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const rowsHtml = rows.length
    ? rows.map((r) => `
        <tr>
          <td>${esc(r.changed_at).replace('T', ' ').slice(0, 19)}</td>
          <td><span class="act ${esc(r.action)}">${esc(r.action)}</span></td>
          <td>${esc(r.environment_name) || '-'}</td>
          <td>${esc(r.old_value) || '-'} <span class="arrow">&rarr;</span> ${esc(r.new_value) || '-'}</td>
          <td>${esc(r.changed_by)}</td>
        </tr>`).join('')
    : '<tr><td colspan="5" class="empty">nothing recorded yet</td></tr>';

  panel.webview.html = `<!DOCTYPE html>
<html>
<head>
<style>
  body { font-family: var(--vscode-font-family); padding: 16px; color: var(--vscode-foreground); }
  h2 { font-weight: 500; margin-bottom: 4px; }
  .sub { opacity: .7; margin-top: 0; font-size: 12px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th { text-align: left; font-weight: 500; opacity: .7; border-bottom: 1px solid var(--vscode-panel-border); padding: 8px 10px 8px 0; }
  td { padding: 7px 10px 7px 0; border-bottom: 1px solid var(--vscode-panel-border); }
  .act { padding: 1px 7px; border-radius: 9px; font-size: 11px; }
  .enabled { background: #2ea04333; color: #3fb950; }
  .disabled { background: #f8514933; color: #f85149; }
  .created, .targeting_added { background: #388bfd33; color: #58a6ff; }
  .arrow { opacity: .5; }
  .empty { opacity: .6; font-style: italic; }
</style>
</head>
<body>
  <h2>${esc(flag.flag_key)}</h2>
  <p class="sub">${esc(flag.description) || 'no description'}</p>
  <table>
    <tr><th>when</th><th>action</th><th>environment</th><th>change</th><th>who</th></tr>
    ${rowsHtml}
  </table>
</body>
</html>`;
}

function deactivate() {}

module.exports = { activate, deactivate };
