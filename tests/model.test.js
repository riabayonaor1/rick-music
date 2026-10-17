import test from 'node:test';
import assert from 'node:assert/strict';
import { writeMidi, parseMidi } from 'midi-file';
import { createScore, validateScore, makeNote, noteName, beatsPerMeasure, transposeScore, toMusicXML, fromMusicXML, toMidi, fromMidi, noteLayer, writtenDuration, measureLayers, exportWarnings } from '../src/model.js';

const single = (options={}) => createScore({template:'single',measures:2,...options});
const note = (pitch,duration,extra={}) => Object.assign(makeNote(pitch,duration),extra);
const musical = score => score.parts.map(p=>p.measures.map(m=>m.notes.map(({pitches,duration,rest,tie})=>({pitches,duration,rest,tie}))));
const drums = (options={}) => {const score=single(options);Object.assign(score.parts[0],{name:'Batería',percussion:true,clef:'percussion',program:0});return score;};

test('score templates, MIDI names and meter capacity',()=>{
 const score=createScore();assert.equal(score.parts.length,2);assert.equal(score.parts[1].clef,'bass');assert.equal(score.parts[0].measures.length,8);assert.equal(noteName(60),'C4');assert.equal(noteName(0),'C-1');assert.equal(beatsPerMeasure(single({time:[6,8]})),3);
 assert.equal(createScore({template:'quartet'}).parts.length,4);
});
test('validation rejects duplicate IDs, overflow, invalid pitches and incompatible staves',()=>{
 let score=single();score.parts[0].measures[0].notes=[note(60,4),note(61,1)];assert.throws(()=>validateScore(score),/capacidad/);
 score=single();const n=note(60,1);score.parts[0].measures[0].notes=[n,{...n}];assert.throws(()=>validateScore(score),/duplicado/);
 score=single();score.parts[0].measures[0].notes=[note(128,1)];assert.throws(()=>validateScore(score),/MIDI/);
 score=createScore();score.parts[1].measures.pop();assert.throws(()=>validateScore(score),/igual número/);
 assert.throws(()=>createScore({time:[0,4]}),/compás/);assert.throws(()=>createScore({measures:50000}),/compases/);
});
test('transposition is immutable and checks instrument range',()=>{
 const score=single();score.parts[0].measures[0].notes=[note(60,1,{pitches:[60,64,67]})];const out=transposeScore(score,2);assert.deepEqual(out.parts[0].measures[0].notes[0].pitches,[62,66,69]);assert.equal(score.parts[0].measures[0].notes[0].pitches[0],60);assert.throws(()=>transposeScore(score,-80),/rango/);
});
test('percussion schema remains optional for old scores and transposition preserves drum sounds',()=>{
 assert.equal(validateScore(single()).parts[0].percussion,undefined);
 const score=drums();score.parts[0].measures[0].notes=[note(127,4)];const melodic=single().parts[0];melodic.measures[0].notes=[note(60,4)];score.parts.push(melodic);
 const transposed=transposeScore(score,2);assert.deepEqual(transposed.parts[0].measures[0].notes[0].pitches,[127]);assert.deepEqual(transposed.parts[1].measures[0].notes[0].pitches,[62]);assert.deepEqual(score.parts[1].measures[0].notes[0].pitches,[60]);
 const invalid=structuredClone(score);invalid.parts[0].percussion='true';assert.throws(()=>validateScore(invalid),/Indicador de percusión/);
 invalid.parts[0].percussion=false;assert.throws(()=>validateScore(invalid),/clave de percusión/);
 invalid.parts[0].percussion=true;invalid.parts[0].program=8;assert.throws(()=>validateScore(invalid),/kit estándar/);
});
test('MusicXML roundtrip preserves supported pitches, durations, chords, dots, lyrics, markings and ties',()=>{
 const score=single({title:'Canción < & "uno"',composer:'José',key:'Eb',time:[6,8]});score.tempo=116;
 score.parts[0].measures[0].notes=[note(60,1.5,{dots:1,pitches:[60,64,67],lyric:'lu & luz',chord:'Cm7',dynamic:'mf',articulation:'staccato'}),note(62,1.5,{dots:1,tie:true})];
 score.parts[0].measures[1].notes=[note(62,1.5,{dots:1}),note(60,1.5,{rest:true,pitches:[],dots:1})];
 const xml=toMusicXML(score);const imported=fromMusicXML(xml);
 assert.equal(imported.title,score.title);assert.equal(imported.composer,score.composer);assert.equal(imported.tempo,116);assert.equal(imported.key,'Eb');assert.deepEqual(imported.time,[6,8]);assert.deepEqual(musical(imported),musical(score));
 const n=imported.parts[0].measures[0].notes[0];assert.equal(n.dots,1);assert.equal(n.lyric,'lu & luz');assert.equal(n.chord,'Cm7');assert.equal(n.dynamic,'mf');assert.equal(n.articulation,'staccato');
});
test('MusicXML supports empty and underfilled measures by adding explicit rests',()=>{
 const score=single();score.parts[0].measures[0].notes=[note(60,1)];const imported=fromMusicXML(toMusicXML(score));assert.equal(imported.parts[0].measures[0].notes[1].duration,3);assert.equal(imported.parts[0].measures[1].notes[0].duration,4);
});
test('MusicXML percussion maps every sounding MIDI pitch to an unpitched instrument',()=>{
 const score=drums();score.parts[0].measures[0].notes=[note(36,0.5,{pitches:[36,42],dynamic:'f'}),note(38,0.5),note(60,1,{rest:true,pitches:[]}),note(49,2,{pitches:[49,51]})];score.parts[0].measures[1].notes=[note(0,4,{pitches:[0,127]})];
 const xml=toMusicXML(score);assert.match(xml,/<sign>percussion<\/sign>/);assert.equal((xml.match(/<score-instrument /g)||[]).length,7);assert.equal((xml.match(/<midi-instrument /g)||[]).length,7);assert.match(xml,/<midi-channel>10<\/midi-channel>/);assert.match(xml,/<midi-unpitched>37<\/midi-unpitched>/);assert.match(xml,/<midi-unpitched>1<\/midi-unpitched>/);assert.match(xml,/<midi-unpitched>128<\/midi-unpitched>/);assert.doesNotMatch(xml,/<pitch>/);
 assert.match(xml,/<duration>480<\/duration><instrument id="I1-drum-36"\/><type>eighth<\/type>/);
 const out=fromMusicXML(xml);assert.equal(out.parts[0].percussion,true);assert.equal(out.parts[0].clef,'percussion');assert.equal(out.parts[0].program,0);assert.equal(out.parts[0].measures[0].notes[0].dynamic,'f');assert.deepEqual(musical(out),musical(score));
 const empty=fromMusicXML(toMusicXML(drums({measures:1})));assert.equal(empty.parts[0].percussion,true);assert.equal(empty.parts[0].measures[0].notes[0].rest,true);
});
test('MusicXML percussion requires a valid unpitched mapping and never infers sound from staff position',()=>{
 const xml=(mapping,noteBody='<unpitched><display-step>G</display-step><display-octave>5</display-octave></unpitched>',reference='<instrument id="hat"/>')=>`<score-partwise><part-list><score-part id="P1"><part-name>Hi-hat</part-name><score-instrument id="hat"><instrument-name>Hi-hat</instrument-name></score-instrument><midi-instrument id="hat"><midi-channel>10</midi-channel>${mapping}</midi-instrument></score-part></part-list><part id="P1"><measure><attributes><divisions>1</divisions><clef><sign>percussion</sign></clef><staff-details><staff-lines>1</staff-lines></staff-details></attributes><note>${noteBody}<duration>4</duration>${reference}<notehead>x</notehead></note></measure></part></score-partwise>`;
 const out=fromMusicXML(xml('<midi-unpitched>43</midi-unpitched>'));assert.deepEqual(out.parts[0].measures[0].notes[0].pitches,[42]);assert.ok(out.warnings.some(w=>w.includes('cinco líneas')));
 assert.deepEqual(fromMusicXML(xml('<midi-unpitched>43</midi-unpitched>',undefined,'')).parts[0].measures[0].notes[0].pitches,[42]);
 assert.throws(()=>fromMusicXML(xml('')),/falta midi-unpitched/);assert.throws(()=>fromMusicXML(xml('<midi-unpitched>0</midi-unpitched>')),/entre 1 y 128/);
 assert.throws(()=>fromMusicXML(xml('<midi-bank>2</midi-bank><midi-unpitched>43</midi-unpitched>')),/banco de percusión/);
 assert.throws(()=>fromMusicXML(xml('<midi-unpitched>43</midi-unpitched>','<pitch><step>G</step><octave>5</octave></pitch>')),/mezclar notas con altura y percusión/);
 assert.throws(()=>fromMusicXML(xml('<midi-unpitched>43</midi-unpitched>',undefined,'<instrument id="unknown"/>')),/falta midi-unpitched.*unknown/);
});
test('MusicXML roundtrips common chord roots, qualities and slash basses',()=>{
 for(const chord of ['C','F#','Bb','Cm','C7','Dmaj7','Ebm7','Bdim7','F#m7b5','Gsus4','Asus2','Caug','Dm6','Eb9','Gm11','A13','C/E','Bbmaj7/D','F#m7/C#']) {
  const score=single({measures:1});score.parts[0].measures[0].notes=[note(60,4,{chord})];
  const xml=toMusicXML(score);assert.match(xml,/<root-step>[A-G]<\/root-step>/);assert.equal(fromMusicXML(xml).parts[0].measures[0].notes[0].chord,chord);
 }
 const score=single();score.parts[0].measures[0].notes=[note(60,4,{chord:'Cunknown'})];assert.throws(()=>toMusicXML(score),/cifrado no compatible/);
});
const grandStaff = body => `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name><midi-instrument id="I1"><midi-program>1</midi-program></midi-instrument></score-part></part-list><part id="P1">${body}</part></score-partwise>`;
const grandAttributes = '<attributes><divisions>2</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>';
const staffNote = (step,octave,duration,staff,voice,extra='') => `<note>${extra}<pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration><voice>${voice}</voice><staff>${staff}</staff></note>`;
test('MusicXML splits a piano grand staff preserving shared cursor, chords, clefs and rests',()=>{
 const xml=grandStaff(`<measure number="1">${grandAttributes}${staffNote('C',5,4,1,1)}${staffNote('E',5,4,1,1,'<chord/>')}${staffNote('G',5,4,1,1)}<backup><duration>8</duration></backup><direction><direction-type><dynamics><p/></dynamics></direction-type><staff>2</staff></direction>${staffNote('C',3,8,2,2)}</measure><measure number="2"><forward><duration>2</duration><staff>1</staff></forward>${staffNote('D',5,2,1,1)}${staffNote('E',5,4,1,1)}<backup><duration>8</duration></backup>${staffNote('G',2,8,2,2)}</measure>`);
 const score=fromMusicXML(xml);assert.equal(score.parts.length,2);assert.deepEqual(score.parts.map(p=>p.clef),['treble','bass']);assert.deepEqual(score.parts.map(p=>p.name),['Piano · 1','Piano · 2']);
 assert.deepEqual(score.parts[0].measures[0].notes.map(n=>[n.pitches,n.duration]),[[[72,76],2],[[79],2]]);assert.equal(score.parts[1].measures[0].notes[0].dynamic,'p');
 assert.deepEqual(score.parts[0].measures[1].notes.map(n=>[n.pitches,n.duration,n.rest]),[[[],1,true],[[74],1,false],[[76],2,false]]);assert.deepEqual(score.parts[1].measures[1].notes[0].pitches,[43]);
 assert.ok(score.warnings.some(w=>w.includes('2 pentagramas editables')));assert.deepEqual(musical(fromMusicXML(toMusicXML(score))),musical(score));
});
test('MusicXML grand staff rejects overlap within a voice and preserves independent voices',()=>{
 const overlap=voice=>grandStaff(`<measure number="1">${grandAttributes}${staffNote('C',5,4,1,1)}<backup><duration>2</duration></backup>${staffNote('E',5,2,1,voice)}<backup><duration>4</duration></backup>${staffNote('C',3,8,2,2)}</measure>`);
 assert.throws(()=>fromMusicXML(overlap(1)),/superpuestas/);const out=fromMusicXML(overlap(2));assert.deepEqual(out.parts[0].measures[0].notes.map(n=>[n.pitches,n.duration,noteLayer(n)]),[[[72],2,1],[[],1,2],[[76],1,2]]);
});
test('MusicXML grand staff keeps directions and harmonies after a gap on the following note',()=>{
 const score=fromMusicXML(grandStaff(`<measure number="1">${grandAttributes}<forward><duration>2</duration></forward><direction><direction-type><dynamics><f/></dynamics></direction-type><staff>1</staff></direction><harmony><root><root-step>F</root-step><root-alter>1</root-alter></root><kind>minor-seventh</kind><staff>1</staff></harmony>${staffNote('C',5,6,1,1)}<backup><duration>8</duration></backup>${staffNote('C',3,8,2,2)}</measure>`));
 const notes=score.parts[0].measures[0].notes;assert.equal(notes[0].rest,true);assert.equal(notes[0].dynamic,'');assert.equal(notes[0].chord,'');assert.equal(notes[1].dynamic,'f');assert.equal(notes[1].chord,'F#m7');
});
test('MusicXML grand staff refuses an indication inside a sustained note instead of moving it',()=>{
 const xml=grandStaff(`<measure number="1">${grandAttributes}${staffNote('C',5,8,1,1)}<backup><duration>6</duration></backup><direction><direction-type><dynamics><f/></dynamics></direction-type><staff>1</staff></direction><backup><duration>2</duration></backup>${staffNote('C',3,8,2,2)}</measure>`);
 assert.throws(()=>fromMusicXML(xml),/indicación dentro de una nota sostenida/);
});
test('MusicXML accepts independent voices and refuses unsupported endings, invalid tuplets and overfull input',()=>{
 const base=(body)=>`<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes>${body}</measure></part></score-partwise>`;
 const n=(voice,duration=1)=>`<note><pitch><step>C</step><octave>4</octave></pitch><duration>${duration}</duration><voice>${voice}</voice></note>`;
 const voices=fromMusicXML(base(n(1)+n(2)));assert.deepEqual(voices.parts[0].measures[0].notes.filter(n=>!n.rest).map(noteLayer),[1,2]);
 assert.throws(()=>fromMusicXML(base('<barline><ending number="1" type="start"/></barline>')),/casillas/);
 assert.throws(()=>fromMusicXML(base('<note><rest/><duration>1</duration><time-modification><actual-notes>3</actual-notes></time-modification></note>')),/time-modification/);
 assert.throws(()=>fromMusicXML(base(n(1,5))),/capacidad/);
 assert.throws(()=>fromMusicXML('<garbage/>'),/score-partwise/);
});
test('MIDI roundtrip preserves pitch/chord/rest timing and instrument metadata',()=>{
 const score=single({title:'Test',key:'G'});score.tempo=120;score.parts[0].program=40;
 score.parts[0].measures[0].notes=[note(60,1,{pitches:[60,64,67]}),note(60,1,{rest:true,pitches:[]}),note(67,2)];score.parts[0].measures[1].notes=[note(72,4)];
 const bytes=toMidi(score);assert.ok(bytes instanceof Uint8Array);assert.equal(String.fromCharCode(...bytes.slice(0,4)),'MThd');assert.ok(bytes.warnings.length);
 const out=fromMidi(bytes);assert.equal(out.title,'Test');assert.equal(out.tempo,120);assert.equal(out.key,'G');assert.equal(out.parts[0].program,40);assert.deepEqual(musical(out),musical(score));assert.ok(out.warnings.length);
});
test('MIDI exports tied notes as one sustained event and imports ties over barlines',()=>{
 const score=single();score.parts[0].measures[0].notes=[note(60,4,{tie:true})];score.parts[0].measures[1].notes=[note(60,4)];
 const bytes=toMidi(score);const parsed=parseMidi(bytes);assert.equal(parsed.tracks.flat().filter(e=>e.type==='noteOn').length,1);assert.deepEqual(musical(fromMidi(bytes)),musical(score));
});
test('MIDI percussion roundtrip uses GM channel 10 and retains actual hit pitches',()=>{
 const score=drums({measures:1,title:'Drums'});score.parts[0].measures[0].notes=[note(36,1,{pitches:[36,42]}),note(38,1),note(42,2)];
 const bytes=toMidi(score),events=parseMidi(bytes).tracks[1];assert.ok(events.filter(e=>['noteOn','noteOff','programChange','controller'].includes(e.type)).every(e=>e.channel===9));assert.equal(events.find(e=>e.type==='programChange').programNumber,0);
 const out=fromMidi(bytes);assert.equal(out.parts[0].percussion,true);assert.equal(out.parts[0].clef,'percussion');assert.equal(out.parts[0].program,0);assert.deepEqual(musical(out),musical(score));
});
test('all 128 General MIDI melodic programs roundtrip without numbering offsets',()=>{
 for(let program=0;program<128;program++) {
  const score=single({measures:1});score.parts[0].program=program;score.parts[0].measures[0].notes=[note(60,4)];
  assert.equal(fromMusicXML(toMusicXML(score)).parts[0].program,program);assert.equal(fromMidi(toMidi(score)).parts[0].program,program);
 }
});
test('MIDI allocates all 15 melodic channels around a simultaneous percussion part',()=>{
 const score=single({measures:1});score.parts=[];
 for(let i=0;i<15;i++){const part=single({measures:1}).parts[0];part.program=i;part.measures[0].notes=[note(60+i,4)];score.parts.push(part);}
 const percussionPart=drums({measures:1}).parts[0];percussionPart.measures[0].notes=[note(36,4)];score.parts.splice(4,0,percussionPart);
 const parsed=parseMidi(toMidi(score));const channels=parsed.tracks.slice(1).map(t=>t.find(e=>e.type==='noteOn').channel);assert.equal(channels[4],9);assert.deepEqual(channels.filter((_,i)=>i!==4),[0,1,2,3,4,5,6,7,8,10,11,12,13,14,15]);
 const out=fromMidi(toMidi(score));assert.equal(out.parts.filter(p=>p.percussion).length,1);assert.deepEqual(musical(out),musical(score));
 score.parts.push(drums({measures:1}).parts[0]);assert.throws(()=>toMidi(score),/un solo pentagrama/);score.parts.pop();score.parts.push(single({measures:1}).parts[0]);assert.throws(()=>toMidi(score),/15 instrumentos melódicos/);
});
test('MIDI percussion rejects nonstandard kits and banks instead of changing their sound',()=>{
 const raw=events=>new Uint8Array(writeMidi({header:{format:0,ticksPerBeat:480},tracks:[[...events,{deltaTime:0,type:'noteOn',channel:9,noteNumber:36,velocity:80},{deltaTime:480,type:'noteOff',channel:9,noteNumber:36,velocity:0},{deltaTime:0,type:'endOfTrack'}]]}));
 assert.throws(()=>fromMidi(raw([{deltaTime:0,type:'programChange',channel:9,programNumber:8}])),/kit estándar/);assert.throws(()=>fromMidi(raw([{deltaTime:0,type:'controller',channel:9,controllerType:0,value:1}])),/banco de percusión/);
});
test('MIDI imports independent overlapping voices and rejects tempo changes',()=>{
 const raw=(track)=>new Uint8Array(writeMidi({header:{format:0,ticksPerBeat:480},tracks:[track]}));
 const poly=fromMidi(raw([{deltaTime:0,type:'noteOn',channel:0,noteNumber:60,velocity:80},{deltaTime:240,type:'noteOn',channel:0,noteNumber:64,velocity:80},{deltaTime:240,type:'noteOff',channel:0,noteNumber:60,velocity:0},{deltaTime:240,type:'noteOff',channel:0,noteNumber:64,velocity:0},{deltaTime:0,type:'endOfTrack'}]));assert.deepEqual(poly.parts[0].measures[0].notes.map(n=>[n.pitches,n.duration,noteLayer(n)]),[[[60],1,1],[[],0.5,2],[[64],1,2]]);
 assert.throws(()=>fromMidi(raw([{deltaTime:0,type:'setTempo',microsecondsPerBeat:500000},{deltaTime:0,type:'noteOn',channel:0,noteNumber:60,velocity:80},{deltaTime:480,type:'setTempo',microsecondsPerBeat:600000},{deltaTime:480,type:'noteOff',channel:0,noteNumber:60,velocity:0},{deltaTime:0,type:'endOfTrack'}])),/cambios de tempo/);
});

