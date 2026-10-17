import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { parseMidi, writeMidi } from 'midi-file';

let serial = 0;
const id = () => `p${Date.now().toString(36)}-${(++serial).toString(36)}`;
const EPS = 1e-7;
const MAX_PARTS = 64, MAX_MEASURES = 2000, MAX_NOTES = 100000;
const KEYS = { C:0,G:1,D:2,A:3,E:4,B:5,'F#':6,'C#':7,F:-1,Bb:-2,Eb:-3,Ab:-4,Db:-5,Gb:-6,Cb:-7,Am:0,Em:1,Bm:2,'F#m':3,'C#m':4,'G#m':5,'D#m':6,'A#m':7,Dm:-1,Gm:-2,Cm:-3,Fm:-4,Bbm:-5,Ebm:-6,Abm:-7 };
const DYNAMICS = ['pppp','ppp','pp','p','mp','mf','f','ff','fff','ffff','fp','sf','sfp','sfz','sffz','rfz'];
const ARTICULATIONS = ['staccato','tenuto','accent','strong-accent','staccatissimo','detached-legato'];
const NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const clone = value => JSON.parse(JSON.stringify(value));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const finite = n => typeof n === 'number' && Number.isFinite(n);
const percussion = part => part.percussion === true;
const melodicChannel = index => index < 9 ? index : index + 1;
const DRUM_DISPLAY = {35:'F4',36:'F4',37:'C5',38:'C5',39:'C5',40:'C5',41:'G4',42:'G5',43:'A4',44:'G5',45:'B4',46:'G5',47:'D5',48:'E5',49:'A5',50:'F5',51:'F5',52:'A5',53:'F5',55:'A5',57:'A5',59:'F5'};
export const noteLayer = note => note.layer ?? 1;
// Written duration includes dots but excludes the tuplet's time compression.
export const writtenDuration = note => note.duration * (note.tuplet ? note.tuplet.actual / note.tuplet.normal : 1);
export const measureLayers = measure => Array.from({length:4},(_,index)=>measure.notes.filter(note=>noteLayer(note)===index+1));
export const beatsPerMeasure = score => score.time[0] * 4 / score.time[1];
export const noteName = midi => { assert(Number.isInteger(midi) && midi >= 0 && midi <= 127, 'Nota MIDI inválida'); return NAMES[midi % 12] + (Math.floor(midi / 12) - 1); };
export function makeNote(pitch = 60, duration = 1) {
  return { id:id(),pitches:[pitch],duration,rest:false,dots:0,lyric:'',chord:'',dynamic:'',articulation:'',tie:false };
}
export function createScore({title='Sin título',composer='',template='piano',measures=8,time=[4,4],key='C'}={}) {
  assert(Number.isInteger(measures) && measures > 0 && measures <= MAX_MEASURES, 'Número de compases inválido');
  const configs = template === 'piano' ? [['Piano','treble',0],['Piano · Mano izquierda','bass',0]] : template === 'quartet' ? [['Violín I','treble',40],['Violín II','treble',40],['Viola','alto',41],['Violonchelo','bass',42]] : template === 'guitar' ? [['Guitarra','treble',24]] : [['Pentagrama','treble',0]];
  return validateScore({version:1,title,composer,tempo:100,time:[...time],key,parts:configs.map(([name,clef,program]) => ({id:id(),name,clef,program,volume:0.8,muted:false,measures:Array.from({length:measures},()=>({notes:[]}))}))});
}
export function validateScore(value) {
  assert(value && typeof value === 'object' && value.version === 1, 'Formato de partitura no compatible (versión 1 requerida)');
  assert(typeof value.title === 'string' && value.title.length <= 1000 && typeof value.composer === 'string' && value.composer.length <= 1000, 'Título o compositor inválido');
  assert(finite(value.tempo) && value.tempo >= 10 && value.tempo <= 500, 'Tempo fuera de rango (10–500)');
  assert(Array.isArray(value.time) && value.time.length === 2 && Number.isInteger(value.time[0]) && value.time[0] > 0 && value.time[0] <= 32 && [1,2,4,8,16,32,64].includes(value.time[1]), 'Indicación de compás inválida');
  assert(Object.hasOwn(KEYS,value.key), 'Armadura no compatible');
  assert(Array.isArray(value.parts) && value.parts.length > 0 && value.parts.length <= MAX_PARTS, 'Número de pentagramas inválido');
  const ids = new Set(); let total = 0; const count = value.parts[0]?.measures?.length;
  const checkId = x => { assert(typeof x === 'string' && x.length > 0 && x.length < 200 && !ids.has(x), 'Identificador ausente o duplicado'); ids.add(x); };
  for (const part of value.parts) {
    checkId(part.id);
    assert(typeof part.name === 'string' && part.name.length <= 1000 && ['treble','bass','alto','percussion'].includes(part.clef), 'Pentagrama inválido');
    assert(part.percussion === undefined || typeof part.percussion === 'boolean','Indicador de percusión inválido');
    assert(percussion(part) === (part.clef === 'percussion'),'La percusión requiere clave de percusión e indicador percussion: true');
    assert(Number.isInteger(part.program) && part.program >= 0 && part.program <= 127 && finite(part.volume) && part.volume >= 0 && part.volume <= 1 && typeof part.muted === 'boolean', 'Instrumento o volumen inválido');
    assert(!percussion(part) || part.program === 0,'Percusión: solo se admite el kit estándar General MIDI (programa 0)');
    assert(part.transpose===undefined || Number.isInteger(part.transpose)&&Math.abs(part.transpose)<=48,'Transposición escrita inválida');
    assert(Array.isArray(part.measures) && part.measures.length > 0 && part.measures.length <= MAX_MEASURES && part.measures.length === count, 'Todos los pentagramas deben tener igual número de compases');
    for (const measure of part.measures) {
      assert(measure && Array.isArray(measure.notes), 'Compás inválido'); const durations = [0,0,0,0];
      for(const flag of ['repeatStart','repeatEnd'])assert(measure[flag]===undefined||typeof measure[flag]==='boolean','Repetición inválida');
      assert(measure.times===undefined||Number.isInteger(measure.times)&&measure.times>=2&&measure.times<=16,'Número de repeticiones inválido');
      assert(measure.barline===undefined||['single','double','final','none'].includes(measure.barline),'Barra de compás inválida');
      assert(measure.label===undefined||typeof measure.label==='string'&&measure.label.length<=100,'Etiqueta de compás inválida');
      assert(measure.tempo===undefined||finite(measure.tempo)&&measure.tempo>=10&&measure.tempo<=500,'Tempo de compás inválido');
      assert(measure.clef===undefined||['treble','bass','alto','percussion'].includes(measure.clef)&&percussion(part)===(measure.clef==='percussion'),'Cambio de clave inválido');
      for (const note of measure.notes) {
        assert(++total <= MAX_NOTES, 'La partitura supera 100.000 eventos'); checkId(note.id);
        assert(typeof note.rest === 'boolean' && Array.isArray(note.pitches) && (note.rest ? note.pitches.length === 0 : note.pitches.length >= 1 && note.pitches.length <= 32), 'Alturas de nota inválidas');
        assert(note.pitches.every(p=>Number.isInteger(p) && p >= 0 && p <= 127) && new Set(note.pitches).size === note.pitches.length, 'Altura MIDI inválida o duplicada');
        assert(finite(note.duration) && note.duration > 0 && note.duration <= 128, 'Duración de nota inválida');
        assert(Number.isInteger(note.dots) && note.dots >= 0 && note.dots <= 3, 'Puntillos inválidos');
        for (const k of ['lyric','chord','dynamic','articulation']) assert(typeof note[k] === 'string' && note[k].length <= 1000, `Campo ${k} inválido`);
        assert(typeof note.tie === 'boolean' && (!note.rest || !note.tie), 'Ligadura inválida');
        assert(!note.articulation || ARTICULATIONS.includes(note.articulation) || note.articulation === 'fermata', 'Articulación no compatible');
        assert(note.expression===undefined||typeof note.expression==='string'&&note.expression.length<=1000,'Expresión inválida');
        assert(note.velocity===undefined||Number.isInteger(note.velocity)&&note.velocity>=1&&note.velocity<=127,'Velocidad MIDI inválida');
        assert(note.timing===undefined||finite(note.timing)&&Math.abs(note.timing)<=4,'Desplazamiento MIDI inválido');
        assert(note.stemDirection===undefined||['auto','up','down'].includes(note.stemDirection),'Dirección de plica inválida');
        assert(note.notehead===undefined||['normal','cross','diamond','triangle'].includes(note.notehead),'Cabeza de nota inválida');
        assert(Number.isInteger(noteLayer(note)) && noteLayer(note)>=1 && noteLayer(note)<=4, 'Capa inválida: se admiten las capas 1–4');
        if(note.tuplet!==undefined) {
          const t=note.tuplet;
          assert(t && Number.isInteger(t.actual) && t.actual>=2 && t.actual<=32 && Number.isInteger(t.normal) && t.normal>=1 && t.normal<=32 && t.actual!==t.normal && typeof t.group==='string' && t.group.length>0 && t.group.length<200,'Grupo irregular inválido');
        }
        durations[noteLayer(note)-1] += note.duration;
      }
      for(const duration of durations) assert(duration <= beatsPerMeasure(value) + EPS, `El compás excede su capacidad de ${beatsPerMeasure(value)} pulsos en una capa`);
    }
  }
  return clone(value);
}
export function transposeScore(score, semitones) {
  const out = validateScore(score); assert(Number.isInteger(semitones) && Math.abs(semitones) <= 127, 'Intervalo de transposición inválido');
  for (const part of out.parts) if(!percussion(part)) for (const measure of part.measures) for (const note of measure.notes) note.pitches = note.pitches.map(p=>{ assert(p+semitones >= 0 && p+semitones <= 127,'La transposición excede el rango MIDI');return p+semitones; });
  return out;
}
const esc = text => String(text).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
const CHORD_KINDS = {'':'major',maj:'major',m:'minor',min:'minor','-':'minor','7':'dominant',maj7:'major-seventh',M7:'major-seventh',m7:'minor-seventh',min7:'minor-seventh',dim:'diminished','°':'diminished',dim7:'diminished-seventh',m7b5:'half-diminished','ø7':'half-diminished',aug:'augmented','+':'augmented',sus:'suspended-fourth',sus4:'suspended-fourth',sus2:'suspended-second','6':'major-sixth',m6:'minor-sixth','9':'dominant-ninth',m9:'minor-ninth',maj9:'major-ninth','11':'dominant-11th',m11:'minor-11th','13':'dominant-13th',m13:'minor-13th'};
const CHORD_SUFFIXES = {major:'',minor:'m',dominant:'7','major-seventh':'maj7','minor-seventh':'m7',diminished:'dim','diminished-seventh':'dim7','half-diminished':'m7b5',augmented:'aug','suspended-fourth':'sus4','suspended-second':'sus2','major-sixth':'6','minor-sixth':'m6','dominant-ninth':'9','minor-ninth':'m9','major-ninth':'maj9','dominant-11th':'11','minor-11th':'m11','dominant-13th':'13','minor-13th':'m13',none:''};
function harmonyXML(label) {
  const m=label.match(/^([A-G])([#b]?)([^/]*)(?:\/([A-G])([#b]?))?$/);
  assert(m && Object.hasOwn(CHORD_KINDS,m[3]),`MusicXML: cifrado no compatible: ${label}`);
  const alter=s=>s==='#'?1:s==='b'?-1:0;
  const root=`<root><root-step>${m[1]}</root-step>${m[2]?`<root-alter>${alter(m[2])}</root-alter>`:''}</root>`;
  const bass=m[4]?`<bass><bass-step>${m[4]}</bass-step>${m[5]?`<bass-alter>${alter(m[5])}</bass-alter>`:''}</bass>`:'';
  return `<harmony>${root}<kind>${CHORD_KINDS[m[3]]}</kind>${bass}</harmony>`;
}
const types = new Map([[16,'long'],[8,'breve'],[4,'whole'],[2,'half'],[1,'quarter'],[0.5,'eighth'],[0.25,'16th'],[0.125,'32nd'],[0.0625,'64th'],[0.03125,'128th']]);
const gcd=(a,b)=>b?gcd(b,a%b):a;
function scoreResolution(score) {
  let resolution=960;
  for(const part of score.parts)for(const measure of part.measures)for(const note of measure.notes)if(note.tuplet) {
    resolution=resolution/gcd(resolution,note.tuplet.actual)*note.tuplet.actual;
    assert(resolution<=100000000,'Demasiadas razones de grupos irregulares para exportar con una resolución exacta');
  }
  return resolution;
}
function durationXML(note,divisions) {
  const ticks = note.duration * divisions; assert(Math.abs(ticks-Math.round(ticks)) < EPS,`MusicXML: duración no representable a ${divisions} divisiones`);
  const base = writtenDuration(note) / (2 - 1 / 2 ** note.dots); let type = [...types].find(([n])=>Math.abs(n-base)<EPS)?.[1];
  assert(type || !note.dots,'MusicXML: puntillo inconsistente con la duración');
  return {duration:`<duration>${Math.round(ticks)}</duration>`,appearance:`${type?`<type>${type}</type>`:''}${'<dot/>'.repeat(note.dots)}`};
}
// Complete an editable partial group before padding with conventional rests.
// This keeps exported rests drawable when the document is opened again.
function paddingRests(notes,capacity,layer) {
  let remaining=capacity-notes.reduce((sum,n)=>sum+n.duration,0);const result=[];
  const append=(duration,dots=0,tuplet=null)=>{const n=makeNote(60,duration);Object.assign(n,{rest:true,pitches:[],layer,dots});if(tuplet)n.tuplet={...tuplet};result.push(n);remaining-=duration;};
  const last=notes.at(-1);
  if(last?.tuplet) {
    const group=[];for(let i=notes.length-1;i>=0&&notes[i].tuplet?.group===last.tuplet.group;i--)group.push(notes[i]);
    const missing=last.tuplet.actual-group.length%last.tuplet.actual;
    if(missing<last.tuplet.actual&&group.every(n=>Math.abs(n.duration-last.duration)<EPS&&n.dots===last.dots)&&remaining+EPS>=missing*last.duration)for(let i=0;i<missing;i++)append(last.duration,last.dots,last.tuplet);
  }
  const values=[];
  for(const [base] of types)for(let dots=0;dots<=3;dots++)values.push({duration:base*(2-1/2**dots),dots});
  values.sort((a,b)=>b.duration-a.duration);
  while(remaining>EPS) {
    const value=values.find(n=>n.duration<=remaining+EPS);
    if(value)append(value.duration,value.dots);
    else {append(remaining);break;}
  }
  return result;
}
export function exportWarnings(score,format='musicxml') {
  const warnings=[];
  if(['midi','mid'].includes(format.toLowerCase()))return ['MIDI exporta la interpretación, incluyendo repeticiones, tempos, transposición, velocidad y sincronización. No conserva capas escritas, letras, cifrados, indicaciones gráficas ni vínculos de edición.'];
  if(!['musicxml','xml','mxl'].includes(format.toLowerCase()))return warnings;
  if(score.ossias?.length||score.graphics?.length||score.layout||score.textBlocks?.length||score.brackets?.length||score.smartShapes?.length||score.parts.some(p=>p.ossia||p.measures.some(m=>m.mirrorOf)))warnings.push('MusicXML conserva la notación musical compatible; la maquetación personalizada, textos de página, grupos de pentagramas, formas inteligentes, imágenes, ossias y vínculos de espejo se conservan en el archivo propio de Rick Music.');
  if(score.parts.some(p=>p.measures.some(m=>m.notes.some(n=>n.scale!==undefined||n.offsetX!==undefined||n.offsetY!==undefined))))warnings.push('Los tamaños y desplazamientos manuales de notas se conservan en el archivo propio de Rick Music; MusicXML recalcula esas posiciones.');
  if(score.parts.some(p=>p.measures.some(m=>m.notes.some(n=>n.tie&&n.timing))))warnings.push('Los desplazamientos de reproducción en notas ligadas pueden interpretarse de forma diferente en otros lectores MusicXML.');
  return warnings;
}
const clefXML = clef => clef==='percussion'?'<sign>percussion</sign>':`<sign>${clef==='bass'?'F':clef==='alto'?'C':'G'}</sign><line>${clef==='bass'?4:clef==='alto'?3:2}</line>`;
const barStyles={single:'regular',double:'light-light',final:'light-heavy',none:'none'};
export function toMusicXML(input) {
  const score = validateScore(input); const capacity = beatsPerMeasure(score),divisions=scoreResolution(score);
  let melodicIndex=0;
  const drumId=(index,pitch)=>`I${index+1}-drum-${pitch}`;
  const parts = score.parts.map((part,index)=>{
    let instruments='',midi='';
    if(percussion(part)) {
      const pitches=[...new Set(part.measures.flatMap(m=>m.notes.flatMap(n=>n.pitches)))].sort((a,b)=>a-b);
      if(!pitches.length)pitches.push(36);
      for(const pitch of pitches) {
        const instrumentId=drumId(index,pitch);
        instruments+=`<score-instrument id="${instrumentId}"><instrument-name>${esc(part.name)} · GM ${pitch}</instrument-name></score-instrument>`;
        midi+=`<midi-instrument id="${instrumentId}"><midi-channel>10</midi-channel><midi-program>1</midi-program><midi-unpitched>${pitch+1}</midi-unpitched><volume>${part.volume*100}</volume></midi-instrument>`;
      }
    } else {
      const channel=melodicIndex<15?`<midi-channel>${melodicChannel(melodicIndex)+1}</midi-channel>`:'';melodicIndex++;
      instruments=`<score-instrument id="I${index+1}"><instrument-name>${esc(part.name)}</instrument-name></score-instrument>`;
      midi=`<midi-instrument id="I${index+1}">${channel}<midi-program>${part.program+1}</midi-program><volume>${part.volume*100}</volume></midi-instrument>`;
    }
    return `<score-part id="P${index+1}"><part-name>${esc(part.name)}</part-name>${instruments}${midi}</score-part>`;
  }).join('');
  const body = score.parts.map((part,pi)=>{ const previousNotes = [null,null,null,null];return `<part id="P${pi+1}">${part.measures.map((measure,mi)=>{
    let xml = `<measure number="${esc(measure.label||String(mi+1))}">`;
    if(measure.repeatStart)xml+='<barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>';
    if (!mi) xml += `<attributes><divisions>${divisions}</divisions><key><fifths>${KEYS[score.key]}</fifths><mode>${score.key.endsWith('m')?'minor':'major'}</mode></key><time><beats>${score.time[0]}</beats><beat-type>${score.time[1]}</beat-type></time><clef>${clefXML(measure.clef||part.clef)}</clef>${part.transpose?`<transpose><chromatic>${-part.transpose}</chromatic></transpose>`:''}</attributes><direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${score.tempo}</per-minute></metronome></direction-type><sound tempo="${score.tempo}"/></direction>`;
    else if(measure.clef)xml+=`<attributes><clef>${clefXML(measure.clef)}</clef></attributes>`;
    if(measure.tempo!==undefined)xml+=`<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${measure.tempo}</per-minute></metronome></direction-type><sound tempo="${measure.tempo}"/></direction>`;
    const layers=measureLayers(measure);for(let index=0;index<4;index++)if(!layers[index].length)previousNotes[index]=null;const used=layers.map((notes,index)=>({notes,layer:index+1})).filter(({notes,layer})=>notes.length || layer===1&&!measure.notes.length);
    for(const [streamIndex,{notes:originalNotes,layer}] of used.entries()) {
      const notes=[...originalNotes,...paddingRests(originalNotes,capacity,layer)];
      if(streamIndex)xml+=`<backup><duration>${Math.round(capacity*divisions)}</duration></backup>`;
      let previous=previousNotes[layer-1];
      for (const [noteIndex,note] of notes.entries()) {
      if (note.chord) xml += harmonyXML(note.chord);
      if (note.expression)xml+=`<direction><direction-type><words>${esc(note.expression)}</words></direction-type><voice>${layer}</voice></direction>`;
      if (note.dynamic) xml += `<direction><direction-type><dynamics>${DYNAMICS.includes(note.dynamic)?`<${note.dynamic}/>`:`<other-dynamics>${esc(note.dynamic)}</other-dynamics>`}</dynamics></direction-type><voice>${layer}</voice></direction>`;
      const pitches = note.rest ? [null] : note.pitches;
      pitches.forEach((pitch,index)=>{
        const stop = pitch !== null && previous?.tie && previous.pitches.includes(pitch);
        const start = pitch !== null && note.tie;
        let notation = `${stop?'<tied type="stop"/>':''}${start?'<tied type="start"/>':''}`;
        if (!index && note.articulation) notation += note.articulation==='fermata'?'<fermata/>':`<articulations><${note.articulation}/></articulations>`;
        if(!index && note.tuplet) {
          if(notes[noteIndex-1]?.tuplet?.group!==note.tuplet.group)notation+=`<tuplet type="start" number="1" bracket="yes"/>`;
          if(notes[noteIndex+1]?.tuplet?.group!==note.tuplet.group)notation+=`<tuplet type="stop" number="1"/>`;
        }
        const pitchName = pitch === null ? '' : NAMES[pitch%12];
        const display=DRUM_DISPLAY[pitch]||'C5';
        const pitchXML=pitch===null?'<rest/>':percussion(part)?`<unpitched><display-step>${display[0]}</display-step><display-octave>${display.slice(1)}</display-octave></unpitched>`:`<pitch><step>${pitchName[0]}</step>${pitchName.length>1?'<alter>1</alter>':''}<octave>${Math.floor(pitch/12)-1}</octave></pitch>`;
        const rhythm=durationXML(note,divisions);
        const performance=`${note.velocity!==undefined?` dynamics="${note.velocity/90*100}"`:''}${note.timing!==undefined?` attack="${note.timing*divisions}" release="${note.timing*divisions}"`:''}`;
        xml += `<note${performance}>${index?'<chord/>':''}${pitchXML}${rhythm.duration}${stop?'<tie type="stop"/>':''}${start?'<tie type="start"/>':''}${percussion(part)&&pitch!==null?`<instrument id="${drumId(pi,pitch)}"/>`:''}${used.length>1||layer!==1?`<voice>${layer}</voice>`:''}${rhythm.appearance}${note.tuplet?`<time-modification><actual-notes>${note.tuplet.actual}</actual-notes><normal-notes>${note.tuplet.normal}</normal-notes></time-modification>`:''}${note.stemDirection&&note.stemDirection!=='auto'?`<stem>${note.stemDirection}</stem>`:''}${note.notehead?`<notehead>${note.notehead==='cross'?'x':note.notehead}</notehead>`:''}${notation?`<notations>${notation}</notations>`:''}${!index&&note.lyric?`<lyric><text>${esc(note.lyric)}</text></lyric>`:''}</note>`;
      }); previous = note;
    }
    const remaining = capacity - notes.reduce((sum,n)=>sum+n.duration,0);
    if (remaining > EPS) { xml += `<note><rest/><duration>${Math.round(remaining*divisions)}</duration>${used.length>1||layer!==1?`<voice>${layer}</voice>`:''}</note>`;previous=null; }
    previousNotes[layer-1]=previous;
    }
    if(measure.repeatEnd||measure.barline)xml+=`<barline location="right"><bar-style>${barStyles[measure.barline]||(measure.repeatEnd?'light-heavy':'regular')}</bar-style>${measure.repeatEnd?`<repeat direction="backward" times="${measure.times??2}"/>`:''}</barline>`;
    return xml+'</measure>';
  }).join('')}</part>`; }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n<score-partwise version="4.0"><work><work-title>${esc(score.title)}</work-title></work><identification><creator type="composer">${esc(score.composer)}</creator></identification><part-list>${parts}</part-list>${body}</score-partwise>`;
}
// Preserve source ordering so directions and harmonies remain attached to the following note.
const tag = node => Object.keys(node || {}).find(k=>k!==':@' && k!=='#text');
const items = node => node?.[tag(node)] || [];
const children = (node,name) => items(node).filter(x=>tag(x)===name);
const child = (node,name) => children(node,name)[0];
const text = node => items(node).map(x=>x['#text'] ?? text(x)).join('');
const val = (node,name,fallback='') => child(node,name)?text(child(node,name)):fallback;
const attr = (node,key,fallback='') => node?.[':@']?.[`@_${key}`] ?? fallback;
function checkChildren(node, allowed, context) { for(const n of items(node)) if(tag(n) && !allowed.includes(tag(n))) throw new Error(`MusicXML: ${context} no compatible: ${tag(n)}`); }
function pitchFromXML(node) {
  const p = child(node,'pitch');assert(p,'MusicXML: notas sin altura no compatibles');
  const step = val(p,'step');const alter = Number(val(p,'alter',0)),octave = Number(val(p,'octave'));
  assert(['C','D','E','F','G','A','B'].includes(step) && Number.isInteger(alter) && Number.isInteger(octave),'MusicXML: altura microtonal o inválida');
  return (octave+1)*12+({C:0,D:2,E:4,F:5,G:7,A:9,B:11}[step])+alter;
}
// MusicXML uses one shared time cursor per part. Split a grand staff only after
// resolving that cursor, otherwise backup/forward would silently change timing.
function normalizeMultiStaff(root,warnings) {
  const xml=(name,body=[],attributes={})=>({[name]:body,...(Object.keys(attributes).length?{':@':attributes}:{})});
  const leaf=(name,value)=>xml(name,[{'#text':String(value)}]);
  const definitions=child(root,'part-list');
  for(const original of [...children(root,'part')]) {
    const measures=children(original,'measure');let staffCount=1;
    for(const measure of measures)for(const event of items(measure)) {
      if(tag(event)==='attributes')staffCount=Math.max(staffCount,Number(val(event,'staves',1)));
      if(tag(event)==='note')staffCount=Math.max(staffCount,Number(val(event,'staff',1)));
    }
    assert(Number.isInteger(staffCount)&&staffCount>=1&&staffCount<=MAX_PARTS,'MusicXML: cantidad de pentagramas inválida');
    if(staffCount===1)continue;
    const originalId=attr(original,'id'),definition=children(definitions,'score-part').find(d=>attr(d,'id')===originalId);
    assert(definition,'MusicXML: parte sin definición');
    const parts=Array.from({length:staffCount},(_,index)=>xml('part',[],{'@_id':`${originalId}-staff-${index+1}`}));
    for(const measure of measures)for(let index=0;index<staffCount;index++) {
      const result=[];
      for(const event of items(measure)) {
        const name=tag(event);if(!name)continue;
        if(name==='attributes') {
          const kept=items(event).filter(n=>{
            const t=tag(n);if(t==='staves')return false;
            if(['clef','key','time','staff-details','transpose'].includes(t)&&attr(n,'number'))return Number(attr(n,'number'))===index+1;
            if(t==='clef')return index===0;
            return true;
          }).map(n=>{if(!n[':@'])return n;const attributes={...n[':@']};delete attributes['@_number'];return {...n,':@':attributes};});
          result.push(xml('attributes',kept));
        } else if(name==='note') {
          const staff=Number(val(event,'staff',1));assert(Number.isInteger(staff)&&staff>=1&&staff<=staffCount,'MusicXML: número de pentagrama inválido');
          if(staff===index+1)result.push(xml('note',items(event).filter(n=>tag(n)!=='staff'),event[':@']||{}));
          else if(!child(event,'chord'))result.push(xml('forward',[leaf('duration',val(event,'duration'))]));
        } else if(name==='direction'||name==='harmony') {
          if(Number(val(event,'staff',1))===index+1)result.push(xml(name,items(event).filter(n=>tag(n)!=='staff'),event[':@']||{}));
        } else result.push(event);
      }
      parts[index].part.push(xml('measure',result,measure[':@']||{}));
    }
    items(root).splice(items(root).indexOf(original),1,...parts);
    const splitDefinitions=parts.map((part,index)=>xml('score-part',items(definition).map(n=>tag(n)==='part-name'?leaf('part-name',`${text(n)} · ${index+1}`):n),{'@_id':attr(part,'id')}));
    items(definitions).splice(items(definitions).indexOf(definition),1,...splitDefinitions);
    warnings.push(`La parte ${val(definition,'part-name')} se separó en ${staffCount} pentagramas editables.`);
  }
}
export function fromMusicXML(source) {
  assert(typeof source==='string' && source.length<=20_000_000,'MusicXML: archivo demasiado grande o inválido');
  assert(XMLValidator.validate(source)===true,'MusicXML: XML mal formado');
  const parsed = new XMLParser({preserveOrder:true,ignoreAttributes:false,trimValues:true,parseTagValue:false,processEntities:true}).parse(source);
  const root = parsed.find(n=>tag(n)==='score-partwise');assert(root,'Se requiere MusicXML score-partwise');
  const warnings = [];checkChildren(root,['work','movement-title','movement-number','identification','defaults','credit','part-list','part'],'estructura');if(child(root,'defaults')||child(root,'credit'))warnings.push('Créditos y formato de página originales no importados.');const score = {version:1,title:val(child(root,'work'),'work-title')||val(root,'movement-title')||'Importación MusicXML',composer:'',tempo:100,time:[4,4],key:'C',parts:[],warnings};
  const creator = children(child(root,'identification'),'creator').find(n=>attr(n,'type')==='composer');if(creator)score.composer=text(creator);
  normalizeMultiStaff(root,warnings);
  const definitions = children(child(root,'part-list'),'score-part');
  const partNodes = children(root,'part');assert(partNodes.length && partNodes.length<=MAX_PARTS,'MusicXML: número de partes no válido');
  let globalTime=null,globalKey=null,globalTempo=null;const tempoChanges=new Map();
  for(const pn of partNodes) {
    const definition=definitions.find(n=>attr(n,'id')===attr(pn,'id'));const instruments=children(definition,'midi-instrument');const instrument=instruments[0];
    const measureNodes=children(pn,'measure');assert(measureNodes.length<=MAX_MEASURES,'MusicXML: demasiados compases');
    const isPercussion=instruments.some(n=>child(n,'midi-unpitched'))||measureNodes.some(m=>items(m).some(n=>tag(n)==='note'&&child(n,'unpitched')||tag(n)==='attributes'&&children(n,'clef').some(c=>val(c,'sign')==='percussion')));
    const part={id:id(),name:val(definition,'part-name')||'Instrumento',clef:isPercussion?'percussion':'treble',program:Number(val(instrument,'midi-program',1))-1,volume:Number(val(instrument,'volume',80))/100,muted:false,measures:[]};
    if(isPercussion)part.percussion=true;
    const instrumentMap=new Map(),drumMap=new Map();
    for(const midi of instruments) {
      const instrumentId=attr(midi,'id');assert(instrumentId&&!instrumentMap.has(instrumentId),'MusicXML: identificador de instrumento MIDI ausente o duplicado');instrumentMap.set(instrumentId,midi);
      if(child(midi,'midi-unpitched')) {
        const pitch=Number(val(midi,'midi-unpitched'))-1;
        assert(Number.isInteger(pitch)&&pitch>=0&&pitch<=127,'MusicXML: midi-unpitched debe estar entre 1 y 128');drumMap.set(instrumentId,pitch);
      }
      if(isPercussion) {
        assert(Number(val(midi,'midi-bank',1))===1,'MusicXML: banco de percusión no compatible; se requiere el kit estándar General MIDI');
        assert(Number(val(midi,'midi-program',1))===1&&Math.abs(Number(val(midi,'volume',80))/100-part.volume)<EPS,'MusicXML: kits o volúmenes independientes dentro de la percusión no compatibles');
      }
    }
    const percussionPitch=event=>{
      const reference=attr(child(event,'instrument'),'id');
      const pitch=reference?drumMap.get(reference):drumMap.size===1?[...drumMap.values()][0]:undefined;
      assert(pitch!==undefined,reference?`MusicXML: falta midi-unpitched para el instrumento de percusión ${reference}`:'MusicXML: percusión sin mapa midi-unpitched inequívoco; indique instrument id en cada nota');
      const unpitched=child(event,'unpitched');checkChildren(unpitched,['display-step','display-octave'],'posición de percusión');
      const step=val(unpitched,'display-step'),octave=val(unpitched,'display-octave');
      assert(!step&&!octave||['C','D','E','F','G','A','B'].includes(step)&&octave!==''&&Number.isInteger(Number(octave)),'MusicXML: posición de percusión inválida');
      return pitch;
    };
    let divisions=1;let pendingDynamic='',pendingChord='';let localTime=null,localKey=null;const voiceMap=new Map(),tupletGroups=new Map();
    for(const [mi,mn] of measureNodes.entries()) {
      const measure={notes:[]};const label=attr(mn,'number');if(label&&label!==String(mi+1))measure.label=label;let cursor=0,previousChord=null;const layerEnds=[0,0,0,0],indications=[],starts=new Map();
      for(const event of items(mn)) {
        const name=tag(event);if(!name)continue;
        if(name==='attributes') {
          checkChildren(event,['divisions','key','time','clef','staves','staff-details','transpose'],'atributo');
          if(child(event,'divisions'))divisions=Number(val(event,'divisions'));assert(divisions>0 && Number.isFinite(divisions),'MusicXML: divisiones inválidas');
          assert(Number(val(event,'staves',1))===1,'MusicXML: varias voces/pentagramas por parte no compatibles; separe las partes');
          if(child(event,'staff-details')) {
            const details=child(event,'staff-details');checkChildren(details,['staff-lines'],'atributos de pentagrama');
            assert(isPercussion&&Number.isInteger(Number(val(details,'staff-lines')))&&Number(val(details,'staff-lines'))>=1&&Number(val(details,'staff-lines'))<=5,'MusicXML: tablatura o atributos de pentagrama no compatibles');
            warnings.push('El pentagrama de percusión se muestra con cinco líneas.');
          }
          if(child(event,'time')) {
            const t=child(event,'time');assert(children(t,'beats').length===1 && children(t,'beat-type').length===1,'MusicXML: compás compuesto no compatible');
            const meter=[Number(val(t,'beats')),Number(val(t,'beat-type'))];
            assert(!localTime || JSON.stringify(localTime)===JSON.stringify(meter),'MusicXML: cambios de métrica no compatibles');
            assert(!globalTime || JSON.stringify(globalTime)===JSON.stringify(meter),'MusicXML: métricas distintas por parte no compatibles');localTime=meter;globalTime=meter;score.time=meter;
          }
          if(child(event,'key')) {
            const k=child(event,'key');checkChildren(k,['fifths','mode'],'armadura');const fifths=Number(val(k,'fifths'));assert(['major','minor'].includes(val(k,'mode','major')),'MusicXML: modo de armadura no compatible');const minor=val(k,'mode','major')==='minor';
            const key=Object.keys(KEYS).find(k=>KEYS[k]===fifths && k.endsWith('m')===minor);assert(key,'MusicXML: armadura no compatible');
            assert(!localKey || localKey===key,'MusicXML: cambios de armadura no compatibles');assert(!globalKey || globalKey===key,'MusicXML: armaduras distintas por parte no compatibles');localKey=key;globalKey=key;score.key=key;
          }
          if(child(event,'clef')) {
            const c=child(event,'clef');checkChildren(c,['sign','line'],'clave');const signature=val(c,'sign')+val(c,'line');const clef=val(c,'sign')==='percussion'?'percussion':{G2:'treble',F4:'bass',C3:'alto'}[signature];assert(clef,'MusicXML: clave no compatible');assert(cursor<EPS,'MusicXML: cambio de clave dentro de un compás no compatible');if(mi===0)part.clef=isPercussion?'percussion':clef;else measure.clef=isPercussion?'percussion':clef;
          }
          if(child(event,'transpose')) {
            const transpose=child(event,'transpose');checkChildren(transpose,['diatonic','chromatic','octave-change'],'transposición');
            const offset=-(Number(val(transpose,'chromatic',0))+12*Number(val(transpose,'octave-change',0)));
            assert(Number.isInteger(offset)&&Math.abs(offset)<=48,'MusicXML: transposición inválida');assert(mi===0||offset===(part.transpose??0),'MusicXML: cambios de transposición dentro de una parte no compatibles');part.transpose=offset;
          }
        } else if(name==='note') {
          checkChildren(event,['pitch','unpitched','instrument','rest','duration','type','dot','chord','voice','staff','tie','notations','lyric','accidental','stem','beam','notehead','time-modification'],'elemento de nota');
          assert(['pitch','unpitched','rest'].reduce((sum,k)=>sum+children(event,k).length,0)===1,'MusicXML: se requiere exactamente una altura, unpitched o silencio por nota');
          assert(children(event,'instrument').length<=1,'MusicXML: varios instrumentos en una nota no compatibles');
          if(!child(event,'rest'))assert(isPercussion?!!child(event,'unpitched'):!!child(event,'pitch'),'MusicXML: no se pueden mezclar notas con altura y percusión en un pentagrama');
          if(!isPercussion&&child(event,'instrument')) {
            const reference=instrumentMap.get(attr(child(event,'instrument'),'id'));
            assert(reference,'MusicXML: nota con instrumento MIDI desconocido');
            assert(Number(val(reference,'midi-program',1))-1===part.program&&Math.abs(Number(val(reference,'volume',80))/100-part.volume)<EPS,'MusicXML: cambios de instrumento o volumen dentro de una parte no compatibles');
          }
          assert(!child(event,'rest') || !attr(child(event,'rest'),'measure') || attr(child(event,'rest'),'measure')==='yes','MusicXML: silencio inválido');
          const thisVoice=val(event,'voice','1');if(!voiceMap.has(thisVoice)){assert(voiceMap.size<4,'MusicXML: más de cuatro voces en un pentagrama no compatibles');const preferred=Number(thisVoice);const used=new Set(voiceMap.values());voiceMap.set(thisVoice,Number.isInteger(preferred)&&preferred>=1&&preferred<=4&&!used.has(preferred)?preferred:[1,2,3,4].find(n=>!used.has(n)));}const layer=voiceMap.get(thisVoice);assert(Number(val(event,'staff',1))===1,'MusicXML: varios pentagramas por parte no compatibles');
          const duration=Number(val(event,'duration'))/divisions;assert(finite(duration) && duration>0,'MusicXML: nota sin duración válida');
          const note=makeNote();note.rest=!!child(event,'rest');note.pitches=note.rest?[]:[isPercussion?percussionPitch(event):pitchFromXML(event)];note.duration=duration;note.layer=layer;note.dots=children(event,'dot').length;note.tie=children(event,'tie').some(t=>attr(t,'type')==='start');
          if(attr(event,'dynamics')!==''){const velocity=Math.round(Number(attr(event,'dynamics'))*90/100);if(velocity<1||velocity>127)warnings.push('La velocidad de nota se ajustó al rango MIDI editable de 1 a 127.');note.velocity=Math.max(1,Math.min(127,velocity));}
          const attack=attr(event,'attack'),release=attr(event,'release');
          if(attack!=='')note.timing=Number(attack)/divisions;
          if(release!==''&&Math.abs(Number(release)/divisions-(note.timing??0))>EPS)warnings.push('Se conserva el ataque de la nota; el desplazamiento independiente de su final no es editable en Rick Music.');
          if(child(event,'stem')){const stem=val(event,'stem');if(['up','down'].includes(stem))note.stemDirection=stem;else warnings.push(`Dirección de plica ${stem} normalizada a automática.`);}
          if(child(event,'notehead')){const head=val(event,'notehead'),mapped=head==='x'?'cross':head;assert(['normal','cross','diamond','triangle'].includes(mapped),'MusicXML: cabeza de nota no compatible');note.notehead=mapped;}
          const timeModification=child(event,'time-modification');
          if(timeModification) {
            checkChildren(timeModification,['actual-notes','normal-notes','normal-type','normal-dot'],'grupo irregular');
            const actual=Number(val(timeModification,'actual-notes')),normal=Number(val(timeModification,'normal-notes'));
            assert(Number.isInteger(actual)&&actual>=2&&actual<=32&&Number.isInteger(normal)&&normal>=1&&normal<=32&&actual!==normal,'MusicXML: time-modification requiere actual-notes y normal-notes válidos');
            const marks=children(child(event,'notations'),'tuplet');
            assert(marks.filter(mark=>attr(mark,'type')==='start').length<=1&&marks.filter(mark=>attr(mark,'type')==='stop').length<=1,'MusicXML: grupos irregulares anidados no compatibles');
            let group=tupletGroups.get(layer);
            if(!group || marks.some(mark=>attr(mark,'type')==='start'))group={id:id(),actual,normal,count:0};
            assert(group.actual===actual&&group.normal===normal,'MusicXML: razón cambiante dentro de un grupo irregular');
            note.tuplet={actual,normal,group:group.id};
            if(!child(event,'chord'))group.count++;
            if(marks.some(mark=>attr(mark,'type')==='stop') || !marks.length&&group.count>=actual)tupletGroups.delete(layer);else tupletGroups.set(layer,group);
          } else tupletGroups.delete(layer);
          const lyrics=children(event,'lyric');assert(lyrics.length<=1,'MusicXML: varias líneas de letra no compatibles');
          if(lyrics[0]) { checkChildren(lyrics[0],['text','syllabic','extend'],'letra');note.lyric=val(lyrics[0],'text');if(child(lyrics[0],'extend')||child(lyrics[0],'syllabic'))warnings.push('Se importó el texto de letra sin guiones ni extensiones.'); }
          const notation=child(event,'notations');if(notation) {
            checkChildren(notation,['tied','articulations','fermata','tuplet'],'notación');
            const arts=items(child(notation,'articulations')).map(tag).filter(Boolean);assert(arts.length+(child(notation,'fermata')?1:0)<=1,'MusicXML: varias articulaciones por nota no compatibles');
            if(arts.length) {assert(ARTICULATIONS.includes(arts[0]),'MusicXML: articulación no compatible');note.articulation=arts[0];}
            if(child(notation,'fermata'))note.articulation='fermata';
            if(children(notation,'tied').some(t=>attr(t,'type')==='start'))note.tie=true;
          }
          if(child(event,'chord')) {
            const prior=previousChord?.note;assert(prior && noteLayer(prior)===layer && !prior.rest && !note.rest && Math.abs(prior.duration-note.duration)<EPS,'MusicXML: acorde con duraciones diferentes o voces distintas no compatible');
            assert(!note.lyric && !note.articulation && note.tie===prior.tie,'MusicXML: notación independiente por voz de acorde no compatible');for(const field of ['velocity','timing','stemDirection','notehead'])assert(note[field]===undefined||note[field]===prior[field],`MusicXML: ${field} independiente entre alturas de un acorde no compatible`);prior.pitches.push(...note.pitches);
          } else {
            assert(cursor>=layerEnds[layer-1]-EPS,'MusicXML: notas superpuestas dentro de la misma voz no compatibles');
            if(cursor>layerEnds[layer-1]+EPS){const rest=makeNote(60,cursor-layerEnds[layer-1]);rest.rest=true;rest.pitches=[];rest.layer=layer;measure.notes.push(rest);}
            starts.set(note.id,cursor);measure.notes.push(note);previousChord={note,start:cursor};cursor+=duration;layerEnds[layer-1]=cursor;
          }
          if(children(event,'beam').length||child(event,'accidental'))warnings.push('Las barras y alteraciones de cortesía se redistribuyen automáticamente.');
          if(child(event,'unpitched'))warnings.push('La ubicación gráfica de percusión se recalcula; se conservan los sonidos MIDI y las cabezas compatibles.');
        } else if(name==='backup'||name==='forward') {
          checkChildren(event,['duration','voice','staff'],name);const delta=Number(val(event,'duration'))/divisions;
          assert(finite(delta)&&delta>0,'MusicXML: desplazamiento de cursor inválido');cursor+=name==='backup'?-delta:delta;
          assert(cursor>=-EPS,'MusicXML: backup anterior al inicio del compás');if(Math.abs(cursor)<EPS)cursor=0;previousChord=null;
        } else if(name==='direction') {
          checkChildren(event,['direction-type','sound','offset','staff','voice'],'dirección');
          assert(Number(val(event,'offset',0))===0,'MusicXML: direcciones desplazadas no compatibles');
          for(const dt of children(event,'direction-type')) {
            checkChildren(dt,['dynamics','metronome','words'],'dirección musical');
            const dyn=child(dt,'dynamics');if(dyn){const d=items(dyn).find(n=>tag(n));pendingDynamic=tag(d)==='other-dynamics'?text(d):tag(d);}
            if(children(dt,'words').length)indications.push({start:cursor,voice:val(event,'voice'),expression:children(dt,'words').map(text).join(' ')});
          }
          const sound=child(event,'sound');let tempo=Number(attr(sound,'tempo',0));
          const met=children(event,'direction-type').map(x=>child(x,'metronome')).find(Boolean);
          if(met && !tempo) { assert(val(met,'beat-unit')==='quarter' && !child(met,'beat-unit-dot'),'MusicXML: unidad de tempo no compatible');tempo=Number(val(met,'per-minute')); }
          if(tempo){
            assert(cursor<EPS,'MusicXML: cambios de tempo dentro de un compás no compatibles');
            if(mi===0&&!globalTempo){globalTempo=tempo;score.tempo=tempo;}
            else if(mi===0&&Math.abs(tempo-globalTempo)<EPS){}
            else {assert(!tempoChanges.has(mi)||Math.abs(tempoChanges.get(mi)-tempo)<EPS,'MusicXML: tempos distintos entre partes en el mismo compás');tempoChanges.set(mi,tempo);measure.tempo=tempo;}
          }
          if(sound && Object.keys(sound[':@']||{}).some(k=>k!=='@_tempo'))warnings.push('Atributos de reproducción adicionales de MusicXML no importados.');
          if(pendingDynamic){indications.push({start:cursor,voice:val(event,'voice'),dynamic:pendingDynamic});pendingDynamic='';}
        } else if(name==='harmony') {
          checkChildren(event,['root','kind','bass','offset'],'acorde');assert(Number(val(event,'offset',0))===0,'MusicXML: acordes desplazados no compatibles');
          const kind=child(event,'kind');const root=child(event,'root');const bass=child(event,'bass');const suffix=CHORD_SUFFIXES[text(kind)];
          const accidental=n=>Number(n)===1?'#':Number(n)===-1?'b':Number(n)===0?'':null;
          if(attr(kind,'text') && text(kind)==='other')pendingChord=attr(kind,'text');
          else {assert(suffix!==undefined,'MusicXML: tipo de acorde no compatible');const a=accidental(val(root,'root-alter',0)),b=accidental(val(bass,'bass-alter',0));assert(a!==null&&b!==null,'MusicXML: acorde microtonal no compatible');pendingChord=val(root,'root-step')+a+suffix+(bass?'/'+val(bass,'bass-step')+b:'');}
          indications.push({start:cursor,voice:val(event,'voice'),chord:pendingChord});pendingChord='';
        } else if(name==='print') warnings.push('La maquetación original se recalculará.');
        else if(name==='barline') {
          checkChildren(event,['bar-style','repeat','ending'],'barra de compás');assert(!child(event,'ending'),'MusicXML: casillas de repetición no compatibles');
          const repeat=child(event,'repeat'),location=attr(event,'location','right');
          if(repeat){const direction=attr(repeat,'direction');assert(['forward','backward'].includes(direction),'MusicXML: repetición inválida');assert(location===(direction==='forward'?'left':'right'),'MusicXML: repetición en una ubicación de barra no compatible');if(direction==='forward')measure.repeatStart=true;else{measure.repeatEnd=true;measure.times=Number(attr(repeat,'times',2));}}
          const style=val(event,'bar-style');if(location==='right'&&style){const mapped={regular:'single','light-light':'double','light-heavy':'final',none:'none'}[style];if(mapped)measure.barline=mapped;else warnings.push(`La barra de compás ${style} se normaliza a simple.`);}
        }
        else throw new Error(`MusicXML: elemento de compás no compatible: ${name}`);
      }
      for(const indication of indications) {
        const target=measure.notes.find(n=>Math.abs((starts.get(n.id)??-1)-indication.start)<EPS && (!indication.voice || voiceMap.get(indication.voice)===noteLayer(n)));
        assert(target,'MusicXML: indicación dentro de una nota sostenida o sin una nota asociada no compatible');
        if(indication.dynamic)target.dynamic=indication.dynamic;if(indication.chord)target.chord=indication.chord;if(indication.expression)target.expression=target.expression?[target.expression,indication.expression].join(' '):indication.expression;
      }
      part.measures.push(measure);
    }
    score.parts.push(part);
  }
  for(const [mi,tempo] of tempoChanges)for(const part of score.parts)part.measures[mi].tempo=tempo;
  score.warnings=[...new Set(warnings)];return validateScore(score);
}
function withDeltas(events) { let previous=0;return events.sort((a,b)=>a.tick-b.tick || ({noteOff:0,noteOn:2,endOfTrack:3}[a.type]??1)-({noteOff:0,noteOn:2,endOfTrack:3}[b.type]??1)).map(({tick,...event})=>{const deltaTime=tick-previous;previous=tick;return {...event,deltaTime};}); }
function performedMeasures(score) {
  const measures=score.parts[0].measures,visits=new Map(),starts=[],order=[];
  for(let mi=0;mi<measures.length&&order.length<4096;mi++) {
    const m=measures[mi];if(m.repeatStart&&starts.at(-1)!==mi)starts.push(mi);order.push(mi);
    if(m.repeatEnd){const count=visits.get(mi)||0,times=m.times??2;if(count<times-1){visits.set(mi,count+1);mi=(starts.at(-1)??0)-1;}else{visits.delete(mi);starts.pop();}}
  }
  assert(order.length<4096,'MIDI: la secuencia de repeticiones es demasiado larga');return order;
}
export function toMidi(input) {
  const score=validateScore(input);const resolution=scoreResolution(score);assert(resolution<=32767,'MIDI: estas razones combinadas requieren más de 32767 ticks por negra; exporte MusicXML');assert(score.parts.filter(p=>!percussion(p)).length<=15,'MIDI permite hasta 15 instrumentos melódicos en esta aplicación');
  assert(score.parts.filter(percussion).length<=1,'MIDI: agrupe la percusión en un solo pentagrama; el canal 10 comparte kit y volumen');
  const ticks=n=>{const v=n*resolution;assert(Math.abs(v-Math.round(v))<EPS,`MIDI: duración no representable a ${resolution} ticks`);return Math.round(v);};
  const duration=ticks(beatsPerMeasure(score));
  const order=performedMeasures(score),endTick=duration*order.length;
  let currentTempo=score.tempo;const conductor=[{tick:0,type:'trackName',text:score.title.replace(/[^\x20-\x7e]/g,'?')},{tick:0,type:'setTempo',microsecondsPerBeat:Math.round(60_000_000/currentTempo)},{tick:0,type:'timeSignature',numerator:score.time[0],denominator:score.time[1],metronome:24,thirtyseconds:8},{tick:0,type:'keySignature',key:KEYS[score.key],scale:score.key.endsWith('m')?1:0}];
  order.forEach((mi,index)=>{const tempo=score.parts[0].measures[mi].tempo;if(tempo!==undefined&&Math.abs(tempo-currentTempo)>EPS){currentTempo=tempo;conductor.push({tick:index*duration,type:'setTempo',microsecondsPerBeat:Math.round(60_000_000/tempo)});}});
  conductor.push({tick:endTick,type:'endOfTrack'});const tracks=[withDeltas(conductor)];
  let melodicIndex=0;
  score.parts.forEach(part=>{
    const channel=percussion(part)?9:melodicChannel(melodicIndex++);const events=[{tick:0,type:'trackName',text:part.name.replace(/[^\x20-\x7e]/g,'?')},{tick:0,type:'programChange',channel,programNumber:part.program},{tick:0,type:'controller',channel,controllerType:7,value:Math.round(part.volume*127)}];
    const spans=[];
    for(const layer of [1,2,3,4]) {
      const active=new Map();let velocity=80;
      const close=(pitch,end)=>{const held=active.get(pitch);const shifted=Math.max(0,held.start+held.timing);const length=Math.max(1,Math.round((end-held.start)*held.gate));spans.push({pitch,start:shifted,end:shifted+length,velocity:held.velocity});active.delete(pitch);};
      order.forEach((mi,performedIndex)=>{
        let position=performedIndex*duration;
        for(const note of part.measures[mi].notes.filter(n=>noteLayer(n)===layer)) {
          const end=position+ticks(note.duration);
          if(note.dynamic)velocity=Math.round(({pppp:.08,ppp:.12,pp:.2,p:.35,mp:.5,mf:.65,f:.8,ff:.95,fff:1,ffff:1,sfz:1,fp:.7}[note.dynamic]??velocity/127)*127);
          const sounding=note.pitches.map(pitch=>{const result=pitch-(percussion(part)?0:part.transpose??0);assert(result>=0&&result<=127,'MIDI: la transposición escrita excede el rango MIDI');return result;});
          for(const pitch of [...active.keys()])if(note.rest||!sounding.includes(pitch))close(pitch,position);
          if(!note.rest&&!part.muted)for(const pitch of sounding) {
            if(!active.has(pitch))active.set(pitch,{start:position,velocity:note.velocity??velocity,timing:Math.round((note.timing??0)*resolution),gate:note.articulation==='staccato'?.4:note.articulation==='staccatissimo'?.25:1});
            if(!note.tie)close(pitch,end);
          }
          position=end;
        }
        if(position<(performedIndex+1)*duration)for(const pitch of [...active.keys()])close(pitch,position);
      });
      for(const pitch of [...active.keys()])close(pitch,endTick);
    }
    // MIDI has no voice identity. Merge genuinely overlapping equal pitches on
    // this instrument channel so one layer's noteOff cannot cut another short.
    const merged=[];
    for(const span of spans.sort((a,b)=>a.pitch-b.pitch||a.start-b.start||a.end-b.end)) {
      const prior=merged.at(-1);
      if(prior&&prior.pitch===span.pitch&&span.start<prior.end){prior.end=Math.max(prior.end,span.end);}
      else merged.push({...span});
    }
    for(const span of merged){events.push({tick:span.start,type:'noteOn',channel,noteNumber:span.pitch,velocity:span.velocity},{tick:span.end,type:'noteOff',channel,noteNumber:span.pitch,velocity:0});}
    events.push({tick:merged.reduce((latest,span)=>Math.max(latest,span.end),endTick),type:'endOfTrack'});tracks.push(withDeltas(events));
  });
  const output=new Uint8Array(writeMidi({header:{format:1,ticksPerBeat:resolution},tracks}));
  output.warnings=[...exportWarnings(score,'midi'),'Las notas de igual altura que se solapan en un instrumento se fusionan para conservar el sonido sostenido.'];return output;
}
export function fromMidi(bytes) {
  assert(bytes && bytes.length<=20_000_000,'MIDI: archivo demasiado grande o inválido');let data;try{data=parseMidi(bytes);}catch(error){throw new Error(`MIDI inválido: ${String(error)}`);}
  assert(data.header.format!==2 && data.header.ticksPerBeat>0,'MIDI: formato 2 o temporización SMPTE no compatible');const resolution=data.header.ticksPerBeat;
  const score={version:1,title:'Importación MIDI',composer:'',tempo:100,time:[4,4],key:'C',parts:[],warnings:['MIDI no contiene la maquetación de una partitura; las voces se distribuyen en hasta cuatro capas por instrumento. Se conservan exactamente los tiempos y la resolución MIDI de las notas.']};
  const meta={},tempoEvents=new Map();const groups=new Map();let maxTick=0;
  data.tracks.forEach((track,ti)=>{let tick=0,name='';const programs={};const volumes={};const active=new Map();
    for(const event of track){tick+=event.deltaTime;maxTick=Math.max(maxTick,tick);
      if(event.type==='trackName'){name=event.text;if(ti===0)score.title=name||score.title;}
      else if(event.type==='setTempo'){assert(event.microsecondsPerBeat>0,'MIDI: tempo inválido');tempoEvents.set(tick,event.microsecondsPerBeat);}
      else if(['timeSignature','keySignature'].includes(event.type)){
        const v=event.type==='setTempo'?event.microsecondsPerBeat:event.type==='timeSignature'?[event.numerator,event.denominator]:[event.key,event.scale];assert(!meta[event.type] || JSON.stringify(meta[event.type])===JSON.stringify(v),'MIDI: cambios de tempo, métrica o armadura no compatibles');meta[event.type]=v;
      } else if(event.type==='programChange'){assert(event.channel!==9||event.programNumber===0,'MIDI: solo se admite el kit estándar General MIDI de percusión (programa 0)');assert(programs[event.channel]===undefined||programs[event.channel]===event.programNumber,'MIDI: cambios de instrumento no compatibles');programs[event.channel]=event.programNumber;}
      else if(event.type==='controller'){assert(event.channel!==9||![0,32].includes(event.controllerType)||event.value===0,'MIDI: banco de percusión no compatible; se requiere el kit estándar General MIDI');if(event.controllerType===7){assert(volumes[event.channel]===undefined||volumes[event.channel]===event.value,'MIDI: automatización de volumen no compatible');volumes[event.channel]=event.value;}else if(event.value!==0||![64,120,121,123].includes(event.controllerType))score.warnings.push(`Controlador MIDI ${event.controllerType} no importado.`);}
      else if(event.type==='pitchBend')throw new Error('MIDI: pitch bend no compatible');
      else if(event.type==='noteOn' && event.velocity>0){const key=event.channel+':'+event.noteNumber;if(!active.has(key))active.set(key,[]);active.get(key).push({start:tick,pitch:event.noteNumber,channel:event.channel,velocity:event.velocity});}
      else if(event.type==='noteOff'||event.type==='noteOn'&&event.velocity===0){const key=event.channel+':'+event.noteNumber;const queue=active.get(key);const note=queue?.shift();assert(note,'MIDI: noteOff sin noteOn');if(!queue.length)active.delete(key);assert(tick>note.start,'MIDI: nota de duración cero');const groupKey=ti+':'+event.channel;if(!groups.has(groupKey))groups.set(groupKey,{name:name||`Pista ${ti+1}`,channel:event.channel,program:programs[event.channel]??0,volume:(volumes[event.channel]??102)/127,events:[]});groups.get(groupKey).events.push({...note,end:tick});}
      else if(!event.meta && !['endOfTrack','trackName','programChange'].includes(event.type))score.warnings.push(`Evento MIDI ${event.type} no importado.`);
    }assert(active.size===0,'MIDI: hay notas sin cierre');
  });
  if(tempoEvents.has(0))score.tempo=60_000_000/tempoEvents.get(0);if(meta.timeSignature)score.time=meta.timeSignature;
  if(meta.keySignature){const [fifths,minor]=meta.keySignature;score.key=Object.keys(KEYS).find(k=>KEYS[k]===fifths&&k.endsWith('m')===!!minor);assert(score.key,'MIDI: armadura no compatible');}
  assert(groups.size>0 && groups.size<=MAX_PARTS,'MIDI: no hay notas o hay demasiados instrumentos');
  const capacity=beatsPerMeasure(score);const count=Math.max(1,Math.ceil((maxTick/resolution-EPS)/capacity));assert(count<=MAX_MEASURES,'MIDI: demasiados compases');
  for(const group of groups.values()){
    const part={id:id(),name:group.name,clef:group.channel===9?'percussion':group.events.reduce((sum,n)=>sum+n.pitch,0)/group.events.length<57?'bass':'treble',program:group.program,volume:group.volume,muted:false,measures:Array.from({length:count},()=>({notes:[]}))};
    if(group.channel===9)part.percussion=true;
    const quantize=tick=>tick;
    const events=group.events.map(e=>({...e,start:quantize(e.start),end:quantize(e.end)})).sort((a,b)=>a.start-b.start||b.end-a.end);const merged=[],chords=new Map();
    for(const event of events) {
      assert(event.end>event.start,'MIDI: nota más breve que la resolución de importación');
      const key=`${event.start}:${event.end}`;const candidates=chords.get(key)||[];const chord=candidates.find(n=>n.velocity===event.velocity&&!n.pitches.includes(event.pitch));
      if(chord)chord.pitches.push(event.pitch);else{const entry={start:event.start,end:event.end,pitches:[event.pitch],velocity:event.velocity};merged.push(entry);candidates.push(entry);chords.set(key,candidates);}
    }
    const voices=Array.from({length:4},()=>({end:0,events:[]}));
    for(const event of merged) {
      const voice=voices.find(v=>v.end<=event.start);assert(voice,'MIDI: se necesitan más de cuatro capas para conservar estas voces independientes');
      voice.events.push(event);voice.end=event.end;
    }
    for(const [layerIndex,voice] of voices.entries()) {
      let cursor=0,tupletGroup=null;
      const add=(start,end,pitches,velocity)=>{
        let position=start/resolution,remaining=(end-start)/resolution;
        while(remaining>EPS) {
          const mi=Math.floor((position+EPS)/capacity);assert(mi<count,'MIDI: notas fuera de rango');
          const length=Math.min(remaining,capacity-(position-mi*capacity));assert(length>EPS,'MIDI: subdivisión de compás inválida');
          const n=makeNote(pitches[0]??60,length);n.layer=layerIndex+1;n.rest=pitches.length===0;n.pitches=[...pitches].sort((a,b)=>a-b);n.tie=pitches.length>0&&remaining-length>EPS;if(pitches.length&&velocity!==undefined)n.velocity=velocity;
          // Recognize the written binary/dotted value, then common triplet and
          // quintuplet / septuplet ratios. MIDI itself cannot encode a tuplet bracket.
          let found=false;
          for(const [base] of types)for(let dots=0;dots<=3;dots++)if(Math.abs(base*(2-1/2**dots)-length)<EPS){n.dots=dots;found=true;}
          if(found)tupletGroup=null;
          else for(const [actual,normal] of [[3,2],[5,4],[7,4]]) {
            const written=length*actual/normal;let dotsMatch=null;
            for(const [base] of types)for(let dots=0;dots<=3;dots++)if(Math.abs(base*(2-1/2**dots)-written)<EPS)dotsMatch=dots;
            if(dotsMatch!==null) {
              if(!tupletGroup||tupletGroup.actual!==actual||tupletGroup.count>=actual)tupletGroup={actual,normal,id:id(),count:0};
              n.dots=dotsMatch;n.tuplet={actual,normal,group:tupletGroup.id};tupletGroup.count++;break;
            }
          }
          part.measures[mi].notes.push(n);position+=length;remaining-=length;
        }
      };
      for(const event of voice.events){if(event.start>cursor)add(cursor,event.start,[]);add(event.start,event.end,event.pitches,event.velocity);cursor=event.end;}
    }
    score.parts.push(part);
  }
  for(const [tick,microseconds] of tempoEvents){if(tick===0)continue;const position=tick/resolution/capacity;assert(Math.abs(position-Math.round(position))<EPS,'MIDI: cambios de tempo dentro de un compás no compatibles');const mi=Math.round(position);if(mi<count)for(const part of score.parts)part.measures[mi].tempo=60_000_000/microseconds;}
  score.warnings=[...new Set(score.warnings)];return validateScore(score);
}
