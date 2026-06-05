# Remote Android Build Services for React Native

When developing React Native apps on Termux/Android, you can't run the Android SDK locally. Here are the best free remote build options.

## Top Recommendation: Expo EAS Build (Free Tier)

**Best for:** React Native / Expo projects
**Free tier:** 30 builds/month, 2 concurrent builds
**Why:** Zero config, purpose-built for RN, produces signed APK/AAB automatically

```bash
# Install EAS CLI
npm install -g eas-cli

# Login with Expo account (free)
eas login

# Configure build
eas build:configure

# Build Android APK
 eas build --platform android --profile preview
```

Pros:
- No YAML config needed
- Automatic signing certificate generation
- OTA updates via Expo
- Builds run on macOS/Linux VMs with Android SDK preinstalled

Cons:
- Requires Expo account
- 30 builds/month limit on free tier
- Queue times can be long on free tier

## Alternative 1: GitHub Actions (Recommended for non-Expo)

**Best for:** Any React Native project (including bare workflow)
**Free tier:** 2,000 minutes/month (public repos), 500 minutes/month (private repos)
**Why:** Fully customizable, integrates with your repo, unlimited flexibility

Example workflow (`.github/workflows/build-android.yml`):

```yaml
name: Build Android APK
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          java-version: '17'
          distribution: 'temurin'
      - uses: android-actions/setup-android@v3
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install
      - run: cd android && ./gradlew assembleRelease
      - uses: actions/upload-artifact@v4
        with:
          name: android-apk
          path: android/app/build/outputs/apk/release/*.apk
```

Pros:
- Free for public repos (2,000 min/month)
- Full control over build environment
- Can cache Gradle dependencies for speed
- Artifacts automatically downloadable

Cons:
- Requires pushing code to GitHub
- Needs YAML configuration
- Slower first builds (no caching)

## Alternative 2: GitLab CI

**Free tier:** 400 minutes/month (shared runners)
Similar to GitHub Actions but for GitLab repos.

## Alternative 3: Bitrise (Mobile-focused CI)

**Free tier:** 200 builds/month, 1 concurrent build
**Why:** Pre-configured React Native workflows, mobile-specific features

```yaml
# bitrise.yml generated automatically when you connect your repo
```

Pros:
- React Native workflow templates out of the box
- Built-in code signing management
- Test device farm integration

Cons:
- 200 builds/month is tight for active development
- Slightly more expensive than GitHub Actions at scale

## Alternative 4: Codemagic

**Free tier:** 500 build minutes/month
**Why:** M1 Mac builders available on free tier (good for iOS too)

## Quick Decision Matrix

| If you... | Use |
|-----------|-----|
| Use Expo | **Expo EAS Build** |
| Have a public GitHub repo | **GitHub Actions** |
| Need both iOS + Android builds | **Codemagic** or **Bitrise** |
| Want zero config | **Expo EAS Build** |
| Need maximum flexibility | **GitHub Actions** |
| On GitLab | **GitLab CI** |

## Setup Script for GitHub Actions

I included a ready-to-use GitHub Actions workflow in:
`.github/workflows/build-android.yml`

Just push this repo to GitHub and the APK will build automatically on every push.

## For This Project

Since the mobile dashboard is a React Native Web app (not a native APK), you don't need an Android build service for this specific project. But if you later want a **real native APK** with the same code:

1. Convert `mobile-dashboard` to a standard Expo project
2. Use `eas build --platform android`
3. Download the APK from Expo dashboard or GitHub Actions artifact
