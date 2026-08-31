# Contributing

Pull requests are welcome. Keep them focused, match the style of the surrounding code, and include tests for behavior you change.

## Setup

Node.js 22+ (this repo’s `.nvmrc` is 22).

```sh
nvm use
npm install
npm test
npm run build
```

## Releasing

1. Bump `version` in `package.json`.
2. Open a PR and merge it to `main`.
3. On `main`, tag and push:

```sh
git tag vX.Y.Z
git push origin vX.Y.Z
```

The `release` workflow runs tests, publishes to npm, and creates a [GitHub Release](https://github.com/guillegette/mcp-eval-gateway/releases). Prerelease versions (a `-` in the version, for example `1.0.1-0`) publish under the npm `next` dist-tag and are marked as prereleases on GitHub.