test('four layers have independent capacity and invalid fifth layers are refused',()=>{
 const score=single({measures:1});const m=score.parts[0].measures[0];m.notes=[1,2,3,4].map(layer=>note(60+layer,4,{layer}));
 assert.equal(validateScore(score).parts[0].measures[0].notes.length,4);assert.equal(measureLayers(m).length,4);assert.equal(noteLayer(makeNote()),1);
 m.notes.push(note(70,1,{layer:2}));assert.throws(()=>validateScore(score),/capacidad/);m.notes.pop();m.notes[0].layer=5;assert.throws(()=>validateScore(score),/Capa/);
});
test('MusicXML roundtrip preserves four voices and per-layer crossbar ties',()=>{
 const score=single();for(const m of score.parts[0].measures)m.notes=[1,2,3,4].map(layer=>note(60+layer,4,{layer}));score.parts[0].measures[0].notes[1].tie=true;
 const xml=toMusicXML(score);assert.equal((xml.match(/<backup>/g)||[]).length,6);assert.match(xml,/<voice>4<\/voice>/);
 const out=fromMusicXML(xml);assert.deepEqual(out.parts[0].measures.map(m=>m.notes.map(n=>[n.pitches,n.duration,noteLayer(n),n.tie])),score.parts[0].measures.map(m=>m.notes.map(n=>[n.pitches,n.duration,noteLayer(n),n.tie])));
});
test('MusicXML triplets retain written type, actual timing, dots and bracket groups',()=>{
 const score=single({measures:1});const m=score.parts[0].measures[0];m.notes=[60,62,64].map(p=>note(p,1/3,{tuplet:{actual:3,normal:2,group:'triplet'}}));m.notes.push(note(67,2,{dots:1,layer:2,tuplet:{actual:3,normal:2,group:'dotted'}}));
 assert.equal(writtenDuration(m.notes[0]),0.5);const xml=toMusicXML(score);assert.match(xml,/<duration>320<\/duration><voice>1<\/voice><type>eighth<\/type><time-modification>/);assert.match(xml,/<tuplet type="start"/);assert.match(xml,/<tuplet type="stop"/);
 const out=fromMusicXML(xml);const notes=out.parts[0].measures[0].notes.filter(n=>!n.rest);assert.deepEqual(notes.slice(0,3).map(n=>[n.duration,writtenDuration(n),n.tuplet.actual,n.tuplet.normal]),Array.from({length:3},()=>[1/3,0.5,3,2]));assert.equal(new Set(notes.slice(0,3).map(n=>n.tuplet.group)).size,1);assert.equal(notes.at(-1).dots,1);assert.equal(noteLayer(notes.at(-1)),2);
});
test('piano grand staff keeps two independent voices on each staff',()=>{
 const xml=grandStaff(`<measure>${grandAttributes}${staffNote('C',5,8,1,1)}<backup><duration>8</duration></backup>${staffNote('E',4,4,1,2)}${staffNote('G',4,4,1,2)}<backup><duration>8</duration></backup>${staffNote('C',3,8,2,5)}<backup><duration>8</duration></backup>${staffNote('G',2,8,2,6)}</measure>`);
 const out=fromMusicXML(xml);assert.deepEqual(out.parts.map(p=>p.measures[0].notes.map(n=>[n.pitches,n.duration,noteLayer(n)])),[[[[72],4,1],[[64],2,2],[[67],2,2]],[[[48],4,1],[[43],4,2]]]);
});
test('MIDI preserves independently sustained voices over barlines and exact triplet timing',()=>{
 const score=single();score.parts[0].measures[0].notes=[note(48,4,{layer:2,tie:true}),...Array.from({length:12},(_,i)=>note(72+i%3,1/3,{layer:1,tuplet:{actual:3,normal:2,group:'t'+Math.floor(i/3)}}))];score.parts[0].measures[1].notes=[note(48,4,{layer:2})];
 const bytes=toMidi(score);const parsed=parseMidi(bytes);assert.equal(parsed.header.ticksPerBeat,960);assert.equal(parsed.tracks[1].filter(e=>e.type==='noteOn'&&e.noteNumber===48).length,1);
 const out=fromMidi(bytes);const low=out.parts[0].measures.map(m=>m.notes.find(n=>n.pitches.includes(48)));assert.deepEqual(low.map(n=>[n.duration,n.tie]),[[4,true],[4,false]]);const high=out.parts[0].measures[0].notes.filter(n=>n.pitches.some(p=>p>=72));assert.equal(high.length,12);assert.ok(high.every(n=>Math.abs(n.duration-1/3)<1e-7&&n.tuplet.actual===3));
});

