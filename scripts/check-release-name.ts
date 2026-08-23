import manifest from "../package.json";

const packageID = `${manifest.name}@${manifest.version}`;
const response = await fetch(
  `https://registry.npmjs.org/${encodeURIComponent(manifest.name)}/${encodeURIComponent(manifest.version)}`,
);

if (response.status === 404) {
  console.log(`${packageID} is available for publication.`);
  process.exit(0);
}
if (response.ok) {
  console.error(
    `${packageID} already exists on npm; bump the version before publishing.`,
  );
  process.exit(1);
}
console.error(
  `Unable to verify ${packageID}: npm registry returned HTTP ${response.status}.`,
);
process.exit(1);
