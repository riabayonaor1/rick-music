import test from 'node:test';
import assert from 'node:assert/strict';
import {TOOL_DEFINITIONS,runTool} from '../src/toolbox.js';
import {createScore,makeNote,validateScore} from '../src/model.js';
function harness(values={},callbacks={}) {
 const score=createScore({template:'solo',measures:3});score.parts[0].measures[0].notes=[makeNote(60,1),makeNote(62,1)];
 const state={score,selection:{part:0,measure:0,note:0},dialogs:[],messages:[],tools:[],mutations:0};
 Object.assign(state,{getNote:()=>score.parts[0].measures[state.selection.measure].notes[state.selection.note]??null,mutate:fn=>{fn();validateScore(score);state.mutations++;},dialog:(title,fields,submit)=>{state.dialogs.push({title,fields});submit({...Object.fromEntries(fields.map(f=>[f.name,String(f.value??'')])),...values});},toast:message=>state.messages.push(message),setTool:tool=>state.tools.push(tool),callbacks});
 return state;
}
test('36 original SVG tool icons cover 31 current tools and 5 legacy aliases',()=>{
 assert.equal(TOOL_DEFINITIONS.length,36);assert.equal(TOOL_DEFINITIONS.filter(t=>t.legacy).length,5);assert.equal(new Set(TOOL_DEFINITIONS.map(t=>t.id)).size,36);assert.equal(new Set(TOOL_DEFINITIONS.map(t=>t.svg)).size,36);
 for(const t of TOOL_DEFINITIONS){assert.match(t.svg,/^<svg /);assert.match(t.svg,/<\/svg>$/);assert.ok(t.label&&t.description);assert.doesNotMatch(t.svg,/(?:href=|<script|<image)/);}
});
test('measure and repeat tools mutate real score attributes',()=>{
 const ctx=harness({barline:'final',repeatStart:'yes',repeatEnd:'yes',times:'3',label:'Puente'});runTool('repeat',ctx);
 const m=ctx.score.parts[0].measures[0];assert.equal(m.barline,'final');assert.equal(m.repeatStart,true);assert.equal(m.repeatEnd,true);assert.equal(m.times,3);assert.equal(m.label,'Puente');assert.equal(ctx.mutations,1);
});
test('MIDI, note movement, expression and special tools preserve editable values',()=>{
 let ctx=harness({velocity:'112',timing:'0.125'});runTool('midi',ctx);assert.equal(ctx.getNote().velocity,112);assert.equal(ctx.getNote().timing,0.125);
 ctx=harness({layer:'4'});runTool('note-mover',ctx);assert.equal(ctx.getNote().layer,4);
 ctx=harness({expression:'dolce',dynamic:'p'});runTool('expression',ctx);assert.equal(ctx.getNote().expression,'dolce');assert.equal(ctx.getNote().dynamic,'p');
 ctx=harness({stem:'down',head:'diamond',offsetX:'5',offsetY:'-3',dots:'2'});runTool('special-tools',ctx);assert.equal(ctx.getNote().duration,1.75);assert.equal(ctx.getNote().dots,2);assert.equal(ctx.getNote().stemDirection,'down');assert.equal(ctx.getNote().notehead,'diamond');assert.equal(ctx.getNote().offsetX,5);assert.equal(ctx.getNote().offsetY,-3);
});
test('text, brackets, layout and smart shapes create persistent document objects',()=>{
 let ctx=harness({text:'Cantabile',x:'120',y:'180'});runTool('text',ctx);assert.equal(ctx.score.textBlocks[0].text,'Cantabile');assert.equal(ctx.score.textBlocks[0].x,120);
 ctx=harness({start:'1',end:'1',type:'brace'});runTool('bracket',ctx);assert.equal(ctx.score.brackets[0].type,'brace');assert.equal(ctx.score.brackets[0].start,0);
 ctx=harness({perLine:'3',staffGap:'120',pageScale:'90'});runTool('page-layout',ctx);assert.deepEqual(ctx.score.layout,{perLine:3,staffGap:120,pageScale:0.9});
 ctx=harness({type:'crescendo'});const first=ctx.getNote().id;runTool('smart-shape',ctx);assert.equal(ctx.score.smartShapes[0].startNoteId,first);assert.equal(ctx.score.smartShapes[0].endNoteId,ctx.score.parts[0].measures[0].notes[1].id);
});
test('mirror copy regenerates note and tuplet IDs and records the source reference',()=>{
 const ctx=harness({source:'1'}),source=ctx.score.parts[0].measures[0];source.notes[0].tuplet={actual:3,normal:2,group:'a'};source.notes[1].tuplet={actual:3,normal:2,group:'a'};ctx.selection.measure=1;
 runTool('mirror',ctx);const copy=ctx.score.parts[0].measures[1];assert.notEqual(copy.notes[0].id,source.notes[0].id);assert.notEqual(copy.notes[0].tuplet.group,'a');assert.equal(copy.notes[0].tuplet.group,copy.notes[1].tuplet.group);assert.deepEqual(copy.mirrorOf,{partId:ctx.score.parts[0].id,measure:0});
});
test('tempo supports global and local changes; invalid MIDI values are rejected',()=>{
 let ctx=harness({tempo:'132',scope:'measure'});runTool('tempo',ctx);assert.equal(ctx.score.parts[0].measures[0].tempo,132);assert.equal(ctx.score.tempo,100);
 ctx=harness({tempo:'92',scope:'score'});ctx.score.parts[0].measures[1].tempo=140;runTool('tempo',ctx);assert.equal(ctx.score.tempo,92);assert.equal(ctx.score.parts[0].measures[1].tempo,undefined);
 ctx=harness({velocity:'200'});assert.throws(()=>runTool('midi',ctx),/Velocidad/);
});
test('host interactions dispatch exact callbacks and report absent integrations',()=>{
 const mappings={chord:'chord',lyrics:'lyric',tuplet:'tuplet',hand:'hand',zoom:'zoom',hyperscribe:'hyperscribe',transcription:'transcription',graphics:'graphics',region:'region','speedy-entry':'speedy',ossia:'ossia'};
 for(const [id,callback] of Object.entries(mappings)){let called=0;const ctx=harness({}, {[callback]:()=>called++});runTool(id,ctx);assert.equal(called,1,id);assert.equal(ctx.messages.length,0);}
 const missing=harness();runTool('hyperscribe',missing);assert.match(missing.messages[0],/todavía no está conectada/);assert.equal(missing.mutations,0);
 const simple=harness();runTool('simple-entry',simple);runTool('select',simple);assert.deepEqual(simple.tools,['note','select']);assert.throws(()=>runTool('unknown',simple),/desconocida/);
});

test('repeat changes from a lower staff synchronize playback flags across all staves',()=>{
 const ctx=harness({barline:'double',repeatStart:'yes',repeatEnd:'yes',times:'4',label:'Trío'});const lower=createScore({template:'solo',measures:3}).parts[0];ctx.score.parts.push(lower);ctx.selection.part=1;ctx.getNote=()=>null;
 runTool('repeat',ctx);for(const p of ctx.score.parts){assert.equal(p.measures[0].repeatStart,true);assert.equal(p.measures[0].repeatEnd,true);assert.equal(p.measures[0].times,4);}assert.equal(lower.measures[0].barline,'double');assert.equal(lower.measures[0].label,'Trío');assert.equal(ctx.score.parts[0].measures[0].barline,undefined);assert.equal(ctx.score.parts[0].measures[0].label,undefined);
});