test('triplets, quintuplets and septuplets roundtrip through exact MusicXML and MIDI resolutions',()=>{
 for(const [actual,normal] of [[3,2],[5,4],[7,4]]) {
  const score=single({measures:1});score.parts[0].measures[0].notes=Array.from({length:actual},(_,i)=>note(60+i,normal/actual*0.5,{tuplet:{actual,normal,group:'group'}}));
  const xml=toMusicXML(score);const divisions=actual===7?6720:960;assert.ok(xml.includes(`<divisions>${divisions}</divisions>`));
  const out=fromMusicXML(xml).parts[0].measures[0].notes.filter(n=>!n.rest);assert.equal(out.length,actual);assert.ok(out.every(n=>Math.abs(n.duration-normal/actual*0.5)<1e-7&&n.tuplet.actual===actual&&Math.abs(writtenDuration(n)-0.5)<1e-7));
  const bytes=toMidi(score);assert.equal(parseMidi(bytes).header.ticksPerBeat,divisions);const midi=fromMidi(bytes).parts[0].measures[0].notes.filter(n=>!n.rest);assert.equal(midi.length,actual);assert.ok(midi.every(n=>Math.abs(n.duration-normal/actual*0.5)<1e-7&&n.tuplet.actual===actual));
 }
});
test('MusicXML keeps a lone layer4 and editable partial triplet group',()=>{
 const score=single({measures:1});score.parts[0].measures[0].notes=[note(60,1/3,{layer:4,tuplet:{actual:3,normal:2,group:'partial'}})];
 const out=fromMusicXML(toMusicXML(score)).parts[0].measures[0].notes;assert.deepEqual(out.map(n=>[n.pitches,noteLayer(n),n.duration]),[[[60],4,1/3],[[],4,1/3],[[],4,1/3],[[],4,3]]);
});

