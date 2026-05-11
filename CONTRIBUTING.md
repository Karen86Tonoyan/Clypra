# Contributing to Clypra

Thank you for your interest in contributing to Clypra! This document provides guidelines and instructions for contributing.

## Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## How Can I Contribute?

### Reporting Bugs

Before creating a bug report:

1. Check the [existing issues](https://github.com/AIEraDev/Clypra/issues) to avoid duplicates
2. Gather information about the bug (version, platform, steps to reproduce)

When creating a bug report, use the bug report template and include:

- Clypra version
- Operating system and version
- Clear steps to reproduce
- Expected vs actual behavior
- Error logs if available
- Screenshots or screen recordings if helpful

### Suggesting Features

Feature requests are welcome! Use the feature request template and include:

- The problem you're trying to solve
- Your proposed solution
- Why this would be useful to other users
- Any alternative solutions you've considered

### Pull Requests

1. **Fork the repository** and create your branch from `develop`
2. **Make your changes** following our coding standards
3. **Test your changes** on all platforms if possible
4. **Update documentation** if needed
5. **Submit a pull request** to the `develop` branch

## Development Setup

### Prerequisites

- **Node.js** 20 or later
- **Rust** 1.70 or later
- **FFmpeg** development libraries
- **Platform-specific dependencies** (see below)

### macOS Setup

```bash
# Install Homebrew if you haven't
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install dependencies
brew install node rust ffmpeg

# Clone the repo
git clone https://github.com/AIEraDev/Clypra.git
cd Clypra

# Install npm dependencies
npm install

# Run in development mode
npm run tauri dev
```

### Windows Setup

```bash
# Install Node.js from nodejs.org
# Install Rust from rustup.rs

# Install FFmpeg via vcpkg
git clone https://github.com/Microsoft/vcpkg.git C:\vcpkg
cd C:\vcpkg
.\bootstrap-vcpkg.bat
.\vcpkg integrate install
.\vcpkg install ffmpeg:x64-windows-static-md

# Clone the repo
git clone https://github.com/AIEraDev/Clypra.git
cd Clypra

# Install npm dependencies
npm install

# Run in development mode
npm run tauri dev
```

### Linux Setup

```bash
# Install dependencies (Ubuntu/Debian)
sudo apt-get update
sudo apt-get install -y \
  nodejs npm \
  curl \
  libavcodec-dev \
  libavformat-dev \
  libavutil-dev \
  libswscale-dev \
  libswresample-dev \
  pkg-config \
  libwebkit2gtk-4.1-dev \
  build-essential \
  wget \
  file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Clone the repo
git clone https://github.com/AIEraDev/Clypra.git
cd Clypra

# Install npm dependencies
npm install

# Run in development mode
npm run tauri dev
```

## Project Structure

```
clypra/
├── src/                    # Frontend React code
│   ├── components/         # React components
│   ├── core/              # Core engine (evaluation, rendering)
│   ├── store/             # Zustand state management
│   └── types/             # TypeScript types
├── src-tauri/             # Rust backend
│   ├── src/               # Rust source code
│   └── Cargo.toml         # Rust dependencies
├── public/                # Static assets
└── docs/                  # Documentation
```

## Coding Standards

### TypeScript/React

- Use TypeScript strict mode
- Follow existing code style (Prettier configured)
- Write JSDoc comments for public APIs
- Prefer functional components with hooks
- Use Zustand for state management
- Keep components small and focused

### Rust

- Follow Rust standard style (rustfmt)
- Write doc comments for public APIs
- Use `cargo clippy` and fix all warnings
- Write tests for new functionality
- Handle errors properly (no unwrap in production code)

### Git Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add transitions panel
fix: resolve audio sync issue
docs: update installation guide
refactor: simplify timeline rendering
test: add tests for text rendering
chore: update dependencies
```

## Testing

### Frontend Tests

```bash
npm test                    # Run all tests
npm test -- --watch        # Watch mode
npm run test:coverage      # Coverage report
```

### Rust Tests

```bash
cd src-tauri
cargo test                 # Run all tests
cargo test -- --nocapture  # Show output
```

### Manual Testing Checklist

Before submitting a PR, test:

- [ ] Import various file formats
- [ ] Trim and split clips
- [ ] Text rendering
- [ ] Export to MP4
- [ ] Save and load project
- [ ] Undo/redo
- [ ] No console errors
- [ ] No memory leaks (leave app open for 10 minutes)

## Finding Issues to Work On

Look for issues labeled:

- `good first issue` - Good for newcomers
- `help wanted` - We need help with these
- `bug` - Bug fixes needed
- `enhancement` - New features

## Pull Request Process

1. **Create a branch** from `develop`:

   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** and commit:

   ```bash
   git add .
   git commit -m "feat: add your feature"
   ```

3. **Push to your fork**:

   ```bash
   git push origin feature/your-feature-name
   ```

4. **Create a Pull Request** on GitHub:
   - Target the `develop` branch
   - Fill out the PR template
   - Link related issues
   - Add screenshots if UI change

5. **Address review feedback**:
   - Make requested changes
   - Push new commits
   - Respond to comments

6. **Merge**: Once approved, a maintainer will merge your PR

## Release Process

Releases are managed by maintainers:

1. Create release branch from `develop`
2. Update version numbers
3. Update CHANGELOG.md
4. Test on all platforms
5. Merge to `master`
6. Tag release: `git tag v0.1.0`
7. Push tag: `git push origin v0.1.0`
8. GitHub Actions builds and creates release

## What We Need Most

Current priorities for v0.1.0:

- [ ] Bug reports with clear reproduction steps
- [ ] Testing on Windows and Linux
- [ ] Documentation improvements
- [ ] UI/UX feedback
- [ ] Performance testing with large projects

## Questions?

- **Discord**: Join our [Discord server](https://discord.gg/clypra)
- **Discussions**: Use [GitHub Discussions](https://github.com/AIEraDev/Clypra/discussions)
- **Email**: clypra@example.com

## License

By contributing, you agree that your contributions will be licensed under the same license as the project (see [LICENSE](LICENSE)).

---

Thank you for contributing to Clypra! 🎬
