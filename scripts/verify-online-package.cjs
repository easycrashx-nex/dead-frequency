const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const {createHash}=require('node:crypto');
const asar=createRequire(require.resolve('@electron/packager'))('@electron/asar');
const project=path.resolve(__dirname,'..');
const version=require('../package.json').version;
const packaged=path.resolve(project,`../../outputs/v${version}/DEAD FREQUENCY-win32-x64`);
const archive=path.join(packaged,'resources/app.asar');
let checked=0;
for(const name of asar.listPackage(archive)){
  const relative=name.replace(/^[/\\]/,'').replaceAll('\\','/');
  if(!relative.startsWith('node_modules/')&&/^(server\/.*\.js|src\/.*\.js|dist\/.*|(?:electron|preload|platform|online-platform|admin-platform)\.cjs)$/.test(relative)){
    const source=path.join(project,relative);
    if(!fs.statSync(source).isFile())continue;
    assert.deepEqual(asar.extractFile(archive,relative.split('/').join(path.sep)),fs.readFileSync(source),`Stale packaged file: ${relative}`);checked++;
  }
}
assert.ok(checked>35,'Incomplete application archive');
assert.equal(JSON.parse(asar.extractFile(archive,'package.json')).version,version);
assert.equal(JSON.parse(fs.readFileSync(path.join(packaged,'update-manifest.json'))).version,version);
const report={version,checkedFiles:checked,appAsarSha256:createHash('sha256').update(fs.readFileSync(archive)).digest('hex')};
fs.writeFileSync(path.resolve(project,`../package-online-${version}.json`),JSON.stringify(report,null,2));
console.log(JSON.stringify(report));