test('MusicXML roundtrips tool notation, instrument transposition and note performance',()=>{
 const score=single({measures:3});const p=score.parts[0];p.transpose=2;
 p.measures[0].repeatStart=true;p.measures[0].label='A';p.measures[0].notes=[note(62,4,{expression:'dolce & cantabile',velocity:112,timing:0.125,stemDirection:'down',notehead:'diamond'})];
 Object.assign(p.measures[1],{tempo:132,clef:'bass',barline:'double',label:'Puente',notes:[note(50,4,{stemDirection:'up',notehead:'cross',velocity:1,timing:-0.125})]});
 Object.assign(p.measures[2],{repeatEnd:true,times:3,barline:'final',notes:[note(48,4,{notehead:'triangle',velocity:127})]});
 const xml=toMusicXML(score);assert.match(xml,/<transpose><chromatic>-2<\/chromatic><\/transpose>/);assert.match(xml,/<repeat direction="backward" times="3"/);assert.match(xml,/attack="120" release="120"/);assert.match(xml,/<stem>down<\/stem><notehead>diamond<\/notehead>/);
 const out=fromMusicXML(xml),q=out.parts[0];assert.equal(q.transpose,2);assert.equal(q.clef,'treble');assert.equal(q.measures[0].repeatStart,true);assert.equal(q.measures[0].label,'A');assert.equal(q.measures[1].tempo,132);assert.equal(q.measures[1].clef,'bass');assert.equal(q.measures[1].barline,'double');assert.equal(q.measures[1].label,'Puente');assert.equal(q.measures[2].repeatEnd,true);assert.equal(q.measures[2].times,3);assert.equal(q.measures[2].barline,'final');
 for(let i=0;i<3;i++)for(const field of ['expression','velocity','timing','stemDirection','notehead'])assert.equal(q.measures[i].notes[0][field],p.measures[i].notes[0][field],`${i}:${field}`);
});
test('MusicXML local tempo changes propagate to every staff and stay at measure boundaries',()=>{
 const score=createScore({measures:2});score.parts[0].measures[1].tempo=144;const out=fromMusicXML(toMusicXML(score));assert.equal(out.tempo,100);assert.ok(out.parts.every(p=>p.measures[1].tempo===144));
 const xml=toMusicXML(single({measures:1})).replace('<note>', '<note>').replace('</note>', '</note><direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>90</per-minute></metronome></direction-type></direction>');assert.throws(()=>fromMusicXML(xml),/dentro de un compás/);
});
test('MusicXML accepts all four supported barline styles and reports visual export limits',()=>{
 for(const barline of ['single','double','final','none']){const score=single({measures:1});score.parts[0].measures[0].barline=barline;assert.equal(fromMusicXML(toMusicXML(score)).parts[0].measures[0].barline,barline);}
 const score=single({measures:1});score.layout={perLine:3};score.textBlocks=[{text:'Página',x:10,y:20}];score.parts[0].measures[0].notes=[note(60,4,{scale:0.7,offsetX:2})];const warnings=exportWarnings(score);assert.ok(warnings.some(w=>w.includes('maquetación')));assert.ok(warnings.some(w=>w.includes('desplazamientos')));assert.deepEqual(exportWarnings(single()),[]);
});
test('tool metadata validation rejects invalid repeat, performance, clef and transposition data',()=>{
 for(const [field,value] of [['times',1],['barline','fake'],['tempo',900],['clef','percussion']]){const s=single({measures:1});s.parts[0].measures[0][field]=value;assert.throws(()=>validateScore(s),undefined,field);}
 for(const [field,value] of [['velocity',128],['timing',Infinity],['stemDirection','diagonal'],['notehead','fake']]){const s=single({measures:1});s.parts[0].measures[0].notes=[note(60,4,{[field]:value})];assert.throws(()=>validateScore(s),undefined,field);}
 const s=single();s.parts[0].transpose=49;assert.throws(()=>validateScore(s),/Transposición/);
});

