# Publishing `opencode-gpustack` to JSR

Research checked against official JSR documentation and the upstream JSR
repository on 2026-08-24.

## Recommendation

Publish the plugin and public types to JSR as
`@jirachaic/opencode-gpustack`, while keeping npm's unscoped
`opencode-gpustack` package as the canonical CLI installation channel.

JSR explicitly supports ESM JavaScript and TypeScript, encourages publishing
TypeScript source, supports dependencies from `package.json`, and permits
`node:` built-ins. That makes the existing TypeScript plugin a suitable JSR
package, subject to JSR's publish-time portability and type checks. Bun users
can consume JSR packages, but the JSR publish command—not `npm publish`—must be
used for the JSR release.

Sources:

- [JSR package rules](https://jsr.io/docs/publishing-packages#jsr-package-rules)
- [Using JSR packages](https://jsr.io/docs/using-packages)
- [npm compatibility limitations](https://jsr.io/docs/npm-compatibility#limitations)

## Package identity and creation

Every JSR package is scoped. The proposed identity is:

```text
@jirachaic/opencode-gpustack
```

Both `https://jsr.io/@jirachaic` and
`https://jsr.io/@jirachaic/opencode-gpustack` returned HTTP 404 when checked on
2026-08-24. This is evidence that neither page currently exists, not a guarantee
that JSR will accept the names: JSR also rejects names that are too similar to
existing names. Final availability is determined when creating the scope and
package at [jsr.io/new](https://jsr.io/new).

The proposed scope and package names fit every length rule currently stated in
the official documentation. The docs currently disagree on the maximum length
of scope and package names, so implementations should not encode those maxima
locally; rely on JSR validation.

Sources:

- [Creating a scope and package](https://jsr.io/docs/publishing-packages#creating-a-scope-and-package)
- [Scope reference](https://jsr.io/docs/scopes)
- [Package reference](https://jsr.io/docs/packages)

## Manifest

JSR requires `jsr.json`, `jsr.jsonc`, or equivalent JSR properties in
`deno.json(c)`. The relevant required metadata is the scoped package name,
SemVer version, and one or more module exports. The project should publish its
TypeScript sources directly:

```json
{
  "$schema": "https://jsr.io/schema/config-file.v1.json",
  "name": "@jirachaic/opencode-gpustack",
  "version": "0.1.0",
  "license": "MIT",
  "exports": {
    ".": "./src/index.ts",
    "./types": "./src/types.ts"
  },
  "publish": {
    "include": [
      "src/**/*.ts",
      "README.md",
      "LICENSE",
      "CHANGELOG.md"
    ]
  }
}
```

The npm and JSR versions should be validated as equal before either registry is
published. Each JSR version is immutable and a new publication requires a new
SemVer version.

Sources:

- [`jsr.json` configuration](https://jsr.io/docs/package-configuration)
- [Official configuration schema](https://jsr.io/schema/config-file.v1.json)
- [Package versions and immutability](https://jsr.io/docs/packages#versions)
- [Publish file filtering](https://jsr.io/docs/publishing-packages#filtering-files)

## CLI constraint

JSR's manifest and generated npm-compatibility metadata expose module exports,
not a supported executable mapping equivalent to `package.json#bin`. The
upstream request for CLI and executable support remains open, and an upstream
report specifically confirms that `package.json#bin` is not respected.

Consequences for this project:

- Publish the OpenCode plugin entrypoint and public TypeScript types to JSR.
- Do not promise that installing from JSR creates an
  `opencode-gpustack` executable.
- Keep `npm install -g opencode-gpustack` or `npx opencode-gpustack` as the
  supported CLI path.
- Do not add `src/cli.ts` as a JSR export solely to simulate `bin`; a module
  export is not an executable registration mechanism.

Sources:

- [JSR issue 766: Publish CLIs and N-API dependent modules](https://github.com/jsr-io/jsr/issues/766)
- [JSR issue 157: add npx-like behavior](https://github.com/jsr-io/jsr/issues/157)
- [JSR npm compatibility technical details](https://jsr.io/docs/npm-compatibility#technical-details)

## Verification and local publication

The official verification command is:

```sh
npx jsr publish --dry-run
```

The official local publication command is:

```sh
npx jsr publish
```

Local JSR publishing opens a browser for JSR authorization. npm authentication
does not authenticate JSR. A JSR scope and package must be created first.

The repository may use `bunx jsr publish --dry-run` as a project convenience,
but the JSR publishing guide currently documents `npx jsr publish` (as well as
`deno publish`, `yarn dlx`, and `pnpm dlx`) as the supported invocation.

Sources:

- [Verifying a package](https://jsr.io/docs/publishing-packages#verifying-your-package)
- [Publishing locally](https://jsr.io/docs/publishing-packages#publishing-from-your-local-machine)

## GitHub Actions, authentication, and provenance

GitHub Actions is the preferred release path:

1. Create the scope and package at [jsr.io/new](https://jsr.io/new).
2. In the JSR package settings, link the package to
   `jirachaic/opencode-gpustack`.
3. Grant the publish job `contents: read` and `id-token: write`.
4. Run `npx jsr publish` from the repository root.

Minimal job permissions and step:

```yaml
permissions:
  contents: read
  id-token: write

steps:
  - uses: actions/checkout@v6
  - run: npx jsr publish
```

This native GitHub Actions integration uses OIDC and requires no JSR token or
repository secret. JSR automatically creates SLSA/Sigstore provenance for a
package published through this integration. Publishing from another CI provider
requires a JSR access token passed with `--token`, and token-based publication
does not receive provenance.

Sources:

- [Publishing from GitHub Actions](https://jsr.io/docs/publishing-packages#publishing-from-github-actions)
- [Publishing from other CI providers](https://jsr.io/docs/publishing-packages#publishing-from-other-ci-providers)
- [Provenance and trust](https://jsr.io/docs/trust)

## Release checklist

1. Confirm `package.json` and `jsr.json` contain the same unreleased version.
2. Run the full test, type-check, lint, and package smoke suite.
3. Run `npx jsr publish --dry-run` and inspect the included file list.
4. Create `@jirachaic/opencode-gpustack` in JSR and link its GitHub repository.
5. Publish npm and JSR from the same tagged commit.
6. Verify the JSR package page, documented imports, generated API docs, and
   provenance record.
7. Verify the npm package separately, including the installed CLI, because the
   CLI is not part of the JSR distribution contract.
