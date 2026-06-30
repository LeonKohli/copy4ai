# Copy4AI

![Copy4AI Logo](images/icon.png)

Copy4AI (formerly SnapSource) is a Visual Studio Code extension that copies file and folder contents, together with the project tree structure, to your clipboard — built for pasting project context into Large Language Models (LLMs). Dot files and anything matched by your .gitignore stay out of the output, which comes in plaintext, markdown, or XML.

## 🚀 Features

- 📋 Copy contents of files, folders, or multiple selections to your clipboard along with the project tree structure.
- 🔒 Configurable dot file handling (.env, .git, .github, etc.).
- 🚫 Respect .gitignore rules and custom exclude patterns.
- 🌳 Configurable project tree depth.
- 📄 Three output formats: plaintext, markdown, and XML.
- ⚡ Asynchronous processing for improved performance with large directories.
- 🛡️ Robust error handling for various edge cases.
- 🧠 Smart binary file detection to exclude non-text content.
- 📏 Configurable file size limit to prevent oversized outputs.
- 🔧 Option to include or exclude project tree structure in the output.
- 🗜️ Simple code compression option for more compact output.
- 🧹 Option to remove comments from code.
- 🔢 Offline token counting and context-window warnings for various LLM models.

## 🔧 How to Use

1. Select one or multiple files or folders in the VS Code Explorer.
2. Right-click and select one of the following options:
   - **Copy to Clipboard (Copy4AI)**: Copies the selected files/folders with their content
   - **Copy Project Structure (Copy4AI)**: Copies only the project tree structure of the selected folder (or entire workspace if no folder is selected)
3. The content is copied to your clipboard. Dot files and binary files are left out, ignore patterns and size limits apply.
4. Paste the content into your preferred LLM interface.

Keyboard shortcuts use the same Explorer or Source Control selection as the context menu, including multi-select.

**Copy to Clipboard (Copy4AI)** is also available from:

- The **Source Control view**: right-click one or more changed files to copy them — handy when your working set is scattered across the project. Deleted files in the selection are skipped with a notice.
- The **editor tab**: right-click a tab title to copy that file. (VS Code does not expose multi-selected tabs to extensions, so the entry is hidden while multiple tabs are selected.)

**Copy Changes (Copy4AI)** in the Source Control view copies a unified diff against HEAD instead of full file contents — far fewer tokens when you want the AI to see *what changed* rather than the whole file. Untracked files appear as new-file diffs with their full content. Git repositories only; the diff respects your local git config, so it matches what `git diff` prints in your terminal.

Additional commands:
- Use the **Toggle Project Tree (Copy4AI)** command from the Command Palette to quickly enable or disable project tree inclusion in the output without changing settings.
- Use the **Toggle Dot Files Inclusion (Copy4AI)** command from the Command Palette to quickly switch between including or excluding dot files (like .github) without changing settings.

A progress indicator will show the status of the operation, especially useful for large files or when token counting is enabled.

## ⚙️ Extension Settings

This extension contributes the following settings:

| Setting | Description | Default |
|---------|-------------|---------|
| `copy4ai.ignoreGitIgnore` | Respect .gitignore rules when generating the project tree and copying files | `true` |
| `copy4ai.ignoreDotFiles` | Ignore files and directories that start with a dot (.) when generating the project tree and copying files | `true` |
| `copy4ai.maxDepth` | Maximum depth of the project tree | `5` |
| `copy4ai.exclude` | Structured exclusion config with `paths` and `patterns`; preferred over the legacy exclusion keys | `{ "paths": [], "patterns": ["node_modules", "*.log"] }` |
| `copy4ai.excludePaths` | Array of absolute paths relative to workspace root to exclude (e.g., `["src/config", "vendor/unwanted"]`) | `[]` |
| `copy4ai.excludePatterns` | Array of glob patterns to exclude (e.g., `["*.tmp", "build/**"]`) | `["node_modules", "*.log"]` |
| `copy4ai.outputFormat` | Output format for the copied content (options: "plaintext", "markdown", "xml") | `"markdown"` |
| `copy4ai.maxFileSize` | Maximum file size (in bytes) to include in the output | `1048576` (1MB) |
| `copy4ai.includeProjectTree` | Include the project tree structure in the output | `true` |
| `copy4ai.excludeContentPatterns` | Show matching files in the project tree but omit their content | `[]` |
| `copy4ai.compressCode` | Remove extra whitespace and empty lines from code when copying | `false` |
| `copy4ai.removeComments` | Remove comments from code when copying | `false` |
| `copy4ai.llmModel` | LLM model used for token counting and context-window warnings | `"claude-sonnet-4-6"` |
| `copy4ai.maxTokens` | Maximum number of tokens allowed before warning | `null` |
| `copy4ai.enableTokenWarning` | Enable warning when token count exceeds the maximum | `true` |
| `copy4ai.enableTokenCounting` | Enable offline token counting and context-window warnings | `false` |

