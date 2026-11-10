/* Public, deterministic runtime-resource staging. Contains no application behavior. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function stage(applicationRoot) {
  const root = path.resolve(applicationRoot);
  if (!fs.existsSync(path.join(root, 'frontend/package.json'))) {
    throw new Error('Expected an application root with frontend/package.json');
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'runtime-manifest.json'), 'utf8'));
  const targets = manifest.application_targets.map(name => path.join(root, name));
  for (const [name, expected] of Object.entries(manifest.files)) {
    const source = path.resolve(__dirname, name);
    if (!source.startsWith(path.resolve(__dirname) + path.sep)) throw new Error('Resource path escapes its root');
    const bytes = fs.readFileSync(source);
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== expected) {
      throw new Error('Runtime resource hash mismatch: ' + name);
    }
    for (const target of targets) {
      const destination = path.join(target, name);
      fs.mkdirSync(path.dirname(destination), {recursive: true});
      if (source !== destination) fs.writeFileSync(destination, bytes);
    }
  }
  for (const target of targets) {
    const destination = path.join(target, 'runtime-manifest.json');
    if (path.resolve(destination) !== path.join(__dirname, 'runtime-manifest.json')) {
      fs.copyFileSync(path.join(__dirname, 'runtime-manifest.json'), destination);
    }
  }
  return {files: Object.keys(manifest.files).length, targets};
}
module.exports = {stage};
if (require.main === module) {
  if (process.argv.length !== 3) throw new Error('Usage: node stage-assets.cjs <application-root>');
  process.stdout.write(JSON.stringify(stage(process.argv[2])) + '\n');
}
