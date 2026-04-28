# Contributing to Clypra

Thank you for your interest in contributing to Clypra! We welcome contributions from the community.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/clypra.git`
3. Create a new branch: `git checkout -b feature/your-feature-name`
4. Make your changes
5. Test your changes thoroughly
6. Commit your changes: `git commit -m "Add your feature"`
7. Push to your fork: `git push origin feature/your-feature-name`
8. Open a Pull Request

## Development Setup

### Prerequisites

- Node.js 18+ and npm
- Rust and Cargo (latest stable)
- FFmpeg installed and available in PATH

### Installation

```bash
# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Run tests
npm test
```

## Code Style

- Follow the existing code structure and patterns
- Use TypeScript for all new code
- Follow React best practices and hooks patterns
- Use meaningful variable and function names
- Add comments for complex logic

## Project Structure

- `src/components/` - Reusable UI components
- `src/features/` - Feature modules (self-contained)
- `src/hooks/` - Custom React hooks
- `src/store/` - State management
- `src/types/` - TypeScript type definitions
- `src-tauri/` - Rust backend code

## Testing

- Write tests for new features
- Ensure all tests pass before submitting PR
- Test on multiple platforms if possible (macOS, Windows, Linux)

## Pull Request Guidelines

1. **Keep PRs focused** - One feature or fix per PR
2. **Write clear descriptions** - Explain what and why
3. **Update documentation** - If you change functionality
4. **Add tests** - For new features
5. **Follow code style** - Match existing patterns
6. **Keep commits clean** - Use meaningful commit messages

## Commit Message Format

```
type: brief description

Longer description if needed

- Detail 1
- Detail 2
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

## Reporting Issues

- Use GitHub Issues
- Provide clear description
- Include steps to reproduce
- Add screenshots/videos if applicable
- Specify your OS and version

## Feature Requests

- Open a GitHub Issue with the `enhancement` label
- Describe the feature and use case
- Explain why it would be valuable

## Code of Conduct

- Be respectful and inclusive
- Welcome newcomers
- Focus on constructive feedback
- Help others learn and grow

## Questions?

Feel free to open an issue for questions or join discussions in GitHub Discussions.

Thank you for contributing! 🎉