const timedMidiEvents = track => {let tick=0;return track.map(event=>{tick+=event.deltaTime;return {...event,tick};});};
test('MIDI exports actual repeats, local tempos, written transposition, velocity and timing',()=>{
 const score=single({measures:2});const p=score.parts[0];p.transpose=2;
 Object.assign(p.measures[0],{repeatStart:true,tempo:90,notes:[note(62,1,{velocity:112,timing:0.125})]});
 Object.assign(p.measures[1],{repeatEnd:true,times:3,tempo:120,notes:[note(66,4,{velocity:40,articulation:'staccato'})]});
 const parsed=parseMidi(toMidi(score)),events=timedMidiEvents(parsed.tracks[1]),on=events.filter(e=>e.type==='noteOn'),off=events.filter(e=>e.type==='noteOff');
 assert.deepEqual(on.map(e=>[e.noteNumber,e.velocity,e.tick]),[[60,112,120],[64,40,3840],[60,112,7800],[64,40,11520],[60,112,15480],[64,40,19200]]);
 assert.deepEqual(off.map(e=>e.tick),[1080,5376,8760,13056,16440,20736]);
 const tempos=timedMidiEvents(parsed.tracks[0]).filter(e=>e.type==='setTempo');assert.equal(tempos.length,7);assert.deepEqual(tempos.map(e=>e.tick),[0,0,3840,7680,11520,15360,19200]);
 assert.ok(toMidi(score).warnings.some(w=>w.includes('interpretación')));
});
test('MIDI imports tempo changes at barlines and preserves different simultaneous velocities',()=>{
 const raw=new Uint8Array(writeMidi({header:{format:0,ticksPerBeat:480},tracks:[[
  {deltaTime:0,type:'setTempo',microsecondsPerBeat:500000},{deltaTime:0,type:'noteOn',channel:0,noteNumber:60,velocity:30},{deltaTime:0,type:'noteOn',channel:0,noteNumber:64,velocity:110},
  {deltaTime:1920,type:'noteOff',channel:0,noteNumber:60,velocity:0},{deltaTime:0,type:'noteOff',channel:0,noteNumber:64,velocity:0},{deltaTime:0,type:'setTempo',microsecondsPerBeat:750000},
  {deltaTime:0,type:'noteOn',channel:0,noteNumber:67,velocity:95},{deltaTime:1920,type:'noteOff',channel:0,noteNumber:67,velocity:0},{deltaTime:0,type:'endOfTrack'}]]}));
 const out=fromMidi(raw);assert.equal(out.tempo,120);assert.equal(out.parts[0].measures[1].tempo,80);assert.deepEqual(out.parts[0].measures[0].notes.map(n=>[n.pitches,n.velocity,noteLayer(n)]),[[[60],30,1],[[64],110,2]]);assert.equal(out.parts[0].measures[1].notes.find(n=>!n.rest).velocity,95);
});
test('MIDI keeps a tied performance shifted once and rejects out-of-range written transposition',()=>{
 const score=single();score.parts[0].measures[0].notes=[note(60,4,{tie:true,timing:0.25,velocity:90})];score.parts[0].measures[1].notes=[note(60,4,{timing:0.25})];
 const events=timedMidiEvents(parseMidi(toMidi(score)).tracks[1]);assert.deepEqual(events.filter(e=>e.type==='noteOn').map(e=>[e.tick,e.velocity]),[[240,90]]);assert.equal(events.find(e=>e.type==='noteOff').tick,7920);assert.ok(events.at(-1).tick>=7920);
 score.parts[0].transpose=48;score.parts[0].measures[0].notes[0].pitches=[0];assert.throws(()=>toMidi(score),/transposición escrita/);
});

test('MusicXML export warns when top-level ossias or graphics require the native document',()=>{
 const score=single();score.ossias=[{measure:0}];assert.ok(exportWarnings(score).some(w=>w.includes('ossias')));delete score.ossias;score.graphics=[{svg:'<svg/>'}];assert.ok(exportWarnings(score).some(w=>w.includes('imágenes')));
});
