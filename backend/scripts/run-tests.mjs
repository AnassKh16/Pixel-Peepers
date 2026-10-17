import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFile,readdir,writeFile,mkdir,rm} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import {mergeProcessCovs} from '@bcoe/v8-coverage';
import v8ToIstanbul from 'v8-to-istanbul';
import istanbul from 'istanbul-lib-coverage';

const root=fileURLToPath(new URL('../',import.meta.url));
const output='/tmp/nascon-coverage',raw=path.join(output,'v8');
await rm(output,{recursive:true,force:true});await mkdir(raw,{recursive:true});
const env={...process.env,NODE_V8_COVERAGE:raw};
const api=spawn(process.execPath,['test-support/coverage-server.mjs'],{cwd:root,env,stdio:['ignore','inherit','inherit','ipc']});
let testStatus=1;
try {
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('Coverage API did not start within 20 seconds')),20000);
    api.once('message',message=>{clearTimeout(timeout);message.ready?resolve():reject(new Error('Coverage API did not become ready'));});
    api.once('error',error=>{clearTimeout(timeout);reject(error);});
    api.once('exit',code=>{clearTimeout(timeout);reject(new Error(`Coverage API exited before readiness: ${code}`));});
  });
  // Instrument both the HTTP-serving process and every node:test worker. Testing
  // a separate uninstrumented Compose API would undercount the exercised code.
  const tests=spawn(process.execPath,['--test','--experimental-test-coverage','--test-concurrency=1'],{cwd:root,env:{...env,RUN_INTEGRATION:'1',TEST_BASE_URL:'http://127.0.0.1:8081'},stdio:'inherit'});
  const [code]=await once(tests,'exit');testStatus=code??1;
} finally {
  if(api.exitCode===null){const exited=once(api,'exit');api.kill('SIGTERM');await exited;}
}
const areas=JSON.parse(await readFile(new URL('./coverage-areas.json',import.meta.url),'utf8'));
const wanted=new Set(Object.values(areas).flat().map(name=>pathToFileURL(path.join(root,'src',name)).href));
const profiles=[];
for(const name of await readdir(raw))if(name.endsWith('.json')){
  const profile=JSON.parse(await readFile(path.join(raw,name),'utf8'));
  profile.result=profile.result.filter(script=>wanted.has(script.url));
  profiles.push(profile);
}
const merged=mergeProcessCovs(profiles),map=istanbul.createCoverageMap({});
for(const script of merged.result)if(wanted.has(script.url)){
  const converter=v8ToIstanbul(fileURLToPath(script.url));await converter.load();converter.applyCoverage(script.functions);map.merge(converter.toIstanbul());
}
const report={};
for(const [area,files]of Object.entries(areas)){
  let covered=0,total=0;
  for(const name of files){
    const file=path.join(root,'src',name);
    if(!map.files().includes(file))throw new Error(`No measured coverage for ${file}`);
    const lines=map.fileCoverageFor(file).toSummary().lines;covered+=lines.covered;total+=lines.total;
  }
  // Empty/unimplemented areas deliberately report zero. Floor rather than round up.
  report[area]=total?Math.floor(covered*10000/total)/100:0;
  console.log(`# coverage ${area}: ${covered}/${total} measured lines (${report[area]}%)`);
}
await writeFile(path.join(output,'COVERAGE.json'),JSON.stringify(report,null,2)+'\n');
console.log('COVERAGE.json:',JSON.stringify(report));
process.exitCode=testStatus;
