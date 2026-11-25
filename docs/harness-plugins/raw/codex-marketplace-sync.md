<!--
  来源：https://learn.chatgpt.com/docs/import-plugins-from-github
  标题：Codex · Import and sync plugins from GitHub（含 manifest 格式与兼容表）
  抓取：2026-11-25（以 doc 页 markdown twin 形式获取）
  说明：原文归档，未做改写。仅供规划参考，权威内容以线上文档为准。
-->

# Import and sync plugins from GitHub

You can import plugins from GitHub into your workspace and keep them up to date
as the repository changes. A marketplace is a JSON file that lists the plugins
to import.

## Before you begin

You need to be a workspace admin. Use a GitHub account that can read the
marketplace repository and every repository it references. Public and private
GitHub repositories are supported. Complete any access approval required by your
GitHub organization before importing.

Review the repository before you import it. These defaults affect what members
can use:

- New plugins are **Available** for installation. If authentication is required,
  members complete it when they install the plugin.
- The import processes all valid entries. New marketplaces sync automatically
  each day, adding any new plugins from the repository.

This guide covers importing plugins into a workspace. For local clients, see
[Configure plugin marketplaces and defaults](https://learn.chatgpt.com/docs/enterprise/managed-configuration#configure-plugin-marketplaces-and-defaults)
for cloud-managed or system `config.toml` settings. For a specific project, see
[Enable or disable a plugin for a repo](https://developers.openai.com/plugins/build/plugins#enable-or-disable-a-plugin-for-a-repo).

## Configure a marketplace sync

1. Open **Admin** > **Plugins** and select **Add** > **Import marketplace**.
2. In **Source**, enter the repository URL, such as `https://github.com/example/team-plugins`. Use the repository URL only, without a branch or folder URL.
3. If the marketplace is in a subdirectory, enter that directory in **Path**. For example, use `team-tools` for `team-tools/.agents/plugins/marketplace.json`. Leave **Path** empty for the repository root. Do not enter the manifest filename.
4. Optionally enter a **Branch, tag, or commit**. Leave this empty to use the repository's default branch. A branch lets you receive later updates. A fixed commit keeps the version you selected.
5. Select **Import marketplace** and authorize GitHub access when prompted. The initial import can take up to an hour for especially large marketplaces. Subsequent daily syncs typically take a few minutes.
6. Review **Import results**, then open each imported plugin to configure its installation policy and any required apps.

## Supported formats

The selected directory must contain one of these files:

| File                               | Format                                                               |
| ---------------------------------- | -------------------------------------------------------------------- |
| `.agents/plugins/marketplace.json` | A Codex marketplace with a `plugins` array.                          |
| `.claude-plugin/marketplace.json`  | A Claude-compatible marketplace with a `plugins` array.              |
| `.claude-plugin/plugin.json`       | A standalone Claude plugin, when no marketplace manifest is present. |

In a marketplace, entries can reference native plugins with `.codex-plugin/plugin.json`, Claude-compatible plugins, Agent Plugins 1.0 packages, or supported skill packages.

For a Codex marketplace, use local paths for plugins in the same repository:

```json
{
  "name": "team-plugins",
  "interface": {
    "displayName": "Team plugins"
  },
  "plugins": [
    {
      "name": "team-tools",
      "source": {
        "source": "local",
        "path": "./plugins/team-tools"
      }
    }
  ]
}
```

The path is relative to the selected marketplace root, not to `.agents/plugins/`.

A Claude-compatible marketplace can use a path string for each local plugin:

```json
{
  "name": "team-plugins",
  "plugins": [
    {
      "name": "team-tools",
      "source": "./plugins/team-tools"
    }
  ]
}
```

Codex marketplace entries also support `source: "url"` for a plugin at a GitHub repository root and `source: "git-subdir"` for a plugin in a GitHub subdirectory. For example:

```json
{
  "name": "team-tools",
  "source": {
    "source": "git-subdir",
    "url": "https://github.com/example/team-tools.git",
    "path": "./plugins/team-tools",
    "ref": "main"
  }
}
```

Git sources can select a `ref` or a full 40-character commit `sha`. The authorizing GitHub account must be able to read every referenced repository. Workspace import currently only supports GitHub repositories.

## Configure workspace access

Set each plugin's installation and authentication settings in your workspace.
Import and sync don't apply these settings from the repository. These settings include
`AVAILABLE`, `INSTALLED_BY_DEFAULT`, `NOT_AVAILABLE`, `ON_INSTALL`, and `ON_USE`.
Existing workspace settings stay in place when you sync an update or move a
plugin to GitHub management.

Use **Installation policy** to choose **Available** or **Installed** for each
eligible role. Also enable the apps the plugin needs and check that members have
access to the connected service. Importing a plugin doesn't give members app
access or connect their accounts. See [Plugin controls](https://learn.chatgpt.com/docs/enterprise/apps-and-connectors)
for help choosing access and action settings.

## Move an existing plugin to GitHub management

Add `pluginId` to the existing plugin's marketplace entry:

```json
{
  "name": "team-tools",
  "pluginId": "plugin_0123456789abcdef0123456789abcdef",
  "source": {
    "source": "local",
    "path": "./plugins/team-tools"
  }
}
```

Open the plugin from **Admin** > **Plugins** and copy the ID after `/plugins/` in its URL. Put `pluginId` beside `name` and `source` in the marketplace entry. The existing plugin must be in the same workspace, and the entry's `name` must match the existing plugin's name.

Use this to move a workspace plugin to GitHub if it isn't already managed there.
The plugin keeps its ID, sharing, and workspace settings. Future updates come
from GitHub, so you can no longer replace it by uploading an archive. You can't
use this method for a plugin already managed by a different GitHub source.

## Desktop-only plugins
