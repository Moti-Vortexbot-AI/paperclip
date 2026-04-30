import assert from "node:assert/strict";
import test from "node:test";

import {
  collectInternalDependencyProblems,
  createManifestLookupKey,
  verifyPackageRegistryState,
} from "./verify-release-registry-state.mjs";

test("collectInternalDependencyProblems flags missing internal versions", () => {
  const manifest = {
    dependencies: {
      "@paperclipai/plugin-sdk": "2026.425.0-canary.5",
      e2b: "^2.19.0",
    },
  };
  const packageDocsByName = new Map([
    [
      "@paperclipai/plugin-sdk",
      {
        versions: {
          "2026.427.0-canary.3": {},
        },
      },
    ],
  ]);

  assert.deepEqual(
    collectInternalDependencyProblems(manifest, packageDocsByName, new Map()),
    ["dependencies requires @paperclipai/plugin-sdk@2026.425.0-canary.5, but npm does not expose that version"],
  );
});

test("collectInternalDependencyProblems accepts version-specific manifests when the root document is stale", () => {
  const manifest = {
    dependencies: {
      "@paperclipai/plugin-sdk": "2026.425.0-canary.5",
    },
  };
  const packageDocsByName = new Map([
    [
      "@paperclipai/plugin-sdk",
      {
        versions: {},
      },
    ],
  ]);
  const packageManifestsByKey = new Map([
    [
      createManifestLookupKey("@paperclipai/plugin-sdk", "2026.425.0-canary.5"),
      { name: "@paperclipai/plugin-sdk", version: "2026.425.0-canary.5" },
    ],
  ]);

  assert.deepEqual(
    collectInternalDependencyProblems(manifest, packageDocsByName, packageManifestsByKey),
    [],
  );
});

test("verifyPackageRegistryState tolerates a stale root versions map when dist-tags and direct manifests are correct", () => {
  const packageDocsByName = new Map([
    [
      "@paperclipai/ui",
      {
        "dist-tags": {
          canary: "2026.430.0-canary.0",
        },
        versions: {},
      },
    ],
    [
      "@paperclipai/shared",
      {
        versions: {},
      },
    ],
  ]);
  const packageManifestsByKey = new Map([
    [
      createManifestLookupKey("@paperclipai/ui", "2026.430.0-canary.0"),
      {
        name: "@paperclipai/ui",
        version: "2026.430.0-canary.0",
        dependencies: {
          "@paperclipai/shared": "2026.430.0-canary.0",
        },
      },
    ],
    [
      createManifestLookupKey("@paperclipai/shared", "2026.430.0-canary.0"),
      {
        name: "@paperclipai/shared",
        version: "2026.430.0-canary.0",
      },
    ],
  ]);

  assert.deepEqual(
    verifyPackageRegistryState({
      packageName: "@paperclipai/ui",
      packageDoc: packageDocsByName.get("@paperclipai/ui"),
      packageDocsByName,
      packageManifestsByKey,
      distTag: "canary",
      targetVersion: "2026.430.0-canary.0",
    }),
    [],
  );
});

test("verifyPackageRegistryState still fails when the dist-tag is stale", () => {
  const packageDocsByName = new Map([
    [
      "@paperclipai/ui",
      {
        "dist-tags": {
          canary: "2026.429.0-canary.2",
        },
        versions: {},
      },
    ],
  ]);
  const packageManifestsByKey = new Map([
    [
      createManifestLookupKey("@paperclipai/ui", "2026.430.0-canary.0"),
      {
        name: "@paperclipai/ui",
        version: "2026.430.0-canary.0",
      },
    ],
  ]);

  assert.deepEqual(
    verifyPackageRegistryState({
      packageName: "@paperclipai/ui",
      packageDoc: packageDocsByName.get("@paperclipai/ui"),
      packageDocsByName,
      packageManifestsByKey,
      distTag: "canary",
      targetVersion: "2026.430.0-canary.0",
    }),
    ["@paperclipai/ui: dist-tag canary resolves to 2026.429.0-canary.2, expected 2026.430.0-canary.0"],
  );
});
