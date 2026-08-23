import jsrManifest from "../jsr.json";
import npmManifest from "../package.json";

if (npmManifest.version !== jsrManifest.version) {
  console.error(
    `Package versions differ: npm=${npmManifest.version}, jsr=${jsrManifest.version}`,
  );
  process.exit(1);
}

console.log(`Package versions match: ${npmManifest.version}`);
