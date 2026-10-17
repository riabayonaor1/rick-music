// General MIDI program numbers are zero-based. Vocal ranges are editable guidance.
const families = [
 ['Teclados',['Piano de cola','Piano brillante','Piano eléctrico de cola','Piano honky-tonk','Piano eléctrico 1','Piano eléctrico 2','Clavecín','Clavinet']],
 ['Percusión afinada',['Celesta','Glockenspiel','Caja de música','Vibráfono','Marimba','Xilófono','Campanas tubulares','Dulcémele']],
 ['Órganos y acordeones',['Órgano de tiradores','Órgano de percusión','Órgano de rock','Órgano de iglesia','Órgano de lengüetas','Acordeón','Armónica','Bandoneón']],
 ['Guitarras',['Guitarra clásica','Guitarra acústica','Guitarra de jazz','Guitarra eléctrica limpia','Guitarra eléctrica apagada','Guitarra overdrive','Guitarra distorsionada','Armónicos de guitarra']],
 ['Bajos',['Bajo acústico','Bajo eléctrico con dedos','Bajo eléctrico con púa','Bajo sin trastes','Bajo slap 1','Bajo slap 2','Bajo sintetizado 1','Bajo sintetizado 2']],
 ['Cuerdas',['Violín','Viola','Violonchelo','Contrabajo','Trémolo de cuerdas','Cuerdas pizzicato','Arpa','Timbales']],
 ['Conjuntos y coros',['Conjunto de cuerdas 1','Conjunto de cuerdas 2','Cuerdas sintetizadas 1','Cuerdas sintetizadas 2','Coro ah','Coro oh','Voz sintetizada','Golpe de orquesta']],
 ['Metales',['Trompeta','Trombón','Tuba','Trompeta con sordina','Trompa','Conjunto de metales','Metales sintetizados 1','Metales sintetizados 2']],
 ['Maderas de lengüeta',['Saxofón soprano','Saxofón alto','Saxofón tenor','Saxofón barítono','Oboe','Corno inglés','Fagot','Clarinete']],
 ['Flautas',['Flautín','Flauta travesera','Flauta dulce','Flauta de Pan','Soplo de botella','Shakuhachi','Silbato','Ocarina']],
 ['Sintetizadores solistas',['Lead cuadrado','Lead diente de sierra','Lead calíope','Lead chiff','Lead charang','Lead voz','Lead quintas','Lead bajo y solista']],
 ['Pads',['Pad nueva era','Pad cálido','Pad polisintético','Pad coro','Pad arco','Pad metálico','Pad halo','Pad barrido']],
 ['Efectos sintetizados',['FX lluvia','FX banda sonora','FX cristal','FX atmósfera','FX brillo','FX duendes','FX ecos','FX ciencia ficción']],
 ['Instrumentos del mundo',['Sitar','Banjo','Shamisen','Koto','Kalimba','Gaita','Violín tradicional','Shanai']],
 ['Percusión y efectos afinados',['Campanilla','Agogô','Steel drums','Woodblock','Taiko','Tom melódico','Batería sintetizada','Platillo invertido']],
 ['Efectos sonoros',['Ruido de trastes','Ruido de respiración','Mar','Pájaro','Teléfono','Helicóptero','Aplausos','Disparo']]
];
export const GM_INSTRUMENTS=families.flatMap(([family,names],fi)=>names.map((name,i)=>{const program=fi*8+i;return {id:`gm-${program}`,name,family,program,clef:program>=32&&program<=39||[42,43,47,57,58,66,67,70].includes(program)?'bass':program===41?'alto':'treble',range:[0,127],hint:`General MIDI ${program+1}`};}));
const voice=(id,name,range,clef='treble')=>({id,name,family:'Voces',program:52,clef,range,hint:`Registro orientativo · sonido coral`});
export const VOCAL_INSTRUMENTS=[voice('voice-baritone','Barítono (voz)',[45,65],'bass'),voice('voice-soprano','Soprano',[60,84]),voice('voice-mezzo','Mezzosoprano',[57,81]),voice('voice-alto','Contralto',[53,77]),voice('voice-tenor','Tenor',[48,72],'bass'),voice('voice-bass','Bajo (voz)',[40,64],'bass'),voice('voice-children','Voz infantil',[60,79]),voice('voice-choir','Coro mixto',[40,84])];
const orchestral=[
 ['brass-baritone','Bombardino / barítono (metal)',57,'bass',[40,70]],['brass-euphonium','Eufonio',57,'bass',[40,70]],['brass-cornet','Corneta',56,'treble',[54,82]],['brass-flugelhorn','Fliscorno',56,'treble',[54,82]],
 ['wood-bassclarinet','Clarinete bajo',71,'bass',[38,74]],['wood-contrabassoon','Contrafagot',70,'bass',[22,58]],['wood-altoflute','Flauta alto',73,'treble',[55,91]],['wood-bassflute','Flauta baja',73,'bass',[48,84]],['strings-violin2','Violín II',40,'treble',[55,103]]
].map(([id,name,program,clef,range])=>({id,name,program,clef,range,family:'Orquesta · adicionales',hint:'Altura de concierto · timbre GM aproximado'}));
export const DRUMS=[{id:'drum-kit',name:'Batería / percusión GM',family:'Batería',program:0,clef:'percussion',range:[35,81],percussion:true,hint:'Mapa GM · notas 35–81'}];
export const INSTRUMENTS=[...VOCAL_INSTRUMENTS,...orchestral,...GM_INSTRUMENTS,...DRUMS];
export const DRUM_NAMES={35:'Bombo acústico',36:'Bombo',37:'Aro de caja',38:'Caja acústica',39:'Palmas',40:'Caja eléctrica',41:'Tom grave de suelo',42:'Hi-hat cerrado',43:'Tom de suelo',44:'Hi-hat de pedal',45:'Tom grave',46:'Hi-hat abierto',47:'Tom medio grave',48:'Tom medio agudo',49:'Crash',50:'Tom agudo',51:'Ride',52:'Platillo chino',53:'Campana ride',54:'Pandereta',55:'Splash',56:'Cencerro',57:'Crash 2',58:'Vibraslap',59:'Ride 2',60:'Bongó agudo',61:'Bongó grave',62:'Conga aguda apagada',63:'Conga aguda abierta',64:'Conga grave',65:'Timbal agudo',66:'Timbal grave',67:'Agogô agudo',68:'Agogô grave',69:'Cabasa',70:'Maracas',71:'Silbato corto',72:'Silbato largo',73:'Güiro corto',74:'Güiro largo',75:'Claves',76:'Woodblock agudo',77:'Woodblock grave',78:'Cuica apagada',79:'Cuica abierta',80:'Triángulo apagado',81:'Triángulo abierto'};
export function instrumentById(id){return INSTRUMENTS.find(i=>i.id===id);}
export function makePart(instrument,measures){return {id:crypto.randomUUID(),name:instrument.name,clef:instrument.clef,program:instrument.program,volume:.8,muted:false,instrumentId:instrument.id,range:instrument.range,percussion:!!instrument.percussion,measures:Array.from({length:measures},()=>({notes:[]}))};}
