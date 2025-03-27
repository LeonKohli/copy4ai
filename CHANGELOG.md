# Change Log

All notable changes to the "Copy4AI" extension will be documented in this file.

## [1.0.18] - 2025-03-27

### Added
- New setting `copy4ai.ignoreDotFiles` to control whether files and directories starting with a dot (.) are ignored
- Now you can include .github and other dot directories by setting `copy4ai.ignoreDotFiles` to false
- New "Toggle Dot Files Inclusion" command accessible from the Command Palette for quick switching

### Fixed
- Fixed issue where .github/workflows and other dot directories couldn't be copied even when selected (fixes #6)

## [1.0.17] - 2025-03-15

### Added
- New exclusion configuration with `copy4ai.exclude` setting
- Support for absolute path exclusions (relative to workspace root)
- More precise control over what files and directories are excluded

### Changed
- **BREAKING CHANGE**: Replaced `copy4ai.excludePatterns` with the more flexible `copy4ai.exclude` object
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
