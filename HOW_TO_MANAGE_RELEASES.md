# How to Manage Releases, Fixes, and Versions Through GitHub

## ✅ Setup Complete!

Your GitHub repository is now fully configured for professional release management. Here's how to use it.

---

## 📋 Quick Start Guide

### Your Current Setup

```
✅ Branches created:
   - master (production)
   - develop (development)

✅ GitHub Actions configured:
   - CI workflow (runs on every PR)
   - Release workflow (builds on tag push)

✅ Issue templates ready:
   - Bug reports
   - Feature requests

✅ Documentation complete:
   - CHANGELOG.md
   - CONTRIBUTING.md
   - RELEASE_GUIDE.md
```

---

## 🎯 Daily Workflow

### 1. Starting Your Day

```bash
# Switch to develop branch
git checkout develop

# Get latest changes
git pull origin develop
```

### 2. Working on a Feature

```bash
# Create feature branch
git checkout -b feature/add-transitions

# Make changes
# ... edit files ...

# Commit
git add .
git commit -m "feat: add transition panel"

# Push
git push origin feature/add-transitions
```

### 3. Creating a Pull Request

1. Go to https://github.com/AIEraDev/Clypra
2. Click "Pull requests" → "New pull request"
3. Select: `develop` ← `feature/add-transitions`
4. Fill out the template
5. Wait for CI to pass (automatic)
6. Merge when ready

---

## 🐛 Fixing Bugs

### Step 1: Create Bug Report

1. Go to Issues → New Issue
2. Choose "Bug Report"
3. Fill out all fields
4. Submit

### Step 2: Fix the Bug

```bash
# Create fix branch
git checkout develop
git pull origin develop
git checkout -b fix/audio-sync

# Fix the bug
# ... edit files ...

# Test
npm test
npm run tauri dev

# Commit
git add .
git commit -m "fix: resolve audio sync issue

Fixes #42"

# Push
git push origin fix/audio-sync
```

### Step 3: Create PR

1. Create PR to `develop`
2. Link issue: "Closes #42"
3. Wait for CI
4. Merge

---

## 🚀 Creating a Release

### When to Release

- **Patch (0.1.1)**: Bug fixes only
- **Minor (0.2.0)**: New features
- **Major (1.0.0)**: Breaking changes

### Release Process

#### Step 1: Create Release Branch

```bash
git checkout develop
git pull origin develop
git checkout -b release/0.1.0
```

#### Step 2: Update Version (3 files)

Edit these files:

**package.json:**

```json
{
  "version": "0.1.0"
}
```

**src-tauri/Cargo.toml:**

```toml
[package]
version = "0.1.0"
```

**src-tauri/tauri.conf.json:**

```json
{
  "version": "0.1.0"
}
```

```bash
git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json
git commit -m "chore: bump version to 0.1.0"
```

#### Step 3: Update CHANGELOG.md

```markdown
## [0.1.0] - 2026-05-15

### Added

- Text rendering system
- Export to MP4

### Fixed

- Audio sync issues
```

```bash
git add CHANGELOG.md
git commit -m "docs: update changelog for 0.1.0"
```

#### Step 4: Test Build

```bash
npm run tauri build

# Test the built app thoroughly!
```

#### Step 5: Merge to Master

```bash
# Push release branch
git push origin release/0.1.0

# Create PR on GitHub: release/0.1.0 → master
# Wait for CI to pass
# Merge PR

# Merge back to develop
git checkout develop
git pull origin develop
git merge release/0.1.0
git push origin develop
```

#### Step 6: Tag and Release

```bash
# Switch to master
git checkout master
git pull origin master

# Create tag
git tag v0.1.0

# Push tag (this triggers GitHub Actions!)
git push origin v0.1.0
```

#### Step 7: Wait for GitHub Actions

GitHub Actions will automatically:

1. Build for macOS (15-20 minutes)
2. Build for Windows (15-20 minutes)
3. Build for Linux (10-15 minutes)
4. Create draft release
5. Upload all binaries

