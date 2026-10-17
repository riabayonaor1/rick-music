// Original vector artwork for Rick Music. These paths do not reuse Finale assets.
const icon = body => `<svg viewBox="0 0 28 28" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const path = d => `<path d="${d}"/>`;
const text = (value,x=14,y=20,size=17) => `<text x="${x}" y="${y}" fill="currentColor" stroke="none" text-anchor="middle" font-family="Georgia,serif" font-size="${size}">${value}</text>`;
const staff = path('M3 8H25M3 12H25M3 16H25M3 20H25');
const note = path('M17 5V20')+'<ellipse cx="13.5" cy="20" rx="3.5" ry="2.5" fill="currentColor" stroke="none"/>';
const artwork = {
 ossia: staff+path('M9 4H22M9 2H22M20 2V8M7 11V17')+'<ellipse cx="5" cy="17" rx="2" ry="1.5" fill="currentColor"/>',
 bracket: path('M20 3H9V25H20M7 4V24'),
 chord: text('C',11,20,21)+text('7',22,11,11),
 clef: path('M14 24C5 24 4 13 14 10C23 7 15 0 12 5C10 9 17 21 16 24C15 28 8 25 11 23M8 16C9 10 22 13 19 19C16 23 9 20 11 16'),
 hand: path('M8 16V10C8 7 11 7 11 10V15V5C11 2 14 2 14 5V14V6C14 3 17 3 17 6V15V9C17 6 20 6 20 9V20C20 26 11 27 8 22L4 17C2 14 5 12 8 16'),
 title: text('T',14,22,25),
 hyperscribe: note+path('M3 5V11M6 2V13M22 4L25 7L22 10'),
 key: path('M10 3L8 25M17 3L15 25M4 10L22 7M3 19L21 16'),
 lyrics: text('la',14,19,18)+path('M6 23H12M16 23H22'),
 region: path('M3 9V3H9M19 3H25V9M25 19V25H19M9 25H3V19M8 9H20M8 14H20M8 19H16'),
 'measure-legacy': staff+path('M9 6V23M19 6V23M4 25L24 3'),
 measure: staff+path('M7 5V23M21 5V23'),
 'measure-number': text('12',14,19,16)+path('M3 5V24H25'),
 midi: path('M4 22V15H8V22M11 22V9H15V22M18 22V4H22V22M3 25H25'),
 mirror: path('M14 3V25M10 7L4 14L10 21M18 7L24 14L18 21M9 14H19'),
 staff: staff+path('M7 4V24M22 4V24'),
 articulation: note+'<circle cx="13" cy="5" r="1.5" fill="currentColor"/>'+path('M7 2H19'),
 'note-mover': note+path('M3 9H11M3 9L6 6M3 9L6 12M20 17H26M26 17L23 14M26 17L23 20'),
 graphics: '<rect x="3" y="4" width="22" height="20" rx="2"/>'+path('M4 20L10 13L16 19L20 14L25 20')+'<circle cx="19" cy="9" r="2"/>',
 'page-layout': '<rect x="6" y="2" width="17" height="24" rx="1"/>'+path('M9 7H20M9 11H20M9 15H20M9 19H16M2 8V20M1 8H4M1 20H4'),
 repeat: path('M8 4V24M12 4V24M4 8H24M4 13H24M4 18H24M4 23H24')+'<circle cx="18" cy="10.5" r="1.3" fill="currentColor"/><circle cx="18" cy="15.5" r="1.3" fill="currentColor"/>',
 resize: path('M3 11V3H11M17 25H25V17M3 3L11 11M25 25L17 17')+'<rect x="10" y="10" width="8" height="8"/>',
 expression: text('f',10,23,27)+text('p',21,21,22),
 'simple-entry': note+path('M17 5C18 9 24 8 22 14M3 7H9M6 4V10'),
 'smart-shape': path('M3 20Q14 0 25 20M3 24L25 16M3 24L25 27'),
 'special-tools': path('M4 7H24M8 4V24M8 13H20M20 10V23')+'<circle cx="8" cy="7" r="2.5" fill="white"/><circle cx="20" cy="13" r="2.5" fill="white"/>',
 'speedy-entry': note+path('M4 3L1 12H8L4 21M20 3L25 8L20 13'),
 'staff-legacy': staff+path('M4 25L24 3M8 4V24'),
 'staff-expression': text('mf',14,20,17)+path('M3 25L25 3'),
 tempo: path('M6 24L13 3H17L23 24ZM14 18L21 8M6 24H23')+'<circle cx="14" cy="18" r="2" fill="currentColor"/>',
 text: text('A',14,22,25)+path('M4 25H24'),
 time: text('4',14,13,15)+text('4',14,26,15),
 transcription: '<rect x="3" y="3" width="22" height="22" rx="2"/>'+path('M7 8V20M11 8V20M15 8V20M19 8V20M5 13H23')+'<circle cx="20" cy="6" r="1.5" fill="currentColor"/>',
 tuplet: text('3',14,12,13)+path('M4 14V10H8M20 10H24V14M8 16V24M14 16V24M20 16V24M8 16H20'),
 zoom: '<circle cx="11" cy="11" r="7"/>'+path('M16 16L25 25M7 11H15M11 7V15'),
 select: path('M5 2V23L11 17L15 26L20 23L15 15H25Z')
};
const definitions = [
 ['ossia','Ossia','Crear un pentagrama alternativo pequeño para el compás seleccionado.'],
 ['bracket','Corchete','Agrupar pentagramas con corchete, llave o línea.'],
 ['chord','Acorde','Escribir el cifrado de un acorde.'],
 ['clef','Clave','Elegir la clave de un pentagrama o compás.'],
 ['hand','Agarre manual','Desplazar la vista de la partitura.'],
 ['title','Título','Editar el título mediante la herramienta de texto.',true],
 ['hyperscribe','HyperScribe','Grabar una interpretación MIDI y transcribirla.'],
 ['key','Armadura','Cambiar la tonalidad de la partitura.'],
 ['lyrics','Letra','Añadir letra a la nota seleccionada.'],
 ['region','Edición de región','Seleccionar, copiar y transportar regiones musicales.'],
 ['measure-legacy','Compás clásico','Abrir los atributos del compás.',true],
 ['measure','Compás','Editar barras de compás, etiquetas y repeticiones.'],
 ['measure-number','Número de compás','Editar la etiqueta del compás.',true],
 ['midi','MIDI','Ajustar velocidad y desplazamiento temporal de una nota.'],
 ['mirror','Espejo','Copiar un compás y conservar su referencia de origen.'],
 ['staff','Pentagrama','Editar el nombre y transposición del instrumento.'],
 ['articulation','Articulación','Asignar una articulación a la nota seleccionada.'],
 ['note-mover','Movimiento de notas','Mover la nota a otra capa independiente.'],
 ['graphics','Gráfico','Exportar gráficos de la partitura.'],
 ['page-layout','Maquetación','Ajustar distribución de sistemas y pentagramas.'],
 ['repeat','Repetición','Crear inicio y final de repetición en el compás.'],
 ['resize','Tamaño','Cambiar el tamaño de página o de la nota seleccionada.'],
 ['expression','Expresión','Añadir una indicación expresiva a la nota.'],
 ['simple-entry','Introducción simple','Introducir notas con la duración elegida.'],
 ['smart-shape','Forma inteligente','Dibujar ligaduras, reguladores o líneas entre notas.'],
 ['special-tools','Herramientas especiales','Ajustar plica, cabeza, posición y puntillos de una nota.'],
 ['speedy-entry','Introducción rápida','Introducir música mediante teclado o MIDI.'],
 ['staff-legacy','Atributos de pentagrama','Abrir los atributos actuales del pentagrama.',true],
 ['staff-expression','Expresiones de pentagrama','Añadir una expresión con la herramienta actual.',true],
 ['tempo','Tempo','Asignar un tempo global o al compás seleccionado.'],
 ['text','Texto','Añadir un bloque de texto a la página.'],
 ['time','Indicación de compás','Establecer la métrica de la partitura.'],
 ['transcription','Transcripción','Transcribir una interpretación MIDI.'],
 ['tuplet','Grupo irregular','Crear tresillos, quintillos o septillos.'],
 ['zoom','Zoom','Cambiar el aumento de la vista.'],
 ['select','Selección','Seleccionar notas y compases para editarlos.']
];
export const TOOL_DEFINITIONS = Object.freeze(definitions.map(([id,label,description,legacy=false])=>Object.freeze({id,label,description,legacy,svg:icon(artwork[id])})));
const uid = () => globalThis.crypto?.randomUUID?.() ?? `tool-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const number = (value,min,max,label) => {
 const result=Number(value);if(!Number.isFinite(result)||result<min||result>max)throw Error(`${label}: valor permitido ${min}–${max}.`);return result;
};
const integer = (value,min,max,label) => {const n=number(value,min,max,label);if(!Number.isInteger(n))throw Error(`${label}: se requiere un entero.`);return n;};
const field = (name,label,value,extra={}) => ({name,label,value,...extra});
const numeric = (name,label,value,min,max) => field(name,label,value,{type:'number',min,max});
const choice = (name,label,value,options) => field(name,label,value,{options});
const yesNo = [['no','No'],['yes','Sí']];
const cloneNotes = notes => {
 const groups=new Map();return notes.map(source=>{const n=structuredClone(source);n.id=uid();if(n.tuplet){if(!groups.has(n.tuplet.group))groups.set(n.tuplet.group,uid());n.tuplet.group=groups.get(n.tuplet.group);}return n;});
};

