import { Flow as VF } from "vexflow";
import {setupResponsive,focusInspector} from './responsive.js';
import JSZip from "jszip";
import {writeMidi} from "midi-file";
import {createMp3Stream,pcm16FromBase64,floatToInt16,renderBrowserAudio} from "./mp3.js";
import {buildPlayback} from "./playback.js";
import {TOOL_DEFINITIONS,runTool} from "./toolbox.js";
import {fromMusx,toMusx} from "./musx.js";
import { INSTRUMENTS, GM_INSTRUMENTS, DRUM_NAMES, instrumentById, makePart } from "./instruments.js";
import { createScore, validateScore, makeNote, beatsPerMeasure, noteName, transposeScore, toMusicXML, fromMusicXML, toMidi, fromMidi, exportWarnings, noteLayer, writtenDuration, measureLayers } from "./model.js";
const $ = (id) => document.getElementById(id), $$ = (s) => [...document.querySelectorAll(s)], uid = () => crypto.randomUUID();
const KEYS = ["Cb", "Gb", "Db", "Ab", "Eb", "Bb", "F", "C", "G", "D", "A", "E", "B", "F#", "C#"];
let score = createScore(), selection = { part: 0, measure: 0, note: null }, tool = "select", duration = 1, dotted = false, activeLayer = 1, tupletInput = null, accidental = null, history = [], future = [], clipboard = null, baseline = "", audio = null, playing = false, playTimers = [], activeOsc = [], metronome = false, nativeAudioFailed = false, zoom = 0.8, perLine = 4, toastTimer, hitMap = [], engravedNotes = /* @__PURE__ */ new Map();
function createFromTemplate(options = {}) {
  const template = options.template || "piano";
  if (!["baritone", "baritone-piano", "choir"].includes(template)) return createScore(options);
  const s = createScore({ ...options, template: "solo" }), count = s.parts[0].measures.length;
  const part = (id) => makePart(instrumentById(id), count);
  if (template === "baritone") s.parts = [part("voice-baritone")];
  if (template === "choir") s.parts = ["voice-soprano", "voice-alto", "voice-tenor", "voice-bass"].map(part);
  if (template === "baritone-piano") {
    const p = createScore({ ...options, template: "piano" });
    s.parts = [part("voice-baritone"), ...p.parts];
  }
  return s;
}
function demo() {
  const s = createScore({ title: "Peque\xF1o preludio", composer: "Estudio para piano", template: "piano", measures: 8 });
  s.tempo = 92;
  const melody = [[60, 64, 67, 64], [62, 65, 69, 65], [64, 67, 72, 67], [62, 65, 71, 67], [60, 64, 67, 72], [69, 65, 62, 65], [67, 71, 74, 71], [72]];
  s.parts[0].measures.forEach((m, i) => m.notes = melody[i].map((p) => makeNote(p, i === 7 ? 4 : 1)));
  if (s.parts[1]) s.parts[1].measures.forEach((m, i) => {
    const root = [48, 50, 48, 43, 48, 41, 43, 48][i];
    const n = makeNote(root, 4);
    n.pitches = [root, root + 7];
    m.notes = [n];
  });
  s.parts[0].measures[0].notes[0].dynamic = "mp";
  const voice = makePart(instrumentById("voice-baritone"), 8);
  voice.measures = s.parts[0].measures.map((m) => ({ notes: m.notes.map((n) => ({ ...structuredClone(n), id: uid(), pitches: n.pitches.map((p) => p - 12) })) }));
  s.title = "Estudio para bar\xEDtono";
  s.composer = "Voz y piano";
  s.parts.unshift(voice);
  return s;
}
try {
  const saved = (localStorage.getItem("rickmusic.autosave") || localStorage.getItem("partitura.autosave"));
  score = saved ? validateScore(JSON.parse(saved)) : demo();
} catch {
  score = demo();
}
baseline = JSON.stringify(score);
function toast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 4800);
  $("status").textContent = message;
}
function selectedNote() {
  return score.parts[selection.part]?.measures[selection.measure]?.notes[selection.note] ?? null;
}
function snapshot() {
  history.push(JSON.stringify(score));
  if (history.length > 150) history.shift();
  future = [];
}
function repairTies(){const capacity=beatsPerMeasure(score);for(const part of score.parts)for(let layer=1;layer<=4;layer++){const items=[];part.measures.forEach((m,mi)=>{let at=mi*capacity;for(const n of m.notes.filter(n=>noteLayer(n)===layer)){items.push({n,at});at+=n.duration;}});for(let i=0;i<items.length;i++){const{n,at}=items[i],next=items[i+1];if(n.tie&&(!next||n.rest||next.n.rest||Math.abs(at+n.duration-next.at)>1e-6||JSON.stringify(n.pitches)!==JSON.stringify(next.n.pitches)))n.tie=false;}}}
function mutate(fn) {
  if (playing) stop();
  const before = JSON.stringify(score);
  try {
    fn();
    repairTies();
    validateScore(score);
    if (JSON.stringify(score) !== before) {
      history.push(before);
      if (history.length > 150) history.shift();
      future = [];
    }
    persist();
    render();
  } catch (e) {
    score = JSON.parse(before);
    render();
    toast(e.message);
  }
}
function persist() {
  try {
    localStorage.setItem("rickmusic.autosave", JSON.stringify(score));
  } catch {
    toast("No se pudo guardar la recuperaci\xF3n local. Guarda el documento en un archivo.");
  }
}
function clampSelection() {
  selection.part = Math.max(0, Math.min(selection.part, score.parts.length - 1));
  selection.measure = Math.max(0, Math.min(selection.measure, score.parts[0].measures.length - 1));
  if (selection.note !== null && selection.note >= score.parts[selection.part].measures[selection.measure].notes.length) selection.note = null;
}
function undo() {
  if (!history.length) return;
  future.push(JSON.stringify(score));
  score = JSON.parse(history.pop());
  clampSelection();
  persist();
  render();
}
function redo() {
  if (!future.length) return;
  history.push(JSON.stringify(score));
  score = JSON.parse(future.pop());
  clampSelection();
  persist();
  render();
}
function setTool(t) {
  tool = t;
  $("canvas").classList.toggle("hand-tool",t==="hand");
  $$("[data-tool]").forEach((b) => b.classList.toggle("active", b.dataset.tool === t));
  $$("[data-finale-tool]").forEach(b=>{const active=({select:"select","simple-entry":"note",lyrics:"lyric",chord:"chord",hand:"hand"}[b.dataset.finaleTool])===t;b.classList.toggle("active",active);b.setAttribute("aria-pressed",String(active));});
  $("status").textContent = { select: "Selecciona una nota o un comp\xE1s.", note: "Haz clic en el pentagrama o usa A\u2013G para insertar notas.", rest: "Haz clic en el comp\xE1s para insertar un silencio.", lyric: "Selecciona una nota para editar su letra.", chord: "Selecciona una nota para a\xF1adir un cifrado.", hand:"Arrastra la partitura para desplazar la vista.", erase: "Haz clic en una nota para borrarla." }[t];
}
function setDuration(d) {
 duration=d;
 $$('[data-dur]').forEach(b=>b.classList.toggle('active',Number(b.dataset.dur)===d));
 if(selectedNote())mutate(()=>{const n=selectedNote();n.duration=d*(dotted?1.5:1)*(n.tuplet?n.tuplet.normal/n.tuplet.actual:1);n.dots=dotted?1:0;});
}
function setLayer(layer){activeLayer=Number(layer);selection.note=null;render();$('status').textContent=`Capa ${activeLayer}: notas y silencios independientes.`;}
function setTupletMode(enabled=!tupletInput){const [actual,normal]=$('tuplet-ratio').value.split(':').map(Number);tupletInput=enabled?{actual,normal}:null;$('tuplet').classList.toggle('active',!!tupletInput);$('status').textContent=tupletInput?`Entrada ${actual}:${normal}: escribe las notas del grupo.`:'Entrada rítmica normal';}
function convertTuplet(){if(!selectedNote()){toast('Selecciona la primera nota del grupo.');return;}dialog('Convertir grupo irregular',[{name:'ratio',label:'Proporción',value:'3:2',options:[['3:2','Tresillo · 3 en el tiempo de 2'],['5:4','Quintillo · 5 en el tiempo de 4'],['7:4','Septillo · 7 en el tiempo de 4'],['none','Quitar grupo irregular']]}],v=>mutate(()=>{const n=selectedNote(),notes=measureLayers(score.parts[selection.part].measures[selection.measure])[noteLayer(n)-1],index=notes.indexOf(n);if(v.ratio==='none'){if(!n.tuplet)return;const group=notes.filter(x=>x.tuplet?.group===n.tuplet.group);group.forEach(x=>{x.duration=writtenDuration(x);delete x.tuplet;});return;}const [actual,normal]=v.ratio.split(':').map(Number),chosen=notes.slice(index,index+actual);if(chosen.length!==actual)throw Error(`Se necesitan ${actual} notas consecutivas en la misma capa.`);const id=uid();chosen.forEach(x=>{x.duration=writtenDuration(x)*normal/actual;x.tuplet={actual,normal,group:id};});}));}
function keyAlter(step) {
  const minorMap = { Am: "C", Em: "G", Bm: "D", "F#m": "A", "C#m": "E", "G#m": "B", "D#m": "F#", "A#m": "C#", Dm: "F", Gm: "Bb", Cm: "Eb", Fm: "Ab", Bbm: "Db", Ebm: "Gb", Abm: "Cb" };
  const fifths = KEYS.indexOf(minorMap[score.key] || score.key) - 7;
  if (fifths > 0 && "FCGDAEB".slice(0, fifths).includes(step)) return 1;
  if (fifths < 0 && "BEADGCF".slice(0, -fifths).includes(step)) return -1;
  return 0;
}
function pitchFor(step, octave) {
  return (octave + 1) * 12 + { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[step] + (accidental ?? keyAlter(step));
}
function insertPitch(pitch,rest=false,chord=false){
 mutate(()=>{
  let measure=score.parts[selection.part].measures[selection.measure];
  const d=duration*(dotted?1.5:1)*(tupletInput?tupletInput.normal/tupletInput.actual:1);
  if(chord&&selectedNote()&&!rest){const n=selectedNote();if(n.rest)throw Error('Un silencio no puede contener un acorde.');if(!n.pitches.includes(pitch))n.pitches.push(pitch);n.pitches.sort((a,b)=>a-b);return;}
  let notes=measureLayers(measure)[activeLayer-1],used=notes.reduce((a,n)=>a+n.duration,0);
  if(used+d>beatsPerMeasure(score)+1e-6){selection.measure++;selection.note=null;if(selection.measure>=score.parts[0].measures.length)score.parts.forEach(p=>p.measures.push({notes:[]}));measure=score.parts[selection.part].measures[selection.measure];notes=measureLayers(measure)[activeLayer-1];used=notes.reduce((a,n)=>a+n.duration,0);if(used+d>beatsPerMeasure(score)+1e-6)throw Error('La capa del siguiente compás está llena.');}
  if(score.parts[selection.part].percussion&&!rest&&pitch<35)pitch=36;
  const n=makeNote(pitch,d);n.layer=activeLayer;n.rest=rest;if(rest)n.pitches=[];n.dots=dotted?1:0;
  if(tupletInput){const last=notes.at(-1),matching=last?.tuplet&&last.tuplet.actual===tupletInput.actual&&last.tuplet.normal===tupletInput.normal;const groupNotes=matching?notes.filter(x=>x.tuplet?.group===last.tuplet.group):[];const group=matching&&groupNotes.length<tupletInput.actual?last.tuplet.group:uid();n.tuplet={...tupletInput,group};}
  measure.notes.push(n);selection.note=measure.notes.length-1;
 });
 if(!rest&&!playing)audition(pitch);
}
function deleteNote() {
  if (selection.note === null) return;
  mutate(() => {
    score.parts[selection.part].measures[selection.measure].notes.splice(selection.note, 1);
    selection.note = null;
  });
}
function pitchInfo(midi) {
  const flat = score.key.includes("b") || ["F", "Dm", "Gm", "Cm", "Fm"].includes(score.key);
  const names = flat ? ["c", "db", "d", "eb", "e", "f", "gb", "g", "ab", "a", "bb", "b"] : ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b"];
  const name = names[midi % 12];
  return { key: `${name}/${Math.floor(midi / 12) - 1}`, step: name[0].toUpperCase(), alter: name.slice(1) };
}
function vfDuration(n){const written=writtenDuration(n),base=written/(2-1/2**(n.dots||0));const map={4:'w',2:'h',1:'q',.5:'8',.25:'16',.125:'32',.0625:'64',.03125:'128'};const entry=Object.entries(map).find(([d])=>Math.abs(Number(d)-base)<1e-6);if(entry)return entry[1];const dottedBases=[[3,'h'],[1.5,'q'],[.75,'8'],[.375,'16']];const dottedEntry=dottedBases.find(([d])=>Math.abs(written-d)<1e-6);if(dottedEntry)return dottedEntry[1];throw Error(`Duración escrita no representable: ${written}`);}
function paddedNotes(notes){
 let left=beatsPerMeasure(score)-notes.reduce((a,n)=>a+n.duration,0);const pads=[];
 const last=notes.at(-1),group=last?.tuplet?notes.filter(n=>n.tuplet?.group===last.tuplet.group):[];
 if(last?.tuplet&&group.length<last.tuplet.actual&&group.every(n=>Math.abs(writtenDuration(n)-writtenDuration(last))<1e-6))for(let i=group.length;i<last.tuplet.actual&&left>=last.duration-1e-6;i++){pads.push({...makeNote(60,last.duration),pitches:[],rest:true,layer:noteLayer(last),dots:last.dots,tuplet:{...last.tuplet},_pad:true});left-=last.duration;}
 const ratios=[null,...[...new Map(notes.filter(n=>n.tuplet).map(n=>[`${n.tuplet.actual}:${n.tuplet.normal}`,n.tuplet])).values()],{actual:3,normal:2,group:'pad'}];
 const candidates=ratios.flatMap(t=>[4,2,1,.5,.25,.125,.0625,.03125].map(base=>({duration:base*(t?t.normal/t.actual:1),tuplet:t}))).sort((a,b)=>b.duration-a.duration);
 let guard=0;while(left>1e-6&&guard++<128){const c=candidates.find(c=>c.duration<=left+1e-6);if(!c)break;const pad={...makeNote(60,c.duration),pitches:[],rest:true,_pad:true};if(c.tuplet)pad.tuplet={...c.tuplet,group:'_pad-'+uid()};pads.push(pad);left-=c.duration;}
 return [...notes,...pads];
}
function render() {
  noteDrag?.ghost?.remove();noteDrag=null;
  clampSelection();
  $("title").value = score.title;
  $("composer").value = score.composer;
  $("tempo").value = score.tempo;
  if (![...$("meter").options].some((o) => o.value === score.time.join("/"))) {
    const opt = document.createElement("option");
    opt.value = score.time.join("/");
    opt.textContent = opt.value;
    $("meter").append(opt);
  }
  $("meter").value = score.time.join("/");
  $("key").value = score.key;
  $("perline").value=String(score.layout?.perLine??perLine);
  $("docname").textContent = `${score.title || "Sin t\xEDtulo"}${JSON.stringify(score) !== baseline ? " \xB7 Modificado" : ""}`;
  $("undo").disabled = !history.length;
  $("redo").disabled = !future.length;
  $("summary").textContent = `${score.parts.length} pentagramas \xB7 ${score.parts[0].measures.length} compases \xB7 ${score.time.join("/")} \xB7 ${score.key}`;
  $$('[data-layer]').forEach(b=>b.classList.toggle('active',Number(b.dataset.layer)===activeLayer));
  $('layer-help').textContent=`Capa ${activeLayer} · voz independiente`;
  renderParts();
  renderScore();
  renderInspector();
  renderPiano();
}
function renderParts() {
  $("parts").replaceChildren();
  score.parts.forEach((part, pi) => {
    const div = document.createElement("div");
    div.className = "part" + (selection.part === pi ? " active" : "");
    const top = document.createElement("div");
    top.className = "name";
    const name = document.createElement("span");
    name.textContent = part.name;
    name.title = "Doble clic para cambiar nombre o clave";
    name.ondblclick = (e) => {
      e.stopPropagation();
      editPart(pi);
    };
    const remove = document.createElement("button");
    remove.textContent = "\xD7";
    remove.title = "Quitar pentagrama";
    remove.disabled = score.parts.length === 1;
    remove.onclick = (e) => {
      e.stopPropagation();
      confirmAction("Quitar pentagrama", `Se eliminar\xE1 \xAB${part.name}\xBB y sus notas. Puedes deshacer esta acci\xF3n.`, () => mutate(() => score.parts.splice(pi, 1)));
    };
    const edit = document.createElement("button");
    edit.textContent = "\u22EF";
    edit.title = "Cambiar instrumento o nombre";
    edit.onclick = (e) => {
      e.stopPropagation();
      editPart(pi);
    };
    top.append(name, edit, remove);
    const controls = document.createElement("div");
    controls.className = "part-controls";
    const clef = document.createElement("span");
    clef.textContent = part.clef === "bass" ? "\u{1D122}" : "\u{1D11E}";
    const vol = document.createElement("input");
    vol.type = "range";
    vol.min = 0;
    vol.max = 1;
    vol.step = 0.05;
    vol.value = part.volume;
    vol.title = "Volumen";
    vol.onclick = (e) => e.stopPropagation();
    vol.onchange = (e) => {
      e.stopPropagation();
      mutate(() => part.volume = Number(vol.value));
    };
    const mute = document.createElement("button");
    mute.textContent = part.muted ? "Silencio" : "M";
    mute.title = "Silenciar";
    mute.classList.toggle("active", part.muted);
    mute.onclick = (e) => {
      e.stopPropagation();
      mutate(() => part.muted = !part.muted);
    };
    controls.append(clef, vol, mute);
    div.append(top, controls);
    div.onclick = () => {
      selection.part = pi;
      selection.note = null;
      $("octave").value = part.clef === "bass" ? 3 : 4;
      render();
    };
    $("parts").append(div);
  });
}
function renderInspector() {
  const n = selectedNote();
  $("selection-label").textContent = n ? `${n.rest ? "Silencio" : n.pitches.map((p) => score.parts[selection.part].percussion ? DRUM_NAMES[p] || noteName(p) : noteName(p)).join(" + ")} \xB7 ${Number(n.duration.toFixed(4))} pulsos \xB7 capa ${noteLayer(n)}${n.tuplet?` \xB7 ${n.tuplet.actual}:${n.tuplet.normal}`:""} \xB7 comp\xE1s ${selection.measure + 1}` : `Comp\xE1s ${selection.measure + 1} \xB7 ${score.parts[selection.part].name}`;
  for (const id of ["dynamic", "articulation", "lyric", "chord"]) {
    $(id).disabled = !n;
    $(id).value = n?.[id] ?? "";
  }
  for (const id of ["tie", "copy", "delete"]) $(id).disabled = !n;
  $("tie").classList.toggle("active", !!n?.tie);
  $("paste").disabled = !clipboard;
}
// WebKit does not consistently include ancestor CSS scaling in getScreenCTM.
// Map through the actual viewport rectangle so entry/drag agree at every zoom.
function scorePoint(svg,clientX,clientY){const box=svg.getBoundingClientRect(),width=Number(svg.getAttribute('width'))||svg.viewBox.baseVal.width||svg.clientWidth,height=Number(svg.getAttribute('height'))||svg.viewBox.baseVal.height||svg.clientHeight;return{x:(clientX-box.left)*width/box.width,y:(clientY-box.top)*height/box.height};}
let noteDrag=null,ignoreDragClickUntil=0;
function installNoteDrag(hit,{part,measure,note,svg,clef,bottom}){
 hit.addEventListener('pointerdown',e=>{
  if(tool!=='select'||e.button!==0)return;const source=score.parts[part].measures[measure].notes[note];if(!source)return;
  const local=scorePoint(svg,e.clientX,e.clientY),engraved=engravedNotes.get(source.id),ys=engraved?.vn.getYs()||[local.y];let pitchIndex=0;for(let i=1;i<ys.length;i++)if(Math.abs(ys[i]-local.y)<Math.abs(ys[pitchIndex]-local.y))pitchIndex=i;
  noteDrag={part,measure,note,id:source.id,startX:e.clientX,startY:e.clientY,grabOffset:local.y-ys[pitchIndex],pitchIndex,wholeChord:e.altKey,pointer:e.pointerId,svg,moved:false,ghost:null};try{hit.setPointerCapture(e.pointerId);}catch{}e.preventDefault();e.stopPropagation();
 });
}
window.addEventListener('pointermove',e=>{const drag=noteDrag;if(!drag||e.pointerId!==drag.pointer)return;if(!drag.moved&&Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)<4)return;drag.moved=true;e.preventDefault();if(!drag.ghost){drag.ghost=document.createElementNS('http://www.w3.org/2000/svg','ellipse');for(const[k,v]of Object.entries({rx:5.5,ry:3.5,fill:'#087f72',opacity:.7,'pointer-events':'none'}))drag.ghost.setAttribute(k,v);drag.svg.append(drag.ghost);}const q=scorePoint(drag.svg,e.clientX,e.clientY);drag.ghost.setAttribute('cx',q.x);drag.ghost.setAttribute('cy',q.y-drag.grabOffset);$('status').textContent='Arrastra arriba/abajo para cambiar altura; izquierda/derecha para reordenar. Suelta para aplicar.';});
window.addEventListener('pointercancel',()=>{noteDrag?.ghost?.remove();noteDrag=null;});
window.addEventListener('pointerup',e=>{const drag=noteDrag;if(!drag||e.pointerId!==drag.pointer)return;noteDrag=null;drag.ghost?.remove();if(!drag.moved)return;ignoreDragClickUntil=performance.now()+200;e.preventDefault();
 const candidate=$$('.measure-hit').map(el=>{const b=el.getBoundingClientRect();return{el,b,distance:e.clientY<b.top?b.top-e.clientY:e.clientY>b.bottom?e.clientY-b.bottom:0};}).filter(c=>e.clientX>=c.b.left&&e.clientX<=c.b.right).sort((a,b)=>a.distance-b.distance)[0],target=candidate&&candidate.distance<75?candidate.el:null;if(!target){toast('Suelta la nota dentro de un compás.');return;}
 const targetPart=Number(target.dataset.part),targetMeasure=Number(target.dataset.measure),targetSVG=target.ownerSVGElement,local=scorePoint(targetSVG,e.clientX,e.clientY);
 mutate(()=>{const sourcePart=score.parts[drag.part],destinationPart=score.parts[targetPart],source=sourcePart.measures[drag.measure],destination=destinationPart.measures[targetMeasure],n=source.notes.find(n=>n.id===drag.id);if(!n)throw Error('La nota ya no está en el compás.');if(n.tuplet&&(drag.measure!==targetMeasure||drag.part!==targetPart))throw Error('Para copiar un grupo irregular completo usa Edición de región.');if(!!sourcePart.percussion!==!!destinationPart.percussion)throw Error('Para mover una nota entre percusión y otros instrumentos, usa copiar y pegar y elige su sonido.');
  if(!n.rest&&!destinationPart.percussion){const clef=target.dataset.clef,index=Math.round((Number(target.dataset.bottom)-(local.y-drag.grabOffset))/5),base=clef==='bass'?18:clef==='alto'?24:30,dia=base+index,step='CDEFGAB'[(dia%7+7)%7],octave=Math.floor(dia/7),pitch=(octave+1)*12+{C:0,D:2,E:4,F:5,G:7,A:9,B:11}[step]+keyAlter(step);if(pitch<0||pitch>127)throw Error('La nota está fuera del rango MIDI.');if(drag.wholeChord){const delta=pitch-n.pitches[drag.pitchIndex];n.pitches=n.pitches.map(p=>p+delta);}else{n.pitches[drag.pitchIndex]=pitch;if(new Set(n.pitches).size!==n.pitches.length)throw Error('Esa altura ya existe en el acorde.');n.pitches.sort((a,b)=>a-b);}}
  const sourceIndex=source.notes.indexOf(n),candidates=destination.notes.map((item,index)=>({item,index,x:engravedNotes.get(item.id)?.vn.getAbsoluteX()})).filter(entry=>entry.item.id!==n.id&&noteLayer(entry.item)===noteLayer(n)&&entry.x!==undefined),before=candidates.find(entry=>entry.x>local.x),oldIndex=before?before.index:destination.notes.length;source.notes.splice(sourceIndex,1);const insert=source===destination&&sourceIndex<oldIndex?oldIndex-1:oldIndex;destination.notes.splice(insert,0,n);selection={part:targetPart,measure:targetMeasure,note:insert};activeLayer=noteLayer(n);
 });
});
document.addEventListener('click',e=>{if(performance.now()<ignoreDragClickUntil){e.preventDefault();e.stopImmediatePropagation();}},true);

