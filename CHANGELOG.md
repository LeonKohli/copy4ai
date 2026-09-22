# Changelog

All notable changes to Copy4AI. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Copy4AI: Repeat Last Copy** in the Command Palette copies the previous selection again, without picking the files a second time. The files are read fresh, so the copy reflects your latest edits. The selection lives in the current window and is gone after a reload. ([#31](https://github.com/LeonKohli/copy4ai/issues/31), requested by [@migig](https://github.com/migig))

## [2.1.1] - 2026-09-21

### Fixed

- The progress popup with its Cancel button no longer appears on every copy. Progress now sits in the status bar as a spinner, which a check replaces when the copy finishes. Copying 2,000 files takes about a second, so there was nothing worth cancelling. ([#30](https://github.com/LeonKohli/copy4ai/issues/30), reported by [@lonix1](https://github.com/lonix1))

## [2.1.0] - 2026-09-21

### Changed

- The token warning now fires above `copy4ai.maxTokens`, which defaults to 100,000 tokens, instead of at the context window of the configured model. Long-context evaluations show answers degrading long before a window is full, and current windows of 1M tokens meant the warning never fired.
- `copy4ai.llmModel` only selects the tokenizer now, and defaults to `claude-sonnet-5`. Any model name works, including ones released after this version.
- A finished copy is confirmed in the status bar instead of a notification, so copying no longer interrupts you. Warnings and errors stay notifications. ([#30](https://github.com/LeonKohli/copy4ai/issues/30), reported by [@lonix1](https://github.com/lonix1))

### Deprecated

- `copy4ai.excludePaths` and `copy4ai.excludePatterns`, in favour of `copy4ai.exclude`, and `copy4ai.enableTokenWarning`, in favour of `copy4ai.maxTokens: 0`. All three keep working, and the Settings editor hides them unless you have set them.

### Removed

- The built-in table of model context windows. Copy4AI no longer tracks which model holds how many tokens, so a new model never needs a Copy4AI release.

## [2.0.1] - 2026-09-19

### Changed

- Copy4AI is now licensed under the GNU General Public License v3.0. Versions up to 2.0.0 remain available under the MIT License.

### Fixed

- When you copy a single folder, the project tree now starts at that folder, the same as in Copy Project Structure.
- Copy Project Structure on a subfolder applies `.gitignore` rules to the right paths. Before, a rule like `/dist` could hide a folder named `dist` inside the subfolder.
- `copy4ai.excludePaths` and `copy4ai.excludePatterns` work again when `copy4ai.exclude` is not set in your user or workspace settings.

## [2.0.0] - 2026-09-15

### Breaking changes

- Remove `copy4ai.removeComments` and `copy4ai.compressCode`. Copied files now keep their comments and whitespace. Delete these keys from your settings. To copy less, use exclusions or Copy Changes.

### Added

- `copy4ai.showCopyProjectStructure` hides Copy Project Structure from the Explorer and editor context menus. ([#27](https://github.com/LeonKohli/copy4ai/issues/27), reported by [@lonix1](https://github.com/lonix1))

### Fixed

- The project tree in copied output shows only the selected files and folders, not the whole workspace. ([#26](https://github.com/LeonKohli/copy4ai/issues/26), [#28](https://github.com/LeonKohli/copy4ai/issues/28), reported by [@lonix1](https://github.com/lonix1) and [@abrilohd](https://github.com/abrilohd))
- Markdown links, comments, strings, and indentation in copied files stay unchanged. ([#29](https://github.com/LeonKohli/copy4ai/issues/29), reported by [@migig](https://github.com/migig))

### Development

- Update `@vscode/test-electron` to 3.1.0 for current macOS VS Code builds. Development needs Node.js 22 or later.
- Isolate the Git test fixtures from global and system Git config.

## [1.5.1] - 2026-06-30

### Fixed

- Keyboard shortcuts copy the whole Explorer or Source Control selection instead of only the active file. ([#24](https://github.com/LeonKohli/copy4ai/issues/24), reported by [@Norlandz](https://github.com/Norlandz))
- Selecting a folder and a file inside it no longer copies that file twice. The same applies to Copy Changes. ([#25](https://github.com/LeonKohli/copy4ai/issues/25), reported by [@Norlandz](https://github.com/Norlandz))

## [1.5.0] - 2026-06-11

### Added

- Copy files from the Source Control view. Right-click one or more changed files and choose Copy to Clipboard (Copy4AI). ([#23](https://github.com/LeonKohli/copy4ai/issues/23), reported by [@Norlandz](https://github.com/Norlandz))
- Copy a file from its editor tab. Right-click the tab title. The entry is hidden while several tabs are selected, because VS Code does not pass a tab selection to extensions ([microsoft/vscode#213699](https://github.com/microsoft/vscode/issues/213699)).
- Copy Changes (Copy4AI) in the Source Control view copies a unified diff against `HEAD` instead of full files. Untracked files appear as new-file diffs. The diff follows your Git config and uses `copy4ai.outputFormat`. Git repositories only.

### Changed

- CI runs the test suite on every push and pull request, and a release fails if the suite fails.
- The test suite no longer writes to the system clipboard and runs in about 1 second instead of 25.

### Fixed

- Deleted files in a selection are skipped with a warning instead of stopping the copy. If every selected file was deleted, the command fails and leaves the clipboard unchanged.

## [1.4.0] - 2026-05-14

### Added

- Virtual workspace support. Copy4AI reads files through `vscode.workspace.fs`, so it works in Codespaces, Remote SSH, and other virtual file systems.
- Restricted Mode support. The copy commands work in untrusted workspaces. Workspace settings apply after you trust the workspace.
- Running the copy command without a selection copies the file in the active editor.

### Changed

- Token counting uses a tokenizer that matches the model family:
  - OpenAI models use the `o200k_base` or `cl100k_base` encoder from `gpt-tokenizer` and give exact counts.
  - Claude models use `@anthropic-ai/tokenizer`. Counts are about 1 to 2 percent off.
  - Other models use a characters-divided-by-4 estimate.
- `copy4ai.llmModel` accepts any model name instead of 5 fixed values. Names match by prefix, so `claude-opus-4-7-20260416` resolves to `claude-opus-4-7`.
- The default model is `claude-sonnet-4-6`.
- The token count notification says whether the count is exact or approximate.
- Token counting no longer needs network access.
- Local development and CI use Bun instead of npm.

### Removed

- Cost estimation. Token prices change faster than the extension ships, and an outdated price is worse than none. Token counts and context-window warnings remain.
- The `llm-cost` dependency.

## [1.3.4] - 2026-05-14

### Fixed

- `.gitignore` and `copy4ai.excludePatterns` patterns with a trailing slash, such as `build/`, exclude the folder instead of listing it as an empty tree entry. ([#21](https://github.com/LeonKohli/copy4ai/issues/21), reported by [@TarkanV](https://github.com/TarkanV))
- Remove a duplicate `activationEvents` key from `package.json`.

## [1.3.3] - 2025-12-20

### Fixed

- Package the extension with `@vscode/vsce` instead of the deprecated `vsce`.

## [1.3.2] - 2025-12-20

### Fixed

- Match `engines.vscode` to the `@types/vscode` version (`^1.104.0`).

## [1.3.1] - 2025-12-20

### Fixed

- Restore `activationEvents` in `package.json`. Packaging failed without it.

## [1.3.0] - 2025-12-20

### Added

- `copy4ai.excludeContentPatterns` lists matching files in the tree but replaces their contents with `[File content not included]`. Use it for SVGs, images, and similar files, for example `["**/*.svg", "assets/**"]`. ([#15](https://github.com/LeonKohli/copy4ai/issues/15), reported by [@dobaniashish](https://github.com/dobaniashish))

### Fixed

- Copying a Markdown file that contains code fences no longer breaks the output. Copy4AI wraps such files in a longer fence. ([#16](https://github.com/LeonKohli/copy4ai/issues/16), reported by [@lolmaus](https://github.com/lolmaus))
- ESLint 9 works with the flat config.

## [1.2.0] - 2025-10-04

### Added

- `copy4ai.exclude` groups `paths` and `patterns` in one setting. It takes precedence over `copy4ai.excludePaths` and `copy4ai.excludePatterns`.

### Changed

- Building the project tree on large folders is faster, because Copy4AI reads file types from the directory listing instead of checking each file.
- Ignore checks use workspace-relative paths with forward slashes, so patterns match the same way on every platform.

## [1.1.2] - 2025-10-04

### Fixed

- The Explorer context menu entries appear in every VS Code layout. ([#10](https://github.com/LeonKohli/copy4ai/issues/10), reported by [@kynoptic](https://github.com/kynoptic))
- The README describes `copy4ai.excludePaths` and `copy4ai.excludePatterns` correctly. ([#11](https://github.com/LeonKohli/copy4ai/issues/11), reported by [@archneon](https://github.com/archneon))

## [1.1.1] - 2025-06-11

### Fixed

- Copy4AI checks ignore rules before it reads a folder, so a large ignored folder such as `node_modules` no longer adds a delay of 2 to 5 seconds. ([#9](https://github.com/LeonKohli/copy4ai/issues/9), reported by [@dobaniashish](https://github.com/dobaniashish))

## [1.1.0] - 2025-05-24

### Changed

- Rewrite the extension in TypeScript with strict type checking. Behavior is unchanged.

## [1.0.21] - 2025-05-24

### Added

- Releases publish to Open VSX as well as the VS Code Marketplace.

## [1.0.20] - 2025-05-24

### Fixed

- A UTF-16 or UTF-32 file no longer stops the copy. Copy4AI adds a note for that file and copies the rest. ([#8](https://github.com/LeonKohli/copy4ai/issues/8), reported by [@kanhaiya0999](https://github.com/kanhaiya0999))

## [1.0.19] - 2025-04-19

### Changed

- Copy Project Structure starts the tree at the folder you right-click instead of the workspace folder. ([#7](https://github.com/LeonKohli/copy4ai/issues/7), reported by [@matznerd](https://github.com/matznerd))

## [1.0.18] - 2025-03-27

### Added

- `copy4ai.ignoreDotFiles` controls whether files and folders whose names start with a dot are skipped. Set it to `false` to copy `.github` and similar folders. ([#6](https://github.com/LeonKohli/copy4ai/issues/6), reported by [@Waog](https://github.com/Waog))
- Copy4AI: Toggle Dot Files Inclusion switches this setting from the Command Palette.

## [1.0.17] - 2025-03-16

### Added

- `copy4ai.excludePaths` excludes specific files and folders by their path in the workspace, so a folder name that appears in several places can be excluded in only one of them. ([#5](https://github.com/LeonKohli/copy4ai/issues/5), reported by [@edxeth](https://github.com/edxeth))

## [1.0.16] - 2025-03-05

### Added

- Copy4AI: Toggle Project Tree switches `copy4ai.includeProjectTree` from the Command Palette.

## [1.0.15] - 2025-02-28

### Added

- Copy Project Structure copies only the project tree. ([#2](https://github.com/LeonKohli/copy4ai/issues/2), reported by [@human890209](https://github.com/human890209))
- A progress notification with a Cancel button appears while Copy4AI copies files.
- The token limit warning has a button that opens the exclusion settings.

### Changed

- Settings moved from `snapsource.*` to `copy4ai.*`. Existing values are not migrated, so set them again under the new names.
- Markdown is the default output format.

## [1.0.14] - 2025-02-22

### Changed

- New extension icon.

## [1.0.13] - 2025-02-22

### Changed

- SnapSource is now called Copy4AI. The extension ID stays `LeonKohli.snapsource`, so installed copies update in place.

## [1.0.11] - 2024-11-22

### Fixed

- `copy4ai.includeProjectTree` is respected. ([#1](https://github.com/LeonKohli/copy4ai/issues/1), reported by [@teneon](https://github.com/teneon))

## [1.0.9] - 2024-07-26

### Added

- XML output format.
- A setting to turn off token counting.

## 1.0.5 - 2024-07-25

### Added

- Token counting and cost estimation, with the `llmModel`, `maxTokens`, `enableTokenWarning`, and `enableTokenCounting` settings.

## 1.0.4 - 2024-07-23

### Changed

- `compressCode` removes extra whitespace and empty lines.

## 1.0.3 - 2024-07-23

### Added

- `includeProjectTree` turns off the project tree.

## 1.0.2 - 2024-07-14

### Added

- Binary files are listed without their contents.
- `maxFileSize` limits the size of copied files.

## 1.0.1 - 2024-07-13

### Changed

- Lower the minimum VS Code version.

## 1.0.0 - 2024-07-13

First release. Copy files and folders with a project tree in plain text or Markdown, with `.gitignore` support, custom exclude patterns, a configurable tree depth, and dot files skipped.

[Unreleased]: https://github.com/LeonKohli/copy4ai/compare/v2.1.1...HEAD
[2.1.1]: https://github.com/LeonKohli/copy4ai/compare/v2.1.0...v2.1.1
[2.1.0]: https://github.com/LeonKohli/copy4ai/compare/v2.0.1...v2.1.0
[2.0.1]: https://github.com/LeonKohli/copy4ai/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/LeonKohli/copy4ai/compare/v1.5.1...v2.0.0
[1.5.1]: https://github.com/LeonKohli/copy4ai/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/LeonKohli/copy4ai/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/LeonKohli/copy4ai/compare/v1.3.4...v1.4.0
[1.3.4]: https://github.com/LeonKohli/copy4ai/compare/v1.3.3...v1.3.4
[1.3.3]: https://github.com/LeonKohli/copy4ai/compare/v1.3.2...v1.3.3
[1.3.2]: https://github.com/LeonKohli/copy4ai/compare/v1.3.1...v1.3.2
[1.3.1]: https://github.com/LeonKohli/copy4ai/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/LeonKohli/copy4ai/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/LeonKohli/copy4ai/compare/v1.1.2...v1.2.0
[1.1.2]: https://github.com/LeonKohli/copy4ai/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/LeonKohli/copy4ai/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/LeonKohli/copy4ai/compare/v1.0.21...v1.1.0
[1.0.21]: https://github.com/LeonKohli/copy4ai/compare/v1.0.20...v1.0.21
[1.0.20]: https://github.com/LeonKohli/copy4ai/compare/v1.0.19...v1.0.20
[1.0.19]: https://github.com/LeonKohli/copy4ai/compare/v1.0.18...v1.0.19
[1.0.18]: https://github.com/LeonKohli/copy4ai/compare/v1.0.17...v1.0.18
[1.0.17]: https://github.com/LeonKohli/copy4ai/compare/v1.0.16...v1.0.17
[1.0.16]: https://github.com/LeonKohli/copy4ai/compare/v1.0.15...v1.0.16
[1.0.15]: https://github.com/LeonKohli/copy4ai/compare/v1.0.14...v1.0.15
[1.0.14]: https://github.com/LeonKohli/copy4ai/compare/v1.0.13...v1.0.14
[1.0.13]: https://github.com/LeonKohli/copy4ai/compare/v1.0.12...v1.0.13
[1.0.11]: https://github.com/LeonKohli/copy4ai/compare/v1.0.10...v1.0.11
[1.0.9]: https://github.com/LeonKohli/copy4ai/compare/v1.0.8...v1.0.9
