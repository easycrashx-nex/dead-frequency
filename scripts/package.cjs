const fs=require('node:fs/promises');
const path=require('node:path');
const {packager}=require('@electron/packager');
const {createRequire}=require('node:module');
const project=path.resolve(__dirname,'..');
const workspace=path.resolve(project,'../..');
const output=path.join(workspace,'outputs');
const stage=path.join(project,'.package-stage');
const appPackage=require('../package.json');
if(!/^\d+\.\d+\.\d+$/.test(appPackage.version))throw new Error('Invalid release version');
const releaseOutput=path.join(output,`v${appPackage.version}`);
function within(candidate,parent){const rel=path.relative(parent,candidate);if(!rel||rel.startsWith('..')||path.isAbsolute(rel))throw new Error(`Unsafe packaging path: ${candidate}`);}
async function main(){
  within(stage,project);within(output,workspace);
  within(path.join(releaseOutput,'DEAD FREQUENCY-win32-x64'),output);
  await fs.rm(stage,{recursive:true,force:true});
  await fs.mkdir(stage,{recursive:true});
  await fs.mkdir(output,{recursive:true});
  await fs.cp(path.join(project,'dist'),path.join(stage,'dist'),{recursive:true});
  for(const name of ['electron.cjs','preload.cjs','platform.cjs'])await fs.copyFile(path.join(project,name),path.join(stage,name));
  for(const name of ['server','launcher'])await fs.cp(path.join(project,name),path.join(stage,name),{recursive:true});
  await fs.mkdir(path.join(stage,'src'),{recursive:true});
  for(const name of ['simulation.js','enemy-ai.js','layout.js','loot-catalog.js','weapons.js','loadouts.js','progression.js','economy.js','coop-session.js'])await fs.copyFile(path.join(project,'src',name),path.join(stage,'src',name));
  const dependencies=Object.fromEntries(['@dimforge/rapier3d-compat','ws','yauzl'].map(name=>[name,appPackage.dependencies[name]]));
  const copied=new Set();
  async function copyDependency(name,req){
    if(copied.has(name))return;
    let dir=path.dirname(req.resolve(name)),metadata;
    while(dir!==path.dirname(dir)){
      try{const candidate=JSON.parse(await fs.readFile(path.join(dir,'package.json'),'utf8'));if(candidate.name===name){metadata=candidate;break;}}catch{}
      dir=path.dirname(dir);
    }
    if(!metadata)throw new Error(`Runtime dependency missing: ${name}`);
    copied.add(name);await fs.cp(dir,path.join(stage,'node_modules',name),{recursive:true});
    const localRequire=createRequire(path.join(dir,'package.json'));
    for(const dependency of Object.keys(metadata.dependencies||{}))await copyDependency(dependency,localRequire);
  }
  for(const name of Object.keys(dependencies))await copyDependency(name,require);
  await fs.writeFile(path.join(stage,'package.json'),JSON.stringify({name:'dead-frequency',version:appPackage.version,type:'module',description:appPackage.description,main:'electron.cjs',author:'DEAD FREQUENCY Studio',license:'UNLICENSED',dependencies}));
  const icon=path.join(project,'public','icon.ico');
  const paths=await packager({dir:stage,name:'DEAD FREQUENCY',executableName:'DEAD FREQUENCY',appVersion:appPackage.version,platform:'win32',arch:'x64',electronVersion:require('electron/package.json').version,out:releaseOutput,overwrite:true,asar:true,prune:false,extraResource:[path.join(project,'vendor')],icon,win32metadata:{CompanyName:'DEAD FREQUENCY',FileDescription:'DEAD FREQUENCY — Extraction Shooter',ProductName:'DEAD FREQUENCY',InternalName:'DeadFrequency'},appCopyright:'Original game, 2026'});
  for(const outputPath of paths){
    within(outputPath,output);
    await fs.writeFile(path.join(outputPath,'update-manifest.json'),JSON.stringify({schema:1,application:'DEAD FREQUENCY',version:appPackage.version,executable:'DEAD FREQUENCY.exe'},null,2));
    for(const name of ['CLOUDFLARED-LICENSE.txt','CLOUDFLARED-NOTICE.txt'])if(await fs.stat(path.join(project,name)).catch(()=>false))await fs.copyFile(path.join(project,name),path.join(outputPath,name));
    console.log(outputPath);
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
