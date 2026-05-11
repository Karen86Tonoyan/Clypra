# Clypra Release Management Guide

This guide explains how to manage releases, fixes, bugs, and versions through GitHub.

## Table of Contents

1. [Branch Strategy](#branch-strategy)
2. [Version Numbering](#version-numbering)
3. [Daily Workflow](#daily-workflow)
4. [Bug Fix Workflow](#bug-fix-workflow)
5. [Feature Development Workflow](#feature-development-workflow)
6. [Release Workflow](#release-workflow)
7. [Hotfix Workflow](#hotfix-workflow)
8. [GitHub Labels](#github-labels)
9. [Milestones](#milestones)

---

## Branch Strategy

```
master (main)     ← Production-ready code, always releasable
  ↑
develop           ← Active development, integration branch
  ↑
feature/*         ← New features
fix/*             ← Bug fixes
release/*         ← Release preparation
hotfix/*          ← Emergency fixes for production
```

### Branch Rules

- **master**: Protected, requires PR, requires CI pass
- **develop**: Protected, requires CI pass
- **feature/**: Created from `develop`, merged back to `develop`
- **fix/**: Created from `develop`, merged back to `develop`
- **release/**: Created from `develop`, merged to both `master` and `develop`
- **hotfix/**: Created from `master`, merged to both `master` and `develop`

---

## Version Numbering

Clypra follows [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`

### Version Format

```
0.1.0          ← Public release
0.1.1          ← Bug fix release
0.2.0          ← New features
1.0.0          ← Stable, production-ready

0.1.0-alpha.1  ← Internal testing
0.1.0-beta.1   ← Public testing
0.1.0-rc.1     ← Release candidate
```

### When to Increment

- **MAJOR** (1.0.0): Breaking changes, major milestones
- **MINOR** (0.2.0): New features, non-breaking changes
- **PATCH** (0.1.1): Bug fixes only

### Where to Update Version

Update version in **3 places** (keep them in sync):

1. `package.json`:

   ```json
   {
     "version": "0.1.0"
   }
   ```

2. `src-tauri/Cargo.toml`:

   ```toml
   [package]
   version = "0.1.0"
   ```

3. `src-tauri/tauri.conf.json`:
   ```json
   {
     "version": "0.1.0"
   }
   ```

---

## Daily Workflow

### Starting Your Day

```bash
# 1. Switch to develop branch
git checkout develop

# 2. Pull latest changes
git pull origin develop

# 3. Check for updates
git status
```

### Making Changes

```bash
# 1. Create a feature branch
git checkout -b feature/add-transitions

# 2. Make your changes
# ... edit files ...

# 3. Commit frequently
git add .
git commit -m "feat: add transition panel UI"

# 4. Push to your branch
git push origin feature/add-transitions
```

### Creating a Pull Request

1. Go to GitHub repository
2. Click "Pull requests" → "New pull request"
3. Base: `develop` ← Compare: `feature/add-transitions`
4. Fill out the PR template
5. Add labels (type: feature, priority: high, etc.)
6. Assign to milestone (v0.1.0)
7. Request review if needed
8. Wait for CI to pass
9. Merge when approved

---

## Bug Fix Workflow

### Reporting a Bug

1. Go to Issues → New Issue
2. Choose "Bug Report" template
3. Fill out all fields:
   - Version
   - Platform
   - Steps to reproduce
   - Expected vs actual behavior
4. Add labels: `type: bug`, `priority: high`
5. Assign to milestone: `v0.1.0`

### Fixing a Bug

```bash
# 1. Create fix branch from develop
git checkout develop
git pull origin develop
git checkout -b fix/audio-sync-issue

# 2. Fix the bug
# ... edit files ...

# 3. Test the fix
npm test
npm run tauri dev  # Manual testing

# 4. Commit with descriptive message
git add .
git commit -m "fix: resolve audio sync drift in long videos

- Added periodic drift correction every 250ms
- Improved AudioContext time calculation
- Fixes #42"

# 5. Push and create PR
git push origin fix/audio-sync-issue
```

### PR for Bug Fix

- Base: `develop`
- Title: `fix: resolve audio sync drift`
- Link issue: `Closes #42`
- Labels: `type: bug`
- Test on all platforms before merging

---

## Feature Development Workflow

### Planning a Feature

1. Create feature request issue
2. Discuss approach in issue comments
3. Break down into smaller tasks if needed
4. Assign to milestone

### Developing a Feature

```bash
# 1. Create feature branch
git checkout develop
git pull origin develop
git checkout -b feature/text-animations

# 2. Develop incrementally
# ... make changes ...
git add .
git commit -m "feat: add fade-in animation"

# ... more changes ...
git commit -m "feat: add slide-in animation"

# 3. Keep branch updated with develop
git fetch origin
git rebase origin/develop

# 4. Push when ready
git push origin feature/text-animations
```

### Feature PR

- Base: `develop`
- Title: `feat: add text animations`
- Description: Explain what the feature does
- Screenshots/videos if UI change
- Labels: `type: feature`
- Milestone: `v0.2.0` (next version)

---

## Release Workflow

### Preparing a Release

#### 1. Create Release Branch

```bash
# From develop branch
git checkout develop
git pull origin develop
git checkout -b release/0.1.0
```

#### 2. Update Version Numbers

Edit these 3 files:

- `package.json` → `"version": "0.1.0"`
- `src-tauri/Cargo.toml` → `version = "0.1.0"`
- `src-tauri/tauri.conf.json` → `"version": "0.1.0"`

```bash
git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json
git commit -m "chore: bump version to 0.1.0"
```

#### 3. Update CHANGELOG.md

```markdown
## [0.1.0] - 2026-05-15

### Added

- Text rendering system
- Export to MP4
- ... (list all changes)

### Fixed

- Audio sync issues
- ... (list all fixes)
```

```bash
git add CHANGELOG.md
git commit -m "docs: update changelog for 0.1.0"
```

#### 4. Test Release Build

```bash
# Test on your platform
npm run tauri build

# Test the built app thoroughly
# - Import videos
# - Edit timeline
# - Export
# - Save/load projects
```

#### 5. Push Release Branch

```bash
git push origin release/0.1.0
```

#### 6. Create PR to Master

1. Go to GitHub
2. Create PR: `release/0.1.0` → `master`
3. Title: "Release v0.1.0"
4. Review all changes
5. Wait for CI to pass
6. Merge to master

#### 7. Merge Back to Develop

```bash
git checkout develop
git pull origin develop
git merge release/0.1.0
git push origin develop
```

#### 8. Tag the Release

```bash
git checkout master
git pull origin master
git tag v0.1.0
git push origin v0.1.0
```

#### 9. GitHub Actions Builds Release

- GitHub Actions automatically:
  - Builds for macOS, Windows, Linux
  - Creates draft release
  - Uploads binaries

#### 10. Publish Release

1. Go to GitHub Releases
2. Find draft release
3. Review release notes
4. Edit if needed
5. Click "Publish release"

---

## Hotfix Workflow

For critical bugs in production that can't wait for next release.

### Creating a Hotfix

```bash
# 1. Create hotfix branch from master
git checkout master
git pull origin master
git checkout -b hotfix/0.1.1

# 2. Fix the critical bug
# ... edit files ...

# 3. Update version to 0.1.1
# Edit package.json, Cargo.toml, tauri.conf.json

# 4. Update CHANGELOG.md
## [0.1.1] - 2026-05-16
### Fixed
- Critical export crash on Windows

# 5. Commit
git add .
git commit -m "fix: resolve critical export crash on Windows"

# 6. Test thoroughly
npm run tauri build
# Test the fix

# 7. Push
git push origin hotfix/0.1.1
```

### Merging Hotfix

```bash
# 1. Merge to master
git checkout master
git merge hotfix/0.1.1
git push origin master

# 2. Tag hotfix
git tag v0.1.1
git push origin v0.1.1

# 3. Merge to develop
git checkout develop
git merge hotfix/0.1.1
git push origin develop

# 4. Delete hotfix branch
git branch -d hotfix/0.1.1
git push origin --delete hotfix/0.1.1
```

---

## GitHub Labels

### Type Labels

- `type: bug` 🔴 - Something is broken
- `type: feature` 🟢 - New functionality
- `type: docs` 🔵 - Documentation changes
- `type: performance` 🟠 - Performance improvements
- `type: security` 🔴 - Security issues

### Priority Labels

- `priority: critical` - Blocks release, fix immediately
- `priority: high` - Important, fix soon
- `priority: medium` - Normal priority
- `priority: low` - Nice to have

### Platform Labels

- `platform: macOS`
- `platform: Windows`
- `platform: Linux`
- `platform: all` - Affects all platforms

### Status Labels

- `status: needs-repro` - Can't reproduce yet
- `status: confirmed` - Bug confirmed
- `status: in-progress` - Being worked on
- `status: blocked` - Blocked by something
- `status: needs-review` - Needs code review

### Special Labels

- `good first issue` - Good for newcomers
- `help wanted` - We need help with this
- `duplicate` - Duplicate of another issue
- `wontfix` - Won't be fixed

---

## Milestones

### Creating a Milestone

1. Go to Issues → Milestones → New milestone
2. Title: `v0.1.0`
3. Due date: Target release date
4. Description: What's included in this release

### Using Milestones

- Assign every issue to a milestone
- Track progress: X% complete
- Review weekly: What's done? What's blocked?
- Adjust scope if needed

### Milestone Workflow

```
v0.1.0 (Current)     ← Active development
v0.2.0 (Next)        ← Planned features
v1.0.0 (Future)      ← Long-term goals
Backlog              ← No specific version yet
```

---

## Quick Reference

### Common Commands

```bash
# Start new feature
git checkout develop && git pull && git checkout -b feature/name

# Start bug fix
git checkout develop && git pull && git checkout -b fix/name

# Update branch with latest develop
git fetch origin && git rebase origin/develop

# Create release
git checkout develop && git checkout -b release/0.1.0

# Create hotfix
git checkout master && git checkout -b hotfix/0.1.1

# Tag release
git tag v0.1.0 && git push origin v0.1.0
```

### Release Checklist

- [ ] All milestone issues closed
- [ ] Version updated in 3 files
- [ ] CHANGELOG.md updated
- [ ] Tested on all platforms
- [ ] CI passing
- [ ] Release branch merged to master
- [ ] Tagged and pushed
- [ ] GitHub Actions completed
- [ ] Release published
- [ ] Announced on Discord/Twitter

---

## Getting Help

- **Questions**: Ask in Discord #dev-log channel
- **Issues**: Create a GitHub issue
- **Urgent**: Email clypra@example.com

---

**Remember**: `develop` is for development, `master` is for releases. Always work in feature branches!
