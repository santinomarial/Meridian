'use strict';
// Integration check against a disposable worker. Never points at the app DB.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const url = process.env.RUNNER_URL || 'http://127.0.0.1:4400';
const token = process.env.RUNNER_TOKEN;
if (!token) throw new Error('RUNNER_TOKEN required');
const created = [];
async function api(path, method = 'GET', body, expected = 200) {
  const r = await fetch(url + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body ? {body:JSON.stringify(body)} : {}), signal: AbortSignal.timeout(30000) });
  const data = await r.json(); assert.equal(r.status, expected, JSON.stringify(data)); return data;
}
async function command(id, data, marker, timeoutMs = 20000) {
  await api(`/terminals/${id}/input`, 'POST', {data:data+'\n'});
  let output = '';
  const deadline = Date.now()+timeoutMs;
  while (Date.now()<deadline) {
    const event = await api(`/terminals/${id}`); output+=event.data;
    if (output.includes(marker)) return output;
    await new Promise(r=>setTimeout(r,100));
  }
  throw new Error('Terminal command timed out: '+output);
}
async function run() {
  assert.equal((await fetch(url+'/health')).status,401);
  const health = await api('/health'); assert.ok(['gvisor','local-development-only'].includes(health.isolation));
  const sandbox = await api('/sandboxes','POST',{userId:'audit-user',workspaceId:'audit-workspace',files:{'main.py':'print(42)\n','conflict.txt':'initial'},folders:['src']});
  created.push(sandbox.id);
  const files = (op) => api(`/sandboxes/${sandbox.id}/files`,'POST',op);
  assert.equal((await files({op:'snapshot'})).files['main.py'],'print(42)\n');
  const term = await api(`/sandboxes/${sandbox.id}/terminals`,'POST',{});
  await api(`/terminals/${term.id}/resize`,'POST',{cols:100,rows:30});
  let out=await command(term.id,'python3 main.py; printf "RUN_%s\\n" DONE','RUN_DONE'); assert.match(out,/42/);
  out=await command(term.id, `node -e 'console.log("JS_"+(6*7))'; printf 'JS_%s\\n' DONE`, 'JS_DONE'); assert.match(out,/JS_42/);
  out=await command(term.id, `npx --no-install tsx -e 'const n: number = 6*7; console.log("TS_"+n)'; printf 'TS_%s\\n' DONE`, 'TS_DONE'); assert.match(out,/TS_42/);
  await files({op:'write',path:'main.go',expected:null,content:'package main\nimport "fmt"\nfunc main(){fmt.Printf("GO_%d\\n",6*7)}\n'});
  out=await command(term.id, "go run main.go; printf 'GO_%s\\n' DONE", 'GO_DONE', 60000); assert.match(out,/GO_42/);
  out=await command(term.id,'stty size; printf "SIZE_%s\\n" DONE','SIZE_DONE'); assert.match(out,/30 100/);
  await command(term.id,"printf 'terminal' > conflict.txt; printf 'print(84)\\n' > src/new.py; printf 'FILES_%s\\n' DONE",'FILES_DONE');
  assert.equal((await files({op:'snapshot'})).files['src/new.py'],'print(84)\n');
  assert.equal((await files({op:'write',path:'conflict.txt',expected:'initial',content:'editor'})).applied,false);
  assert.equal((await files({op:'snapshot'})).files['conflict.txt'],'terminal');
  assert.equal((await files({op:'write',path:'conflict.txt',expected:'terminal',content:'saved'})).applied,true);
  assert.equal((await files({op:'rename',path:'src/new.py',to:'src/renamed.py',expected:{'src/new.py':'print(84)\n'}})).applied,true);
  assert.equal((await files({op:'snapshot'})).files['src/renamed.py'],'print(84)\n');
  await command(term.id,"ln -s /etc/passwd leak.txt; ln -s /tmp escape; printf 'LINK_%s\\n' DONE",'LINK_DONE');
  assert.equal((await files({op:'snapshot'})).files['leak.txt'],undefined);
  await api(`/sandboxes/${sandbox.id}/files`,'POST',{op:'write',path:'escape/out.txt',expected:null,content:'escape'},409);
  await api(`/sandboxes/${sandbox.id}/files`,'POST',{op:'write',path:'../out.txt',expected:null,content:'escape'},409);
  out=await command(term.id,"python3 -c 'import os,socket; print(\"uid=\",os.getuid()); print(\"secrets=\",any(k in os.environ for k in [\"RUNNER_TOKEN\",\"DATABASE_URL\",\"JWT_SECRET\"])); s=socket.socket(); s.settimeout(1); print(\"network=\",s.connect_ex((\"1.1.1.1\",443)))'; printf 'ISOLATION_%s\\n' DONE",'ISOLATION_DONE');
  assert.match(out,/uid= 1000/); assert.match(out,/secrets= False/); assert.doesNotMatch(out,/network= 0\r?\n/);
  const containers = execFileSync('docker',['ps','-q','--filter',`name=${sandbox.id}`],{encoding:'utf8'}).trim();
  const inspect=JSON.parse(execFileSync('docker',['inspect',containers],{encoding:'utf8'}))[0];
  assert.equal(inspect.HostConfig.NetworkMode,'none'); assert.equal(inspect.HostConfig.ReadonlyRootfs,true);
  assert.equal(inspect.HostConfig.Memory,1024*1024*1024); assert.equal(inspect.HostConfig.PidsLimit,128);
  assert.equal(inspect.Mounts.length,0); assert.equal(inspect.Config.User,'1000:1000');
  assert.equal(inspect.HostConfig.Runtime,health.isolation==='gvisor'?'runsc':'runc');
  assert.equal((await files({op:'delete',path:'src/renamed.py',expected:{'src/renamed.py':'print(84)\n'}})).applied,true);
  const second = await api('/sandboxes','POST',{userId:'audit-user',workspaceId:'audit-other',files:{'private.txt':'second'},folders:[]}); created.push(second.id);
  assert.equal((await api(`/sandboxes/${second.id}/files`,'POST',{op:'snapshot'})).files['conflict.txt'],undefined);
  await api('/sandboxes','POST',{userId:'audit-user',workspaceId:'third',files:{},folders:[]},429);
  await api(`/sandboxes/${sandbox.id}`,'DELETE'); created.shift();
  await api(`/terminals/${term.id}`,'GET',undefined,404);
  console.log('PASS: authenticated worker, interactive Python/JavaScript/TypeScript/Go, resize, bidirectional files, conflict checks, rename/delete, traversal/symlink rejection, no network/secrets/mounts, quotas, and cleanup.');
}
run().finally(async()=>{for(const id of created) await api(`/sandboxes/${id}`,'DELETE').catch(()=>{});}).catch(e=>{console.error(e);process.exitCode=1;});
