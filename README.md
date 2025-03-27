# Copy4AI

![Copy4AI Logo](images/icon.png)

Copy4AI (formerly SnapSource) is a powerful Visual Studio Code extension that allows you to easily copy file and folder contents along with the project tree structure to your clipboard. It automatically ignores dot files, respects .gitignore rules, and provides plaintext, markdown, and XML output formats. This tool is particularly useful when working with Large Language Models (LLMs) and you need to provide context about your project.

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
- 🔢 Token counting and cost estimation for various LLM models.

## 🔧 How to Use

1. Select one or multiple files or folders in the VS Code Explorer.
2. Right-click and select one of the following options:
   - **Copy to Clipboard (Copy4AI)**: Copies the selected files/folders with their content
   - **Copy Project Structure (Copy4AI)**: Copies only the project tree structure
3. The content will be copied to your clipboard, excluding dot files, binary files, and respecting ignore patterns and size limits.
4. Paste the content into your preferred LLM interface.

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
| `copy4ai.exclude` | Exclusion configuration for files and directories | `{ "paths": [], "patterns": ["node_modules", "*.log"] }` |
| `copy4ai.outputFormat` | Output format for the copied content (options: "plaintext", "markdown", "xml") | `"markdown"` |
| `copy4ai.maxFileSize` | Maximum file size (in bytes) to include in the output | `1048576` (1MB) |
| `copy4ai.includeProjectTree` | Include the project tree structure in the output | `true` |
| `copy4ai.compressCode` | Remove extra whitespace and empty lines from code when copying | `false` |
| `copy4ai.removeComments` | Remove comments from code when copying | `false` |
| `copy4ai.llmModel` | LLM model to use for token count and cost estimation | `"gpt-4o"` |
| `copy4ai.maxTokens` | Maximum number of tokens allowed before warning | `null` |
| `copy4ai.enableTokenWarning` | Enable warning when token count exceeds the maximum | `true` |
| `copy4ai.enableTokenCounting` | Enable token counting and cost estimation (requires network access) | `false` |

> **Note:** By default, dot files are ignored, but this can be changed with the `copy4ai.ignoreDotFiles` setting. Set it to `false` to include .github and other dot directories. Binary files are automatically detected and excluded.

## 📊 Output Formats

1. **Plaintext**: A simple text format with clear sections for project structure (if enabled) and file contents.
2. **Markdown**: A formatted markdown output with code blocks for project structure (if enabled) and file contents.
3. **XML**: A structured XML format with separate sections for project structure and file contents.

## 📋 Requirements

- Visual Studio Code version 1.89.0 or higher

## 🐛 Known Issues

None at this time.

## 📝 Release Notes

### 1.0.18

#### Added
- New setting `copy4ai.ignoreDotFiles` to control whether dot files are ignored
- New "Toggle Dot Files Inclusion" command in the Command Palette
- Ability to include .github and other dot directories in copied content

#### Fixed
- Fixed issue where .github/workflows files couldn't be copied (fixes #6)

### 1.0.16

#### Added
- New "Toggle Project Tree" command accessible from the Command Palette
- Ability to quickly toggle project tree inclusion in output without going to settings

### 1.0.12

#### Changed
- Renamed extension from SnapSource to Copy4AI
- Updated all configuration settings to use new namespace
- Updated documentation and branding

For a full list of changes, please see the [CHANGELOG.md](CHANGELOG.md) file.

## 💬 Feedback and Contributions

If you have any feedback or would like to contribute to the development of Copy4AI, please visit our [GitHub repository](https://github.com/LeonKohli/copy4ai).

---

<div align="center">

**Enjoy using Copy4AI!**

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/LeonKohli.snapsource.svg?style=for-the-badge&label=VS%20Code%20Marketplace&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=LeonKohli.snapsource)
[![GitHub stars](https://img.shields.io/github/stars/LeonKohli/copy4ai.svg?style=for-the-badge&logo=github)](https://github.com/leonkohli/copy4ai/stargazers)
[![License](https://img.shields.io/github/license/LeonKohli/copy4ai.svg?style=for-the-badge)](https://github.com/leonkohli/copy4ai/blob/master/LICENSE)

</div>

### Exclusion Configuration

The `copy4ai.exclude` setting provides precise control over what files and directories are excluded:

```json
"copy4ai.exclude": {
  "paths": ["src/config", "vendor/unwanted-package"],
  "patterns": ["node_modules", "*.log", "*.tmp"]
}
```

- **paths**: Absolute paths relative to workspace root. These are exact path matches that will exclude specific directories or files regardless of their name. This solves the problem of excluding directories with common names (like "config") in specific locations while keeping others.
- **patterns**: Standard glob patterns for more general exclusions.

> **Note:** In version 1.0.17, the `excludePatterns` setting was replaced with the more flexible `exclude` object. Please update your configuration accordingly.

## 🔍 Output Formats

1. **Plaintext**: A simple text format with clear sections for project structure (if enabled) and file contents.
2. **Markdown**: A formatted markdown output with code blocks for project structure (if enabled) and file contents.
3. **XML**: A structured XML format with separate sections for project structure and file contents.
