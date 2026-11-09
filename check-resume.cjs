const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=__dirname;
const handlers=new Map(),categories=[];
let rejectCategory=false;
class Element {
  constructor(){this.value='';this.attrs={};this.listeners={};this.children=[];this.dataset={};this.paused=true;this.ended=false;this.currentTime=0;this.duration=180;this.playbackRate=1;this.classes=new Map();this.classList={toggle:(key,value)=>this.classes.set(key,value)};}
  set src(value){this.attrs.src=value;}get src(){return this.attrs.src;}
  setAttribute(key,value){this.attrs[key]=value;}getAttribute(key){return this.attrs[key];}removeAttribute(key){delete this.attrs[key];}
  addEventListener(key,fn){(this.listeners[key]??=[]).push(fn);}emit(key){for(const fn of this.listeners[key]||[])fn();}
  append(...values){this.children.push(...values);}replaceChildren(...values){this.children=values;}load(){}click(){}focus(){}
  pause(){this.paused=true;this.emit('pause');}
  async play(){this.paused=false;this.emit('play');this.emit('playing');}
}
const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};get('sort').value='title';
const nav={mediaSession:{playbackState:'none',setActionHandler:(name,fn)=>handlers.set(name,fn),setPositionState(state){this.position=state;}},audioSession:{get type(){return categories.at(-1)||'auto';},set type(value){if(rejectCategory)throw Error('unsupported');categories.push(value);}}};
const context=vm.createContext({console,Blob,URL,crypto,navigator:nav,window:{},location:{href:'https://sur.test/'},document:{getElementById:get,createElement:()=>new Element(),querySelectorAll:()=>[]},Option:class{},indexedDB:{open(){return {};}}});
const run=code=>vm.runInContext(code,context);
vm.runInContext(fs.readFileSync(root+'/app.js','utf8'),context);
(async()=>{
  run(`current='song-one'; audio.src='blob:existing-song'; audio.currentTime=42;`);
  assert.equal(await handlers.get('play')(),true);
  assert.equal(get('audio').paused,false);assert.equal(nav.mediaSession.playbackState,'playing');
  assert.equal(get('play').attrs['aria-label'],'Pause');assert.equal(get('record').classes.get('is-playing'),true);
  assert.deepEqual(categories.slice(-2),['auto','playback']);
  handlers.get('pause')();assert.equal(nav.mediaSession.playbackState,'paused');assert.equal(get('audio').paused,true);
  assert.equal(get('play').attrs['aria-label'],'Play');assert.equal(get('record').classes.get('is-playing'),false);
  assert.equal(await handlers.get('play')(),true);assert.equal(get('audio').currentTime,42);assert.equal(get('audio').src,'blob:existing-song');
  handlers.get('pause')();await run('toggle()');assert.equal(get('audio').paused,false);await run('toggle()');assert.equal(get('audio').paused,true);
  // A play request alone must not mark the system or app as playing.
  const audio=get('audio'),normalPlay=audio.play;
  let start;
  audio.play=()=>new Promise(resolve=>start=()=>{audio.paused=false;audio.emit('playing');resolve();});
  const pending=handlers.get('play')();audio.emit('play');assert.equal(nav.mediaSession.playbackState,'paused');
  start();await pending;assert.equal(nav.mediaSession.playbackState,'playing');
  handlers.get('pause')();audio.play=()=>Promise.reject(new Error('blocked'));
  assert.equal(await handlers.get('play')(),false);assert.equal(nav.mediaSession.playbackState,'paused');assert.equal(get('play').attrs['aria-label'],'Play');
  // A later Pause must win over an earlier pending Play promise.
  audio.play=()=>new Promise((resolve,reject)=>start=reject);
  const cancelled=handlers.get('play')();handlers.get('pause')();start(new Error('late failure'));
  assert.equal(await cancelled,false);assert.equal(nav.mediaSession.playbackState,'paused');
  audio.play=normalPlay;rejectCategory=true;assert.equal(await handlers.get('play')(),true);rejectCategory=false;
  audio.emit('waiting');assert.equal(get('record').classes.get('is-playing'),false);audio.emit('playing');assert.equal(get('record').classes.get('is-playing'),true);
  audio.emit('ended');assert.equal(nav.mediaSession.playbackState,'paused');
  run('current=null; audio.removeAttribute("src");');assert.equal(await handlers.get('play')(),false);assert.equal(nav.mediaSession.playbackState,'none');
  const cacheVersion=fs.readFileSync(root+'/sw.js','utf8').match(/const CACHE = "([^"]+)"/)[1];
  assert(fs.readFileSync(root+'/app.js','utf8').includes(`caches.open("${cacheVersion}")`));
  console.log('PASS: shared app/system resume, pause, preserved source and position, event-driven state, rejected and overlapping commands, optional Audio Session API, buffering animation, end/no-track state, cache versions. Physical iPhone output remains unverified.');
})().catch(error=>{console.error(error);process.exitCode=1;});