> Dot files are ignored by default; set `copy4ai.ignoreDotFiles` to `false` to include .github and other dot directories. Binary files are detected and excluded.

### Exclusion Configuration

The preferred exclusion setting is the structured `copy4ai.exclude` object; legacy keys are still supported.

```json
// Preferred
"copy4ai.exclude": {
  "paths": ["src/config", "vendor/unwanted-package"],
  "patterns": ["node_modules", "*.log", "*.tmp", "build/**"]
}

// Legacy
"copy4ai.excludePaths": ["src/config", "vendor/unwanted-package"],
"copy4ai.excludePatterns": ["node_modules", "*.log", "*.tmp", "build/**"]
```

- **exclude.paths** / **excludePaths**: Exact paths relative to the workspace root.
- **exclude.patterns** / **excludePatterns**: Glob patterns for broader matches.

If `copy4ai.exclude` is set, it takes precedence over `copy4ai.excludePaths` and `copy4ai.excludePatterns`.

## 📊 Output Formats

1. **Plaintext**: A simple text format with clear sections for project structure (if enabled) and file contents.
2. **Markdown**: A formatted markdown output with code blocks for project structure (if enabled) and file contents.
3. **XML**: A structured XML format with separate sections for project structure and file contents.

## 📋 Requirements

- Visual Studio Code version 1.104.0 or higher

## 🐛 Known Issues

Track current reports in [GitHub Issues](https://github.com/LeonKohli/copy4ai/issues).

## 📝 Release Notes

See [CHANGELOG.md](CHANGELOG.md).

## 🛠️ Development

This extension is built with TypeScript and uses the VS Code Extension API. The codebase follows modern TypeScript best practices with a modular architecture.

### Building

```bash
bun run compile    # Compile TypeScript to JavaScript
bun run watch      # Watch mode for development
bun run lint       # Run ESLint
bun run test       # Run tests
```

### Architecture

The extension is organized into modular utility classes:
- `ConfigurationService` - Centralized configuration management
- `FileProcessor` - File processing and encoding detection
- `ProjectTreeGenerator` - Project structure generation
- `OutputFormatter` - Different output formats (markdown, XML, plaintext)
- `IgnoreUtils` - Handling ignore patterns and exclusions
- `TokenCounter` - Offline token counting and context-window warnings

## 💬 Feedback and Contributions

If you have any feedback or would like to contribute to the development of Copy4AI, please visit our [GitHub repository](https://github.com/LeonKohli/copy4ai).

---

<div align="center">

**Enjoy using Copy4AI!**

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/LeonKohli.snapsource.svg?style=for-the-badge&label=VS%20Code%20Marketplace&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=LeonKohli.snapsource)
[![GitHub stars](https://img.shields.io/github/stars/LeonKohli/copy4ai.svg?style=for-the-badge&logo=github)](https://github.com/leonkohli/copy4ai/stargazers)
[![License](https://img.shields.io/github/license/LeonKohli/copy4ai.svg?style=for-the-badge)](https://github.com/leonkohli/copy4ai/blob/master/LICENSE)

</div>
