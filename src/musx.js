/*
 * Copyright (C) 2024-2025, Robert Patterson
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
// MUSX container/score.dat algorithm adapted from MIT denigma (Robert Patterson,
// 2024); the independent score mapping is implemented for Rick Music.
import JSZip from 'jszip';
import pako from 'pako';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { makeNote, validateScore, beatsPerMeasure } from './model.js';

const LIMIT = 40 * 1024 * 1024;
const fail = (condition, message) => { if (!condition) throw new Error(`MUSX: ${message}`); };
const array = value => value === undefined ? [] : Array.isArray(value) ? value : [value];
const integer = (value, fallback = 0) => { const n = Number(value ?? fallback); fail(Number.isSafeInteger(n), 'entero inválido'); return n; };
const has = (node, key) => Object.hasOwn(node || {}, key);
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const text = value => typeof value === 'object' ? String(value?.['#text'] ?? '') : String(value ?? '');
const plain = value => text(value).replace(/\^\^|\^[a-zA-Z][a-zA-Z0-9]*\([^)]*\)/g, match=>match==='^^'?'^':'').trim();
const enigmaText = value => esc(String(value).replace(/\^/g,'^^'));
const major = ['Cb','Gb','Db','Ab','Eb','Bb','F','C','G','D','A','E','B','F#','C#'];
const minor = ['Abm','Ebm','Bbm','Fm','Cm','Gm','Dm','Am','Em','Bm','F#m','C#m','G#m','D#m','A#m'];
// MIDI percussion mapping adapted from MIT musxdom (Robert Patterson, 2025).
const percussionGM = {"6":56,"48":56,"49":56,"50":56,"51":56,"52":56,"53":56,"54":56,"55":56,"56":56,"57":56,"58":56,"59":82,"62":82,"63":82,"65":82,"7":54,"66":54,"67":54,"8":80,"9":81,"10":76,"11":77,"68":76,"69":77,"70":84,"511":54,"71":74,"72":70,"73":38,"74":83,"75":67,"12":58,"76":28,"460":54,"2":36,"13":35,"77":35,"78":37,"79":37,"80":35,"81":35,"82":35,"83":35,"84":37,"85":37,"86":35,"87":35,"4":49,"5":57,"88":49,"89":49,"90":49,"91":49,"92":49,"93":49,"94":49,"95":49,"96":49,"97":49,"98":49,"99":49,"100":49,"101":49,"102":49,"103":49,"104":49,"105":49,"106":49,"107":49,"108":49,"18":51,"19":59,"109":51,"110":49,"20":53,"111":51,"14":46,"15":42,"16":44,"112":46,"276":46,"113":46,"114":42,"115":46,"116":42,"117":42,"21":55,"118":49,"119":49,"120":49,"121":51,"122":51,"123":49,"124":49,"125":51,"17":52,"126":52,"127":49,"128":49,"129":49,"130":49,"131":49,"132":49,"133":49,"134":49,"135":52,"136":52,"137":52,"138":52,"139":49,"140":49,"141":49,"142":52,"143":52,"144":52,"145":52,"146":52,"147":52,"148":52,"149":52,"150":51,"151":51,"152":52,"153":49,"154":49,"155":49,"156":49,"157":49,"158":49,"159":49,"160":52,"161":52,"162":52,"163":52,"164":49,"165":49,"166":49,"167":49,"168":49,"169":49,"170":49,"171":49,"172":49,"173":49,"174":49,"175":49,"176":49,"177":49,"178":49,"179":49,"180":49,"181":49,"182":49,"183":49,"184":49,"185":49,"186":49,"187":49,"188":49,"189":49,"190":49,"191":49,"192":49,"193":49,"194":42,"195":49,"196":49,"197":49,"198":49,"199":51,"200":49,"201":49,"202":49,"203":49,"204":49,"205":49,"206":51,"207":51,"208":51,"209":51,"210":51,"211":52,"212":50,"213":48,"214":47,"215":45,"456":67,"457":68,"216":51,"218":36,"219":35,"220":49,"222":82,"223":45,"224":72,"225":71,"226":72,"455":82,"227":49,"464":30,"463":29,"229":49,"230":37,"231":49,"516":49,"517":49,"22":39,"234":39,"461":32,"462":34,"1":38,"236":38,"277":38,"512":38,"513":38,"514":38,"239":38,"278":38,"240":38,"3":37,"243":38,"244":38,"245":38,"246":37,"247":38,"248":38,"249":37,"250":37,"251":38,"252":38,"253":38,"237":93,"238":38,"241":38,"242":38,"254":91,"255":38,"256":31,"23":40,"257":38,"258":38,"259":38,"458":38,"260":38,"261":37,"264":38,"265":38,"266":38,"267":38,"268":37,"269":37,"270":37,"271":38,"272":38,"262":38,"263":38,"273":91,"274":38,"275":31,"279":38,"280":38,"281":38,"282":38,"24":50,"283":50,"284":50,"285":50,"286":50,"287":50,"288":50,"289":50,"290":50,"25":48,"291":48,"292":48,"293":48,"294":48,"295":48,"296":48,"297":48,"298":48,"26":47,"299":47,"300":47,"301":47,"302":47,"303":47,"304":47,"305":47,"306":47,"27":45,"307":45,"308":45,"309":45,"310":45,"311":45,"312":45,"313":45,"314":45,"28":43,"29":41,"317":31,"318":47,"319":45,"320":50,"321":48,"322":47,"323":48,"324":48,"325":50,"326":48,"327":48,"328":48,"329":48,"330":50,"331":50,"30":67,"332":67,"31":68,"333":68,"506":68,"504":67,"505":68,"507":67,"334":50,"335":50,"336":50,"337":48,"338":48,"339":48,"340":45,"341":45,"342":45,"343":62,"344":63,"345":58,"346":67,"347":67,"348":68,"349":68,"32":60,"350":60,"351":60,"503":60,"33":61,"352":61,"353":61,"34":69,"355":69,"356":69,"357":69,"358":69,"359":36,"500":36,"501":36,"502":36,"360":36,"361":36,"362":85,"363":85,"364":85,"365":85,"366":56,"367":56,"470":56,"35":75,"36":63,"368":63,"37":62,"369":63,"370":63,"371":63,"372":63,"373":63,"374":63,"375":63,"376":63,"377":63,"38":64,"378":64,"379":64,"380":64,"381":64,"39":78,"385":78,"40":79,"386":45,"387":45,"388":45,"389":45,"498":45,"390":45,"499":45,"391":45,"392":50,"393":50,"394":48,"395":47,"396":50,"397":69,"41":74,"42":73,"471":74,"472":74,"473":74,"398":74,"399":74,"400":74,"401":74,"402":63,"403":64,"43":70,"404":70,"405":70,"481":54,"482":54,"483":54,"484":54,"489":54,"406":50,"407":48,"408":50,"409":70,"476":65,"477":65,"478":65,"479":65,"480":65,"410":69,"411":69,"412":69,"413":69,"414":69,"508":69,"509":69,"510":69,"415":87,"416":86,"474":35,"475":37,"417":63,"418":62,"419":63,"420":64,"421":63,"422":50,"423":50,"424":48,"425":48,"426":47,"427":47,"428":45,"429":45,"430":43,"431":45,"432":78,"433":79,"490":65,"491":65,"492":65,"493":65,"494":65,"495":65,"496":65,"497":65,"434":54,"435":54,"436":54,"437":54,"438":54,"439":54,"459":77,"518":77,"519":77,"520":77,"521":77,"440":63,"441":64,"44":65,"444":65,"467":65,"468":65,"442":65,"45":66,"465":65,"466":66,"469":66,"443":65,"445":67,"446":67,"447":62,"448":63,"449":64,"450":62,"46":72,"451":72,"47":71,"452":54,"454":39,"3968":0,"3969":1,"3970":2,"3971":3,"3972":4,"3973":5,"3974":6,"3975":7,"3976":8,"3977":9,"3978":10,"3979":11,"3980":12,"3981":13,"3982":14,"3983":15,"3984":16,"3985":17,"3986":18,"3987":19,"3988":20,"3989":21,"3990":22,"3991":23,"3992":24,"3993":25,"3994":26,"3995":27,"3996":28,"3997":29,"3998":30,"3999":31,"4000":32,"4001":33,"4002":34,"4003":82,"4004":83,"4005":84,"4006":85,"4007":86,"4008":87,"4009":88,"4010":89,"4011":90,"4012":91,"4013":92,"4014":93,"4015":94,"4016":95,"4017":96,"4018":97,"4019":98,"4020":99,"4021":100,"4022":101,"4023":102,"4024":103,"4025":104,"4026":105,"4027":106,"4028":107,"4029":108,"4030":109,"4031":110,"4032":111,"4033":112,"4034":113,"4035":114,"4036":115,"4037":116,"4038":117,"4039":118,"4040":119,"4041":120,"4042":121,"4043":122,"4044":123,"4045":124,"4046":125,"4047":126,"4048":127};
const steps = [0,2,4,5,7,9,11];
const mod = (a,b) => ((a % b) + b) % b;
function keyInfo(key = 0) {
  const mode = key >> 8, raw = key & 255, fifths = raw > 127 ? raw - 256 : raw;
  fail(mode <= 1 && Math.abs(fifths) <= 7, 'armadura personalizada o microtonal no compatible');
  const centers = mode === 1 ? (fifths >= 0 ? [5,2,6,3,0,4,1,5] : [5,1,4,0,3,6,2,5]) : (fifths >= 0 ? [0,4,1,5,2,6,3,0] : [0,3,6,2,5,1,4,0]);
  const alterations = Array(7).fill(0), order = fifths >= 0 ? [3,0,4,1,5,2,6] : [6,2,5,1,4,0,3];
  for (let i = 0; i < Math.abs(fifths); i++) alterations[order[i]] = Math.sign(fifths);
  return { name:(mode === 1 ? minor : major)[fifths+7], center:centers[Math.abs(fifths)], alterations };
}
function keyNumber(name) { const i=major.indexOf(name); if(i>=0)return mod(i-7,256); const j=minor.indexOf(name);fail(j>=0,'armadura inválida');return 256+mod(j-7,256); }
export function recodeScoreDat(input) {
  const bytes = new Uint8Array(input), out = new Uint8Array(bytes.length); let state=0;
  for(let i=0;i<bytes.length;i++) { if(i%0x20000===0)state=0x28006D45;state=(Math.imul(state,0x41c64e6d)+0x3039)>>>0;const upper=state>>>16;out[i]=bytes[i]^((upper+Math.floor(upper/255))&255); }
  return out;
}
function inflateLimited(data) {
  const chunks=[];let length=0;const decoder=new pako.Inflate();
  decoder.onData = chunk => { length+=chunk.length;fail(length<=LIMIT,'la partitura descomprimida supera 40 MB');chunks.push(chunk); };
  decoder.push(data,true);fail(!decoder.err, 'score.dat dañado o compresión no compatible');
  const out=new Uint8Array(length);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.length;}return out;
}
function base64(bytes) { let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s); }
function unbase64(s) { return Uint8Array.from(atob(s),c=>c.charCodeAt(0)); }
const fingerprint = score => { const {musxSource,warnings,...content}=score; return JSON.stringify(content); };
export async function extractMusx(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);fail(bytes.length<=20*1024*1024,'el archivo supera 20 MB');
  let zip;try{zip=await JSZip.loadAsync(bytes,{checkCRC32:false});}catch{throw new Error('MUSX: contenedor ZIP inválido');}
  const members=Object.values(zip.files);fail(members.length<=1000,'demasiados miembros del archivo');let total=0;
  for(const member of members){total+=member._data?.uncompressedSize??0;fail(total<=LIMIT,'el contenedor descomprimido supera 40 MB');}
  fail(zip.file('score.dat') && zip.file('mimetype'),'falta score.dat o mimetype; este archivo no es MUSX');
  fail((await zip.file('mimetype').async('string')).trim()==='application/vnd.makemusic.notation','tipo de archivo Finale no compatible');
  const encoded=await zip.file('score.dat').async('uint8array');fail(encoded.length<=LIMIT,'score.dat demasiado grande');
  const xml=new TextDecoder('utf-8',{fatal:true}).decode(inflateLimited(recodeScoreDat(encoded)));
  return {xml,zip,bytes};
}
export function fromEnigmaXML(xml) {
  fail(typeof xml==='string' && xml.length<=LIMIT,'XML demasiado grande');fail(!/<!DOCTYPE|<!ENTITY/i.test(xml),'declaraciones XML externas no permitidas');
  fail(XMLValidator.validate(xml)===true,'XML de Finale inválido');
  const root=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',parseTagValue:false,trimValues:false}).parse(xml).finale;fail(root,'el XML no es EnigmaXML de Finale');
  const others=root.others||{}, details=root.details||{}, texts=root.texts||{}, warnings=[];
  const scoreRecords = records => array(records).filter(n=>!n['@_part'] || n['@_part']==='0');
  const measures=scoreRecords(others.measSpec).sort((a,b)=>integer(a['@_cmper'])-integer(b['@_cmper']));
  fail(measures.length>0 && measures.length<=2000,'número de compases no compatible');
  const signature = measure => [integer(measure.beats,4),4096/integer(measure.divbeat,1024)];
  const time=signature(measures[0]);const key=keyInfo(integer(measures[0].keySig?.key));
  for(const m of measures){fail(JSON.stringify(signature(m))===JSON.stringify(time),'los cambios de compás dentro de la obra todavía requieren MusicXML');fail(keyInfo(integer(m.keySig?.key)).name===key.name,'los cambios de armadura dentro de la obra todavía requieren MusicXML');}
  const blocks=new Map(array(texts.blockText).map(n=>[String(n['@_number']),plain(n)]));
  const textBlocks=new Map(scoreRecords(others.textBlock).map(n=>[String(n['@_cmper']),blocks.get(String(n.textID))||'']));
  const info=new Map(array(texts.fileInfo).map(n=>[n['@_type'],plain(n)]));
  const staves=new Map(scoreRecords(others.staffSpec).map(n=>[String(n['@_cmper']),n]));
  let order=scoreRecords(others.instUsed).filter(n=>String(n['@_cmper'])==='0').map(n=>String(n.inst));if(!order.length)order=[...staves.keys()].filter(id=>Number(id)<32767);order=[...new Set(order)];
  fail(order.length>0&&order.length<=64,'número de pentagramas no compatible');
  const frames=new Map();for(const f of scoreRecords(others.frameSpec)){const id=String(f['@_cmper']);if(!frames.has(id)||integer(f['@_inci'])===0)frames.set(id,f);}
  const entries=new Map(array(root.entries?.entry).map(n=>[String(n['@_entnum']),n]));fail(entries.size<=100000,'más de 100.000 eventos');
  const holds=new Map(scoreRecords(details.gfhold).map(n=>[`${n['@_cmper1']}:${n['@_cmper2']}`,n]));
  const tuplets=new Map();for(const t of scoreRecords(details.tupletDef)){const id=String(t['@_entnum']);if(!tuplets.has(id))tuplets.set(id,[]);tuplets.get(id).push(t);}
  const lyricByEntry=new Map();for(const [tag,source] of [['lyrDataVerse','verse'],['lyrDataChorus','chorus'],['lyrDataSection','section']]) {
    const lyrics=new Map(array(texts[source]).map(n=>[String(n['@_number']),plain(n).split(/[\s-]+/)]));
    for(const a of scoreRecords(details[tag])){const id=String(a['@_entnum']);if(!lyricByEntry.has(id))lyricByEntry.set(id,lyrics.get(String(a.lyricNumber))?.[integer(a.syll)-1]||'');}
  }
  const routes=new Map(scoreRecords(others.playbackRoute).map(n=>[String(n['@_cmper']),n]));
  const playback=new Map(scoreRecords(others.staffPlayData).map(n=>[String(n['@_cmper']),n]));
  const percussionCodes=new Map();for(const n of scoreRecords(details.percussionNoteCode))percussionCodes.set(`${n['@_entnum']}:${n.noteID}`,integer(n.noteCode));
  const options=root.options||{};const score={version:1,title:info.get('title')||'Partitura Finale',composer:info.get('composer')||'',tempo:Math.max(10,Math.min(500,Number(options.playbackOptions?.beatsPerMinute)||100)),time,key:key.name,parts:[],warnings};
  const capacity=beatsPerMeasure(score);let serial=0;
  for(const staffId of order){
    const staff=staves.get(staffId);fail(staff,'pentagrama referenciado ausente');const percussion=staff.notationStyle==='percussion';
    let clefId=integer(staff.defaultClef);const firstHold=holds.get(`${staffId}:${measures[0]['@_cmper']}`);if(firstHold?.clefID!==undefined)clefId=integer(firstHold.clefID);
    const clef=percussion?'percussion':clefId===3?'bass':clefId===1?'alto':'treble';
    if(!percussion&&![0,1,3].includes(clefId))warnings.push('Algunas claves especiales se muestran en clave de sol.');
    if(staff.transposition)warnings.push('Las notas MUSX se importan en altura de concierto; la transposición de la parte no se conserva.');
    const route=routes.get(String(integer(playback.get(staffId)?.layer1?.playbackRouteNum)+1));
    const program=percussion?0:Math.max(0,Math.min(127,integer(route?.patch)));
    const part={id:`musx-staff-${staffId}`,name:textBlocks.get(String(staff.fullName))||`Pentagrama ${score.parts.length+1}`,clef,program,volume:0.8,muted:false,measures:[],...(percussion?{percussion:true}:{})};
    for(const measure of measures){const result={notes:[]},hold=holds.get(`${staffId}:${measure['@_cmper']}`);
      for(let layer=1;layer<=4;layer++){const frameId=hold?.[`frame${layer}`];if(!frameId)continue;const frame=frames.get(String(frameId));fail(frame,'marco de notas no encontrado');let current=String(frame.startEntry??0),end=String(frame.endEntry??0),elapsed=0,activeTuplets=[],seen=new Set();
        const offset=integer(frame.startTime);fail(offset>=0,'anacrusa con desplazamiento negativo no compatible');if(offset){const rest=makeNote(60,offset/1024);rest.rest=true;rest.pitches=[];rest.layer=layer;result.notes.push(rest);elapsed=rest.duration;}
        while(current!=='0'){
          fail(!seen.has(current),'ciclo en la cadena de notas');seen.add(current);const entry=entries.get(current);fail(entry,'nota enlazada ausente');
          fail(!has(entry,'v2')&&!has(entry,'controller'),'voces secundarias de Finale (V1/V2) no compatibles; utiliza capas o MusicXML');
          if(has(entry,'graceNote')){warnings.push('Las notas de adorno no forman parte de la edición importada.');}else{
            const duration=integer(entry.dura);fail(duration>0,'duración de entrada inválida');
            for(const t of tuplets.get(current)||[]){const actual=integer(t.symbolicNum),normal=integer(t.refNum);fail(actual>=2&&normal>=1,'grupo irregular inválido');const symbolic=integer(t.symbolicDur),reference=integer(t.refDur);fail(symbolic===reference,'grupos irregulares con unidades distintas no compatibles');activeTuplets.push({actual,normal,left:actual*symbolic,group:`musx-tuplet-${current}`});}
            fail(activeTuplets.length<=1,'grupos irregulares anidados no compatibles');const tuplet=activeTuplets[0];
            const note=makeNote(60,duration/1024*(tuplet?tuplet.normal/tuplet.actual:1));fail(++serial<=100000,'más de 100.000 eventos enlazados');note.id=`musx-note-${serial}`;note.layer=layer;note.rest=!has(entry,'isNote');
            note.pitches=note.rest?[]:array(entry.note).map(n=>{if(percussion){const code=percussionCodes.get(`${current}:${n['@_id']}`);if(code!==undefined&&percussionGM[code&4095]!==undefined)return percussionGM[code&4095];warnings.push('Algunos sonidos de percusión MUSX con mapa propio se sustituyen por caja General MIDI.');return 38;}const diatonic=integer(n.harmLev)+key.center;const degree=mod(diatonic,7);const pitch=60+Math.floor(diatonic/7)*12+steps[degree]+key.alterations[degree]+integer(n.harmAlt);fail(pitch>=0&&pitch<=127,'nota fuera del rango MIDI');return pitch;});
            note.pitches=[...new Set(note.pitches)];fail(note.rest||note.pitches.length>0,'entrada sin notas');note.tie=!note.rest&&array(entry.note).some(n=>has(n,'tieStart'));note.lyric=lyricByEntry.get(current)||'';
            for(let dots=0;dots<=3;dots++){const base=(duration/1024)/(2-1/2**dots);if(Math.abs(Math.log2(base)-Math.round(Math.log2(base)))<1e-7){note.dots=dots;break;}}
            if(tuplet){note.tuplet={actual:tuplet.actual,normal:tuplet.normal,group:tuplet.group};tuplet.left-=duration;if(tuplet.left<=0)activeTuplets=[];}
            elapsed+=note.duration;fail(elapsed<=capacity+1e-6,`el compás ${measure['@_cmper']} excede el compás de la obra`);result.notes.push(note);
          }
          if(current===end)break;current=String(entry['@_next']??0);
        }
        fail(current===end||end==='0','cadena incompleta de notas');fail(!activeTuplets.length,'grupo irregular incompleto');
      }
      part.measures.push(result);
    }
    score.parts.push(part);
  }
  warnings.push('Importación MUSX: notas, silencios, acordes de notas, cuatro capas, grupos irregulares, ligaduras y letra básica. La maquetación, expresiones, articulaciones, cifrados y reproducción instrumental de Finale pueden variar. El original se conserva dentro del proyecto; exportarlo sin cambios devuelve los mismos bytes.');
  score.warnings=[...new Set(warnings)];return validateScore(score);
}
export async function fromMusx(input) {
  const {xml,bytes}=await extractMusx(input);const score=fromEnigmaXML(xml);
  score.musxSource={version:1,archiveBase64:base64(bytes),projectionFingerprint:fingerprint(score)};return score;
}

const element=(name,value)=>`<${name}>${esc(value)}</${name}>`;
function makeOptions(tempo) {
  const fonts=['music','key','clef','time','flags','accis','rests','noteheads','augDots','reptDots','timePlus','timeParts','timePlusParts'].map(type=>`<font type="${type}"><fontID>0</fontID><fontSize>24</fontSize></font>`).join('')+['textBlock','lyricVerse','lyricChorus','lyricSection','tuplet','staffNames','abbrvStaffNames','chord','expression'].map(type=>`<font type="${type}"><fontID>1</fontID><fontSize>12</fontSize></font>`).join('');
  const symbols={noteheadQuarter:207,noteheadHalf:250,noteheadWhole:119,noteheadDblWhole:87,natural:110,flat:98,sharp:35,dblFlat:186,dblSharp:220,keySigNatural:110,keySigFlat:98,keySigSharp:35,restWhole:183,restHalf:238,restQuarter:206,restEighth:228,rest16th:197,rest32nd:168,rest64th:244,rest128th:229,restDefMeas:183,augDot:46,forwardRepeatDot:46,backRepeatDot:46,flagUp:106,flagDown:74,flag16Up:114,flag16Down:82,timeSigAbrvCommon:99,timeSigAbrvCut:67};
  return `<fontOptions>${fonts}</fontOptions><clefOptions><clefFront>24</clefFront><clefDef index="0"><adjust>-10</adjust><clefChar>38</clefChar><clefYDisp>-6</clefYDisp></clefDef><clefDef index="1"><adjust>-4</adjust><clefChar>66</clefChar><clefYDisp>-4</clefYDisp></clefDef><clefDef index="2"><adjust>-2</adjust><clefChar>66</clefChar><clefYDisp>-2</clefYDisp></clefDef><clefDef index="3"><adjust>2</adjust><clefChar>63</clefChar><clefYDisp>-2</clefYDisp></clefDef><clefDef index="4"><adjust>-10</adjust><clefChar>214</clefChar><clefYDisp>-4</clefYDisp></clefDef></clefOptions><musicSymbolOptions>${Object.entries(symbols).map(([k,v])=>element(k,v)).join('')}</musicSymbolOptions><barlineOptions><drawBarlines/><barlineWidth>128</barlineWidth><thickBarlineWidth>512</thickBarlineWidth><drawFinalBarlineOnLastMeas/></barlineOptions><stemOptions><stemLength>84</stemLength><stemWidth>128</stemWidth></stemOptions><beamOptions><beamWidth>768</beamWidth><beamSepar>18</beamSepar><beamStubLength>18</beamStubLength></beamOptions><augmentationDotOptions><dotOffset>12</dotOffset><dotFirstOffset>8</dotFirstOffset></augmentationDotOptions><timeSignatureOptions><timeFront>24</timeFront><timeBack>12</timeBack></timeSignatureOptions><playbackOptions><stMeas>1</stMeas><enMeas>32767</enMeas><edusPerBeat>1024</edusPerBeat><beatsPerMinute>${tempo}</beatsPerMinute><baseVelocity>80</baseVelocity><playVelocity>80</playVelocity></playbackOptions><tupletOptions><tupOffY>24</tupOffY><numStyle>number</numStyle><posStyle>beamSide</posStyle><brackStyle>bracket</brackStyle></tupletOptions>`;
}
export function toEnigmaXML(input) {
  const score=validateScore(input),key=keyInfo(keyNumber(score.key));const capacity=beatsPerMeasure(score), count=score.parts[0].measures.length;
  let others='',details='',entries='',texts=element('fileInfo', ''),entnum=0,frameId=0,noteId=0,lyricId=0;
  texts=`<fileInfo type="title">${esc(score.title)}</fileInfo><fileInfo type="composer">${esc(score.composer)}</fileInfo>`;
  others+='<fontName cmper="0"><charsetBank>Mac</charsetBank><charsetVal>4095</charsetVal><name>Maestro</name></fontName><fontName cmper="1"><charsetBank>Mac</charsetBank><name>Times</name></fontName><partGlobals cmper="65534"/><partDef cmper="0"><partOrder>0</partOrder><copies>1</copies><printPart/></partDef>';
  for(let layer=0;layer<4;layer++)others+=`<layerAtts cmper="${layer}"><playback/><spacing/>${layer%2?'<freezeLayer/>':'<freezeLayer/><freezeLayUp/>'}</layerAtts>`;
  for(let mi=0;mi<count;mi++)others+=`<measSpec cmper="${mi+1}"><width>600</width><keySig><key>${keyNumber(score.key)}</key></keySig><beats>${score.time[0]}</beats><divbeat>${4096/score.time[1]}</divbeat><dispBeats>${score.time[0]}</dispBeats><dispDivbeat>${4096/score.time[1]}</dispDivbeat><posMode>timesigPlusPos</posMode><barline>${mi===count-1?'final':'normal'}</barline><leftBarline>default</leftBarline></measSpec>`;
  score.parts.forEach((part,pi)=>{
    const staff=pi+1,clef={treble:0,alto:1,bass:3,percussion:4}[part.clef];
    others+=`<staffSpec cmper="${staff}"><staffLines>5</staffLines><lineSpace>24</lineSpace><defaultClef>${clef}</defaultClef><fullName>${staff}</fullName>${part.percussion?'<notationStyle>percussion</notationStyle><hideKeySigs/>':''}<dwRestOffset>-4</dwRestOffset><wRestOffset>-4</wRestOffset><hRestOffset>-4</hRestOffset><otherRestOffset>-4</otherRestOffset><stemReversal>-4</stemReversal></staffSpec><textBlock cmper="${staff}"><textID>${staff}</textID><lineSpacingPercent>100</lineSpacingPercent><textTag>block</textTag></textBlock><instUsed cmper="0" inci="${pi}"><inst>${staff}</inst><trackType>staff</trackType><distFromTop>${-pi*288}</distFromTop></instUsed>`;
    texts+=`<blockText number="${staff}">^fontid(1)^size(12)${enigmaText(part.name)}</blockText>`;
    const channel=part.percussion?9:(pi%15<9?pi%15:pi%15+1);
    others+=`<playbackRoute cmper="${staff}"><virtChannel>${channel}</virtChannel><patchType>PC</patchType><patch>${part.program}</patch></playbackRoute><staffPlayData cmper="${staff}">${[1,2,3,4].map(layer=>`<layer${layer}><playbackRouteNum>${staff-1}</playbackRouteNum><play/></layer${layer}>`).join('')}</staffPlayData>`;
    part.measures.forEach((measure,mi)=>{let frames='';
      for(let layer=1;layer<=4;layer++){
        const stream=measure.notes.filter(n=>(n.layer??1)===layer);if(!stream.length)continue;const frame=++frameId;const first=entnum+1;frames+=`<frame${layer}>${frame}</frame${layer}>`;
        for(let ni=0;ni<stream.length;ni++){
          const note=stream[ni],entry=++entnum,written=note.duration*(note.tuplet?note.tuplet.actual/note.tuplet.normal:1),edu=Math.round(written*1024);
          fail(Math.abs(written*1024-edu)<1e-5,'duración no representable en unidades de Finale');
          const startsTuplet=note.tuplet&&stream[ni-1]?.tuplet?.group!==note.tuplet.group;
          if(startsTuplet){const group=stream.slice(ni).filter((n,i,a)=>n.tuplet?.group===note.tuplet.group&&a.slice(0,i).every(p=>p.tuplet?.group===note.tuplet.group));const unit=Math.min(...group.map(n=>n.duration*note.tuplet.actual/note.tuplet.normal));const symbolic=Math.round(unit*1024);fail(Math.abs(group.reduce((s,n)=>s+n.duration,0)*1024-note.tuplet.normal*symbolic)<1e-4,'grupo irregular incompleto o unidades mixtas no exportables');details+=`<tupletDef entnum="${entry}" inci="0"><symbolicNum>${note.tuplet.actual}</symbolicNum><symbolicDur>${symbolic}</symbolicDur><refNum>${note.tuplet.normal}</refNum><refDur>${symbolic}</refDur><avoidStaff/><tupOffY>24</tupOffY><numStyle>number</numStyle><posStyle>beamSide</posStyle><breakBracket/><brackStyle>bracket</brackStyle><smartTuplet/></tupletDef>`;}
          let pitches='';if(!note.rest)for(const pitch of note.pitches){const id=++noteId;let best=null;for(let degree=0;degree<7;degree++)for(let octave=-5;octave<=5;octave++){const base=60+octave*12+steps[degree]+key.alterations[degree],alter=pitch-base;const candidate={harm:octave*7+degree-key.center,alter};if(!best||Math.abs(alter)<Math.abs(best.alter))best=candidate;}pitches+=`<note id="${id}"><harmLev>${best.harm}</harmLev><harmAlt>${best.alter}</harmAlt><isValid/>${note.tie?'<tieStart/>':''}</note>`;if(part.percussion)details+=`<percussionNoteCode entnum="${entry}" inci="0"><noteID>${id}</noteID><noteCode>${Object.entries(percussionGM).find(([code,gm])=>gm===pitch)?.[0]??1}</noteCode></percussionNoteCode>`;}
          if(note.lyric){const number=++lyricId;texts+=`<verse number="${number}">^fontid(1)^size(12)${enigmaText(note.lyric)}</verse>`;details+=`<lyrDataVerse entnum="${entry}" inci="0"><lyricNumber>${number}</lyricNumber><syll>1</syll></lyrDataVerse>`;}
          entries+=`<entry entnum="${entry}" prev="${ni?entry-1:0}" next="${ni===stream.length-1?0:entry+1}"><dura>${edu}</dura><numNotes>${note.pitches.length}</numNotes><isValid/>${note.rest?'<floatRest/>':'<isNote/>'}${part.percussion?'<noteDetail/>':''}${startsTuplet?'<tupletStart/>':''}${note.lyric?'<lyricDetail/>':''}<beam/><checkAccis/>${layer%2?'<upStem/>':''}${pitches}</entry>`;
        }
        others+=`<frameSpec cmper="${frame}" inci="0"><startEntry>${first}</startEntry><endEntry>${entnum}</endEntry></frameSpec>`;
      }
      details+=`<gfhold cmper1="${staff}" cmper2="${mi+1}"><clefID>${clef}</clefID><clefPercent>100</clefPercent>${frames}</gfhold>`;
    });
  });
  const systems=Math.ceil(count/4),systemHeight=score.parts.length*288+180,perPage=Math.max(1,Math.floor(2400/systemHeight));
  for(let si=0;si<systems;si++){
    const page=Math.floor(si/perPage)+1;
    if(si%perPage===0)others+=`<pageSpec cmper="${page}"><height>3368</height><width>2381</width><percent>100</percent><firstSystem>${si+1}</firstSystem><margTop>-180</margTop><margLeft>144</margLeft><margBottom>180</margBottom><margRight>-144</margRight></pageSpec>`;
    others+=`<staffSystemSpec cmper="${si+1}"><startMeas>${si*4+1}</startMeas><endMeas>${Math.min(count,si*4+4)+1}</endMeas><horzPercent>10000</horzPercent><ssysPercent>100</ssysPercent><staffHeight>6144</staffHeight><top>${si%perPage===0?-300:-80}</top><bottom>-${systemHeight}</bottom><scaleVert/></staffSystemSpec>`;
    score.parts.forEach((_,pi)=>{others+=`<instUsed cmper="${si+1}" inci="${pi}"><inst>${pi+1}</inst><trackType>staff</trackType><distFromTop>${-pi*288}</distFromTop></instUsed>`;});
  }
  const stamp='<year>2026</year><month>10</month><day>14</day><application>FIN</application><platform>MAC</platform><enigmaVersion><major>27</major><minor>2</minor></enigmaVersion><appVersion><major>27</major><minor>2</minor></appVersion><fileVersion><major>26</major><minor>2</minor></fileVersion>';
  return `<?xml version="1.0" encoding="UTF-8"?><finale version="26.2" xmlns="http://www.makemusic.com/2012/finale"><header><headerData><wordOrder>lo-endian</wordOrder><textEncoding>Mac</textEncoding><created>${stamp}</created><modified>${stamp}</modified></headerData></header><options>${makeOptions(score.tempo)}</options><others>${others}</others><details>${details}</details><entries>${entries}</entries><texts>${texts}</texts></finale>`;
}
export async function toMusx(input, {experimental=false} = {}) {
  const score=validateScore(input);
  if(score.musxSource?.version===1&&score.musxSource.projectionFingerprint===fingerprint(score))return unbase64(score.musxSource.archiveBase64);
  fail(experimental===true, 'la exportación MUSX de partituras nuevas o modificadas todavía no está validada en Finale. Guarda .rickmusic o exporta MusicXML.');
  fail(!score.parts.some(p=>p.measures.some(m=>m.notes.some(n=>n.chord||n.dynamic||n.articulation))),'la exportación MUSX de expresiones, articulaciones o cifrados todavía no está disponible; guarda en MusicXML para conservarlos');
  const xml=toEnigmaXML(score),zip=new JSZip();
  zip.file('mimetype','application/vnd.makemusic.notation',{compression:'STORE'});
  zip.file('META-INF/container.xml','<?xml version="1.0" encoding="UTF-8"?><container version="26" xmlns="http://www.makemusic.com/2012/container"><rootfiles><rootfile full-path="score.dat" media-type="application/vnd.makemusic.notation.dat.1"/></rootfiles></container>');
  zip.file('NotationMetadata.xml',`<?xml version="1.0" encoding="UTF-8"?><metadata version="26.2" xmlns="http://www.makemusic.com/2012/NotationMetadata"><fileInfo><creatorString>Rick Music</creatorString><title>${esc(score.title)}</title><initialTempo>${score.tempo}</initialTempo></fileInfo></metadata>`);
  zip.file('score.dat',recodeScoreDat(pako.gzip(new TextEncoder().encode(xml))));
  return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}
