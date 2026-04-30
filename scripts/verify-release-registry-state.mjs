#!/usr/bin/env node

import { pathToFileURL } from "node:url";

function usage() {
  process.stderr.write(
    [
      "Usage:",
      "  node scripts/verify-release-registry-state.mjs --dist-tag <tag> --target-version <version> --package <name> [--package <name> ...]",
      "",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const options = {
    distTag: "",
    targetVersion: "",
    packages: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case "--dist-tag":
        options.distTag = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--target-version":
        options.targetVersion = argv[index + 1] ?? "";
        index += 1;
        break;
      case "--package":
        options.packages.push(argv[index + 1] ?? "");
        index += 1;
        break;
      case "-h":
      case "--help":
        usage();
        process.exit(0);
      default:
        throw new Error(`unexpected argument: ${arg}`);
    }
  }

  if (!options.distTag) {
    throw new Error("--dist-tag is required");
  }

  if (!options.targetVersion) {
    throw new Error("--target-version is required");
  }

  if (options.packages.length === 0 || options.packages.some((name) => !name)) {
    throw new Error("at least one non-empty --package value is required");
  }

  return options;
}

function createRegistryUrl(packageName, version = "") {
  const registry = process.env.npm_config_registry ?? process.env.NPM_CONFIG_REGISTRY ?? "https://registry.npmjs.org/";
  const baseUrl = registry.endsWith("/") ? registry : `${registry}/`;
  const encodedPackage = encodeURIComponent(packageName);

  if (!version) {
    return new URL(encodedPackage, baseUrl);
  }

  return new URL(`${encodedPackage}/${encodeURIComponent(version)}`, baseUrl);
}

async function fetchRegistryJson(url, { allowMissing = false } = {}) {
  const response = await fetch(url, {
    headers: {
      accept: "application/vnd.npm.install-v1+json, application/json;q=0.9",
    },
  });

  if (response.status === 404 && allowMissing) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`npm registry request failed for ${url}: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function fetchPackageDocument(packageName) {
  return fetchRegistryJson(createRegistryUrl(packageName));
}

async function fetchPackageManifest(packageName, version, { allowMissing = false } = {}) {
  return fetchRegistryJson(createRegistryUrl(packageName, version), { allowMissing });
}

export function createManifestLookupKey(packageName, version) {
  return `${packageName}@${version}`;
}

function resolvePublishedManifest(packageName, version, packageDoc, packageManifestsByKey) {
  const directManifest = packageManifestsByKey.get(createManifestLookupKey(packageName, version));
  if (directManifest) {
    return directManifest;
  }

  if (directManifest === null) {
    return null;
  }

  return packageDoc?.versions?.[version] ?? null;
}

export function collectInternalDependencyProblems(manifest, packageDocsByName, packageManifestsByKey) {
  const problems = [];
  const sections = [
    ["dependencies", manifest.dependencies ?? {}],
    ["optionalDependencies", manifest.optionalDependencies ?? {}],
    ["peerDependencies", manifest.peerDependencies ?? {}],
  ];

  for (const [sectionName, deps] of sections) {
    for (const [dependencyName, dependencyVersion] of Object.entries(deps)) {
      if (!dependencyName.startsWith("@paperclipai/")) {
        continue;
      }

      if (typeof dependencyVersion !== "string" || !dependencyVersion) {
        problems.push(
          `${sectionName} declares ${dependencyName} with a non-string version: ${JSON.stringify(dependencyVersion)}`,
        );
        continue;
      }

      const dependencyManifest = resolvePublishedManifest(
        dependencyName,
        dependencyVersion,
        packageDocsByName.get(dependencyName),
        packageManifestsByKey,
      );

      if (!dependencyManifest) {
        problems.push(
          `${sectionName} requires ${dependencyName}@${dependencyVersion}, but npm does not expose that version`,
        );
      }
    }
  }

  return problems;
}

export function verifyPackageRegistryState({
  packageName,
  packageDoc,
  packageDocsByName,
  packageManifestsByKey,
  distTag,
  targetVersion,
}) {
  const problems = [];
  const distTags = packageDoc["dist-tags"] ?? {};
  const taggedVersion = distTags[distTag];

  if (taggedVersion !== targetVersion) {
    problems.push(
      `${packageName}: dist-tag ${distTag} resolves to ${taggedVersion ?? "<missing>"}, expected ${targetVersion}`,
    );
  }

  const targetManifest = resolvePublishedManifest(packageName, targetVersion, packageDoc, packageManifestsByKey);
  if (!targetManifest) {
    problems.push(`${packageName}: npm registry is missing manifest data for ${targetVersion}`);
    return problems;
  }

  for (const problem of collectInternalDependencyProblems(targetManifest, packageDocsByName, packageManifestsByKey)) {
    problems.push(`${packageName}@${targetVersion}: ${problem}`);
  }

  return problems;
}

function collectInternalDependencyVersions(manifest) {
  const dependencyVersions = [];

  for (const deps of [
    manifest.dependencies ?? {},
    manifest.optionalDependencies ?? {},
    manifest.peerDependencies ?? {},
  ]) {
    for (const [dependencyName, dependencyVersion] of Object.entries(deps)) {
      if (!dependencyName.startsWith("@paperclipai/")) {
        continue;
      }

      if (typeof dependencyVersion !== "string" || !dependencyVersion) {
        continue;
      }

      dependencyVersions.push({
        packageName: dependencyName,
        version: dependencyVersion,
      });
    }
  }

  return dependencyVersions;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const packageNames = [...new Set(options.packages)];
  const packageDocsByName = new Map();
  const packageManifestsByKey = new Map();

  await Promise.all(
    packageNames.map(async (packageName) => {
      packageDocsByName.set(packageName, await fetchPackageDocument(packageName));
    }),
  );

  await Promise.all(
    packageNames.map(async (packageName) => {
      packageManifestsByKey.set(
        createManifestLookupKey(packageName, options.targetVersion),
        await fetchPackageManifest(packageName, options.targetVersion, { allowMissing: true }),
      );
    }),
  );

  const dependencyVersionsByKey = new Map();
  for (const packageName of packageNames) {
    const manifest = resolvePublishedManifest(
      packageName,
      options.targetVersion,
      packageDocsByName.get(packageName),
      packageManifestsByKey,
    );

    if (!manifest) {
      continue;
    }

    for (const dependencyVersion of collectInternalDependencyVersions(manifest)) {
      dependencyVersionsByKey.set(
        createManifestLookupKey(dependencyVersion.packageName, dependencyVersion.version),
        dependencyVersion,
      );
    }
  }

  await Promise.all(
    [...dependencyVersionsByKey.values()].map(async ({ packageName, version }) => {
      const lookupKey = createManifestLookupKey(packageName, version);
      if (packageManifestsByKey.has(lookupKey)) {
        return;
      }

      packageManifestsByKey.set(
        lookupKey,
        await fetchPackageManifest(packageName, version, { allowMissing: true }),
      );
    }),
  );

  const problems = [];

  for (const packageName of packageNames) {
    process.stdout.write(`  Verifying ${packageName} on dist-tag ${options.distTag}\n`);
    const packageProblems = verifyPackageRegistryState({
      packageName,
      packageDoc: packageDocsByName.get(packageName),
      packageDocsByName,
      packageManifestsByKey,
      distTag: options.distTag,
      targetVersion: options.targetVersion,
    });

    if (packageProblems.length === 0) {
      process.stdout.write(`    ✓ dist-tag and published internal dependencies are consistent\n`);
      continue;
    }

    for (const problem of packageProblems) {
      process.stderr.write(`    ✗ ${problem}\n`);
      problems.push(problem);
    }
  }

  if (problems.length > 0) {
    throw new Error(`npm registry verification failed for ${problems.length} problem(s)`);
  }
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exit(1);
  });
}
