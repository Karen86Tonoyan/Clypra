# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Multi-format media import (video, audio, images)
- Image preview support with proper asset URL handling
- Audio file import with duration detection
- Video file import with metadata extraction
- Improved error handling for media imports
- Per-file error handling to continue importing on failure

### Changed

- Rebranded from kyro-editor to Clypra
- Improved ffprobe error messages with detailed diagnostics
- Enhanced media import to handle audio-only files

### Fixed

- Image preview not displaying
- Audio file import failing due to missing video stream
- FFmpeg compatibility issues with noescapestr option
- Missing Rust models module

## [0.1.0] - 2026-04-28

### Added

- Initial release
- Basic video editing functionality
- Timeline interface
- Video trimming and export
- Audio waveform visualization
- Filmstrip preview
- Multi-track timeline support

[Unreleased]: https://github.com/AIEraDev/clypra/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/AIEraDev/clypra/releases/tag/v0.1.0
