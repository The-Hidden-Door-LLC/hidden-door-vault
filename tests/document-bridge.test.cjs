'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { BridgeServer, sendBridgeRequest } = require('../src/core/bridge.cjs');
const { MAX_BYTES, MAX_FRAME_BYTES } = require('../src/core/document-format.cjs');

test('local document bridge transfers files above old 2 MiB limit and reports capabilities', async () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hdv-doc-sock-')),socketPath=path.join(directory,'s');
  const bytes=Buffer.alloc(3*1024*1024,17);let stored;
  const metadata={id:'9a1dfe7b-417c-4b1f-8fd6-61c71710ed19',title:'Synthetic file',filename:'file.png',mediaType:'image/png',size:bytes.length,sha256:require('node:crypto').createHash('sha256').update(bytes).digest('hex'),revision:'12bdd371-32ca-41dd-bd23-0875b99bff63'};
  const vault={unlocked:true,records:new Map(),documents:{capability:()=>({supported:true,maxBytes:MAX_BYTES,maxFrameBytes:MAX_FRAME_BYTES}),list:()=>[metadata],write:async input=>{stored=input.contentBase64;return metadata;},read:async()=>({...metadata,contentBase64:stored})}};
  const bridge=new BridgeServer({socketPath,getVault:()=>vault}); await bridge.start();
  try {
    const status=await sendBridgeRequest('status',{}, {socketPath}); assert.equal(status.documents.maxBytes,MAX_BYTES);
    assert.equal(fs.statSync(socketPath).mode&0o777,0o600);
    const saved=await sendBridgeRequest('documents-write',{title:metadata.title,filename:metadata.filename,mediaType:metadata.mediaType,contentBase64:bytes.toString('base64'),autoUnlock:false},{socketPath});assert.equal(saved.id,metadata.id);
    const result=await sendBridgeRequest('documents-read',{id:saved.id,autoUnlock:false},{socketPath});assert.deepEqual(Buffer.from(result.contentBase64,'base64'),bytes);
    assert.deepEqual(await sendBridgeRequest('documents-list',{}, {socketPath}),[metadata]);
    assert.equal((await bridge.processLine('null')).ok,false);
    await assert.rejects(bridge.dispatch('documents-list',[]),error=>error.code==='invalid_document');
  } finally {await bridge.stop();fs.rmSync(directory,{recursive:true,force:true});}
});

test('oversized local request and response frames are rejected', async () => {
  await assert.rejects(sendBridgeRequest('documents-write',{contentBase64:'x'.repeat(MAX_FRAME_BYTES)},{socketPath:'/does-not-exist'}),/24 MiB/);
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hdv-doc-bound-')),socketPath=path.join(directory,'s');
  const server=net.createServer(socket=>{socket.on('error',()=>{});socket.on('data',()=>{socket.end('x'.repeat(MAX_FRAME_BYTES+1)+'\n');});});
  await new Promise(resolve=>server.listen(socketPath,resolve));
  try {await assert.rejects(sendBridgeRequest('status',{}, {socketPath,timeoutMs:10000}),/24 MiB/);}
  finally {await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});}
});

test('server closes oversized request frames without dispatch', async () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hdv-doc-input-')),socketPath=path.join(directory,'s');
  const bridge=new BridgeServer({socketPath,getVault:()=>{throw new Error('must not dispatch');}});await bridge.start();
  try {
    await new Promise((resolve,reject)=>{const socket=net.createConnection(socketPath);const timer=setTimeout(()=>{socket.destroy();reject(new Error('Input cap did not close connection'));},10000);socket.on('error',()=>{});socket.on('connect',()=>socket.end('x'.repeat(MAX_FRAME_BYTES+1)));socket.on('close',()=>{clearTimeout(timer);resolve();});});
  } finally {await bridge.stop();fs.rmSync(directory,{recursive:true,force:true});}
});

test('browser-extension Native Messaging refuses document actions before local bridge access', async () => {
  const request=Buffer.from(JSON.stringify({id:1,action:'documents-read',payload:{id:'9a1dfe7b-417c-4b1f-8fd6-61c71710ed19'}})),header=Buffer.alloc(4);header.writeUInt32LE(request.length);
  const child=spawn(process.execPath,[path.resolve('src/native-host.cjs')],{env:{...process.env,HDV_SOCKET:'/does-not-exist'},stdio:['pipe','pipe','pipe']});
  const chunks=[];child.stdout.on('data',chunk=>chunks.push(chunk));child.stderr.resume();child.stdin.end(Buffer.concat([header,request]));
  const code=await new Promise(resolve=>child.on('close',resolve));assert.equal(code,0);
  const wire=Buffer.concat(chunks),message=JSON.parse(wire.subarray(4,4+wire.readUInt32LE(0)).toString());assert.equal(message.ok,false);assert.match(message.error,/desktop socket/);
});