function renderScore() {
  const pages = $("pages");
  pages.replaceChildren();
  hitMap = [];
  engravedNotes = /* @__PURE__ */ new Map();
  perLine=score.layout?.perLine??perLine;
  const staffGap=score.layout?.staffGap??132, pageScale=score.layout?.pageScale??1;
  const canvas=$('canvas'), padding=getComputedStyle(canvas);
  const available=canvas.clientWidth-parseFloat(padding.paddingLeft)-parseFloat(padding.paddingRight);
  const pageZoom=$('zoom').value==='fit'?Math.max(.1,Math.min(1,available/1000)):zoom*pageScale;
  const count = score.parts[0].measures.length, sysHeight = score.parts.length * staffGap + 18, sysPerPage = Math.max(1, Math.floor(955 / sysHeight)), totalSys = Math.ceil(count / perLine), pageCount = Math.ceil(totalSys / sysPerPage);
  for (let page = 0; page < pageCount; page++) {
    const wrap = document.createElement("div");
    wrap.className = "sheet-wrap";
    wrap.style.width = 1e3 * pageZoom + "px";
    const sheet = document.createElement("article");
    sheet.className = "sheet";
    sheet.style.transform = `scale(${pageZoom})`;
    const height = Math.max(1260, 240 + Math.min(totalSys - page * sysPerPage, sysPerPage) * sysHeight);
    sheet.style.minHeight = height + "px";
    wrap.style.height = height * pageZoom + "px";
    const heading = document.createElement("div");
    heading.className = "score-heading";
    const title = document.createElement("h1");
    title.textContent = score.title || "Sin t\xEDtulo";
    const subtitle = document.createElement("div");
    subtitle.className = "subtitle";
    subtitle.textContent = score.parts.length > 1 ? "PARTITURA GENERAL" : "PARTITURA";
    const composer = document.createElement("div");
    composer.className = "composer";
    composer.textContent = score.composer;
    heading.append(title, subtitle, composer);
    sheet.append(heading);
    const tempo = document.createElement("div");
    tempo.className = "tempo-mark";
    if(page===0){tempo.textContent='Moderato ';tempo.setAttribute('aria-label',`Moderato, negra = ${score.tempo}`);const glyph=document.createElementNS('http://www.w3.org/2000/svg','svg');glyph.setAttribute('width','12');glyph.setAttribute('height','18');glyph.setAttribute('viewBox','0 0 12 18');glyph.setAttribute('aria-hidden','true');glyph.style.verticalAlign='middle';glyph.style.display='inline-block';glyph.innerHTML='<ellipse cx="4" cy="14" rx="3.2" ry="2.2" transform="rotate(-20 4 14)" fill="#111"/><path d="M7 14V1" stroke="#111" stroke-width="1.2"/>';tempo.append(glyph,document.createTextNode(` = ${score.tempo}`));}else tempo.textContent=' ';
    sheet.append(tempo);
    for (let si = page * sysPerPage; si < Math.min(totalSys, (page + 1) * sysPerPage); si++) {
      const start = si * perLine, nMeasures = Math.min(perLine, count - start), system = document.createElement("div");
      system.className = "system";
      sheet.append(system);
      const renderer = new VF.Renderer(system, VF.Renderer.Backends.SVG);
      renderer.resize(910, sysHeight);
      const ctx = renderer.getContext();
      const measureW = (900 - 65) / perLine;
      const staves = [];
      score.parts.forEach((part, pi) => {
        staves[pi] = [];
        for (let j = 0; j < nMeasures; j++) {
          const mi = start + j, measure = part.measures[mi], x = 65 + j * measureW, y = pi * staffGap + 8;
          const clef=part.measures.slice(0,mi+1).reduce((c,m)=>m.clef||c,part.clef);
          const stave = new VF.Stave(x, y, measureW);
          if (j === 0) {
            stave.addClef(clef);
            if (!part.percussion) stave.addKeySignature(score.key);
            if (si === 0) stave.addTimeSignature(score.time.join("/"));
          }
          if(j!==0&&measure.clef)stave.addClef(clef,'small');
          if(measure.repeatStart)stave.setBegBarType(VF.Barline.type.REPEAT_BEGIN);
          if(measure.repeatEnd)stave.setEndBarType(VF.Barline.type.REPEAT_END);
          else stave.setEndBarType({single:VF.Barline.type.SINGLE,double:VF.Barline.type.DOUBLE,final:VF.Barline.type.END,none:VF.Barline.type.NONE}[measure.barline]??(mi===count-1?VF.Barline.type.END:VF.Barline.type.SINGLE));
          if(measure.tempo&&pi===0)stave.setTempo({duration:'q',bpm:measure.tempo},-14);
          stave.setContext(ctx).draw();
          staves[pi].push(stave);
          if (j === 0) {
            ctx.setFont("Georgia", 11, "");
            ctx.fillText(part.name.length > 9 ? part.name.slice(0, 8) + "\u2026" : part.name, 0, y + 43);
          }
          if (pi === 0) {
            ctx.setFont("Arial", 9, "");
            ctx.setFillStyle("#82918c");
            ctx.fillText(measure.label||String(mi + 1), x + 4, y + 4);
            ctx.setFillStyle("#111");
          }

          const layers=measureLayers(measure),visibleLayers=layers.map((notes,index)=>({notes,layer:index+1})).filter(v=>v.notes.length&&($('show-other-layers').checked||v.layer===activeLayer));
          if(!visibleLayers.length)visibleLayers.push({notes:[],layer:pi===selection.part?activeLayer:1});
          const multi=visibleLayers.length>1,voices=[],allVNotes=new Map(),tupletDraws=[],beamDraws=[];
          const svg=system.querySelector('svg');
          const rect=svgRect({x,y:y+7,width:measureW,height:103,class:'measure-hit'+(pi===selection.part&&mi===selection.measure?' selected':''),'data-measure':mi,'data-part':pi});
          rect.addEventListener('click',e=>{const local=scorePoint(svg,e.clientX,e.clientY);selection={part:pi,measure:mi,note:null};if(tool==='note'||tool==='rest'){const index=Math.round((stave.getYForLine(4)-local.y)/5),base=clef==='bass'?18:clef==='alto'?24:30,dia=base+index;insertPitch(part.percussion?Number($('drum-sound')?.value||36):pitchFor('CDEFGAB'[(dia%7+7)%7],Math.floor(dia/7)),tool==='rest',e.shiftKey);}else render();});
          rect.dataset.clef=clef;rect.dataset.bottom=String(stave.getYForLine(4));svg.append(rect);
          try{
            for(const {notes,layer}of visibleLayers){const full=paddedNotes(notes),vNotes=[],accidentalState={};
              for(const n of full){const keys=n.rest?[clef==='bass'?'d/3':multi&&layer%2===0?'g/4':'b/4']:n.pitches.map(p=>part.percussion?({35:'f/4',36:'f/4',38:'c/5',40:'c/5',42:'g/5',44:'d/4',46:'g/5',49:'a/5',51:'f/5'}[p]||'d/5'):pitchInfo(p).key);
                const head={cross:'X2',diamond:'D2',triangle:'T0'}[n.notehead];
                const vn=new VF.StaveNote({clef,keys:head&&!n.rest?keys.map(k=>k+'/'+head):keys,duration:vfDuration(n)+(n.rest?'r':''),glyph_font_scale:39*(n.scale??1),auto_stem:!multi&&(!n.stemDirection||n.stemDirection==='auto'),stem_direction:n.stemDirection==='up'?VF.Stem.UP:n.stemDirection==='down'?VF.Stem.DOWN:multi?(layer%2?VF.Stem.UP:VF.Stem.DOWN):undefined});
                if(n.offsetX)vn.setXShift(n.offsetX);
                for(let di=0;di<(n.dots||([3,1.5,.75,.375].some(d=>Math.abs(d-writtenDuration(n))<1e-6)?1:0));di++)VF.Dot.buildAndAttach([vn],{all:true});
                if(!n.rest&&!part.percussion)n.pitches.forEach((p,k)=>{const info=pitchInfo(p),stateKey=info.step+Math.floor(p/12),alter=info.alter||'',initial=keyAlter(info.step),expected=accidentalState[stateKey]??(initial===1?'#':initial===-1?'b':'');if(alter!==expected){vn.addModifier(new VF.Accidental(alter||'n'),k);accidentalState[stateKey]=alter;}});
                if(n.articulation){const code={staccato:'a.',accent:'a>',tenuto:'a-',fermata:'a@a','strong-accent':'a^',staccatissimo:'av'}[n.articulation];if(code)vn.addModifier(new VF.Articulation(code).setPosition(layer%2===0&&multi?VF.Modifier.Position.BELOW:VF.Modifier.Position.ABOVE),0);}
                if(n.articulation==='detached-legato'){vn.addModifier(new VF.Articulation('a-').setPosition(VF.Modifier.Position.ABOVE),0);vn.addModifier(new VF.Articulation('a.').setPosition(VF.Modifier.Position.ABOVE),0);}
                if(n.lyric)vn.addModifier(new VF.Annotation(n.lyric).setFont('Georgia',11).setVerticalJustification(VF.Annotation.VerticalJustify.BOTTOM),0);
                if(n.expression)vn.addModifier(new VF.Annotation(n.expression).setFont('Georgia',11,'italic').setVerticalJustification(VF.Annotation.VerticalJustify.TOP),0);
                if(n.chord)vn.addModifier(new VF.Annotation(n.chord).setFont('Arial',11).setVerticalJustification(VF.Annotation.VerticalJustify.TOP),0);
                if(!n._pad&&pi===selection.part&&mi===selection.measure&&measure.notes.indexOf(n)===selection.note)vn.setStyle({fillStyle:'#087f72',strokeStyle:'#087f72'});
                vNotes.push(vn);allVNotes.set(n.id,vn);
              }
              const groups=new Map();full.forEach((n,index)=>{if(n.tuplet){const k=n.tuplet.group;if(!groups.has(k))groups.set(k,{definition:n.tuplet,notes:[]});groups.get(k).notes.push(vNotes[index]);}});
              for(const {definition,notes:groupNotes}of groups.values()){const tuplet=new VF.Tuplet(groupNotes,{num_notes:definition.actual,notes_occupied:definition.normal,bracketed:true,ratioed:definition.actual!==3,location:multi&&layer%2===0?-1:1});tupletDraws.push(tuplet);}
              const voice=new VF.Voice({num_beats:score.time[0],beat_value:score.time[1]}).setMode(VF.Voice.Mode.SOFT);voice.addTickables(vNotes);voices.push(voice);beamDraws.push(...VF.Beam.generateBeams(vNotes,{stem_direction:multi?(layer%2?VF.Stem.UP:VF.Stem.DOWN):undefined}));
            }
            new VF.Formatter().joinVoices(voices).format(voices,Math.max(35,stave.getNoteEndX()-stave.getNoteStartX()-18));voices.forEach(v=>v.draw(ctx,stave));beamDraws.forEach(b=>b.setContext(ctx).draw());tupletDraws.forEach(t=>t.setContext(ctx).draw());
            measure.notes.forEach((n,ni)=>{const vn=allVNotes.get(n.id);if(!vn)return;engravedNotes.set(n.id,{vn,ctx,system});if(n.offsetY){const group=vn.getSVGElement?.();if(group)group.setAttribute('transform',`translate(0,${n.offsetY})`);}
              if(n.dynamic){ctx.setFont('Times New Roman',15,'italic bold');ctx.fillText(n.dynamic,vn.getAbsoluteX()-3,y+115);}
              const nx=vn.getAbsoluteX(),ys=vn.getYs(),top=ys.length?Math.min(...ys)-10:y+30,bottom=ys.length?Math.max(...ys)+10:y+70;
              const h=svgRect({x:nx-11,y:top,width:26,height:Math.max(20,bottom-top),class:'note-hit'+(noteLayer(n)!==activeLayer?' inactive-layer':''),'data-note':n.id,'data-part':pi,'data-measure':mi,'data-layer':noteLayer(n)});
              h.setAttribute('role','button');h.setAttribute('aria-label',`${n.rest?'Silencio':n.pitches.map(noteName).join(' + ')} · capa ${noteLayer(n)} · compás ${mi+1}`);
              h.addEventListener('click',e=>{e.stopPropagation();selection={part:pi,measure:mi,note:ni};activeLayer=noteLayer(n);if(tool==='erase')deleteNote();else if((tool==='note'||tool==='rest')&&e.shiftKey){const q=scorePoint(svg,e.clientX,e.clientY),index=Math.round((stave.getYForLine(4)-q.y)/5),base=clef==='bass'?18:clef==='alto'?24:30,dia=base+index;insertPitch(pitchFor('CDEFGAB'[(dia%7+7)%7],Math.floor(dia/7)),false,true);}else{render();if(tool==='lyric')focusInspector('lyric');if(tool==='chord')focusInspector('chord');}});installNoteDrag(h,{part:pi,measure:mi,note:ni,svg,clef,bottom:stave.getYForLine(4)});svg.append(h);hitMap.push({part:pi,measure:mi,note:ni,el:h});
            });
          }catch(e){console.error('Engraving:',e);const msg=document.createElement('span');msg.textContent=`No se pudo dibujar el compás ${mi+1}: ${e.message}`;msg.className='muted';system.append(msg);}

        }
      });
      for(const bracket of score.brackets||[]){if(staves[bracket.start]?.[0]&&staves[bracket.end]?.[0])new VF.StaveConnector(staves[bracket.start][0],staves[bracket.end][0]).setType({bracket:VF.StaveConnector.type.BRACKET,brace:VF.StaveConnector.type.BRACE,line:VF.StaveConnector.type.SINGLE_LEFT}[bracket.type]).setContext(ctx).draw();}
      if (score.parts.length > 1 && staves[0]?.[0]) {
        new VF.StaveConnector(staves[0][0], staves[score.parts.length - 1][0]).setType(VF.StaveConnector.type.SINGLE_LEFT).setContext(ctx).draw();
        for (let p = 0; p < score.parts.length - 1; p++) if (score.parts[p].program === 0 && score.parts[p + 1].program === 0 && score.parts[p].clef === "treble" && score.parts[p + 1].clef === "bass" && !(score.brackets||[]).some(b=>b.start===p&&b.end===p+1&&b.type==='brace')) new VF.StaveConnector(staves[p][0], staves[p + 1][0]).setType(VF.StaveConnector.type.BRACE).setContext(ctx).draw();
      }
    }
    if(page===0)for(const graphic of score.graphics||[]){if(!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(graphic.src))continue;const el=document.createElement('img');el.src=graphic.src;el.alt='Gráfico de la partitura';el.style.cssText=`position:absolute;left:${graphic.x}px;top:${graphic.y}px;width:${graphic.width}px`;sheet.append(el);}
    if(page===0)for(const block of score.textBlocks||[]){const el=document.createElement('div');el.className='score-text';el.textContent=block.text;el.style.cssText=`position:absolute;left:${block.x}px;top:${block.y}px;white-space:pre-wrap;font:16px Georgia;max-width:800px`;sheet.append(el);}
    for(const ossia of (score.ossias||[]).filter(o=>Math.floor(Math.floor(o.measure/perLine)/sysPerPage)===page)){
      const holder=document.createElement('div');holder.className='ossia';holder.style.cssText='margin:12px 65px;font:12px Georgia';const label=document.createElement('div');label.textContent=`${ossia.label} · compás ${ossia.measure+1}`;holder.append(label);sheet.append(holder);
      try{const r=new VF.Renderer(holder,VF.Renderer.Backends.SVG);r.resize(360,95);const c=r.getContext(),st=new VF.Stave(0,0,350).addClef(ossia.clef);st.setContext(c).draw();const notes=ossia.notes.map(n=>new VF.StaveNote({clef:ossia.clef,keys:n.rest?['b/4']:n.pitches.map(p=>pitchInfo(p).key),duration:vfDuration(n)+(n.rest?'r':''),glyph_font_scale:28}));if(notes.length)VF.Formatter.FormatAndDraw(c,st,notes);}catch(e){console.error('Ossia:',e);}
    }
    const foot = document.createElement("div");
    foot.className = "page-foot";
    const titleFoot = document.createElement("span");
    titleFoot.textContent = score.title;
    const pg = document.createElement("span");
    pg.textContent = String(page + 1);
    foot.append(titleFoot, pg);
    sheet.append(foot);
    wrap.append(sheet);
    pages.append(wrap);
  }
  drawTies();
  drawSmartShapes();
}
function drawTies() {
  for (const part of score.parts) {
    for(let layer=1;layer<=4;layer++){
    const all = part.measures.flatMap((m) => m.notes.filter(n=>noteLayer(n)===layer));
    for (let i = 0; i < all.length - 1; i++) {
      const n = all[i], next = all[i + 1];
      if (!n.tie || n.rest || next.rest) continue;
      const from = engravedNotes.get(n.id), to = engravedNotes.get(next.id);
      if (!from || !to) continue;
      const common = n.pitches.map((p, k) => ({ k, j: next.pitches.indexOf(p) })).filter((x) => x.j >= 0);
      if (!common.length) continue;
      const fi = common.map((x) => x.k), li = common.map((x) => x.j);
      try {
        if (from.system === to.system) new VF.StaveTie({ first_note: from.vn, last_note: to.vn, first_indices: fi, last_indices: li }).setContext(from.ctx).draw();
        else {
          new VF.StaveTie({ first_note: from.vn, first_indices: fi, last_indices: li }).setContext(from.ctx).draw();
          new VF.StaveTie({ last_note: to.vn, first_indices: fi, last_indices: li }).setContext(to.ctx).draw();
        }
      } catch (e) {
        console.error("Ligadura:", e);
      }
    }
    }
  }
}
function svgRect(attrs) {
  const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  for (const [k, v] of Object.entries(attrs)) r.setAttribute(k, v);
  r.setAttribute("stroke", "none");
  return r;
}
let chordInput = false;
function bindPianoInput(element, getPitch) {
  const held = new Map();
  element.addEventListener('pointerdown', e => {
    if (!midiRecording || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const pitch = getPitch();
    held.set(e.pointerId, pitch);
    try { element.setPointerCapture(e.pointerId); } catch {}
    handleMidiEvent({type:'on', pitch, velocity:90,
      source:`onscreen-${e.pointerId}`, timestamp:performance.now()/1000});
  });
  const release = e => {
    if (!held.has(e.pointerId)) return;
    const pitch = held.get(e.pointerId);
    held.delete(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
    handleMidiEvent({type:'off', pitch, velocity:0,
      source:`onscreen-${e.pointerId}`, timestamp:performance.now()/1000});
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    element.addEventListener(type, release);
  }
  element.onclick = e => {
    e.stopPropagation();
    if (midiRecording) { e.preventDefault(); return; }
    insertPitch(getPitch(), false, e.shiftKey || chordInput);
  };
}


function renderPiano() {
  const piano = $("piano");
  piano.replaceChildren();
  piano.classList.toggle("drums", !!score.parts[selection.part].percussion);
  if (score.parts[selection.part].percussion) {
    const choose = document.createElement("select");
    choose.title = "Sonido de percusi\xF3n GM";
    choose.id = "drum-sound";
    for (const [pitch, name] of Object.entries(DRUM_NAMES)) {
      const opt = document.createElement("option");
      opt.value = pitch;
      opt.textContent = String(pitch) + " \xB7 " + name;
      choose.append(opt);
    }
    choose.value = "36";
    const insert = document.createElement("button");
    insert.textContent = "A\xF1adir percusi\xF3n";
    insert.className = "primary";
    bindPianoInput(insert, () => Number(choose.value));
    piano.append(choose, insert);
    for (const pitch of [36, 38, 42, 46, 49, 51]) {
      const b = document.createElement("button");
      b.className = "drum-pad";
      b.textContent = DRUM_NAMES[pitch];
      bindPianoInput(b, () => pitch);
      piano.append(b);
    }
    return;
  }
  for (let octave = 3; octave <= 5; octave++) for (const step of "CDEFGAB") {
    const key = document.createElement("div");
    key.className = "white-key";
    key.textContent = step === "C" ? `C${octave}` : step;
    key.setAttribute("role", "button");
    key.setAttribute("aria-label", `${step}${octave}`);
    bindPianoInput(key, () => pitchFor(step, octave));
    if ("CDFGA".includes(step)) {
      const black = document.createElement("div");
      black.className = "black-key";
      black.setAttribute("role", "button");
      black.setAttribute("aria-label", `${step} sostenido ${octave}`);
      bindPianoInput(black, () => (octave + 1) * 12 + { C: 0, D: 2, F: 5, G: 7, A: 9 }[step] + 1);
      key.append(black);
    }
    piano.append(key);
  }
}
function native(action, extra = {}) {
  if (window.webkit?.messageHandlers?.native) {
    window.webkit.messageHandlers.native.postMessage({ action, ...extra });
    return true;
  }
  return false;
}
function download(name, mime, content) {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  if (window.webkit?.messageHandlers?.native) {
    let data = "";
    for (let i = 0; i < bytes.length; i += 32768) data += String.fromCharCode(...bytes.subarray(i, i + 32768));
    native("save", { name, mime, data: btoa(data) });
    return;
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
const filename = () => (score.title || "partitura").replace(/[^\p{L}\p{N}\s_-]/gu, "").slice(0, 80);
function save() {
  if(midiRecording)finishRecording();
  download(filename() + ".rickmusic", "application/json", JSON.stringify(score, null, 2));
  if (!window.webkit?.messageHandlers?.native) markSaved();
}
function markSaved() {
  baseline = JSON.stringify(score);
  render();
  toast("Documento guardado.");
}
function exportXML() {
  try {
    download(filename() + ".musicxml", "application/vnd.recordare.musicxml+xml", toMusicXML(score));
    const warnings=exportWarnings(score,"musicxml");if(warnings.length)toast(warnings.join(" "));
  } catch (e) {
    toast(e.message);
  }
}
async function exportMUSX(){try{const bytes=await toMusx(score);download(filename()+'.musx','application/vnd.makemusic.finale',bytes);toast('Archivo MUSX exportado.');}catch(e){toast('No se pudo exportar MUSX: '+e.message);}}
function exportMIDI() {
  try {
    download(filename() + ".mid", "audio/midi", toMidi(score));
    toast(exportWarnings(score,"midi").join(" "));
  } catch (e) {
    toast(e.message);
  }
}
async function openFile(name, base64) {
  if(midiRecording)finishRecording();
  try {
    stop();
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    let parsed;
    const ext = name.toLowerCase().split(".").pop();
    if(ext === "musx")parsed=await fromMusx(bytes);
    else if (ext === "mxl") {
      const zip = await JSZip.loadAsync(bytes);
      const manifest = await zip.file("META-INF/container.xml")?.async("string");
      const path = manifest?.match(/full-path=["']([^"']+)["']/)?.[1];
      if (!path || !zip.file(path)) throw Error("Contenedor MXL sin una partitura v\xE1lida.");
      parsed = fromMusicXML(await zip.file(path).async("string"));
    } else if (ext === "mid" || ext === "midi") parsed = fromMidi(bytes);
    else if (ext === "xml" || ext === "musicxml") parsed = fromMusicXML(new TextDecoder().decode(bytes));
    else parsed = validateScore(JSON.parse(new TextDecoder().decode(bytes)));
    if (parsed.score) parsed = parsed.score;
    const old = JSON.stringify(score);
    const candidate = validateScore(parsed);
    if (candidate.parts.length > 8 || candidate.parts[0].measures.length > 128) throw Error("Esta interfaz admite hasta 8 pentagramas y 128 compases.");
    for (const p of candidate.parts) for (const m of p.measures) for (const n of m.notes) {
      const base = writtenDuration(n) / (2 - 1 / 2 ** n.dots);
      if (!n.rest && ![4, 2, 1, 0.5, 0.25, 0.125, 0.0625, 0.03125].some((d) => Math.abs(base - d) < 1e-6) && ![3, 1.5, 0.75, 0.375].includes(writtenDuration(n))) throw Error("La partitura contiene duraciones que esta interfaz no puede representar.");
    }
    score = candidate;
    history.push(old);
    future = [];
    selection = { part: 0, measure: 0, note: null };
    persist();
    baseline = JSON.stringify(score);
    render();
    toast(score.warnings?.length ? score.warnings.join(" ") : `Abierto: ${name}`);
  } catch (e) {
    toast(`No se pudo abrir: ${e.message}`);
  }
}
function open() {
  if (!native("open")) $("file").click();
}
function printHTML() {
  const clone = $("pages").cloneNode(true);
  clone.querySelectorAll(".measure-hit,.note-hit").forEach((n) => n.remove());
  clone.querySelectorAll(".sheet").forEach((n) => {
    n.style.transform = "none";
    n.style.position = "relative";
    n.style.left = "0";
    n.style.top = "0";
  });
  clone.querySelectorAll(".sheet-wrap").forEach((n) => {
    n.style.width = "1000px";
    n.style.height = "auto";
  });
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;padding:0;background:white;color:#111;font-family:Georgia}#pages{display:block;width:1000px}.sheet-wrap{position:relative;margin:0;padding:0;width:1000px}.sheet{width:1000px;min-height:1260px;padding:56px 45px 40px;margin:0;position:relative;background:#fff}.score-heading{text-align:center;margin:8px 0 24px;min-height:96px}.score-heading h1{font:36px Georgia;margin:0 0 13px;font-weight:400}.subtitle{font:10px Arial;letter-spacing:2px;color:#82918c}.composer{text-align:right;font:15px Georgia;margin:22px 12px 0}.tempo-mark{font:italic 14px Georgia;margin-left:65px}.system{position:relative}.system svg{display:block;overflow:visible}.page-foot{position:absolute;bottom:30px;left:45px;right:45px;display:flex;justify-content:space-between;color:#82918c;font:11px Georgia}</style></head><body>' + clone.outerHTML + "</body></html>";
}
function print() {
  if (!native("pdf")) window.print();
}
function dialog(title, fields, onSubmit) {
  const form = $("dialogform");
  form.replaceChildren();
  const heading = document.createElement("h2");
  heading.textContent = title;
  form.append(heading);
  fields.forEach((field) => {
    const label = document.createElement("label");
    label.textContent = field.label;
    let input;
    if (field.options) {
      input = document.createElement("select");
      field.options.forEach((o) => {
        const opt = document.createElement("option");
        opt.value = Array.isArray(o) ? o[0] : o;
        opt.textContent = Array.isArray(o) ? o[1] : o;
        input.append(opt);
      });
    } else {
      input = document.createElement("input");
      input.type = field.type || "text";
      if (field.min !== void 0) input.min = field.min;
      if (field.max !== void 0) input.max = field.max;
    }
    input.name = field.name;
    input.value = field.value ?? "";
    label.append(input);
    form.append(label);
  });
  const actions = document.createElement("div");
  actions.className = "actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancelar";
  cancel.onclick = () => $("dialog").close();
  const ok = document.createElement("button");
  ok.className = "primary";
  ok.textContent = "Aceptar";
  ok.type = "submit";
  actions.append(cancel, ok);
  form.append(actions);
  form.onsubmit = (e) => {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    $("dialog").close();
    try {
      onSubmit(values);
    } catch (e2) {
      toast(e2.message);
    }
  };
  $("dialog").showModal();
}
function confirmAction(title, text, fn) {
  dialog(title, [], fn);
  const p = document.createElement("p");
  p.textContent = text;
  $("dialogform").querySelector("h2").after(p);
}
function newScore() {
  if(midiRecording)finishRecording();
  dialog("Nueva partitura", [{ name: "title", label: "T\xEDtulo", value: "Sin t\xEDtulo" }, { name: "composer", label: "Compositor" }, { name: "template", label: "Plantilla", value: "baritone-piano", options: [["baritone-piano", "Bar\xEDtono y piano"], ["baritone", "Bar\xEDtono (voz)"], ["choir", "Coro SATB"], ["piano", "Piano \xB7 dos pentagramas"], ["solo", "Instrumento solista"], ["quartet", "Cuarteto de cuerdas"]] }, { name: "measures", label: "Compases", type: "number", value: 8, min: 1, max: 128 }, { name: "time", label: "Comp\xE1s", value: "4/4", options: ["4/4", "3/4", "2/4", "6/8", "5/4"] }, { name: "key", label: "Armadura", value: "C", options: KEYS }], (v) => {
    stop();
    snapshot();
    activeLayer=1;tupletInput=null;$("tuplet").classList.remove("active");score = createFromTemplate({ ...v, measures: Number(v.measures), time: v.time.split("/").map(Number) });
    selection = { part: 0, measure: 0, note: null };
    $("octave").value = score.parts[0].clef === "bass" ? 3 : 4;
    persist();
    render();
  });
}
function instrumentPicker(title, initial, onChoose, existingName = "") {
  dialog(title, [{ name: "instrument", label: "Instrumento", value: initial, options: INSTRUMENTS.map((i) => [i.id, `${i.family} \xB7 ${i.name}`]) }, { name: "partName", label: "Nombre en la partitura (opcional)", value: existingName }], (v) => {
    const i = instrumentById(v.instrument);
    if (!i) throw Error("Selecciona un instrumento.");
    onChoose(i, v.partName.trim());
  });
  const form = $("dialogform"), select = form.querySelector('[name="instrument"]'), label = select.closest("label");
  const filters = document.createElement("div");
  filters.className = "row";
  const search = document.createElement("input");
  search.placeholder = "Buscar: bar\xEDtono, viol\xEDn, flauta\u2026";
  search.type = "search";
  search.setAttribute("aria-label", "Buscar instrumento");
  search.id = "instrument-search";
  const family = document.createElement("select");
  family.setAttribute("aria-label", "Familia");
  family.id = "instrument-family";
  for (const f of ["Todas las familias", ...new Set(INSTRUMENTS.map((i) => i.family))]) {
    const opt = document.createElement("option");
    opt.textContent = f;
    family.append(opt);
  }
  filters.append(search, family);
  label.before(filters);
  const info = document.createElement("p");
  info.id = "instrument-info";
  label.after(info);
  function describe() {
    const i = instrumentById(select.value);
    info.textContent = i ? `${i.name} \xB7 Clave de ${i.clef === "bass" ? "fa" : i.clef === "alto" ? "do" : i.clef === "percussion" ? "percusi\xF3n" : "sol"}${i.range[0] !== 0 ? " \xB7 " + noteName(i.range[0]) + "\u2013" + noteName(i.range[1]) : ""}. ${i.hint}.` : "No hay coincidencias.";
  }
  function filter() {
    const current = select.value, query = search.value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    select.replaceChildren();
    for (const i of INSTRUMENTS.filter((i2) => (family.selectedIndex === 0 || i2.family === family.value) && `${i2.name} ${i2.family}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().includes(query))) {
      const opt = document.createElement("option");
      opt.value = i.id;
      opt.textContent = i.name;
      select.append(opt);
    }
    if ([...select.options].some((o) => o.value === current)) select.value = current;
    form.querySelector('[type="submit"]').disabled = !select.options.length;
    describe();
  }
  search.oninput = filter;
  family.onchange = filter;
  select.onchange = describe;
  describe();
  search.focus();
}
function addPart() {
  instrumentPicker("A\xF1adir instrumento", "voice-baritone", (i, name) => mutate(() => {
    if (score.parts.length >= 8) throw Error("M\xE1ximo de 8 pentagramas en esta versi\xF3n.");
    if (i.percussion && score.parts.some((p2) => p2.percussion)) throw Error("La partitura ya tiene una bater\xEDa.");
    const p = makePart(i, score.parts[0].measures.length);
    if (name) p.name = name;
    score.parts.push(p);
    selection.part = score.parts.length - 1;
    selection.note = null;
    $("octave").value = i.clef === "bass" ? 3 : 4;
  }));
}
function editPart(pi) {
  const p = score.parts[pi];
  instrumentPicker("Editar instrumento", p.instrumentId || `gm-${p.program}`, (i, name) => mutate(() => {
    if (i.percussion && score.parts.some((p2, index) => index !== pi && p2.percussion)) throw Error("La partitura ya tiene una bater\xEDa.");
    const replacement = makePart(i, p.measures.length);
    Object.assign(p, { ...replacement, id: p.id, measures: p.measures, name: name || i.name, volume: p.volume, muted: p.muted });
  }), p.name);
}
function getAudio() {
  // Web Audio defaults to ambient on iOS and is then muted by the Silent switch.
  // Request the music playback category before creating or resuming the context.
  try {
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
  } catch {
    // Browsers without a writable Audio Session API keep their normal Web Audio path.
  }
  if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
  if (audio.state === "suspended") audio.resume();
  return audio;
}
function synth(pitch, start, length, volume, program = 0) {
  const a = getAudio(), gain = a.createGain(), osc = a.createOscillator();
  osc.type = program >= 40 && program < 56 ? "triangle" : program >= 56 ? "sawtooth" : "triangle";
  osc.frequency.value = 440 * 2 ** ((pitch - 69) / 12);
  const filter = a.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = program === 0 ? 2400 : 3800;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(Math.max(1e-4, volume * 0.11), start + 0.012);
  gain.gain.exponentialRampToValueAtTime(Math.max(1e-4, volume * 0.035), start + Math.max(0.04, length * 0.75));
  gain.gain.exponentialRampToValueAtTime(1e-4, start + length + 0.08);
  osc.connect(filter);
  filter.connect(gain);
  gain.connect(a.destination);
  osc.start(start);
  osc.stop(start + length + 0.1);
  activeOsc.push(osc);
  osc.onended = () => {
    gain.disconnect();
    filter.disconnect();
    const i = activeOsc.indexOf(osc);
    if (i >= 0) activeOsc.splice(i, 1);
  };
}
function audition(pitch) {
  const p = score.parts[selection.part];
  pitch=Math.max(0,Math.min(127,pitch-(p.transpose||0)));
  if (!nativeAudioFailed && native("audition", { pitch, program: p.program, volume: p.volume, percussion: !!p.percussion })) return;
  try {
    synth(pitch, getAudio().currentTime, 0.23, 0.6, score.parts[selection.part].program);
  } catch {
  }
}
function stop() {
  native("stop");
  playing = false;
  playTimers.forEach(clearTimeout);
  playTimers = [];
  activeOsc.forEach((o) => {
    try {
      o.stop();
    } catch {
    }
  });
  activeOsc = [];
  $$(".playing-note").forEach((x) => x.classList.remove("playing-note"));
  $("play").textContent = "\u25B6 Reproducir";
}
async function play() {
  if(midiRecording)finishRecording();
  if (playing) {
    stop();
    return;
  }
  try {
    const useNative = !nativeAudioFailed && !!window.webkit?.messageHandlers?.native;
    const a = useNative ? { currentTime: 0 } : getAudio();
    if (!useNative) await a.resume();
    const nativeParts = [];
    playing = true;
    $("play").textContent = "\u275A\u275A Detener";
    const timeline=buildPlayback(score),start=a.currentTime+.12;
    timeline.parts.forEach((p,pi)=>{if(p.muted)return;for(const n of p.notes)if(!useNative)synth(n.pitch,start+n.at,n.duration,n.velocity/127*p.volume,p.program);
      for(const e of p.visual){playTimers.push(setTimeout(()=>hitMap.find(h=>h.part===pi&&h.measure===e.mi&&h.note===e.ni)?.el.classList.add('playing-note'),(e.start+.12)*1000));playTimers.push(setTimeout(()=>hitMap.find(h=>h.part===pi&&h.measure===e.mi&&h.note===e.ni)?.el.classList.remove('playing-note'),(e.start+e.duration+.12)*1000));}});
    if(useNative)native('play',{parts:timeline.parts.map(({visual,...p})=>p),tempo:score.tempo,metronome});
    if(metronome){const clickStart=getAudio().currentTime+.12;for(const segment of timeline.segments)for(let b=0;b<timeline.beats;b++)synth(b===0?96:89,clickStart+segment.start+b*segment.beat,.035,.25,0);}
    playTimers.push(setTimeout(()=>stop(),(timeline.duration+.4)*1000));
    $("status").textContent = useNative ? "Reproducci\xF3n con instrumentos de macOS" : "Reproducci\xF3n con s\xEDntesis local";
  } catch (e) {
    stop();
    toast("No se pudo iniciar el audio: " + e.message);
  }
}
function drawSmartShapes(){
 for(const shape of score.smartShapes||[]){const a=engravedNotes.get(shape.startNoteId),b=engravedNotes.get(shape.endNoteId);if(!a||!b)continue;
 const draw=(first,last,x1,x2)=>{const svg=first.system.querySelector('svg'),ys1=first.vn.getYs(),ys2=last.vn.getYs(),above=shape.type==='slur',y1=(above?Math.min(...ys1)-18:Math.max(...ys1)+35),y2=(above?Math.min(...ys2)-18:Math.max(...ys2)+35),p=document.createElementNS('http://www.w3.org/2000/svg','path');let d;
 if(shape.type==='slur')d=`M${x1} ${y1} Q${(x1+x2)/2} ${Math.min(y1,y2)-30} ${x2} ${y2}`;
 else if(shape.type==='line')d=`M${x1} ${y1} L${x2} ${y2}`;
 else {const openStart=shape.type==='diminuendo';d=`M${x1} ${y1-(openStart?8:0)} L${x2} ${y2-(openStart?0:8)} M${x1} ${y1+(openStart?8:0)} L${x2} ${y2+(openStart?0:8)}`;}
 for(const[k,v]of Object.entries({d,fill:'none',stroke:'#172d2d','stroke-width':1.4,'pointer-events':'none','data-smart-shape':shape.id}))p.setAttribute(k,v);svg.append(p);};
 if(a.system===b.system)draw(a,b,a.vn.getAbsoluteX()+5,b.vn.getAbsoluteX()+5);else{draw(a,a,a.vn.getAbsoluteX()+5,895);draw(b,b,95,b.vn.getAbsoluteX()+5);}
 }
}
function graphicsDialog(){dialog('Gráficos',[{name:'action',label:'Acción',value:'export',options:[['export','Exportar partitura en SVG'],['import','Colocar imagen PNG o JPEG'],['remove','Quitar última imagen colocada']]}],v=>{if(v.action==='export')return exportSVG();if(v.action==='remove')return mutate(()=>score.graphics?.pop());const input=document.createElement('input');input.type='file';input.accept='image/png,image/jpeg';input.onchange=async()=>{try{const file=input.files[0];if(!file)return;if(file.size>10*1024*1024)throw Error('La imagen debe ocupar menos de 10 MB.');const bytes=new Uint8Array(await file.arrayBuffer()),isPNG=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71,isJPEG=bytes[0]===255&&bytes[1]===216;if(!isPNG&&!isJPEG)throw Error('Elige una imagen PNG o JPEG válida.');let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));const src=`data:image/${isPNG?'png':'jpeg'};base64,${btoa(binary)}`;dialog('Colocar imagen',[{name:'x',label:'Posición horizontal',type:'number',value:100,min:0,max:1000},{name:'y',label:'Posición vertical',type:'number',value:100,min:0,max:1400},{name:'width',label:'Ancho',type:'number',value:180,min:10,max:900}],v=>mutate(()=>{const x=Number(v.x),y=Number(v.y),width=Number(v.width);if(![x,y,width].every(Number.isFinite)||x<0||x>1000||y<0||y>1400||width<10||width>900)throw Error('Posición o ancho de imagen inválido.');(score.graphics??=[]).push({id:uid(),src,x,y,width});}));}catch(e){toast(e.message);}};input.click();});}

function exportSVG(){
 const ns='http://www.w3.org/2000/svg',root=document.createElementNS(ns,'svg');root.setAttribute('xmlns',ns);const sheets=$$('.sheet');let y=0;
 for(const sheet of sheets){const h=Number.parseFloat(sheet.style.minHeight)||1260,g=document.createElementNS(ns,'g');g.setAttribute('transform',`translate(0,${y})`);const bg=document.createElementNS(ns,'rect');for(const[k,v]of Object.entries({width:1000,height:h,fill:'#fffefa'}))bg.setAttribute(k,v);g.append(bg);
  const text=(value,x,py,size=16,anchor='start')=>{const t=document.createElementNS(ns,'text');for(const[k,v]of Object.entries({x,y:py,'font-size':size,'font-family':'Georgia,serif','text-anchor':anchor,fill:'#111'}))t.setAttribute(k,v);t.textContent=value;g.append(t);};text(score.title,500,100,36,'middle');text(score.composer,940,170,15,'end');
  const base=sheet.getBoundingClientRect(),scale=base.width/1000;const tempoElement=sheet.querySelector('.tempo-mark');if(tempoElement?.hasAttribute('aria-label'))text(tempoElement.getAttribute('aria-label'),110,(tempoElement.getBoundingClientRect().top-base.top)/scale+14,14);for(const svg of sheet.querySelectorAll('.system svg,.ossia svg')){const box=svg.getBoundingClientRect(),clone=svg.cloneNode(true);clone.querySelectorAll('.note-hit,.measure-hit').forEach(n=>n.remove());clone.setAttribute('x',(box.left-base.left)/scale);clone.setAttribute('y',(box.top-base.top)/scale);g.append(clone);}for(const block of score.textBlocks||[])text(block.text,block.x,block.y+16);
  for(const graphic of score.graphics||[]){const image=document.createElementNS(ns,'image');for(const[k,v]of Object.entries({href:graphic.src,x:graphic.x,y:graphic.y,width:graphic.width,height:graphic.width,preserveAspectRatio:'xMinYMin meet'}))image.setAttribute(k,v);g.append(image);}
  root.append(g);y+=h;
 }root.setAttribute('width','1000');root.setAttribute('height',String(y));root.setAttribute('viewBox',`0 0 1000 ${y}`);download(score.title+'.svg','image/svg+xml',new XMLSerializer().serializeToString(root));
}
function editRegion(){dialog('Editar región',[{name:'start',label:'Primer compás',type:'number',value:selection.measure+1,min:1,max:score.parts[0].measures.length},{name:'end',label:'Último compás',type:'number',value:selection.measure+1,min:1,max:score.parts[0].measures.length},{name:'scope',label:'Pentagramas',value:'selected',options:[['selected','Seleccionado'],['all','Todos']]},{name:'action',label:'Acción',options:[['transpose','Transportar'],['copy','Copiar al destino'],['clear','Vaciar']]},{name:'semitones',label:'Semitonos',type:'number',value:0,min:-48,max:48},{name:'destination',label:'Compás de destino al copiar',type:'number',value:Math.min(selection.measure+2,score.parts[0].measures.length),min:1,max:score.parts[0].measures.length}],v=>mutate(()=>{const a=Number(v.start)-1,b=Number(v.end)-1,target=Number(v.destination)-1,delta=Number(v.semitones),count=score.parts[0].measures.length;if(![a,b,target,delta].every(Number.isInteger)||a<0||b<a||b>=count||target<0||target>=count||Math.abs(delta)>48)throw Error('Región o valores inválidos.');const parts=v.scope==='all'?score.parts:[score.parts[selection.part]];for(const part of parts){const copies=structuredClone(part.measures.slice(a,b+1));if(v.action==='copy'&&target+copies.length>count)throw Error('La región copiada excede los compases disponibles.');for(let i=a;i<=b;i++)if(v.action==='clear')part.measures[i].notes=[];else if(v.action==='transpose')for(const n of part.measures[i].notes)n.pitches=n.pitches.map(p=>p+delta);if(v.action==='copy')for(const[i,m]of copies.entries()){const groups=new Map();for(const n of m.notes){n.id=uid();if(n.tuplet){if(!groups.has(n.tuplet.group))groups.set(n.tuplet.group,uid());n.tuplet.group=groups.get(n.tuplet.group);}}part.measures[target+i]=m;}}}));}
function addOssia(){dialog('Ossia del compás seleccionado',[{name:'label',label:'Nombre de la alternativa',value:'Ossia'},{name:'semitones',label:'Transportar alternativa (semitonos)',type:'number',value:12,min:-48,max:48}],v=>mutate(()=>{const delta=Number(v.semitones);if(!Number.isInteger(delta)||Math.abs(delta)>48)throw Error('Transposición inválida.');const part=score.parts[selection.part],m=part.measures[selection.measure],notes=structuredClone(m.notes.filter(n=>noteLayer(n)===activeLayer));if(!notes.length)throw Error('La capa seleccionada está vacía.');if(notes.some(n=>n.tuplet))throw Error('La vista ossia todavía requiere ritmo regular.');for(const n of notes){n.id=uid();n.pitches=n.pitches.map(p=>p+delta);if(n.pitches.some(p=>p<0||p>127))throw Error('La alternativa excede el registro MIDI.');}(score.ossias??=[]).push({id:uid(),label:String(v.label),partId:part.id,measure:selection.measure,clef:part.clef,notes});}));}
function initToolbox(){
 const captions={bracket:'Corchete',chord:'Acordes',hand:'Mano',hyperscribe:'HyperScribe',region:'Región','measure-legacy':'Compás*','measure-number':'Número*',staff:'Pentagrama',articulation:'Articular','note-mover':'Mover','page-layout':'Página',repeat:'Repetir','simple-entry':'Simple','smart-shape':'Formas','special-tools':'Especial','speedy-entry':'Rápida','staff-legacy':'Atributos*','staff-expression':'Expres.*',time:'Métrica',transcription:'Transcribir',tuplet:'Grupos',select:'Selección'};
 const palette=$('tool-palette');for(const def of TOOL_DEFINITIONS){const button=document.createElement('button');button.dataset.finaleTool=def.id;button.title=`${def.label}${def.legacy?' · acceso histórico':''}: ${def.description}`;button.setAttribute('aria-label',def.label);button.innerHTML=def.svg;const label=document.createElement('small');label.textContent=captions[def.id]||def.label;button.append(label);if(def.legacy)button.classList.add('legacy-tool');button.onclick=()=>{try{runTool(def.id,{score,selection,getNote:selectedNote,mutate,dialog,toast,setTool,callbacks:{chord:()=>{setTool('chord');focusInspector('chord');},lyric:()=>{setTool('lyric');focusInspector('lyric');},tuplet:()=>selectedNote()?convertTuplet():setTupletMode(),hand:()=>setTool('hand'),zoom:()=>{$('zoom').focus();$('zoom').click();},graphics:graphicsDialog,region:editRegion,ossia:addOssia,hyperscribe:()=>recordDialog('HyperScribe'),transcription:()=>recordDialog('Transcripción'),speedy:()=>{setTool('note');toast('Entrada rápida: A–G, 1–5 duración, Mayúsculas para acordes; MIDI disponible en HyperScribe.');}}});}catch(e){toast(e.message);}};palette.append(button);}
 const canvas=$('canvas');let drag=null;canvas.addEventListener('pointerdown',e=>{if(tool!=='hand')return;drag={x:e.clientX,y:e.clientY,left:canvas.scrollLeft,top:canvas.scrollTop};canvas.setPointerCapture(e.pointerId);e.preventDefault();});canvas.addEventListener('pointermove',e=>{if(!drag)return;canvas.scrollLeft=drag.left-e.clientX+drag.x;canvas.scrollTop=drag.top-e.clientY+drag.y;});canvas.addEventListener('pointerup',()=>drag=null);
}
let midiRecording=null,webMidiAccess=null;
function midiStatus(status){if(midiRecording)toast(status.error||`${status.count||0} entrada(s) MIDI: ${(status.names||[]).join(', ')||'puedes interpretar con A–G'}`);}
function recordDialog(name){if(midiRecording){finishRecording();return;}dialog(name,[{name:'grid',label:'Cuantización',value:'.25',options:[['1','Negra'],['.5','Corchea'],['.25','Semicorchea'],['.3333333333333333','Tresillo de corchea']]},{name:'mode',label:'Al terminar',value:'replace',options:[['replace',`Reemplazar desde compás ${selection.measure+1} de este instrumento`]]}],v=>{
 stop();document.body.dataset.recording='true';midiRecording={grid:Number(v.grid),part:selection.part,measure:selection.measure,started:performance.now()/1000,clocks:new Map(),held:new Map(),events:[]};$('record-stop').hidden=false;$('record-stop').textContent='● Finalizar grabación';
 if(!native('startMidi')){if(navigator.requestMIDIAccess)navigator.requestMIDIAccess({sysex:false}).then(access=>{webMidiAccess=access;const connect=()=>{for(const input of access.inputs.values())input.onmidimessage=e=>{const[status,pitch,velocity]=e.data,kind=status&240;if(kind===144||kind===128)handleMidiEvent({type:kind===144&&velocity?'on':'off',pitch,velocity,timestamp:e.timeStamp/1000,source:input.id,channel:status&15});};};connect();access.onstatechange=connect;}).catch(e=>toast('MIDI no disponible: '+e.message+' · puedes usar A–G.'));}
 toast('Grabando: toca el piano de pantalla, tu teclado MIDI o A–G; Finalizar convierte la interpretación en notas.');});}
function handleMidiEvent(event){const r=midiRecording;if(!r)return;const source=event.source||'keyboard',channel=event.channel||0,key=`${source}:${channel}:${event.pitch}`,clock=Number(event.timestamp)||performance.now()/1000;if(!r.clocks.has(source))r.clocks.set(source,performance.now()/1000-clock);const at=Math.max(0,clock+r.clocks.get(source)-r.started);if(event.type==='on'&&event.velocity){if(r.held.has(key))return;r.held.set(key,{pitch:event.pitch,velocity:event.velocity,start:at});audition(event.pitch);}else{const held=r.held.get(key);if(held){r.events.push({...held,end:Math.max(held.start+.03,at)});r.held.delete(key);}}}
function finishRecording(){const r=midiRecording;if(!r)return;const end=performance.now()/1000-r.started;for(const held of r.held.values())r.events.push({...held,end:Math.max(held.start+.03,end)});midiRecording=null;delete document.body.dataset.recording;native('stopMidi');if(webMidiAccess){webMidiAccess.onstatechange=null;for(const input of webMidiAccess.inputs.values())input.onmidimessage=null;}$('record-stop').hidden=true;if(!r.events.length){toast('Grabación terminada sin notas.');return;}
 try{const first=Math.min(...r.events.map(e=>e.start)),beat=60/score.tempo,ppq=960,events=[];for(const e of r.events){const at=Math.round((e.start-first)/beat/r.grid)*r.grid,until=Math.max(at+r.grid,Math.round((e.end-first)/beat/r.grid)*r.grid);events.push({tick:Math.round(at*ppq),type:'noteOn',channel:0,noteNumber:e.pitch,velocity:e.velocity},{tick:Math.round(until*ppq),type:'noteOff',channel:0,noteNumber:e.pitch,velocity:0});}events.sort((a,b)=>a.tick-b.tick||(a.type==='noteOff'?-1:1));let previous=0;const track=[{deltaTime:0,type:'trackName',text:'Interpretación'},{deltaTime:0,type:'setTempo',microsecondsPerBeat:Math.round(60000000/score.tempo)},{deltaTime:0,type:'timeSignature',numerator:score.time[0],denominator:score.time[1],metronome:24,thirtyseconds:8},...events.map(({tick,...e})=>{const result={...e,deltaTime:tick-previous};previous=tick;return result;}),{deltaTime:0,type:'endOfTrack'}];const imported=fromMidi(Uint8Array.from(writeMidi({header:{format:0,ticksPerBeat:ppq},tracks:[track]})));mutate(()=>{const part=score.parts[r.part],measures=imported.parts[0].measures,needed=r.measure+measures.length;if(needed>128)throw Error('La grabación excede 128 compases.');while(score.parts[0].measures.length<needed)for(const p of score.parts)p.measures.push({notes:[]});for(const[i,m]of measures.entries())part.measures[r.measure+i]=m;selection={part:r.part,measure:r.measure,note:null};});toast(`Interpretación convertida: ${r.events.length} notas capturadas.`);}catch(e){toast('No se pudo transcribir: '+e.message);}
}
document.addEventListener('keyup',e=>{if(midiRecording&&/^[a-g]$/i.test(e.key))handleMidiEvent({type:'off',pitch:pitchFor(e.key.toUpperCase(),Number($('octave').value)),velocity:0,timestamp:performance.now()/1000});});

let mp3Job=null;
function mp3Progress(value){if(!mp3Job)return;const percent=Math.max(0,Math.min(100,Math.round(value*100)));$('status').textContent=`Exportando MP3 · ${percent}%`;}
function resetMp3UI(){$('mp3').disabled=false;$('cancel-mp3').hidden=true;}
function failMp3(message){const job=mp3Job;if(!job)return;job.cancelled=true;mp3Job=null;if(job.native)native('cancelAudioExport',{jobId:job.id});resetMp3UI();toast('No se pudo exportar MP3: '+message);}
function cancelMP3(){if(!mp3Job)return;const job=mp3Job;job.cancelled=true;mp3Job=null;if(job.native)native('cancelAudioExport',{jobId:job.id});resetMp3UI();toast('Exportación MP3 cancelada.');}
function finishMp3(job){if(mp3Job!==job||job.cancelled)return;try{const bytes=job.encoder.finish();download(job.name+'.mp3','audio/mpeg',bytes);mp3Job=null;resetMp3UI();toast('MP3 generado · '+job.bitrate+' kb/s · estéreo.');}catch(e){failMp3(e.message);}}
function audioExportBegin(message){const job=mp3Job;if(!job||message.jobId!==job.id)return null;try{job.encoder=createMp3Stream({sampleRate:message.sampleRate,channels:message.channels,bitrate:job.bitrate,title:job.title,composer:job.composer});mp3Progress(.01);}catch(e){failMp3(e.message);}return null;}
function audioExportChunk(message){const job=mp3Job;if(!job||message.jobId!==job.id)return null;try{if(!job.encoder)throw Error('No se inició el codificador MP3.');job.encoder.write(pcm16FromBase64(message.left),pcm16FromBase64(message.right));mp3Progress(message.progress??0);}catch(e){failMp3(e.message);}return null;}
function audioExportEnd(message){const job=mp3Job;if(job&&message.jobId===job.id)finishMp3(job);return null;}
function audioExportError(message){if(mp3Job&&message.jobId===mp3Job.id)failMp3(message.message||'El motor de audio no pudo renderizar la partitura.');return null;}
async function encodeBrowserMP3(job,timeline){try{const buffer=await renderBrowserAudio(timeline,{cancelled:()=>job.cancelled,onProgress:mp3Progress});if(!buffer||mp3Job!==job)return;job.encoder=createMp3Stream({sampleRate:buffer.sampleRate,channels:2,bitrate:job.bitrate,title:job.title,composer:job.composer});const left=buffer.getChannelData(0),right=buffer.getChannelData(1),block=32768;for(let i=0;i<left.length;i+=block){if(job.cancelled||mp3Job!==job)return;job.encoder.write(floatToInt16(left.subarray(i,i+block)),floatToInt16(right.subarray(i,i+block)));mp3Progress(.45+.55*Math.min(1,(i+block)/left.length));await new Promise(resolve=>setTimeout(resolve,0));}finishMp3(job);}catch(e){if(mp3Job===job)failMp3(e.message);}}
function exportMP3(){if(mp3Job){toast('Ya se está exportando un MP3.');return;}if(midiRecording)finishRecording();stop();const useNative=!!window.webkit?.messageHandlers?.native;
 dialog('Exportar MP3',[{name:'bitrate',label:'Calidad de audio',value:'192',options:[['128','128 kb/s · archivo compacto'],['192','192 kb/s · calidad alta'],['256','256 kb/s · calidad superior'],['320','320 kb/s · máxima calidad']]}],v=>{try{const bitrate=Number(v.bitrate);if(![128,192,256,320].includes(bitrate))throw Error('Calidad MP3 inválida.');const timeline=buildPlayback(score);const maxSeconds=!useNative&&matchMedia('(pointer: coarse)').matches?300:1800;if(timeline.duration>maxSeconds)throw Error(maxSeconds===300?'En dispositivos táctiles, la exportación MP3 admite hasta 5 minutos por archivo.':'La exportación MP3 admite hasta 30 minutos por archivo.');if(!timeline.parts.some(p=>!p.muted&&p.notes.length))throw Error('Añade notas a un instrumento audible antes de exportar.');const job={id:uid(),name:filename(),title:score.title,composer:score.composer,bitrate,native:useNative,cancelled:false,encoder:null};mp3Job=job;$('mp3').disabled=true;$('cancel-mp3').hidden=false;mp3Progress(0);if(useNative)native('renderAudio',{jobId:job.id,parts:timeline.parts.map(({visual,...part})=>part),duration:timeline.duration});else encodeBrowserMP3(job,timeline);}catch(e){toast(e.message);}});
 const info=document.createElement('p');info.textContent=useNative?'Se exportan los instrumentos de macOS, las cuatro capas, dinámicas, tempo y repeticiones. Audio estéreo a 44,1 kHz; incluye la cola de sonido.':'La edición web exporta su síntesis local. Las capas, velocidades, tempo y repeticiones se conservan; los timbres son aproximados. Audio estéreo a 44,1 kHz. En dispositivos táctiles se admiten hasta 5 minutos por archivo.';$('dialogform').querySelector('h2').after(info);
}

function help() {
  dialog("Escribir en Rick Music", [], () => {
  });
  const text = document.createElement("div");
  text.innerHTML = "<p>En móvil, abre <b>Herramientas</b> o <b>Documento</b> para editar. Usa <b>Ajustar</b> y el zoom para ver la partitura; desliza las barras para acceder al resto de controles. Activa <b>＋ Acorde</b> para añadir alturas con el piano táctil.</p><p><b>1.</b> Selecciona un comp\xE1s y una duraci\xF3n. Usa A\u2013G o el teclado inferior para a\xF1adir notas. El comp\xE1s lleno avanza al siguiente.</p><p><b>2.</b> Activa \xABNotas\xBB para escribir con el rat\xF3n. May\xFAsculas + clic en una nota a\xF1ade una altura al acorde.</p><p><b>3.</b> Haz clic en una nota para editar duraci\xF3n, puntillo, alteraci\xF3n, letra, acorde, din\xE1mica o articulaci\xF3n.</p><p><b>Atajos:</b> N notas \xB7 R silencios \xB7 Esc selecci\xF3n \xB7 1\u20135 duraci\xF3n \xB7 . puntillo \xB7 \u2191\u2193 semitono \xB7 \u2190\u2192 selecci\xF3n \xB7 Supr borrar \xB7 Espacio reproducir \xB7 \u2318Z deshacer \xB7 \u2318S guardar.</p><p>Se admiten cuatro capas por pentagrama, grupos irregulares y comp\xE1s/armadura constantes. La transposición escrita se configura con la herramienta Pentagrama. La app para Mac utiliza los instrumentos del sistema. Las voces usan un timbre coral; su registro se distingue por las notas escritas. Consulta LEEME para los l\xEDmites de esta reconstrucci\xF3n.</p>";
  $("dialogform").querySelector("h2").after(text);
}
[...KEYS, "Am", "Em", "Bm", "F#m", "C#m", "G#m", "D#m", "A#m", "Dm", "Gm", "Cm", "Fm", "Bbm", "Ebm", "Abm"].forEach((k) => {
  const o = document.createElement("option");
  o.value = k;
  o.textContent = k;
  $("key").append(o);
});
initToolbox();
$("record-stop").onclick=finishRecording;
$("mp3").onclick=exportMP3;$("cancel-mp3").onclick=cancelMP3;
$$("[data-tool]").forEach((b) => b.onclick = () => setTool(b.dataset.tool));
$$("[data-dur]").forEach((b) => b.onclick = () => setDuration(Number(b.dataset.dur)));
$$("[data-acc]").forEach((b) => b.onclick = () => {
  accidental = Number(b.dataset.acc);
  $$("[data-acc]").forEach((x) => x.classList.toggle("active", x === b));
  const n = selectedNote();
  if (n && !n.rest) mutate(() => {
    n.pitches = n.pitches.map((p) => {
      const info = pitchInfo(p);
      return Math.floor(p / 12) * 12 + { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[info.step] + accidental;
    });
  });
});
$("dot").onclick = () => {
  dotted = !dotted;
  $("dot").classList.toggle("active", dotted);
  if (selectedNote()) mutate(() => {
    const n = selectedNote();
    const base = n.duration / (2-1/2**(n.dots||0));
    n.dots = dotted ? 1 : 0;
    n.duration = base * (dotted ? 1.5 : 1);
  });
};
$("tie").onclick = () => {
  if (selectedNote()) mutate(() => {
    const part = score.parts[selection.part], m = part.measures[selection.measure];
    const n=selectedNote(),notes=measureLayers(m)[noteLayer(n)-1],index=notes.indexOf(n),within=notes[index+1],next=within||measureLayers(part.measures[selection.measure+1]||{notes:[]})[noteLayer(n)-1][0];
    if (!n.tie && !within && notes.reduce((a,n2)=>a+n2.duration,0) < beatsPerMeasure(score) - 1e-5) throw Error("Completa el comp\xE1s antes de ligar una nota al siguiente.");
    if (!n.tie && (!next || n.rest || next.rest || JSON.stringify([...n.pitches].sort()) !== JSON.stringify([...next.pitches].sort()))) throw Error("La ligadura necesita una nota o acorde siguiente de la misma altura.");
    n.tie = !n.tie;
  });
};
for (const id of ["title", "composer", "tempo", "key"]) $(id).onchange = () => mutate(() => score[id] = id === "tempo" ? Number($(id).value) : $(id).value);
$("meter").onchange = () => mutate(() => score.time = $("meter").value.split("/").map(Number));
for (const id of ["dynamic", "articulation", "lyric", "chord"]) $(id).onchange = () => {
  if (selectedNote()) mutate(() => selectedNote()[id] = $(id).value);
};
$("zoom").onchange = () => {
  if ($('zoom').value !== 'fit') zoom = Number($("zoom").value);
  renderScore();
};
$("perline").onchange = () => {
  mutate(()=>score.layout={...score.layout,perLine:Number($("perline").value)});
};
$$('[data-layer]').forEach(b=>b.onclick=()=>setLayer(b.dataset.layer));
$('show-other-layers').onchange=renderScore;
$('tuplet').onclick=()=>setTupletMode();$('tuplet-ratio').onchange=()=>{if(tupletInput)setTupletMode(true);};$('convert-tuplet').onclick=convertTuplet;
$("new").onclick = newScore;
$("open").onclick = open;
$("save").onclick = save;
$("musx").onclick = exportMUSX;
$("xml").onclick = exportXML;
$("midi").onclick = exportMIDI;
$("pdf").onclick = print;
$("undo").onclick = undo;
$("redo").onclick = redo;
$("play").onclick = play;
$("stop").onclick = stop;
$("help").onclick = help;
$("addpart").onclick = addPart;
$("delete").onclick = deleteNote;
$("copy").onclick = () => {
  if (selectedNote()) {
    clipboard = JSON.parse(JSON.stringify(selectedNote()));
    renderInspector();
    toast("Nota copiada. Selecciona un comp\xE1s y pulsa Pegar.");
  }
};
$("paste").onclick = () => {
  if (clipboard) mutate(() => {
    const notes = score.parts[selection.part].measures[selection.measure].notes;
    notes.push({ ...structuredClone(clipboard), id: uid(),layer:activeLayer,...(clipboard.tuplet?{tuplet:{...clipboard.tuplet,group:uid()}}:{}) });
    selection.note = notes.length - 1;
  });
};
$("addmeasure").onclick = () => mutate(() => {
  if (score.parts[0].measures.length >= 128) throw Error("M\xE1ximo de 128 compases.");
  score.parts.forEach((p) => p.measures.push({ notes: [] }));
});
$("delmeasure").onclick = () => {
  if (score.parts[0].measures.length === 1) return;
  confirmAction("Quitar el \xFAltimo comp\xE1s", "Se quitar\xE1 el \xFAltimo comp\xE1s de todos los pentagramas.", () => mutate(() => score.parts.forEach((p) => p.measures.pop())));
};
$("clearmeasure").onclick = () => confirmAction("Vaciar comp\xE1s", `Se borrar\xE1n las notas del comp\xE1s ${selection.measure + 1} del instrumento seleccionado.`, () => mutate(() => {
  score.parts[selection.part].measures[selection.measure].notes = [];
  selection.note = null;
}));
$("transpose").onclick = () => dialog("Transportar partitura", [{ name: "semitones", label: "Semitonos (positivo hacia arriba)", value: 0, type: "number", min: -24, max: 24 }], (v) => mutate(() => {
  score = transposeScore(score, Number(v.semitones));
}));
$("metro").onclick = () => {
  metronome = !metronome;
  $("metro").classList.toggle("active", metronome);
};
$("file").onchange = async () => {
  const f = $("file").files[0];
  if (!f) return;
  const bytes = new Uint8Array(await f.arrayBuffer());
  let text = "";
  bytes.forEach((b) => text += String.fromCharCode(b));
  await openFile(f.name, btoa(text));
  $("file").value = "";
};
document.addEventListener("keydown", (e) => {
  if(midiRecording&&!$("dialog").open&&/^[a-g]$/i.test(e.key)&&!["INPUT","TEXTAREA","SELECT"].includes(document.activeElement.tagName)){e.preventDefault();if(!e.repeat)handleMidiEvent({type:"on",pitch:pitchFor(e.key.toUpperCase(),Number($("octave").value)),velocity:90,timestamp:performance.now()/1000});return;}
  if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName) || $("dialog").open) return;
  const cmd = e.metaKey || e.ctrlKey;
  if (cmd) {
    if (e.key.toLowerCase() === "s") {
      e.preventDefault();
      save();
    }
    if (e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    }
    if (e.key.toLowerCase() === "o") {
      e.preventDefault();
      open();
    }
    return;
  }
  if (e.key === " ") {
    e.preventDefault();
    play();
  } else if (e.key === "Escape") {
    setTool("select");
    selection.note = null;
    render();
  } else if ("12345".includes(e.key)) setDuration([4, 2, 1, 0.5, 0.25][Number(e.key) - 1]);
  else if (e.key === ".") {
    e.preventDefault();
    $("dot").click();
  } else if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault();
    deleteNote();
  } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    e.preventDefault();
    const n = selectedNote();
    if (n && !n.rest) mutate(() => n.pitches = n.pitches.map((p) => p + (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 12 : 1)));
  } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    const dir=e.key==='ArrowRight'?1:-1,m=score.parts[selection.part].measures[selection.measure],notes=measureLayers(m)[activeLayer-1];
    let idx=selection.note===null?(dir>0?-1:notes.length):notes.indexOf(selectedNote());idx+=dir;
    if(idx<0){selection.measure=Math.max(0,selection.measure-1);const previous=score.parts[selection.part].measures[selection.measure],items=measureLayers(previous)[activeLayer-1];selection.note=items.length?previous.notes.indexOf(items.at(-1)):null;}
    else if(idx>=notes.length){selection.measure=Math.min(score.parts[0].measures.length-1,selection.measure+1);selection.note=null;}
    else selection.note=m.notes.indexOf(notes[idx]);
    render();
  } else if (/^[a-g]$/i.test(e.key)) {
    e.preventDefault();
    insertPitch(pitchFor(e.key.toUpperCase(), Number($("octave").value)), tool === "rest", e.shiftKey);
  } else if (e.key.toLowerCase() === "t") setTupletMode();
  else if (e.key.toLowerCase() === "n") setTool("note");
  else if (e.key.toLowerCase() === "r") setTool("rest");
  else if (e.key.toLowerCase() === "l") setTool("lyric");
});
window.addEventListener("beforeunload", (e) => {
  if (midiRecording||JSON.stringify(score) !== baseline) {
    e.preventDefault();
    e.returnValue = "";
  }
});
window.Partitura = { exportMP3, cancelMP3, audioExportBegin, audioExportChunk, audioExportEnd, audioExportError, newScore, save, openFile, markSaved, exportMusicXML: exportXML, exportMIDI, exportMUSX, printHTML, audioError: (message) => {
  nativeAudioFailed = true;
  const wasPlaying = playing;
  stop();
  if (wasPlaying) play();
  toast("Audio del sistema no disponible; se usa s\xEDntesis local. " + message);
}, nativeSaveResult: (ok, name) => {
  if (ok && /\.(rickmusic|partitura|json)$/i.test(name)) markSaved();
  else if (ok) toast("Archivo exportado.");
}, undo, redo, hasUnsavedChanges: () => !!midiRecording||JSON.stringify(score) !== baseline, getScore: () => structuredClone(score), setScore: (s) => {
  score = validateScore(s);
  selection = { part: 0, measure: 0, note: null };
  persist();
  render();
}, getSelection: () => ({ ...selection }), stop };
window.Partitura.midiEvent=handleMidiEvent;window.Partitura.midiStatus=midiStatus;
window.RickMusic=window.Partitura;
$('chord-input').onclick = () => {
  chordInput = !chordInput;
  $('chord-input').setAttribute('aria-pressed', String(chordInput));
  $('chord-input').classList.toggle('active', chordInput);
  if (chordInput) toast('Acorde: selecciona una nota y toca el piano para añadir alturas.');
};
setupResponsive(renderScore);
renderPiano();
render();
