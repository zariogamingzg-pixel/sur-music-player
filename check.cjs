const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
class Element{
 constructor(){this.children=[];this.value='';this.dataset={};this.textContent='';this.attrs={};this.listeners={};this.classList={toggle(){}};this.paused=true;this.currentTime=0;this.duration=180;this.playbackRate=1;}
 set src(value){this.attrs.src=value;}get src(){return this.attrs.src;}
 append(...items){this.children.push(...items);}replaceChildren(...items){this.children=items;}setAttribute(k,v){this.attrs[k]=v;}getAttribute(k){return this.attrs[k];}removeAttribute(k){delete this.attrs[k];}addEventListener(k,fn,opts){(this.listeners[k]??=[]).push({fn,once:opts?.once});}
 emit(k){for(const item of this.listeners[k]||[])item.fn();this.listeners[k]=(this.listeners[k]||[]).filter(x=>!x.once);}click(){}focus(){}showModal(){}close(){this.emit('close');}load(){}async play(){this.paused=false;this.emit('play');this.emit('playing');}pause(){this.paused=true;this.emit('pause');}
}
const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};get('sort').value='title';
const stores=new Map();const request=result=>{const req={};setTimeout(()=>{req.result=result;req.onsuccess?.();},0);return req;};
const db={createObjectStore(name){stores.set(name,new Map());},transaction(names){const tx={objectStore(name){return {get:k=>request(stores.get(name).get(k)),getAll:()=>request([...stores.get(name).values()]),put(v,k){stores.get(name).set(k??v.id,structuredClone(v));},delete:k=>stores.get(name).delete(k)};}};setTimeout(()=>tx.oncomplete?.(),0);return tx;}};
const context=vm.createContext({console,setTimeout,clearTimeout,Blob,File,URL,crypto:process.env.SUR_NO_UUID ? {} : crypto,Option:class extends Element{constructor(text,value){super();this.textContent=text;this.value=value;}},document:{getElementById:get,createElement:()=>new Element(),querySelectorAll:()=>[]},navigator:{},location:{href:'https://sur.test/'},window:{},indexedDB:{open(){const req={};setTimeout(()=>{req.result=db;req.onupgradeneeded();req.onsuccess();},0);return req;}}});
const run=code=>vm.runInContext(code,context);const wait=()=>new Promise(r=>setTimeout(r,30));
(async()=>{
 run(fs.readFileSync('app.js','utf8'));
 assert.equal(run('tracks.length'),0);
 // Import must wait for startup and must not require a full ArrayBuffer read.
 // A stalled Files-provider read previously left the UI at "Saving 1 of 1".
 const phoneFile=new File(['phone audio'],'Phone.mp3',{lastModified:10});
 phoneFile.arrayBuffer=()=>{throw Error('full-file read unavailable');};
 context.phoneFile=phoneFile;
 await run('importFiles([phoneFile])');
 assert.equal(run('tracks.length'),1);
 assert.equal(await stores.get('audio').values().next().value.text(),'phone audio');
 run('removeTrack(tracks[0])');get('delete-dialog').returnValue='remove';get('delete-dialog').emit('close');await wait();
 assert.equal(run('tracks.length'),0);
 // Empty provider files fail visibly and leave controls available for retry.
 await run("importFiles([new File([], 'Empty.mp3')])");
 assert.equal(run('tracks.length'),0);assert.match(get('status').textContent,/empty/);
 assert.equal(get('import').disabled,false);
 await run(`importFiles([new File(['sample'],'Artist - Song.mp3',{lastModified:1})])`);assert.equal(run('tracks.length'),1);assert.equal(run('tracks[0].artist'),'Artist');assert.equal(run('tracks[0].title'),'Song');assert.equal(stores.get('audio').size,1);
 await run(`importFiles([new File(['sample'],'Artist - Song.mp3',{lastModified:1}),new File(['x'],'skip.txt')])`);assert.equal(run('tracks.length'),1);assert.match(get('status').textContent,/1 already/);
 await run(`importFiles([new File(['sample2'],'Another - Ballad.mp3',{lastModified:2})])`);assert.equal(run('tracks.length'),2);
 get('search').value='artist';assert.equal(run('getVisible().length'),1);get('search').value='';
 run(`tracks[0].favourite=true;view='favourites'`);assert.equal(run('getVisible().length'),1);
 run(`playlists=[{id:'p1',name:'Night',tracks:[tracks[1].id]}];view='p1'`);assert.equal(run('getVisible()[0].title'),'Ballad');
 await run(`saveSettings()`);assert.equal(stores.get('settings').get('playlists')[0].name,'Night');
 run(`view='all';setQueue(tracks.map(t=>t.id),tracks[0].id)`);await run(`playTrack(tracks[0].id)`);assert.equal(get('audio').paused,false);assert.equal(get('playing-title').textContent,'Song');
 run('next()');await wait();assert.equal(get('playing-title').textContent,'Ballad');
 run('repeat=0;next(1,true)');assert.match(get('status').textContent,/End of/);
 run('repeat=2;next(1,true)');assert.equal(get('audio').currentTime,0);
 // A pause while IndexedDB is still loading must cancel the requested song.
 run('pausePlayback()');
 const loading=run('playTrack(tracks[0].id)');
 run('pausePlayback()');await loading;
 assert.equal(get('audio').paused,true);assert.equal(run('pendingTrack'),null);
 assert.equal(get('playing-title').textContent,'Ballad');
 // The main play/pause button must also cancel a pending track load.
 const toggled=run('playTrack(tracks[0].id)');
 await run('toggle()');await toggled;assert.equal(get('audio').paused,true);
 // Only the latest selection may replace the audio source.
 await Promise.all([run('playTrack(tracks[0].id)'),run('playTrack(tracks[1].id)')]);
 assert.equal(get('playing-title').textContent,'Ballad');
 // Disabling shuffle restores the collection's original ordering.
 run('setQueue(tracks.map(t=>t.id),current)');
 const original=run('JSON.stringify(queue)');
 get('shuffle').onclick();get('shuffle').onclick();
 assert.equal(run('JSON.stringify(queue)'),original);
 // Previous before selecting a song must choose the final track.
 run('pausePlayback();current=null;queue=[];queueIndex=-1;audio.currentTime=0;next(-1)');
 await wait();assert.equal(run('current'),run('getVisible().at(-1).id'));
 // Removing a track before its audio read finishes must not resurrect it.
 await run('playTrack(tracks[1].id)');
 const savedRead=run('read');let finishRead;
 context.delayedRead=()=>new Promise(resolve=>{finishRead=resolve;});
 run('read=delayedRead');
 const removedLoad=run('playTrack(tracks[0].id)');
 const savedTracks=run('tracks');run('tracks=tracks.slice(1)');
 finishRead(new Blob(['deleted audio']));await removedLoad;
 assert.notEqual(run('current'),savedTracks[0].id);
 context.savedRead=savedRead;context.savedTracks=savedTracks;run('read=savedRead;tracks=savedTracks');
 await run('playTrack(tracks[1].id)');
 // A repeated submit during a pending save must create only one playlist.
 get('playlist-name').value='One submission';
 const before=run('playlists.length');
 await Promise.all([get('playlist-form').onsubmit({preventDefault(){}}),get('playlist-form').onsubmit({preventDefault(){}})]);
 assert.equal(run('playlists.length'),before+1);
 run('removeTrack(tracks[1])');get('delete-dialog').returnValue='remove';get('delete-dialog').emit('close');await wait();assert.equal(run('tracks.length'),1);assert.equal(stores.get('audio').size,1);assert.equal(stores.get('settings').get('playlists')[0].tracks.length,0);
 // A stalled storage transaction must abort and release the import controls.
 let aborted=false;
 context.blockedDB={transaction(){return {objectStore(){return {put(){}};},abort(){aborted=true;this.onabort?.();}};}};
 context.normalDB=run('db');context.setTimeout=fn=>setTimeout(fn,0);
 run('db=blockedDB');
 await run("importFiles([new File(['stalled'], 'Stalled.mp3')])");
 assert.equal(aborted,true);assert.match(get('status').textContent,/timed out/);
 assert.equal(get('import').disabled,false);assert.equal(run('importing'),false);
 run('db=normalDB');context.setTimeout=setTimeout;
 const manifest=JSON.parse(fs.readFileSync('manifest.webmanifest','utf8'));for(const icon of manifest.icons)assert(fs.existsSync('./'+icon.src));assert.equal(manifest.display,'standalone');
 console.log('PASS: imports during startup, imports without ArrayBuffer reads, empty-file errors, storage timeouts, ID compatibility, duplicates, filtering, metadata, search, favourites, playlists, playback queue, repeat, deletion, app assets, cancelled/overlapping track loads, shuffle restoration, initial Previous, deleted pending tracks, and duplicate playlist submissions. Browser and iPhone behaviour require device testing.');
})().catch(error=>{console.error(error);process.exitCode=1;});
