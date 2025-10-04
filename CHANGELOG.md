# Change Log

All notable changes to the "Copy4AI" extension will be documented in this file.

## [1.2.0] - 2025-10-04

### Added
- Structured exclusion configuration via `copy4ai.exclude` object with `paths` and `patterns`. Takes precedence over legacy `excludePaths` / `excludePatterns`.

### Changed
- Project tree generation now uses `fs.readdir({ withFileTypes: true })` to reduce `fs.stat` calls and improve performance on large folders.
- Ignore checks now evaluate root-relative, POSIX-normalized paths for consistent `node-ignore` behavior across platforms.
- Removed explicit `activationEvents` from package.json; VS Code automatically activates for contributed commands.

### Docs
- README updated to document the preferred `copy4ai.exclude` configuration and precedence rules.

## [1.1.2] - 2025-10-04

### Fixed
- Fixed explorer context menu not appearing in some VS Code configurations (fixes #10)
  - Removed overly restrictive `filesExplorerFocus` and `explorerViewletVisible` when clauses
  - Context menu items now appear reliably when right-clicking in the Explorer sidebar
- Corrected documentation for exclude settings (fixes #11)
  - Updated README and CHANGELOG to reflect actual implementation using `excludePaths` and `excludePatterns`
  - Removed references to non-existent nested `exclude` object

## [1.1.1] - 2025-06-11

### Fixed
- **Performance improvement**: Fixed significant performance regression when processing directories with large ignored folders like `node_modules` (fixes #9)
  - Added early directory exclusion checks to prevent reading contents of ignored directories
  - Directories are now checked against ignore patterns before their contents are read
  - This eliminates the 2-5 second delay users experienced when processing projects with large `node_modules` folders

## [1.1.0] - 2025-05-24

### Changed
- **Major refactoring**: Migrated from JavaScript to TypeScript for better type safety and maintainability
- Restructured codebase into modular architecture with dedicated utility classes:
  - `ConfigurationService` for centralized configuration management
  - `FileProcessor` for file processing and encoding detection
  - `ProjectTreeGenerator` for project structure generation
  - `OutputFormatter` for different output formats (markdown, XML, plaintext)
  - `IgnoreUtils` for handling ignore patterns and exclusions
  - `TokenCounter` for token counting and cost estimation
- Improved TypeScript configuration with strict type checking
- Enhanced ESLint configuration for TypeScript support
- Updated build process to compile TypeScript to JavaScript
- All tests passing with the new TypeScript architecture


### Technical Improvements
- Better separation of concerns with dedicated service classes
- Improved error handling and type safety
- Enhanced code maintainability and extensibility
- Cleaner API design with well-defined interfaces
- Optimized dependency structure with proper dev/runtime separation
- Repository cleanup with removal of legacy and orphaned files

## [1.0.21] - 2025-05-24

### Added
- Enhanced GitHub Actions workflow to publish to both Visual Studio Marketplace and Open VSX Registry
- Upgraded to HaaLeo/publish-vscode-extension@v2 for better performance and features
- Single packaging with reuse pattern for more efficient publishing process

## [1.0.20] - 2025-05-24

### Fixed
- **CRITICAL FIX**: Resolved issue where files with unsupported encodings (UTF-16, UTF-32) would cause the extension to stop processing subsequent files (fixes #8)
- Improved error handling to ensure all processable files are included even when some files cannot be read
- Enhanced encoding detection to better identify and handle non-UTF-8 files
- Added graceful fallback for files that cannot be read due to encoding or permission issues

### Added
- Better error messages for files with unsupported encodings
- Comprehensive test coverage for encoding issues and error handling scenarios

## [1.0.19] - 2025-04-19

### Added
- Improved "Copy Project Structure" to use the selected folder as root instead of always using the workspace root
- Now when right-clicking on a specific folder, only that folder's structure will be copied

## [1.0.18] - 2025-03-27

### Added
- New setting `copy4ai.ignoreDotFiles` to control whether files and directories starting with a dot (.) are ignored
- Now you can include .github and other dot directories by setting `copy4ai.ignoreDotFiles` to false
- New "Toggle Dot Files Inclusion" command accessible from the Command Palette for quick switching

### Fixed
- Fixed issue where .github/workflows and other dot directories couldn't be copied even when selected (fixes #6)

## [1.0.17] - 2025-03-15

### Added
- New `copy4ai.excludePaths` setting for absolute path exclusions (relative to workspace root)
- Support for excluding specific directories by their full path
- More precise control over what files and directories are excluded

### Changed
- Enhanced exclusion system with separate `excludePaths` and `excludePatterns` settings
- Fixed issue with excluding directories with common names in specific locations

## [1.0.16] - 2025-03-05

### Added
- New "Toggle Project Tree" command accessible from the Command Palette
- Ability to quickly toggle project tree inclusion in output without going to settings

## [1.0.15] - 2024-02-28

### Added
- New "Copy Project Structure" command in the context menu
- Progress indicators for all operations with cancellation support
- Detailed progress messages during file processing and token counting
- Better handling of empty directories and error cases in project tree
- Action button to quickly access settings when token limit is exceeded

### Changed
- Markdown is now the default output format
- Refactored and simplified the code structure
- Improved user experience with better visual feedback during longer operations
- Enhanced context menu organization with a dedicated group for Copy4AI commands
- When copying project structure only, the "File Contents" section is now omitted for cleaner output

## [1.0.14] - 2024-03-26

### Changed
- Updated extension icon for better visibility and branding

## [1.0.13] - 2024-03-26

### Changed
- Renamed extension from "SnapSource" to "Copy4AI" (same extension, new name)
- Updated all configuration settings to use new namespace (copy4ai.*)
- Updated documentation and branding
- Note: This is the same extension as before, just with a new name. All your existing settings will be migrated automatically.

## [1.0.11] - 2024-11-22

### Fixed

- Fixed an issue where the `includeProjectTree` setting was not being respected.
- Resolved a linter error related to the `ignore` package usage.

### Changed

- Removed unnecessary activation event from package.json.

## [1.0.9] - 2024-07-26

### Added

- New XML output format
- Option to disable token counting and cost estimation

## [1.0.5] - 2024-07-25

### Added

- Token counting and cost estimation feature
- New settings:
  - `copy4ai.llmModel`: Choose the LLM model for token count and cost estimation
  - `copy4ai.maxTokens`: Set maximum token limit before warning
  - `copy4ai.enableTokenWarning`: Enable/disable token count warning
  - `copy4ai.enableTokenCounting`: Enable/disable token counting and cost estimation

### Changed

- Updated output to include token count and estimated cost information

## [1.0.4] - 2024-07-23

### Changed

- Implement `compressCode`
- Implemented a simpler code compression feature that removes extra whitespace and empty lines
- Updated file processing to use the new compression method
- Improved comment removal functionality

## [1.0.3] - 2024-07-23

### Added

- New setting `copy4ai.includeProjectTree` to optionally disable project tree generation
- Updated output formatting to respect the new setting

## [1.0.2] - 2024-07-14

### Added

- Binary file detection: Binary files are now identified and their content is not included in the output.
- File size limit: Added a new configuration option `copy4ai.maxFileSize` to limit the size of files included in the output.

### Improved

- Error handling: Enhanced error handling and reporting for various scenarios.
- Performance: Optimized file and directory processing for better performance with large projects.

### Fixed

- Various minor bugs and edge cases.

## [1.0.1] - 2024-07-13

- Lowered minimum required VS Code version for broader compatibility.

## [1.0.0] - 2024-07-13

- Initial release
- Features include:
  - Copy file and folder contents with project tree structure
  - Plaintext and Markdown output formats
  - Respect .gitignore and custom exclude patterns
  - Configurable project tree depth
  - Automatic dot file ignoring
