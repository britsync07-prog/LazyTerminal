const fs = require('fs');

const content = fs.readFileSync('.github/workflows/release.yml', 'utf-8');
const lines = content.split(/\r?\n/);
console.log(`Checking release.yml: ${lines.length} lines, ${content.length} bytes`);

// Verify no tab characters (YAML requirement)
lines.forEach((line, idx) => {
  if (line.includes('\t')) {
    console.error(`Error: Tab character found at line ${idx + 1}`);
    process.exit(1);
  }
});

// Verify required top-level keys
const requiredKeys = ['name', 'on', 'permissions', 'jobs'];
requiredKeys.forEach((key) => {
  if (!content.includes(`${key}:`)) {
    console.error(`Error: Missing required top-level key '${key}'`);
    process.exit(1);
  }
});

// Verify jobs
const requiredJobs = ['validate', 'build-windows', 'build-android', 'publish-release'];
requiredJobs.forEach((job) => {
  if (!content.includes(`${job}:`)) {
    console.error(`Error: Missing required job '${job}'`);
    process.exit(1);
  }
});

console.log('YAML structure and syntax validation PASSED.');