/** Host callbacks own interactions requiring canvas, MIDI devices or file APIs.
 * Dialog values follow app.js's existing { name,label,value,type,options } format.
 * Unknown metadata is retained by the version1 document model and undo history.
 */
export function runTool(id,ctx) {
 const def=TOOL_DEFINITIONS.find(tool=>tool.id===id);if(!def)throw Error(`Herramienta desconocida: ${id}`);
 const {score,selection}=ctx,part=score.parts[selection.part],measure=part?.measures[selection.measure];
 if(!part||!measure)throw Error('Selecciona un compás válido.');
 const call = (name,...args) => {if(typeof ctx.callbacks?.[name]==='function')return ctx.callbacks[name](...args);ctx.toast?.(`${def.label}: esta interacción todavía no está conectada en esta vista.`);return false;};
 const ask = (title,fields,submit) => ctx.dialog(title,fields,values=>ctx.mutate(()=>submit(values)));
 const requireNote = () => {const n=ctx.getNote();if(!n)ctx.toast?.('Selecciona una nota para usar esta herramienta.');return n;};
 switch(id) {
  case 'select': return ctx.setTool('select');
  case 'simple-entry': return ctx.setTool('note');
  case 'chord': return call('chord');
  case 'lyrics': return call('lyric');
  case 'tuplet': return call('tuplet');
  case 'hand': return call('hand');
  case 'zoom': return call('zoom');
  case 'hyperscribe': return call('hyperscribe');
  case 'transcription': return call('transcription');
  case 'graphics': return call('graphics');
  case 'region': return call('region');
  case 'speedy-entry': return call('speedy');
  case 'title': return ask('Título de la partitura',[field('title','Título',score.title),field('composer','Compositor',score.composer)],v=>{score.title=String(v.title).slice(0,1000);score.composer=String(v.composer).slice(0,1000);});
  case 'staff-legacy':
  case 'staff': return ask('Atributos del pentagrama',[field('name','Nombre',part.name),numeric('transpose','Transposición escrita (semitonos)',part.transpose??0,-48,48)],v=>{part.name=String(v.name).slice(0,1000);part.transpose=integer(v.transpose,-48,48,'Transposición');});
  case 'clef': return ask('Clave',[choice('clef','Clave',measure.clef??part.clef,part.percussion?[['percussion','Percusión']]:[['treble','Sol'],['bass','Fa'],['alto','Do en tercera']]),choice('scope','Aplicar a','part',[['part','Todo el pentagrama'],['measure','Desde este compás']])],v=>{if(!['treble','bass','alto','percussion'].includes(v.clef)||!!part.percussion!==(v.clef==='percussion'))throw Error('Clave incompatible con el instrumento.');if(v.scope==='measure')measure.clef=v.clef;else{part.clef=v.clef;for(const m of part.measures)delete m.clef;}});
  case 'key': return ask('Armadura',[choice('key','Tonalidad',score.key,['Cb','Gb','Db','Ab','Eb','Bb','F','C','G','D','A','E','B','F#','C#','Am','Em','Bm','F#m','C#m','G#m','D#m','A#m','Dm','Gm','Cm','Fm','Bbm','Ebm','Abm'])],v=>{score.key=v.key;});
  case 'time': return ask('Indicación de compás',[numeric('beats','Numerador',score.time[0],1,32),choice('unit','Denominador',score.time[1],[1,2,4,8,16,32,64].map(n=>[String(n),String(n)]))],v=>{score.time=[integer(v.beats,1,32,'Numerador'),integer(v.unit,1,64,'Denominador')];});
  case 'measure-number': return ask('Número de compás',[field('label','Etiqueta',measure.label??String(selection.measure+1))],v=>{measure.label=String(v.label).slice(0,100);});
  case 'measure-legacy':
  case 'measure':
  case 'repeat': return ask(id==='repeat'?'Repetición':'Atributos del compás',[
   choice('barline','Barra final',measure.barline??'single',[['single','Simple'],['double','Doble'],['final','Final'],['none','Invisible']]),
   choice('repeatStart','Inicio de repetición',measure.repeatStart?'yes':'no',yesNo),choice('repeatEnd','Final de repetición',measure.repeatEnd?'yes':'no',yesNo),numeric('times','Interpretaciones',measure.times??2,2,16),field('label','Etiqueta del compás',measure.label??'')
  ],v=>{if(!['single','double','final','none'].includes(v.barline))throw Error('Barra de compás inválida.');const repeats={repeatStart:v.repeatStart==='yes',repeatEnd:v.repeatEnd==='yes',times:integer(v.times,2,16,'Interpretaciones')};for(const staff of score.parts)Object.assign(staff.measures[selection.measure],repeats);Object.assign(measure,{barline:v.barline,label:String(v.label).slice(0,100)});});
  case 'midi': {
   const n=requireNote();if(!n)return false;
   return ask('Datos MIDI de la nota',[numeric('velocity','Velocidad',n.velocity??80,1,127),numeric('timing','Desplazamiento (pulsos)',n.timing??0,-4,4)],v=>{n.velocity=integer(v.velocity,1,127,'Velocidad');n.timing=number(v.timing,-4,4,'Desplazamiento');});
  }
  case 'note-mover': {
   const n=requireNote();if(!n)return false;
   return ask('Mover nota a otra capa',[choice('layer','Capa de destino',n.layer??1,[1,2,3,4].map(layer=>[String(layer),`Capa ${layer}`]))],v=>{n.layer=integer(v.layer,1,4,'Capa');});
  }
  case 'articulation': {
   const n=requireNote();if(!n)return false;
   return ask('Articulación',[choice('articulation','Indicación',n.articulation??'',[['','Ninguna'],['staccato','Staccato'],['tenuto','Tenuto'],['accent','Acento'],['strong-accent','Marcato'],['staccatissimo','Staccatissimo'],['detached-legato','Portato'],['fermata','Calderón']])],v=>{n.articulation=v.articulation;});
  }
  case 'staff-expression':
  case 'expression': {
   const n=requireNote();if(!n)return false;
   return ask('Expresión',[field('expression','Texto expresivo',n.expression??''),choice('dynamic','Dinámica',n.dynamic??'',['','ppp','pp','p','mp','mf','f','ff','fff','sfz','fp'])],v=>{n.expression=String(v.expression).slice(0,1000);n.dynamic=String(v.dynamic);});
  }
  case 'tempo': return ask('Tempo',[numeric('tempo','Negras por minuto',measure.tempo??score.tempo,10,500),choice('scope','Aplicar a','measure',[['measure','Desde este compás'],['score','Toda la partitura']])],v=>{const tempo=number(v.tempo,10,500,'Tempo');if(v.scope==='score'){score.tempo=tempo;for(const p of score.parts)for(const m of p.measures)delete m.tempo;}else for(const p of score.parts)p.measures[selection.measure].tempo=tempo;});
  case 'resize': return ask('Cambiar tamaño',[numeric('scale','Escala (%)',Math.round((ctx.getNote()?.scale??score.layout?.pageScale??1)*100),40,200),choice('scope','Objeto','page',[['page','Página'],['note','Nota seleccionada']])],v=>{const scale=number(v.scale,40,200,'Escala')/100;if(v.scope==='note'){const n=ctx.getNote();if(!n)throw Error('Selecciona una nota.');n.scale=scale;}else score.layout={...score.layout,pageScale:scale};});
  case 'page-layout': return ask('Maquetación de página',[numeric('perLine','Compases por sistema',score.layout?.perLine??4,1,8),numeric('staffGap','Separación de pentagramas',score.layout?.staffGap??100,60,240),numeric('pageScale','Escala (%)',Math.round((score.layout?.pageScale??1)*100),40,150)],v=>{score.layout={...score.layout,perLine:integer(v.perLine,1,8,'Compases por sistema'),staffGap:number(v.staffGap,60,240,'Separación'),pageScale:number(v.pageScale,40,150,'Escala')/100};});
  case 'text': return ask('Texto de página',[field('text','Texto',''),numeric('x','Posición horizontal',100,0,1000),numeric('y','Posición vertical',100,0,1400)],v=>{const value=String(v.text).trim();if(!value)throw Error('Escribe un texto.');(score.textBlocks??=[]).push({id:uid(),text:value.slice(0,4000),x:number(v.x,0,1000,'Posición horizontal'),y:number(v.y,0,1400,'Posición vertical')});});
  case 'bracket': return ask('Agrupar pentagramas',[numeric('start','Primer pentagrama',selection.part+1,1,score.parts.length),numeric('end','Último pentagrama',Math.min(selection.part+2,score.parts.length),1,score.parts.length),choice('type','Forma','bracket',[['bracket','Corchete'],['brace','Llave'],['line','Línea']])],v=>{const start=integer(v.start,1,score.parts.length,'Primer pentagrama')-1,end=integer(v.end,1,score.parts.length,'Último pentagrama')-1;if(end<start)throw Error('El último pentagrama debe seguir al primero.');if(!['bracket','brace','line'].includes(v.type))throw Error('Forma inválida.');(score.brackets??=[]).push({id:uid(),start,end,type:v.type});});
  case 'mirror': {
   if(ctx.callbacks?.mirror)return ctx.callbacks.mirror();
   return ask('Copiar compás con referencia de origen',[numeric('source','Compás de origen',Math.max(1,selection.measure),1,part.measures.length)],v=>{const source=integer(v.source,1,part.measures.length,'Compás de origen')-1;if(source===selection.measure)throw Error('Elige un compás diferente del destino.');measure.notes=cloneNotes(part.measures[source].notes);measure.mirrorOf={partId:part.id,measure:source};});
  }
  case 'ossia': return call('ossia');
  case 'smart-shape': {
   if(ctx.callbacks?.smartShape)return ctx.callbacks.smartShape();
   const n=requireNote();if(!n)return false;
   const targets=part.measures.flatMap((m,mi)=>m.notes.map((other,ni)=>({note:other,label:`Compás ${mi+1} · nota ${ni+1} · capa ${other.layer??1}`}))).filter(entry=>entry.note.id!==n.id);
   if(!targets.length){ctx.toast?.('Añade otra nota para definir el final de la forma.');return false;}
   return ask('Forma inteligente',[choice('type','Forma','slur',[['slur','Ligadura de expresión'],['crescendo','Crescendo'],['diminuendo','Diminuendo'],['line','Línea']]),choice('end','Nota final',targets[0].note.id,targets.map(entry=>[entry.note.id,entry.label]))],v=>{if(!['slur','crescendo','diminuendo','line'].includes(v.type)||!targets.some(entry=>entry.note.id===v.end))throw Error('Extremos o forma inválidos.');(score.smartShapes??=[]).push({id:uid(),type:v.type,partId:part.id,startNoteId:n.id,endNoteId:v.end});});
  }
  case 'special-tools': {
   if(ctx.callbacks?.specialTools)return ctx.callbacks.specialTools();
   const n=requireNote();if(!n)return false;
   return ask('Herramientas especiales',[choice('stem','Dirección de plica',n.stemDirection??'auto',[['auto','Automática'],['up','Arriba'],['down','Abajo']]),choice('head','Cabeza de nota',n.notehead??'normal',[['normal','Normal'],['cross','Cruz'],['diamond','Rombo'],['triangle','Triángulo']]),numeric('offsetX','Desplazamiento horizontal',n.offsetX??0,-30,30),numeric('offsetY','Desplazamiento vertical',n.offsetY??0,-30,30),numeric('dots','Puntillos',n.dots??0,0,3)],v=>{if(!['auto','up','down'].includes(v.stem)||!['normal','cross','diamond','triangle'].includes(v.head))throw Error('Plica o cabeza de nota inválidas.');const dots=integer(v.dots,0,3,'Puntillos');n.duration=n.duration/(2-1/2**n.dots)*(2-1/2**dots);Object.assign(n,{dots,stemDirection:v.stem,notehead:v.head,offsetX:number(v.offsetX,-30,30,'Desplazamiento horizontal'),offsetY:number(v.offsetY,-30,30,'Desplazamiento vertical')});});
  }
  default: throw Error(`Falta la implementación de ${id}.`);
 }
}
