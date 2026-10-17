const assertions=[];
const $=id=>document.getElementById(id);
const check=(condition,label)=>{if(!condition)throw Error(label);assertions.push(label);};
const equal=(actual,expected,label)=>{if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);assertions.push(label);};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(condition,label){for(let i=0;i<100;i++){if(condition())return;await wait(10);}throw Error(`Timed out: ${label}`);}
function change(element,value){element.value=value;element.dispatchEvent(new Event('change',{bubbles:true}));}
function key(value,extra={}){document.activeElement?.blur();document.body.dispatchEvent(new KeyboardEvent('keydown',{key:value,bubbles:true,...extra}));}
const get=()=>Partitura.getScore();
function field(name,value){document.querySelector(`#dialogform [name="${name}"]`).value=value;}
function submit(){$('dialogform').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));}
check(!!window.Partitura,'Editor API loaded');
$('new').click();field('title','Prueba de edición');field('template','solo');field('measures','4');submit();
equal(get().title,'Prueba de edición','New score title');
equal(get().parts.length,1,'Solo template');equal(get().parts[0].measures.length,4,'New score measures');
key('c');key('d');equal(get().parts[0].measures[0].notes.map(n=>n.pitches),[[60],[62]],'Keyboard note entry');
key('r');key('e');check(get().parts[0].measures[0].notes[2].rest,'Keyboard rest entry');
equal(get().parts[0].measures[0].notes[2].pitches,[],'Rest has no pitches');
$('undo').click();equal(get().parts[0].measures[0].notes.length,2,'Undo note entry');
$('redo').click();equal(get().parts[0].measures[0].notes.length,3,'Redo note entry');
key('Escape');document.querySelector('.note-hit').dispatchEvent(new MouseEvent('click',{bubbles:true}));
key('g',{shiftKey:true});equal(get().parts[0].measures[0].notes[0].pitches,[60,67],'Shift keyboard adds chord pitch');
change($('lyric'),'Sol');change($('dynamic'),'mf');change($('articulation'),'staccato');
const first=get().parts[0].measures[0].notes[0];
equal(first.lyric,'Sol','Lyric edit');equal(first.dynamic,'mf','Dynamic edit');equal(first.articulation,'staccato','Articulation edit');
$('transpose').click();field('semitones','2');submit();
equal(get().parts[0].measures[0].notes[0].pitches,[62,69],'Transpose complete chord');
$('undo').click();equal(get().parts[0].measures[0].notes[0].pitches,[60,67],'Undo transposition');
$('copy').click();document.querySelector('.measure-hit[data-measure="1"]').dispatchEvent(new MouseEvent('click',{bubbles:true}));$('paste').click();
equal(get().parts[0].measures[1].notes.length,1,'Paste into empty measure');
equal(get().parts[0].measures[1].notes[0].pitches,[60,67],'Paste preserves chord');
check(get().parts[0].measures[1].notes[0].id!==first.id,'Paste creates new note identity');
$('play').click();await until(()=>$('play').textContent.includes('Detener'),'playback begins');check($('play').textContent.includes('Detener'),'Playback starts');
$('stop').click();check($('play').textContent.includes('Reproducir'),'Playback stops');
async function exportFile(button,suffix){const before=__nativeMessages.length;$(button).click();await until(()=>__nativeMessages.slice(before).some(m=>m.action==='save'&&m.name.endsWith(suffix)),`${button} native bridge`);const message=__nativeMessages.slice(before).find(m=>m.action==='save'&&m.name.endsWith(suffix));check(message.action==='save'&&message.name.endsWith(suffix),`${button} native save bridge`);return {message,bytes:Uint8Array.from(atob(message.data),c=>c.charCodeAt(0))};}
const xml=await exportFile('xml','.musicxml');check(new TextDecoder().decode(xml.bytes).includes('<score-partwise'),'MusicXML content');
const midi=await exportFile('midi','.mid');equal(String.fromCharCode(...midi.bytes.subarray(0,4)),'MThd','MIDI header');
const saved=await exportFile('save','.rickmusic');equal(JSON.parse(new TextDecoder().decode(saved.bytes)).title,'Prueba de edición','Saved document content');
const beforeReopen=get();await Partitura.openFile(saved.message.name,saved.message.data);equal(get(),beforeReopen,'Reopen saved score without data loss');
$('new').click();field('title','Barítono y conjunto');field('template','baritone-piano');field('measures','4');submit();
equal(get().parts.length,3,'Baritone and piano template has three staves');
equal(get().parts[0].name,'Barítono (voz)','Baritone voice included');
equal(get().parts[0].clef,'bass','Baritone uses bass clef');
equal(get().parts[0].program,52,'Baritone uses native choir program');
key('c');equal(get().parts[0].measures[0].notes[0].pitches,[48],'Baritone default octave enters C3');
$('addpart').click();const allOptions=[...document.querySelector('[name="instrument"]').options];
equal(allOptions.filter(o=>o.value.startsWith('gm-')).length,128,'All 128 General MIDI programs available');
const search=$('instrument-search');search.value='baritono';search.dispatchEvent(new Event('input'));
check([...document.querySelector('[name="instrument"]').options].some(o=>o.value==='voice-baritone'),'Accent-insensitive baritone search');
$('dialog').close();$('addpart').click();field('instrument','drum-kit');submit();
equal(get().parts.at(-1).percussion,true,'Drum kit can be added');
equal(get().parts.at(-1).clef,'percussion','Percussion clef renders');
check(!!$('drum-sound'),'Percussion sound selector appears');
document.querySelector('#piano button.primary').click();equal(get().parts.at(-1).measures[0].notes[0].pitches,[36],'Drum pad inserts bass drum');
const drumXml=await exportFile('xml','.musicxml');check(new TextDecoder().decode(drumXml.bytes).includes('<unpitched>'),'Percussion exports unpitched MusicXML');
const drumMidi=await exportFile('midi','.mid');check(drumMidi.bytes.length>100,'Ensemble MIDI export');
await Partitura.openFile(drumXml.message.name,drumXml.message.data);
check(get().parts.some(p=>p.percussion&&p.measures[0].notes[0].pitches[0]===36),'Percussion XML reimport preserves drum sound');
const tied=get();tied.parts=tied.parts.slice(0,1);tied.parts[0].percussion=false;tied.parts[0].clef='bass';tied.parts[0].program=52;tied.parts[0].measures=Array.from({length:8},(_,i)=>({notes:[{id:'tie-test-'+i,pitches:[48],duration:4,rest:false,dots:0,lyric:'',chord:'',dynamic:'',articulation:'',tie:i===3}]}));Partitura.setScore(tied);check(document.querySelectorAll('.system').length===2,'Tied note test spans two systems');
// The palette is complete, and its dialogs must affect rendered notation.
equal(document.querySelectorAll('[data-finale-tool]').length,36,'All 36 tool icons present');
const tool=id=>document.querySelector(`[data-finale-tool="${id}"]`).click();
const selectFirst=()=>document.querySelector('.note-hit[data-layer="1"]').dispatchEvent(new MouseEvent('click',{bubbles:true}));
selectFirst();tool('special-tools');field('stem','down');field('head','diamond');field('offsetX','5');field('dots','0');submit();
equal(get().parts[0].measures[0].notes[0].notehead,'diamond','Special tool changes notehead');
equal(get().parts[0].measures[0].notes[0].stemDirection,'down','Special tool changes stem');
tool('articulation');field('articulation','detached-legato');submit();equal(get().parts[0].measures[0].notes[0].articulation,'detached-legato','Portato renders without unsupported glyph errors');
tool('midi');field('velocity','42');field('timing','.25');submit();equal(get().parts[0].measures[0].notes[0].velocity,42,'MIDI tool edits velocity');
tool('smart-shape');field('type','crescendo');submit();check(!!document.querySelector('[data-smart-shape]'),'Smart shape is actually drawn');
tool('text');field('text','Cantabile');field('x','120');field('y','190');submit();check(document.querySelector('.score-text')?.textContent==='Cantabile','Text tool draws page text');
tool('measure');field('barline','double');field('repeatEnd','yes');field('times','3');submit();check(get().parts[0].measures[0].repeatEnd,'Repeat tool edits selected measure');
tool('page-layout');field('perLine','2');field('staffGap','145');field('pageScale','90');submit();equal(document.querySelectorAll('.system').length,4,'Layout changes actual system count');
tool('graphics');submit();await until(()=>__nativeMessages.some(m=>m.name?.endsWith('.svg')),'SVG export');check(__nativeMessages.some(m=>m.name?.endsWith('.svg')),'Graphics tool exports SVG');
// Independent layers and tuplets are entered, engraved and sent simultaneously.
$('new').click();field('template','solo');field('measures','2');submit();key('4');$('tuplet').click();key('c');key('d');key('e');$('tuplet').click();
equal(get().parts[0].measures[0].notes.map(n=>n.duration),[1/3,1/3,1/3],'Triplet input uses actual third-beat durations');
equal(new Set(get().parts[0].measures[0].notes.map(n=>n.tuplet.group)).size,1,'Triplet input shares one bracket group');
document.querySelector('[data-layer="2"]').click();key('1');key('c');equal(get().parts[0].measures[0].notes.at(-1).layer,2,'Second layer entered in same measure');
$('play').click();await until(()=>__nativeMessages.some(m=>m.action==='play'&&m.parts?.[0]?.notes.length===4),'Layer playback');const poly=__nativeMessages.filter(m=>m.action==='play').at(-1).parts[0].notes;equal(poly.filter(n=>n.at===0).length,2,'Two layers begin at same audio time');$('stop').click();
const polyXml=await exportFile('xml','.musicxml');check(new TextDecoder().decode(polyXml.bytes).includes('<backup>'),'Layer export contains MusicXML backup');
await Partitura.openFile(polyXml.message.name,polyXml.message.data);check(get().parts[0].measures[0].notes.some(n=>n.layer===2),'Reimport preserves layer two');
// HyperScribe accepts live MIDI bridge callbacks and creates editable notes.
tool('hyperscribe');field('grid','.25');submit();Partitura.midiEvent({type:'on',pitch:60,velocity:91,timestamp:100,source:'test'});Partitura.midiEvent({type:'off',pitch:60,velocity:0,timestamp:100.5,source:'test'});$('record-stop').click();check(get().parts[0].measures[0].notes.some(n=>n.pitches.includes(60)),'MIDI recording produces editable notation');
// Mouse drag changes pitch; arrows remain available for chromatic edits.
key('Escape');document.querySelector('[data-layer="1"]').click();const dragHit=document.querySelector('.note-hit[data-layer="1"]'),box=dragHit.getBoundingClientRect(),oldPitch=get().parts[0].measures[0].notes[0].pitches[0],dragX=box.left+box.width/2,dragY=box.top+box.height/2;
dragHit.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:77,button:0,clientX:dragX,clientY:dragY}));window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:77,clientX:dragX,clientY:dragY-8}));window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:77,clientX:dragX,clientY:dragY-8}));equal(get().parts[0].measures[0].notes[0].pitches[0],oldPitch+4,'Dragging at 80 percent zoom maps two staff steps to a third');await wait(220);$('undo').click();equal(get().parts[0].measures[0].notes[0].pitches[0],oldPitch,'One undo restores the dragged note');
const moveFixture=get();moveFixture.parts=moveFixture.parts.slice(0,1);moveFixture.parts[0].measures=[{notes:[{...moveFixture.parts[0].measures[0].notes[0],id:'move-c',pitches:[60],duration:1,dots:0,layer:1,tie:false},{...moveFixture.parts[0].measures[0].notes[0],id:'move-e',pitches:[64],duration:1,dots:0,layer:1,tie:false}]},{notes:[]}];Partitura.setScore(moveFixture);
function dragNoteTo(hit,x,y,pointerId){const b=hit.getBoundingClientRect(),sx=b.left+b.width/2,sy=b.top+b.height/2;hit.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId,button:0,clientX:sx,clientY:sy}));window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId,clientX:x,clientY:y}));window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId,clientX:x,clientY:y}));}
let moveHit=document.querySelector('[data-note="move-c"]'),otherBox=document.querySelector('[data-note="move-e"]').getBoundingClientRect(),moveBox=moveHit.getBoundingClientRect();dragNoteTo(moveHit,otherBox.right+10,moveBox.top+moveBox.height/2,78);equal(get().parts[0].measures[0].notes.map(n=>n.pitches[0]),[64,60],'Horizontal drag reorders notes in the same layer');await wait(220);$('undo').click();moveHit=document.querySelector('[data-note="move-c"]');moveBox=moveHit.getBoundingClientRect();const targetBox=document.querySelector('.measure-hit[data-measure="1"]').getBoundingClientRect();dragNoteTo(moveHit,targetBox.left+targetBox.width/2,moveBox.top+moveBox.height/2,79);equal(get().parts[0].measures[1].notes[0].pitches,[60],'Drag moves a note to an empty measure');equal(get().parts[0].measures[0].notes.length,1,'Moving a note removes it from its original measure');await wait(220);$('undo').click();
// Native MP3 uses the performed score and consumes streamed PCM without live playback.
const beforeMp3=__nativeMessages.length;$('mp3').click();field('bitrate','192');submit();await until(()=>__nativeMessages.slice(beforeMp3).some(m=>m.action==='renderAudio'),'native MP3 render request');const request=__nativeMessages.slice(beforeMp3).find(m=>m.action==='renderAudio');check(request.parts[0].notes.length>0,'MP3 receives audible performed notes');check(request.duration>0,'MP3 receives score duration');
Partitura.audioExportBegin({jobId:request.jobId,sampleRate:44100,channels:2,frames:44100});const pcm=new Uint8Array(44100*2),view=new DataView(pcm.buffer);for(let i=0;i<44100;i++)view.setInt16(i*2,Math.round(Math.sin(i*2*Math.PI*440/44100)*10000),true);let binary='';for(let i=0;i<pcm.length;i+=32768)binary+=String.fromCharCode(...pcm.subarray(i,i+32768));const block=btoa(binary);Partitura.audioExportChunk({jobId:request.jobId,left:block,right:block,progress:1});Partitura.audioExportEnd({jobId:request.jobId});await until(()=>__nativeMessages.slice(beforeMp3).some(m=>m.action==='save'&&m.name.endsWith('.mp3')),'MP3 native save');const mp3=__nativeMessages.slice(beforeMp3).find(m=>m.name?.endsWith('.mp3'));equal(atob(mp3.data).slice(0,3),'ID3','MP3 export contains real encoded audio and ID3 metadata');check(atob(mp3.data).length>20000,'MP3 audio has encoded frames');check(!$('mp3').disabled,'MP3 export releases its button');
$('mp3').click();submit();await until(()=>__nativeMessages.some(m=>m.action==='renderAudio'&&m.jobId!==request.jobId),'second MP3 request');const cancelJob=__nativeMessages.filter(m=>m.action==='renderAudio').at(-1);$('cancel-mp3').click();await until(()=>__nativeMessages.some(m=>m.action==='cancelAudioExport'&&m.jobId===cancelJob.jobId),'native export cancellation');Partitura.audioExportEnd({jobId:cancelJob.jobId});check(!$('mp3').disabled,'Cancelled MP3 can be exported again');
const musxCount=__nativeMessages.filter(m=>m.name?.endsWith('.musx')).length;$('musx').click();await wait(20);equal(__nativeMessages.filter(m=>m.name?.endsWith('.musx')).length,musxCount,'Unvalidated new MUSX export is blocked');check($('toast').textContent.includes('todavía no está validada'),'MUSX limitation explained in Spanish');
if(window.__genuineMusx){await Partitura.openFile('Cha-Cha-Cha.musx',__genuineMusx);equal(get().parts.length,6,'Genuine Finale MUSX imports six staves');equal(get().parts.flatMap(p=>p.measures.flatMap(m=>m.notes)).length,78,'Genuine MUSX imports all 78 events');const original=await exportFile('musx','.musx');equal(original.message.data,__genuineMusx,'Unchanged genuine MUSX exports byte-exact');}
if(window.__demoScore){Partitura.setScore(__demoScore);document.querySelector('[data-layer="1"]').click();$('status').textContent='Ejemplo: barítono, piano, cuatro capas y tresillos.';}
const html=Partitura.printHTML();check(html.includes('<svg'),'Print HTML includes notation');check(!html.includes('note-hit')&&!html.includes('measure-hit'),'Print HTML removes interaction overlays');
equal(__editorErrors,[],'No JavaScript, promise, or engraving errors');
return {passed:true,assertionCount:assertions.length,assertions,nativeMessages:__nativeMessages.map(m=>({action:m.action,name:m.name,bytes:atob(m.data||'').length})),svgCount:document.querySelectorAll('.system svg').length};
