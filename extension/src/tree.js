// tree.js - the sidebar. three levels: project > environment > flag.
//
// VS Code calls getChildren() with a node, and expects back the things
// under it. call it with nothing and it asks for the top level.
// getTreeItem() says how one row should look.

const vscode = require('vscode');
const api = require('./api');

class FlagTree {
  constructor() {
    this._changed = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._changed.event;
  }

  // called after a toggle or a create, to redraw the whole tree
  refresh() {
    this._changed.fire();
  }

  async getChildren(node) {
    // top level: the projects
    if (!node) {
      const projects = await api.getProjects();
      return projects.map((p) => ({ kind: 'project', project: p }));
    }

    // second level: this project's environments
    if (node.kind === 'project') {
      const envs = await api.getEnvironments(node.project.project_id);
      return envs.map((e) => ({ kind: 'env', project: node.project, env: e }));
    }

    // third level: the flags in this environment
    if (node.kind === 'env') {
      const flags = await api.getFlags(node.project.project_id, node.env.environment_name);
      return flags.map((f) => ({
        kind: 'flag',
        project: node.project,
        env: node.env,
        flag: f,
      }));
    }

    return [];
  }

  getTreeItem(node) {
    if (node.kind === 'project') {
      const item = new vscode.TreeItem(node.project.project_name, vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = new vscode.ThemeIcon('folder');
      item.contextValue = 'project';
      return item;
    }

    if (node.kind === 'env') {
      const item = new vscode.TreeItem(node.env.environment_name, vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = new vscode.ThemeIcon('server-environment');
      item.contextValue = 'env';
      return item;
    }

    // a flag row
    const f = node.flag;
    const on = f.is_enabled === 1;   // mysql sends 0 or 1, not false/true

    const item = new vscode.TreeItem(f.flag_key, vscode.TreeItemCollapsibleState.None);

    // filled circle = on, empty circle = off. easiest state to read at a glance.
    item.iconPath = new vscode.ThemeIcon(on ? 'circle-filled' : 'circle-outline');
    item.description = on ? 'on' : 'off';
    item.tooltip = [
      f.flag_key,
      f.description || '(no description)',
      `last changed: ${f.updated_at}`,
    ].join('\n');

    // this is what makes the label clickable, and clicking runs the toggle
    item.command = {
      command: 'flagpilot.toggleFlag',
      title: 'Toggle',
      arguments: [node],
    };

    // contextValue is how package.json decides which right-click items
    // appear. the menus section matches on 'flag'.
    item.contextValue = 'flag';
    return item;
  }
}

module.exports = { FlagTree };
