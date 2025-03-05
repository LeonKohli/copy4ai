# Copy4AI Development Guidelines

## Commands
- Run tests: `npm test`
- Run linting: `npm run lint`
- Run both lint and test: `npm run pretest`
- Build for publishing: `npm run vscode:prepublish`

## Code Style
- **Naming**: camelCase for variables/functions, PascalCase for classes
- **Indentation**: 4 spaces
- **Imports**: Group imports by type (Node built-ins first, then external packages, then local)
- **Error Handling**: Use try/catch blocks with specific error messages
- **Async**: Use async/await pattern for async operations
- **Formatting**: Include semicolons, use single quotes for strings
- **Comments**: Minimal but descriptive comments for complex logic
- **Export Style**: Use module.exports for compatibility with CommonJS
- **File Structure**: All extension code is in extension.js, tests in test/extension.test.js
- **Constants**: Use ALL_CAPS for constants like MODEL_MAX_TOKENS

## Extension Structure
- Single entry point (extension.js)
- Function-based architecture with minimal dependencies
- Comprehensive test suite using Mocha