#### Step 8: Publish Release

1. Go to https://github.com/AIEraDev/Clypra/releases
2. Find draft release
3. Review release notes
4. Click "Publish release"

**Done!** 🎉

---

## 🔥 Emergency Hotfix

For critical bugs in production:

```bash
# 1. Create hotfix from master
git checkout master
git pull origin master
git checkout -b hotfix/0.1.1

# 2. Fix the bug
# ... edit files ...

# 3. Update version to 0.1.1 (3 files)
# 4. Update CHANGELOG.md
# 5. Test thoroughly

# 6. Merge to master
git checkout master
git merge hotfix/0.1.1
git push origin master

# 7. Tag
git tag v0.1.1
git push origin v0.1.1

# 8. Merge to develop
git checkout develop
git merge hotfix/0.1.1
git push origin develop
```

---

## 📊 Using GitHub Features

### Labels

Add labels to issues and PRs:

- `type: bug` - Bug reports
- `type: feature` - New features
- `priority: high` - Important
- `platform: macOS` - Platform-specific

### Milestones

1. Go to Issues → Milestones
2. Create milestone: `v0.1.0`
3. Set due date
4. Assign issues to milestone
5. Track progress

### Projects

1. Go to Projects → New project
2. Create board with columns:
   - Backlog
   - Ready
   - In Progress
   - In Review
   - Done
3. Add issues to board
4. Move cards as you work

---

## 🔍 Monitoring

### Check CI Status

Every PR shows CI status:

- ✅ Green check = tests pass
- ❌ Red X = tests fail
- 🟡 Yellow dot = running

Click "Details" to see logs.

### Check Release Build

After pushing a tag:

1. Go to Actions tab
2. Find "Release" workflow
3. Watch progress
4. Check for errors

---

## 📝 Best Practices

### Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new feature
fix: resolve bug
docs: update documentation
chore: update dependencies
test: add tests
refactor: refactor code
```

### Branch Naming

```
feature/add-transitions
fix/audio-sync-issue
release/0.1.0
hotfix/0.1.1
```

### PR Guidelines

- Keep PRs small and focused
- Link related issues
- Add screenshots for UI changes
- Wait for CI before merging
- Delete branch after merge

---

## 🆘 Troubleshooting

### CI Fails

1. Click "Details" on failed check
2. Read error logs
3. Fix locally
4. Push again

### Release Build Fails

1. Go to Actions → Release workflow
2. Check which platform failed
3. Read error logs
4. Fix and create new tag

### Can't Push to Master

Master is protected! You must:

1. Create PR
2. Wait for CI
3. Merge PR

---

## 📚 Full Documentation

- **RELEASE_GUIDE.md** - Complete release workflow
- **CONTRIBUTING.md** - How to contribute
- **CHANGELOG.md** - Version history

---

## 🎓 Learning Path

### Week 1: Basic Workflow

- Create feature branches
- Make commits
- Create PRs
- Merge to develop

### Week 2: Bug Fixes

- Report bugs
- Fix bugs
- Test fixes
- Merge fixes

### Week 3: Releases

- Create release branch
- Update versions
- Tag release
- Publish release

### Week 4: Advanced

- Hotfixes
- Milestones
- Projects
- Labels

---

## ✅ Checklist for First Release

- [ ] All features working
- [ ] All tests passing
- [ ] Tested on all platforms
- [ ] Version updated (3 files)
- [ ] CHANGELOG.md updated
- [ ] Release branch created
- [ ] Merged to master
- [ ] Tagged: `v0.1.0`
- [ ] GitHub Actions completed
- [ ] Release published
- [ ] Announced

---

## 🚀 You're Ready!

Your GitHub repository is now a professional release management system.

**Next steps:**

1. Start working in `develop` branch
2. Create feature branches for new work
3. Use PRs for all changes
4. When ready, follow release process

**Questions?**

- Read RELEASE_GUIDE.md for details
- Check CONTRIBUTING.md for guidelines
- Create an issue if stuck

**Good luck with v0.1.0!** 🎬
